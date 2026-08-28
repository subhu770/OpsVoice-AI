# test_websocket.py
# Automated client test for verifying WebSocket connectivity and ping-handling logic in backend/app.py

import json
import time
import websocket

def run_test():
    url = "ws://127.0.0.1:5000/ws/agent"
    print(f"Connecting to WebSocket endpoint at {url}...")
    
    # Connect
    ws = websocket.create_connection(url)
    print("Connection established!")
    
    # 1. Wait for session ready or greeting message
    print("\n--- Test 1: Receiving initial session/greeting message ---")
    msg1 = ws.recv()
    print(f"Received initial message 1: {msg1}")
    data1 = json.loads(msg1)
    assert data1.get("type") == "session.ready", f"Expected session.ready, got: {msg1}"
    
    msg2 = ws.recv()
    print(f"Received initial message 2 (greeting): {msg2}")
    data2 = json.loads(msg2)
    assert data2.get("type") == "transcript.agent", f"Expected transcript.agent, got: {msg2}"
    
    # 2. Test plain text ping
    print("\n--- Test 2: Sending plain text ping ---")
    ws.send("ping")
    resp = ws.recv()
    print(f"Received response: {resp}")
    assert resp == "pong", f"Expected 'pong', got: {resp}"
    
    # 3. Test JSON ping
    print("\n--- Test 3: Sending JSON ping ---")
    ws.send(json.dumps({"type": "ping"}))
    resp = ws.recv()
    print(f"Received response: {resp}")
    data = json.loads(resp)
    assert data.get("type") == "pong", f"Expected JSON type 'pong', got: {resp}"
    
    # 4. Test SRE Command (health check tool)
    print("\n--- Test 4: Sending check cluster health command ---")
    ws.send(json.dumps({
        "type": "conversation.message",
        "message": {
            "role": "user",
            "content": "check cluster health"
        }
    }))
    ws.send(json.dumps({
        "type": "reply.create"
    }))
    
    # We expect to receive a transcript event and a tool execution event
    received_tool_exec = False
    received_transcript = False
    
    # Receive 2 messages to capture all responses
    for i in range(2):
        resp = ws.recv()
        print(f"Received event {i+1}: {resp}")
        evt = json.loads(resp)
        if evt.get("type") == "tool.execution":
            received_tool_exec = True
            tool_call = evt.get("tool_call", {})
            print(f"  -> Executed tool: {tool_call.get('name')}")
            assert tool_call.get("name") == "check_cluster_health", f"Unexpected tool executed: {tool_call.get('name')}"
        elif evt.get("type") == "transcript.agent":
            received_transcript = True
            print(f"  -> Agent transcript: {evt.get('text')}")
            
    assert received_tool_exec, "Expected to receive a tool.execution event!"
    assert received_transcript, "Expected to receive a transcript.agent event!"
    
    print("\n--- Test 5: Verifying connection persistence ---")
    # Wait for 1 second and check if connection is still alive
    time.sleep(1.0)
    ws.send("__ping__")
    resp = ws.recv()
    print(f"Persistence check response: {resp}")
    assert resp == "pong", "Connection was dropped!"
    
    ws.close()
    print("\nAll tests passed successfully! The WebSocket connection is fully robust and persistent.")

if __name__ == "__main__":
    run_test()
