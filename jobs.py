"""
jobs.py — background Spotify sync jobs
"""

from database import SessionLocal
from sync_service import run_incremental_sync


def sync_user_job(user_id):
    """
    Runs in background worker (NOT Flask)
    """

    db = SessionLocal()

    try:
        print(f"🔄 Sync started for {user_id}")

        # Replace None with real Spotify client later
        sp = None  

        run_incremental_sync(user_id, sp, db)

        print(f"✅ Sync finished for {user_id}")

    except Exception as e:
        print("❌ Sync failed:", str(e))

    finally:
        db.close()