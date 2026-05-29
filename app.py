import os
import secrets
import time
import random

from datetime import datetime, timedelta

from flask import (
    Flask,
    jsonify,
    redirect,
    render_template,
    request,
    session,
)

from sqlalchemy import text as sa_text

from auth import (
    get_spotify_client,
    spotify_oauth,
)

from cache import (
    get_or_create_user,
    get_sync_status,
    load_user_tracks,
    start_sync_if_needed,
)

from database import (
    get_db,
    init_db,
)

from log import log

from models import (
    RecommendationHistory,
    User,
)

from spotify_service import (
    create_playlist,
)

from vibe_engine import (
    interpret_vibe,
    score_track,
    apply_repeat_penalty,
)

app = Flask(__name__)

app.secret_key = os.getenv(
    "SESSION_SECRET",
    "dev_key"
)

init_db()


# =========================================================
# THROTTLE
# =========================================================

_last = {}

MIN_DELAY = 2.5


def throttle(key):

    now = time.time()

    last = _last.get(key, 0)

    if now - last < MIN_DELAY:

        return (
            False,
            MIN_DELAY - (now - last)
        )

    _last[key] = now

    return True, 0


# =========================================================
# HOME
# =========================================================

@app.route("/")
def home():

    return render_template(
        "index.html",
        logged_in="token_info" in session
    )


# =========================================================
# LOGIN
# =========================================================

@app.route("/login")
def login():

    auth = spotify_oauth()

    state = secrets.token_urlsafe(16)

    session["oauth_state"] = state

    return redirect(
        auth.get_authorize_url(state=state)
    )


# =========================================================
# CALLBACK
# =========================================================

@app.route("/callback")
def callback():

    from spotipy.oauth2 import SpotifyOauthError

    code = request.args.get("code")

    state = request.args.get("state")

    if state != session.pop("oauth_state", None):

        return "OAuth error", 400

    auth = spotify_oauth()

    try:

        token_info = auth.get_access_token(
            code=code,
            check_cache=False
        )

    except SpotifyOauthError as e:

        return str(e), 400

    session["token_info"] = token_info

    sp = get_spotify_client()

    me = sp.me()

    session["spotify_user_id"] = me["id"]

    db = get_db()

    try:

        get_or_create_user(
            me["id"],
            db,
            token_info=token_info
        )

        start_sync_if_needed(
            me["id"],
            sp,
            get_db
        )

    finally:

        db.close()

    return redirect("/")


# =========================================================
# GENERATE PLAYLIST
# =========================================================

