"""Session-based conversation memory store for runtime."""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional
import time

logger = logging.getLogger(__name__)


@dataclass
class ConversationTurn:
    """Single conversation turn."""
    role: str  # "user" or "assistant"
    content: str
    turn_number: int
    timestamp: datetime
    chat_id: str


@dataclass
class ConversationSession:
    """Conversation session with turn history."""
    session_id: str
    agent_id: str
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    turns: List[ConversationTurn] = field(default_factory=list)
    last_accessed: float = field(default_factory=time.time)
    
    def add_turn(self, turn: ConversationTurn) -> None:
        """Add a turn to the conversation."""
        self.turns.append(turn)
        self.last_accessed = time.time()
    
    def get_context(self, max_turns: int = 10) -> List[ConversationTurn]:
        """Get conversation context up to max_turns."""
        return self.turns[-max_turns:] if self.turns else []
    
    def get_last_turn_number(self) -> int:
        """Get the last turn number."""
        return self.turns[-1].turn_number if self.turns else 0


class ConversationMemoryStore:
    """In-memory store for conversation sessions with TTL and cleanup."""
    
    def __init__(self, max_sessions: int = 10000, session_ttl_seconds: int = 3600):
        self.max_sessions = max_sessions
        self.session_ttl_seconds = session_ttl_seconds
        self.sessions: Dict[str, ConversationSession] = {}
        self._lock = asyncio.Lock()
        self._cleanup_task: Optional[asyncio.Task] = None
        
    async def start_cleanup_task(self) -> None:
        """Start background cleanup task."""
        if self._cleanup_task is None:
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())
    
    async def stop_cleanup_task(self) -> None:
        """Stop background cleanup task."""
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
            self._cleanup_task = None
    
    async def add_turn(
        self,
        session_id: str,
        agent_id: str,
        chat_id: str,
        role: str,
        content: str,
        turn_number: int,
        timestamp: Optional[datetime] = None
    ) -> None:
        """Add a turn to a conversation session."""
        async with self._lock:
            if session_id not in self.sessions:
                # Enforce max sessions limit
                if len(self.sessions) >= self.max_sessions:
                    # Remove oldest session
                    oldest_session_id = min(
                        self.sessions.keys(),
                        key=lambda sid: self.sessions[sid].last_accessed
                    )
                    del self.sessions[oldest_session_id]
                    logger.info(f"Evicted oldest session: {oldest_session_id}")
                
                self.sessions[session_id] = ConversationSession(
                    session_id=session_id,
                    agent_id=agent_id
                )
            
            session = self.sessions[session_id]
            turn = ConversationTurn(
                role=role,
                content=content,
                turn_number=turn_number,
                timestamp=timestamp or datetime.now(timezone.utc),
                chat_id=chat_id
            )
            session.add_turn(turn)
    
    async def get_context(
        self,
        session_id: str,
        max_turns: int = 10
    ) -> List[ConversationTurn]:
        """Get conversation context for a session."""
        async with self._lock:
            session = self.sessions.get(session_id)
            if session:
                session.last_accessed = time.time()
                return session.get_context(max_turns)
            return []
    
    async def get_session_info(self, session_id: str) -> Optional[ConversationSession]:
        """Get session information."""
        async with self._lock:
            session = self.sessions.get(session_id)
            if session:
                session.last_accessed = time.time()
                return session
            return None
    
    async def delete_session(self, session_id: str) -> bool:
        """Delete a conversation session."""
        async with self._lock:
            if session_id in self.sessions:
                del self.sessions[session_id]
                return True
            return False
    
    async def _cleanup_loop(self) -> None:
        """Background cleanup loop for expired sessions."""
        while True:
            try:
                await asyncio.sleep(300)  # Check every 5 minutes
                await self._cleanup_expired_sessions()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.exception(f"Error in cleanup loop: {e}")
    
    async def _cleanup_expired_sessions(self) -> None:
        """Clean up expired sessions."""
        current_time = time.time()
        expired_sessions = []
        
        async with self._lock:
            for session_id, session in self.sessions.items():
                if current_time - session.last_accessed > self.session_ttl_seconds:
                    expired_sessions.append(session_id)
            
            for session_id in expired_sessions:
                del self.sessions[session_id]
        
        if expired_sessions:
            logger.info(f"Cleaned up {len(expired_sessions)} expired sessions")


# Global instance
_conversation_store: Optional[ConversationMemoryStore] = None


def get_conversation_store() -> ConversationMemoryStore:
    """Get the global conversation memory store."""
    global _conversation_store
    if _conversation_store is None:
        _conversation_store = ConversationMemoryStore()
    return _conversation_store
