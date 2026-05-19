"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Cpu, Zap, GitBranch, Activity, Radio, Shield,
  Search, Code2, Database, Terminal, Wifi, Check
} from "lucide-react";

/**
 * Processing Journey — a cinematic "story" of what the AI is doing
 * behind the scenes. Instead of a basic progress bar, this shows
 * an animated narrative with phases, floating particles, and a
 * living connection to the agent's internal process.
 */

const JOURNEY_PHRASES = [
  { text: "Initializing agent loop…", icon: Cpu, phase: "init" },
  { text: "Analyzing your request…", icon: Search, phase: "analyze" },
  { text: "Selecting optimal tools…", icon: GitBranch, phase: "select" },
  { text: "Establishing connection…", icon: Wifi, phase: "connect" },
  { text: "Executing command…", icon: Terminal, phase: "execute" },
  { text: "Processing results…", icon: Database, phase: "process" },
  { text: "Validating output…", icon: Shield, phase: "validate" },
  { text: "Preparing response…", icon: Code2, phase: "prepare" },
];

interface ToolRunningCardProps {
  toolName: string;
}

export default function ToolRunningCard({ toolName }: ToolRunningCardProps) {
  const [currentPhrase, setCurrentPhrase] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startTime = useRef(Date.now());

  // Cycle through journey phrases
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentPhrase((prev) => (prev + 1) % JOURNEY_PHRASES.length);
    }, 3200);
    return () => clearInterval(interval);
  }, []);

  // Elapsed timer
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const current = JOURNEY_PHRASES[currentPhrase];
  const Icon = current.icon;
  const progress = ((currentPhrase + 1) / JOURNEY_PHRASES.length) * 100;

  return (
    <div
      className="relative rounded-xl overflow-hidden animate-fade-slide-up"
      style={{
        border: "1px solid rgba(99,102,241,0.15)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(99,102,241,0.05)",
        background: "linear-gradient(145deg, rgba(15,15,35,0.95), rgba(10,10,26,0.98))",
      }}
    >
      {/* Animated background particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(12)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 rounded-full bg-indigo-400/20"
            style={{
              left: `${10 + (i * 7.5) % 85}%`,
              top: `${20 + (i * 13) % 60}%`,
              animation: `float-particle ${3 + (i % 3)}s ease-in-out infinite`,
              animationDelay: `${i * 0.3}s`,
            }}
          />
        ))}
        {/* Sweeping scan line */}
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(180deg, transparent, rgba(99,102,241,0.04), transparent)",
            animation: "scan-sweep 4s linear infinite",
          }}
        />
      </div>

      {/* Main content */}
      <div className="relative z-10 p-4">
        {/* Header row: tool name + elapsed time */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Activity size={14} className="text-indigo-400" />
              <div className="absolute inset-0 animate-ping text-indigo-400 opacity-30">
                <Activity size={14} />
              </div>
            </div>
            <span className="text-[10px] uppercase tracking-[0.15em] text-indigo-400/80 font-medium">
              Processing
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-gray-600 tabular-nums">
              {elapsed}s
            </span>
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-indigo-400/60"
                  style={{
                    animation: "pulse 1.4s ease-in-out infinite",
                    animationDelay: `${i * 0.2}s`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Tool name */}
        <div className="mb-4">
          <p className="text-sm font-medium text-gray-200">
            {toolName.replace(/_/g, " ")}
          </p>
        </div>

        {/* Journey narrative — animated phrase cycling */}
        <div className="relative h-8 mb-4 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentPhrase}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.35 }}
              className="absolute inset-0 flex items-center gap-2.5"
            >
              <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                <Icon size={14} className="text-indigo-400" />
              </div>
              <span className="text-xs text-gray-400">{current.text}</span>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Progress timeline dots */}
        <div className="flex items-center gap-1 mb-2">
          {JOURNEY_PHRASES.map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-all duration-500",
                i < currentPhrase
                  ? "bg-indigo-500/60"
                  : i === currentPhrase
                  ? "bg-indigo-400 shadow-[0_0_8px_rgba(99,102,241,0.4)]"
                  : "bg-gray-800/80"
              )}
            />
          ))}
        </div>

        {/* Bottom: live connection indicator */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-800/40">
          <div className="flex items-center gap-1.5">
            <Radio size={10} className="text-emerald-400 animate-pulse" />
            <span className="text-[9px] text-emerald-400/70 font-mono">LIVE CONNECTION</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Zap size={10} className="text-amber-400/60" />
            <span className="text-[9px] text-gray-600 font-mono">
              phase {currentPhrase + 1}/{JOURNEY_PHRASES.length}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
