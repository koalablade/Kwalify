import datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    spotify_id = Column(String(100), unique=True, nullable=False, index=True)
    display_name = Column(String(300))
    token_json = Column(Text)

    # Sync state
    last_sync_at = Column(DateTime)
    sync_status = Column(String(20), default="idle")  # idle|syncing|done|error|rate_limited
    sync_total = Column(Integer, default=0)
    sync_done = Column(Integer, default=0)
    sync_retry_after = Column(DateTime)               # set on 429; cleared on success

    user_tracks = relationship(
        "UserTrack", back_populates="user", cascade="all, delete-orphan"
    )
    playlists = relationship(
        "Playlist", back_populates="user", cascade="all, delete-orphan"
    )


class Track(Base):
    __tablename__ = "tracks"

    id = Column(Integer, primary_key=True)
    spotify_id = Column(String(100), unique=True, nullable=False, index=True)
    name = Column(String(500))
    artist = Column(String(500))
    album = Column(String(500))

    # Audio features — None when Spotify returns 403 for this app tier
    energy = Column(Float)
    valence = Column(Float)
    tempo = Column(Float)
    danceability = Column(Float)
    acousticness = Column(Float)
    speechiness = Column(Float)
    instrumentalness = Column(Float)

    user_tracks = relationship("UserTrack", back_populates="track")


class UserTrack(Base):
    __tablename__ = "user_tracks"

    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    track_id = Column(
        Integer, ForeignKey("tracks.id", ondelete="CASCADE"), primary_key=True
    )
    liked_at = Column(DateTime)

    user = relationship("User", back_populates="user_tracks")
    track = relationship("Track", back_populates="user_tracks")


class Playlist(Base):
    __tablename__ = "playlists"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    spotify_playlist_id = Column(String(100))
    vibe_text = Column(String(500))
    track_count = Column(Integer)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    user = relationship("User", back_populates="playlists")
