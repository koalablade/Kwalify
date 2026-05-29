import random
import time
from log import log
import spotipy


# =========================
# SAFE SPOTIFY WRAPPER
# =========================
def safe_spotify_call(func, *args, retries=3, **kwargs):
    for attempt in range(retries):
        try:
            return func(*args, **kwargs)

        except Exception as e:
            if "429" in str(e):
                time.sleep(2 + attempt * 2)
                continue
            raise

    raise Exception("Spotify API failed")


# =========================
# CREATE PLAYLIST
# =========================
def create_playlist(sp, name, description="AI DJ Playlist"):
    me = sp.me()

    playlist = sp.user_playlist_create(
        me["id"],
        name,
        public=False,
        description=description
    )

    return playlist


# =========================
# ADD TRACKS
# =========================
def add_tracks(sp, playlist_id, uris):
    for i in range(0, len(uris), 100):
        sp.playlist_add_items(playlist_id, uris[i:i+100])
        time.sleep(0.1)


# =========================
# EMOTION → NAME
# =========================
def generate_name(session_mood, vibe):
    base = {
        "sad_session": ["rainy nights", "empty space", "after thoughts"],
        "hype_session": ["main character energy", "neon rush", "adrenaline"],
        "focus_session": ["deep work", "flow state", "late study"],
        "balanced_session": ["daily mix", "flow", "journey"]
    }

    prefix = random.choice(base.get(session_mood, ["mix"]))
    return f"{prefix} • {vibe}"


# =========================
# AUDIO FEATURES (🔥 FIXED + REQUIRED)
# =========================
def get_audio_features(sp, track_id):
    """
    Fetch Spotify audio features for AI DJ scoring.
    """

    try:
        features = sp.audio_features([track_id])

        if not features or not features[0]:
            return None

        f = features[0]

        return {
            "energy": f.get("energy", 0.5),
            "valence": f.get("valence", 0.5),
            "danceability": f.get("danceability", 0.5),
            "acousticness": f.get("acousticness", 0.5),
            "instrumentalness": f.get("instrumentalness", 0.0),
            "tempo": f.get("tempo", 120.0),
            "speechiness": f.get("speechiness", 0.0),
            "liveness": f.get("liveness", 0.0),
        }

    except Exception:
        return None
