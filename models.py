"""
models.py — FULL FIXED VERSION (Render-safe)
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from database import Base


# =========================================================
# USER MODEL
# =========================================================

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    spotify_id = Column(String, unique=True, index=True)

    display_name = Column(String)
    token_json = Column(String)

    sync_status = Column(String, default="idle")
    sync_total = Column(Integer, default=0)
    sync_done = Column(Integer, default=0)

    last_sync_at = Column(DateTime)


# =========================================================
# TRACK MODEL
# =========================================================

class Track(Base):
    __tablename__ = "tracks"

    id = Column(Integer, primary_key=True)

    spotify_id = Column(String, unique=True, index=True)

    name = Column(String)
    artist = Column(String)
    album = Column(String)

    energy = Column(Float, default=0)
    valence = Column(Float, default=0)
    tempo = Column(Float, default=0)
    danceability = Column(Float, default=0)


# =========================================================
# USER ↔ TRACK RELATIONSHIP
# =========================================================

class UserTrack(Base):
    __tablename__ = "user_tracks"

    id = Column(Integer, primary_key=True)

    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    track_id = Column(Integer, ForeignKey("tracks.id"), index=True)

    added_at = Column(DateTime, default=datetime.utcnow)


# =========================================================
# MEMORY TABLE (you added this earlier)
# =========================================================

class UserTrackMemory(Base):
    __tablename__ = "user_track_memory"

    id = Column(Integer, primary_key=True)

    user_id = Column(Integer, index=True)
    track_id = Column(String, index=True)

    emotion = Column(String)
    score = Column(Float)

    last_seen = Column(DateTime, default=datetime.utcnow)
