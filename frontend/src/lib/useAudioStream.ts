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
  const isActiveRef = useRef(false);
  const isConnectingRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
  const scriptProcessorNodeRef = useRef<ScriptProcessorNode | null>(null);

  // Keep latest callbacks in ref to avoid stale closures
  const callbacksRef = useRef({
    onTranscript,
    onToolExecution,
    onClusterStateChange,
    onVolumeChange,
    onAgentSpeakingChange,
    onStatusChange
  });

  useEffect(() => {
    callbacksRef.current = {
      onTranscript,
      onToolExecution,
      onClusterStateChange,
      onVolumeChange,
      onAgentSpeakingChange,
      onStatusChange
    };
  });

  // Clean up all audio elements and WebSocket connection
  const stopStream = (isIntentional = true) => {
    isActiveRef.current = false;
    intentionalCloseRef.current = isIntentional;
    isConnectingRef.current = false;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setIsActive(false);

    if (isIntentional) {
      callbacksRef.current.onStatusChange("disconnected");
      callbacksRef.current.onVolumeChange(0);
      callbacksRef.current.onAgentSpeakingChange(false);
    }
    
    // Close WebSocket
    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        try {
          ws.send(JSON.stringify({ type: "session.end" }));
        } catch (e) {}
        try {
          ws.close();
        } catch (e) {}
      }
    }
    
    // Stop microphone stream track
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (e) {}
      });
      mediaStreamRef.current = null;
    }
    
    // Disconnect worklet
    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.disconnect();
      } catch (e) {}
      workletNodeRef.current = null;
    }

    // Disconnect ScriptProcessor fallback
    if (scriptProcessorNodeRef.current) {
      try {
        scriptProcessorNodeRef.current.disconnect();
      } catch (e) {}
      scriptProcessorNodeRef.current = null;
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
      const ctx = recordContextRef.current;
      recordContextRef.current = null;
      if (ctx.state !== "closed") {
        ctx.close().catch(() => {});
      }
    }
    
    // Close playback context
    if (playbackContextRef.current) {
      const ctx = playbackContextRef.current;
      playbackContextRef.current = null;
      if (ctx.state !== "closed") {
        ctx.close().catch(() => {});
      }
    }
  };

  // Play incoming raw audio chunks
  const playAudioChunk = (base64Audio: string) => {
    try {
      let ctx = playbackContextRef.current;
      const AudioCtxClass = typeof window !== "undefined" ? (window.AudioContext || (window as any).webkitAudioContext) : null;
      if (!ctx || ctx.state === "closed") {
        if (!AudioCtxClass) return;
        ctx = new AudioCtxClass();
        playbackContextRef.current = ctx;
      }

      if (ctx.state === "suspended") {
        ctx.resume().catch((e) => console.warn("[useAudioStream] Could not resume playback context:", e));
      }

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
          callbacksRef.current.onAgentSpeakingChange(false);
        }
      };
      
      // Update next playback time index
      const chunkDuration = float32Array.length / 24000;
      nextPlayTimeRef.current = startPlayTime + chunkDuration;
      callbacksRef.current.onAgentSpeakingChange(true);
      
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
    callbacksRef.current.onAgentSpeakingChange(false);
  };

  const startStream = async () => {
    if (typeof window === "undefined") return;

    // Prevent re-entrant calls if already connecting
    if (isConnectingRef.current) {
      return;
    }

    try {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      isActiveRef.current = true;
      intentionalCloseRef.current = false;
      isConnectingRef.current = true;

      setIsActive(true);
      callbacksRef.current.onStatusChange("connecting");

      // 1. Initialize browser audio contexts safely after user gesture
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("Web Audio API is not supported in this browser.");
      }

      // Initialize playback context
      let playbackCtx = playbackContextRef.current;
      if (!playbackCtx || playbackCtx.state === "closed") {
        playbackCtx = new AudioContextClass();
        playbackContextRef.current = playbackCtx;
      }
      if (playbackCtx.state === "suspended") {
        await playbackCtx.resume().catch((e) => console.warn("[useAudioStream] Playback context resume error:", e));
      }

      // Initialize record context with fallback for 24kHz sample rate
      let recordCtx: AudioContext;
      try {
        recordCtx = new AudioContextClass({
          sampleRate: 24000 // Preferred for AssemblyAI
        });
      } catch (e) {
        console.warn("[useAudioStream] Failed to initialize AudioContext with sampleRate: 24000, falling back to default:", e);
        recordCtx = new AudioContextClass();
      }

      if (recordCtx.state === "suspended") {
        await recordCtx.resume().catch((e) => console.warn("[useAudioStream] Record context resume error:", e));
      }
      recordContextRef.current = recordCtx;
      
      // 2. Open WebSocket connection to local Flask backend
      const wsUrl = "ws://127.0.0.1:5000/ws/agent";
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      
      // 3. Request user microphone media stream access
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Microphone access is not supported by your browser environment.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      });

      // Check if session was stopped or aborted during mic permission prompt
      if (!isActiveRef.current || wsRef.current !== ws || recordContextRef.current !== recordCtx) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      mediaStreamRef.current = stream;
      
      // 4. Configure AudioWorklet with ScriptProcessor fallback
      let workletReady = false;

      if (recordCtx && recordCtx.audioWorklet && typeof recordCtx.audioWorklet.addModule === "function") {
        try {
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
          
          await recordCtx.audioWorklet.addModule(workletUrl);
          URL.revokeObjectURL(workletUrl);

          // Verify state has not been torn down while awaiting module registration
          if (isActiveRef.current && recordContextRef.current === recordCtx) {
            const sourceNode = recordCtx.createMediaStreamSource(stream);
            const workletNode = new AudioWorkletNode(recordCtx, "audio-processor");
            
            workletNodeRef.current = workletNode;
            sourceNode.connect(workletNode);
            
            const silentGain = recordCtx.createGain();
            silentGain.gain.value = 0;
            workletNode.connect(silentGain);
            silentGain.connect(recordCtx.destination);

            workletNode.port.onmessage = (e) => {
              if (!isActiveRef.current) return;
              const { pcm, rms } = e.data;
              
              if (typeof rms === "number") {
                callbacksRef.current.onVolumeChange(rms * 10);
              }
              
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && pcm) {
                wsRef.current.send(pcm.buffer);
              }
            };

            workletReady = true;
          }
        } catch (workletError) {
          console.warn("[useAudioStream] AudioWorklet setup failed, using ScriptProcessorNode fallback:", workletError);
        }
      }

      // Fallback: Use ScriptProcessorNode if AudioWorklet is null, unsupported, or failed
      if (!workletReady && isActiveRef.current && recordContextRef.current === recordCtx) {
        console.log("[useAudioStream] Initializing ScriptProcessorNode audio capture fallback.");
        const sourceNode = recordCtx.createMediaStreamSource(stream);
        const scriptNode = recordCtx.createScriptProcessor(4096, 1, 1);
        scriptProcessorNodeRef.current = scriptNode;
        const currentSampleRate = recordCtx.sampleRate;

        scriptNode.onaudioprocess = (audioEvent) => {
          if (!isActiveRef.current) return;
          const inputData = audioEvent.inputBuffer.getChannelData(0);
          const { pcm16, rms } = downsampleAndConvertToPCM16(inputData, currentSampleRate, 24000);
          
          callbacksRef.current.onVolumeChange(rms * 10);

          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && pcm16) {
            wsRef.current.send(pcm16.buffer);
          }
        };

        sourceNode.connect(scriptNode);
        const silentGain = recordCtx.createGain();
        silentGain.gain.value = 0;
        scriptNode.connect(silentGain);
        silentGain.connect(recordCtx.destination);
      }

      // 5. Manage WebSocket lifecycle
      ws.onopen = () => {
        isConnectingRef.current = false;
        setIsActive(true);
        callbacksRef.current.onStatusChange("connected");
        
        // Flush any queued text prompts
        if (messageQueueRef.current.length > 0) {
          messageQueueRef.current.forEach((msg) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(msg);
            }
          });
          messageQueueRef.current = [];
        }
      };

      ws.onmessage = (event) => {
        callbacksRef.current.onStatusChange("connected");
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
            callbacksRef.current.onTranscript("user", data.text || "", eventType === "transcript.user");
          }
          
          // Speech transcripts: agent response transcripts
          else if (eventType === "transcript.agent.delta" || eventType === "transcript.agent") {
            callbacksRef.current.onTranscript("agent", data.text || "", eventType === "transcript.agent");
          }
          
          // SRE Tool call execution notifications
          else if (eventType === "tool.execution") {
            callbacksRef.current.onToolExecution(data.tool_call);
            if (data.cluster_state) {
              callbacksRef.current.onClusterStateChange(data.cluster_state);
            }
          }
          
          // Error messages
          else if (eventType === "session.error" || eventType === "error") {
            console.error("[useAudioStream] WebSocket received error event:", data);
            callbacksRef.current.onStatusChange("error", data.error || "An error occurred with the AI agent.");
          }
          
        } catch (err) {
          console.error("[useAudioStream] Error parsing WebSocket message:", err);
        }
      };

      ws.onerror = (err) => {
        console.error("[useAudioStream] WebSocket error event:", err);
        // Note: ws.onclose will be called after onerror to handle reconnection or teardown cleanly
      };

      ws.onclose = () => {
        isConnectingRef.current = false;
        if (intentionalCloseRef.current || !isActiveRef.current) {
          stopStream(true);
        } else {
          // Unexpected disconnection: perform auto-reconnect
          callbacksRef.current.onStatusChange("connecting", "Unexpected disconnection. Reconnecting in 3 seconds...");
          
          // Clean up audio tracks before re-establishing connection
          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(t => t.stop());
            mediaStreamRef.current = null;
          }
          if (workletNodeRef.current) {
            try { workletNodeRef.current.disconnect(); } catch (e) {}
            workletNodeRef.current = null;
          }
          if (scriptProcessorNodeRef.current) {
            try { scriptProcessorNodeRef.current.disconnect(); } catch (e) {}
            scriptProcessorNodeRef.current = null;
          }
          if (recordContextRef.current && recordContextRef.current.state !== "closed") {
            recordContextRef.current.close().catch(() => {});
            recordContextRef.current = null;
          }

          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
          }
          reconnectTimeoutRef.current = setTimeout(() => {
            if (isActiveRef.current && !intentionalCloseRef.current) {
              startStream();
            }
          }, 3000);
        }
      };
      
    } catch (err: any) {
      console.error("[useAudioStream] Failed to initialize audio stream connection:", err);
      isConnectingRef.current = false;
      if (isActiveRef.current && !intentionalCloseRef.current) {
        callbacksRef.current.onStatusChange("error", err.message || "Failed to access microphone or connect to backend.");
        stopStream(true);
      }
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
      if (!isActiveRef.current) {
        startStream();
      }
    }
  };

  // Auto clean-up on hook unmount
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      stopStream(true);
    };
  }, []);

  return {
    isActive,
    startStream,
    stopStream: () => stopStream(true),
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

// Resampling and Float32 to Int16 PCM converter for ScriptProcessor fallback
function downsampleAndConvertToPCM16(
  buffer: Float32Array,
  inputSampleRate: number,
  targetSampleRate: number
): { pcm16: Int16Array; rms: number } {
  let totalSquareSum = 0;
  for (let i = 0; i < buffer.length; i++) {
    totalSquareSum += buffer[i] * buffer[i];
  }
  const rms = Math.sqrt(totalSquareSum / buffer.length);

  if (inputSampleRate === targetSampleRate) {
    const pcm16 = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      const sample = Math.max(-1.0, Math.min(1.0, buffer[i]));
      pcm16[i] = sample < 0 ? sample * 32768 : sample * 32767;
    }
    return { pcm16, rms };
  }

  const ratio = inputSampleRate / targetSampleRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Int16Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    const sample = count > 0 ? accum / count : 0;
    const clamped = Math.max(-1.0, Math.min(1.0, sample));
    result[offsetResult] = clamped < 0 ? clamped * 32768 : clamped * 32767;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }

  return { pcm16: result, rms };
}
