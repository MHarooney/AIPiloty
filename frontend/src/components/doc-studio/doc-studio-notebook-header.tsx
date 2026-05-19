"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Plus, Pencil, Trash2, Check, X, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDocStudioStore } from "@/stores/doc-studio-store";
import { useI18n } from "@/i18n";
import { toast } from "sonner";

export default function DocStudioNotebookHeader() {
  const { t } = useI18n();
  const [open, setOpen]       = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName]   = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { notebooks, currentNotebookId, setNotebook, createNotebook, renameNotebook, deleteNotebook } = useDocStudioStore();
  const current = notebooks.find((nb) => nb.id === currentNotebookId);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createNotebook(newName.trim());
    setNewName(""); setCreating(false); setOpen(false);
    toast.success("Notebook created");
  };

  const handleRename = async (id: string) => {
    if (!renameName.trim()) return;
    await renameNotebook(id, renameName.trim());
    setRenaming(null); setRenameName("");
    toast.success("Notebook renamed");
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("docStudio.confirmDelete"))) return;
    await deleteNotebook(id);
    toast.success("Notebook deleted");
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 w-full px-3 py-2 rounded-xl transition-all",
          "bg-gray-800/70 border border-gray-700/50 hover:border-indigo-500/40 hover:bg-gray-800",
          open && "border-indigo-500/50 bg-gray-800"
        )}
      >
        <BookOpen className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
        <span className="flex-1 text-sm font-medium text-gray-200 truncate text-left">
          {current?.name ?? <span className="text-gray-500 italic">No notebook</span>}
        </span>
        <ChevronDown className={cn("w-4 h-4 text-gray-500 transition-transform flex-shrink-0", open && "rotate-180")} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1.5 z-50 rounded-xl overflow-hidden shadow-2xl shadow-black/40 border border-gray-700/60 bg-gray-900">
          {notebooks.length === 0 && !creating && (
            <div className="px-4 py-3 text-xs text-gray-500 text-center">No notebooks yet</div>
          )}

          {notebooks.map((nb) => (
            <div key={nb.id} className={cn(
              "flex items-center gap-1.5 px-3 py-2.5 group transition-colors",
              nb.id === currentNotebookId ? "bg-indigo-900/20" : "hover:bg-gray-800/60"
            )}>
              {renaming === nb.id ? (
                <>
                  <input
                    autoFocus
                    value={renameName}
                    onChange={(e) => setRenameName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(nb.id);
                      if (e.key === "Escape") { setRenaming(null); setRenameName(""); }
                    }}
                    className="flex-1 text-sm bg-gray-800 text-gray-100 px-2 py-1 rounded-lg border border-indigo-500/60 focus:outline-none"
                  />
                  <button onClick={() => handleRename(nb.id)} className="p-1 text-emerald-400 hover:text-emerald-300 flex-shrink-0">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { setRenaming(null); setRenameName(""); }} className="p-1 text-gray-500 flex-shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors",
                    nb.id === currentNotebookId ? "bg-indigo-400" : "bg-gray-700 group-hover:bg-gray-600"
                  )} />
                  <button
                    className="flex-1 text-left text-sm truncate"
                    onClick={() => { setNotebook(nb.id); setOpen(false); }}
                  >
                    <span className={nb.id === currentNotebookId ? "text-indigo-200 font-semibold" : "text-gray-300"}>
                      {nb.name}
                    </span>
                  </button>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => { setRenaming(nb.id); setRenameName(nb.name); }}
                      className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-200">
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button onClick={() => handleDelete(nb.id)}
                      className="p-1 rounded hover:bg-red-900/40 text-gray-500 hover:text-red-400">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}

          {/* Create row */}
          <div className="border-t border-gray-800 px-3 py-2.5">
            {creating ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") { setCreating(false); setNewName(""); }
                  }}
                  placeholder={t("docStudio.notebookName")}
                  className="flex-1 text-sm bg-gray-800 text-gray-100 px-2 py-1 rounded-lg border border-indigo-500/60 focus:outline-none"
                />
                <button onClick={handleCreate} className="p-1 text-emerald-400 hover:text-emerald-300">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => { setCreating(false); setNewName(""); }} className="p-1 text-gray-500">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
              >
                <Plus className="w-3.5 h-3.5" /> {t("docStudio.newNotebook")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
