"""
models.py — stable schema
"""

from datetime import datetime
from database import Base
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey


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
    sync_retry_after = Column(DateTime)


class Track(Base):
    __tablename__ = "tracks"

    id = Column(Integer, primary_key=True)
    spotify_id = Column(String, unique=True, index=True)
    name = Column(String)
    artist = Column(String)
    album = Column(String)

    energy = Column(Float, default=0.5)
    valence = Column(Float, default=0.5)
    danceability = Column(Float, default=0.5)
    acousticness = Column(Float, default=0.5)
    instrumentalness = Column(Float, default=0.0)
    speechiness = Column(Float, default=0.0)
    liveness = Column(Float, default=0.0)
    tempo = Column(Float, default=120.0)


class UserTrack(Base):
    __tablename__ = "user_tracks"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    track_id = Column(Integer, ForeignKey("tracks.id"), index=True)
    liked_at = Column(DateTime)


class UserTrackMemory(Base):
    __tablename__ = "user_track_memory"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, index=True)
    track_id = Column(String, index=True)
    emotion = Column(String)
    score = Column(Float)
    last_seen = Column(DateTime, default=datetime.utcnow)
