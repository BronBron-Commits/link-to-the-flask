from flask import Flask, render_template, jsonify, request
import random

app = Flask(__name__)

# Game state
players = {}
world = {
    "map": [[0]*10 for _ in range(10)],  # 10x10 grid
    "enemies": []
}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/join', methods=['POST'])
def join_game():
    player_name = request.json.get('name')
    if player_name:
        players[player_name] = {"x": 0, "y": 0, "health": 10, "inventory": []}
        return jsonify({"status": "joined", "player": player_name})
    return jsonify({"status": "error"}), 400

@app.route('/move/<player_name>', methods=['POST'])
def move(player_name):
    if player_name not in players:
        return jsonify({"status": "error"}), 404
    direction = request.json.get('direction')
    x, y = players[player_name]["x"], players[player_name]["y"]
    if direction == "up" and y > 0:
        players[player_name]["y"] -= 1
    elif direction == "down" and y < 9:
        players[player_name]["y"] += 1
    elif direction == "left" and x > 0:
        players[player_name]["x"] -= 1
    elif direction == "right" and x < 9:
        players[player_name]["x"] += 1
    return jsonify(players[player_name])

@app.route('/world')
def get_world():
    return jsonify(world)

@app.route('/players')
def get_players():
    return jsonify(players)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
