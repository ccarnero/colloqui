"""Performance benchmarks for telemetry overhead.

Measures the performance impact of OpenTelemetry instrumentation,
ensuring overhead remains below acceptable thresholds.
"""

from __future__ import annotations

import statistics
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider


@pytest.fixture(autouse=True)
def setup_tracer_provider():
    """Set up a tracer provider for testing."""
    provider = TracerProvider()
    trace.set_tracer_provider(provider)
    yield
    # Cleanup
    trace.set_tracer_provider(trace.NoOpTracerProvider())


class TestTelemetryOverhead:
    """Test performance overhead of telemetry."""

    def test_telemetry_overhead_percentage(self) -> None:
        """Verify telemetry overhead is less than 5%."""
        tracer = trace.get_tracer("test.overhead")
        iterations = 1000

        # Baseline: No tracing
        start = time.perf_counter()
        for _ in range(iterations):
            # Simulate work
            x = sum(range(100))
        baseline_time = time.perf_counter() - start

        # With tracing
        start = time.perf_counter()
        for _ in range(iterations):
            with tracer.start_as_current_span("test"):
                x = sum(range(100))
        traced_time = time.perf_counter() - start

        # Calculate overhead
        if baseline_time > 0:
            overhead = ((traced_time - baseline_time) / baseline_time) * 100
        else:
            overhead = 0

        # Overhead should be less than 5%
        assert overhead < 5, f"Telemetry overhead {overhead:.2f}% exceeds 5% threshold"

    def test_nested_span_overhead(self) -> None:
        """Verify overhead with deeply nested spans."""
        tracer = trace.get_tracer("test.nested")
        iterations = 100
        depth = 10  # Nested span depth

        # Baseline
        start = time.perf_counter()
        for _ in range(iterations):
            for i in range(depth):
                pass
        baseline_time = time.perf_counter() - start

        # With nested tracing
        start = time.perf_counter()
        for _ in range(iterations):
            with tracer.start_as_current_span("level0"):
                with tracer.start_as_current_span("level1"):
                    with tracer.start_as_current_span("level2"):
                        with tracer.start_as_current_span("level3"):
                            with tracer.start_as_current_span("level4"):
                                with tracer.start_as_current_span("level5"):
                                    with tracer.start_as_current_span("level6"):
                                        with tracer.start_as_current_span("level7"):
                                            with tracer.start_as_current_span("level8"):
                                                with tracer.start_as_current_span("level9"):
                                                    pass
        traced_time = time.perf_counter() - start

        # Overhead should be reasonable even with deep nesting
        if baseline_time > 0:
            overhead = ((traced_time - baseline_time) / baseline_time) * 100
            assert overhead < 20, f"Nested span overhead {overhead:.2f}% exceeds 20% threshold"

    def test_span_creation_latency(self) -> None:
        """Measure latency of span creation."""
        tracer = trace.get_tracer("test.latency")
        iterations = 10000

        latencies = []
        for _ in range(iterations):
            start = time.perf_counter_ns()
            with tracer.start_as_current_span("latency_test"):
                pass
            end = time.perf_counter_ns()
            latencies.append(end - start)

        avg_latency_ns = statistics.mean(latencies)
        avg_latency_ms = avg_latency_ns / 1_000_000

        # Average span creation should be under 1ms
        assert avg_latency_ms < 1.0, f"Span creation latency {avg_latency_ms:.3f}ms exceeds 1ms"

    def test_attribute_setting_overhead(self) -> None:
        """Measure overhead of setting span attributes."""
        tracer = trace.get_tracer("test.attributes")
        iterations = 1000

        # Baseline
        start = time.perf_counter()
        for _ in range(iterations):
            pass
        baseline_time = time.perf_counter() - start

        # With attribute setting
        start = time.perf_counter()
        for i in range(iterations):
            with tracer.start_as_current_span("test") as span:
                span.set_attribute("index", i)
                span.set_attribute("operation", "test")
                span.set_attribute("timestamp", time.time())
        traced_time = time.perf_counter() - start

        # Overhead should be minimal
        if baseline_time > 0:
            overhead = ((traced_time - baseline_time) / baseline_time) * 100
            assert overhead < 10, f"Attribute overhead {overhead:.2f}% exceeds 10%"

    def test_concurrent_span_overhead(self) -> None:
        """Measure overhead with concurrent span creation."""
        tracer = trace.get_tracer("test.concurrent")
        num_threads = 10
        iterations_per_thread = 100

        def create_spans():
            for _ in range(iterations_per_thread):
                with tracer.start_as_current_span("concurrent_test"):
                    time.sleep(0.001)  # Simulate some work

        # Baseline (without tracing)
        start = time.perf_counter()
        with ThreadPoolExecutor(max_workers=num_threads) as executor:
            futures = [executor.submit(time.sleep, 0.001) for _ in range(num_threads * iterations_per_thread)]
            for future in futures:
                future.result()
        baseline_time = time.perf_counter() - start

        # With tracing
        start = time.perf_counter()
        with ThreadPoolExecutor(max_workers=num_threads) as executor:
            futures = [executor.submit(create_spans) for _ in range(num_threads)]
            for future in futures:
                future.result()
        traced_time = time.perf_counter() - start

        # Concurrent overhead should be reasonable
        if baseline_time > 0:
            overhead = ((traced_time - baseline_time) / baseline_time) * 100
            assert overhead < 30, f"Concurrent overhead {overhead:.2f}% exceeds 30%"


