from flask import Flask, jsonify, render_template_string, send_from_directory
import subprocess
import os

app = Flask(__name__, static_folder="app/static", template_folder="app/templates")

# ---------- Home page ----------
@app.route("/")
def index():
    return render_template_string("""
    <h1>Flask Game Engine Control</h1>
    <p><a href="/build-engine">Build Engine</a></p>
    <p><a href="/engine-files">View Engine Files</a></p>
    <p><a href="/run-engine">Run Engine</a></p>
    """)

# ---------- Build engine ----------
@app.route("/build-engine")
def build_engine():
    script = os.path.join("scripts", "build_engine.sh")
    if os.path.exists(script):
        subprocess.run(["bash", script])
        return jsonify({"status": "engine built"})
    return jsonify({"error": "build script missing"}), 404

# ---------- List engine output ----------
@app.route("/engine-files")
def engine_files():
    base = os.path.join("app", "static", "engine")
    if not os.path.exists(base):
        return jsonify({"files": []})
    files = []
    for root, _, filenames in os.walk(base):
        for f in filenames:
            files.append(os.path.relpath(os.path.join(root, f), base))
    return jsonify({"files": files})

# ---------- Run engine ----------
@app.route("/run-engine")
def run_engine():
    engine_path = os.path.join("engine", "build", "engine")
    if not os.path.exists(engine_path):
        return "Engine binary not found. Build it first.", 404
    proc = subprocess.Popen([engine_path],
                            stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT,
                            text=True)
    output = proc.communicate()[0]
    return "<pre>" + output + "</pre>"

# ---------- Serve engine files manually if needed ----------
@app.route("/engine/<path:filename>")
def serve_engine_file(filename):
    return send_from_directory("app/static/engine", filename)

# ---------- Run server ----------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
