"""
cache.py — safe DB queries only (NO heavy logic)
"""

from models import User, Track, UserTrack


def load_user_tracks(user_id, db):
    user = db.query(User).filter_by(spotify_id=user_id).first()

    if not user:
        return []

    rows = (
        db.query(Track)
        .join(UserTrack, UserTrack.track_id == Track.id)
        .filter(UserTrack.user_id == user.id)
        .all()
    )

    return [
        {
            "id": t.spotify_id,
            "name": t.name,
            "artist": t.artist,
            "energy": t.energy,
            "valence": t.valence
        }
        for t in rows
    ]


def get_sync_status(user_id, db):
    user = db.query(User).filter_by(spotify_id=user_id).first()

    if not user:
        return {"status": "no_user"}

    return {
        "status": user.sync_status,
        "done": user.sync_done,
        "total": user.sync_total
    }
