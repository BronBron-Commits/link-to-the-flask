"""
ROUTES — HTTP endpoints.

All REST API and static-file routes live here.
SocketIO event handlers belong in app.py instead.
"""
import json
import os
import re
import hashlib
import threading
import time
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib import error as urllib_error
from urllib import request as urllib_request
from uuid import uuid4

from io import BytesIO

from flask import request, jsonify, render_template, send_file, send_from_directory, Response, session, redirect
from werkzeug.utils import secure_filename

from extensions import app
import game_state as gs
from state_sync import broadcast_world

try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False

try:
    from gtts import gTTS as _gTTS
    HAS_GTTS = True
except ImportError:
    HAS_GTTS = False
from scripts.pdf_to_tidy_data import (
    parse_character_tables,
    write_outputs,
)


ARTIFACTS_DIR = Path("artifacts")
PDF_IMPORT_JOBS: dict[str, dict] = {}
PDF_IMPORT_JOBS_LOCK = threading.Lock()
PDF_IMPORT_JOB_TTL_SECONDS = 1800


def _prune_pdf_import_jobs_locked(now_ts: float) -> None:
    stale_ids: list[str] = []
    for job_id, job in PDF_IMPORT_JOBS.items():
        finished_at = float(job.get("finished_at") or 0)
        if finished_at and (now_ts - finished_at) > PDF_IMPORT_JOB_TTL_SECONDS:
            stale_ids.append(job_id)
    for job_id in stale_ids:
        PDF_IMPORT_JOBS.pop(job_id, None)


def _run_pdf_import_job(job_id: str, source_path: Path) -> None:
    with PDF_IMPORT_JOBS_LOCK:
        job = PDF_IMPORT_JOBS.get(job_id)
        if not isinstance(job, dict):
            return
        job["status"] = "running"
        job["started_at"] = time.time()

    try:
        result = _import_pdf_to_contracts(source_path)
        with PDF_IMPORT_JOBS_LOCK:
            job = PDF_IMPORT_JOBS.get(job_id)
            if not isinstance(job, dict):
                return
            job["status"] = "completed"
            job["result"] = result
            job["finished_at"] = time.time()
    except Exception as exc:
        with PDF_IMPORT_JOBS_LOCK:
            job = PDF_IMPORT_JOBS.get(job_id)
            if not isinstance(job, dict):
                return
            job["status"] = "failed"
            job["error"] = "pdf-import-failed"
            job["detail"] = type(exc).__name__
            job["finished_at"] = time.time()


def _start_pdf_import_job(source_path: Path) -> str:
    job_id = uuid4().hex
    now_ts = time.time()
    with PDF_IMPORT_JOBS_LOCK:
        _prune_pdf_import_jobs_locked(now_ts)
        PDF_IMPORT_JOBS[job_id] = {
            "status": "queued",
            "source_file": source_path.name,
            "created_at": now_ts,
            "started_at": None,
            "finished_at": None,
            "result": None,
            "error": None,
            "detail": None,
        }

    thread = threading.Thread(target=_run_pdf_import_job, args=(job_id, source_path), daemon=True)
    thread.start()
    return job_id


def _asset_version_token(relative_path: str) -> str:
    safe_relative = str(relative_path or "").replace("\\", "/").lstrip("/")
    if not safe_relative:
        return gs.SERVER_BUILD_TAG
    candidate = (gs.STATIC_DIR / safe_relative).resolve()
    try:
        candidate.relative_to(gs.STATIC_DIR.resolve())
    except ValueError:
        return gs.SERVER_BUILD_TAG
    try:
        mtime = int(candidate.stat().st_mtime)
    except OSError:
        mtime = 0
    return f"{gs.SERVER_BUILD_TAG}-{mtime}"


def asset_url(relative_path: str) -> str:
    raw_path = str(relative_path or "").strip()
    if not raw_path:
        return "/static/"
    normalized = raw_path.replace("\\", "/").lstrip("/")
    parts = urlsplit(f"/static/{normalized}")
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["v"] = _asset_version_token(parts.path.removeprefix("/static/"))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


@app.context_processor
def inject_asset_helpers():
    return {"asset_url": asset_url}


@app.route("/runtime-asset-version.js", methods=["GET"])
def runtime_asset_version_js():
    version = gs.SERVER_BUILD_TAG
    payload = (
        "(function () {\n"
        f"  const version = {json.dumps(version)};\n"
        "  function assetUrl(input) {\n"
        "    const raw = String(input || '');\n"
        "    if (!raw) return raw;\n"
        "    try {\n"
        "      const url = new URL(raw, window.location.origin);\n"
        "      if (url.origin === window.location.origin && url.pathname.startsWith('/static/')) {\n"
        "        url.searchParams.set('v', version);\n"
        "      }\n"
        "      return url.pathname + url.search + url.hash;\n"
        "    } catch (_err) {\n"
        "      return raw;\n"
        "    }\n"
        "  }\n"
        "  window.__ASSET_VERSION__ = version;\n"
        "  window.__assetUrl = assetUrl;\n"
        "})();\n"
    )
    response = Response(payload, mimetype="application/javascript")
    response.headers["Cache-Control"] = "no-store"
    return response


