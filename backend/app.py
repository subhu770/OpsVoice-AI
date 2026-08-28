# app.py
# Flask server with CORS, HTTP API endpoints, and a WebSocket proxy to AssemblyAI Voice Agent API

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_sock import Sock
from simple_websocket import ConnectionClosed
import os
import json
import requests
import websocket
import threading
import queue
import time
from dotenv import load_dotenv

# Load local environment parameters
load_dotenv()

class MockAssemblyAI:
    def __init__(self):
        self.recv_queue = queue.Queue()
        self.connected = True
        # Immediately queue session.ready
        self.recv_queue.put(json.dumps({"type": "session.ready"}))
        self.last_user_prompt = None

    def recv(self):
        try:
            while self.connected:
                try:
                    return self.recv_queue.get(timeout=0.5)
                except queue.Empty:
                    continue
            return None
        except Exception:
            return None

    def send(self, msg):
        if not self.connected:
            return
        try:
            data = json.loads(msg)
            event_type = data.get("type")
            
            if event_type == "session.update":
                greeting = data.get("session", {}).get("greeting", "OpsVoice AI Incident Commander online.")
                self.recv_queue.put(json.dumps({
                    "type": "transcript.agent",
                    "text": greeting
                }))
            elif event_type == "conversation.message":
                self.last_user_prompt = data.get("message", {}).get("content", "")
            elif event_type == "reply.create":
                if self.last_user_prompt:
                    self.process_command(self.last_user_prompt)
                    self.last_user_prompt = None
        except Exception as e:
            print(f"[MockAssemblyAI] Error processing send: {e}")

    def process_command(self, prompt):
        prompt_lower = prompt.lower()
        print(f"[MockAssemblyAI] Processing command: {prompt}")
        
        if "health" in prompt_lower or "status" in prompt_lower or "cluster" in prompt_lower:
            func_name = "check_cluster_health"
            args = {}
            reply_text = "Checking cluster health status..."
        elif "log" in prompt_lower:
            func_name = "get_logs"
            service_name = "auth-service"
            if "payment" in prompt_lower:
                service_name = "payment-gateway"
            elif "db" in prompt_lower or "replica" in prompt_lower:
                service_name = "db-replica"
            args = {"service_name": service_name}
            reply_text = f"Retrieving logs for {service_name}..."
        elif "restart" in prompt_lower:
            func_name = "restart_pod"
            service_name = "auth-service"
            if "payment" in prompt_lower:
                service_name = "payment-gateway"
            elif "db" in prompt_lower or "replica" in prompt_lower:
                service_name = "db-replica"
            memory_bump = "bump" in prompt_lower or "memory" in prompt_lower or "ram" in prompt_lower
            args = {"service_name": service_name, "memory_bump": memory_bump}
            reply_text = f"Restarting service {service_name}..."
        elif "post" in prompt_lower or "mortem" in prompt_lower or "report" in prompt_lower:
            func_name = "generate_post_mortem"
            args = {"incident_description": "auth-service crash loop"}
            reply_text = "Generating incident post-mortem report..."
        else:
            self.recv_queue.put(json.dumps({
                "type": "transcript.agent",
                "text": f"I heard you say: '{prompt}'. You can ask me to check cluster health, check logs for a service, or restart auth-service with a memory bump."
            }))
            return

        call_id = f"call_{int(time.time())}"
        tool_call_event = {
            "type": "tool.call",
            "tool_call": {
                "id": call_id,
                "function": {
                    "name": func_name,
                    "arguments": json.dumps(args)
                }
            }
        }
        self.recv_queue.put(json.dumps(tool_call_event))
        self.recv_queue.put(json.dumps({
            "type": "transcript.agent",
            "text": reply_text
        }))

    def close(self):
        self.connected = False

# Import the Mock SRE Tools and database
from agent_tools import execute_devops_tool, get_cluster_state, TOOLS_DEFINITIONS

app = Flask(__name__)
# Enable CORS for Next.js frontend (typically running on port 3000)
CORS(app)

