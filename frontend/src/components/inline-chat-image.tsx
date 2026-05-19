"use client";

import { useState } from "react";
import { Download, Maximize2, X } from "lucide-react";
import type { ParsedFile } from "@/lib/parse-tool-result";
import { cn } from "@/lib/utils";

const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "aipiloty-dev-key";

export default function InlineChatImage({ file }: { file: ParsedFile }) {
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  // Build authenticated image URL
  const imgSrc = `${file.downloadUrl}`;

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

  if (error) return null;

  return (
    <>
      <div className="relative group rounded-xl overflow-hidden border border-gray-700/50 bg-gray-900/50 max-w-sm">
        {!loaded && (
          <div className="w-full h-48 bg-gray-800 animate-pulse rounded-xl" />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imgSrc}
          alt={file.fileName}
          className={cn(
            "w-full max-h-80 object-contain cursor-pointer transition-opacity",
            loaded ? "opacity-100" : "opacity-0 absolute"
          )}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          onClick={() => setExpanded(true)}
        />
        {loaded && (
          <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => setExpanded(true)}
              className="p-1.5 rounded-md bg-black/60 text-white hover:bg-black/80 transition-colors"
            >
              <Maximize2 size={14} />
            </button>
            <button
              onClick={handleDownload}
              className="p-1.5 rounded-md bg-black/60 text-white hover:bg-black/80 transition-colors"
            >
              <Download size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {expanded && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setExpanded(false)}
        >
          <button
            onClick={() => setExpanded(false)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <X size={20} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgSrc}
            alt={file.fileName}
            className="max-w-full max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
