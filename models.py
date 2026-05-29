"""
models.py — V2 stable schema
"""

from datetime import datetime
from database import Base
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    spotify_id = Column(String, unique=True, index=True)
    sync_status = Column(String, default="idle")
    sync_total = Column(Integer, default=0)
    sync_done = Column(Integer, default=0)


class Track(Base):
    __tablename__ = "tracks"
    id = Column(Integer, primary_key=True)
    spotify_id = Column(String, unique=True)
    name = Column(String)
    artist = Column(String)
    energy = Column(Float)
    valence = Column(Float)


class UserTrack(Base):
    __tablename__ = "user_tracks"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    track_id = Column(Integer, ForeignKey("tracks.id"))
    added_at = Column(DateTime, default=datetime.utcnow)
