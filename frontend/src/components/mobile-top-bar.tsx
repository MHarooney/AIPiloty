"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";

const PAGE_TITLES: Record<string, string> = {
  "/": "Chat",
  "/testing": "AI Testing",
  "/images": "Images",
  "/deployments": "Deployments",
  "/vms": "VM Credentials",
  "/dashboard": "Dashboard",
  "/knowledge": "Knowledge Base",
  "/database": "Database",
  "/code-editor": "Code Editor",
  "/observability": "Observability",
  "/scheduler": "Scheduler",
  "/webhooks": "Webhooks",
  "/runbooks": "Runbooks",
  "/doc-studio": "Doc Studio",
};

interface MobileTopBarProps {
  onMenuOpen: () => void;
}

export default function MobileTopBar({ onMenuOpen }: MobileTopBarProps) {
  const pathname = usePathname();

  const title =
    Object.entries(PAGE_TITLES)
      .filter(([p]) => pathname === p || (p !== "/" && pathname.startsWith(p)))
      .sort((a, b) => b[0].length - a[0].length)[0]?.[1] ?? "AIPiloty";

  return (
    <header className="md:hidden flex items-center gap-3 h-12 px-4 flex-shrink-0 bg-gray-950/70 backdrop-blur-sm border-b border-gray-800/50">
      <button
        onClick={onMenuOpen}
        className="p-1.5 rounded-lg bg-gray-800/70 border border-gray-700/40 text-gray-400 hover:text-gray-200 transition-colors"
        aria-label="Open navigation menu"
      >
        <Menu size={18} />
      </button>

      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-extrabold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent tracking-tight flex-shrink-0">
          AIPiloty
        </span>
        <span className="text-gray-700 text-sm flex-shrink-0">·</span>
        <span className="text-sm font-medium text-gray-300 truncate">{title}</span>
      </div>
    </header>
  );
}
