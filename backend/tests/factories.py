"""factory_boy factories for AIPiloty models.

Usage:
    from tests.factories import ChatSessionFactory, ChatMessageFactory
    session = ChatSessionFactory.build()
    message = ChatMessageFactory.build(session_id=1)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import factory


class ChatSessionFactory(factory.Factory):
    class Meta:
        model = dict  # Plain dict — no DB interaction needed in unit tests

    session_key = factory.LazyFunction(lambda: uuid.uuid4().hex)
    title = factory.Sequence(lambda n: f"Test Session {n}")
    created_at = factory.LazyFunction(lambda: datetime.now(timezone.utc).isoformat())
    updated_at = factory.LazyFunction(lambda: datetime.now(timezone.utc).isoformat())


class ChatMessageFactory(factory.Factory):
    class Meta:
        model = dict

    session_id = 1
    role = "user"
    content = factory.Sequence(lambda n: f"Test message {n}")
    tool_calls_json = None
    tool_results_json = None
    final_report_json = None
    attachments_json = None
    created_at = factory.LazyFunction(lambda: datetime.now(timezone.utc).isoformat())


class UserMessageFactory(ChatMessageFactory):
    role = "user"
    content = factory.Sequence(lambda n: f"User question {n}")


class AssistantMessageFactory(ChatMessageFactory):
    role = "assistant"
    content = factory.Sequence(lambda n: f"Assistant reply {n}")
