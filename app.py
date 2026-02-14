from flask import Flask, jsonify, request
import subprocess
import threading

app = Flask(__name__)

# Engine state (x, y)
engine_pos = {"x": 0, "y": 0}

lock = threading.Lock()

@app.route("/")
def index():
    return """
    <h1>Engine Control</h1>
    <p>Use buttons or WASD keys to move:</p>
    <button onclick="move('w')">W</button>
    <button onclick="move('a')">A</button>
    <button onclick="move('s')">S</button>
    <button onclick="move('d')">D</button>
    <pre id="grid"></pre>
    <script>
    function move(dir){
        fetch('/move?dir=' + dir)
        .then(resp => resp.json())
        .then(data => { document.getElementById('grid').innerText = data.grid })
    }
    window.onload = () => { fetch('/grid').then(r => r.json()).then(d => document.getElementById('grid').innerText = d.grid) }
    </script>
    """

def render_grid():
    w, h = 5, 5
    lines = []
    for y in reversed(range(h)):
        line = ""
        for x in range(w):
            if x == engine_pos["x"] and y == engine_pos["y"]:
                line += "@ "
            else:
                line += ". "
        lines.append(line)
    return "\n".join(lines)

@app.route("/grid")
def grid():
    with lock:
        return jsonify({"grid": render_grid()})

@app.route("/move")
def move():
    dir = request.args.get("dir", "")
    with lock:
        if dir == "w": engine_pos["y"] += 1
        if dir == "s": engine_pos["y"] -= 1
        if dir == "a": engine_pos["x"] -= 1
        if dir == "d": engine_pos["x"] += 1
        # Keep in bounds
        engine_pos["x"] = max(0, min(4, engine_pos["x"]))
        engine_pos["y"] = max(0, min(4, engine_pos["y"]))
        grid_str = render_grid()
    return jsonify({"grid": grid_str})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
