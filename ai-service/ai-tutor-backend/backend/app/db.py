from pathlib import Path
import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base


# Load backend/.env manually
BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")

DATABASE_URL = os.getenv("DATABASE_URL")

# Lazy engine: only create if DATABASE_URL is available
if DATABASE_URL:
    engine = create_engine(DATABASE_URL)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
else:
    engine = None
    SessionLocal = None

Base = declarative_base()


def get_db():
    if SessionLocal is None:
        raise RuntimeError(
            "DATABASE_URL environment variable is not set. "
            "Please configure it in backend/.env file."
        )

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()