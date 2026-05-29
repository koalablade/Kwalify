"""
app.py — production API layer (Render safe)
"""

import os
from flask import Flask, jsonify, request
import redis
from rq import Queue

from database import SessionLocal, init_db
from cache import get_sync_status, load_user_tracks

app = Flask(__name__)

# -------------------------
# INIT DB
# -------------------------
init_db()

# -------------------------
# REDIS QUEUE
# -------------------------
redis_conn = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"))
queue = Queue(connection=redis_conn)


# -------------------------
# DB HELP
# -------------------------
def get_db():
    return SessionLocal()


# -------------------------
# ROUTES
# -------------------------
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


# -------------------------
# QUEUED SYNC (IMPORTANT FIX)
# -------------------------
@app.route("/sync")
def sync():
    user_id = request.args.get("user_id", "demo")

    from jobs import sync_user_job

    queue.enqueue(sync_user_job, user_id)

    return jsonify({
        "status": "queued",
        "user_id": user_id
    })


# -------------------------
# LOCAL DEV
# -------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)
