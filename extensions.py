"""
EXTENSIONS — Flask app and SocketIO instance.

Imported by every module that needs app or socketio.
Created here to avoid circular imports.
"""
import os
from flask import Flask
from flask_socketio import SocketIO
from werkzeug.middleware.proxy_fix import ProxyFix

app = Flask(
    __name__,
    root_path=os.path.dirname(os.path.abspath(__file__)),
)
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

app.config.update(
    SECRET_KEY=os.environ.get("FLASK_SECRET_KEY") or os.environ.get("SECRET_KEY") or "dev-insecure-change-me",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("FLASK_SESSION_COOKIE_SECURE", "true").lower() == "true",
)
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="gevent",
    ping_timeout=60,
    ping_interval=25,
)
