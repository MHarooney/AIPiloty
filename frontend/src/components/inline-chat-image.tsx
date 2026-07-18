"use client";

import { useEffect, useState } from "react";
import { Download, Maximize2, X } from "lucide-react";
import type { ParsedFile } from "@/lib/parse-tool-result";

const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "aipiloty-dev-key";

/**
 * File downloads require X-API-Key. Plain <img src> cannot send that header,
 * so we fetch as a blob and render an object URL (inline preview like ChatGPT).
 */
export default function InlineChatImage({ file }: { file: ParsedFile }) {
  const [expanded, setExpanded] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;

    (async () => {
      try {
        const res = await fetch(file.downloadUrl, {
          headers: { "X-API-Key": API_KEY },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      } catch {
        if (!revoked) setError(true);
      }
    })();

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.downloadUrl]);

  const handleDownload = async () => {
    try {
      const res = await fetch(file.downloadUrl, {
        headers: { "X-API-Key": API_KEY },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* silent */
    }
  };

  if (error) {
    return (
      <p className="text-xs text-amber-400/90">
        Could not preview image (auth). Use Download below.
      </p>
    );
  }

  if (!blobUrl) {
    return <div className="w-full max-w-md h-48 bg-gray-800 animate-pulse rounded-xl" />;
  }

  return (
    <>
      <div className="relative group rounded-xl overflow-hidden border border-gray-700/50 bg-gray-900/50 max-w-md">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={blobUrl}
          alt={file.fileName}
          className="w-full max-h-96 object-contain cursor-pointer"
          onClick={() => setExpanded(true)}
        />
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="p-1.5 rounded-md bg-black/60 text-white hover:bg-black/80 transition-colors"
          >
            <Maximize2 size={14} />
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="p-1.5 rounded-md bg-black/60 text-white hover:bg-black/80 transition-colors"
          >
            <Download size={14} />
          </button>
        </div>
      </div>

      {expanded && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setExpanded(false)}
        >
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <X size={20} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={blobUrl}
            alt={file.fileName}
            className="max-w-full max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
