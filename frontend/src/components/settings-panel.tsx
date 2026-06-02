"use client";

import { useState, useEffect } from "react";
import { useChatStore, type ToolPermission } from "@/stores/chat-store";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, X, Shield, Zap, Terminal, Server, FileCode, Globe, Palette, Power, BrainCircuit, Database, Image } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n, AVAILABLE_LOCALES } from "@/i18n";
import ThemeToggle from "./theme-toggle";
import { getServices, toggleService, type ServicesResponse } from "@/lib/api";

const TOOL_CATEGORIES = [
  { id: "ssh_command", label: "SSH Command", icon: Terminal },
  { id: "run_terminal_command", label: "Terminal", icon: Terminal },
  { id: "deploy", label: "Deploy", icon: Server },
  { id: "vm_health_check", label: "VM Health Check", icon: Server },
  { id: "generate_pdf", label: "Generate PDF", icon: FileCode },
  { id: "generate_xlsx", label: "Generate XLSX", icon: FileCode },
  { id: "generate_image", label: "Generate Image", icon: FileCode },
];

const PERMISSION_OPTIONS: { value: ToolPermission; label: string; color: string }[] = [
  { value: "always_ask", label: "Always Ask", color: "text-amber-400" },
  { value: "auto_approve", label: "Auto Approve", color: "text-emerald-400" },
  { value: "block", label: "Block", color: "text-red-400" },
];

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * IDE-inspired settings drawer for the Trust & Control system.
 * Manages auto-approve rules, command whitelist/blacklist, and per-tool permissions.
 * Settings are persisted to localStorage via the Zustand store.
 */
