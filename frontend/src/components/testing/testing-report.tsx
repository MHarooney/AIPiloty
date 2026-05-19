"use client";

import { useState } from "react";
import {
  CheckCircle2, XCircle, Globe, Zap, AlertTriangle, Info,
  ChevronDown, ChevronRight, Download, Camera, Link2,
  ShieldCheck, TrendingUp, Clock, Cpu, Layers, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTestingStore } from "@/stores/testing-store";
import type { TestRun } from "@/stores/testing-store";

// ── Report shape (parsed from TestRun.output_json) ────────────────────────────

interface TestStep {
  step: number;
  tool: string;
  success: boolean;
  caption: string;
  note: string;
}

interface Suggestion {
  severity: "success" | "warning" | "error" | "info";
  title: string;
  detail: string;
  action: string;
}

interface ScreenshotCaption {
  caption: string;
  url: string;
  step: number;
}

interface TestReport {
  url: string;
  env_label: string;
  session_key: string;
  steps: TestStep[];
  discovered_endpoints: string[];
  discovered_pages: string[];
  screenshots_taken: number;
  screenshot_captions: ScreenshotCaption[];
  final_summary: string;
  suggestions: Suggestion[];
  generated_at: string;
}

// ── Tool icon mapping ─────────────────────────────────────────────────────────

function toolIcon(toolName: string): React.ReactNode {
  const cls = "w-3 h-3";
  if (toolName.startsWith("browser_navigate")) return <Globe className={cls} />;
  if (toolName.startsWith("browser_click"))    return <Zap className={cls} />;
  if (toolName.startsWith("browser_fill"))     return <Layers className={cls} />;
  if (toolName.startsWith("browser_screenshot")) return <Camera className={cls} />;
  if (toolName.startsWith("browser_evaluate")) return <Cpu className={cls} />;
  if (toolName.startsWith("discover"))         return <Link2 className={cls} />;
  if (toolName.startsWith("probe"))            return <TrendingUp className={cls} />;
  if (toolName.startsWith("run_api"))          return <ShieldCheck className={cls} />;
  return <Cpu className={cls} />;
}

// ── Health Score Gauge ────────────────────────────────────────────────────────

function HealthGauge({ pass, fail }: { pass: number; fail: number }) {
  const total = pass + fail || 1;
  const score = Math.round((pass / total) * 100);
  const color = score >= 80 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";
  const R = 34;
  const C = 2 * Math.PI * R;
  const arc = (score / 100) * C;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-20 h-20">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r={R} fill="none" stroke="#1f2937" strokeWidth="8" />
          <circle
            cx="40" cy="40" r={R} fill="none"
            stroke={color} strokeWidth="8"
            strokeDasharray={`${arc} ${C - arc}`}
            strokeDashoffset="0"
            strokeLinecap="round"
            className="transition-all duration-1000"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold tabular-nums leading-none" style={{ color }}>{score}%</span>
          <span className="text-[9px] text-gray-500 uppercase tracking-wide">health</span>
        </div>
      </div>
    </div>
  );
}

// ── Suggestion card ───────────────────────────────────────────────────────────

const SEVERITY_STYLES = {
  success: { border: "border-emerald-800/40", bg: "bg-emerald-950/30", icon: CheckCircle2, iconColor: "text-emerald-400", label: "text-emerald-400" },
  warning: { border: "border-amber-800/40",   bg: "bg-amber-950/30",   icon: AlertTriangle,  iconColor: "text-amber-400",   label: "text-amber-400" },
  error:   { border: "border-red-800/40",     bg: "bg-red-950/30",     icon: XCircle,        iconColor: "text-red-400",     label: "text-red-400" },
  info:    { border: "border-blue-800/40",    bg: "bg-blue-950/30",    icon: Info,           iconColor: "text-blue-400",    label: "text-blue-400" },
} as const;

