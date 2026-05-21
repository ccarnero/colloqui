#!/usr/bin/env python3
"""Quick test to verify NATS connectivity between test and bridge."""

import asyncio
import nats
import json

async def test_nats():
    nc = await nats.connect("nats://localhost:4222")
    
    # Test 1: Basic pub/sub
    received = []
    async def handler(msg):
        received.append(msg.data.decode())
        print(f"  Received: {msg.data.decode()[:50]}...")
    
    sub = await nc.subscribe("test.subject", cb=handler)
    await nc.publish("test.subject", b"Hello from test")
    await asyncio.sleep(1)
    
    if received:
        print("✅ NATS pub/sub works!")
    else:
        print("❌ NATS pub/sub failed - no message received")
    
    await sub.unsubscribe()
    
    # Test 2: Check if bridge is listening
    print("\n📡 Testing bridge subject...")
    
    # Subscribe to reply inbox
    inbox = "_INBOX.test"
    reply_sub = await nc.subscribe(inbox)
    
    # Publish to bridge subject
    envelope = {
        "specversion": "1.0",
        "id": "test-123",
        "source": "/test",
        "type": "test",
        "resource": "test",
        "time": "2024-01-01T00:00:00Z",
        "traceid": "test-trace",
        "tenant": "",
        "accountid": "test",
        "idempotencykey": "test",
        "producer": "test",
        "domain": "test",
        "channel": "test",
        "provider": "test",
        "transport": {"protocol": "internal", "depth": 0},
        "data": {"chat_id": "c1", "agent_id": "a1", "message": "hi", "turn_number": 1, "session_id": "s1", "timestamp": "2024-01-01T00:00:00Z"}
    }
    
    print(f"  Publishing to: evt..yoizenclaw.agent_outbound.v1")
    print(f"  Reply inbox: {inbox}")
    
    await nc.publish(
        "evt..yoizenclaw.agent_outbound.v1",
        json.dumps(envelope).encode(),
        reply=inbox
    )
    
    # Wait for response
    try:
        msg = await asyncio.wait_for(reply_sub.next_msg(), timeout=5.0)
        response = msg.data.decode()
        print(f"  ✅ Got reply ({len(response)} bytes): {response[:200]}...")
    except asyncio.TimeoutError:
        print("  ❌ Timeout - no reply from bridge")
    except Exception as e:
        print(f"  ❌ Error: {e}")
    
    await reply_sub.unsubscribe()
    await nc.close()

if __name__ == "__main__":
    asyncio.run(test_nats())