def _supabase_public_config() -> dict:
    return {
        "url": str(os.environ.get("SUPABASE_URL") or "").strip(),
        "anon_key": str(os.environ.get("SUPABASE_ANON_KEY") or "").strip(),
    }


def _discord_oauth_config() -> dict:
    return {
        "client_id": str(os.environ.get("DISCORD_CLIENT_ID") or "").strip(),
        "client_secret": str(os.environ.get("DISCORD_CLIENT_SECRET") or "").strip(),
        "redirect_uri": str(os.environ.get("DISCORD_REDIRECT_URI") or "").strip(),
        "scope": str(os.environ.get("DISCORD_OAUTH_SCOPE") or "identify email").strip() or "identify email",
    }


def _discord_is_configured(config: dict | None = None) -> bool:
    cfg = config if isinstance(config, dict) else _discord_oauth_config()
    return bool(cfg.get("client_id") and cfg.get("client_secret") and cfg.get("redirect_uri"))


def _discord_exchange_code(code: str, config: dict) -> tuple[dict | None, str | None]:
    clean_code = str(code or "").strip()
    if not clean_code:
        return None, "discord-missing-code"

    token_url = "https://discord.com/api/oauth2/token"
    payload = {
        "client_id": str(config.get("client_id") or "").strip(),
        "client_secret": str(config.get("client_secret") or "").strip(),
        "grant_type": "authorization_code",
        "code": clean_code,
        "redirect_uri": str(config.get("redirect_uri") or "").strip(),
    }
    encoded = urlencode(payload).encode("utf-8")
    headers = {"Content-Type": "application/x-www-form-urlencoded"}

    if HAS_HTTPX:
        try:
            with httpx.Client(verify=True, timeout=8.0) as client:
                response = client.post(token_url, headers=headers, content=encoded)
                if response.status_code != 200:
                    return None, f"discord-token-http-{response.status_code}"
                token_payload = response.json()
        except httpx.TimeoutException:
            return None, "discord-token-timeout"
        except Exception:
            return None, "discord-token-network-error"
    else:
        req = urllib_request.Request(token_url, data=encoded, headers=headers, method="POST")
        try:
            with urllib_request.urlopen(req, timeout=8) as response:
                token_payload = json.loads(response.read().decode("utf-8"))
        except urllib_error.HTTPError as exc:
            return None, f"discord-token-http-{int(getattr(exc, 'code', 0) or 0)}"
        except urllib_error.URLError:
            return None, "discord-token-network-error"
        except TimeoutError:
            return None, "discord-token-timeout"
        except json.JSONDecodeError:
            return None, "discord-token-invalid-json"
        except OSError:
            return None, "discord-token-os-error"

    if not isinstance(token_payload, dict):
        return None, "discord-token-invalid-payload"
    if not str(token_payload.get("access_token") or "").strip():
        return None, "discord-token-missing-access-token"
    return token_payload, None


def _discord_fetch_user(access_token: str) -> tuple[dict | None, str | None]:
    token = str(access_token or "").strip()
    if not token:
        return None, "discord-missing-access-token"

    user_url = "https://discord.com/api/users/@me"
    headers = {"Authorization": f"Bearer {token}"}

    if HAS_HTTPX:
        try:
            with httpx.Client(verify=True, timeout=8.0) as client:
                response = client.get(user_url, headers=headers)
                if response.status_code != 200:
                    return None, f"discord-user-http-{response.status_code}"
                payload = response.json()
        except httpx.TimeoutException:
            return None, "discord-user-timeout"
        except Exception:
            return None, "discord-user-network-error"
    else:
        req = urllib_request.Request(user_url, headers=headers, method="GET")
        try:
            with urllib_request.urlopen(req, timeout=8) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib_error.HTTPError as exc:
            return None, f"discord-user-http-{int(getattr(exc, 'code', 0) or 0)}"
        except urllib_error.URLError:
            return None, "discord-user-network-error"
        except TimeoutError:
            return None, "discord-user-timeout"
        except json.JSONDecodeError:
            return None, "discord-user-invalid-json"
        except OSError:
            return None, "discord-user-os-error"

    return payload if isinstance(payload, dict) else None, None if isinstance(payload, dict) else "discord-user-invalid-payload"