function SuggestionCard({ s, idx }: { s: Suggestion; idx: number }) {
  const [open, setOpen] = useState(false);
  const sendMessage  = useTestingStore((st) => st.sendMessage);
  const isStreaming  = useTestingStore((st) => st.isStreaming);
  const cfg = SEVERITY_STYLES[s.severity] ?? SEVERITY_STYLES.info;
  const Icon = cfg.icon;

  // Extract the actual prompt text from "Ask: 'do something'" patterns
  const extractPrompt = (action: string): string => {
    const m = action.match(/Ask:\s*['“‘](.+?)['”’]/i);
    return m ? m[1] : action.replace(/^(ask|try|run)[:\s]+/i, "").trim();
  };
  const isActionable = /ask:/i.test(s.action);

  return (
    <div
      className={cn(
        "rounded-xl border overflow-hidden transition-all duration-200 group",
        cfg.border, cfg.bg,
      )}
      style={{ animationDelay: `${idx * 60}ms` }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-2.5 p-2.5 text-left hover:bg-white/[0.02] transition-colors"
      >
        <Icon className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", cfg.iconColor)} />
        <span className={cn("text-xs font-semibold flex-1 leading-snug", cfg.label)}>{s.title}</span>
        {open
          ? <ChevronDown className="w-3 h-3 text-gray-600 shrink-0 mt-0.5" />
          : <ChevronRight className="w-3 h-3 text-gray-600 shrink-0 mt-0.5" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2.5 border-t border-white/5 pt-2.5">
          <p className="text-[11px] text-gray-400 leading-relaxed">{s.detail}</p>
          <div className="flex items-start gap-2">
            <p className="text-[11px] text-gray-500 italic flex-1 leading-relaxed">↳ {s.action}</p>
            {isActionable && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isStreaming) sendMessage(extractPrompt(s.action));
                }}
                disabled={isStreaming}
                title="Send to chat as a new prompt"
                className={cn(
                  "flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide",
                  "px-2.5 py-1.5 rounded-lg border transition-all shrink-0 active:scale-95",
                  "border-gray-600/50 bg-gray-800/80 text-gray-300 hover:text-white",
                  "hover:bg-gray-700 hover:border-gray-500",
                  "disabled:opacity-40 disabled:cursor-not-allowed",
                )}
              >
                <Zap className="w-2.5 h-2.5" />
                Apply
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step timeline row ─────────────────────────────────────────────────────────

function StepRow({ step, isLast }: { step: TestStep; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex gap-2.5">
      {/* Timeline track */}
      <div className="flex flex-col items-center pt-0.5">
        <div className={cn(
          "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors",
          step.success
            ? "border-emerald-600 bg-emerald-950/60 text-emerald-400"
            : "border-red-600 bg-red-950/60 text-red-400"
        )}>
          {step.success
            ? <CheckCircle2 className="w-2.5 h-2.5" />
            : <XCircle className="w-2.5 h-2.5" />}
        </div>
        {!isLast && <div className="w-px flex-1 mt-1 bg-gray-800/70 min-h-[12px]" />}
      </div>

      {/* Content */}
      <div className="pb-3 flex-1 min-w-0">
        <button
          className="w-full text-left"
          onClick={() => step.note && setExpanded((v) => !v)}
        >
          <div className="flex items-center gap-1.5">
            <span className={cn("w-4 text-center text-[9px] font-mono text-gray-600 shrink-0")}>{step.step}</span>
            <span className={cn("p-0.5 rounded", step.success ? "text-emerald-500" : "text-red-500")}>
              {toolIcon(step.tool)}
            </span>
            <span className="text-xs text-gray-300 font-medium truncate">{step.caption}</span>
            {step.note && (expanded
              ? <ChevronDown className="w-3 h-3 text-gray-600 ml-auto shrink-0" />
              : <ChevronRight className="w-3 h-3 text-gray-600 ml-auto shrink-0" />
            )}
          </div>
        </button>
        {expanded && step.note && (
          <p className="mt-1 text-[11px] text-gray-500 ml-7 leading-relaxed border-l border-gray-800 pl-2">
            {step.note}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Endpoint list ─────────────────────────────────────────────────────────────

function EndpointList({ endpoints, title, icon: Icon, emptyMsg }: {
  endpoints: string[];
  title: string;
  icon: React.ElementType;
  emptyMsg: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? endpoints : endpoints.slice(0, 6);

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800/50 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800/50 bg-gray-900/30">
        <Icon className="w-3.5 h-3.5 text-gray-500" />
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{title}</span>
        <span className="ml-auto text-[10px] text-gray-600 font-mono">{endpoints.length}</span>
      </div>
      {endpoints.length === 0 ? (
        <p className="text-[11px] text-gray-600 p-3">{emptyMsg}</p>
      ) : (
        <div className="p-2 space-y-0.5">
          {visible.map((ep, i) => (
            <div key={i} className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-gray-800/40 group">
              <span className="text-[10px] font-mono text-gray-400 truncate flex-1">{ep}</span>
              <ExternalLink className="w-2.5 h-2.5 text-gray-700 group-hover:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </div>
          ))}
          {endpoints.length > 6 && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="w-full text-center text-[10px] text-gray-600 hover:text-gray-400 pt-1 transition-colors"
            >
              {showAll ? "Show less" : `+${endpoints.length - 6} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Screenshot Evidence Gallery ───────────────────────────────────────────────

function ScreenshotGallery({ captions }: { captions: ScreenshotCaption[] }) {
  const storeShots = useTestingStore((s) => s.screenshots);
  const [selected, setSelected] = useState<number | null>(null);

  const items =
    captions.length > 0
      ? captions.map((cap) => ({
          step: cap.step,
          caption: cap.caption,
          url: cap.url,
          image_b64: storeShots.find((s) => s.step === cap.step)?.image_b64 ?? null,
        }))
      : storeShots.map((s) => ({
          step: s.step,
          caption: s.caption,
          url: s.url,
          image_b64: s.image_b64,
        }));

  if (items.length === 0) return null;
  const hasImages = items.some((i) => i.image_b64);

  return (
    <div>
      <h3 className="text-[10px] uppercase text-gray-600 tracking-wider font-semibold mb-2 flex items-center gap-1.5">
        <Camera className="w-3 h-3" />
        Screenshot Evidence
        <span className="font-mono text-gray-700">({items.length})</span>
      </h3>
      <div className={cn("grid gap-2", hasImages ? "grid-cols-2" : "grid-cols-1")}>
        {items.map((item, i) => (
          <div
            key={i}
            onClick={() => setSelected(selected === i ? null : i)}
            className={cn(
              "rounded-xl overflow-hidden border bg-gray-900/50 cursor-pointer group",
              "transition-all duration-200 hover:border-gray-700/60 hover:bg-gray-900/70",
              selected === i
                ? "border-emerald-700/50 ring-1 ring-emerald-700/30"
                : "border-gray-800/60",
            )}
          >
            {item.image_b64 ? (
              <>
                <div className="relative overflow-hidden bg-gray-950">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:image/jpeg;base64,${item.image_b64}`}
                    alt={item.caption}
                    className="w-full object-cover object-top transition-all duration-300 group-hover:brightness-110"
                    style={{ maxHeight: selected === i ? "240px" : "80px" }}
                  />
                  <span className="absolute top-1.5 left-1.5 bg-black/75 text-zinc-300 text-[9px] font-mono px-1.5 py-0.5 rounded border border-zinc-700/40 backdrop-blur-sm">
                    Step {item.step}
                  </span>
                  {selected !== i && (
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-2">
                      <span className="text-[9px] text-white/70 bg-black/50 px-2 py-0.5 rounded-full">click to expand</span>
                    </div>
                  )}
                </div>
                <div className="px-2 py-1.5 flex items-center gap-1.5 border-t border-gray-800/60">
                  <span className="text-[10px] text-gray-400 truncate flex-1">{item.caption}</span>
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-700 hover:text-gray-400 transition-colors shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 p-2.5">
                <div className="w-7 h-7 rounded-lg bg-gray-800 border border-gray-700/50 flex items-center justify-center shrink-0">
                  <Camera className="w-3.5 h-3.5 text-gray-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] text-gray-600 font-mono">Step {item.step}</p>
                  <p className="text-[10px] text-gray-400 truncate">{item.caption}</p>
                </div>
                {item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-700 hover:text-gray-400 transition-colors shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PDF Export ────────────────────────────────────────────────────────────────

function printReport(report: TestReport, run: TestRun) {
  const total = run.pass_count + run.fail_count || 1;
  const score = Math.round((run.pass_count / total) * 100);
  const scoreColor = score >= 80 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";
  const date = new Date(run.created_at).toLocaleString();

  const stepsHtml = report.steps.map(s => `
    <tr style="border-bottom:1px solid #e5e7eb">
      <td style="padding:6px 8px;font-size:12px;color:#6b7280">${s.step}</td>
      <td style="padding:6px 8px;font-size:12px;font-family:monospace">${s.tool}</td>
      <td style="padding:6px 8px;font-size:12px">${s.caption}</td>
      <td style="padding:6px 8px;font-size:12px;color:${s.success ? "#10b981" : "#ef4444"}">${s.success ? "✓ Pass" : "✗ Fail"}</td>
      <td style="padding:6px 8px;font-size:11px;color:#6b7280">${s.note}</td>
    </tr>`).join("");

  const suggestionsHtml = report.suggestions.map(s => {
    const color = { success: "#10b981", warning: "#f59e0b", error: "#ef4444", info: "#3b82f6" }[s.severity] || "#6b7280";
    return `<div style="margin-bottom:8px;padding:10px;border:1px solid ${color}33;border-radius:8px;background:${color}11">
      <div style="font-weight:600;font-size:12px;color:${color};margin-bottom:4px">${s.severity.toUpperCase()}: ${s.title}</div>
      <div style="font-size:11px;color:#374151;margin-bottom:3px">${s.detail}</div>
      <div style="font-size:11px;color:#6b7280;font-style:italic">Action: ${s.action}</div>
    </div>`;
  }).join("");

  const endpointsHtml = report.discovered_endpoints.map(ep =>
    `<div style="font-family:monospace;font-size:11px;padding:3px 0;color:#374151;border-bottom:1px solid #f3f4f6">${ep}</div>`
  ).join("") || "<p style='color:#9ca3af;font-size:12px'>None detected</p>";

  const html = `<!DOCTYPE html><html><head>
  <meta charset="utf-8">
  <title>Test Report — ${report.url}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111827; background: #fff; padding: 32px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
    h2 { font-size: 14px; font-weight: 600; margin: 20px 0 8px; color: #374151; border-bottom: 2px solid #f3f4f6; padding-bottom: 4px; }
    .meta { font-size: 12px; color: #6b7280; margin-bottom: 24px; }
    .stats { display: flex; gap: 16px; margin-bottom: 20px; }
    .stat { text-align: center; padding: 12px 20px; border: 1px solid #e5e7eb; border-radius: 8px; }
    .stat-value { font-size: 24px; font-weight: 700; }
    .stat-label { font-size: 11px; color: #9ca3af; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; padding: 8px; background: #f9fafb; font-size: 11px; text-transform: uppercase; color: #6b7280; border-bottom: 2px solid #e5e7eb; }
    .summary { font-size: 12px; color: #374151; line-height: 1.6; background: #f9fafb; border-radius: 8px; padding: 12px; white-space: pre-wrap; }
    @media print { body { padding: 16px; } }
  </style>
  </head><body>
  <h1>Test Report</h1>
  <div class="meta">
    <strong>URL:</strong> ${report.url || "N/A"} &nbsp;·&nbsp;
    <strong>Environment:</strong> ${report.env_label || "N/A"} &nbsp;·&nbsp;
    <strong>Generated:</strong> ${date} &nbsp;·&nbsp;
    <strong>Session:</strong> ${report.session_key}
  </div>

  <div class="stats">
    <div class="stat"><div class="stat-value" style="color:${scoreColor}">${score}%</div><div class="stat-label">Health</div></div>
    <div class="stat"><div class="stat-value" style="color:#10b981">${run.pass_count}</div><div class="stat-label">Passed</div></div>
    <div class="stat"><div class="stat-value" style="color:#ef4444">${run.fail_count}</div><div class="stat-label">Failed</div></div>
    <div class="stat"><div class="stat-value" style="color:#6b7280">${report.steps.length}</div><div class="stat-label">Steps</div></div>
    <div class="stat"><div class="stat-value" style="color:#3b82f6">${report.discovered_endpoints.length}</div><div class="stat-label">Endpoints</div></div>
    <div class="stat"><div class="stat-value" style="color:#8b5cf6">${report.screenshots_taken}</div><div class="stat-label">Screenshots</div></div>
  </div>

  <h2>Test Steps</h2>
  <table><thead><tr>
    <th>#</th><th>Tool</th><th>Action</th><th>Status</th><th>Note</th>
  </tr></thead><tbody>${stepsHtml}</tbody></table>

  <h2>Discovered API Endpoints (${report.discovered_endpoints.length})</h2>
  ${endpointsHtml}

  <h2>Suggestions (${report.suggestions.length})</h2>
  ${suggestionsHtml}

  ${report.final_summary ? `<h2>AI Summary</h2><div class="summary">${report.final_summary}</div>` : ""}
  </body></html>`;

  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

// ── Main TestingReport component ──────────────────────────────────────────────

export default function TestingReport({ run }: { run: TestRun }) {
  let report: TestReport | null = null;
  try {
    if (run.output_json) report = JSON.parse(run.output_json);
  } catch {
    // malformed JSON
  }

  const date = new Date(run.created_at).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* ── Report header ── */}
      <div className="sticky top-0 z-10 flex items-center gap-3 px-3 py-2.5 border-b border-gray-800/50 bg-gray-950/90 backdrop-blur-sm">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-200 truncate">
              {report?.url || `Run #${run.id}`}
            </span>
            {report?.env_label && (
              <span className="text-[9px] bg-blue-900/40 text-blue-400 border border-blue-800/30 rounded px-1.5 py-0.5 shrink-0">
                {report.env_label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <Clock className="w-2.5 h-2.5 text-gray-600" />
            <span className="text-[10px] text-gray-600">{date}</span>
          </div>
        </div>
        <button
          onClick={() => report && printReport(report, run)}
          disabled={!report}
          className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-white border border-gray-700/50 hover:border-gray-500 rounded-lg px-2.5 py-1.5 transition-all disabled:opacity-30"
          title="Export PDF"
        >
          <Download className="w-3 h-3" />
          PDF
        </button>
      </div>

      <div className="p-3 space-y-4">
        {/* ── Hero stats row ── */}
        <div className="flex items-center gap-3">
          <HealthGauge pass={run.pass_count} fail={run.fail_count} />
          <div className="flex-1 grid grid-cols-2 gap-2">
            {[
              { label: "Passed",      value: run.pass_count,                color: "text-emerald-400", bg: "bg-emerald-950/30 border-emerald-800/30" },
              { label: "Failed",      value: run.fail_count,                color: "text-red-400",     bg: "bg-red-950/30 border-red-800/30" },
              { label: "Steps",       value: report?.steps.length ?? 0,     color: "text-gray-300",    bg: "bg-gray-900/50 border-gray-800/30" },
              { label: "Endpoints",   value: report?.discovered_endpoints.length ?? 0, color: "text-blue-400", bg: "bg-blue-950/30 border-blue-800/30" },
            ].map(({ label, value, color, bg }) => (
              <div key={label} className={cn("rounded-xl p-2 text-center border", bg)}>
                <p className={cn("text-base font-bold tabular-nums", color)}>{value}</p>
                <p className="text-[9px] uppercase text-gray-600">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Screenshot Evidence Gallery ── */}
        {report && report.screenshot_captions?.length > 0 && (
          <ScreenshotGallery captions={report.screenshot_captions} />
        )}

        {/* ── Test Steps Timeline ── */}
        {report && report.steps.length > 0 && (
          <div>
            <h3 className="text-[10px] uppercase text-gray-600 tracking-wider font-semibold mb-2 flex items-center gap-1">
              <Layers className="w-3 h-3" /> Test Steps
            </h3>
            <div className="bg-gray-900/30 rounded-xl border border-gray-800/50 p-3">
              {report.steps.map((step, i) => (
                <StepRow key={step.step} step={step} isLast={i === report!.steps.length - 1} />
              ))}
            </div>
          </div>
        )}

        {/* ── Discovered Assets ── */}
        {report && (report.discovered_endpoints.length > 0 || report.discovered_pages.length > 0) && (
          <div>
            <h3 className="text-[10px] uppercase text-gray-600 tracking-wider font-semibold mb-2 flex items-center gap-1">
              <Globe className="w-3 h-3" /> Discovered Assets
            </h3>
            <div className="space-y-2">
              <EndpointList
                endpoints={report.discovered_endpoints}
                title="API Endpoints"
                icon={ShieldCheck}
                emptyMsg="No API endpoints detected"
              />
              {report.discovered_pages.length > 0 && (
                <EndpointList
                  endpoints={report.discovered_pages}
                  title="Pages Visited"
                  icon={Globe}
                  emptyMsg="No pages recorded"
                />
              )}
            </div>
          </div>
        )}

        {/* ── Suggestions ── */}
        {report && report.suggestions.length > 0 && (
          <div>
            <h3 className="text-[10px] uppercase text-gray-600 tracking-wider font-semibold mb-2 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" /> Recommendations ({report.suggestions.length})
            </h3>
            <div className="space-y-1.5">
              {report.suggestions.map((s, i) => (
                <SuggestionCard key={i} s={s} idx={i} />
              ))}
            </div>
          </div>
        )}

        {/* ── AI Summary ── */}
        {report?.final_summary && (
          <div>
            <h3 className="text-[10px] uppercase text-gray-600 tracking-wider font-semibold mb-2 flex items-center gap-1.5">
              <Info className="w-3 h-3" /> AI Analysis
            </h3>
            <div className="bg-gradient-to-br from-gray-900/60 to-gray-900/30 rounded-xl border border-gray-800/50 p-3.5 space-y-1.5">
              {report.final_summary.split("\n").map((line, i) => {
                if (!line.trim()) return <div key={i} className="h-1" />;
                if (line.startsWith("- ") || line.startsWith("* ")) {
                  return (
                    <div key={i} className="flex items-start gap-2">
                      <span className="w-1 h-1 rounded-full bg-emerald-500/70 mt-2 shrink-0" />
                      <p className="text-[11px] text-gray-400 leading-relaxed">{line.slice(2)}</p>
                    </div>
                  );
                }
                if (/^#{1,3}\s/.test(line)) {
                  return <p key={i} className="text-[11px] font-semibold text-gray-300">{line.replace(/^#+\s/, "")}</p>;
                }
                return <p key={i} className="text-[11px] text-gray-400 leading-relaxed">{line}</p>;
              })}
            </div>
          </div>
        )}

        {/* Fallback if no report parsed */}
        {!report && (
          <div className="text-center py-6">
            <p className="text-xs text-gray-600">Report data unavailable for run #{run.id}.</p>
          </div>
        )}
      </div>
    </div>
  );
}
