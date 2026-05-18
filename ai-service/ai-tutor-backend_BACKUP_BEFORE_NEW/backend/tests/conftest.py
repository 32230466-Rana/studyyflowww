"""Pytest configuration: set required environment variables before any imports."""
import os

# Provide dummy values so modules can be imported without a real DB or API key
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("OPENAI_API_KEY", "test-key")
