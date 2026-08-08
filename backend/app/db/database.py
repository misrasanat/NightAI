from datetime import datetime
from sqlmodel import Field, SQLModel, create_engine, Session
from app.config import settings

# Set up SQLite or PostgreSQL engine
connect_args = {"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {}
engine = create_engine(settings.DATABASE_URL, connect_args=connect_args)


class UserPreferences(SQLModel, table=True):
    """Stores key-value pair preferences (e.g. user's name, theme, custom configurations)."""
    id: int | None = Field(default=None, primary_key=True)
    key: str = Field(index=True, unique=True)
    value: str


class InteractionLog(SQLModel, table=True):
    """Audit log of commands handled by NightAI."""
    id: int | None = Field(default=None, primary_key=True)
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    user_query: str
    intent: str
    response: str
    success: bool


def init_db():
    """Initializes schema tables inside the database."""
    SQLModel.metadata.create_all(engine)
    print("Database tables initialized successfully.")


def get_session():
    """Dependency injector yielding a SQL session."""
    with Session(engine) as session:
        yield session