def _normalize_discord_user(user: dict) -> dict:
    username = str(user.get("global_name") or user.get("username") or "").strip()
    discriminator = str(user.get("discriminator") or "").strip()
    if username and discriminator and discriminator != "0":
        username = f"{username}#{discriminator}"
    return {
        "id": str(user.get("id") or "").strip(),
        "email": str(user.get("email") or "").strip(),
        "displayName": username or "Discord User",
        "role": "discord-authenticated",
        "emailConfirmed": bool(user.get("verified")),
    }


def _redirect_index_with_auth_error(error_code: str):
    safe_error = str(error_code or "auth-error").strip() or "auth-error"
    return redirect(f"/?{urlencode({'authError': safe_error})}", code=302)


def _supabase_is_configured() -> bool:
    cfg = _supabase_public_config()
    return bool(cfg["url"] and cfg["anon_key"])


def _fetch_supabase_user(access_token: str) -> tuple[dict | None, str | None]:
    token = str(access_token or "").strip()
    config = _supabase_public_config()
    if not token or not config["url"] or not config["anon_key"]:
        return None, "missing-config-or-token"
    base_url = config["url"].rstrip("/")
    url = f"{base_url}/auth/v1/user"
    headers = {
        "apikey": config["anon_key"],
        "Authorization": f"Bearer {token}",
    }
    
    # Try httpx if available (gevent-friendly)
    if HAS_HTTPX:
        try:
            with httpx.Client(verify=True, timeout=6.0) as client:
                response = client.get(url, headers=headers)
                if response.status_code != 200:
                    return None, f"supabase-http-{response.status_code}"
                payload = response.json()
                return payload, None
        except httpx.TimeoutException:
            return None, "supabase-timeout"
        except Exception:
            return None, "supabase-network-error"
    
    # Fallback to urllib
    req = urllib_request.Request(url, headers=headers, method="GET")
    try:
        with urllib_request.urlopen(req, timeout=6) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib_error.HTTPError as exc:
        return None, f"supabase-http-{int(getattr(exc, 'code', 0) or 0)}"
    except urllib_error.URLError:
        return None, "supabase-network-error"
    except TimeoutError:
        return None, "supabase-timeout"
    except json.JSONDecodeError:
        return None, "supabase-invalid-json"
    except OSError:
        return None, "supabase-os-error"

    if not isinstance(payload, dict):
        return None, "supabase-invalid-payload"
    return payload, None


def _current_auth_user() -> dict | None:
    auth_user = session.get("auth_user")
    return auth_user if isinstance(auth_user, dict) else None


def _normalize_auth_user(user: dict) -> dict:
    metadata = user.get("user_metadata") if isinstance(user.get("user_metadata"), dict) else {}
    app_metadata = user.get("app_metadata") if isinstance(user.get("app_metadata"), dict) else {}
    display_name = str(
        metadata.get("display_name")
        or metadata.get("full_name")
        or metadata.get("name")
        or ""
    ).strip()
    role = str(
        app_metadata.get("role")
        or user.get("role")
        or "authenticated"
    ).strip() or "authenticated"
    return {
        "id": str(user.get("id") or "").strip(),
        "email": str(user.get("email") or "").strip(),
        "displayName": display_name,
        "role": role,
        "emailConfirmed": bool(user.get("email_confirmed_at") or user.get("confirmed_at")),
    }


def _resolve_contract(filename: str) -> Path | None:
    for candidate in (gs.CONTRACTS_DIR / filename, gs.STATIC_DIR / filename):
        if candidate.exists():
            return candidate
    return None


