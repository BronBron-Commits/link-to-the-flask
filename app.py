from flask import Flask, request, jsonify, render_template

app = Flask(__name__)

player = {"x": 0, "y": 0}

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/move", methods=["POST"])
def move():
    data = request.get_json()
    player["x"] += int(data.get("x",0))
    player["y"] += int(data.get("y",0))
    return jsonify(ok=True)

@app.route("/state")
def state():
    return jsonify(player)

app.run(host="0.0.0.0", port=5000, debug=True)
