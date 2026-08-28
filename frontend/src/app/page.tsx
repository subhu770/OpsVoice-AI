// page.tsx
// SRE Dashboard UI - Futuristic Cyberpunk Dark-mode Incident Commander Dashboard

"use client";

import React, { useState, useEffect, useRef } from "react";
import { useAudioStream } from "@/lib/useAudioStream";
import {
  Activity,
  Terminal as TerminalIcon,
  Mic,
  MicOff,
  AlertTriangle,
  Cpu,
  Server,
  RefreshCw,
  Copy,
  Check,
  FileText,
  X,
  ShieldAlert,
  Sparkles,
  ChevronRight,
  Database
} from "lucide-react";

interface LogLine {
  id: string;
  timestamp: string;
  source: "system" | "user" | "agent" | "tool";
  text: string;
}

interface ServiceInfo {
  status: string;
  replicas: string;
  cpu: string;
  memory: string;
  memory_limit: number;
  restarts: number;
  role: string;
}

interface ClusterState {
  services: Record<string, ServiceInfo>;
  metrics: {
    cluster_cpu: string;
    cluster_memory: string;
    active_alerts: number;
  };
}

const INITIAL_CLUSTER_STATE: ClusterState = {
  services: {
    "auth-service": {
      status: "CrashLoopBackOff",
      replicas: "0/1",
      cpu: "0%",
      memory: "512Mi / 512Mi (OOMKilled)",
      memory_limit: 512,
      restarts: 14,
      role: "Handles user login, session management, and authentication tokens."
    },
    "payment-gateway": {
      status: "Running",
      replicas: "1/1",
      cpu: "12%",
      memory: "256Mi / 512Mi",
      memory_limit: 512,
      restarts: 0,
      role: "Processes credit card and digital wallet transactions via Stripe."
    },
    "db-replica": {
      status: "Running",
      replicas: "1/1",
      cpu: "64%",
      memory: "1.2Gi / 2Gi",
      memory_limit: 2048,
      restarts: 1,
      role: "PostgreSQL read replica for user profiles and transaction history."
    }
  },
  metrics: {
    cluster_cpu: "38%",
    cluster_memory: "82%",
    active_alerts: 1
  }
};

