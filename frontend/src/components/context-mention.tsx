"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  FileCode,
  FolderOpen,
  BookOpen,
  Hash,
  Rocket,
  Server,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getMissions, getVMs, type Mission } from "@/lib/api";

export type MentionKind = "mission" | "vm" | "context";

export interface MentionSelection {
  kind: MentionKind;
  /** Stable id for chips / dedupe: mission:12 | vm:3 | ctx:workspace */
  id: string;
  /** Human label shown after @ and on chips */
  label: string;
  subtitle?: string;
  missionId?: number;
  vmId?: number;
  hostIp?: string;
  sshUsername?: string;
  /** Token inserted into the textarea for the model */
  insertText: string;
}

interface ContextItem {
  id: string;
  label: string;
  type: "file" | "folder" | "doc" | "symbol";
  path?: string;
}

const BUILT_IN_CONTEXTS: ContextItem[] = [
  { id: "workspace", label: "workspace", type: "folder", path: "Entire workspace" },
  { id: "currentFile", label: "currentFile", type: "file", path: "Currently open file" },
  { id: "selection", label: "selection", type: "symbol", path: "Selected text in editor" },
  { id: "knowledge", label: "knowledge", type: "doc", path: "RAG knowledge base" },
  { id: "git-diff", label: "git-diff", type: "symbol", path: "Current git changes" },
  { id: "terminal", label: "terminal", type: "symbol", path: "Recent terminal output" },
];

const TYPE_ICON = {
  file: FileCode,
  folder: FolderOpen,
  doc: BookOpen,
  symbol: Hash,
  mission: Rocket,
  vm: Server,
};

const TYPE_COLOR = {
  file: "text-blue-400",
  folder: "text-amber-400",
  doc: "text-emerald-400",
  symbol: "text-purple-400",
  mission: "text-cyan-400",
  vm: "text-emerald-400",
};

function slugLabel(raw: string): string {
  return (raw || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w.-]+/g, "")
    .slice(0, 48) || "item";
}

function missionToMention(m: Mission): MentionSelection {
  const label = m.name || m.project_name || `mission-${m.id}`;
  const bits = [
    m.environment,
    m.vm?.host_ip,
    m.public_url ? "has URL" : null,
    m.pipeline_profile,
  ].filter(Boolean);
  return {
    kind: "mission",
    id: `mission:${m.id}`,
    label,
    subtitle: bits.join(" · "),
    missionId: m.id,
    vmId: m.vm?.id ?? m.vm_credential_id ?? undefined,
    hostIp: m.vm?.host_ip || undefined,
    sshUsername: m.vm?.ssh_username || undefined,
    insertText: `@[mission:${m.id}:${slugLabel(label)}]`,
  };
}

function vmToMention(v: {
  id: number;
  name?: string;
  host_ip?: string;
  ssh_username?: string;
  provider?: string;
  is_active?: boolean;
}): MentionSelection {
  const label = v.name || v.host_ip || `vm-${v.id}`;
  return {
    kind: "vm",
    id: `vm:${v.id}`,
    label,
    subtitle: [v.host_ip, v.ssh_username, v.provider, v.is_active === false ? "inactive" : null]
      .filter(Boolean)
      .join(" · "),
    vmId: v.id,
    hostIp: v.host_ip,
    sshUsername: v.ssh_username,
    insertText: `@[vm:${v.id}:${slugLabel(label)}]`,
  };
}

function contextToMention(c: ContextItem): MentionSelection {
  return {
    kind: "context",
    id: `ctx:${c.id}`,
    label: c.label,
    subtitle: c.path,
    insertText: `@${c.label}`,
  };
}

interface ContextMentionProps {
  /** Text after `@` used for filtering */
  query?: string;
  onSelect: (item: MentionSelection) => void;
  onClose: () => void;
}

