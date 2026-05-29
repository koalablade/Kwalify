"""
memory.py — track interaction history for repeat/emotion loop prevention
"""

from datetime import datetime
from models import UserTrackMemory


def log_track_interaction(user_id, track_id, emotion, score, db):
    mem = UserTrackMemory(
        user_id=user_id,
        track_id=track_id,
        emotion=emotion,
        score=score,
        last_seen=datetime.utcnow(),
    )
    db.add(mem)
    db.commit()


def get_user_history(user_id, db):
    return (
        db.query(UserTrackMemory)
        .filter_by(user_id=user_id)
        .order_by(UserTrackMemory.last_seen.desc())
        .limit(50)
        .all()
    )
