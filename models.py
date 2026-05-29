import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)

from sqlalchemy.orm import relationship

# IMPORTANT: single shared Base (fixes your crash)
from database import Base


# =========================================================
# USER
# =========================================================

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    spotify_id = Column(String(100), unique=True, nullable=False, index=True)
    display_name = Column(String(300))
    token_json = Column(Text)

    last_sync_at = Column(DateTime)
    sync_status = Column(String(20), default="idle")
    sync_total = Column(Integer, default=0)
    sync_done = Column(Integer, default=0)
    sync_retry_after = Column(DateTime)

    user_tracks = relationship(
        "UserTrack",
        back_populates="user",
        cascade="all, delete-orphan"
    )

    playlists = relationship(
        "Playlist",
        back_populates="user",
        cascade="all, delete-orphan"
    )

    recommendations = relationship(
        "RecommendationHistory",
        back_populates="user",
        cascade="all, delete-orphan"
    )


# =========================================================
# TRACK
# =========================================================

class Track(Base):
    __tablename__ = "tracks"

    id = Column(Integer, primary_key=True)
    spotify_id = Column(String(100), unique=True, nullable=False, index=True)

    name = Column(String(500))
    artist = Column(String(500))
    album = Column(String(500))

    energy = Column(Float)
    valence = Column(Float)
    tempo = Column(Float)
    danceability = Column(Float)
    acousticness = Column(Float)
    speechiness = Column(Float)
    instrumentalness = Column(Float)
    liveness = Column(Float)

    user_tracks = relationship("UserTrack", back_populates="track")


# =========================================================
# USER TRACKS
# =========================================================

class UserTrack(Base):
    __tablename__ = "user_tracks"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    track_id = Column(Integer, ForeignKey("tracks.id", ondelete="CASCADE"), primary_key=True)

    liked_at = Column(DateTime)

    user = relationship("User", back_populates="user_tracks")
    track = relationship("Track", back_populates="user_tracks")


# =========================================================
# PLAYLISTS
# =========================================================

class Playlist(Base):
    __tablename__ = "playlists"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))

    spotify_playlist_id = Column(String(100))
    vibe_text = Column(String(500))
    track_count = Column(Integer)

    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    user = relationship("User", back_populates="playlists")


# =========================================================
# RECOMMENDATION HISTORY
# =========================================================

class RecommendationHistory(Base):
    __tablename__ = "recommendation_history"

    id = Column(Integer, primary_key=True)

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    spotify_track_id = Column(String(100), index=True)

    vibe = Column(String(200))

    recommended_at = Column(
        DateTime,
        default=datetime.datetime.utcnow,
        index=True
    )

    score = Column(Float, default=0.0)
    skipped = Column(Boolean, default=False)
    replayed = Column(Boolean, default=False)

    user = relationship("User", back_populates="recommendations")
