```python
"""
app.py — V2 Production Entry (Render + Gunicorn Safe)
FIXED VERSION

WHAT CHANGED:
- FIXED missing generator page after Spotify login
- Added proper logged_in detection for index.html
- Preserved ALL existing routes/features
- Preserved cinematic UI flow
- Preserved OAuth/session handling

ROOT CAUSE:
Your index.html contains:

    {% if logged_in %}

But the backend never passed logged_in=True,
so the app ALWAYS rendered the landing page
instead of the AI DJ generator UI.
"""

import json
import os

from flask import Flask, jsonify, request, render_template, redirect, session

from database import init_db, get_db, get_session
from cache import get_sync_status, load_user_tracks, start_sync_if_needed
from auth import spotify_oauth, get_spotify_client
from models import User
from vibe_engine import (
    interpret_vibe,
    track_vector,
    hybrid_score,
    get_emotion,
    apply_repeat_penalty,
)
from memory import log_track_interaction, get_user_history


def create_app():
    app = Flask(__name__)

    app.secret_key = os.getenv(
        "FLASK_SECRET_KEY",
        "kwalify-dev-secret-change-in-prod"
    )

    # =========================
    # INIT DB ON STARTUP
    # =========================

    init_db()

    # =========================
    # HOME ROUTE
    # =========================

    @app.get("/")
    def home():
        """
        Main page.

        IMPORTANT:
        index.html uses:

            {% if logged_in %}

        to decide whether to show:
        - landing page
        OR
        - generator UI

        Old code never passed logged_in=True,
        which made the entire generator page disappear.
        """

        logged_in = False

        try:
            sp = get_spotify_client()

            if sp:
                # Validate token/session
                sp.current_user()
                logged_in = True

        except Exception as e:
            print(f"[HOME AUTH CHECK ERROR] {e}")
            logged_in = False

        return render_template(
            "index.html",
            logged_in=logged_in
        )

    # =========================
    # API STATUS
    # =========================

    @app.get("/api/status")
    def api_status():
        return jsonify({
            "status": "ok",
            "version": "v2",
            "service": "K_WALAH Emotional DJ Engine"
        })

    # =========================
    # CACHE STATUS
    # =========================

    @app.get("/cache-status")
    def cache_status():

        spotify_user_id = session.get("spotify_user_id")

        if not spotify_user_id:
            return jsonify({
                "status": "not_logged_in"
            })

        with get_session() as db:

            try:
                user = db.query(User).filter_by(
                    spotify_id=spotify_user_id
                ).first()

                if not user:
                    return jsonify({
                        "status": "no_user"
                    })

                return jsonify(
                    get_sync_status(user.id, db)
                )

            except Exception as e:
                print(f"[CACHE STATUS ERROR] {e}")

                return jsonify({
                    "status": "error",
                    "details": str(e)
                })

    # =========================
    # TRACKS
    # =========================

    @app.get("/tracks")
    def tracks():

        spotify_user_id = session.get("spotify_user_id")

        if not spotify_user_id:
            return jsonify({
                "error": "not_logged_in"
            }), 401

        with get_session() as db:

            user = db.query(User).filter_by(
                spotify_id=spotify_user_id
            ).first()

            if not user:
                return jsonify({
                    "error": "user_not_found"
                }), 404

            return jsonify(
                load_user_tracks(user.id, db)
            )

    # =========================
    # SYNC
    # =========================

    @app.get("/sync")
    def sync():

        spotify_user_id = session.get("spotify_user_id")

        if not spotify_user_id:
            return jsonify({
                "error": "not_logged_in"
            }), 401

        try:
            start_sync_if_needed(spotify_user_id, sp=None)

            return jsonify({
                "status": "sync_started",
                "user": spotify_user_id
            })

        except Exception as e:
            print(f"[SYNC ERROR] {e}")

            return jsonify({
                "error": "sync_failed",
                "details": str(e)
            }), 500

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
            return jsonify({
                "error": error
            }), 400

        if not code:
            return jsonify({
                "error": "missing_code"
            }), 400

        try:
            token_info = auth.get_access_token(
                code,
                as_dict=True
            )

            session["token_info"] = token_info

        except Exception as e:
            print(f"[TOKEN ERROR] {e}")

            return jsonify({
                "error": "token_exchange_failed",
                "details": str(e)
            }), 500

        # =========================
        # STORE USER
        # =========================

        try:
            sp = get_spotify_client()

            if sp:

                spotify_user = sp.current_user()

                db = get_db()

                try:
                    user = db.query(User).filter_by(
                        spotify_id=spotify_user["id"]
                    ).first()

                    if not user:
                        user = User(
                            spotify_id=spotify_user["id"]
                        )

                        db.add(user)

                    user.display_name = spotify_user.get(
                        "display_name"
                    )

                    user.token_json = json.dumps(token_info)

                    db.commit()

                    session["spotify_user_id"] = spotify_user["id"]

                finally:
                    db.close()

        except Exception as e:
            print(f"[CALLBACK USER ERROR] {e}")

        # IMPORTANT:
        # Redirect back home.
        # Home route now correctly shows
        # generator UI if logged in.
        return redirect("/")

    @app.get("/logout")
    def logout():

        session.clear()

        return redirect("/")

    @app.get("/api/me")
    def me():

        sp = get_spotify_client()

        if not sp:
            return jsonify({
                "authenticated": False
            }), 401

        try:
            user = sp.current_user()

            return jsonify({
                "authenticated": True,
                "user": user
            })

        except Exception as e:
            print(f"[ME ERROR] {e}")

            return jsonify({
                "authenticated": False,
                "error": str(e)
            }), 500

    # =========================
    # GENERATE PLAYLIST
    # =========================

    @app.post("/generate")
    def generate():

        sp = get_spotify_client()

        if not sp:
            return jsonify({
                "error": "not_logged_in"
            }), 401

        body = request.json or {}

        vibe_text = body.get("vibe", "").strip()

        if not vibe_text:
            return jsonify({
                "error": "vibe text required"
            }), 400

        playlist_length = int(body.get("length", 25))
        mode = body.get("mode", "balanced")

        spotify_user_id = session.get("spotify_user_id")

        if not spotify_user_id:

            try:
                spotify_user_id = sp.current_user()["id"]

                session["spotify_user_id"] = spotify_user_id

            except Exception as e:
                print(f"[USER RESOLVE ERROR] {e}")

                return jsonify({
                    "error": "could_not_resolve_user"
                }), 500

        db = get_db()

        try:
            user = db.query(User).filter_by(
                spotify_id=spotify_user_id
            ).first()

            if not user:
                return jsonify({
                    "error": "user_not_synced"
                }), 404

            tracks = load_user_tracks(user.id, db)

            if not tracks:
                return jsonify({
                    "error": "no_tracks_available"
                }), 404

            vibe_vec = interpret_vibe(vibe_text)

            history = get_user_history(user.id, db)

            scored = []

            for t in tracks:

                try:
                    t_vec = track_vector(t)

                    emotion = get_emotion(t_vec)

                    score = hybrid_score(
                        vibe_vec,
                        t_vec,
                        t,
                        emotion
                    )

                    score = apply_repeat_penalty(
                        history,
                        t.spotify_id,
                        score
                    )

                    log_track_interaction(
                        user.id,
                        t.spotify_id,
                        emotion,
                        score,
                        db
                    )

                    scored.append((score, t))

                except Exception as e:
                    print(f"[TRACK SCORE ERROR] {e}")

            scored.sort(
                reverse=True,
                key=lambda x: x[0]
            )

            top_tracks = scored[:playlist_length]

            return jsonify({
                "url": "https://open.spotify.com/",
                "count": len(top_tracks),
                "mode": mode,
                "confidence": 0.82,
                "tracks": [
                    {
                        "name": t.name,
                        "artist": t.artist,
                        "id": t.spotify_id
                    }
                    for _, t in top_tracks
                ]
            })

        except Exception as e:
            print(f"[GENERATE ERROR] {e}")

            return jsonify({
                "error": "generation_failed",
                "details": str(e)
            }), 500

        finally:
            db.close()

    return app


# =========================
# APP INSTANCE
# =========================

app = create_app()


# =========================
# LOCAL DEV ENTRY
# =========================

if __name__ == "__main__":

    port = int(
        os.environ.get("PORT", 5000)
    )

    app.run(
        host="0.0.0.0",
        port=port,
        debug=False
    )
```
