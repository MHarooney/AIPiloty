"use client";

import { useEffect, useState } from "react";
import { BookMarked, MessageSquare, Eye, Database, Sparkles, FileStack } from "lucide-react";
import AppShell from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { useDocStudioStore } from "@/stores/doc-studio-store";
import { useI18n } from "@/i18n";
import DocStudioNotebookHeader from "@/components/doc-studio/doc-studio-notebook-header";
import DocStudioSourcesPanel from "@/components/doc-studio/doc-studio-sources-panel";
import DocStudioChatPanel from "@/components/doc-studio/doc-studio-chat-panel";
import DocStudioArtifactPreview from "@/components/doc-studio/doc-studio-artifact-preview";
import DocStudioStudioPanel from "@/components/doc-studio/doc-studio-studio-panel";

const PANEL_HEADER = "flex items-center gap-2 px-4 py-3 border-b border-gray-700/40 flex-shrink-0";

type MobilePanel = "sources" | "chat" | "preview" | "studio";

const MOBILE_TABS: { id: MobilePanel; label: string; icon: React.ElementType }[] = [
  { id: "sources", label: "Sources", icon: Database },
  { id: "chat",    label: "Chat",    icon: MessageSquare },
  { id: "preview", label: "Preview", icon: Eye },
  { id: "studio",  label: "Studio",  icon: Sparkles },
];

export default function DocStudioPage() {
  const { t } = useI18n();
  const { currentNotebookId, loadNotebooks, activeTab, setActiveTab } = useDocStudioStore();
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("chat");

  useEffect(() => { loadNotebooks(); }, []);

  return (
    <AppShell>
      <div className="flex flex-col h-full gap-0 overflow-hidden">
        {/* ── Hero bar ───────────────────────────────────────────── */}
        <div className="flex items-center gap-4 px-5 py-4 border-b border-gray-800/60 flex-shrink-0 bg-gray-950/60 backdrop-blur-sm">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25 flex-shrink-0">
            <BookMarked className="w-4.5 h-4.5 text-white" style={{ width: 18, height: 18 }} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-white leading-tight">{t("docStudio.title")}</h1>
            <p className="text-xs text-gray-500 mt-0.5">{t("docStudio.subtitle")}</p>
          </div>

          {/* Notebook picker */}
          <div className="w-64 flex-shrink-0">
            <DocStudioNotebookHeader />
          </div>
        </div>

        {/* ── Content ────────────────────────────────────────────── */}
        {!currentNotebookId ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center space-y-4 max-w-sm">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-600/20 to-purple-600/20 border border-indigo-500/20 flex items-center justify-center mx-auto">
                <FileStack className="w-7 h-7 text-indigo-400" />
              </div>
              <div>
                <p className="text-base font-semibold text-gray-200">{t("docStudio.noNotebooks")}</p>
                <p className="text-sm text-gray-500 mt-1">{t("docStudio.noNotebooksHint")}</p>
              </div>
            </div>
          </div>
        ) : (
        /* ── Mobile layout ──────────────────────────────────── */
          <>
            <div className="md:hidden flex flex-col flex-1 min-h-0">
              {/* Active panel content */}
              <div className="flex-1 overflow-hidden p-3">
                {mobilePanel === "sources"  && <DocStudioSourcesPanel />}
                {mobilePanel === "chat"     && <DocStudioChatPanel notebookId={currentNotebookId} />}
                {mobilePanel === "preview"  && <DocStudioArtifactPreview notebookId={currentNotebookId} />}
                {mobilePanel === "studio"   && <DocStudioStudioPanel notebookId={currentNotebookId} />}
              </div>

              {/* Mobile tab switcher */}
              <div className="flex border-t border-gray-800/60 bg-gray-950/80 flex-shrink-0">
                {MOBILE_TABS.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setMobilePanel(id)}
                    className={cn(
                      "flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-semibold transition-colors",
                      mobilePanel === id ? "text-indigo-400" : "text-gray-600 hover:text-gray-400"
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Desktop: 3-column layout ─────────────────────── */}
            <div className="hidden md:grid flex-1 grid-cols-[280px_1fr_280px] min-h-0 divide-x divide-gray-800/60">

              {/* ── Col 1: Sources ─────────────────────────────────── */}
              <div className="flex flex-col min-h-0 bg-gray-950/30">
                <div className={PANEL_HEADER}>
                  <div className="w-5 h-5 rounded-md bg-violet-500/20 flex items-center justify-center">
                    <Database className="w-3 h-3 text-violet-400" />
                  </div>
                  <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Sources</span>
                </div>
                <div className="flex-1 overflow-hidden p-4">
                  <DocStudioSourcesPanel />
                </div>
              </div>

              {/* ── Col 2: Chat + Preview ──────────────────────────── */}
              <div className="flex flex-col min-h-0">
                {/* Tab bar */}
                <div className={cn(PANEL_HEADER, "gap-0 p-0")}>
                  {[
                    { id: "chat",    label: "Chat",    icon: MessageSquare },
                    { id: "preview", label: "Preview", icon: Eye },
                  ].map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      onClick={() => setActiveTab(id as "chat" | "preview")}
                      className={cn(
                        "flex items-center gap-1.5 px-5 py-3 text-xs font-semibold border-b-2 transition-colors",
                        activeTab === id
                          ? "border-indigo-500 text-indigo-300 bg-indigo-500/5"
                          : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-800/30"
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex-1 overflow-hidden p-4">
                  {activeTab === "chat"
                    ? <DocStudioChatPanel notebookId={currentNotebookId} />
                    : <DocStudioArtifactPreview notebookId={currentNotebookId} />
                  }
                </div>
              </div>

              {/* ── Col 3: Studio ──────────────────────────────────── */}
              <div className="flex flex-col min-h-0 bg-gray-950/30">
                <div className={PANEL_HEADER}>
                  <div className="w-5 h-5 rounded-md bg-indigo-500/20 flex items-center justify-center">
                    <Sparkles className="w-3 h-3 text-indigo-400" />
                  </div>
                  <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Studio</span>
                </div>
                <div className="flex-1 overflow-hidden p-4">
                  <DocStudioStudioPanel notebookId={currentNotebookId} />
                </div>
              </div>

            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
