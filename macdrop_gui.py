import webview
import threading
import socket
import qrcode
from flask import Flask, request, jsonify, send_from_directory
import os

app = Flask(__name__, static_folder=None)

UPLOAD_FOLDER = "uploads"
SHARED_FOLDER = "shared"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(SHARED_FOLDER, exist_ok=True)


def get_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip


local_ip = get_ip()


@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/style.css")
def serve_css():
    return send_from_directory(".", "style.css")


@app.route("/app.js")
def serve_js():
    return send_from_directory(".", "app.js")


@app.route("/api/config")
def get_config():
    return jsonify({
        "ip": local_ip,
        "port": 5000,
        "isLocal": True
    })


@app.route("/upload", methods=["POST"])
def upload():
    if "file" not in request.files:
        return "No file part", 400
    file = request.files["file"]
    if file.filename == "":
        return "No selected file", 400

    filepath = os.path.join(UPLOAD_FOLDER, file.filename)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    file.save(filepath)
    return "ok"


@app.route("/share", methods=["POST"])
def share():
    if "file" not in request.files:
        return "No file part", 400
    file = request.files["file"]
    if file.filename == "":
        return "No selected file", 400

    filepath = os.path.join(SHARED_FOLDER, file.filename)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    file.save(filepath)
    return "ok"


@app.route("/api/files")
def list_files():
    files = []
    if os.path.exists(UPLOAD_FOLDER):
        for name in os.listdir(UPLOAD_FOLDER):
            path = os.path.join(UPLOAD_FOLDER, name)
            if os.path.isfile(path):
                stat = os.stat(path)
                files.append({
                    "name": name,
                    "size": stat.st_size,
                    "modified": stat.st_mtime
                })
    # Sort by modification time desc
    files.sort(key=lambda x: x["modified"], reverse=True)
    return jsonify(files)


@app.route("/api/shared")
def list_shared():
    files = []
    if os.path.exists(SHARED_FOLDER):
        for name in os.listdir(SHARED_FOLDER):
            path = os.path.join(SHARED_FOLDER, name)
            if os.path.isfile(path):
                stat = os.stat(path)
                files.append({
                    "name": name,
                    "size": stat.st_size,
                    "modified": stat.st_mtime
                })
    # Sort by modification time desc
    files.sort(key=lambda x: x["modified"], reverse=True)
    return jsonify(files)


@app.route("/shared/<path:filename>")
def download_shared(filename):
    return send_from_directory(SHARED_FOLDER, filename, as_attachment=True)


def start_server():
    app.run(host="0.0.0.0", port=5000, threaded=True)


if __name__ == "__main__":
    ip = get_ip()
    url = f"http://{ip}:5000"

    img = qrcode.make(url)
    img.save("qr.png")
    print("QR code saved as qr.png")

    threading.Thread(target=start_server, daemon=True).start()

    webview.create_window("MacDrop", url)
    webview.start()


