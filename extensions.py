"""
EXTENSIONS — Flask app and SocketIO instance.

Imported by every module that needs app or socketio.
Created here to avoid circular imports.
"""
import os
from flask import Flask
from flask_socketio import SocketIO

app = Flask(
    __name__,
    root_path=os.path.dirname(os.path.abspath(__file__)),
)
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="gevent",
    ping_timeout=60,
    ping_interval=25,
)
