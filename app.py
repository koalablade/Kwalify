"""
app.py — Render production safe entrypoint
"""

import os
from flask import Flask, jsonify, request

from cache import (
    get_sync_status,
    load_user_tracks,
    start_sync_if_needed,
)

from database import SessionLocal, init_db


app = Flask(__name__)


# =========================
# INIT DB ON START
# =========================
with app.app_context():
    init_db()


# =========================
# DB HELP
# =========================
def get_db():
    return SessionLocal()


# =========================
# ROUTES
# =========================

@app.route("/")
def home():
    return jsonify({
        "status": "ok",
        "service": "Kwalify running"
    })


@app.route("/cache-status")
def cache_status():
    user_id = request.args.get("user_id", "demo")

    db = get_db()
    try:
        return jsonify(get_sync_status(user_id, db))
    finally:
        db.close()


@app.route("/tracks")
def tracks():
    user_id = request.args.get("user_id", "demo")

    db = get_db()
    try:
        return jsonify(load_user_tracks(user_id, db))
    finally:
        db.close()


@app.route("/sync")
def sync():
    user_id = request.args.get("user_id", "demo")

    def db_factory():
        return SessionLocal()

    start_sync_if_needed(user_id, None, db_factory)

    return jsonify({"status": "sync_started"})


# =========================
# LOCAL DEV ONLY
# =========================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)