export default function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { approvalSettings, setApprovalSettings } = useChatStore();
  const { locale, setLocale } = useI18n();
  const [whitelistInput, setWhitelistInput] = useState("");
  const [blacklistInput, setBlacklistInput] = useState("");
  const [activeTab, setActiveTab] = useState<"control" | "services">("control");
  const [services, setServices] = useState<ServicesResponse | null>(null);
  const [togglingService, setTogglingService] = useState<string | null>(null);

  useEffect(() => {
    if (open && activeTab === "services") {
      getServices().then(setServices).catch(() => {});
    }
  }, [open, activeTab]);

  const handleToggleService = async (service: string, enabled: boolean) => {
    setTogglingService(service);
    try {
      await toggleService(service, enabled);
      const updated = await getServices();
      setServices(updated);
    } catch { /* silent */ } finally {
      setTogglingService(null);
    }
  };

  const addToWhitelist = () => {
    const trimmed = whitelistInput.trim();
    if (trimmed && !approvalSettings.whitelist.includes(trimmed)) {
      setApprovalSettings({ whitelist: [...approvalSettings.whitelist, trimmed] });
    }
    setWhitelistInput("");
  };

  const removeFromWhitelist = (item: string) => {
    setApprovalSettings({ whitelist: approvalSettings.whitelist.filter((w) => w !== item) });
  };

  const addToBlacklist = () => {
    const trimmed = blacklistInput.trim();
    if (trimmed && !approvalSettings.blacklist.includes(trimmed)) {
      setApprovalSettings({ blacklist: [...approvalSettings.blacklist, trimmed] });
    }
    setBlacklistInput("");
  };

  const removeFromBlacklist = (item: string) => {
    setApprovalSettings({ blacklist: approvalSettings.blacklist.filter((b) => b !== item) });
  };

  const setToolPermission = (toolId: string, permission: ToolPermission) => {
    setApprovalSettings({
      perToolRules: { ...approvalSettings.perToolRules, [toolId]: permission },
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Trust & Control settings"
            initial={{ x: 320, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 320, opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-80 bg-gray-950 border-l border-gray-800/60 overflow-y-auto scrollbar-thin"
          >
            {/* Header */}
            <div className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur-md border-b border-gray-800/40 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings size={16} className="text-gray-400" />
                <h2 className="text-sm font-semibold text-gray-200">Trust & Control</h2>
              </div>
              <button
                onClick={onClose}
                aria-label="Close settings"
                className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800/50 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Tab bar */}
            <div className="flex border-b border-gray-800/40 px-4">
              {(["control", "services"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "py-2 px-3 text-[11px] font-medium capitalize transition-colors border-b-2 -mb-px",
                    activeTab === tab
                      ? "border-indigo-500 text-indigo-300"
                      : "border-transparent text-gray-500 hover:text-gray-300"
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="p-4 space-y-6">
              {activeTab === "services" && (
                <section className="space-y-3">
                  <h3 className="text-[10px] uppercase tracking-widest text-gray-600 font-medium flex items-center gap-1.5">
                    <Power size={10} /> Runtime Services
                  </h3>
                  {!services && (
                    <p className="text-[11px] text-gray-500 italic">Loading…</p>
                  )}
                  {services && [
                    { key: "ollama", label: "Ollama (LLM)", icon: BrainCircuit, meta: services.ollama.model },
                    { key: "qdrant", label: "Qdrant (RAG)", icon: Database, meta: services.qdrant.url },
                    { key: "image_gen", label: "Image Generation", icon: Image, meta: services.image_gen.provider },
                  ].map(({ key, label, icon: Icon, meta }) => {
                    const svc = services[key as keyof ServicesResponse];
                    const isToggling = togglingService === key;
                    return (
                      <div key={key} className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-gray-900/50 border border-gray-800/40">
                        <div className="flex items-center gap-2">
                          <Icon size={14} className={svc.active ? "text-indigo-400" : "text-gray-600"} />
                          <div>
                            <p className="text-xs text-gray-300 font-medium">{label}</p>
                            {meta && <p className="text-[10px] text-gray-600 truncate max-w-[120px]">{meta}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={cn("w-1.5 h-1.5 rounded-full", svc.reachable ? "bg-emerald-400" : "bg-red-500")} />
                          <button
                            disabled={isToggling}
                            onClick={() => handleToggleService(key, !svc.enabled)}
                            className={cn(
                              "relative w-9 h-5 rounded-full transition-colors focus:outline-none",
                              svc.enabled ? "bg-indigo-600" : "bg-gray-700",
                              isToggling && "opacity-50 cursor-not-allowed"
                            )}
                          >
                            <span className={cn(
                              "absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform",
                              svc.enabled ? "translate-x-4" : "translate-x-0"
                            )} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </section>
              )}

              {activeTab === "control" && <>
              {/* ── Auto-approve toggles ── */}
              <section>
                <h3 className="text-[10px] uppercase tracking-widest text-gray-600 font-medium mb-3 flex items-center gap-1.5">
                  <Shield size={10} /> Approval Rules
                </h3>

                <label className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-gray-900/50 border border-gray-800/40 mb-2 cursor-pointer hover:bg-gray-900/70 transition-colors">
                  <div>
                    <p className="text-xs text-gray-300 font-medium">Auto-approve safe commands</p>
                    <p className="text-[10px] text-gray-600">Skip confirmation for low-risk operations</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={approvalSettings.autoApproveSafe}
                    onChange={(e) => setApprovalSettings({ autoApproveSafe: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-700 bg-gray-800 text-indigo-500 focus:ring-indigo-500/30"
                  />
                </label>

                <label className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-gray-900/50 border border-gray-800/40 cursor-pointer hover:bg-gray-900/70 transition-colors">
                  <div>
                    <p className="text-xs text-gray-300 font-medium">Auto-approve this session</p>
                    <p className="text-[10px] text-gray-600">Trust all commands until reload</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={approvalSettings.autoApproveSession}
                    onChange={(e) => setApprovalSettings({ autoApproveSession: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-700 bg-gray-800 text-amber-500 focus:ring-amber-500/30"
                  />
                </label>
              </section>

              {/* ── Per-tool permissions ── */}
              <section>
                <h3 className="text-[10px] uppercase tracking-widest text-gray-600 font-medium mb-3 flex items-center gap-1.5">
                  <Zap size={10} /> Per-Tool Permissions
                </h3>

                <div className="space-y-1.5">
                  {TOOL_CATEGORIES.map(({ id, label, icon: Icon }) => {
                    const current = approvalSettings.perToolRules[id] || "always_ask";
                    return (
                      <div key={id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-900/40 border border-gray-800/30">
                        <div className="flex items-center gap-2">
                          <Icon size={12} className="text-gray-500" />
                          <span className="text-xs text-gray-300">{label}</span>
                        </div>
                        <select
                          value={current}
                          onChange={(e) => setToolPermission(id, e.target.value as ToolPermission)}
                          className="text-[10px] bg-gray-800 border border-gray-700/50 rounded px-1.5 py-1 text-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
                        >
                          {PERMISSION_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* ── Whitelist ── */}
              <section>
                <h3 className="text-[10px] uppercase tracking-widest text-gray-600 font-medium mb-2">
                  Command Whitelist
                </h3>
                <div className="flex gap-1.5 mb-2">
                  <input
                    type="text"
                    value={whitelistInput}
                    onChange={(e) => setWhitelistInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addToWhitelist()}
                    placeholder="e.g. ls, cat, echo"
                    className="flex-1 text-[11px] bg-gray-900/60 border border-gray-800/50 rounded-lg px-2.5 py-1.5 text-gray-300 placeholder:text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
                  />
                  <button
                    onClick={addToWhitelist}
                    className="px-2.5 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-gray-200 text-[10px] font-medium border border-gray-700/50 hover:bg-gray-700/80 transition-colors"
                  >
                    Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {approvalSettings.whitelist.map((item) => (
                    <span key={item} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-900/30 border border-emerald-800/30 text-[10px] text-emerald-400">
                      {item}
                      <button onClick={() => removeFromWhitelist(item)} className="hover:text-emerald-200">
                        <X size={8} />
                      </button>
                    </span>
                  ))}
                </div>
              </section>

              {/* ── Blacklist ── */}
              <section>
                <h3 className="text-[10px] uppercase tracking-widest text-gray-600 font-medium mb-2">
                  Command Blacklist
                </h3>
                <div className="flex gap-1.5 mb-2">
                  <input
                    type="text"
                    value={blacklistInput}
                    onChange={(e) => setBlacklistInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addToBlacklist()}
                    placeholder="e.g. rm -rf, drop table"
                    className="flex-1 text-[11px] bg-gray-900/60 border border-gray-800/50 rounded-lg px-2.5 py-1.5 text-gray-300 placeholder:text-gray-700 focus:outline-none focus:ring-1 focus:ring-red-500/30"
                  />
                  <button
                    onClick={addToBlacklist}
                    className="px-2.5 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-gray-200 text-[10px] font-medium border border-gray-700/50 hover:bg-gray-700/80 transition-colors"
                  >
                    Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {approvalSettings.blacklist.map((item) => (
                    <span key={item} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-900/30 border border-red-800/30 text-[10px] text-red-400">
                      {item}
                      <button onClick={() => removeFromBlacklist(item)} className="hover:text-red-200">
                        <X size={8} />
                      </button>
                    </span>
                  ))}
                </div>
              </section>

              {/* ── Language ── */}
              <section>
                <h3 className="text-[10px] uppercase tracking-widest text-gray-600 font-medium mb-3 flex items-center gap-1.5">
                  <Globe size={10} /> Language
                </h3>
                <div className="flex gap-2">
                  {AVAILABLE_LOCALES.map((l) => (
                    <button
                      key={l.code}
                      onClick={() => setLocale(l.code)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                        locale === l.code
                          ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-300"
                          : "bg-gray-900/50 border-gray-800/40 text-gray-400 hover:bg-gray-800/60 hover:text-gray-200"
                      )}
                    >
                      {l.nativeLabel}
                    </button>
                  ))}
                </div>
              </section>

              {/* ── Theme ── */}
              <section>
                <h3 className="text-[10px] uppercase tracking-widest text-gray-600 font-medium mb-3 flex items-center gap-1.5">
                  <Palette size={10} /> Theme
                </h3>
                <ThemeToggle />
              </section>
              </>}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
