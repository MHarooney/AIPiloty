"use client";

import { useState, useRef, useCallback } from "react";
import { X, Upload, Link2, FolderOpen, Loader2, FileUp, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDocStudioStore } from "@/stores/doc-studio-store";
import { useI18n } from "@/i18n";
import { toast } from "sonner";

type Tab = "file" | "url" | "project";

interface Props {
  notebookId: string;
  onClose: () => void;
}

export default function DocStudioSourceModal({ notebookId, onClose }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("file");
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [urlTitle, setUrlTitle] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const { uploadSource, addUrlSource, addProjectSource } = useDocStudioStore();

  // ---------- File upload ----------
  const doUpload = async (file: File) => {
    setLoading(true);
    try {
      await uploadSource(notebookId, file);
      toast.success(`Uploaded ${file.name}`);
      onClose();
    } catch {
      toast.error("Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) doUpload(file);
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) { setDroppedFile(file); }
  }, []);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  };

  // ---------- URL ----------
  const handleUrl = async () => {
    if (!url.trim()) return;
    setLoading(true);
    try {
      await addUrlSource(notebookId, url.trim(), urlTitle.trim() || undefined);
      toast.success("URL source added");
      onClose();
    } catch {
      toast.error("Failed to add URL");
    } finally {
      setLoading(false);
    }
  };

  // ---------- Project ----------
  const handleProject = async () => {
    if (!projectPath.trim()) return;
    setLoading(true);
    try {
      await addProjectSource(notebookId, projectPath.trim(), projectTitle.trim() || undefined);
      toast.success("Project source added");
      onClose();
    } catch {
      toast.error("Failed to add project");
    } finally {
      setLoading(false);
    }
  };

  const TABS: { id: Tab; label: string; Icon: React.ElementType; color: string }[] = [
    { id: "file",    label: t("docStudio.uploadFile"),  Icon: Upload,     color: "violet" },
    { id: "url",     label: t("docStudio.addUrl"),      Icon: Link2,      color: "sky"    },
    { id: "project", label: t("docStudio.addProject"),  Icon: FolderOpen, color: "amber"  },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md bg-gray-900 border border-gray-700/60 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
              <FileUp className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <h3 className="text-sm font-semibold text-gray-100">{t("docStudio.addSource")}</h3>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-gray-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-gray-800">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold transition-all border-b-2",
                tab === id
                  ? "border-indigo-500 text-indigo-300 bg-indigo-950/30"
                  : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-800/40"
              )}>
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-5">

          {/* ── File Tab ── */}
          {tab === "file" && (
            <div className="flex flex-col gap-4">
              {droppedFile ? (
                /* Dropped file preview */
                <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-900/20 border border-emerald-500/30">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-emerald-200 truncate">{droppedFile.name}</p>
                    <p className="text-xs text-emerald-500 mt-0.5">{(droppedFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button onClick={() => setDroppedFile(null)} className="text-emerald-600 hover:text-emerald-400">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                /* Drop zone */
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={() => setDragOver(false)}
                  onClick={() => fileRef.current?.click()}
                  className={cn(
                    "flex flex-col items-center justify-center gap-3 py-10 rounded-xl border-2 border-dashed cursor-pointer transition-all",
                    dragOver
                      ? "border-indigo-500 bg-indigo-500/10 scale-[1.01]"
                      : "border-gray-700 hover:border-indigo-500/50 hover:bg-gray-800/40"
                  )}
                >
                  <div className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center transition-colors",
                    dragOver ? "bg-indigo-500/20 border border-indigo-500/40" : "bg-gray-800 border border-gray-700"
                  )}>
                    <Upload className={cn("w-5 h-5", dragOver ? "text-indigo-400" : "text-gray-500")} />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-300">
                      Drop a file or <span className="text-indigo-400 underline underline-offset-2">browse</span>
                    </p>
                    <p className="text-xs text-gray-600 mt-1">PDF, TXT, DOCX, MD supported</p>
                  </div>
                </div>
              )}

              <input ref={fileRef} type="file" className="hidden" onChange={handleFileInput} />

              <button
                onClick={() => droppedFile ? doUpload(droppedFile) : fileRef.current?.click()}
                disabled={loading}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-sm font-semibold shadow-lg shadow-indigo-500/25 disabled:opacity-50 transition-all">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {droppedFile ? "Upload File" : "Select & Upload"}
              </button>
            </div>
          )}

          {/* ── URL Tab ── */}
          {tab === "url" && (
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">URL</label>
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-gray-800/60 border border-gray-700/60 focus-within:border-indigo-500/60 transition-colors">
                  <Link2 className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                  <input
                    type="url" value={url} onChange={(e) => setUrl(e.target.value)}
                    placeholder={t("docStudio.sourceUrlPlaceholder")}
                    className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-600 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">Title <span className="font-normal text-gray-600">(optional)</span></label>
                <input
                  type="text" value={urlTitle} onChange={(e) => setUrlTitle(e.target.value)}
                  placeholder={t("docStudio.sourceTitle")}
                  className="w-full px-3 py-2.5 rounded-xl bg-gray-800/60 border border-gray-700/60 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500/60 transition-colors"
                />
              </div>
              <button
                onClick={handleUrl} disabled={loading || !url.trim()}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-sm font-semibold shadow-lg shadow-sky-500/20 disabled:opacity-50 transition-all mt-1">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                {t("docStudio.addSource")}
              </button>
            </div>
          )}

          {/* ── Project Tab ── */}
          {tab === "project" && (
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">Project Path</label>
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-gray-800/60 border border-gray-700/60 focus-within:border-amber-500/60 transition-colors">
                  <FolderOpen className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                  <input
                    type="text" value={projectPath} onChange={(e) => setProjectPath(e.target.value)}
                    placeholder={t("docStudio.sourceProjectPath")}
                    className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-600 focus:outline-none font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">Title <span className="font-normal text-gray-600">(optional)</span></label>
                <input
                  type="text" value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)}
                  placeholder={t("docStudio.sourceTitle")}
                  className="w-full px-3 py-2.5 rounded-xl bg-gray-800/60 border border-gray-700/60 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-amber-500/60 transition-colors"
                />
              </div>
              <p className="text-xs text-gray-600">Provide an absolute path to a local code project directory. All supported files will be indexed.</p>
              <button
                onClick={handleProject} disabled={loading || !projectPath.trim()}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-sm font-semibold shadow-lg shadow-amber-500/20 disabled:opacity-50 transition-all mt-1">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4" />}
                {t("docStudio.addSource")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

