"""
app.py — V2 Production Entry (Render + Gunicorn Safe)
"""

import json
import os

from flask import Flask, jsonify, request, render_template, redirect, session

from database import init_db, get_db, get_session
from cache import get_sync_status, load_user_tracks, start_sync_if_needed
from auth import spotify_oauth, get_spotify_client
from models import User
from vibe_engine import interpret_vibe, track_vector, hybrid_score, get_emotion, apply_repeat_penalty
from memory import log_track_interaction, get_user_history


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
        if session.get("token_info"):
            return redirect("/generator")
        return redirect("/login")

    @app.get("/generator")
    def generator():
        if not session.get("token_info"):
            return redirect("/login")
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
        spotify_user_id = session.get("spotify_user_id")
        if not spotify_user_id:
            return jsonify({"status": "not_authenticated"}), 401

        with get_session() as db:
            return jsonify(get_sync_status(spotify_user_id, db))

    @app.get("/tracks")
    def tracks():
        spotify_user_id = session.get("spotify_user_id")
        if not spotify_user_id:
            return jsonify({"error": "not_authenticated"}), 401

        with get_session() as db:
            track_objs = load_user_tracks(spotify_user_id, db)
            return jsonify([
                {"id": t.spotify_id, "name": t.name, "artist": t.artist,
                 "energy": t.energy, "valence": t.valence}
                for t in track_objs
            ])

    @app.get("/sync")
    def sync():
        spotify_user_id = session.get("spotify_user_id")
        if not spotify_user_id:
            return jsonify({"error": "not_authenticated"}), 401

        sp = get_spotify_client()
        start_sync_if_needed(spotify_user_id, sp=sp)

        return jsonify({
            "status": "sync_started",
            "user": spotify_user_id
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

        # Upsert user in DB so /generate and sync can find them
        sp = get_spotify_client()
        if sp:
            try:
                spotify_user = sp.current_user()
                db = get_db()
                try:
                    user = db.query(User).filter_by(spotify_id=spotify_user["id"]).first()
                    if not user:
                        user = User(spotify_id=spotify_user["id"])
                        db.add(user)
                    user.display_name = spotify_user.get("display_name")
                    user.token_json = json.dumps(token_info)
                    db.commit()
                    session["spotify_user_id"] = spotify_user["id"]
                finally:
                    db.close()
            except Exception:
                pass

        # Kick off background sync immediately after login
        if spotify_user_id := session.get("spotify_user_id"):
            sp_for_sync = get_spotify_client()
            start_sync_if_needed(spotify_user_id, sp=sp_for_sync)

        return redirect("/generator")

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

    # =========================
    # GENERATE ROUTE
    # =========================

    @app.post("/generate")
    def generate():
        sp = get_spotify_client()
        if not sp:
            return jsonify({"error": "not_authenticated"}), 401

        vibe_text = (request.json or {}).get("vibe", "")
        if not vibe_text:
            return jsonify({"error": "vibe text required"}), 400

        spotify_user_id = session.get("spotify_user_id")
        if not spotify_user_id:
            try:
                spotify_user_id = sp.current_user()["id"]
                session["spotify_user_id"] = spotify_user_id
            except Exception:
                return jsonify({"error": "could not resolve user"}), 500

        db = get_db()
        try:
            user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
            if not user:
                return jsonify({"error": "user not synced yet — try /sync first"}), 404

            tracks = load_user_tracks(spotify_user_id, db)
            if not tracks:
                return jsonify({"error": "no tracks synced yet — try /sync first"}), 404

            vibe_vec = interpret_vibe(vibe_text)
            history = get_user_history(user.id, db)

            scored = []
            for t in tracks:
                t_vec = track_vector(t)
                emotion = get_emotion(t_vec)
                score = hybrid_score(vibe_vec, t_vec, t, emotion)
                score = apply_repeat_penalty(history, t.spotify_id, score)
                log_track_interaction(user.id, t.spotify_id, emotion, score, db)
                scored.append((score, t))

            scored.sort(reverse=True, key=lambda x: x[0])

            return jsonify({
                "tracks": [
                    {"name": t.name, "artist": t.artist, "id": t.spotify_id}
                    for _, t in scored[:25]
                ]
            })
        finally:
            db.close()

    return app


app = create_app()

# IMPORTANT: Render uses gunicorn ONLY
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
