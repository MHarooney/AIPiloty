"use client";

import { useState } from "react";
import { Download, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import type { ParsedFile } from "@/lib/parse-tool-result";
import { cn } from "@/lib/utils";

const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "aipiloty-dev-key";

export default function DownloadButton({ file }: { file: ParsedFile }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  const handleDownload = async () => {
    setStatus("loading");
    try {
      const res = await fetch(file.downloadUrl, {
        headers: { "X-API-Key": API_KEY },
      });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus("done");
      setTimeout(() => setStatus("idle"), 3000);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  const Icon = status === "loading" ? Loader2 : status === "done" ? CheckCircle : status === "error" ? AlertCircle : Download;

  return (
    <button
      onClick={handleDownload}
      disabled={status === "loading"}
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
        "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30",
        "hover:bg-indigo-600/30 hover:border-indigo-500/50",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        status === "done" && "bg-emerald-600/20 text-emerald-300 border-emerald-500/30",
        status === "error" && "bg-red-600/20 text-red-300 border-red-500/30"
      )}
    >
      <Icon size={14} className={status === "loading" ? "animate-spin" : ""} />
      {status === "loading" ? "Downloading…" : status === "done" ? "Downloaded!" : status === "error" ? "Failed" : `Download ${file.fileName}`}
    </button>
  );
}
