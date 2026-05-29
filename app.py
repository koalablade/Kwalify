"""
app.py — Flask entry point (RENDER SAFE FIXED)
"""

import os
from flask import Flask, jsonify, request

from cache import (
    get_or_create_user,
    get_sync_status,
    load_user_tracks,
    start_sync_if_needed,
)

from database import SessionLocal


app = Flask(__name__)


# =========================================================
# DB helper
# =========================================================

def get_db():
    return SessionLocal()


# =========================================================
# ROUTES
# =========================================================

@app.route("/")
def home():
    return jsonify({"status": "ok", "service": "Kwalify running"})


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

    sp = None  # keep your spotify client here if needed

    def db_factory():
        return SessionLocal()

    start_sync_if_needed(user_id, sp, db_factory)

    return jsonify({"status": "sync_started"})


# =========================================================
# RENDER ENTRYPOINT (THIS FIXES YOUR ERROR)
# =========================================================

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)
