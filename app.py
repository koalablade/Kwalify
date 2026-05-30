import os
from flask import Flask, render_template, request, jsonify, session, redirect

# Assuming these imports exist in your project
from auth import spotify_oauth, get_spotify_client
from cache import start_sync_if_needed, get_sync_status, load_user_tracks
from database import get_db, init_db
from dj_engine import generate_ai_playlist
from spotify_service import create_playlist, add_tracks_to_playlist

app = Flask(__name__)

# --- Configuration ---
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = bool(os.environ.get('RENDER'))
app.secret_key = r"my-super-secret-123454ffsda\zc2345251.,/'5215136dfdsdfs"

init_db()

# ─────────────────────────────
# GENERATE ROUTE
# ─────────────────────────────
@app.route("/generate", methods=["POST"])
def generate():
    # 1. AUTH CHECK: Ensure the user's browser session is active
    if "token_info" not in session:
        print("DEBUG: Unauthorized access attempt - no session found")
        return jsonify({"error": "not_logged_in"}), 401

    # 2. PARSE DATA
    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({"error": "no_input_received"}), 400

    vibe = data.get("vibe") or "balanced"
    try:
        length = int(data.get("length", 25))
    except (ValueError, TypeError):
        length = 25

    # 3. GET SPOTIFY CLIENT
    sp = get_spotify_client()
    if not sp:
        return jsonify({"error": "spotify_client_failed"}), 401

    try:
        user_id = sp.me()["id"]
    except Exception as e:
        print(f"DEBUG: Failed to get user ID: {e}")
        return jsonify({"error": "spotify_auth_invalid"}), 401

    # 4. GENERATE PLAYLIST
    db = get_db()
    try:
        raw_tracks = load_user_tracks(user_id, db)
        if not raw_tracks:
            return jsonify({"error": "no_tracks_available"}), 400

        tracks = [{"id": t.spotify_id, "name": t.name, "artist": t.artist} for t in raw_tracks]
        
        ranked = generate_ai_playlist(sp, tracks, vibe=vibe, limit=length)
        if not ranked:
            return jsonify({"error": "no_tracks_matched"}), 400

        uris = [f"spotify:track:{t['id']}" for t in ranked if t.get("id")]
        
        playlist = create_playlist(sp, f"{vibe} • AI DJ Session")
        add_tracks_to_playlist(sp, playlist["id"], uris)

        return jsonify({
            "url": playlist["external_urls"]["spotify"],
            "name": playlist["name"],
            "count": len(uris),
            "vibe": vibe,
            "status": "AI_DJ_ACTIVE"
        })

    except Exception as e:
        print(f"DEBUG: Exception in generate: {str(e)}")
        return jsonify({"error": "internal_server_error", "details": str(e)}), 500
    finally:
        db.close()

# ─────────────────────────────
# OTHER ROUTES (Keep these as they are)
# ─────────────────────────────
@app.route("/")
def index():
    return render_template("index.html", logged_in="token_info" in session)

@app.route("/login")
def login():
    return redirect(spotify_oauth().get_authorize_url())

@app.route("/callback")
def callback():
    code = request.args.get("code")
    sp_oauth = spotify_oauth()
    token_info = sp_oauth.get_access_token(code)
    session["token_info"] = token_info
    return redirect("/")

if __name__ == "__main__":
    app.run(debug=True)
