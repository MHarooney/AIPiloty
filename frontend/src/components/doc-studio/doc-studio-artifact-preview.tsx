"use client";

import { Download, Trash2, FileStack, FileText, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDocStudioStore } from "@/stores/doc-studio-store";
import { useI18n } from "@/i18n";
import { downloadArtifactUrl } from "@/lib/api";
import MarkdownRenderer from "@/components/markdown-renderer";

interface Props {
  notebookId: string;
}

export default function DocStudioArtifactPreview({ notebookId }: Props) {
  const { t } = useI18n();
  const {
    artifacts,
    currentArtifact,
    loadArtifact,
    deleteArtifact,
    isStreaming,
    streamBuffer,
    streamPhase,
  } = useDocStudioStore();

  // ---------- Streaming state ----------
  if (isStreaming) {
    return (
      <div className="flex flex-col h-full">
        {/* Phase banner */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-700/40 flex-shrink-0">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
          </span>
          <span className="text-xs font-medium text-indigo-300 capitalize tracking-wide">
            {streamPhase ?? "Generating"}…
          </span>
          {/* Bounce dots when no buffer yet */}
          {!streamBuffer && (
            <span className="flex items-center gap-1 ml-auto">
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ animationDelay: `${i * 200}ms` }}
                  className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" />
              ))}
            </span>
          )}
        </div>
        {/* Live preview */}
        <div className="flex-1 overflow-y-auto p-4 prose prose-invert prose-sm max-w-none">
          {streamBuffer
            ? <MarkdownRenderer content={streamBuffer} />
            : <p className="text-gray-600 text-sm italic">Waiting for content…</p>
          }
        </div>
      </div>
    );
  }

  // ---------- Empty state ----------
  if (artifacts.length === 0 || !currentArtifact) {
    if (artifacts.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
          <div className="w-14 h-14 rounded-2xl bg-gray-800/80 border border-gray-700/50 flex items-center justify-center">
            <FileStack className="w-6 h-6 text-gray-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-400">{t("docStudio.noArtifacts")}</p>
            <p className="text-xs text-gray-600 mt-1">Generate a document using the Studio panel</p>
          </div>
        </div>
      );
    }

    // Artifact list (no current selected)
    return (
      <div className="flex flex-col h-full overflow-y-auto gap-1 p-2">
        {artifacts.map((a) => (
          <button key={a.id} onClick={() => loadArtifact(notebookId, a.id)}
            className="flex items-center gap-3 p-3 rounded-xl border border-gray-700/50 bg-gray-800/40 hover:border-indigo-500/40 hover:bg-indigo-950/30 transition-all group text-left">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
              <FileText className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-200 truncate">{a.title}</p>
              <p className="text-xs text-gray-500 capitalize mt-0.5">{a.template.replace(/_/g, " ")}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-indigo-400 transition-colors flex-shrink-0" />
          </button>
        ))}
      </div>
    );
  }

  // ---------- Artifact view ----------
  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-700/40 flex-shrink-0">
        <div className="w-7 h-7 rounded-lg bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
          <FileText className="w-3.5 h-3.5 text-indigo-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-100 truncate leading-tight">{currentArtifact.title}</p>
          <p className="text-[10px] text-gray-500 capitalize">{currentArtifact.template.replace(/_/g, " ")}</p>
        </div>
        {/* Download buttons */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <a href={downloadArtifactUrl(notebookId, currentArtifact.id, "md")} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-gray-700/60 hover:bg-gray-700 border border-gray-600/40 text-gray-300 transition-colors">
            <Download className="w-2.5 h-2.5" /> MD
          </a>
          {currentArtifact.has_docx && (
            <a href={downloadArtifactUrl(notebookId, currentArtifact.id, "docx")} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-blue-700/30 hover:bg-blue-700/50 border border-blue-600/30 text-blue-300 transition-colors">
              <Download className="w-2.5 h-2.5" /> DOCX
            </a>
          )}
          <a href={downloadArtifactUrl(notebookId, currentArtifact.id, "pdf")} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-rose-700/30 hover:bg-rose-700/50 border border-rose-600/30 text-rose-300 transition-colors">
            <Download className="w-2.5 h-2.5" /> PDF
          </a>
          <button onClick={() => deleteArtifact(notebookId, currentArtifact.id)}
            className="p-1.5 rounded-lg hover:bg-red-900/40 text-gray-600 hover:text-red-400 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Artifact tab switcher (when multiple artifacts) */}
      {artifacts.length > 1 && (
        <div className="flex gap-1 overflow-x-auto px-3 py-2 border-b border-gray-800/60 flex-shrink-0">
          {artifacts.map((a) => (
            <button key={a.id} onClick={() => loadArtifact(notebookId, a.id)}
              className={cn(
                "flex-shrink-0 text-[10px] font-semibold px-2.5 py-1 rounded-full transition-colors capitalize",
                currentArtifact.id === a.id
                  ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/30"
                  : "bg-gray-800 text-gray-500 hover:text-gray-300"
              )}>
              {a.template.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      )}

      {/* Markdown content */}
      <div className="flex-1 overflow-y-auto p-4 prose prose-invert prose-sm max-w-none">
        <MarkdownRenderer content={currentArtifact.content_md || ""} />
      </div>
    </div>
  );
}
