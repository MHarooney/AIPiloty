"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  MessageSquare, Server, Rocket, LayoutDashboard,
  Plus, Trash2, ChevronLeft, Sparkles,
  BookOpen, Database, Code, Settings, Image, LogOut, Activity,
  Clock, Globe, FileText, TestTube2, BookMarked, HardDrive,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getSessions, deleteSession, fetchSessionMessages, logout } from "@/lib/api";
import { useChatStore } from "@/stores/chat-store";
import { useTestingStore } from "@/stores/testing-store";
import { useI18n } from "@/i18n";
import AIAvatar from "./ai-avatar";

const NAV_GROUPS = [
  {
    label: "AI",
    items: [
      { href: "/", icon: MessageSquare, tKey: "nav.chat" },
      { href: "/testing", icon: TestTube2, tKey: "nav.testing" },
      { href: "/images", icon: Image, tKey: "nav.images" },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { href: "/deployments", icon: Rocket, tKey: "nav.deployments" },
      { href: "/vms", icon: Server, tKey: "nav.vms" },
    ],
  },
  {
    label: "Dev Tools",
    items: [
      { href: "/code-editor", icon: Code, tKey: "nav.codeEditor" },
      { href: "/database", icon: Database, tKey: "nav.database" },
      { href: "/knowledge", icon: BookOpen, tKey: "nav.knowledge" },
      { href: "/doc-studio", icon: BookMarked, tKey: "nav.docStudio" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/dashboard", icon: LayoutDashboard, tKey: "nav.dashboard" },
      { href: "/observability", icon: Activity, tKey: "nav.observability" },
      { href: "/scheduler", icon: Clock, tKey: "nav.scheduler" },
      { href: "/webhooks", icon: Globe, tKey: "nav.webhooks" },
      { href: "/runbooks", icon: FileText, tKey: "nav.runbooks" },
      { href: "/system-manager", icon: HardDrive, tKey: "nav.systemManager" },
    ],
  },
];



interface SidebarProps {
  onNavigate?: () => void;
  onOpenSettings?: () => void;
}

export default function Sidebar({ onNavigate, onOpenSettings }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const { sessionKey, clearChat, loadSession } = useChatStore();
  const systemState = useChatStore((s) => s.systemState);
  const avatarPhase = useChatStore((s) => s.avatarPhase);
  const loadTestingSession = useTestingStore((s) => s.loadSession);
  const { t } = useI18n();

  useEffect(() => {
    setSessionsLoading(true);
    getSessions()
      .then(setSessions)
      .catch(() => {
        toast.error("Could not load chat history");
      })
      .finally(() => setSessionsLoading(false));
  }, [sessionKey]);

  const handleDelete = async (key: string) => {
    await deleteSession(key);
    setSessions((prev) => prev.filter((s) => s.session_key !== key));
    if (sessionKey === key) clearChat();
  };

  const handleLoadSession = async (key: string) => {
    try {
      const data = await fetchSessionMessages(key);
      if (pathname.startsWith("/testing")) {
        // On the testing page: load into the testing store so the testing chat panel shows it
        loadTestingSession(data.session_key, data.messages);
      } else {
        loadSession(data.session_key, data.messages);
      }
    } catch {
      toast.error("Session may have been deleted");
    }
  };

  return (
    <aside
      role="navigation"
      aria-label="Main navigation"
      className={cn(
        "flex flex-col h-screen border-r transition-all duration-300",
        "bg-white/80 dark:bg-gray-900/60 backdrop-blur-xl",
        "border-gray-200/60 dark:border-gray-800/50",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-gray-200/60 dark:border-gray-800/50">
        {!collapsed && (
          <AIAvatar size="sm" phase={pathname === "/" ? avatarPhase : "idle"} />
        )}
        {!collapsed && (
          <h1 className="text-lg font-bold gradient-text tracking-tight">AIPiloty</h1>
        )}
        {/* System state indicator */}
        {!collapsed && systemState !== "idle" && (
          <div className={cn(
            "relative w-2.5 h-2.5 rounded-full",
            systemState === "thinking" && "bg-purple-400",
            systemState === "planning" && "bg-indigo-400",
            systemState === "executing" && "bg-emerald-400",
            systemState === "waiting_approval" && "bg-amber-400",
          )}>
            <span className={cn(
              "absolute inset-0 rounded-full animate-ping",
              systemState === "thinking" && "bg-purple-400",
              systemState === "planning" && "bg-indigo-400",
              systemState === "executing" && "bg-emerald-400",
              systemState === "waiting_approval" && "bg-amber-400",
            )} />
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className={cn(
            "p-1.5 rounded-lg transition-colors",
            "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200",
            "hover:bg-gray-100 dark:hover:bg-gray-800",
            "focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none",
            collapsed ? "mx-auto" : "ml-auto"
          )}
        >
          <ChevronLeft size={16} className={cn("transition-transform", collapsed && "rotate-180")} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto scrollbar-thin">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} className={cn(gi > 0 && "pt-2")}>
            {!collapsed && (
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-600">
                {group.label}
              </p>
            )}
            {group.items.map(({ href, icon: Icon, tKey }) => {
              const active = pathname === href || (href !== "/" && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200",
                    "focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none",
                    active
                      ? "bg-indigo-50 dark:bg-indigo-600/15 text-indigo-600 dark:text-indigo-300 shadow-sm dark:shadow-none"
                      : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/60 hover:text-gray-900 dark:hover:text-gray-200"
                  )}
                >
                  {active && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-indigo-500" />
                  )}
                  <Icon size={18} className={cn(active && "text-indigo-500 dark:text-indigo-400")} />
                  {!collapsed && <span>{t(tKey)}</span>}
                </Link>
              );
            })}
          </div>
        ))}

        {/* Divider */}
        <div className="!my-2 border-t border-gray-200/60 dark:border-gray-800/50" />

        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all w-full text-left",
            "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/60 hover:text-gray-900 dark:hover:text-gray-200"
          )}
        >
          <Settings size={18} />
          {!collapsed && <span>{t("nav.settings")}</span>}
        </button>

        {/* Logout button */}
        <button
          onClick={() => { logout(); router.replace("/login"); }}
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all w-full text-left",
            "text-gray-600 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400"
          )}
        >
          <LogOut size={18} />
          {!collapsed && <span>{t("nav.logout")}</span>}
        </button>

        {/* Sessions list */}
        {!collapsed && (
          <div className="mt-3 pt-3 border-t border-gray-200/60 dark:border-gray-800/50">
            <div className="flex items-center justify-between px-3 mb-2">
              <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                {t("nav.history")}
              </span>
              <button
                onClick={clearChat}
                className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
                aria-label="New chat"
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="space-y-0.5">
              {sessionsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg">
                    <div className="w-3 h-3 rounded bg-gray-200 dark:bg-gray-700/50 skeleton-shimmer" />
                    <div className="h-3 rounded bg-gray-200 dark:bg-gray-700/50 skeleton-shimmer flex-1" />
                  </div>
                ))
              ) : sessions.length === 0 ? (
                <p className="px-3 text-[10px] text-gray-400 dark:text-gray-600 italic">No conversations yet</p>
              ) : (
              sessions.map((s) => (
                <div
                  key={s.session_key}
                  className={cn(
                    "group flex items-stretch gap-0 rounded-lg text-xs transition-colors w-full overflow-hidden",
                    s.session_key === sessionKey
                      ? "bg-indigo-50/50 dark:bg-gray-800/80 text-gray-800 dark:text-gray-200"
                      : "text-gray-500 hover:bg-gray-100/60 dark:hover:bg-gray-800/40 hover:text-gray-700 dark:hover:text-gray-300"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleLoadSession(s.session_key)}
                    className="flex flex-1 min-w-0 items-center gap-2 px-3 py-1.5 text-left rounded-l-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                  >
                    <MessageSquare size={12} className="flex-shrink-0 opacity-50" />
                    <span className="truncate">{s.title || s.session_key.slice(0, 12)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(s.session_key)}
                    aria-label={`Delete session ${s.title || s.session_key.slice(0, 12)}`}
                    className="opacity-0 group-hover:opacity-100 shrink-0 px-2 py-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-all focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none rounded-r-lg"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )))}
            </div>
          </div>
        )}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="p-3 border-t border-gray-200/60 dark:border-gray-800/50 flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-600">
          <Sparkles size={10} className="text-indigo-400" />
          <span>AIPiloty v1.0 · Ollama</span>
        </div>
      )}
    </aside>
  );
}
