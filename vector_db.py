"""
vector_db.py — lightweight persistent vector memory (SQLite)
V3 AI memory layer
"""

import sqlite3
import json
import numpy as np

DB_PATH = "vector_memory.db"


# =========================
# INIT DB
# =========================
def init_vector_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("""
    CREATE TABLE IF NOT EXISTS vectors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        track_id TEXT,
        mood TEXT,
        vector TEXT
    )
    """)

    conn.commit()
    conn.close()


# =========================
# STORE VECTOR
# =========================
def store_vector(user_id, track_id, mood, vector):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute(
        "INSERT INTO vectors (user_id, track_id, mood, vector) VALUES (?, ?, ?, ?)",
        (user_id, track_id, mood, json.dumps(vector.tolist()))
    )

    conn.commit()
    conn.close()


# =========================
# LOAD USER VECTORS
# =========================
def load_user_vectors(user_id):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("SELECT track_id, mood, vector FROM vectors WHERE user_id=?", (user_id,))
    rows = c.fetchall()

    conn.close()

    return [
        {
            "track_id": r[0],
            "mood": r[1],
            "vector": np.array(json.loads(r[2]))
        }
        for r in rows
    ]
