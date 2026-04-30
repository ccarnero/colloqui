#!/usr/bin/env python3
"""Test NATS bridge from inside the container."""

import asyncio
import nats
import json

async def test_from_inside():
    nc = await nats.connect("nats://nats:4222")
    
    print("🔗 Connected to NATS from inside container")
    
    # Subscribe to test subject
    received = []
    async def handler(msg):
        received.append(msg.data.decode())
        print(f"📨 Bridge received: {msg.subject}")
        print(f"   Data: {msg.data.decode()[:100]}...")
        print(f"   Reply: {msg.reply}")
        
        # Send response back
        if msg.reply:
            response = {"test": "response from bridge"}
            await nc.publish(msg.reply, json.dumps(response).encode())
            print(f"📤 Sent response to {msg.reply}")
    
    # Subscribe to the bridge subject
    sub = await nc.subscribe("evt..yoizenclaw.agent_outbound.v1", cb=handler)
    print("📡 Subscribed to evt..yoizenclaw.agent_outbound.v1")
    
    # Publish a test message
    inbox = "_INBOX.test_inside"
    reply_sub = await nc.subscribe(inbox)
    
    envelope = {
        "specversion": "1.0",
        "id": "test-inside",
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
    
    print(f"\n📤 Publishing to evt..yoizenclaw.agent_outbound.v1")
    await nc.publish(
        "evt..yoizenclaw.agent_outbound.v1",
        json.dumps(envelope).encode(),
        reply=inbox
    )
    
    # Wait for response
    try:
        msg = await asyncio.wait_for(reply_sub.next_msg(), timeout=5.0)
        print(f"\n✅ Got response: {msg.data.decode()}")
    except asyncio.TimeoutError:
        print(f"\n❌ No response received")
    
    await sub.unsubscribe()
    await reply_sub.unsubscribe()
    await nc.close()

if __name__ == "__main__":
    asyncio.run(test_from_inside())
