"""
worker.py — runs background jobs (Render worker service)
"""

import os
import redis
from rq import Worker, Queue, Connection

listen = ["default"]

redis_conn = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"))

if __name__ == "__main__":
    with Connection(redis_conn):
        worker = Worker(list(map(Queue, listen)))
        worker.work()