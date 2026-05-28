import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import scoped_session, sessionmaker

from log import log
from models import Base

# IMPORTANT: Render Postgres URL
DATABASE_URL = os.getenv("postgresql://kwalify_user:jcHV2PF8lIaL7jk564kadooToMThnAR8@dpg-d8cco3h9rddc73d7e1j0-a.frankfurt-postgres.render.com/kwalify")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL missing")

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

Session = scoped_session(
    sessionmaker(bind=engine, autocommit=False, autoflush=False)
)

_db_ready = False


def init_db():
    global _db_ready
    if _db_ready:
        return

    Base.metadata.create_all(engine)
    _apply_migrations()
    _db_ready = True


def _apply_migrations():
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
            log("INFO", "db", "migration: sync_retry_after added")


def get_db():
    return Session()
