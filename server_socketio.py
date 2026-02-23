
# Plain WebSocket server for multiplayer sync
from flask import Flask, render_template
from flask_sockets import Sockets
import json

app = Flask(__name__)
sockets = Sockets(app)

clients = set()

@app.route("/")
def index():
    return render_template("index.html")

@sockets.route('/ws')
def ws_socket(ws):
    clients.add(ws)
    try:
        while not ws.closed:
            message = ws.receive()
            if message:
                # Broadcast to all other clients
                for client in clients:
                    if client != ws and not client.closed:
                        client.send(message)
    finally:
        clients.remove(ws)

if __name__ == "__main__":
    from gevent import pywsgi
    from geventwebsocket.handler import WebSocketHandler
    server = pywsgi.WSGIServer(('0.0.0.0', 5000), app, handler_class=WebSocketHandler)
    server.serve_forever()
