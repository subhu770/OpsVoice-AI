// useAudioStream.ts
// React hook to manage Web Audio API capturing, PCM16 conversion, WebSocket proxying, and continuous audio queue playback

import { useEffect, useRef, useState } from "react";

interface UseAudioStreamProps {
  onTranscript: (role: "user" | "agent", text: string, isFinal: boolean) => void;
  onToolExecution: (toolCall: any) => void;
  onClusterStateChange: (state: any) => void;
  onVolumeChange: (volume: number) => void;
  onAgentSpeakingChange: (isSpeaking: boolean) => void;
  onStatusChange: (status: "disconnected" | "connecting" | "connected" | "error", errorMsg?: string) => void;
}

export function useAudioStream({
  onTranscript,
  onToolExecution,
  onClusterStateChange,
  onVolumeChange,
  onAgentSpeakingChange,
  onStatusChange
}: UseAudioStreamProps) {
  const [isActive, setIsActive] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const messageQueueRef = useRef<string[]>([]);
  
  // Audio playback references
  const playbackContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  
  // Audio recording references
  const recordContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);

  // Clean up all audio elements and WebSocket connection
  const stopStream = () => {
    setIsActive(false);
    onStatusChange("disconnected");
    onVolumeChange(0);
    onAgentSpeakingChange(false);
    
    // Close WebSocket
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        // Send session end event to AssemblyAI if open
        try {
          wsRef.current.send(JSON.stringify({ type: "session.end" }));
        } catch (e) {}
        wsRef.current.close();
      }
      wsRef.current = null;
    }
    
    // Stop microphone stream track
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    
    // Disconnect worklet
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    
    // Stop and clear scheduled playback audio buffers
    scheduledSourcesRef.current.forEach(source => {
      try {
        source.stop();
      } catch (e) {}
    });
    scheduledSourcesRef.current = [];
    
    // Close recording context
    if (recordContextRef.current) {
      if (recordContextRef.current.state !== "closed") {
        recordContextRef.current.close();
      }
      recordContextRef.current = null;
    }
    
    // Close playback context
    if (playbackContextRef.current) {
      if (playbackContextRef.current.state !== "closed") {
        playbackContextRef.current.close();
      }
      playbackContextRef.current = null;
    }
  };

  // Play incoming raw audio chunks
  const playAudioChunk = (base64Audio: string) => {
    try {
      const ctx = playbackContextRef.current;
      if (!ctx || ctx.state === "suspended") return;

      // Decode base64 to binary string
      const binaryString = atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // Read bytes buffer as 16-bit signed integers (PCM16)
      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      
      // Convert PCM16 values to Float32 sample range [-1.0, 1.0] for browser audio playback
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }
      
      // Voice Agent outputs audio at 24000 Hz sample rate
      const audioBuffer = ctx.createBuffer(1, float32Array.length, 24000);
      audioBuffer.getChannelData(0).set(float32Array);
      
      const sourceNode = ctx.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(ctx.destination);
      
      const currentTime = ctx.currentTime;
      let startPlayTime = nextPlayTimeRef.current;
      
      // If playback queue is lagging or empty, start immediately
      if (startPlayTime < currentTime) {
        startPlayTime = currentTime;
      }
      
      sourceNode.start(startPlayTime);
      scheduledSourcesRef.current.push(sourceNode);
      
      sourceNode.onended = () => {
        scheduledSourcesRef.current = scheduledSourcesRef.current.filter(src => src !== sourceNode);
        if (scheduledSourcesRef.current.length === 0) {
          onAgentSpeakingChange(false);
        }
      };
      
      // Update next playback time index
      const chunkDuration = float32Array.length / 24000;
      nextPlayTimeRef.current = startPlayTime + chunkDuration;
      onAgentSpeakingChange(true);
      
    } catch (err) {
      console.error("[useAudioStream] Error decoding and playing audio chunk:", err);
    }
  };

  // Clears any currently playing or queued agent voice chunks (Interruption/Barge-in handling)
  const stopAgentPlayback = () => {
    scheduledSourcesRef.current.forEach(source => {
      try {
        source.stop();
      } catch (e) {}
    });
    scheduledSourcesRef.current = [];
    if (playbackContextRef.current) {
      nextPlayTimeRef.current = playbackContextRef.current.currentTime;
    }
    onAgentSpeakingChange(false);
  };

  const startStream = async () => {
    try {
      stopStream();
      onStatusChange("connecting");
      
      // 1. Initialize browser audio contexts
      playbackContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      recordContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 24000 // AssemblyAI expects 24kHz sample rate audio stream input
      });
      
      // 2. Open WebSocket connection to local Flask backend (hardcoded to 127.0.0.1)
      const wsUrl = "ws://127.0.0.1:5000/ws/agent";
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      
      // 3. Request user microphone media stream access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      });
      mediaStreamRef.current = stream;
      
      // 4. Configure inline AudioWorklet for recording to bypass static public routing files
      const workletCode = `
        class AudioProcessor extends AudioWorkletProcessor {
          process(inputs, outputs, parameters) {
            const input = inputs[0];
            if (input && input[0]) {
              const inputData = input[0];
              const pcm16 = new Int16Array(inputData.length);
              let totalSquareSum = 0;
              
              for (let i = 0; i < inputData.length; i++) {
                const sample = Math.max(-1.0, Math.min(1.0, inputData[i]));
                // Convert Float32 [-1, 1] to signed Int16 [-32768, 32767]
                pcm16[i] = sample < 0 ? sample * 32768 : sample * 32767;
                totalSquareSum += sample * sample;
              }
              
              const rmsVolume = Math.sqrt(totalSquareSum / inputData.length);
              this.port.postMessage({ pcm: pcm16, rms: rmsVolume });
            }
            return true;
          }
        }
        registerProcessor('audio-processor', AudioProcessor);
      `;
      
      const blob = new Blob([workletCode], { type: "application/javascript" });
      const workletUrl = URL.createObjectURL(blob);
      
      await recordContextRef.current.audioWorklet.addModule(workletUrl);
      const sourceNode = recordContextRef.current.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(recordContextRef.current, "audio-processor");
      
      workletNodeRef.current = workletNode;
      sourceNode.connect(workletNode);
      workletNode.connect(recordContextRef.current.destination);

      // Listen for converted PCM chunks and volume levels from the AudioWorklet
      workletNode.port.onmessage = (e) => {
        const { pcm, rms } = e.data;
        
        // Pass RMS volume values to update the soundwave visualizer (multiplied for better UI scaling)
        onVolumeChange(rms * 10);
        
        // Forward binary PCM16 stream bytes down the WebSocket
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(pcm.buffer);
        }
      };

      // 5. Manage incoming WebSocket communications from Backend proxy
      ws.onopen = () => {
        setIsActive(true);
        onStatusChange("connected");
        
        // Flush any queued text prompts
        if (messageQueueRef.current.length > 0) {
          messageQueueRef.current.forEach((msg) => {
            ws.send(msg);
          });
          messageQueueRef.current = [];
        }
      };

      ws.onmessage = (event) => {
        onStatusChange("connected");
        try {
          const data = jsonParse(event.data);
          if (!data) return;
          
          const eventType = data.type;
          
          // Audio reply packet
          if (eventType === "reply.audio" && data.audio) {
            playAudioChunk(data.audio);
          }
          
          // User barge-in detected: instantly mute agent audio queue
          else if (eventType === "input.speech.started") {
            stopAgentPlayback();
          }
          
          // Speech transcripts: user transcripts
          else if (eventType === "transcript.user.delta" || eventType === "transcript.user") {
            onTranscript("user", data.text || "", eventType === "transcript.user");
          }
          
          // Speech transcripts: agent response transcripts
          else if (eventType === "transcript.agent.delta" || eventType === "transcript.agent") {
            onTranscript("agent", data.text || "", eventType === "transcript.agent");
          }
          
          // SRE Tool call execution notifications
          else if (eventType === "tool.execution") {
            onToolExecution(data.tool_call);
            if (data.cluster_state) {
              onClusterStateChange(data.cluster_state);
            }
          }
          
          // Error messages
          else if (eventType === "session.error" || eventType === "error") {
            console.error("[useAudioStream] WebSocket received error event:", data);
            onStatusChange("error", data.error || "An error occurred with the AssemblyAI agent.");
            stopStream();
          }
          
        } catch (err) {
          console.error("[useAudioStream] Error parsing WebSocket message:", err);
        }
      };

      ws.onerror = (err) => {
        console.error("[useAudioStream] WebSocket error event:", err);
        onStatusChange("error", "WebSocket connection error. Make sure the backend server is running.");
        stopStream();
      };

      ws.onclose = () => {
        if (isActive) {
          onStatusChange("connecting", "Unexpected disconnection. Reconnecting...");
          setTimeout(() => {
            if (isActive) {
              startStream();
            }
          }, 3000);
        } else {
          stopStream();
        }
      };
      
    } catch (err: any) {
      console.error("[useAudioStream] Failed to initialize audio stream connection:", err);
      onStatusChange("error", err.message || "Failed to access microphone or connect to backend.");
      stopStream();
    }
  };

  // Helper function to insert a custom text command (bypassing mic)
  const sendTextPrompt = (text: string) => {
    // Create user message event
    const userMsg = {
      type: "conversation.message",
      message: {
        role: "user",
        content: text
      }
    };
    // Request immediate response generation
    const replyMsg = {
      type: "reply.create"
    };

    const userMsgStr = JSON.stringify(userMsg);
    const replyMsgStr = JSON.stringify(replyMsg);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(userMsgStr);
      wsRef.current.send(replyMsgStr);
    } else {
      // Queue the messages to be sent once the connection is established
      messageQueueRef.current.push(userMsgStr);
      messageQueueRef.current.push(replyMsgStr);
      
      // Auto-connect if socket is not open / connecting
      if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
        startStream();
      }
    }
  };

  // Auto clean-up on hook unmount
  useEffect(() => {
    return () => {
      stopStream();
    };
  }, []);

  return {
    isActive,
    startStream,
    stopStream,
    sendTextPrompt
  };
}

// Utility to safe parse JSON content
function jsonParse(str: string) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}
