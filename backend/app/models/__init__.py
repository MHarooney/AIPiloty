# Import all models so Alembic can auto-detect them.
from .chat import ChatSession, ChatMessage  # noqa: F401
from .testing import TestingTarget, TestRun, TestResult  # noqa: F401