# Initialize Flask-Sock for WebSockets
sock = Sock(app)

@app.route('/health', methods=['GET'])
def health():
    """Health check route to verify server connectivity."""
    return jsonify({"status": "healthy", "service": "OpsVoice AI Backend"}), 200

@app.route('/api/cluster-state', methods=['GET'])
def cluster_state_endpoint():
    """Returns the initial cluster database state (metrics and service statuses)."""
    return jsonify(get_cluster_state()), 200

@app.route('/api/session-token', methods=['GET'])
def get_session_token():
    """
    Generates a single-use temporary token from AssemblyAI.
    Ensures the client side doesn't expose the main AssemblyAI API key.
    """
    api_key = os.environ.get("ASSEMBLYAI_API_KEY")
    if not api_key:
        return jsonify({"error": "ASSEMBLYAI_API_KEY environment variable is not configured."}), 500
        
    try:
        url = "https://agents.assemblyai.com/v1/token"
        headers = {
            "Authorization": f"Bearer {api_key}"
        }
        # Request a 5-minute single-use token
        response = requests.get(url, headers=headers, params={"expires_in_seconds": 300})
        
        if response.status_code != 200:
            return jsonify({
                "error": "Failed to retrieve session token from AssemblyAI.",
                "details": response.text
            }), response.status_code
            
        return jsonify(response.json()), 200
    except Exception as e:
        return jsonify({"error": f"Internal server error while fetching token: {str(e)}"}), 500