@app.route("/generate", methods=["POST"])
def generate():

    sp = get_spotify_client()

    if not sp:
        return jsonify({
            "error": "not_logged_in"
        }), 401

    spotify_user_id = session.get(
        "spotify_user_id"
    )

    if not spotify_user_id:
        return jsonify({
            "error": "no_user"
        }), 400

    ok, wait = throttle(
        f"generate:{spotify_user_id}"
    )

    if not ok:

        return jsonify({
            "error": "too_many_requests",
            "retry_after": wait
        }), 429

    db = get_db()

    try:

        # -------------------------------------------------
        # DB USER
        # -------------------------------------------------

        user = (
            db.query(User)
            .filter_by(
                spotify_id=spotify_user_id
            )
            .first()
        )

        if not user:

            return jsonify({
                "error": "user_missing"
            }), 400

        # -------------------------------------------------
        # TRACK CACHE
        # -------------------------------------------------

        cache = load_user_tracks(
            spotify_user_id,
            db
        )

        if not cache:

            return jsonify({
                "error": "no_tracks"
            }), 400

        # -------------------------------------------------
        # REQUEST DATA
        # -------------------------------------------------

        data = request.get_json(
            silent=True
        ) or {}

        vibe = data.get(
            "vibe",
            "chill"
        )

        try:

            length = int(
                data.get("length", 50)
            )

        except:

            length = 50

        length = max(
            10,
            min(200, length)
        )

        # -------------------------------------------------
        # INTERPRET VIBE
        # -------------------------------------------------

        profile, confidence, signals = (
            interpret_vibe(vibe)
        )

        # -------------------------------------------------
        # SEED
        # -------------------------------------------------

        seed = hash(
            f"{spotify_user_id}"
            f"{vibe}"
            f"{int(time.time() / 3600)}"
        )

        rng = random.Random(seed)

        # -------------------------------------------------
        # LOAD RECENT HISTORY
        # -------------------------------------------------

        recent_rows = (
            db.query(RecommendationHistory)
            .filter(
                RecommendationHistory.user_id == user.id,
                RecommendationHistory.recommended_at >
                datetime.utcnow() - timedelta(days=14)
            )
            .all()
        )

        history_map = {
            r.spotify_track_id: r.recommended_at
            for r in recent_rows
        }

        # -------------------------------------------------
        # SCORE TRACKS
        # -------------------------------------------------

        scored = []

        for track in cache:

            base_score = score_track(
                track,
                profile
            )

            repeat_penalty = apply_repeat_penalty(
                track["id"],
                history_map
            )

            final_score = (
                base_score *
                repeat_penalty
            )

            scored.append(
                (
                    track["id"],
                    final_score
                )
            )

        # -------------------------------------------------
        # SHUFFLE BEFORE SORT
        # -------------------------------------------------

        rng.shuffle(scored)

        scored.sort(
            key=lambda x: x[1],
            reverse=True
        )

        # -------------------------------------------------
        # LOOKUP TABLE
        # -------------------------------------------------

        track_lookup = {
            t["id"]: t
            for t in cache
        }

        # -------------------------------------------------
        # SMART SELECTION
        # -------------------------------------------------

        selected = []

        seen_artists = {}

        for track_id, score in scored[:600]:

            track = track_lookup.get(track_id)

            if not track:
                continue

            artist = (
                track.get("artist") or ""
            )

            artist_count = (
                seen_artists.get(artist, 0)
            )

            # -----------------------------
            # artist diversity
            # -----------------------------

            if artist_count >= 2:
                continue

            # -----------------------------
            # weighted randomness
            # -----------------------------

            random_gate = rng.random()

            threshold = max(
                0.15,
                min(0.98, score)
            )

            if random_gate > threshold:
                continue

            selected.append(track)

            seen_artists[artist] = (
                artist_count + 1
            )

            if len(selected) >= length:
                break

        # -------------------------------------------------
        # FALLBACK
        # -------------------------------------------------

        if len(selected) < length:

            used = {
                t["id"]
                for t in selected
            }

            for track_id, _ in scored:

                if len(selected) >= length:
                    break

                if track_id in used:
                    continue

                track = track_lookup.get(track_id)

                if not track:
                    continue

                selected.append(track)

                used.add(track_id)

        # -------------------------------------------------
        # PLAYLIST URIS
        # -------------------------------------------------

        uris = [
            f"spotify:track:{t['id']}"
            for t in selected
        ]

        # -------------------------------------------------
        # CREATE PLAYLIST
        # -------------------------------------------------

        playlist = create_playlist(
            sp,
            vibe
        )

        # -------------------------------------------------
        # ADD TRACKS
        # -------------------------------------------------

        for i in range(0, len(uris), 100):

            chunk = uris[i:i + 100]

            sp.playlist_add_items(
                playlist["id"],
                chunk
            )

        # -------------------------------------------------
        # SAVE RECOMMENDATION MEMORY
        # -------------------------------------------------

        for track in selected:

            row = RecommendationHistory(
                user_id=user.id,
                spotify_track_id=track["id"],
                vibe=vibe,
                score=1.0,
            )

            db.add(row)

        db.commit()

        # -------------------------------------------------
        # SUCCESS
        # -------------------------------------------------

        return jsonify({

            "url": playlist["external_urls"]["spotify"],

            "meta": {
                "confidence": confidence,
                "signals": signals,
                "tracks_selected": len(selected),
            }
        })

    except Exception as e:

        log(
            "ERROR",
            "generate",
            str(e),
            user=spotify_user_id
        )

        return jsonify({
            "error": "internal_error"
        }), 500

    finally:

        db.close()


# =========================================================
# CACHE STATUS
# =========================================================

@app.route("/cache-status")
def cache_status():

    spotify_user_id = session.get(
        "spotify_user_id"
    )

    if not spotify_user_id:

        return jsonify({
            "error": "not_logged_in"
        }), 401

    db = get_db()

    try:

        return jsonify(
            get_sync_status(
                spotify_user_id,
                db
            )
        )

    finally:

        db.close()


# =========================================================
# HEALTH CHECK
# =========================================================

@app.route("/health")
def health():

    db = get_db()

    db.execute(
        sa_text("SELECT 1")
    )

    db.close()

    return jsonify({
        "ok": True
    })


# =========================================================
# RUN
# =========================================================

if __name__ == "__main__":

    app.run(
        host="0.0.0.0",
        port=int(
            os.getenv("PORT", 5000)
        )
    )
