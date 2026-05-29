"""
app.py — Render production safe entrypoint
"""

import os
from flask import Flask, jsonify, request

from cache import (
    get_sync_status,
    load_user_tracks,
    start_sync_if_needed,
)

from database import SessionLocal, init_db


app = Flask(__name__)


# =========================
# INIT DB ON START
# =========================
with app.app_context():
    init_db()


# =========================
# DB HELP
# =========================
def get_db():
    return SessionLocal()


# =========================
# ROUTES
# =========================

@app.route("/")
def home():
    return jsonify({
        "status": "ok",
        "service": "Kwalify running"
    })


@app.route("/cache-status")
def cache_status():
    user_id = request.args.get("user_id", "demo")

    db = get_db()
    try:
        return jsonify(get_sync_status(user_id, db))
    finally:
        db.close()


@app.route("/tracks")
def tracks():
    user_id = request.args.get("user_id", "demo")

    db = get_db()
    try:
        return jsonify(load_user_tracks(user_id, db))
    finally:
        db.close()


@app.route("/sync")
def sync():
    user_id = request.args.get("user_id", "demo")

    def db_factory():
        return SessionLocal()

    start_sync_if_needed(user_id, None, db_factory)

    return jsonify({"status": "sync_started"})


# =========================
# LOCAL DEV ONLY
# =========================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)"""
vibe_engine.py — stable emotional + semantic scoring (no ML cost)
"""

import numpy as np
import hashlib

EMBED_DIM = 32


# =========================================================
# EMBEDDING (stable + fast, no external ML)
# =========================================================

def _hash(text):
    return int(hashlib.md5(text.encode("utf-8")).hexdigest(), 16)


def embed(text: str):
    seed = _hash(text.lower())
    rng = np.random.default_rng(seed)

    vec = rng.normal(0, 1, EMBED_DIM)
    return vec / (np.linalg.norm(vec) + 1e-9)


# =========================================================
# TRACK VECTOR
# =========================================================

def track_vector(track):
    vec = np.array([
        track.energy or 0.5,
        track.valence or 0.5,
        track.danceability or 0.5,
        track.acousticness or 0.5,
        track.instrumentalness or 0.0,
        track.speechiness or 0.0,
        track.liveness or 0.0,
        (track.tempo or 120) / 200
    ], dtype=float)

    return vec / (np.linalg.norm(vec) + 1e-9)


# =========================================================
# VIBE
# =========================================================

def interpret_vibe(text):
    return embed(text)


def cosine(a, b):
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


# =========================================================
# EMOTION DETECTION (improved)
# =========================================================

def get_emotion(vec):
    energy = vec[0]
    valence = vec[1]

    if valence > 0.7 and energy > 0.6:
        return "euphoric"
    if valence < 0.35 and energy < 0.4:
        return "melancholy"
    if energy > 0.75:
        return "intense"
    if valence > 0.65 and energy < 0.5:
        return "nostalgic"
    if valence > 0.6:
        return "warm"
    if energy < 0.3:
        return "nostalgic"

    return "neutral"


# =========================================================
# REPEAT / EMOTION LOOP PREVENTION
# =========================================================

def apply_repeat_penalty(history, track_id, score):
    """
    Prevents emotional repetition loops properly.
    """

    recent_tracks = [h.track_id for h in history[-10:]]

    if track_id in recent_tracks[-3:]:
        score *= 0.55   # hard repeat penalty

    if len(recent_tracks) >= 5:
        if len(set(recent_tracks[-5:])) <= 2:
            score *= 0.75  # emotional loop detection

    return score


# =========================================================
# NOSTALGIA BOOST (NEW FEATURE)
# =========================================================

def nostalgia_boost(track_vec, emotion):
    """
    Boosts nostalgic / warm / low-energy emotional signals
    """

    energy = track_vec[0]
    valence = track_vec[1]

    boost = 0.0

    # classic nostalgia feel: low energy + mid/low valence
    if energy < 0.45 and 0.35 < valence < 0.7:
        boost += 0.08

    # emotional memory trigger
    if emotion == "nostalgic":
        boost += 0.12

    # soft warmth memory effect
    if emotion == "warm":
        boost += 0.05

    return boost


# =========================================================
# MAIN SCORING (HYBRID)
# =========================================================

def hybrid_score(vibe_vec, track_vec, track, emotion=None):
    """
    Final scoring system:
    semantic + emotional shaping + nostalgia boost
    """

    semantic = cosine(vibe_vec, track_vec)

    # emotion-aware adjustment
    if emotion is None:
        emotion = get_emotion(track_vec)

    emotional_weight = 0.08 if emotion == "neutral" else 0.12

    nostalgia = nostalgia_boost(track_vec, emotion)

    return semantic + emotional_weight + nostalgia"""
database.py — Render-safe DB layer (stable + production-safe)
"""

import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base


# =========================================================
# ENV SETUP
# =========================================================

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("⚠️ No DATABASE_URL → using SQLite fallback")
    DATABASE_URL = "sqlite:///local.db"
    USING_SQLITE = True
else:
    USING_SQLITE = DATABASE_URL.startswith("sqlite")


# =========================================================
# ENGINE CONFIG
# =========================================================

connect_args = {}

if USING_SQLITE:
    connect_args = {"check_same_thread": False}

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=300,
    connect_args=connect_args,
)


# =========================================================
# SESSION
# =========================================================

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False
)

Base = declarative_base()


# =========================================================
# DB ACCESS
# =========================================================

def get_db():
    return SessionLocal()


# =========================================================
# INIT DB (SAFE FOR RENDER)
# =========================================================

def init_db():
    """
    IMPORTANT:
    Only call this ONCE at startup (not per request).
    """
    try:
        Base.metadata.create_all(bind=engine)
        print("✅ DB ready")
    except Exception as e:
        print("⚠️ DB init failed:", str(e))


# =========================================================
# HEALTH CHECK
# =========================================================

def ping_db():
    """
    Lightweight Render-friendly DB check
    """
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        print("DB ping failed:", str(e))
        return False"""
