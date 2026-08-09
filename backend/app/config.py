import os
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # Core Server Configuration
    PORT: int = 8000
    HOST: str = "0.0.0.0"
    ENV: str = "development"

    # AI Model Keys
    GEMINI_API_KEY: str | None = None
    GEMINI_MODEL: str = "gemini-3.5-flash"


    # TTS Setup
    ELEVEN_LABS_API_KEY: str | None = None
    ELEVEN_LABS_VOICE_ID: str = "21m00Tcm4TlvDq8ikWAM"

    # DB & Vector Path Settings
    DATABASE_URL: str = "sqlite:///./data/nightai.db"
    CHROMA_DB_PATH: str = "./data/chroma_db"

    # Agent OAuth/Credentials Configuration
    SPOTIFY_CLIENT_ID: str | None = None
    SPOTIFY_CLIENT_SECRET: str | None = None
    SPOTIFY_REDIRECT_URI: str = "http://localhost:8000/api/v1/auth/spotify/callback"

    GOOGLE_CLIENT_ID: str | None = None
    GOOGLE_CLIENT_SECRET: str | None = None
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/v1/auth/google/callback"

    SLACK_BOT_TOKEN: str | None = None
    GMAIL_CREDENTIALS_JSON: str | None = None

    NOTION_API_KEY: str | None = None
    NOTION_DATABASE_ID: str | None = None


def get_settings() -> Settings:
    return Settings()

# Instantiate configuration settings
settings = Settings()

# Ensure local data folder exists
os.makedirs("./data", exist_ok=True)

