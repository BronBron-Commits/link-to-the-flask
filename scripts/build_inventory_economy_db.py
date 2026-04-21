"""Audit inventory extraction for all static PDFs and build an economy database.

Usage:
  python scripts/build_inventory_economy_db.py
  python scripts/build_inventory_economy_db.py --pdf-dir static --db-path data/economy/economy_overview.sqlite
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts import pdf_to_tidy_data


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit PDF inventories and build an economy SQLite DB")
    parser.add_argument("--pdf-dir", default="static", help="Directory containing player PDFs")
    parser.add_argument(
        "--db-path",
        default="data/economy/economy_overview.sqlite",
        help="Output SQLite path",
    )
    parser.add_argument(
        "--summary-path",
        default="data/economy/economy_summary.json",
        help="Output JSON summary path",
    )
    return parser.parse_args()


def to_int(value, default=0) -> int:
    if value is None:
        return default
    try:
        return int(value)
    except Exception:
        return default


def parse_weight_lb(value) -> int | None:
    if value is None:
        return None
    if isinstance(value, int):
        return value
    text = str(value)
    digits = "".join(ch for ch in text if ch.isdigit())
    return int(digits) if digits else None


def currency_total_cp(currency: dict) -> int:
    cp = to_int(currency.get("cp"), 0)
    sp = to_int(currency.get("sp"), 0)
    ep = to_int(currency.get("ep"), 0)
    gp = to_int(currency.get("gp"), 0)
    pp = to_int(currency.get("pp"), 0)
    return cp + (sp * 10) + (ep * 50) + (gp * 100) + (pp * 1000)


def build_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA foreign_keys = ON;

        DROP VIEW IF EXISTS stakeholder_economy_view;
        DROP VIEW IF EXISTS economy_totals_view;

        DROP TABLE IF EXISTS parse_failures;
        DROP TABLE IF EXISTS audit_results;
        DROP TABLE IF EXISTS inventory_items;
        DROP TABLE IF EXISTS currency_balances;
        DROP TABLE IF EXISTS stakeholders;

        CREATE TABLE stakeholders (
            stakeholder_id INTEGER PRIMARY KEY AUTOINCREMENT,
            character_id TEXT,
            stakeholder_name TEXT NOT NULL,
            source_pdf TEXT NOT NULL,
            class_level TEXT,
            species TEXT,
            level INTEGER
        );

        CREATE TABLE currency_balances (
            stakeholder_id INTEGER PRIMARY KEY,
            cp INTEGER,
            sp INTEGER,
            ep INTEGER,
            gp INTEGER,
            pp INTEGER,
            total_cp INTEGER NOT NULL,
            FOREIGN KEY (stakeholder_id) REFERENCES stakeholders(stakeholder_id) ON DELETE CASCADE
        );

        CREATE TABLE inventory_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stakeholder_id INTEGER NOT NULL,
            item_name TEXT NOT NULL,
            quantity INTEGER,
            weight_lb INTEGER,
            weight_raw TEXT,
            equipped INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (stakeholder_id) REFERENCES stakeholders(stakeholder_id) ON DELETE CASCADE
        );

        CREATE TABLE audit_results (
            stakeholder_id INTEGER PRIMARY KEY,
            inventory_item_count INTEGER NOT NULL,
            has_any_currency INTEGER NOT NULL,
            issues_json TEXT NOT NULL,
            FOREIGN KEY (stakeholder_id) REFERENCES stakeholders(stakeholder_id) ON DELETE CASCADE
        );

        CREATE TABLE parse_failures (
            source_pdf TEXT PRIMARY KEY,
            error_text TEXT NOT NULL
        );

        CREATE VIEW stakeholder_economy_view AS
        SELECT
            s.stakeholder_id,
            s.stakeholder_name,
            s.source_pdf,
            s.class_level,
            s.species,
            s.level,
            c.cp,
            c.sp,
            c.ep,
            c.gp,
            c.pp,
            c.total_cp,
            a.inventory_item_count,
            a.has_any_currency,
            a.issues_json
        FROM stakeholders s
        LEFT JOIN currency_balances c ON c.stakeholder_id = s.stakeholder_id
        LEFT JOIN audit_results a ON a.stakeholder_id = s.stakeholder_id;

        CREATE VIEW economy_totals_view AS
        SELECT
            COUNT(*) AS stakeholder_count,
            COALESCE(SUM(cp), 0) AS total_cp,
            COALESCE(SUM(sp), 0) AS total_sp,
            COALESCE(SUM(ep), 0) AS total_ep,
            COALESCE(SUM(gp), 0) AS total_gp,
            COALESCE(SUM(pp), 0) AS total_pp,
            COALESCE(SUM(total_cp), 0) AS economy_total_cp
        FROM currency_balances;
        """
    )


