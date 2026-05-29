"""
models.py — Kwalify Core Database Models (FIXED + CONSISTENT)
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime
from database import Base


# =========================================================
# USER
# =========================================================

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)

    spotify_id = Column(String, unique=True, index=True, nullable=False)
    display_name = Column(String, nullable=True)

    sync_status = Column(String, default="idle")

    sync_total = Column(Integer, default=0)
    sync_done = Column(Integer, default=0)

    last_sync_at = Column(DateTime, nullable=True)

    token_json = Column(String, nullable=True)


# =========================================================
# TRACK
# =========================================================

class Track(Base):
    __tablename__ = "tracks"

    id = Column(Integer, primary_key=True)

    spotify_id = Column(String, unique=True, index=True, nullable=False)

    name = Column(String, default="")
    artist = Column(String, default="")
    album = Column(String, default="")

    # Audio features (Spotify analysis)
    energy = Column(Float, default=0.0)
    valence = Column(Float, default=0.0)
    tempo = Column(Float, default=0.0)
    danceability = Column(Float, default=0.0)


# =========================================================
# USER ↔ TRACK RELATIONSHIP
# =========================================================

class UserTrack(Base):
    __tablename__ = "user_tracks"

    id = Column(Integer, primary_key=True)

    user_id = Column(Integer, index=True, nullable=False)
    track_id = Column(Integer, index=True, nullable=False)

    added_at = Column(DateTime, default=datetime.utcnow)


# =========================================================
# MEMORY / EMOTION SYSTEM
# =========================================================

class UserTrackMemory(Base):
    __tablename__ = "user_track_memory"

    id = Column(Integer, primary_key=True)

    user_id = Column(Integer, index=True, nullable=False)
    track_id = Column(String, index=True, nullable=False)

    emotion = Column(String)
    score = Column(Float)

    last_seen = Column(DateTime, default=datetime.utcnow)
