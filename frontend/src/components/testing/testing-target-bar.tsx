"use client";

import { useState, useRef } from "react";
import {
  Globe, Lock, Tag, Eye, EyeOff, Radio, AlertCircle, CheckCircle2,
  Loader2, X,
} from "lucide-react";
import { useTestingStore } from "@/stores/testing-store";
import { cn } from "@/lib/utils";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8100/api/v1";
const API_KEY  = process.env.NEXT_PUBLIC_API_KEY  || "aipiloty-dev-key";

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json", "X-API-Key": API_KEY };
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("jwt_token");
    if (token) h["Authorization"] = `Bearer ${token}`;
  }
  return h;
}

// ── Status dot ────────────────────────────────────────────────────────────────
function StatusDot({ status }: { status: "unknown" | "reachable" | "unreachable" | "probing" }) {
  const map = {
    unknown:     { cls: "bg-gray-600",                  label: "Unknown" },
    reachable:   { cls: "bg-emerald-500 animate-pulse", label: "Reachable" },
    unreachable: { cls: "bg-red-500",                   label: "Unreachable" },
    probing:     { cls: "bg-amber-500 animate-ping",    label: "Probing…" },
  };
  const { cls, label } = map[status];
  return (
    <span className="flex items-center gap-1.5 text-[10px] text-gray-500">
      <span className={cn("w-2 h-2 rounded-full inline-block", cls)} />
      {label}
    </span>
  );
}