export default function SREDashboard() {
  const [mounted, setMounted] = useState(false);
  const [clusterState, setClusterState] = useState<ClusterState>(INITIAL_CLUSTER_STATE);
  const [logs, setLogs] = useState<LogLine[]>([]);
  
  // Real-time transcript deltas
  const [userTranscriptDelta, setUserTranscriptDelta] = useState("");
  const [agentTranscriptDelta, setAgentTranscriptDelta] = useState("");
  
  // Connection states
  const [connectionStatus, setConnectionStatus] = useState<"disconnected" | "connecting" | "connected" | "error">("disconnected");
  const connectionLoggedRef = useRef(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [volume, setVolume] = useState(0);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  
  // Custom text input commands
  const [cmdInput, setCmdInput] = useState("");
  
  // Incident Post Mortem state
  const [postMortem, setPostMortem] = useState<string | null>(null);
  const [copiedPostMortem, setCopiedPostMortem] = useState(false);

  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Fetch initial cluster state from API on load
  useEffect(() => {
    setMounted(true);
    fetchState();
    
    // Add initial system terminal log
    addLog("system", "OpsVoice Command Shell v1.0.0 initialized. Awaiting SRE connection...");
  }, []);

  // Auto scroll terminal log window to bottom on updates
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, userTranscriptDelta, agentTranscriptDelta]);

  const fetchState = async () => {
    try {
      const res = await fetch("http://127.0.0.1:5000/api/cluster-state");
      if (res.ok) {
        const data = await res.json();
        setClusterState(data);
      }
    } catch (err) {
      console.warn("Could not retrieve state from backend. Using static fallback database.", err);
    }
  };

  const addLog = (source: "system" | "user" | "agent" | "tool", text: string) => {
    const now = new Date();
    const timestamp = now.toTimeString().split(" ")[0];
    const id = Math.random().toString(36).substring(2, 9);
    setLogs((prev) => [...prev, { id, timestamp, source, text }]);
  };

  // Setup our custom Audio Stream Hook
  const { isActive, startStream, stopStream, sendTextPrompt } = useAudioStream({
    onTranscript: (role, text, isFinal) => {
      if (role === "user") {
        if (isFinal) {
          addLog("user", text);
          setUserTranscriptDelta("");
        } else {
          setUserTranscriptDelta(text);
        }
      } else {
        if (isFinal) {
          addLog("agent", text);
          setAgentTranscriptDelta("");
        } else {
          setAgentTranscriptDelta(text);
        }
      }
    },
    onToolExecution: (toolCall) => {
      setConnectionStatus("connected");
      let argsStr = "";
      try {
        argsStr = JSON.stringify(toolCall.arguments);
      } catch (e) {}

      addLog(
        "tool",
        `[COMMAND EXEC] Executed tool: ${toolCall.name}(${argsStr})\nResult: ${toolCall.result}`
      );
      
      // If a post-mortem was generated, capture and show it
      if (toolCall.name === "generate_post_mortem" && toolCall.result) {
        setPostMortem(toolCall.result);
      }

      // Handle restart_pod tool execution status update dynamically
      if (toolCall.name === "restart_pod") {
        const serviceName = toolCall.arguments?.service_name || "auth-service";
        const memoryBump = toolCall.arguments?.memory_bump || false;
        
        setClusterState(prev => {
          const updatedServices = { ...prev.services };
          if (updatedServices[serviceName]) {
            updatedServices[serviceName] = {
              ...updatedServices[serviceName],
              status: "Running",
              replicas: "1/1",
              restarts: memoryBump ? 0 : updatedServices[serviceName].restarts + 1,
              cpu: memoryBump ? "14%" : "3%",
              memory: memoryBump ? "640Mi / 1024Mi" : "509Mi / 512Mi",
              memory_limit: memoryBump ? 1024 : 512
            };
          }
          
          return {
            ...prev,
            services: updatedServices,
            metrics: {
              ...prev.metrics,
              cluster_memory: memoryBump ? "62%" : prev.metrics.cluster_memory,
              active_alerts: serviceName === "auth-service" ? 0 : prev.metrics.active_alerts
            }
          };
        });
      }
    },
    onClusterStateChange: (updatedState) => {
      setConnectionStatus("connected");
      setClusterState(updatedState);
    },
    onVolumeChange: (vol) => {
      setVolume(vol);
    },
    onAgentSpeakingChange: (speaking) => {
      setIsAgentSpeaking(speaking);
    },
    onStatusChange: (status, err) => {
      setConnectionStatus(status);
      if (status === "connected") {
        if (!connectionLoggedRef.current) {
          connectionLoggedRef.current = true;
          console.log("OpsVoice AI Incident Commander Online");
          addLog("system", "🟢 COMMANDER: OpsVoice AI Incident Commander Online");
        }
      } else if (status === "disconnected") {
        connectionLoggedRef.current = false;
        addLog("system", "🔴 COMMANDER: Connection closed. Session terminated.");
      } else if (status === "connecting") {
        if (err && err.includes("Reconnecting")) {
          addLog("system", "🔄 CONNECTION LOST: Unexpected disconnection. Reconnecting in 3 seconds...");
        } else {
          addLog("system", "🔄 COMMANDER: Connecting to ws://127.0.0.1:5000/ws/agent...");
        }
      } else if (status === "error") {
        connectionLoggedRef.current = false;
        addLog("system", `⚠️ COMMANDER ERROR: ${err || "Unknown WebSocket error occurred."}`);
        setErrorMsg(err || "Failed connection.");
      }
    }
  });

  const toggleConnection = () => {
    if (isActive) {
      stopStream();
    } else {
      startStream();
    }
  };

  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cmdInput.trim()) return;

    addLog("user", `[SHELL COMMAND] "${cmdInput}"`);
    sendTextPrompt(cmdInput);
    setCmdInput("");
  };

  const handleQuickAction = (promptText: string) => {
    addLog("user", `[QUICK ACTION] "${promptText}"`);
    sendTextPrompt(promptText);

    const lowerPrompt = promptText.toLowerCase();
    if (lowerPrompt.includes("restart") && lowerPrompt.includes("auth-service")) {
      const isBump = lowerPrompt.includes("bump") || lowerPrompt.includes("memory") || lowerPrompt.includes("limit");
      setClusterState(prev => {
        const updatedServices = { ...prev.services };
        if (updatedServices["auth-service"]) {
          updatedServices["auth-service"] = {
            ...updatedServices["auth-service"],
            status: "Running",
            replicas: "1/1",
            restarts: isBump ? 0 : updatedServices["auth-service"].restarts + 1,
            cpu: isBump ? "14%" : "3%",
            memory: isBump ? "640Mi / 1024Mi" : "509Mi / 512Mi",
            memory_limit: isBump ? 1024 : 512
          };
        }
        return {
          ...prev,
          services: updatedServices,
          metrics: {
            ...prev.metrics,
            cluster_memory: isBump ? "62%" : prev.metrics.cluster_memory,
            active_alerts: 0
          }
        };
      });
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPostMortem(true);
    setTimeout(() => setCopiedPostMortem(false), 2000);
  };

  // Inline markdown renderer helper
  const parseInline = (text: string) => {
    const parts = [];
    const regex = /(\*\*|`)(.*?)\1/g;
    let match;
    let lastIndex = 0;

    while ((match = regex.exec(text)) !== null) {
      const preceding = text.substring(lastIndex, match.index);
      if (preceding) parts.push(preceding);

      const tag = match[1];
      const val = match[2];
      if (tag === "`") {
        parts.push(
          <code key={match.index} className="px-1.5 py-0.5 rounded bg-black border border-zinc-800 text-rose-400 font-mono text-xs">
            {val}
          </code>
        );
      } else if (tag === "**") {
        parts.push(
          <strong key={match.index} className="font-bold text-white">
            {val}
          </strong>
        );
      }
      lastIndex = regex.lastIndex;
    }

    const remaining = text.substring(lastIndex);
    if (remaining) parts.push(remaining);

    return parts.length > 0 ? parts : text;
  };

  // Custom markdown document parser
  const renderMarkdown = (markdownText: string) => {
    if (!markdownText) return null;
    return markdownText.split("\n").map((line, idx) => {
      if (line.startsWith("# ")) {
        return (
          <h1 key={idx} className="text-2xl font-black text-cyan-400 mt-6 mb-4 border-b border-zinc-800 pb-2 uppercase tracking-wide">
            {line.slice(2)}
          </h1>
        );
      }
      if (line.startsWith("## ")) {
        return (
          <h2 key={idx} className="text-lg font-bold text-emerald-400 mt-5 mb-3 flex items-center gap-2">
            <ChevronRight className="w-4 h-4 text-emerald-400" /> {line.slice(3)}
          </h2>
        );
      }
      if (line.startsWith("### ")) {
        return (
          <h3 key={idx} className="text-md font-semibold text-amber-500 mt-4 mb-2">
            {line.slice(4)}
          </h3>
        );
      }
      if (line.startsWith("- [ ] ") || line.startsWith("* [ ] ")) {
        return (
          <div key={idx} className="flex items-center gap-3 ml-4 my-1.5">
            <input type="checkbox" disabled className="w-4 h-4 rounded border-zinc-800 bg-zinc-900 accent-cyan-500" />
            <span className="text-zinc-300 font-mono text-sm">{parseInline(line.slice(6))}</span>
          </div>
        );
      }
      if (line.startsWith("- [x] ") || line.startsWith("* [x] ")) {
        return (
          <div key={idx} className="flex items-center gap-3 ml-4 my-1.5 opacity-60">
            <input type="checkbox" checked disabled className="w-4 h-4 rounded border-zinc-800 bg-zinc-900 accent-cyan-500" />
            <span className="text-zinc-500 line-through font-mono text-sm">{parseInline(line.slice(6))}</span>
          </div>
        );
      }
      if (line.startsWith("- ") || line.startsWith("* ")) {
        return (
          <li key={idx} className="ml-6 list-disc text-zinc-300 font-mono text-sm my-1">
            {parseInline(line.slice(2))}
          </li>
        );
      }
      if (line.trim() === "") {
        return <div key={idx} className="h-3" />;
      }
      return (
        <p key={idx} className="text-zinc-300 leading-relaxed font-mono text-xs md:text-sm py-1">
          {parseInline(line)}
        </p>
      );
    });
  };

  // Generate reactive heights for volume soundwave
  const visualizerBars = Array.from({ length: 24 }).map((_, i) => {
    const distFromCenter = Math.abs(i - 12);
    const centerFactor = Math.max(0.1, 1 - distFromCenter / 12);
    const randGutter = 0.85 + Math.random() * 0.3;
    const height = 4 + volume * 18 * centerFactor * randGutter;
    return Math.min(80, height);
  });

  if (!mounted) return null;

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-zinc-950 to-black text-white p-4 md:p-8 font-sans overflow-x-hidden relative">
      
      {/* Background cyber grid overlay for hacker aesthetic */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,_rgba(0,0,0,0.25)_50%),_linear-gradient(90deg,_rgba(255,0,0,0.06),_rgba(0,255,0,0.02),_rgba(0,0,255,0.06))] bg-[size:100%_4px,_6px_100%] pointer-events-none opacity-40" />

      {/* Header Banner */}
      <header className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center border-b border-cyan-500/20 pb-6 mb-8 relative z-10">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-cyan-400 animate-ping" />
            <h1 className="text-2xl md:text-3xl font-black tracking-widest bg-gradient-to-r from-cyan-400 via-teal-400 to-indigo-500 bg-clip-text text-transparent uppercase">
              OpsVoice AI // Incident Commander
            </h1>
          </div>
          <p className="text-xs md:text-sm text-cyan-500/60 font-mono uppercase mt-1 tracking-wider">
            Autonomous voice agent pipeline for cluster diagnostics & container self-healing
          </p>
        </div>

        <div className="flex items-center gap-4 mt-4 md:mt-0">
          {/* Connection Status indicator */}
          <div className="flex items-center gap-2.5 px-4 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 font-mono text-xs">
            <span className="text-zinc-500 uppercase">Status:</span>
            {connectionStatus === "disconnected" && (
              <span className="text-gray-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-gray-500" /> Offline
              </span>
            )}
            {connectionStatus === "connecting" && (
              <span className="text-amber-500 flex items-center gap-1.5 animate-pulse">
                <span className="w-2 h-2 rounded-full bg-amber-500" /> Linking...
              </span>
            )}
            {connectionStatus === "connected" && (
              <span className="text-emerald-400 flex items-center gap-1.5 shadow-sm font-bold">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                ONLINE
              </span>
            )}
            {connectionStatus === "error" && (
              <span className="text-rose-500 flex items-center gap-1.5 uppercase">
                <span className="w-2 h-2 rounded-full bg-rose-500" /> Error
              </span>
            )}
          </div>

          <button
            onClick={toggleConnection}
            className={`px-5 py-2.5 rounded-xl text-xs md:text-sm font-bold tracking-wider font-mono transition-all duration-300 cursor-pointer ${
              isActive
                ? "bg-rose-500 hover:bg-rose-600 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)] border border-rose-400/20"
                : "bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600 text-black shadow-[0_0_15px_rgba(6,182,212,0.3)] border border-cyan-400/20"
            }`}
          >
            {isActive ? "MUTE AGENT" : "CONNECT COMMANDER"}
          </button>
        </div>
      </header>

      {/* Main Grid Workspace */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 relative z-10">

        {/* Top Overview Cluster Cards */}
        <section className="col-span-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          <div className="bg-zinc-900/40 backdrop-blur-md border border-cyan-500/10 rounded-2xl p-5 shadow-lg relative overflow-hidden group hover:border-cyan-500/30 transition-all duration-300">
            <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 rounded-bl-full pointer-events-none" />
            <div className="flex justify-between items-start">
              <div>
                <p className="text-zinc-500 text-xs font-mono uppercase tracking-wider">Kubernetes Cluster CPU</p>
                <h3 className="text-2xl font-black mt-2 font-mono">{clusterState.metrics.cluster_cpu}</h3>
              </div>
              <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400">
                <Cpu className="w-5 h-5" />
              </div>
            </div>
            <div className="w-full bg-zinc-800 h-1.5 rounded-full mt-4 overflow-hidden">
              <div
                style={{ width: clusterState.metrics.cluster_cpu }}
                className="bg-gradient-to-r from-cyan-500 to-indigo-500 h-full rounded-full transition-all duration-500"
              />
            </div>
          </div>

          <div className="bg-zinc-900/40 backdrop-blur-md border border-cyan-500/10 rounded-2xl p-5 shadow-lg relative overflow-hidden group hover:border-cyan-500/30 transition-all duration-300">
            <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/5 rounded-bl-full pointer-events-none" />
            <div className="flex justify-between items-start">
              <div>
                <p className="text-zinc-500 text-xs font-mono uppercase tracking-wider">Cluster Memory Allocation</p>
                <h3 className="text-2xl font-black mt-2 font-mono">{clusterState.metrics.cluster_memory}</h3>
              </div>
              <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400">
                <Server className="w-5 h-5" />
              </div>
            </div>
            <div className="w-full bg-zinc-800 h-1.5 rounded-full mt-4 overflow-hidden">
              <div
                style={{ width: clusterState.metrics.cluster_memory }}
                className="bg-gradient-to-r from-purple-500 to-indigo-500 h-full rounded-full transition-all duration-500"
              />
            </div>
          </div>

          <div className="bg-zinc-900/40 backdrop-blur-md border border-cyan-500/10 rounded-2xl p-5 shadow-lg relative overflow-hidden group hover:border-cyan-500/30 transition-all duration-300">
            <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 rounded-bl-full pointer-events-none" />
            <div className="flex justify-between items-start">
              <div>
                <p className="text-zinc-500 text-xs font-mono uppercase tracking-wider">Failed Container Pods</p>
                <h3 className={`text-2xl font-black mt-2 font-mono ${
                  clusterState.services["auth-service"].status !== "Running" ? "text-rose-500 animate-pulse" : "text-emerald-400"
                }`}>
                  {clusterState.services["auth-service"].status !== "Running" ? "1" : "0"}
                </h3>
              </div>
              <div className={`p-2.5 rounded-xl ${
                clusterState.services["auth-service"].status !== "Running" ? "bg-rose-500/10 text-rose-400" : "bg-emerald-500/10 text-emerald-400"
              }`}>
                <AlertTriangle className="w-5 h-5" />
              </div>
            </div>
            <p className="text-[10px] text-zinc-500 mt-4 font-mono">
              CRASHING SERVICE: {clusterState.services["auth-service"].status !== "Running" ? "auth-service" : "NONE"}
            </p>
          </div>

          <div className="bg-zinc-900/40 backdrop-blur-md border border-cyan-500/10 rounded-2xl p-5 shadow-lg relative overflow-hidden group hover:border-cyan-500/30 transition-all duration-300">
            <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-bl-full pointer-events-none" />
            <div className="flex justify-between items-start">
              <div>
                <p className="text-zinc-500 text-xs font-mono uppercase tracking-wider">Active Alarms</p>
                <h3 className={`text-2xl font-black mt-2 font-mono ${
                  clusterState.metrics.active_alerts > 0 ? "text-amber-500" : "text-emerald-400"
                }`}>
                  {clusterState.metrics.active_alerts}
                </h3>
              </div>
              <div className={`p-2.5 rounded-xl ${
                clusterState.metrics.active_alerts > 0 ? "bg-amber-500/10 text-amber-400" : "bg-emerald-500/10 text-emerald-400"
              }`}>
                <ShieldAlert className="w-5 h-5" />
              </div>
            </div>
            <p className="text-[10px] text-zinc-500 mt-4 font-mono">
              SYSTEM SEVERITY: {clusterState.metrics.active_alerts > 0 ? "SEV-1 OUTAGE" : "HEALED"}
            </p>
          </div>

        </section>

        {/* Left Side: Voice Assistant & Quick Actions */}
        <section className="col-span-12 lg:col-span-5 flex flex-col gap-8">
          
          {/* Voice Visualizer Control Box */}
          <div className="bg-zinc-900/40 backdrop-blur-md border border-cyan-500/10 rounded-2xl p-6 shadow-xl flex flex-col items-center justify-between min-h-[320px]">
            <h2 className="text-xs font-mono text-cyan-400 uppercase tracking-widest text-center self-start w-full border-b border-zinc-800 pb-3 flex items-center justify-between">
              <span>Voice Interface</span>
              <span className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-emerald-500 animate-ping" : "bg-zinc-600"}`} />
                {isActive ? "Session Live" : "Standby"}
              </span>
            </h2>

            {/* Pulsing Voice Soundwave Bar Visualizer */}
            <div className="my-8 w-full">
              <div className="flex items-end justify-center gap-1.5 h-20 w-full bg-black/40 rounded-xl p-3 border border-zinc-800 shadow-[inset_0_0_20px_rgba(0,0,0,0.6)]">
                {visualizerBars.map((height, idx) => (
                  <div
                    key={idx}
                    style={{ height: `${height}px` }}
                    className={`w-1 md:w-1.5 rounded-full transition-all duration-75 ${
                      isActive
                        ? isAgentSpeaking
                          ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                          : "bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.4)]"
                        : "bg-zinc-800"
                    }`}
                  />
                ))}
              </div>
              <p className="text-[10px] text-center text-zinc-500 font-mono mt-3 uppercase tracking-wider">
                {isActive
                  ? isAgentSpeaking
                    ? "OPSVOICE: transmitting voice response..."
                    : "COMMANDER: listening for voice input..."
                  : "Click 'Connect' or a quick action to wake agent"}
              </p>
            </div>

            {/* Glowing Main Microphone Button */}
            <button
              onClick={toggleConnection}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-500 cursor-pointer relative group ${
                isActive
                  ? "bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-[0_0_25px_rgba(239,68,68,0.5)] border-2 border-rose-400/30 animate-pulse"
                  : "bg-gradient-to-r from-zinc-800 to-zinc-950 text-cyan-400 border border-cyan-500/20 hover:border-cyan-500/50 hover:shadow-[0_0_15px_rgba(6,182,212,0.2)]"
              }`}
            >
              {isActive ? <Mic className="w-7 h-7" /> : <MicOff className="w-7 h-7" />}
              
              {/* Outer decorative glowing ring */}
              <span className={`absolute inset-0 rounded-full border border-cyan-400/20 scale-125 pointer-events-none group-hover:scale-150 transition-all duration-500 ${
                isActive ? "border-rose-500/40 animate-ping" : ""
              }`} />
            </button>
          </div>

          {/* Quick-action prompt chips */}
          <div className="bg-zinc-900/40 backdrop-blur-md border border-cyan-500/10 rounded-2xl p-6 shadow-xl flex flex-col gap-4">
            <h2 className="text-xs font-mono text-cyan-400 uppercase tracking-widest border-b border-zinc-800 pb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" /> Suggest SRE Prompt Helpers
            </h2>
            
            <div className="flex flex-col gap-2.5">
              
              <button
                onClick={() => handleQuickAction("Check cluster health")}
                className="w-full text-left bg-zinc-900/80 border border-zinc-800 hover:border-cyan-500/40 hover:bg-cyan-500/[0.02] p-3 rounded-xl transition-all duration-300 flex items-center justify-between cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono bg-zinc-800 text-zinc-400 p-1.5 rounded-lg group-hover:text-cyan-400">01</span>
                  <span className="font-mono text-xs text-zinc-300">Check Kubernetes cluster health</span>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-cyan-400 transition-colors" />
              </button>

              <button
                onClick={() => handleQuickAction("Get logs for auth-service")}
                className="w-full text-left bg-zinc-900/80 border border-zinc-800 hover:border-rose-500/40 hover:bg-rose-500/[0.02] p-3 rounded-xl transition-all duration-300 flex items-center justify-between cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono bg-zinc-800 text-zinc-400 p-1.5 rounded-lg group-hover:text-rose-400">02</span>
                  <span className="font-mono text-xs text-zinc-300">Get stderr logs for auth-service</span>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-rose-400 transition-colors" />
              </button>

              <button
                onClick={() => handleQuickAction("Restart auth-service with a memory bump")}
                className="w-full text-left bg-zinc-900/80 border border-zinc-800 hover:border-emerald-500/40 hover:bg-emerald-500/[0.02] p-3 rounded-xl transition-all duration-300 flex items-center justify-between cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono bg-zinc-800 text-zinc-400 p-1.5 rounded-lg group-hover:text-emerald-400">03</span>
                  <span className="font-mono text-xs text-zinc-300">Restart auth-service & bump limits</span>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-emerald-400 transition-colors" />
              </button>

              <button
                onClick={() => handleQuickAction("Write a post mortem for the auth-service outage")}
                className="w-full text-left bg-zinc-900/80 border border-zinc-800 hover:border-amber-500/40 hover:bg-amber-500/[0.02] p-3 rounded-xl transition-all duration-300 flex items-center justify-between cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono bg-zinc-800 text-zinc-400 p-1.5 rounded-lg group-hover:text-amber-400">04</span>
                  <span className="font-mono text-xs text-zinc-300">Generate SEV-1 Outage Post-Mortem</span>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-amber-400 transition-colors" />
              </button>

            </div>
          </div>

        </section>

        {/* Right Side: Interactive Shell Console Terminal */}
        <section className="col-span-12 lg:col-span-7 flex flex-col gap-6 relative">
          
          <div className="bg-black/90 backdrop-blur-md border border-cyan-500/25 rounded-2xl shadow-2xl flex flex-col h-[520px] relative overflow-hidden">
            
            {/* Terminal Window Header Bar */}
            <div className="bg-zinc-950 px-5 py-3 border-b border-zinc-800/80 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <TerminalIcon className="w-4 h-4 text-cyan-400" />
                <span className="text-[11px] font-mono text-cyan-400 uppercase tracking-widest font-semibold">
                  OpsVoice Streaming Terminal Console
                </span>
              </div>
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-zinc-800" />
                <span className="w-2.5 h-2.5 rounded-full bg-zinc-800" />
                <span className="w-2.5 h-2.5 rounded-full bg-zinc-800" />
              </div>
            </div>

            {/* Monospaced Log Output Window */}
            <div className="flex-1 overflow-y-auto p-5 font-mono text-xs md:text-sm space-y-4 scrollbar-thin scrollbar-thumb-zinc-800">
              {logs.map((log) => {
                let textClass = "text-zinc-400";
                let prefix = "";

                if (log.source === "system") {
                  textClass = "text-cyan-400/90";
                  prefix = "[SYS]";
                } else if (log.source === "user") {
                  textClass = "text-indigo-300";
                  prefix = "[SRE]";
                } else if (log.source === "agent") {
                  textClass = "text-emerald-400";
                  prefix = "[VOICE]";
                } else if (log.source === "tool") {
                  textClass = "text-amber-400";
                  prefix = "[EXEC]";
                }

                return (
                  <div key={log.id} className="border-l border-zinc-800 pl-3 leading-relaxed whitespace-pre-wrap">
                    <span className="text-[10px] text-zinc-600 mr-2">{log.timestamp}</span>
                    <span className={`font-bold mr-2 ${textClass}`}>{prefix}</span>
                    <span className={`${log.source === "tool" ? "text-amber-500 font-mono leading-relaxed" : "text-zinc-300"}`}>
                      {log.text}
                    </span>
                  </div>
                );
              })}

              {/* Dynamic incomplete transcript deltas showing live feedback */}
              {userTranscriptDelta && (
                <div className="border-l border-zinc-800 pl-3 leading-relaxed text-indigo-400 italic">
                  <span className="text-[10px] text-zinc-600 mr-2">LIVE</span>
                  <span className="font-bold mr-2">[SRE...]</span>
                  <span>"{userTranscriptDelta}"</span>
                </div>
              )}

              {agentTranscriptDelta && (
                <div className="border-l border-zinc-800 pl-3 leading-relaxed text-emerald-500 italic">
                  <span className="text-[10px] text-zinc-600 mr-2">LIVE</span>
                  <span className="font-bold mr-2">[VOICE...]</span>
                  <span>"{agentTranscriptDelta}"</span>
                </div>
              )}

              {/* Dummy anchor to force auto scrolling */}
              <div ref={terminalEndRef} />
            </div>

            {/* Interactive Shell Command Input Field */}
            <form onSubmit={handleCommandSubmit} className="bg-zinc-950 p-4 border-t border-zinc-800/80 flex items-center gap-3 shrink-0">
              <span className="text-xs font-mono text-cyan-500 font-bold shrink-0">ops-voice@sre-shell:~$</span>
              <input
                type="text"
                value={cmdInput}
                onChange={(e) => setCmdInput(e.target.value)}
                placeholder={isActive ? "Type SRE command or prompt agent..." : "Connect Commander to begin typing..."}
                disabled={!isActive}
                className="flex-1 bg-transparent text-white font-mono text-xs md:text-sm border-none outline-none focus:ring-0 placeholder-zinc-700 disabled:cursor-not-allowed"
              />
              <button
                type="submit"
                disabled={!isActive}
                className="p-1.5 px-3 rounded-lg bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-cyan-400 hover:border-cyan-500/40 disabled:opacity-40"
              >
                ENTER
              </button>
            </form>

          </div>

          {/* Quick toggle to show generated incident post-mortem directly on screen if it exists */}
          {postMortem && (
            <button
              onClick={() => setPostMortem(postMortem)}
              className="w-full flex items-center justify-center gap-2.5 p-3 rounded-xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 hover:border-amber-500/50 hover:bg-amber-500/[0.08] transition-all duration-300 font-mono text-xs text-amber-400 cursor-pointer shadow-sm"
            >
              <FileText className="w-4 h-4" /> VIEW GENERATED INCIDENT POST-MORTEM REPORT
            </button>
          )}

        </section>

      </div>

      {/* Pod States Table section */}
      <section className="max-w-7xl mx-auto mt-8 relative z-10">
        <div className="bg-zinc-900/30 backdrop-blur-md border border-cyan-500/10 rounded-2xl p-6 shadow-xl">
          <h2 className="text-xs font-mono text-cyan-400 uppercase tracking-widest border-b border-zinc-800 pb-3 flex items-center gap-2">
            <Database className="w-4 h-4 text-cyan-400" /> Active Kubernetes Pod States
          </h2>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500">
                  <th className="pb-3 uppercase tracking-wider font-semibold">Service Pod</th>
                  <th className="pb-3 uppercase tracking-wider font-semibold">Status</th>
                  <th className="pb-3 uppercase tracking-wider font-semibold">Replicas</th>
                  <th className="pb-3 uppercase tracking-wider font-semibold">CPU</th>
                  <th className="pb-3 uppercase tracking-wider font-semibold">Memory Limit</th>
                  <th className="pb-3 uppercase tracking-wider font-semibold">Restarts</th>
                  <th className="pb-3 uppercase tracking-wider font-semibold hidden md:table-cell">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50 text-zinc-300">
                {Object.entries(clusterState.services).map(([name, info]) => {
                  let statusColor = "text-emerald-400 bg-emerald-500/10 border-emerald-400/20";
                  if (info.status === "CrashLoopBackOff") {
                    statusColor = "text-rose-500 bg-rose-500/10 border-rose-500/20 animate-pulse";
                  }

                  return (
                    <tr key={name} className="hover:bg-zinc-900/10 transition-colors">
                      <td className="py-4 font-bold text-white">{name}</td>
                      <td className="py-4">
                        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase ${statusColor}`}>
                          {info.status}
                        </span>
                      </td>
                      <td className="py-4">{info.replicas}</td>
                      <td className="py-4">{info.cpu}</td>
                      <td className="py-4">{info.memory}</td>
                      <td className="py-4 text-amber-500">{info.restarts}</td>
                      <td className="py-4 text-zinc-500 hidden md:table-cell text-[11px]">{info.role}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Pop-up Modal to view generated Markdown Post-Mortem Report */}
      {postMortem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-cyan-500/30 rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col shadow-[0_0_50px_rgba(6,182,212,0.15)] animate-in fade-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="bg-zinc-900/80 px-6 py-4 border-b border-zinc-800 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2.5 text-cyan-400">
                <FileText className="w-5 h-5" />
                <span className="text-sm font-mono uppercase tracking-widest font-bold">
                  SRE Post-Mortem Generator Output
                </span>
              </div>
              <button
                onClick={() => setPostMortem(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body - Markdown content */}
            <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-4">
              <div className="prose prose-invert max-w-none text-zinc-300">
                {renderMarkdown(postMortem)}
              </div>
            </div>

            {/* Modal Footer actions */}
            <div className="bg-zinc-900/60 px-6 py-4 border-t border-zinc-800 flex justify-end gap-3 shrink-0">
              <button
                onClick={() => copyToClipboard(postMortem)}
                className="px-4 py-2 rounded-xl text-xs md:text-sm font-mono font-bold tracking-wide border border-cyan-500/20 hover:border-cyan-500/50 hover:bg-cyan-500/[0.04] text-cyan-400 transition-all flex items-center gap-2 cursor-pointer"
              >
                {copiedPostMortem ? (
                  <>
                    <Check className="w-4 h-4" /> COPIED!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" /> COPY MARKDOWN
                  </>
                )}
              </button>
              <button
                onClick={() => setPostMortem(null)}
                className="px-4 py-2 rounded-xl text-xs md:text-sm font-mono font-bold bg-zinc-850 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 cursor-pointer"
              >
                CLOSE
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Cyberpunk Footer info */}
      <footer className="max-w-7xl mx-auto mt-12 pt-6 border-t border-zinc-900 text-center relative z-10 text-[10px] font-mono text-zinc-600 uppercase tracking-widest flex flex-col md:flex-row justify-between gap-4">
        <span>OpsVoice AI // SRE DevOps Voice Incident Commander</span>
        <span>AssemblyAI Voice Agent Hackathon Submission</span>
      </footer>

    </main>
  );
}
