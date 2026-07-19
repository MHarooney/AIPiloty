"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Copy,
  Check,
  AlertTriangle,
  GitBranch,
  Loader2,
  RefreshCw,
  Wand2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Download,
  FileImage,
  FileText,
  Image as ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildMermaidFixPrompt,
  mermaidRenderCandidates,
  salvageMermaidSource,
} from "@/lib/repair-mermaid";
import {
  downloadDiagramPdf,
  downloadDiagramPng,
  downloadDiagramSvg,
  enhanceMermaidSvgContrast,
} from "@/lib/export-diagram";
import { useChatStore } from "@/stores/chat-store";

interface MermaidBlockProps {
  source: string;
  /** When true, show source preview only — avoid half-parsed SVG flicker. */
  deferRender?: boolean;
  className?: string;
}

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.15;

let mermaidThemeVersion = 0;
const MERMAID_THEME_VERSION = 2;

const HIGH_CONTRAST_THEME = {
  startOnLoad: false,
  securityLevel: "strict" as const,
  theme: "base" as const,
  suppressErrorRendering: true,
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
  themeVariables: {
    darkMode: true,
    background: "#0f172a",
    primaryColor: "#6366f1",
    primaryTextColor: "#ffffff",
    primaryBorderColor: "#a5b4fc",
    secondaryColor: "#0ea5e9",
    secondaryTextColor: "#ffffff",
    tertiaryColor: "#f43f5e",
    tertiaryTextColor: "#ffffff",
    lineColor: "#cbd5e1",
    textColor: "#f8fafc",
    mainBkg: "#334155",
    nodeBorder: "#94a3b8",
    clusterBkg: "#1e293b",
    titleColor: "#f8fafc",
    edgeLabelBackground: "#1e293b",
    // Mindmap section palette — mid-bright fills + white labels
    cScale0: "#6366f1",
    cScale1: "#0ea5e9",
    cScale2: "#f43f5e",
    cScale3: "#10b981",
    cScale4: "#f59e0b",
    cScale5: "#8b5cf6",
    cScale6: "#14b8a6",
    cScale7: "#ec4899",
    cScale8: "#3b82f6",
    cScale9: "#84cc16",
    cScale10: "#e11d48",
    cScale11: "#06b6d4",
    cScaleLabel0: "#ffffff",
    cScaleLabel1: "#ffffff",
    cScaleLabel2: "#ffffff",
    cScaleLabel3: "#ffffff",
    cScaleLabel4: "#ffffff",
    cScaleLabel5: "#ffffff",
    cScaleLabel6: "#ffffff",
    cScaleLabel7: "#ffffff",
    cScaleLabel8: "#ffffff",
    cScaleLabel9: "#ffffff",
    cScaleLabel10: "#ffffff",
    cScaleLabel11: "#ffffff",
  },
  themeCSS: `
    .nodeLabel, .edgeLabel, .label {
      color: #f8fafc !important;
      fill: #f8fafc !important;
      font-weight: 600 !important;
    }
    text, tspan { fill: #f8fafc !important; }
    foreignObject div, foreignObject span, foreignObject p {
      color: #ffffff !important;
      background: transparent !important;
      font-weight: 600 !important;
    }
    .mindmap-node foreignObject div,
    .mindmap-node foreignObject span,
    .section foreignObject div {
      color: #ffffff !important;
    }
    .edgePath .path, .flowchart-link { stroke: #94a3b8 !important; stroke-width: 1.5px !important; }
  `,
};

async function getMermaid() {
  const mermaid = (await import("mermaid")).default;
  if (mermaidThemeVersion !== MERMAID_THEME_VERSION) {
    mermaid.initialize(HIGH_CONTRAST_THEME);
    mermaidThemeVersion = MERMAID_THEME_VERSION;
  }
  return mermaid;
}

function clampZoom(z: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
}