@sock.route('/ws/agent')
def agent_websocket(ws):
    """
    Full-duplex WebSocket proxy connecting the browser microphone to AssemblyAI.
    Handles tool calls from the voice agent, runs them on the mock cluster state,
    and returns tool results dynamically.
    """
    # Log incoming connection origin
    origin = request.headers.get('Origin')
    print(f"[OpsVoice Backend] WebSocket connection received from origin: {origin}")

    api_key = os.environ.get("ASSEMBLYAI_API_KEY")
    aai_ws = None
    
    # Check if a valid API key is present
    if api_key and api_key != "your_actual_assemblyai_api_key" and api_key.strip():
        headers = [f"Authorization: Bearer {api_key}"]
        try:
            aai_ws = websocket.create_connection("wss://agents.assemblyai.com/v1/ws", header=headers)
            print("[OpsVoice Backend] Connected to AssemblyAI real Voice Agent API.")
        except Exception as e:
            print(f"[OpsVoice Backend] Failed to connect to AssemblyAI Voice Agent API: {e}. Falling back to Mock Agent.")
            
    if not aai_ws:
        print("[OpsVoice Backend] Starting Mock SRE DevOps Agent (no valid ASSEMBLYAI_API_KEY found).")
        aai_ws = MockAssemblyAI()
        
    connection_active = True
    
    def handle_assemblyai_stream():
        nonlocal connection_active
        try:
            while connection_active:
                msg = aai_ws.recv()
                if not msg:
                    break
                    
                data = json.loads(msg)
                event_type = data.get("type")
                
                # Check if AssemblyAI has loaded the WebSocket connection successfully
                if event_type == "session.ready":
                    # Register system instructions, SRE tools, and initial agent greeting
                    setup_msg = {
                        "type": "session.update",
                        "session": {
                            "system_prompt": (
                                "You are OpsVoice AI, an expert autonomous voice agent for SRE and DevOps incident command. "
                                "Your voice tone is highly professional, direct, concise, and technical. "
                                "You help DevOps engineers check cluster health, inspect container logs, restart pods, and write post-mortem reports. "
                                "When requested, use the appropriate tools immediately. "
                                "If cluster health or logs indicate an OOMKilled status (Exit code 137), explicitly suggest restarting with a memory bump enabled."
                            ),
                            "tools": TOOLS_DEFINITIONS,
                            "greeting": "OpsVoice AI Incident Commander online. Ready to inspect cluster health or restart failed services."
                        }
                    }
                    aai_ws.send(json.dumps(setup_msg))
                    
                # Handle tool execution triggers
                elif event_type == "tool.call":
                    tool_call = data.get("tool_call", {})
                    call_id = tool_call.get("id")
                    func = tool_call.get("function", {})
                    func_name = func.get("name")
                    func_arguments = func.get("arguments", "{}")
                    
                    try:
                        args = json.loads(func_arguments)
                    except Exception:
                        args = {}
                        
                    # Execute DevOps task on the in-memory cluster database
                    execution_result = execute_devops_tool(func_name, args)
                    
                    # Return result back to AssemblyAI agent brain
                    result_msg = {
                        "type": "tool.result",
                        "tool_result": {
                            "call_id": call_id,
                            "output": execution_result
                        }
                    }
                    aai_ws.send(json.dumps(result_msg))
                    
                    # Broadcast execution updates to frontend (updates metrics cards and SRE logs)
                    ws.send(json.dumps({
                        "type": "tool.execution",
                        "tool_call": {
                            "id": call_id,
                            "name": func_name,
                            "arguments": args,
                            "result": execution_result
                        },
                        "cluster_state": get_cluster_state()
                    }))
                    continue
                
                # Forward transcripts, TTS voice data, and speech boundaries to browser
                ws.send(msg)
                
        except Exception as e:
            print(f"[OpsVoice Backend] Error in AssemblyAI listener thread: {e}")
        finally:
            connection_active = False
            try:
                ws.close()
            except Exception:
                pass

    # Start the AssemblyAI listener thread to process async responses in parallel
    listener_thread = threading.Thread(target=handle_assemblyai_stream)
    listener_thread.daemon = True
    listener_thread.start()
    
    # Process client (browser) audio streams and command payloads
    try:
        while connection_active:
            try:
                client_msg = ws.receive()
                if client_msg is None:
                    print("[OpsVoice Backend] Client connection closed cleanly (received None).")
                    break
                    
                # If receiving raw binary PCM audio bytes, encapsulate as AssemblyAI audio packet
                if isinstance(client_msg, bytes):
                    import base64
                    b64_pcm = base64.b64encode(client_msg).decode("utf-8")
                    aai_ws.send(json.dumps({
                        "type": "input.audio",
                        "audio": b64_pcm
                    }))
                else:
                    # Handle plain text pings (common in initial connection / handshake checks)
                    if client_msg in ("ping", "__ping__", "keepalive"):
                        try:
                            ws.send("pong")
                        except Exception as send_err:
                            print(f"[OpsVoice Backend] Failed to send pong: {send_err}")
                        continue
                    
                    try:
                        # Validate JSON before sending
                        data = json.loads(client_msg)
                        
                        # If receiving a JSON ping/heartbeat, handle it locally
                        if isinstance(data, dict) and data.get("type") in ("ping", "heartbeat"):
                            try:
                                ws.send(json.dumps({"type": "pong"}))
                            except Exception as send_err:
                                print(f"[OpsVoice Backend] Failed to send JSON pong: {send_err}")
                            continue
                            
                        # Forward other controls to AssemblyAI
                        aai_ws.send(client_msg)
                    except ValueError:
                        # Log non-JSON string message but do not raise/crash/terminate
                        print(f"[OpsVoice Backend] Non-JSON string received and ignored: {client_msg}")
            except (ConnectionClosed, ConnectionResetError, BrokenPipeError) as ce:
                print(f"[OpsVoice Backend] Client connection terminated: {ce}")
                break
            except Exception as e:
                print(f"[OpsVoice Backend] Error processing client message: {e}")
                import traceback
                traceback.print_exc()
                # Stop loop if the client socket itself is no longer connected
                if not getattr(ws, 'connected', True):
                    print("[OpsVoice Backend] WebSocket client is no longer connected. Exiting loop.")
                    break
    finally:
        connection_active = False
        try:
            aai_ws.close()
        except Exception:
            pass

if __name__ == '__main__':
    port = int(os.environ.get("FLASK_PORT", 5000))
    # Run server locally (host '0.0.0.0' for docker/network access)
    app.run(host='0.0.0.0', port=port, debug=False)
