import os

from sqlalchemy import create_engine, text
from sqlalchemy.orm import scoped_session, sessionmaker

from log import log
from models import Base

# =========================================================
# DATABASE CONFIG (Render-safe)
# =========================================================

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is missing (set it in Render env vars)")

# Detect if using Postgres vs SQLite
is_sqlite = DATABASE_URL.startswith("sqlite")

connect_args = {}
engine_kwargs = {
    "pool_pre_ping": True,
}

# SQLite needs special config
if is_sqlite:
    connect_args = {"check_same_thread": False}
    engine_kwargs["connect_args"] = connect_args

# Postgres-safe pooling
engine_kwargs.update(
    {
        "pool_size": 5,
        "max_overflow": 10,
    }
)

engine = create_engine(DATABASE_URL, **engine_kwargs)

Session = scoped_session(
    sessionmaker(bind=engine, autocommit=False, autoflush=False)
)

_db_ready = False


# =========================================================
# INIT DB
# =========================================================

def init_db():
    global _db_ready

    if _db_ready:
        return

    Base.metadata.create_all(engine)
    _apply_migrations()
    _db_ready = True

    log("INFO", "db", "Database initialized")


# =========================================================
# MIGRATIONS (safe additive only)
# =========================================================

def _apply_migrations():
    if DATABASE_URL.startswith("sqlite"):
        # SQLite migration safety
        with engine.connect() as conn:
            cols = {
                row[1]
                for row in conn.execute(text("PRAGMA table_info(users)")).fetchall()
            }

            if "sync_retry_after" not in cols:
                conn.execute(
                    text("ALTER TABLE users ADD COLUMN sync_retry_after DATETIME")
                )
                conn.commit()
                log("INFO", "db", "Added sync_retry_after (SQLite)")
        return

    # Postgres migration
    with engine.connect() as conn:
        result = conn.execute(
            text("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name='users'
            """)
        )

        cols = {row[0] for row in result.fetchall()}

        if "sync_retry_after" not in cols:
            conn.execute(
                text("ALTER TABLE users ADD COLUMN sync_retry_after TIMESTAMP")
            )
            conn.commit()
            log("INFO", "db", "Added sync_retry_after (Postgres)")


# =========================================================
# SESSION HANDLER
# =========================================================

def get_db():
    return Session()
