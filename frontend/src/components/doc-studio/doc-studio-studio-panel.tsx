"use client";

import { useState, useEffect } from "react";
import {
  Wand2, Square, FileText, BarChart2, Code2, TestTube2,
  Rocket, Braces, Presentation, Sparkles, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CARD_GLASS, CARD_RADIUS } from "@/lib/design-tokens";
import { useDocStudioStore } from "@/stores/doc-studio-store";
import { useI18n } from "@/i18n";

// Map icon name strings (from backend) to actual Lucide components
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  FileText, BarChart2, Code2, TestTube2, Rocket, Braces, Presentation,
};

// Tailwind gradient classes keyed by the value returned from the backend
const GRADIENT_MAP: Record<string, string> = {
  "from-blue-600 to-indigo-700":    "from-blue-600 to-indigo-700",
  "from-emerald-600 to-teal-700":   "from-emerald-600 to-teal-700",
  "from-violet-600 to-purple-700":  "from-violet-600 to-purple-700",
  "from-amber-600 to-orange-700":   "from-amber-600 to-orange-700",
  "from-sky-600 to-blue-700":       "from-sky-600 to-blue-700",
  "from-rose-600 to-pink-700":      "from-rose-600 to-pink-700",
  "from-indigo-600 to-violet-700":  "from-indigo-600 to-violet-700",
  // fallbacks
  "from-blue-500 to-indigo-600":    "from-blue-500 to-indigo-600",
  "from-green-500 to-emerald-600":  "from-green-500 to-emerald-600",
};

const GLOW_MAP: Record<string, string> = {
  "from-blue-600 to-indigo-700":   "shadow-blue-500/20",
  "from-emerald-600 to-teal-700":  "shadow-emerald-500/20",
  "from-violet-600 to-purple-700": "shadow-violet-500/20",
  "from-amber-600 to-orange-700":  "shadow-amber-500/20",
  "from-sky-600 to-blue-700":      "shadow-sky-500/20",
  "from-rose-600 to-pink-700":     "shadow-rose-500/20",
  "from-indigo-600 to-violet-700": "shadow-indigo-500/20",
};

const PHASE_LABELS: Record<string, string> = {
  retrieving: "Retrieving context…",
  generating: "Generating document…",
  saving:     "Saving artifact…",
};

interface Props { notebookId: string }

export default function DocStudioStudioPanel({ notebookId }: Props) {
  const { t } = useI18n();
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [extraContext, setExtraContext] = useState("");
  const { templates, loadTemplates, runStudio, stopStream, isStreaming, streamPhase } = useDocStudioStore();

  useEffect(() => { if (templates.length === 0) loadTemplates(); }, []);

  const handleRun = () => {
    if (!selectedTemplate) return;
    runStudio(notebookId, selectedTemplate, extraContext);
  };

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Section label */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <Sparkles className="w-4 h-4 text-indigo-400" />
        <span className="text-sm font-semibold text-gray-200">{t("docStudio.templates")}</span>
        <span className="ml-auto text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
          {templates.length} templates
        </span>
      </div>

      {/* Template list */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
        {templates.map((tpl) => {
          const gradClass   = GRADIENT_MAP[tpl.gradient] ?? "from-indigo-600 to-purple-700";
          const glowClass   = GLOW_MAP[tpl.gradient]    ?? "shadow-indigo-500/20";
          const IconComp    = ICON_MAP[tpl.icon]         ?? FileText;
          const isSelected  = selectedTemplate === tpl.id;

          return (
            <button
              key={tpl.id}
              onClick={() => setSelectedTemplate(isSelected ? null : tpl.id)}
              className={cn(
                "w-full text-left rounded-xl p-3 transition-all duration-200 border group",
                isSelected
                  ? cn("border-indigo-500/50 bg-indigo-950/40 shadow-lg", glowClass)
                  : "border-gray-700/40 bg-gray-900/40 hover:border-gray-600/60 hover:bg-gray-800/40"
              )}
            >
              <div className="flex items-center gap-3">
                {/* Icon badge */}
                <div
                  className={cn(
                    "w-9 h-9 rounded-lg bg-gradient-to-br flex items-center justify-center flex-shrink-0 shadow-md",
                    gradClass
                  )}
                >
                  <IconComp className="w-4 h-4 text-white" />
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    "text-xs font-semibold truncate transition-colors",
                    isSelected ? "text-indigo-200" : "text-gray-200 group-hover:text-white"
                  )}>
                    {tpl.name}
                  </p>
                  <p className="text-[10px] text-gray-500 truncate leading-relaxed mt-0.5">
                    {tpl.description}
                  </p>
                </div>

                {/* Section count + chevron */}
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="text-[9px] text-gray-600 tabular-nums">
                    {tpl.sections?.length ?? 0}§
                  </span>
                  <ChevronRight className={cn(
                    "w-3 h-3 transition-all",
                    isSelected ? "text-indigo-400 translate-x-0.5" : "text-gray-600 opacity-0 group-hover:opacity-100"
                  )} />
                </div>
              </div>

              {/* Sections preview on select */}
              {isSelected && tpl.sections && tpl.sections.length > 0 && (
                <div className="mt-2.5 pt-2.5 border-t border-indigo-500/20 flex flex-wrap gap-1">
                  {tpl.sections.slice(0, 5).map((s, i) => (
                    <span key={i} className="text-[9px] bg-indigo-900/40 text-indigo-300 rounded-full px-2 py-0.5">
                      {s}
                    </span>
                  ))}
                  {tpl.sections.length > 5 && (
                    <span className="text-[9px] text-gray-500">+{tpl.sections.length - 5} more</span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Extra context + actions */}
      <div className="flex-shrink-0 space-y-3">
        <div className="relative">
          <textarea
            value={extraContext}
            onChange={(e) => setExtraContext(e.target.value)}
            placeholder={t("docStudio.extraContextPlaceholder")}
            rows={2}
            className="w-full resize-none rounded-xl bg-gray-800/60 border border-gray-700/50 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500/60 p-3 transition-colors"
          />
        </div>

        {/* Phase indicator */}
        {isStreaming && (
          <div className="flex items-center gap-2 px-1">
            <span className="flex gap-0.5">
              {[0,1,2].map(i => (
                <span key={i}
                  style={{ animationDelay: `${i * 150}ms` }}
                  className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce"
                />
              ))}
            </span>
            <span className="text-xs text-indigo-300">
              {PHASE_LABELS[streamPhase] ?? `${streamPhase}…`}
            </span>
          </div>
        )}

        {isStreaming ? (
          <button
            onClick={stopStream}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-300 text-sm font-medium transition-all"
          >
            <Square className="w-4 h-4" />
            Stop Generation
          </button>
        ) : (
          <button
            onClick={handleRun}
            disabled={!selectedTemplate}
            className={cn(
              "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all",
              selectedTemplate
                ? "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40"
                : "bg-gray-800/60 border border-gray-700/40 text-gray-600 cursor-not-allowed"
            )}
          >
            <Wand2 className="w-4 h-4" />
            {selectedTemplate ? t("docStudio.runTemplate") : "Select a template"}
          </button>
        )}
      </div>
    </div>
  );
}
