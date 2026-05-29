from sqlalchemy import Column, Integer, String, Float, DateTime
from datetime import datetime
from database import Base


class UserTrackMemory(Base):
    __tablename__ = "user_track_memory"

    id = Column(Integer, primary_key=True)

    user_id = Column(Integer, index=True)
    track_id = Column(String, index=True)

    emotion = Column(String)
    score = Column(Float)

    last_seen = Column(DateTime, default=datetime.utcnow)