def _read_json_file(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    return payload if isinstance(payload, dict) else None


def _write_json_file(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _sheet_label_for_path(path: Path) -> str:
    base = re.sub(r"[_\s]+", " ", path.stem).strip()
    return base or path.name


def _discover_selectable_character_sheets() -> list[dict]:
    sheets: list[dict] = []
    roots = (
        ("static", gs.STATIC_DIR),
        ("uploads", gs.UPLOADS_DIR),
    )
    for source, root in roots:
        if not root.exists():
            continue
        for path in sorted(root.rglob("*.pdf")):
            if not path.is_file():
                continue
            rel_path = path.relative_to(root).as_posix()
            sheets.append(
                {
                    "sheetId": f"{source}/{rel_path}",
                    "source": source,
                    "filename": path.name,
                    "relativePath": rel_path,
                    "label": _sheet_label_for_path(path),
                }
            )
    sheets.sort(key=lambda row: (str(row.get("label") or "").lower(), str(row.get("relativePath") or "").lower()))
    return sheets


def _discover_available_glb_models() -> list[dict]:
    rows: list[dict] = []
    supported_exts = (".glb", ".gltf", ".fbx")

    def append_static_path(path: Path, source: str = "static") -> None:
        if not path.is_file():
            return
        rel = path.relative_to(gs.STATIC_DIR).as_posix()
        top_level = rel.split("/", 1)[0] if rel else ""
        rows.append(
            {
                "label": path.name,
                "url": f"/static/{rel}",
                "source": source,
                "relativePath": rel,
                "category": top_level or "static",
            }
        )

    user_models_root = gs.CHARACTER_MODELS_DIR
    if user_models_root.exists():
        for ext in supported_exts:
            for path in sorted(user_models_root.rglob(f"*{ext}")):
                append_static_path(path, source="user_models")

    rows.sort(key=lambda row: (str(row.get("category") or "").lower(), str(row.get("label") or "").lower(), str(row.get("url") or "").lower()))
    return rows


def _sanitize_model_upload_relative_path(raw_name: str) -> Path | None:
    raw = str(raw_name or "").strip().replace("\\", "/")
    if not raw:
        return None

    raw = re.sub(r"^[A-Za-z]:/+", "", raw)
    raw = raw.lstrip("/")
    if not raw:
        return None

    parts: list[str] = []
    for piece in raw.split("/"):
        token = str(piece or "").strip()
        if not token or token in {".", ".."}:
            continue
        safe = secure_filename(token)
        if safe:
            parts.append(safe)

    if not parts:
        return None

    return Path(*parts)


def _dedupe_upload_target(bundle_dir: Path, relative_path: Path) -> Path:
    candidate = bundle_dir / relative_path
    if not candidate.exists():
        return candidate

    stem = secure_filename(relative_path.stem) or "asset"
    suffix = relative_path.suffix.lower()
    parent = relative_path.parent
    counter = 1
    while True:
        next_candidate = bundle_dir / parent / f"{stem}-{counter}{suffix}"
        if not next_candidate.exists():
            return next_candidate
        counter += 1


def _resolve_selectable_pdf(sheet_id: str) -> Path | None:
    raw = str(sheet_id or "").strip()
    if not raw:
        return None
    source, sep, rel_path = raw.partition("/")
    if not sep or not rel_path:
        return None
    root = {
        "static": gs.STATIC_DIR,
        "uploads": gs.UPLOADS_DIR,
    }.get(source)
    if root is None:
        return None
    relative = Path(rel_path)
    if relative.is_absolute() or ".." in relative.parts:
        return None
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        return None
    if not candidate.exists() or not candidate.is_file() or candidate.suffix.lower() != ".pdf":
        return None
    return candidate


def _import_pdf_to_contracts(source_path: Path) -> dict:
    gs.CONTRACTS_DIR.mkdir(parents=True, exist_ok=True)
    tables = parse_character_tables(source_path)
    write_outputs(gs.CONTRACTS_DIR, tables)
    master_path = gs.CONTRACTS_DIR / "character_master.json"
    if master_path.exists():
        master = json.loads(master_path.read_text(encoding="utf-8"))
    else:
        master = {}
    source_meta = master.get("source") if isinstance(master.get("source"), dict) else {}
    identity = master.get("identity") if isinstance(master.get("identity"), dict) else {}
    core_stats = master.get("core_stats") if isinstance(master.get("core_stats"), dict) else {}
    hit_points = master.get("hit_points") if isinstance(master.get("hit_points"), dict) else {}
    abilities = master.get("abilities") if isinstance(master.get("abilities"), dict) else {}
    return {
        "ok": True,
        "source_file": source_path.name,
        "character": tables.get("character", {}),
        "master": {
            "source": source_meta,
            "identity": identity,
            "core_stats": core_stats,
            "hit_points": hit_points,
            "abilities": abilities,
        },
    }


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    cfg = _supabase_public_config()
    return render_template(
        "index.html",
        supabase_url=cfg["url"],
        supabase_anon_key=cfg["anon_key"],
    )


@app.route("/hub")
def hub():
    cfg = _supabase_public_config()
    return render_template(
        "hub.html",
        supabase_url=cfg["url"],
        supabase_anon_key=cfg["anon_key"],
    )


@app.route("/account-hub")
def account_hub():
    cfg = _supabase_public_config()
    user = _current_auth_user()
    is_authenticated = bool(user)
    if not user:
        user = {
            "id": "",
            "email": "",
            "displayName": "Guest Explorer",
            "role": "guest",
            "emailConfirmed": False,
        }
    return render_template(
        "account_hub.html",
        auth_user=user,
        is_authenticated=is_authenticated,
        supabase_url=cfg["url"],
        supabase_anon_key=cfg["anon_key"],
    )


@app.route("/model-select")
def model_select():
    cfg = _supabase_public_config()
    return render_template(
        "model_select.html",
        supabase_url=cfg["url"],
        supabase_anon_key=cfg["anon_key"],
    )


@app.route("/world-select")
def world_select():
    cfg = _supabase_public_config()
    return render_template(
        "world_select.html",
        supabase_url=cfg["url"],
        supabase_anon_key=cfg["anon_key"],
    )


@app.route("/paraval-library")
def paraval_library():
    cfg = _supabase_public_config()
    return render_template(
        "paraval_library.html",
        supabase_url=cfg["url"],
        supabase_anon_key=cfg["anon_key"],
    )


@app.route("/api/tts", methods=["POST"])
def api_tts():
    """Server-side TTS: consistent audio across all browsers."""
    if not HAS_GTTS:
        return jsonify(ok=False, error="TTS not available on server"), 503
    payload = request.get_json(silent=True) or {}
    text = str(payload.get("text") or "").strip()
    if not text:
        return jsonify(ok=False, error="No text provided"), 400
    # Limit input size
    text = text[:4000]
    try:
        tts = _gTTS(text=text, lang="en", slow=False)
        buf = BytesIO()
        tts.write_to_fp(buf)
        buf.seek(0)
        return Response(buf.read(), mimetype="audio/mpeg")
    except Exception:
        return jsonify(ok=False, error="TTS generation failed"), 500


@app.route("/game")
def game():
    return render_template("game.html")


@app.route("/favicon.ico")
def favicon():
    p = gs.STATIC_DIR / "favicon.ico"
    return send_file(p, mimetype="image/x-icon") if p.exists() else Response(status=204)


@app.route("/api/auth/me", methods=["GET"])
def auth_me():
    user = _current_auth_user()
    return jsonify(
        ok=True,
        configured=_supabase_is_configured(),
        authenticated=bool(user),
        user=user,
    )


@app.route("/api/auth/session", methods=["POST"])
def auth_session_create():
    try:
        if not _supabase_is_configured():
            return jsonify(ok=False, error="supabase-not-configured"), 503
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify(ok=False, error="invalid-payload"), 400
        access_token = str(payload.get("accessToken") or "").strip()
        if not access_token:
            return jsonify(ok=False, error="missing-access-token"), 400

        # Avoid repeated upstream validation for the same token in the same browser session.
        token_hash = hashlib.sha256(access_token.encode("utf-8")).hexdigest()
        existing_user = _current_auth_user()
        existing_hash = str(session.get("auth_token_hash") or "")
        if existing_user and existing_hash == token_hash:
            return jsonify(ok=True, authenticated=True, user=existing_user)

        user, validation_error = _fetch_supabase_user(access_token)
        if not user:
            if validation_error == "supabase-http-401":
                return jsonify(ok=False, error="invalid-supabase-session", detail=validation_error), 401
            if validation_error == "supabase-http-403":
                return jsonify(ok=False, error="supabase-key-rejected", detail=validation_error), 502
            if validation_error and validation_error.startswith("supabase-http-"):
                return jsonify(ok=False, error="supabase-user-fetch-failed", detail=validation_error), 502
            if validation_error in ("supabase-network-error", "supabase-timeout", "supabase-os-error"):
                return jsonify(ok=False, error="supabase-unreachable", detail=validation_error), 502
            return jsonify(ok=False, error="invalid-supabase-session", detail=validation_error or "unknown"), 401

        session["auth_user"] = _normalize_auth_user(user)
        session["auth_token_hash"] = token_hash
        # Flask default sessions are cookie-backed; avoid storing large JWTs in cookies.
        session.pop("supabase_access_token", None)
        return jsonify(ok=True, authenticated=True, user=session["auth_user"])
    except Exception as exc:
        print(f"[AUTH SESSION ERROR] {type(exc).__name__}: {exc}", flush=True)
        return jsonify(ok=False, error="auth-session-internal-error", detail=type(exc).__name__), 500


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    session.pop("auth_user", None)
    session.pop("supabase_access_token", None)
    session.pop("auth_token_hash", None)
    return jsonify(ok=True, authenticated=False)


@app.route("/auth/discord/start", methods=["GET"])
def auth_discord_start():
    cfg = _discord_oauth_config()
    if not _discord_is_configured(cfg):
        return _redirect_index_with_auth_error("discord-not-configured")

    state = uuid4().hex
    session["discord_oauth_state"] = state

    params = {
        "response_type": "code",
        "client_id": cfg["client_id"],
        "scope": cfg["scope"],
        "state": state,
        "redirect_uri": cfg["redirect_uri"],
        "prompt": "consent",
    }
    authorize_url = f"https://discord.com/oauth2/authorize?{urlencode(params)}"
    return redirect(authorize_url, code=302)


@app.route("/auth/discord/callback", methods=["GET"])
def auth_discord_callback():
    cfg = _discord_oauth_config()
    if not _discord_is_configured(cfg):
        return _redirect_index_with_auth_error("discord-not-configured")

    callback_error = str(request.args.get("error") or "").strip()
    if callback_error:
        return _redirect_index_with_auth_error(f"discord-{callback_error}")

    state = str(request.args.get("state") or "").strip()
    expected_state = str(session.get("discord_oauth_state") or "").strip()
    session.pop("discord_oauth_state", None)
    if not state or not expected_state or state != expected_state:
        return _redirect_index_with_auth_error("discord-invalid-state")

    code = str(request.args.get("code") or "").strip()
    if not code:
        return _redirect_index_with_auth_error("discord-missing-code")

    token_payload, token_error = _discord_exchange_code(code, cfg)
    if not token_payload:
        return _redirect_index_with_auth_error(token_error or "discord-token-exchange-failed")

    access_token = str(token_payload.get("access_token") or "").strip()
    user_payload, user_error = _discord_fetch_user(access_token)
    if not user_payload:
        return _redirect_index_with_auth_error(user_error or "discord-user-fetch-failed")

    normalized_user = _normalize_discord_user(user_payload)
    session["auth_user"] = normalized_user
    session["auth_token_hash"] = hashlib.sha256(
        f"discord:{normalized_user.get('id', '')}:{time.time()}".encode("utf-8")
    ).hexdigest()
    session.pop("supabase_access_token", None)
    return redirect("/account-hub", code=302)


@app.route("/map3d")
def map3d_page():
    # Canonicalize Open World to one URL so CDN/browser caching cannot pin stale query variants.
    if request.query_string:
        return redirect("/map3d", code=302)
    return send_from_directory(gs.STATIC_DIR, "map3d.html")


@app.route("/map3d-single")
def map3d_single_page():
    # Canonicalize single-player Open World URL for stable caching behavior.
    if request.query_string:
        return redirect("/map3d-single", code=302)
    return send_from_directory(gs.STATIC_DIR, "map3d_single.html")


# ---------------------------------------------------------------------------
# Legacy compatibility
# ---------------------------------------------------------------------------

@app.route("/move", methods=["POST"])
def move():
    # Kept for client compatibility; server-authoritative position is via WebSocket.
    return jsonify(ok=True)


@app.route("/state")
def state():
    return jsonify({"players": gs.players})


# ---------------------------------------------------------------------------
# Scene state
# ---------------------------------------------------------------------------

@app.route("/scene_state", methods=["GET"])
def scene_state_get():
    persisted = _read_json_file(gs.SCENE_STATE_FILE)
    if isinstance(persisted, dict):
        gs.latest_scene_state = {
            "objects": persisted.get("objects", {}),
            "lights": persisted.get("lights", {}),
        }
        gs.world_state["scene"] = gs.latest_scene_state
    return jsonify(gs.build_world_payload(include_scene=True))


@app.route("/scene_state", methods=["POST"])
def scene_state_post():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(ok=False, error="invalid payload"), 400
    incoming = data.get("scene") if isinstance(data.get("scene"), dict) else data
    if not isinstance(incoming, dict):
        return jsonify(ok=False, error="invalid scene state"), 400
    gs.latest_scene_state = {
        "objects": incoming.get("objects", {}),
        "lights": incoming.get("lights", {}),
    }
    gs.world_state["scene"] = gs.latest_scene_state
    _write_json_file(gs.SCENE_STATE_FILE, gs.latest_scene_state)
    if isinstance(data.get("entities"), dict):
        gs.world_state["entities"] = data["entities"]
        if gs.world_state.get("combat", {}).get("state", {}).get("inCombat"):
            gs.sync_enemies_into_order()
    if isinstance(data.get("combat"), dict):
        gs.world_state["combat"] = data["combat"]
    broadcast_world(include_scene=True)
    return jsonify(ok=True, state=gs.latest_scene_state)


@app.route("/materials_state", methods=["GET"])
def materials_state_get():
    payload = _read_json_file(gs.MATERIALS_STATE_FILE)
    if not isinstance(payload, dict):
        payload = {
            "schemaVersion": "materials.v1",
            "materials": {},
        }
    if not isinstance(payload.get("materials"), dict):
        payload["materials"] = {}
    return jsonify(payload)


@app.route("/materials_state", methods=["POST"])
def materials_state_post():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(ok=False, error="invalid payload"), 400
    materials = payload.get("materials")
    if not isinstance(materials, dict):
        return jsonify(ok=False, error="materials must be an object"), 400
    out = {
        "schemaVersion": str(payload.get("schemaVersion") or "materials.v1"),
        "updatedAt": payload.get("updatedAt"),
        "updatedBy": payload.get("updatedBy"),
        "worldId": payload.get("worldId"),
        "materials": materials,
    }
    _write_json_file(gs.MATERIALS_STATE_FILE, out)
    return jsonify(ok=True, state=out)


# ---------------------------------------------------------------------------
# Character data contracts
# ---------------------------------------------------------------------------

@app.route("/character_template.json")
def character_template_contract():
    p = _resolve_contract("character_template.json")
    return send_file(p, mimetype="application/json") if p else (jsonify(ok=False, error="not found"), 404)


@app.route("/combat_instance.json")
def combat_instance_contract():
    p = _resolve_contract("combat_instance.json")
    return send_file(p, mimetype="application/json") if p else (jsonify(ok=False, error="not found"), 404)


@app.route("/character_master.json")
def character_master_contract():
    p = _resolve_contract("character_master.json")
    return send_file(p, mimetype="application/json") if p else (jsonify(ok=False, error="not found"), 404)


@app.route("/data/character_tidy/<path:filename>")
def character_tidy_data_files(filename: str):
    if not gs.CONTRACTS_DIR.exists():
        return jsonify(ok=False, error="data/character_tidy not found"), 404
    return send_from_directory(gs.CONTRACTS_DIR, filename)


@app.route("/artifacts/<path:filename>")
def artifact_files(filename: str):
    artifacts_root = ARTIFACTS_DIR.resolve()
    candidate = (artifacts_root / Path(filename)).resolve()
    try:
        candidate.relative_to(artifacts_root)
    except ValueError:
        return jsonify(ok=False, error="invalid artifact path"), 400

    if not candidate.exists() or not candidate.is_file():
        return jsonify(ok=False, error="artifact not found"), 404

    return send_from_directory(artifacts_root, filename)


# ---------------------------------------------------------------------------
# PDF import
# ---------------------------------------------------------------------------

@app.route("/api/character-sheets", methods=["GET"])
def character_sheets_api():
    return jsonify(ok=True, sheets=_discover_selectable_character_sheets())

@app.route("/api/import-pdf", methods=["POST"])
def import_pdf_api():
    try:
        pdf_file = request.files.get("pdf")
        if not pdf_file or not pdf_file.filename:
            return jsonify(ok=False, error="missing pdf file"), 400
        if not pdf_file.filename.lower().endswith(".pdf"):
            return jsonify(ok=False, error="file must be a .pdf"), 400
        gs.UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        filename = secure_filename(pdf_file.filename)
        source_path = gs.UPLOADS_DIR / filename
        pdf_file.save(source_path)
        job_id = _start_pdf_import_job(source_path)
        return jsonify(ok=True, async_job=True, job_id=job_id, source_file=source_path.name, status="queued"), 202
    except Exception as exc:
        print(f"[PDF IMPORT ERROR] {type(exc).__name__}: {exc}", flush=True)
        return jsonify(ok=False, error="pdf-import-failed", detail=type(exc).__name__), 500


@app.route("/api/import-pdf-status/<job_id>", methods=["GET"])
def import_pdf_status_api(job_id: str):
    token = str(job_id or "").strip().lower()
    if not token:
        return jsonify(ok=False, error="missing-job-id"), 400

    with PDF_IMPORT_JOBS_LOCK:
        job = PDF_IMPORT_JOBS.get(token)
        if not isinstance(job, dict):
            return jsonify(ok=False, error="job-not-found"), 404
        status = str(job.get("status") or "unknown")
        source_file = str(job.get("source_file") or "")
        if status in ("queued", "running"):
            return jsonify(ok=True, done=False, status=status, job_id=token, source_file=source_file)
        if status == "completed":
            return jsonify(
                ok=True,
                done=True,
                status="completed",
                job_id=token,
                source_file=source_file,
                result=job.get("result") or {},
            )
        return jsonify(
            ok=False,
            done=True,
            status="failed",
            job_id=token,
            source_file=source_file,
            error=str(job.get("error") or "pdf-import-failed"),
            detail=str(job.get("detail") or "unknown"),
        ), 500


@app.route("/api/import-character-sheet", methods=["POST"])
def import_character_sheet_api():
    try:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            payload = request.form.to_dict(flat=True)
        sheet_id = str(payload.get("sheetId") or payload.get("sheet") or "").strip()
        if not sheet_id:
            return jsonify(ok=False, error="missing sheetId"), 400
        source_path = _resolve_selectable_pdf(sheet_id)
        if source_path is None:
            return jsonify(ok=False, error="character sheet not found"), 404
        return jsonify(_import_pdf_to_contracts(source_path))
    except Exception as exc:
        print(f"[CHARACTER SHEET IMPORT ERROR] {type(exc).__name__}: {exc}", flush=True)
        return jsonify(ok=False, error="character-sheet-import-failed", detail=type(exc).__name__), 500


@app.route("/api/player-info")
def player_info_api():
    p = _resolve_contract("character_master.json")
    if not p:
        return jsonify(ok=False, error="character_master.json not found"), 404
    master = json.loads(p.read_text(encoding="utf-8"))
    identity = master.get("identity", {})
    core = master.get("core_stats", {})
    hp = master.get("hit_points", {})
    max_hp = hp.get("max_hp")
    in_combat = bool(gs.world_state.get("combat", {}).get("state", {}).get("inCombat"))
    try:
        parsed_current_hp = int(hp.get("current_hp"))
    except (TypeError, ValueError):
        parsed_current_hp = max_hp
    # New/initial character loads should start at full health unless combat is active.
    current_hp = parsed_current_hp if in_combat else max_hp
    return jsonify(
        ok=True,
        summary={
            "name": identity.get("character_name"),
            "class_level": identity.get("class_level"),
            "species": identity.get("species"),
            "background": identity.get("background"),
            "armor_class": core.get("armor_class"),
            "max_hp": max_hp,
            "current_hp": current_hp,
            "speed_ft": core.get("speed_ft"),
            "proficiency_bonus": core.get("proficiency_bonus"),
            "initiative_bonus": core.get("initiative_bonus"),
        },
        master=master,
    )


@app.route("/api/character-models", methods=["GET"])
def character_models_api():
    return jsonify(ok=True, models=_discover_available_glb_models())


# ---------------------------------------------------------------------------
# Model upload
# ---------------------------------------------------------------------------

@app.route("/api/upload-character-model", methods=["POST"])
def upload_character_model_api():
    files = [f for f in request.files.getlist("model_files") if f and f.filename]
    single = request.files.get("model")
    if not files and single and single.filename:
        files = [single]
    if not files:
        return jsonify(ok=False, error="missing model file(s)"), 400
    gs.CHARACTER_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    bundle_id = uuid4().hex
    bundle_dir = gs.CHARACTER_MODELS_DIR / bundle_id
    bundle_dir.mkdir(parents=True, exist_ok=True)
    saved: list[str] = []
    entry_name_map: dict[str, str] = {}
    for uploaded in files:
        raw_name = str(uploaded.filename or "").strip()
        relative_path = _sanitize_model_upload_relative_path(raw_name)
        if relative_path is None:
            continue
        data = uploaded.read()
        if not data:
            continue
        target_path = _dedupe_upload_target(bundle_dir, relative_path)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_bytes(data)
        saved_rel = target_path.relative_to(bundle_dir).as_posix()
        saved.append(saved_rel)
        original_rel = relative_path.as_posix()
        entry_name_map[original_rel] = saved_rel
        entry_name_map[Path(original_rel).name] = saved_rel
    if not saved:
        return jsonify(ok=False, error="no valid files uploaded"), 400
    entry_name = secure_filename(request.form.get("model_entry", ""))
    requested_entry = str(request.form.get("model_entry", "")).strip().replace("\\", "/")
    entry_name = entry_name_map.get(requested_entry, entry_name_map.get(Path(requested_entry).name, requested_entry))
    if not entry_name or entry_name not in saved:
        glbs = sorted((n for n in saved if n.lower().endswith(".glb")), key=lambda value: (value.count("/"), value.lower()))
        gltfs = sorted((n for n in saved if n.lower().endswith(".gltf")), key=lambda value: (value.count("/"), value.lower()))
        fbxs = sorted((n for n in saved if n.lower().endswith(".fbx")), key=lambda value: (value.count("/"), value.lower()))
        entry_name = (glbs or gltfs or fbxs or [""])[0]
    if not entry_name or not entry_name.lower().endswith((".glb", ".gltf", ".fbx")):
        return jsonify(ok=False, error="primary model must be .glb, .gltf, or .fbx"), 400
    return jsonify(
        ok=True,
        model_url=f"/static/user_models/{bundle_id}/{entry_name}",
        file_name=entry_name,
        uploaded_files=saved,
    )


# ---------------------------------------------------------------------------
# Debug / info endpoints
# ---------------------------------------------------------------------------

@app.route("/lobby_state", methods=["GET"])
def lobby_state_api():
    return jsonify(ok=True, lobby=gs.build_lobby_state())


@app.route("/debug/combat", methods=["GET"])
def debug_combat_api():
    return jsonify(ok=True, combat=gs.world_state.get("combat", {}))


@app.route("/server-build", methods=["GET"])
def server_build_api():
    return jsonify(
        ok=True,
        build=gs.SERVER_BUILD_TAG,
        pid=os.getpid(),
        async_mode="gevent",
    )