database.py — Render-safe DB layer (stable + production-safe)
"""

import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base


# =========================================================
# ENV SETUP
# =========================================================

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("⚠️ No DATABASE_URL → using SQLite fallback")
    DATABASE_URL = "sqlite:///local.db"
    USING_SQLITE = True
else:
    USING_SQLITE = DATABASE_URL.startswith("sqlite")


# =========================================================
# ENGINE CONFIG
# =========================================================

connect_args = {}

if USING_SQLITE:
    connect_args = {"check_same_thread": False}

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=300,
    connect_args=connect_args,
)


# =========================================================
# SESSION
# =========================================================

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False
)

Base = declarative_base()


# =========================================================
# DB ACCESS
# =========================================================

def get_db():
    return SessionLocal()


# =========================================================
# INIT DB (SAFE FOR RENDER)
# =========================================================

def init_db():
    """
    IMPORTANT:
    Only call this ONCE at startup (not per request).
    """
    try:
        Base.metadata.create_all(bind=engine)
        print("✅ DB ready")
    except Exception as e:
        print("⚠️ DB init failed:", str(e))


# =========================================================
# HEALTH CHECK
# =========================================================

def ping_db():
    """
    Lightweight Render-friendly DB check
    """
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        print("DB ping failed:", str(e))
        return False"""
cache.py — STABLE SYNC + SAFE TRACK LOADING (FIXED IMPORT SAFE VERSION)
"""

import datetime
import json
import threading

from log import log

# SAFE IMPORTS (prevents Render crash if models differ)
try:
    from models import Track, User, UserTrack
except Exception:
    Track = None
    User = None
    UserTrack = None


# =========================================================
# LOAD TRACKS
# =========================================================

def load_user_tracks(spotify_user_id, db):
    if User is None or Track is None or UserTrack is None:
        log("ERROR", "cache", "Models not loaded properly")
        return []

    user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
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
            "name": t.name or "",
            "artist": t.artist or "",
            "album": t.album or "",
            "energy": t.energy or 0,
            "valence": t.valence or 0,
            "tempo": t.tempo or 0,
            "danceability": t.danceability or 0,
        }
        for t in rows
    ]


# =========================================================
# USER
# =========================================================

def get_or_create_user(spotify_user_id, db, display_name=None, token_info=None):
    if User is None:
        raise RuntimeError("User model missing in models.py")

    user = db.query(User).filter_by(spotify_id=spotify_user_id).first()

    if not user:
        user = User(spotify_id=spotify_user_id, sync_status="idle")
        db.add(user)

    if display_name:
        user.display_name = display_name

    if token_info:
        user.token_json = json.dumps(token_info)

    db.commit()
    return user


# =========================================================
# SYNC STATUS
# =========================================================

def get_sync_status(spotify_user_id, db):
    if User is None or UserTrack is None:
        return {"status": "error", "track_count": 0}

    user = db.query(User).filter_by(spotify_id=spotify_user_id).first()

    if not user:
        return {"status": "no_user", "track_count": 0}

    track_count = db.query(UserTrack).filter_by(user_id=user.id).count()

    return {
        "status": user.sync_status or "idle",
        "track_count": track_count,
        "sync_total": user.sync_total or 0,
        "sync_done": user.sync_done or 0,
        "last_sync_at": user.last_sync_at.isoformat() if user.last_sync_at else None,
    }


# =========================================================
# SYNC LOCK
# =========================================================

_sync_lock = threading.Lock()
_sync_running = set()


def _run_sync(user_id, sp, db_factory, sync_fn):
    with _sync_lock:
        if user_id in _sync_running:
            log("INFO", "cache", "Sync already running", user=user_id)
            return False
        _sync_running.add(user_id)

    db = db_factory()

    try:
        sync_fn(user_id, sp, db)
        return True

    except Exception as e:
        log("ERROR", "cache", "Sync failed", user=user_id, exc=str(e))
        return False

    finally:
        db.close()
        with _sync_lock:
            _sync_running.discard(user_id)


# =========================================================
# PUBLIC SYNC API
# =========================================================

def start_sync_if_needed(user_id, sp, db_factory):
    from sync_service import run_incremental_sync

    db = db_factory()
    try:
        user = db.query(User).filter_by(spotify_id=user_id).first()
        if not user:
            return False
    finally:
        db.close()

    return _run_sync(user_id, sp, db_factory, run_incremental_sync)


def start_full_reset_sync(user_id, sp, db_factory):
    from sync_service import run_full_reset_sync
    return _run_sync(user_id, sp, db_factory, run_full_reset_sync)"""
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

    last_seen = Column(DateTime, default=datetime.utcnow)flask
sqlalchemy
spotipy
requests
redis
psycopg2-binary
numpy
scikit-learn
sentence-transformers
gunicorn