export default function ContextMention({
  query = "",
  onSelect,
  onClose,
}: ContextMentionProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [missions, setMissions] = useState<MentionSelection[]>([]);
  const [vms, setVms] = useState<MentionSelection[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [mRes, vRes] = await Promise.allSettled([getMissions(), getVMs()]);
        if (cancelled) return;
        if (mRes.status === "fulfilled") {
          setMissions((mRes.value.missions || []).map(missionToMention));
        }
        if (vRes.status === "fulfilled") {
          const list = Array.isArray(vRes.value) ? vRes.value : [];
          setVms(
            list
              .filter((v: { is_active?: boolean }) => v.is_active !== false)
              .map(vmToMention)
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    const match = (item: MentionSelection) => {
      if (!q) return true;
      const hay = `${item.label} ${item.subtitle || ""} ${item.hostIp || ""} ${item.insertText}`.toLowerCase();
      return hay.includes(q);
    };
    const missionHits = missions.filter(match);
    const vmHits = vms.filter(match);
    const ctxHits = BUILT_IN_CONTEXTS.map(contextToMention).filter(match);
    return [...missionHits, ...vmHits, ...ctxHits];
  }, [missions, vms, q]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [q, filtered.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const pick = useCallback(
    (item: MentionSelection) => {
      onSelect(item);
    },
    [onSelect]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (filtered[selectedIndex]) {
          e.preventDefault();
          e.stopPropagation();
          pick(filtered[selectedIndex]);
        }
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [filtered, selectedIndex, pick, onClose]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const sections: { title: string; kind: MentionKind; items: MentionSelection[] }[] = (
    [
      {
        title: "Missions",
        kind: "mission" as const,
        items: filtered.filter((i) => i.kind === "mission"),
      },
      {
        title: "VMs",
        kind: "vm" as const,
        items: filtered.filter((i) => i.kind === "vm"),
      },
      {
        title: "Context",
        kind: "context" as const,
        items: filtered.filter((i) => i.kind === "context"),
      },
    ] as { title: string; kind: MentionKind; items: MentionSelection[] }[]
  ).filter((s) => s.items.length > 0);

  let flatIndex = -1;

  return (
    <div
      ref={ref}
      className="w-80 rounded-xl border border-gray-200 dark:border-gray-800/60 bg-white dark:bg-gray-950 shadow-xl overflow-hidden"
      role="listbox"
      aria-label="Mention Missions, VMs, or context"
    >
      <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800/40 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
          @ Mention
        </p>
        {loading && <Loader2 size={12} className="animate-spin text-gray-500" />}
      </div>
      <div ref={listRef} className="max-h-64 overflow-y-auto py-1">
        {!loading && filtered.length === 0 ? (
          <p className="px-3 py-3 text-xs text-gray-400">
            No matches. Add Missions on Mission Board or VMs under VMs.
          </p>
        ) : (
          sections.map((section) => (
            <div key={section.title} className="mb-1">
              <p className="px-3 pt-1.5 pb-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                {section.title}
                <span className="ml-1 text-gray-600 font-normal normal-case">
                  ({section.items.length})
                </span>
              </p>
              {section.items.map((item) => {
                flatIndex += 1;
                const idx = flatIndex;
                const ctxType =
                  item.kind === "context"
                    ? BUILT_IN_CONTEXTS.find((c) => `ctx:${c.id}` === item.id)?.type || "symbol"
                    : null;
                const Icon =
                  item.kind === "mission"
                    ? TYPE_ICON.mission
                    : item.kind === "vm"
                      ? TYPE_ICON.vm
                      : TYPE_ICON[ctxType as keyof typeof TYPE_ICON] || Hash;
                const color =
                  item.kind === "mission"
                    ? TYPE_COLOR.mission
                    : item.kind === "vm"
                      ? TYPE_COLOR.vm
                      : TYPE_COLOR[(ctxType as keyof typeof TYPE_COLOR) || "symbol"];
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-idx={idx}
                    role="option"
                    aria-selected={idx === selectedIndex}
                    onClick={() => pick(item)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors",
                      idx === selectedIndex
                        ? "bg-indigo-50 dark:bg-indigo-600/10"
                        : "hover:bg-gray-50 dark:hover:bg-gray-900/50"
                    )}
                  >
                    <Icon size={14} className={color} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
                        @{item.label}
                      </p>
                      {item.subtitle && (
                        <p className="text-[10px] text-gray-400 dark:text-gray-600 truncate">
                          {item.subtitle}
                        </p>
                      )}
                    </div>
                    <span className="text-[9px] uppercase tracking-wide text-gray-500 shrink-0">
                      {item.kind}
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
      <div className="px-3 py-1.5 border-t border-gray-100 dark:border-gray-800/40 text-[10px] text-gray-500">
        ↑↓ navigate · Enter select · Esc close
      </div>
    </div>
  );
}
