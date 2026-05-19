"use client";

import { useState } from "react";
import { Plus, Trash2, CheckCircle2, AlertCircle, Loader2, FileText, Link2, FolderOpen, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { CARD_GLASS } from "@/lib/design-tokens";
import { useDocStudioStore } from "@/stores/doc-studio-store";
import { useI18n } from "@/i18n";
import DocStudioSourceModal from "./doc-studio-source-modal";

const STATUS_CONFIG = {
  ready:    { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Ready" },
  indexing: { icon: Loader2,      color: "text-blue-400",    bg: "bg-blue-500/10",    label: "Indexing", spin: true },
  error:    { icon: AlertCircle,  color: "text-red-400",     bg: "bg-red-500/10",     label: "Error" },
  pending:  { icon: Loader2,      color: "text-gray-500",    bg: "bg-gray-500/10",    label: "Pending" },
} as const;

const KIND_CONFIG = {
  url:     { icon: Link2,       color: "text-sky-400",    bg: "bg-sky-500/15",    label: "URL" },
  project: { icon: FolderOpen,  color: "text-amber-400",  bg: "bg-amber-500/15",  label: "Project" },
  file:    { icon: FileText,    color: "text-violet-400", bg: "bg-violet-500/15", label: "File" },
} as const;

export default function DocStudioSourcesPanel() {
  const { t } = useI18n();
  const [showModal, setShowModal] = useState(false);
  const { currentNotebookId, sources, isLoadingSources, toggleSource, deleteSource } = useDocStudioStore();

  if (!currentNotebookId) return null;

  const enabledCount = sources.filter(s => s.is_enabled && s.status === "ready").length;

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Section header */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <Database className="w-4 h-4 text-violet-400" />
        <span className="text-sm font-semibold text-gray-200">{t("docStudio.sources")}</span>
        {sources.length > 0 && (
          <span className="ml-auto text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
            {enabledCount}/{sources.length} active
          </span>
        )}
      </div>

      {/* Source list */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
        {isLoadingSources && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />
          </div>
        )}

        {!isLoadingSources && sources.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-gray-800/80 border border-gray-700/50 flex items-center justify-center">
              <Database className="w-6 h-6 text-gray-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-400">{t("docStudio.noSources")}</p>
              <p className="text-xs text-gray-600 mt-1">{t("docStudio.noSourcesHint")}</p>
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="mt-1 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/30 text-indigo-300 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add your first source
            </button>
          </div>
        )}

        {sources.map((src) => {
          const kind   = KIND_CONFIG[src.kind as keyof typeof KIND_CONFIG]   ?? KIND_CONFIG.file;
          const status = STATUS_CONFIG[src.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
          const KindIcon   = kind.icon;
          const StatusIcon = status.icon;

          return (
            <div
              key={src.id}
              className={cn(
                "group rounded-xl border transition-all duration-150 p-3",
                src.is_enabled
                  ? "border-gray-700/50 bg-gray-800/40 hover:border-gray-600/60"
                  : "border-gray-800/50 bg-gray-900/30 opacity-60"
              )}
            >
              <div className="flex items-start gap-3">
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={src.is_enabled}
                  onChange={(e) => toggleSource(currentNotebookId, src.id, e.target.checked)}
                  className="mt-0.5 accent-indigo-500 cursor-pointer flex-shrink-0"
                />

                {/* Kind icon */}
                <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5", kind.bg)}>
                  <KindIcon className={cn("w-3.5 h-3.5", kind.color)} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-200 truncate leading-relaxed">{src.title}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <div className={cn("flex items-center gap-1 rounded-full px-1.5 py-0.5", status.bg)}>
                      <StatusIcon className={cn("w-2.5 h-2.5", status.color, "spin" in status && status.spin && "animate-spin")} />
                      <span className={cn("text-[9px] font-medium", status.color)}>{status.label}</span>
                    </div>
                    <span className={cn("text-[9px] rounded-full px-1.5 py-0.5", kind.bg, kind.color)}>
                      {kind.label}
                    </span>
                  </div>
                </div>

                {/* Delete */}
                <button
                  onClick={() => deleteSource(currentNotebookId, src.id)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-900/40 text-gray-600 hover:text-red-400 transition-all flex-shrink-0"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add source button */}
      {sources.length > 0 && (
        <button
          onClick={() => setShowModal(true)}
          className="flex-shrink-0 flex items-center justify-center gap-2 py-2 rounded-xl border border-dashed border-gray-700/60 hover:border-indigo-500/50 hover:bg-indigo-900/10 text-gray-500 hover:text-indigo-400 text-xs font-medium transition-all"
        >
          <Plus className="w-3.5 h-3.5" /> {t("docStudio.addSource")}
        </button>
      )}

      {showModal && (
        <DocStudioSourceModal
          notebookId={currentNotebookId}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
