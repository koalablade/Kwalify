"""
spotify_service.py — Spotify API calls for playlist creation only.

Sync calls (GET /v1/me/tracks) live exclusively in sync_service.py.
This module handles:
  • _spotify_call_with_backoff  — 429-aware retry wrapper (playlist calls only)
  • create_playlist             — POST /v1/me/playlists
  • add_tracks_to_playlist      — POST /v1/playlists/{id}/tracks

/generate is the only caller. It MUST NOT import anything from sync_service.py.
"""

import random
import time

from spotipy.exceptions import SpotifyException

from log import log


# ---------------------------------------------------------------------------
# Retry wrapper — used only for playlist creation (user-triggered, low-volume)
# ---------------------------------------------------------------------------

def _spotify_call_with_backoff(fn, label, max_retries=4):
    """
    Call fn(), retrying on 429 with Retry-After-aware exponential backoff.
    Suitable for low-frequency playlist calls (POST). NOT used for sync pagination.
    """
    log("INFO", "spotify", "API call", label=label)
    for attempt in range(max_retries + 1):
        try:
            result = fn()
            log("INFO", "spotify", "API call OK", label=label)
            return result
        except SpotifyException as exc:
            status = getattr(exc, "http_status", None)
            log("WARN", "spotify", "API error", label=label, status=status, attempt=attempt)
            if status == 429 and attempt < max_retries:
                retry_after = None
                try:
                    hdrs = getattr(exc, "headers", None) or {}
                    for key in ("Retry-After", "retry-after"):
                        val = hdrs.get(key)
                        if val:
                            retry_after = float(val)
                            break
                except Exception:
                    pass
                if retry_after and retry_after > 0:
                    wait = min(retry_after + random.uniform(0.5, 2.0), 60.0)
                    log("WARN", "spotify", "429 with Retry-After — waiting",
                        retry_after=f"{retry_after:.0f}s", wait=f"{wait:.1f}s")
                else:
                    wait = min(random.uniform(1.0, 3.0) * (2 ** attempt), 30.0)
                    log("WARN", "spotify", "429 no Retry-After — backoff waiting",
                        wait=f"{wait:.1f}s", attempt=f"{attempt + 1}/{max_retries + 1}")
                time.sleep(wait)
            else:
                raise


# ---------------------------------------------------------------------------
# Playlist creation — the only Spotify calls allowed inside /generate
# ---------------------------------------------------------------------------

def create_playlist(sp, vibe_text):
    """Create a private Spotify playlist. Returns playlist dict."""
    return _spotify_call_with_backoff(
        lambda: sp.current_user_playlist_create(
            name=f"K_WALAH • {vibe_text}",
            public=False,
        ),
        "current_user_playlist_create",
    )


def add_tracks_to_playlist(sp, playlist_id, uris):
    """Add track URIs to a Spotify playlist in one call."""
    return _spotify_call_with_backoff(
        lambda: sp.playlist_add_items(playlist_id, uris),
        "playlist_add_items",
    )
