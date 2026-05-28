import os
import secrets
import time
import random

from flask import Flask, jsonify, redirect, render_template, request, session
from sqlalchemy import text as sa_text

from auth import get_spotify_client, spotify_oauth
from cache import get_or_create_user, get_sync_status, load_user_tracks, start_sync_if_needed
from database import get_db, init_db
from log import log
from spotify_service import add_tracks_to_playlist, create_playlist
from vibe_engine import interpret_vibe, score_track

app = Flask(__name__)
app.secret_key = os.getenv("SESSION_SECRET", "dev_key")

init_db()

# -------------------------
# THROTTLE (prevents spam 429)
# -------------------------
_last = {}
MIN_DELAY = 2.5

def throttle(key):
    now = time.time()
    last = _last.get(key, 0)

    if now - last < MIN_DELAY:
        return False, MIN_DELAY - (now - last)

    _last[key] = now
    return True, 0


# -------------------------
# HOME
# -------------------------
@app.route("/")
def home():
    return render_template("index.html", logged_in="token_info" in session)


# -------------------------
# LOGIN
# -------------------------
@app.route("/login")
def login():
    auth = spotify_oauth()
    state = secrets.token_urlsafe(16)
    session["oauth_state"] = state
    return redirect(auth.get_authorize_url(state=state))


# -------------------------
# CALLBACK
# -------------------------
@app.route("/callback")
def callback():
    from spotipy.oauth2 import SpotifyOauthError

    code = request.args.get("code")
    state = request.args.get("state")

    if state != session.pop("oauth_state", None):
        return "OAuth error", 400

    auth = spotify_oauth()

    try:
        token_info = auth.get_access_token(code=code, check_cache=False)
    except SpotifyOauthError as e:
        return str(e), 400

    session["token_info"] = token_info

    sp = get_spotify_client()
    me = sp.me()

    session["spotify_user_id"] = me["id"]

    db = get_db()
    try:
        get_or_create_user(me["id"], db, token_info=token_info)
        start_sync_if_needed(me["id"], sp, get_db)
    finally:
        db.close()

    return redirect("/")


# -------------------------
# GENERATE PLAYLIST (FIXED CORE)
# -------------------------
@app.route("/generate", methods=["POST"])
def generate():
    sp = get_spotify_client()
    if not sp:
        return jsonify({"error": "not_logged_in"}), 401

    user = session.get("spotify_user_id")
    if not user:
        return jsonify({"error": "no_user"}), 400

    ok, wait = throttle(f"generate:{user}")
    if not ok:
        return jsonify({"error": "too_many_requests", "retry_after": wait}), 429

    db = get_db()

    try:
        cache = load_user_tracks(user, db)

        if not cache:
            return jsonify({"error": "no_tracks"}), 400

        data = request.get_json(silent=True) or {}

        vibe = data.get("vibe", "chill")

        try:
            length = int(data.get("length", 100))  # allow BIG playlists
        except:
            length = 100

        profile, confidence, _ = interpret_vibe(vibe)

        # -------------------------
        # SEED (prevents identical playlists)
        # -------------------------
        seed = hash(f"{user}{vibe}{int(time.time() / 3600)}")
        random.seed(seed)

        scored = [
            (t["id"], score_track(t, profile))
            for t in cache
        ]

        # shuffle first → breaks deterministic ordering
        random.shuffle(scored)

        scored.sort(key=lambda x: x[1], reverse=True)

        # -------------------------
        # CONTROLLED RANDOM SELECTION
        # -------------------------
        selected = []
        seen_artists = set()

        for track_id, score in scored[:500]:

            track = next((t for t in cache if t["id"] == track_id), None)
            if not track:
                continue

            # diversity rule (prevents same artists spam)
            if track["artist"] in seen_artists and random.random() < 0.7:
                continue

            # weighted randomness
            if random.random() < min(1.0, score / 100):
                selected.append(track)
                seen_artists.add(track["artist"])

            if len(selected) >= length:
                break

        uris = [f"spotify:track:{t['id']}" for t in selected]

        playlist = create_playlist(sp, vibe)

        # -------------------------
        # BATCH UPLOAD (FIXES 100+ SONG LIMIT)
        # -------------------------
        for i in range(0, len(uris), 100):
            sp.playlist_add_items(playlist["id"], uris[i:i + 100])

        return jsonify({"url": playlist["external_urls"]["spotify"]})

    except Exception as e:
        log("ERROR", "generate", str(e), user=user)
        return jsonify({"error": "internal_error"}), 500

    finally:
        db.close()


# -------------------------
# CACHE STATUS
# -------------------------
@app.route("/cache-status")
def cache_status():
    user = session.get("spotify_user_id")

    if not user:
        return jsonify({"error": "not_logged_in"}), 401

    db = get_db()
    try:
        return jsonify(get_sync_status(user, db))
    finally:
        db.close()


# -------------------------
# HEALTH CHECK
# -------------------------
@app.route("/health")
def health():
    db = get_db()
    db.execute(sa_text("SELECT 1"))
    db.close()
    return jsonify({"ok": True})


# -------------------------
# RUN
# -------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
