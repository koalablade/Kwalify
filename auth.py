import os
import spotipy
from flask import session
from spotipy.cache_handler import CacheHandler
from spotipy.oauth2 import SpotifyOAuth


SCOPE = "user-library-read playlist-modify-private playlist-modify-public"

CLIENT_ID = os.getenv("SPOTIFY_CLIENT_ID")
CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET")

REPLIT_DOMAIN = os.getenv("REPLIT_DEV_DOMAIN")

REDIRECT_URI = (
    os.getenv("SPOTIPY_REDIRECT_URI")
    or (f"https://{REPLIT_DOMAIN}/callback" if REPLIT_DOMAIN else None)
    or "http://localhost:5000/callback"
)


# ─────────────────────────────
# SESSION TOKEN CACHE
# ─────────────────────────────
class FlaskSessionCache(CacheHandler):
    def get_cached_token(self):
        return session.get("token_info")

    def save_token_to_cache(self, token_info):
        session["token_info"] = token_info
        session.modified = True


# ─────────────────────────────
# OAUTH
# ─────────────────────────────
def spotify_oauth():
    return SpotifyOAuth(
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        redirect_uri=REDIRECT_URI,
        scope=SCOPE,
        cache_handler=FlaskSessionCache(),
        show_dialog=True,
    )


# ─────────────────────────────
# SPOTIFY CLIENT
# ─────────────────────────────
def get_spotify_client():
    token_info = session.get("token_info")

    if not token_info:
        return None

    try:
        sp_oauth = spotify_oauth()

        if sp_oauth.is_token_expired(token_info):
            token_info = sp_oauth.refresh_access_token(token_info["refresh_token"])
            session["token_info"] = token_info

        return spotipy.Spotify(auth=token_info["access_token"], retries=0)

    except Exception:
        return None
