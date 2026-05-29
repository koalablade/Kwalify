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

    # FIXED MISSING FIELDS 👇
    acousticness = Column(Float, default=0)
    instrumentalness = Column(Float, default=0)
    speechiness = Column(Float, default=0)
    liveness = Column(Float, default=0)
