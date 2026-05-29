"""
app.py — V2 Production Entry (Render + Gunicorn Safe)
"""

import os
from flask import Flask, jsonify, request

from database import init_db, get_session
from cache import get_sync_status, load_user_tracks, start_sync_if_needed


def create_app():
    app = Flask(__name__)

    # =========================
    # INIT DB ON STARTUP
    # =========================
    init_db()

    # =========================
    # ROUTES
    # =========================

    @app.get("/")
    def home():
        return jsonify({
            "status": "ok",
            "version": "v2",
            "service": "Kwalify AI Engine"
        })

    @app.get("/cache-status")
    def cache_status():
        user_id = request.args.get("user_id", "demo")

        with get_session() as db:
            return jsonify(get_sync_status(user_id, db))

    @app.get("/tracks")
    def tracks():
        user_id = request.args.get("user_id", "demo")

        with get_session() as db:
            return jsonify(load_user_tracks(user_id, db))

    @app.get("/sync")
    def sync():
        user_id = request.args.get("user_id", "demo")

        start_sync_if_needed(user_id, sp=None)

        return jsonify({
            "status": "sync_started",
            "user": user_id
        })

    return app


app = create_app()

# IMPORTANT: Render uses gunicorn ONLY
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)
