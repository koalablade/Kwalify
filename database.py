import os

from sqlalchemy import create_engine, text
from sqlalchemy.orm import scoped_session, sessionmaker

from log import log
from models import Base

# ==========================================
# DATABASE URL (FROM RENDER ENV VAR)
# ==========================================

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is missing (set it in Render environment variables)"
    )

# Render sometimes gives postgres://
# SQLAlchemy prefers postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace(
        "postgres://",
        "postgresql://",
        1
    )

# ==========================================
# ENGINE
# ==========================================

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

Session = scoped_session(
    sessionmaker(
        bind=engine,
        autocommit=False,
        autoflush=False
    )
)

_db_ready = False


# ==========================================
# INIT
# ==========================================

def init_db():
    global _db_ready

    if _db_ready:
        return

    Base.metadata.create_all(engine)

    _apply_migrations()

    _db_ready = True


# ==========================================
# MIGRATIONS
# ==========================================

def _apply_migrations():

    with engine.connect() as conn:

        result = conn.execute(text("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name='users'
        """))

        cols = {row[0] for row in result.fetchall()}

        if "sync_retry_after" not in cols:

            conn.execute(text("""
                ALTER TABLE users
                ADD COLUMN sync_retry_after TIMESTAMP
            """))

            conn.commit()

            log(
                "INFO",
                "db",
                "migration applied: sync_retry_after added"
            )


# ==========================================
# SESSION
# ==========================================

def get_db():
    return Session()
