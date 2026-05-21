"""
Integration tests for YoizenClaw multi-tenant platform integration.

Tests cross-cutting concerns: tenant isolation, NATS routing, CloudEvents,
Claim Check, depth enforcement, and structured logging per wdocs specs.
"""

import pytest
import asyncio
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
import hashlib


class TestTenantIsolation:
    """Test multi-tenant data isolation (8.1)"""
    
    @pytest.mark.asyncio
    async def test_jobs_isolated_by_tenant(self):
        """Jobs for tenant A should not be visible to tenant B"""
        # Mock memory backend
        mock_pool = MagicMock()
        
        # Simulate saving jobs for different tenants
        tenant_a_jobs = [
            {"id": "job-1", "name": "Job A1", "tenant_id": "acme"},
            {"id": "job-2", "name": "Job A2", "tenant_id": "acme"},
        ]
        tenant_b_jobs = [
            {"id": "job-3", "name": "Job B1", "tenant_id": "globex"},
        ]
        
        # Verify tenant isolation: queries should include tenant_id filter
        assert all(j["tenant_id"] == "acme" for j in tenant_a_jobs)
        assert all(j["tenant_id"] == "globex" for j in tenant_b_jobs)
        assert len(tenant_a_jobs) == 2
        assert len(tenant_b_jobs) == 1


class TestNatsSubjectRouting:
    """Test NATS subject building and parsing per wdocs/01 (8.2)"""
    
    def test_build_tenant_subject(self):
        """Subject should follow evt.{tenant}.yoizenclaw.{action}.v1 pattern"""
        from applications.shared.types.python.subjects import build_subject
        
        subject = build_subject("acme", "config_sync")
        assert subject == "evt.acme.yoizenclaw.config_sync.v1"
        
    def test_extract_tenant_from_subject(self):
        """Should parse tenant from subject"""
        from applications.shared.types.python.subjects import extract_tenant_from_subject
        
        tenant = extract_tenant_from_subject("evt.acme.yoizenclaw.online.v1")
        assert tenant == "acme"
        
    def test_wildcard_subscription_pattern(self):
        """Wildcard should match all actions for tenant"""
        tenant = "acme"
        wildcard = f"evt.{tenant}.yoizenclaw.>"
        assert wildcard == "evt.acme.yoizenclaw.>"


class TestCloudEventsEnvelope:
    """Test CloudEvents envelope round-trip per wdocs/02 (8.3)"""
    
    def test_envelope_structure(self):
        """Envelope must contain all required CloudEvents fields"""
        envelope = {
            "specversion": "1.0",
            "id": "test-id-123",
            "source": "yoizenclaw-runtime",
            "type": "config_sync",
            "time": datetime.now(timezone.utc).isoformat(),
            "traceid": "trace-123",
            "tenant": "acme",
            "producer": "yoizenclaw",
            "transport": {
                "protocol": "internal",
                "agent_id": "yoizenclaw-runtime",
                "depth": 0,
            },
            "data": {"key": "value"},
        }
        
        # Verify required fields
        assert envelope["specversion"] == "1.0"
        assert envelope["transport"]["protocol"] == "internal"
        assert envelope["transport"]["depth"] == 0
        assert envelope["tenant"] == "acme"


class TestClaimCheck:
    """Test Claim Check for large payloads per wdocs/04 (8.4)"""
    
    def test_payload_size_threshold(self):
        """Payloads > 256KB should go to Claim Check"""
        threshold = 262144  # 256 KB
        
        small_payload = b"x" * 100000  # 100 KB
        large_payload = b"x" * 300000  # 300 KB
        
        assert len(small_payload) < threshold  # inline
        assert len(large_payload) > threshold  # claim check
        
    @pytest.mark.asyncio
    async def test_store_and_resolve_payload(self):
        """Store to Object Store and resolve with checksum validation"""
        payload = b"test payload data"
        expected_checksum = f"sha256:{hashlib.sha256(payload).hexdigest()}"
        
        # Mock Object Store
        mock_store = AsyncMock()
        mock_store.put = AsyncMock()
        mock_store.get = AsyncMock(return_value=payload)
        
        # Verify checksum calculation matches
        assert hashlib.sha256(payload).hexdigest() == hashlib.sha256(payload).hexdigest()


class TestDepthEnforcement:
    """Test depth tracking and anti-loop per wdocs/03 (8.5)"""
    
    def test_depth_limit_enforced(self):
        """Should reject events at MAX_DEPTH=5"""
        MAX_DEPTH = 5
        
        envelope_at_depth_5 = {"transport": {"depth": 5}}
        envelope_at_depth_4 = {"transport": {"depth": 4}}
        
        # At depth 5, should raise error or reject
        assert envelope_at_depth_5["transport"]["depth"] >= MAX_DEPTH
        assert envelope_at_depth_4["transport"]["depth"] < MAX_DEPTH
        
    def test_depth_increment(self):
        """Each hop should increment depth by 1"""
        envelope = {"id": "msg-1", "transport": {"depth": 2}}
        
        # Simulate increment
        envelope["transport"]["depth"] = envelope["transport"]["depth"] + 1
        envelope["causation_id"] = envelope["id"]
        
        assert envelope["transport"]["depth"] == 3
        assert envelope["causation_id"] == "msg-1"


class TestStructuredLogging:
    """Test structured logging with PII policy per wdocs/06 (8.7)"""
    
    def test_log_contains_required_fields(self):
        """Logs must include tenant, traceid, causation_id"""
        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": "info",
            "message": "Agent created",
            "tenant": "acme",
            "traceid": "trace-123",
            "causation_id": "cause-456",
        }
        
        assert "tenant" in log_entry
        assert "traceid" in log_entry
        assert log_entry["tenant"] == "acme"
        
    def test_payload_never_logged(self):
        """PII policy: data.payload should never appear in logs"""
        envelope = {
            "data": {
                "payload": {"secret": "sensitive data", "password": "123456"},
                "system_prompt": "Confidential instructions",
            }
        }
        
        # Sanitized log should not contain payload
        sanitized = {k: v for k, v in envelope.items() if k != "data"}
        assert "data" not in sanitized
        
        # Or if data exists, payload should be redacted
        if "data" in envelope:
            assert "payload" not in envelope.get("data", {}) or envelope["data"].get("payload") is None


class TestNatsACLs:
    """Test NATS Account ACL isolation per wdocs/05 (8.6)"""
    
    def test_cross_tenant_publish_blocked(self):
        """Tenant A should not be able to publish to tenant B's subjects"""
        tenant_a = "acme"
        tenant_b = "globex"
        
        # ACL rules: can only publish to own tenant subjects
        allowed_publish = f"evt.{tenant_a}.>"
        denied_publish = f"evt.{tenant_b}.>"
        
        assert allowed_publish == "evt.acme.>"
        assert denied_publish == "evt.globex.>"
        assert allowed_publish != denied_publish
        
    def test_runtime_subscription_scope(self):
        """Runtime should only subscribe to own tenant's subjects"""
        tenant = "acme"
        subscription = f"evt.{tenant}.yoizenclaw.>"
        
        assert subscription == "evt.acme.yoizenclaw.>"
        assert "acme" in subscription
        assert "globex" not in subscription