// ── Main bar ──────────────────────────────────────────────────────────────────
export default function TestingTargetBar() {
  const targetUrl      = useTestingStore((s) => s.targetUrl);
  const authHeader     = useTestingStore((s) => s.authHeader);
  const envLabel       = useTestingStore((s) => s.envLabel);
  const probeStatus    = useTestingStore((s) => s.probeStatus);
  const setTargetUrl   = useTestingStore((s) => s.setTargetUrl);
  const setAuthHeader  = useTestingStore((s) => s.setAuthHeader);
  const setEnvLabel    = useTestingStore((s) => s.setEnvLabel);
  const setProbeStatus = useTestingStore((s) => s.setProbeStatus);
  const sendMessage    = useTestingStore((s) => s.sendMessage);

  const [showAuth, setShowAuth]     = useState(false);
  const [expanded, setExpanded]     = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const abortRef                    = useRef<AbortController | null>(null);

  const ENV_OPTIONS = ["staging", "production", "dev", "qa", "sandbox"];

  const handleProbe = async () => {
    if (!targetUrl) return;
    setProbeStatus("probing");
    setProbeError(null);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(`${API_BASE}/testing/chat/stream`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          messages: [{ role: "user", content: `Probe ${targetUrl} for connectivity — just report the HTTP status code and latency. One sentence.` }],
          testing_context: { url: targetUrl, auth_header: authHeader || undefined, env_label: envLabel },
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Drain the stream for the result
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No body");
      const decoder = new TextDecoder();
      let buf = "";
      let status: "reachable" | "unreachable" = "unreachable";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === "token") {
              const t: string = ev.data.token ?? "";
              if (/200|201|ok|success|reachable/i.test(t)) status = "reachable";
              if (/error|fail|unreachable|timeout|refused/i.test(t)) status = "unreachable";
            }
            if (ev.type === "done" || ev.type === "error") break;
          } catch { /**/ }
        }
      }
      setProbeStatus(status);
    } catch (e: unknown) {
      if ((e as Error)?.name === "AbortError") return;
      setProbeStatus("unreachable");
      setProbeError((e as Error)?.message ?? "Probe failed");
    }
  };

  return (
    <div
      className={cn(
        "backdrop-blur-md bg-gray-900/50 border-b border-white/[0.06] transition-all duration-300",
        expanded ? "pb-3" : ""
      )}
    >
      {/* Primary row */}
      <div className="flex items-center gap-2 px-4 h-11">
        {/* URL input */}
        <div className="flex-1 flex items-center gap-2 bg-gray-800/50 border border-white/[0.08] rounded-xl px-3 py-1.5 transition-all focus-within:border-emerald-600/50 focus-within:bg-gray-800/80">
          <Globe className="w-3.5 h-3.5 text-gray-500 shrink-0" />
          <input
            type="url"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://api.example.com  (or type in chat)"
            className="flex-1 bg-transparent text-xs text-gray-200 placeholder-gray-600 focus:outline-none font-mono"
          />
          {targetUrl && (
            <button onClick={() => setTargetUrl("")} className="text-gray-600 hover:text-gray-400 transition-colors">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Status dot */}
        <StatusDot status={probeStatus} />

        {/* Probe button */}
        <button
          onClick={handleProbe}
          disabled={!targetUrl || probeStatus === "probing"}
          title="Probe target"
          className={cn(
            "flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl border font-medium transition-all",
            probeStatus === "probing"
              ? "border-amber-700/50 bg-amber-900/30 text-amber-400 cursor-wait"
              : "border-emerald-800/50 bg-emerald-900/20 text-emerald-400 hover:bg-emerald-900/40 disabled:opacity-40 disabled:cursor-not-allowed"
          )}
        >
          {probeStatus === "probing" ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Radio className="w-3 h-3" />
          )}
          Probe
        </button>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          title="Auth & env settings"
          className={cn(
            "flex items-center gap-1 text-[10px] px-2 py-1.5 rounded-xl border transition-all",
            expanded
              ? "border-indigo-700/50 bg-indigo-900/30 text-indigo-400"
              : "border-gray-700/50 bg-gray-800/40 text-gray-500 hover:text-gray-300"
          )}
        >
          <Lock className="w-3 h-3" />
          {authHeader ? (
            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" />
          ) : null}
        </button>
      </div>

      {/* Expanded auth + env row */}
      {expanded && (
        <div className="flex items-center gap-2 px-4 animate-[fadeSlideIn_0.15s_ease-out]">
          {/* Auth header */}
          <div className="flex-1 flex items-center gap-2 bg-gray-800/50 border border-white/[0.08] rounded-xl px-3 py-1.5 transition-all focus-within:border-indigo-600/50">
            <Lock className="w-3 h-3 text-gray-600 shrink-0" />
            <input
              type={showAuth ? "text" : "password"}
              value={authHeader}
              onChange={(e) => setAuthHeader(e.target.value)}
              placeholder="Bearer token or Basic auth (in-memory only)"
              className="flex-1 bg-transparent text-xs text-gray-300 placeholder-gray-600 focus:outline-none font-mono"
              autoComplete="off"
            />
            <button
              onClick={() => setShowAuth((v) => !v)}
              className="text-gray-600 hover:text-gray-400 transition-colors"
              title={showAuth ? "Hide" : "Show"}
            >
              {showAuth ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </button>
            {authHeader && (
              <button onClick={() => setAuthHeader("")} className="text-gray-600 hover:text-gray-400 transition-colors">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Env label */}
          <div className="flex items-center gap-2 bg-gray-800/50 border border-white/[0.08] rounded-xl px-3 py-1.5 focus-within:border-purple-600/50 transition-all">
            <Tag className="w-3 h-3 text-gray-600 shrink-0" />
            <select
              value={envLabel}
              onChange={(e) => setEnvLabel(e.target.value)}
              className="bg-transparent text-xs text-gray-300 focus:outline-none cursor-pointer"
            >
              <option value="">Env…</option>
              {ENV_OPTIONS.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Probe error banner */}
      {probeError && (
        <div className="mx-4 mt-1.5 flex items-center gap-2 text-xs text-red-400 bg-red-950/30 border border-red-800/30 rounded-lg px-3 py-1.5">
          <AlertCircle className="w-3 h-3 shrink-0" />
          {probeError}
          <button onClick={() => setProbeError(null)} className="ml-auto text-red-600 hover:text-red-400">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
