"use client";

import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToolBadgeProps {
  name: string;
  status: "running" | "success" | "error";
}

export default function ToolBadge({ name, status }: ToolBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all animate-fade-in",
        status === "running" && "bg-amber-900/30 text-amber-300 border border-amber-700/40",
        status === "success" && "bg-emerald-900/30 text-emerald-300 border border-emerald-700/40",
        status === "error" && "bg-red-900/30 text-red-300 border border-red-700/40"
      )}
    >
      {status === "running" && <Loader2 size={12} className="animate-spin" />}
      {status === "success" && <CheckCircle size={12} />}
      {status === "error" && <AlertCircle size={12} />}
      {name.replace(/_/g, " ")}
    </span>
  );
}
