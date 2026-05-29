"""
app.py — V2 Production Entry (Render + Gunicorn Safe)
"""

import os
from flask import Flask, jsonify, request, render_template, redirect, session

from database import init_db, get_session
from cache import get_sync_status, load_user_tracks, start_sync_if_needed
from auth import spotify_oauth, get_spotify_client


def create_app():
    app = Flask(__name__)
    app.secret_key = os.getenv("FLASK_SECRET_KEY", "kwalify-dev-secret-change-in-prod")

    # =========================
    # INIT DB ON STARTUP
    # =========================
    init_db()

    # =========================
    # ROUTES
    # =========================

    @app.get("/")
    def home():
        return render_template("index.html")

    @app.get("/api/status")
    def api_status():
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

    # =========================
    # AUTH ROUTES
    # =========================

    @app.get("/login")
    def login():
        auth = spotify_oauth()
        auth_url = auth.get_authorize_url()
        return redirect(auth_url)

    @app.get("/callback")
    def callback():
        auth = spotify_oauth()
        code = request.args.get("code")
        error = request.args.get("error")

        if error:
            return jsonify({"error": error}), 400

        token_info = auth.get_access_token(code, as_dict=True)
        session["token_info"] = token_info

        return redirect("/")

    @app.get("/logout")
    def logout():
        session.clear()
        return redirect("/")

    @app.get("/api/me")
    def me():
        sp = get_spotify_client()
        if not sp:
            return jsonify({"authenticated": False}), 401
        user = sp.current_user()
        return jsonify({"authenticated": True, "user": user})

    return app


app = create_app()

# IMPORTANT: Render uses gunicorn ONLY
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
