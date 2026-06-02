"use client";

import { useState, useEffect } from "react";
import { Bot, CheckCircle2, ChevronRight, Wifi, Key, Server, Sparkles } from "lucide-react";
import { getHealth } from "@/lib/api";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "aipiloty_onboarding_complete";

interface Step {
  id: number;
  icon: React.ReactNode;
  title: string;
  description: string;
}

const STEPS: Step[] = [
  {
    id: 1,
    icon: <Sparkles size={22} className="text-indigo-400" />,
    title: "Welcome to AIPiloty",
    description:
      "Your AI-powered DevOps assistant. Chat with the AI, manage VMs via SSH, run deployments, and generate documents — all in one place.",
  },
  {
    id: 2,
    icon: <Wifi size={22} className="text-emerald-400" />,
    title: "Verify backend connection",
    description: "Let's make sure your backend and Ollama LLM are reachable before you start.",
  },
  {
    id: 3,
    icon: <Key size={22} className="text-amber-400" />,
    title: "Secure your account",
    description:
      "Change the default password in Settings → Account to protect your platform.",
  },
  {
    id: 4,
    icon: <Server size={22} className="text-cyan-400" />,
    title: "Add your first VM",
    description:
      "Connect a server so the AI can run SSH commands and monitor your infrastructure.",
  },
];

export default function OnboardingWizard() {
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);
  const [healthStatus, setHealthStatus] = useState<"idle" | "checking" | "ok" | "fail">("idle");

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setShow(true);
    } catch {
      /* storage blocked */
    }
  }, []);

  const checkHealth = async () => {
    setHealthStatus("checking");
    try {
      await getHealth();
      setHealthStatus("ok");
    } catch {
      setHealthStatus("fail");
    }
  };

  const finish = () => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* ignore */ }
    setShow(false);
  };

  const advance = () => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
      if (STEPS[step + 1].id === 2) checkHealth();
    } else {
      finish();
    }
  };

  if (!show) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-3xl shadow-2xl overflow-hidden animate-fade-slide-up">
        {/* Progress bar */}
        <div className="h-1 bg-gray-800">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        <div className="p-8">
          {/* Step indicator */}
          <p className="text-xs text-gray-500 mb-6 tracking-wider uppercase">
            Step {step + 1} of {STEPS.length}
          </p>

          {/* Icon */}
          <div className="w-14 h-14 rounded-2xl bg-gray-800 border border-gray-700 flex items-center justify-center mb-5">
            {current.icon}
          </div>

          <h2 className="text-xl font-bold text-white mb-2">{current.title}</h2>
          <p className="text-sm text-gray-400 leading-relaxed mb-8">{current.description}</p>

          {/* Health check step */}
          {current.id === 2 && (
            <div className="mb-6">
              {healthStatus === "idle" && (
                <button
                  onClick={checkHealth}
                  className="w-full py-2.5 rounded-xl border border-gray-700 text-gray-300 text-sm hover:bg-gray-800 transition-colors"
                >
                  Run connection check
                </button>
              )}
              {healthStatus === "checking" && (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  Checking…
                </div>
              )}
              {healthStatus === "ok" && (
                <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-900/20 border border-emerald-800/30 rounded-xl px-4 py-3">
                  <CheckCircle2 size={16} />
                  Backend and Ollama are connected!
                </div>
              )}
              {healthStatus === "fail" && (
                <div className="text-sm text-red-400 bg-red-900/20 border border-red-800/30 rounded-xl px-4 py-3">
                  Could not reach the backend. Make sure it's running on port 8100 before continuing.
                </div>
              )}
            </div>
          )}

          {/* Step dots */}
          <div className="flex items-center gap-1.5 mb-8">
            {STEPS.map((s, i) => (
              <div
                key={s.id}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i <= step ? "bg-indigo-500" : "bg-gray-700",
                  i === step ? "w-6" : "w-1.5"
                )}
              />
            ))}
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={finish}
              className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
            >
              Skip setup
            </button>
            <button
              onClick={advance}
              disabled={current.id === 2 && healthStatus === "checking"}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              {isLast ? "Get started" : "Next"}
              {!isLast && <ChevronRight size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