def main() -> int:
    args = parse_args()
    pdf_dir = Path(args.pdf_dir)
    db_path = Path(args.db_path)
    summary_path = Path(args.summary_path)

    pdf_paths = sorted(pdf_dir.glob("*.pdf"))
    if not pdf_paths:
        print(f"No PDFs found in {pdf_dir}")
        return 1

    db_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path))
    try:
        build_schema(conn)

        processed = 0
        failed = 0

        for pdf_path in pdf_paths:
            try:
                tables = pdf_to_tidy_data.parse_character_tables(pdf_path)
                master = pdf_to_tidy_data.build_master_character_record(tables)
            except Exception as exc:
                failed += 1
                conn.execute(
                    "INSERT OR REPLACE INTO parse_failures (source_pdf, error_text) VALUES (?, ?)",
                    (str(pdf_path.name), str(exc)),
                )
                continue

            processed += 1

            source = master.get("source", {})
            identity = master.get("identity", {})
            inventory = master.get("inventory", {})
            currency = inventory.get("currency", {}) or {}
            items = inventory.get("items", []) or []

            stakeholder_name = str(identity.get("character_name") or pdf_path.stem)
            row = conn.execute(
                """
                INSERT INTO stakeholders (character_id, stakeholder_name, source_pdf, class_level, species, level)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    source.get("character_id"),
                    stakeholder_name,
                    str(pdf_path.name),
                    identity.get("class_level"),
                    identity.get("species"),
                    identity.get("level"),
                ),
            )
            stakeholder_id = row.lastrowid

            cp = to_int(currency.get("cp"), 0)
            sp = to_int(currency.get("sp"), 0)
            ep = to_int(currency.get("ep"), 0)
            gp = to_int(currency.get("gp"), 0)
            pp = to_int(currency.get("pp"), 0)
            total_cp = currency_total_cp(currency)

            conn.execute(
                """
                INSERT INTO currency_balances (stakeholder_id, cp, sp, ep, gp, pp, total_cp)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (stakeholder_id, cp, sp, ep, gp, pp, total_cp),
            )

            issues: list[str] = []
            if not items:
                issues.append("no_inventory_items_parsed")
            if all(currency.get(k) is None for k in ("cp", "sp", "ep", "gp", "pp")):
                # Keep an audit trace while still normalizing to 0 for economy totals.
                issues.append("no_currency_parsed_defaulted_to_zero")

            for item in items:
                item_name = str(item.get("name") or "Unknown Item")
                quantity = item.get("quantity")
                weight_raw = item.get("weight")
                weight_lb = parse_weight_lb(weight_raw)
                equipped = 1 if bool(item.get("equipped")) else 0

                if quantity is None:
                    issues.append(f"item_missing_quantity:{item_name}")
                elif to_int(quantity, -1) < 0:
                    issues.append(f"item_negative_quantity:{item_name}")

                conn.execute(
                    """
                    INSERT INTO inventory_items (stakeholder_id, item_name, quantity, weight_lb, weight_raw, equipped)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (stakeholder_id, item_name, quantity, weight_lb, str(weight_raw) if weight_raw is not None else None, equipped),
                )

            conn.execute(
                """
                INSERT INTO audit_results (stakeholder_id, inventory_item_count, has_any_currency, issues_json)
                VALUES (?, ?, ?, ?)
                """,
                (
                    stakeholder_id,
                    len(items),
                    1,
                    json.dumps(sorted(set(issues))),
                ),
            )

        conn.commit()

        totals = conn.execute(
            """
            SELECT stakeholder_count, total_cp, total_sp, total_ep, total_gp, total_pp, economy_total_cp
            FROM economy_totals_view
            """
        ).fetchone()

        issue_rows = conn.execute(
            """
            SELECT s.stakeholder_name, s.source_pdf, a.issues_json
            FROM audit_results a
            JOIN stakeholders s ON s.stakeholder_id = a.stakeholder_id
            WHERE a.issues_json != '[]'
            ORDER BY s.stakeholder_name
            """
        ).fetchall()

        summary = {
            "pdf_dir": str(pdf_dir),
            "db_path": str(db_path),
            "processed_pdf_count": processed,
            "failed_pdf_count": failed,
            "economy_totals": {
                "stakeholder_count": totals[0] if totals else 0,
                "cp": totals[1] if totals else 0,
                "sp": totals[2] if totals else 0,
                "ep": totals[3] if totals else 0,
                "gp": totals[4] if totals else 0,
                "pp": totals[5] if totals else 0,
                "total_cp": totals[6] if totals else 0,
            },
            "stakeholders_with_issues": [
                {
                    "stakeholder_name": row[0],
                    "source_pdf": row[1],
                    "issues": json.loads(row[2]),
                }
                for row in issue_rows
            ],
        }

        summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

        print(f"Parsed PDFs: {processed}, failures: {failed}")
        print(f"DB: {db_path}")
        print(f"Summary: {summary_path}")
        print(
            "Economy totals: "
            f"CP={summary['economy_totals']['cp']} "
            f"SP={summary['economy_totals']['sp']} "
            f"EP={summary['economy_totals']['ep']} "
            f"GP={summary['economy_totals']['gp']} "
            f"PP={summary['economy_totals']['pp']} "
            f"(total_cp={summary['economy_totals']['total_cp']})"
        )
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