export default function MermaidBlock({
  source,
  deferRender = false,
  className,
}: MermaidBlockProps) {
  const reactId = useId().replace(/:/g, "");
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [usedRepair, setUsedRepair] = useState(false);
  const [activeSource, setActiveSource] = useState(source.trim());
  const [copied, setCopied] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [exporting, setExporting] = useState<"png" | "pdf" | "svg" | null>(null);
  const [exportMenu, setExportMenu] = useState(false);
  const [overrideSource, setOverrideSource] = useState<string | null>(null);
  const [fixNote, setFixNote] = useState<string>("");
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const isStreaming = useChatStore((s) => s.isStreaming);
  const sendQuickPrompt = useChatStore((s) => s.sendQuickPrompt);
  const retryLastMessage = useChatStore((s) => s.retryLastMessage);

  const trimmed = source.trim();
  const effectiveSource = (overrideSource ?? trimmed).trim();

  // Reset local override when the assistant message content changes
  useEffect(() => {
    setOverrideSource(null);
    setFixNote("");
  }, [trimmed]);

  useEffect(() => {
    if (deferRender || !effectiveSource) {
      setSvg("");
      setError("");
      setUsedRepair(false);
      setActiveSource(effectiveSource);
      setRendering(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setRendering(true);
      setError("");
      setUsedRepair(false);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      try {
        const mermaid = await getMermaid();
        const candidates = mermaidRenderCandidates(effectiveSource);
        let lastErr: unknown = null;

        for (let i = 0; i < candidates.length; i++) {
          const candidate = candidates[i];
          try {
            if (typeof mermaid.parse === "function") {
              await Promise.resolve(mermaid.parse(candidate));
            }
            const id = `mermaid-${reactId}-${Date.now()}-${i}`;
            const { svg: rendered } = await mermaid.render(id, candidate);
            if (!cancelled) {
              setSvg(enhanceMermaidSvgContrast(rendered));
              setError("");
              setActiveSource(candidate);
              setUsedRepair(i > 0 || !!overrideSource);
            }
            return;
          } catch (e) {
            lastErr = e;
          }
        }

        if (!cancelled) {
          setSvg("");
          setActiveSource(effectiveSource);
          setError(
            lastErr instanceof Error ? lastErr.message : "Failed to render diagram",
          );
        }
      } catch (e) {
        if (!cancelled) {
          setSvg("");
          setError(e instanceof Error ? e.message : "Failed to render diagram");
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [effectiveSource, deferRender, reactId, attempt, overrideSource]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(activeSource || effectiveSource);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  /** Prefer deterministic local salvage — do not depend on the LLM. */
  const handleAutoFix = () => {
    if (isStreaming) return;
    const salvage = salvageMermaidSource(trimmed);
    if (salvage && salvage.trim() && salvage.trim() !== effectiveSource) {
      setOverrideSource(salvage);
      setFixNote("Applied local auto-fix (no model rewrite).");
      setAttempt((n) => n + 1);
      return;
    }
    // Already salvaged / still broken → ask model with a tight prompt
    setFixNote("Local fix exhausted — asking the model to rewrite…");
    sendQuickPrompt(buildMermaidFixPrompt(trimmed, error || undefined));
  };

  const handleAskAiRewrite = () => {
    if (isStreaming) return;
    sendQuickPrompt(buildMermaidFixPrompt(trimmed, error || undefined));
  };

  const handleRetry = () => {
    if (isStreaming) return;
    retryLastMessage();
  };

  const getSvgEl = useCallback((): SVGSVGElement | null => {
    return containerRef.current?.querySelector("svg") ?? null;
  }, []);

  const runExport = async (kind: "png" | "pdf" | "svg") => {
    const el = getSvgEl();
    if (!el) return;
    setExportMenu(false);
    setExporting(kind);
    try {
      if (kind === "svg") await downloadDiagramSvg(el);
      else if (kind === "png") await downloadDiagramPng(el);
      else await downloadDiagramPdf(el);
    } catch (e) {
      console.error("Diagram export failed", e);
      window.alert(
        e instanceof Error ? e.message : "Could not export this diagram. Try SVG instead.",
      );
    } finally {
      setExporting(null);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom((z) => clampZoom(z + delta));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || zoom <= 1) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setPan({ x: dragRef.current.px + dx, y: dragRef.current.py + dy });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div
      className={cn(
        "my-3 mx-auto w-fit max-w-full overflow-hidden rounded-xl border border-indigo-500/25",
        "bg-gradient-to-br from-slate-950 via-indigo-950/40 to-slate-950",
        "shadow-lg shadow-indigo-950/40",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-500/20 bg-indigo-950/40 px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-indigo-200">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-500/20 ring-1 ring-indigo-400/30">
            <GitBranch className="h-3.5 w-3.5 text-indigo-300" />
          </span>
          Diagram
          {deferRender && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
              streaming…
            </span>
          )}
          {usedRepair && !error && (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
              auto-fixed
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {!deferRender && !error && svg && (
            <>
              <div className="mr-1 flex items-center gap-0.5 rounded-lg border border-white/10 bg-black/20 p-0.5">
                <button
                  type="button"
                  aria-label="Zoom out"
                  title="Zoom out (⌘/Ctrl + scroll)"
                  onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
                  className="rounded-md p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Reset zoom"
                  title="Reset zoom"
                  onClick={resetView}
                  className="min-w-[3rem] rounded-md px-1 py-1 text-[11px] tabular-nums text-slate-300 hover:bg-white/10 hover:text-white"
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  aria-label="Zoom in"
                  title="Zoom in (⌘/Ctrl + scroll)"
                  onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
                  className="rounded-md p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Fit diagram"
                  title="Fit"
                  onClick={resetView}
                  className="rounded-md p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="relative">
                <button
                  type="button"
                  aria-label="Export diagram"
                  aria-expanded={exportMenu}
                  disabled={!!exporting}
                  onClick={() => setExportMenu((o) => !o)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-300 transition hover:bg-white/5 hover:text-white disabled:opacity-50"
                >
                  {exporting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Download className="h-3 w-3" />
                  )}
                  Export
                </button>
                {exportMenu && (
                  <div
                    className="absolute right-0 z-20 mt-1 min-w-[9.5rem] overflow-hidden rounded-lg border border-indigo-500/30 bg-slate-950 py-1 shadow-xl"
                    role="menu"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-slate-200 hover:bg-indigo-500/20"
                      onClick={() => runExport("png")}
                    >
                      <ImageIcon className="h-3 w-3 text-indigo-300" />
                      PNG image
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-slate-200 hover:bg-indigo-500/20"
                      onClick={() => runExport("pdf")}
                    >
                      <FileText className="h-3 w-3 text-indigo-300" />
                      PDF
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-slate-200 hover:bg-indigo-500/20"
                      onClick={() => runExport("svg")}
                    >
                      <FileImage className="h-3 w-3 text-indigo-300" />
                      SVG
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div className="relative min-h-[72px] p-3">
        {deferRender ? (
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-400">
            {trimmed || "Waiting for diagram…"}
          </pre>
        ) : rendering && !svg ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-indigo-300/80">
            <Loader2 className="h-4 w-4 animate-spin" />
            Rendering diagram…
          </div>
        ) : error ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <p className="font-medium">Could not render this diagram</p>
                <p className="mt-0.5 text-amber-200/70">{error}</p>
                <p className="mt-1 text-[11px] text-amber-200/50">
                  Invalid Mermaid from the model. Prefer <strong>Fix diagram</strong> (local salvage) —
                  asking the model again often repeats the same mistake.
                </p>
                {fixNote && (
                  <p className="mt-1 text-[11px] text-indigo-200/80">{fixNote}</p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleAutoFix}
                disabled={isStreaming}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-600/80 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                <Wand2 className="h-3 w-3" />
                Fix diagram
              </button>
              <button
                type="button"
                onClick={handleAskAiRewrite}
                disabled={isStreaming}
                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-950/60 px-3 py-1.5 text-[11px] font-medium text-violet-100 hover:bg-violet-900/60 disabled:opacity-50"
              >
                Ask AI rewrite
              </button>
              <button
                type="button"
                onClick={handleRetry}
                disabled={isStreaming}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-600/50 bg-gray-800/80 px-3 py-1.5 text-[11px] font-medium text-gray-200 hover:bg-gray-700 disabled:opacity-50"
              >
                <RefreshCw className="h-3 w-3" />
                Retry reply
              </button>
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                disabled={isStreaming}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700/40 px-3 py-1.5 text-[11px] text-gray-400 hover:text-gray-200 disabled:opacity-50"
              >
                Re-check
              </button>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 font-mono text-[11px] text-slate-400">
              {effectiveSource}
            </pre>
          </div>
        ) : (
          <div
            ref={viewportRef}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className={cn(
              "relative max-h-[min(70vh,560px)] overflow-auto rounded-lg bg-slate-900/80 ring-1 ring-white/5",
              zoom > 1 && "cursor-grab active:cursor-grabbing",
            )}
            title="⌘/Ctrl + scroll to zoom · drag to pan when zoomed"
          >
            <div
              className="flex min-h-[120px] origin-center justify-center p-4 transition-transform duration-150 ease-out"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              }}
            >
              <div
                ref={containerRef}
                data-testid="mermaid-container"
                className="mermaid-svg flex w-full justify-center [&_svg]:mx-auto [&_svg]:max-w-none [&_svg]:h-auto [&_text]:fill-slate-50 [&_foreignObject_div]:!text-white [&_foreignObject_span]:!text-white"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
          </div>
        )}
      </div>

      {exportMenu && (
        <button
          type="button"
          aria-label="Close export menu"
          className="fixed inset-0 z-10 cursor-default"
          onClick={() => setExportMenu(false)}
        />
      )}
    </div>
  );
}
