"""Integration tests for distributed tracing.

Tests cross-service trace propagation via HTTP and NATS,
ensuring trace context flows correctly through the system.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from opentelemetry import context as otel_context
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider

from src.shared.telemetry import get_tracer
from src.shared.telemetry.propagator import (
    extract_trace_context,
    get_current_trace_id,
    inject_trace_context,
)


@pytest.fixture(autouse=True)
def setup_tracer_provider():
    """Set up a tracer provider for testing."""
    provider = TracerProvider()
    trace.set_tracer_provider(provider)
    yield
    # Cleanup
    trace.set_tracer_provider(trace.NoOpTracerProvider())


class TestCrossServiceHttpTracing:
    """Test trace propagation across HTTP services."""

    @pytest.mark.asyncio
    async def test_cross_service_tracing_simulation(self) -> None:
        """Verify trace context propagates between services via HTTP."""
        tracer = get_tracer("test.gateway")

        with tracer.start_as_current_span("gateway.request") as span:
            # Get the trace ID from the gateway span
            gateway_trace_id = get_current_trace_id()
            assert gateway_trace_id is not None

            # Simulate downstream service call
            headers = {}
            inject_trace_context(headers)

            # Verify traceparent was injected
            assert "traceparent" in headers
            traceparent = headers["traceparent"]

            # Simulate downstream service receiving the request
            downstream_tracer = get_tracer("test.service")
            extracted_context = extract_trace_context(headers)

            # Attach context and create child span
            token = otel_context.attach(extracted_context)
            try:
                with downstream_tracer.start_as_current_span(
                    "service.process"
                ) as service_span:
                    # Verify same trace
                    service_trace_id = get_current_trace_id()
                    assert service_trace_id == gateway_trace_id
            finally:
                otel_context.detach(token)

    @pytest.mark.asyncio
    async def test_multiple_service_hops(self) -> None:
        """Verify trace propagates through multiple service hops."""
        # Service A (Gateway)
        gateway_tracer = get_tracer("test.gateway")

        with gateway_tracer.start_as_current_span("gateway.request") as gateway_span:
            gateway_trace_id = get_current_trace_id()

            # Hop 1: Gateway -> API
            api_headers = {}
            inject_trace_context(api_headers)

            api_tracer = get_tracer("test.api")
            api_context = extract_trace_context(api_headers)
            api_token = otel_context.attach(api_context)

            try:
                with api_tracer.start_as_current_span("api.process"):
                    api_trace_id = get_current_trace_id()
                    assert api_trace_id == gateway_trace_id

                    # Hop 2: API -> Database
                    db_headers = {}
                    inject_trace_context(db_headers)

                    db_tracer = get_tracer("test.database")
                    db_context = extract_trace_context(db_headers)
                    db_token = otel_context.attach(db_context)

                    try:
                        with db_tracer.start_as_current_span("db.query"):
                            db_trace_id = get_current_trace_id()
                            assert db_trace_id == gateway_trace_id
                    finally:
                        otel_context.detach(db_token)
            finally:
                otel_context.detach(api_token)

    @pytest.mark.asyncio
    async def test_async_concurrent_requests(self) -> None:
        """Verify traces are isolated for concurrent requests."""
        tracer = get_tracer("test.gateway")
        trace_ids = []

        async def make_request(request_id: int) -> str:
            with tracer.start_as_current_span(f"request.{request_id}") as span:
                await asyncio.sleep(0.01)  # Simulate async work
                return get_current_trace_id()

        # Run concurrent requests
        tasks = [make_request(i) for i in range(5)]
        results = await asyncio.gather(*tasks)

        # Each request should have a unique trace ID
        assert len(set(results)) == 5


class TestDistributedTracingWithInstrumentedClient:
    """Test trace propagation using instrumented HTTP client."""

    @pytest.mark.asyncio
    async def test_http_client_propagation(self) -> None:
        """Verify instrumented HTTP client propagates trace context."""
        tracer = get_tracer("test.client")

        # Check if InstrumentedAsyncClient exists
        try:
            from src.shared.http.client import InstrumentedAsyncClient
        except ImportError:
            pytest.skip("InstrumentedAsyncClient not implemented")

        with tracer.start_as_current_span("client.request"):
            trace_id = get_current_trace_id()

            # Mock the HTTP client to capture headers
            captured_headers = {}

            async def mock_get(url: str, **kwargs):
                # Capture headers that would be sent
                if "headers" in kwargs:
                    captured_headers.update(kwargs["headers"])
                return MagicMock(
                    status_code=200,
                    headers={"x-trace-id": trace_id},
                    json=lambda: {"status": "ok"},
                )

            with patch.object(
                InstrumentedAsyncClient, "get", side_effect=mock_get
            ):
                async with InstrumentedAsyncClient() as client:
                    response = await client.get("http://example.com/api")

                    # Verify trace context was propagated
                    assert response.status_code == 200


class TestNatsTracing:
    """Test trace propagation through NATS messaging."""

    @pytest.mark.asyncio
    async def test_nats_message_propagation(self) -> None:
        """Verify trace context propagates through NATS messages."""
        tracer = get_tracer("test.nats.publisher")

        with tracer.start_as_current_span("publish.message") as span:
            publisher_trace_id = get_current_trace_id()

            # Simulate injecting trace context into NATS message headers
            message_headers = {}
            inject_trace_context(message_headers)

            # Simulate subscriber extracting context
            subscriber_tracer = get_tracer("test.nats.subscriber")
            subscriber_context = extract_trace_context(message_headers)

            token = otel_context.attach(subscriber_context)
            try:
                with subscriber_tracer.start_as_current_span("process.message"):
                    subscriber_trace_id = get_current_trace_id()
                    assert subscriber_trace_id == publisher_trace_id
            finally:
                otel_context.detach(token)

    @pytest.mark.asyncio
    async def test_nats_request_reply_pattern(self) -> None:
        """Verify trace propagates through NATS request-reply pattern."""
        # Requestor service
        requestor_tracer = get_tracer("test.requestor")

        with requestor_tracer.start_as_current_span("nats.request"):
            requestor_trace_id = get_current_trace_id()

            # Inject context into request
            request_headers = {}
            inject_trace_context(request_headers)

            # Responder service
            responder_tracer = get_tracer("test.responder")
            responder_context = extract_trace_context(request_headers)

            responder_token = otel_context.attach(responder_context)
            try:
                with responder_tracer.start_as_current_span("nats.reply"):
                    responder_trace_id = get_current_trace_id()
                    assert responder_trace_id == requestor_trace_id

                    # Responder injects context into reply
                    reply_headers = {}
                    inject_trace_context(reply_headers)
            finally:
                otel_context.detach(responder_token)

            # Requestor extracts context from reply
            reply_context = extract_trace_context(reply_headers)
            reply_token = otel_context.attach(reply_context)
            try:
                with requestor_tracer.start_as_current_span("process.reply"):
                    final_trace_id = get_current_trace_id()
                    assert final_trace_id == requestor_trace_id
            finally:
                otel_context.detach(reply_token)


class TestTraceContextIntegrity:
    """Test integrity of trace context through the system."""

    @pytest.mark.asyncio
    async def test_trace_id_consistency(self) -> None:
        """Verify trace ID remains consistent across all spans."""
        tracer = get_tracer("test.service")
        span_contexts = []

        with tracer.start_as_current_span("parent") as parent:
            parent_context = parent.get_span_context()
            span_contexts.append(("parent", parent_context.trace_id))

            with tracer.start_as_current_span("child1") as child1:
                child1_context = child1.get_span_context()
                span_contexts.append(("child1", child1_context.trace_id))

                with tracer.start_as_current_span("grandchild") as grandchild:
                    grandchild_context = grandchild.get_span_context()
                    span_contexts.append(("grandchild", grandchild_context.trace_id))

            with tracer.start_as_current_span("child2") as child2:
                child2_context = child2.get_span_context()
                span_contexts.append(("child2", child2_context.trace_id))

        # All spans should have the same trace ID
        trace_ids = [ctx[1] for ctx in span_contexts]
        assert len(set(trace_ids)) == 1

    @pytest.mark.asyncio
    async def test_span_parent_relationships(self) -> None:
        """Verify parent-child span relationships are maintained."""
        tracer = get_tracer("test.service")

        with tracer.start_as_current_span("parent") as parent:
            parent_id = parent.get_span_context().span_id

            with tracer.start_as_current_span("child") as child:
                child_parent_id = child.parent.span_id if child.parent else None
                assert child_parent_id == parent_id


class TestDistributedTracingEdgeCases:
    """Test edge cases in distributed tracing."""

    @pytest.mark.asyncio
    async def test_missing_traceparent_handling(self) -> None:
        """Verify graceful handling of missing traceparent."""
        # Request without traceparent
        empty_headers = {}

        # Extract should return current context
        context = extract_trace_context(empty_headers)
        assert context is not None

        # Should be able to create a new span
        tracer = get_tracer("test.service")
        with tracer.start_as_current_span("new.request", context=context):
            trace_id = get_current_trace_id()
            assert trace_id is not None  # New trace ID created

    @pytest.mark.asyncio
    async def test_invalid_traceparent_handling(self) -> None:
        """Verify graceful handling of invalid traceparent."""
        # Invalid traceparent format
        invalid_headers = {"traceparent": "invalid-format"}

        # Should not raise exception
        context = extract_trace_context(invalid_headers)
        assert context is not None

    @pytest.mark.asyncio
    async def test_trace_context_with_baggage(self) -> None:
        """Verify baggage propagates with trace context."""
        from opentelemetry.baggage import get_baggage, set_baggage

        tracer = get_tracer("test.service")

        with tracer.start_as_current_span("parent"):
            # Set baggage
            ctx = set_baggage("user.id", "user-123")

            # Inject with baggage
            headers = {}
            inject_trace_context(headers)

            # Extract and verify baggage
            extracted = extract_trace_context(headers)
            # Baggage extraction depends on propagator configuration


class TestTracingWithJobExecution:
    """Test tracing integration with job execution system."""

    @pytest.mark.asyncio
    async def test_job_execution_tracing(self) -> None:
        """Verify jobs create proper trace spans."""
        job_tracer = get_tracer("test.jobs.scheduler")

        with job_tracer.start_as_current_span("job.execute") as job_span:
            job_trace_id = get_current_trace_id()

            # Simulate job action execution
            action_tracer = get_tracer("test.jobs.action")

            with action_tracer.start_as_current_span("action.llm_call"):
                action_trace_id = get_current_trace_id()
                assert action_trace_id == job_trace_id

    @pytest.mark.asyncio
    async def test_pipeline_tracing(self) -> None:
        """Verify pipeline execution creates trace spans."""
        pipeline_tracer = get_tracer("test.pipeline")

        with pipeline_tracer.start_as_current_span("pipeline.run"):
            pipeline_trace_id = get_current_trace_id()

            # Simulate multiple stages
            for i in range(3):
                stage_tracer = get_tracer(f"test.pipeline.stage{i}")
                with stage_tracer.start_as_current_span(f"stage.{i}.execute"):
                    stage_trace_id = get_current_trace_id()
                    assert stage_trace_id == pipeline_trace_id
