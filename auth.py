import os

import spotipy
from flask import session
from spotipy.cache_handler import CacheHandler
from spotipy.oauth2 import SpotifyOAuth

from log import log

SCOPE = "user-library-read playlist-modify-private playlist-modify-public"

CLIENT_ID = os.getenv("SPOTIFY_CLIENT_ID", "53ced0e3c0e847bda87a3cfe71656996")
CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET", "822e7ed2cf104dbf965d306a6ebe9fa7")

_replit_domain = os.getenv("REPLIT_DEV_DOMAIN")

REDIRECT_URI = (
    os.getenv("SPOTIPY_REDIRECT_URI")
    or (f"https://{_replit_domain}/callback" if _replit_domain else None)
    or "http://localhost:5000/callback"
)


class FlaskSessionTokenCacheHandler(CacheHandler):
    """
    Stores Spotify tokens in the Flask session (signed cookie).

    Carries forward the previously-granted scope when Spotify's refresh
    response omits it (which is allowed by RFC 6749 §6 and done by Spotify
    in practice).  Without this, Spotipy clears the scope on every refresh,
    causing spurious 403s on playlist creation.
    """

    def get_cached_token(self):
        return session.get("token_info")

    def save_token_to_cache(self, token_info):
        if not token_info.get("scope"):
            existing = session.get("token_info") or {}
            inherited = existing.get("scope", "")
            if inherited:
                token_info = dict(token_info)
                token_info["scope"] = inherited
                log("INFO", "auth", "Refresh omitted scope — preserving previous grant",
                    scope=inherited)
        session["token_info"] = token_info
        session.modified = True


def spotify_oauth():
    return SpotifyOAuth(
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        redirect_uri=REDIRECT_URI,
        scope=SCOPE,
        cache_handler=FlaskSessionTokenCacheHandler(),
        show_dialog=False,
    )


def get_spotify_client():
    """
    Return an authenticated Spotipy client for the current request,
    or None if the session has no valid token.
    """
    token_info = session.get("token_info")
    if not token_info:
        return None

    try:
        auth = spotify_oauth()
        if auth.is_token_expired(token_info):
            token_info = auth.refresh_access_token(token_info["refresh_token"])

        # retries=0 disables spotipy's built-in urllib3 retry adapter.
        # Without this, spotipy sleeps for the full Retry-After duration
        # (sometimes 73,000+ seconds) INSIDE the API call before raising
        # SpotifyException — completely bypassing our own 429 handling.
        sp = spotipy.Spotify(auth=token_info["access_token"], retries=0)

        granted = set((token_info.get("scope") or "").split())
        required = set(SCOPE.split())
        missing = required - granted
        if missing:
            log("WARN", "auth", "Missing Spotify scopes — may get 403s", missing=sorted(missing))

        return sp

    except Exception as exc:
        log("ERROR", "auth", "Failed to build Spotify client", exc=str(exc))
        return None