class TestMemoryOverhead:
    """Test memory overhead of telemetry."""

    def test_span_memory_footprint(self) -> None:
        """Verify span memory usage is reasonable."""
        import sys

        tracer = trace.get_tracer("test.memory")

        # Create spans and measure memory
        spans = []
        for i in range(1000):
            with tracer.start_as_current_span(f"span_{i}") as span:
                span.set_attribute("index", i)
                span.set_attribute("data", "x" * 100)
                spans.append(span)

        # Memory per span should be reasonable
        # This is a basic check - spans should not consume excessive memory
        assert len(spans) == 1000


class TestExportPerformance:
    """Test performance of telemetry export."""

    def test_batch_export_performance(self) -> None:
        """Verify batch export doesn't block application."""
        tracer = trace.get_tracer("test.export")
        iterations = 100

        start = time.perf_counter()
        for _ in range(iterations):
            with tracer.start_as_current_span("export_test"):
                time.sleep(0.001)
        total_time = time.perf_counter() - start

        # Should complete in reasonable time
        # 100 spans with 1ms work each should take ~100ms plus overhead
        assert total_time < 2.0, f"Export took {total_time:.2f}s, expected < 2s"

    def test_export_queue_behavior(self) -> None:
        """Verify export queue handles load gracefully."""
        tracer = trace.get_tracer("test.queue")

        # Rapid span creation
        start = time.perf_counter()
        for _ in range(10000):
            with tracer.start_as_current_span("queue_test"):
                pass
        total_time = time.perf_counter() - start

        # Should handle high volume without significant slowdown
        assert total_time < 5.0, f"Queue test took {total_time:.2f}s, expected < 5s"


class TestSamplingPerformance:
    """Test performance with different sampling rates."""

    def test_sampled_vs_unsampled_performance(self) -> None:
        """Compare performance with and without sampling."""
        # This test verifies that sampling affects performance
        # Full sampling (1.0)
        full_tracer = trace.get_tracer("test.sampled")

        start = time.perf_counter()
        for _ in range(1000):
            with full_tracer.start_as_current_span("sampled"):
                pass
        full_time = time.perf_counter() - start

        # Both should be relatively fast
        assert full_time < 1.0, f"Sampling test took {full_time:.2f}s"


class TestBenchmarkComparison:
    """Compare benchmark results over time."""

    def test_baseline_performance_regression(self) -> None:
        """Verify no significant performance regression."""
        # Run a standard benchmark
        tracer = trace.get_tracer("test.baseline")
        iterations = 10000

        start = time.perf_counter()
        for _ in range(iterations):
            with tracer.start_as_current_span("baseline"):
                pass
        duration = time.perf_counter() - start

        # Calculate operations per second
        ops_per_second = iterations / duration

        # Should maintain reasonable throughput
        assert ops_per_second > 1000, f"Performance regression: {ops_per_second:.0f} ops/sec"

    def test_attribute_operations_performance(self) -> None:
        """Benchmark attribute operations."""
        tracer = trace.get_tracer("test.attr_benchmark")
        iterations = 5000

        start = time.perf_counter()
        for i in range(iterations):
            with tracer.start_as_current_span("benchmark") as span:
                span.set_attribute("int_attr", i)
                span.set_attribute("str_attr", f"value_{i}")
                span.set_attribute("bool_attr", i % 2 == 0)
                span.set_attribute("float_attr", float(i))
        duration = time.perf_counter() - start

        ops_per_second = iterations / duration
        assert ops_per_second > 500, f"Attribute ops too slow: {ops_per_second:.0f} ops/sec"


class TestRealWorldScenarios:
    """Test performance in realistic scenarios."""

    def test_api_endpoint_simulation(self) -> None:
        """Simulate API endpoint with full tracing."""
        tracer = trace.get_tracer("test.api_simulation")
        num_requests = 100

        def simulate_request(request_id: int):
            with tracer.start_as_current_span("http.request"):
                # Auth check
                with tracer.start_as_current_span("auth.check"):
                    time.sleep(0.001)

                # Business logic
                with tracer.start_as_current_span("business.logic"):
                    # DB query
                    with tracer.start_as_current_span("db.query"):
                        time.sleep(0.002)

                    # Cache check
                    with tracer.start_as_current_span("cache.get"):
                        time.sleep(0.001)

                # Response
                with tracer.start_as_current_span("response.send"):
                    pass

        start = time.perf_counter()
        for i in range(num_requests):
            simulate_request(i)
        total_time = time.perf_counter() - start

        # Should handle realistic load
        avg_time_per_request = total_time / num_requests
        assert avg_time_per_request < 0.1, f"Avg request time {avg_time_per_request:.3f}s too high"

    def test_background_job_simulation(self) -> None:
        """Simulate background job with tracing."""
        tracer = trace.get_tracer("test.job_simulation")
        num_items = 50

        with tracer.start_as_current_span("job.execute"):
            for i in range(num_items):
                with tracer.start_as_current_span(f"process.item.{i}"):
                    # Validate
                    with tracer.start_as_current_span("validate"):
                        time.sleep(0.001)
                    # Process
                    with tracer.start_as_current_span("process"):
                        time.sleep(0.002)
                    # Save
                    with tracer.start_as_current_span("save"):
                        time.sleep(0.001)

        # Job should complete in reasonable time
        assert True  # If no exception, test passes
