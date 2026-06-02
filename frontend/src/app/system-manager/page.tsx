"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getDisk,
  getCaches,
  scanLargeFiles,
  scanDuplicates,
  cleanupPaths,
  getProcesses,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  HardDrive,
  Trash2,
  Files,
  Activity,
  RefreshCw,
  FolderSearch,
  ChevronRight,
  AlertTriangle,
  X,
  CheckSquare,
  Square,
} from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

// ── Disk Overview ──────────────────────────────────────────────────────────

type DiskData = Awaited<ReturnType<typeof getDisk>>;

function DiskCard() {
  const [data, setData] = useState<DiskData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDisk()
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const refresh = () => {
    setLoading(true);
    getDisk()
      .then(setData)
      .finally(() => setLoading(false));
  };

  const percent = data?.percent ?? 0;
  const radius = 52;
  const circ = 2 * Math.PI * radius;
  const dashOffset = circ * (1 - percent / 100);

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800/60 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          <HardDrive size={15} className="text-indigo-400" /> Disk Overview
        </h2>
        <button
          onClick={refresh}
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800/50 transition-colors"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {loading && !data && (
        <p className="text-[11px] text-gray-500 italic">Loading…</p>
      )}
      {data && (
        <div className="flex items-center gap-6">
          {/* Donut */}
          <svg width={128} height={128} viewBox="0 0 128 128" className="shrink-0">
            <circle
              cx={64}
              cy={64}
              r={radius}
              fill="none"
              stroke="#1f2937"
              strokeWidth={14}
            />
            <circle
              cx={64}
              cy={64}
              r={radius}
              fill="none"
              stroke={percent > 85 ? "#ef4444" : percent > 70 ? "#f59e0b" : "#6366f1"}
              strokeWidth={14}
              strokeDasharray={circ}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform="rotate(-90 64 64)"
            />
            <text x={64} y={62} textAnchor="middle" fill="#e5e7eb" fontSize={18} fontWeight={700}>
              {percent}%
            </text>
            <text x={64} y={78} textAnchor="middle" fill="#6b7280" fontSize={9}>
              used
            </text>
          </svg>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            {[
              { label: "Total", value: data.total_human },
              { label: "Used", value: data.used_human },
              { label: "Free", value: data.free_human },
              { label: "Home (~)", value: data.home_used_human },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[10px] text-gray-600 uppercase tracking-widest">{label}</p>
                <p className="text-sm font-semibold text-gray-200">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cache Cleaner ──────────────────────────────────────────────────────────

type CacheEntry = Awaited<ReturnType<typeof getCaches>>["caches"][number];

function ConfirmModal({ message, onConfirm, onCancel }: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700/60 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-gray-300">{message}</p>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700/50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors"
          >
            Move to Trash
          </button>
        </div>
      </div>
    </div>
  );
}

function CacheCard() {
  const [caches, setCaches] = useState<CacheEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cleaning, setCleaning] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{ deleted: number; freed_human: string; errors: string[] } | null>(null);
  const [scanned, setScanned] = useState(false);

  const scan = () => {
    setLoading(true);
    setResult(null);
    getCaches()
      .then((r) => {
        setCaches(r.caches);
        setScanned(true);
      })
      .finally(() => setLoading(false));
  };

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === caches.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(caches.map((c) => c.path)));
    }
  };

  const doClean = async () => {
    setConfirm(false);
    setCleaning(true);
    try {
      const res = await cleanupPaths(Array.from(selected));
      setResult(res);
      setSelected(new Set());
      scan(); // refresh sizes
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800/60 p-5">
      {confirm && (
        <ConfirmModal
          message={`Move ${selected.size} item(s) to Trash? This frees up cache space and is reversible from Trash.`}
          onConfirm={doClean}
          onCancel={() => setConfirm(false)}
        />
      )}
      <div className="flex items-center justify-between mb-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          <Trash2 size={15} className="text-amber-400" /> Cache Cleaner
        </h2>
        <button
          onClick={scan}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-gray-800 border border-gray-700/50 text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          <FolderSearch size={11} /> {loading ? "Scanning…" : scanned ? "Rescan" : "Scan Caches"}
        </button>
      </div>

      {result && (
        <div className="mb-3 text-xs text-emerald-400 bg-emerald-900/20 border border-emerald-800/30 rounded-lg px-3 py-2">
          Moved {result.deleted} item(s) to Trash · freed {result.freed_human}
          {result.errors.length > 0 && (
            <p className="text-red-400 mt-1">{result.errors.length} error(s): {result.errors[0]}</p>
          )}
        </div>
      )}

      {scanned && caches.length === 0 && (
        <p className="text-[11px] text-gray-500 italic">No cache directories found.</p>
      )}

      {caches.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-2">
            <button onClick={toggleAll} className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 transition-colors">
              {selected.size === caches.length ? <CheckSquare size={11} /> : <Square size={11} />}
              Select all
            </button>
            {selected.size > 0 && (
              <button
                onClick={() => setConfirm(true)}
                disabled={cleaning}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] rounded-lg bg-red-900/30 border border-red-800/30 text-red-400 hover:bg-red-900/50 transition-colors disabled:opacity-50"
              >
                <Trash2 size={10} /> Clean selected ({selected.size})
              </button>
            )}
          </div>

          <div className="space-y-1.5 max-h-60 overflow-y-auto scrollbar-thin pr-1">
            {caches.map((c) => (
              <label
                key={c.path}
                className={cn(
                  "flex items-center justify-between py-2 px-3 rounded-lg border cursor-pointer transition-colors",
                  selected.has(c.path)
                    ? "bg-red-900/15 border-red-800/30"
                    : "bg-gray-800/40 border-gray-800/30 hover:bg-gray-800/60"
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={selected.has(c.path)}
                    onChange={() => toggle(c.path)}
                    className="w-3 h-3 rounded"
                  />
                  <div className="min-w-0">
                    <p className="text-xs text-gray-300 font-medium truncate">{c.label}</p>
                    <p className="text-[10px] text-gray-600 truncate">{c.path}</p>
                  </div>
                </div>
                <span className="text-[11px] text-amber-400 shrink-0 ml-3">{c.size_human}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── File Scanner ───────────────────────────────────────────────────────────

type ScanMode = "large" | "duplicates";
type LargeFile = Awaited<ReturnType<typeof scanLargeFiles>>["files"][number];
type DupGroup = Awaited<ReturnType<typeof scanDuplicates>>["groups"][number];

function FileScannerCard() {
  const [mode, setMode] = useState<ScanMode>("large");
  const [scanPath, setScanPath] = useState("~");
  const [scanning, setScanning] = useState(false);
  const [largeFiles, setLargeFiles] = useState<LargeFile[]>([]);
  const [dupGroups, setDupGroups] = useState<DupGroup[]>([]);
  const [dupMeta, setDupMeta] = useState<{ total_wasted_human: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanResult, setCleanResult] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);

  const doScan = async () => {
    setScanning(true);
    setSelected(new Set());
    setCleanResult(null);
    try {
      if (mode === "large") {
        const r = await scanLargeFiles(scanPath);
        setLargeFiles(r.files);
      } else {
        const r = await scanDuplicates(scanPath);
        setDupGroups(r.groups);
        setDupMeta({ total_wasted_human: r.total_wasted_human });
      }
      setHasScanned(true);
    } finally {
      setScanning(false);
    }
  };

  const toggleFile = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  const doClean = async () => {
    setConfirm(false);
    setCleaning(true);
    try {
      const res = await cleanupPaths(Array.from(selected));
      setCleanResult(`Moved ${res.deleted} item(s) to Trash · freed ${res.freed_human}`);
      setSelected(new Set());
      doScan();
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800/60 p-5">
      {confirm && (
        <ConfirmModal
          message={`Move ${selected.size} file(s) to Trash?`}
          onConfirm={doClean}
          onCancel={() => setConfirm(false)}
        />
      )}

      <div className="flex items-center justify-between mb-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          <Files size={15} className="text-sky-400" /> File Scanner
        </h2>
        {/* Tabs */}
        <div className="flex gap-1 bg-gray-800/60 rounded-lg p-0.5">
          {(["large", "duplicates"] as ScanMode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setHasScanned(false); }}
              className={cn(
                "px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors capitalize",
                mode === m ? "bg-gray-700 text-gray-200" : "text-gray-500 hover:text-gray-300"
              )}
            >
              {m === "large" ? "Large Files" : "Duplicates"}
            </button>
          ))}
        </div>
      </div>

      {/* Path input + scan button */}
      <div className="flex gap-2 mb-4">
        <input
          value={scanPath}
          onChange={(e) => setScanPath(e.target.value)}
          placeholder="Path to scan (~ = home)"
          className="flex-1 text-[11px] bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-1.5 text-gray-300 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-sky-500/40"
        />
        <button
          onClick={doScan}
          disabled={scanning}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-sky-600/20 border border-sky-700/40 text-sky-300 hover:bg-sky-600/30 transition-colors disabled:opacity-50"
        >
          <FolderSearch size={11} /> {scanning ? "Scanning…" : "Scan"}
        </button>
      </div>

      {cleanResult && (
        <p className="text-xs text-emerald-400 bg-emerald-900/20 border border-emerald-800/30 rounded-lg px-3 py-2 mb-3">{cleanResult}</p>
      )}

      {selected.size > 0 && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-gray-500">{selected.size} selected</span>
          <button
            onClick={() => setConfirm(true)}
            disabled={cleaning}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] rounded-lg bg-red-900/30 border border-red-800/30 text-red-400 hover:bg-red-900/50 transition-colors disabled:opacity-50"
          >
            <Trash2 size={10} /> Delete selected
          </button>
        </div>
      )}

      {/* Large Files results */}
      {mode === "large" && hasScanned && (
        largeFiles.length === 0 ? (
          <p className="text-[11px] text-gray-500 italic">No files found above 50 MB.</p>
        ) : (
          <div className="space-y-1 max-h-72 overflow-y-auto scrollbar-thin pr-1">
            {largeFiles.map((f) => (
              <label
                key={f.path}
                className={cn(
                  "flex items-center justify-between py-1.5 px-3 rounded-lg border cursor-pointer transition-colors text-xs",
                  selected.has(f.path)
                    ? "bg-red-900/15 border-red-800/30"
                    : "bg-gray-800/40 border-gray-800/30 hover:bg-gray-800/60"
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <input type="checkbox" checked={selected.has(f.path)} onChange={() => toggleFile(f.path)} className="w-3 h-3" />
                  <span className="text-gray-300 truncate">{f.path.split("/").pop()}</span>
                </div>
                <span className="text-amber-400 shrink-0 ml-3">{f.size_human}</span>
              </label>
            ))}
          </div>
        )
      )}

      {/* Duplicates results */}
      {mode === "duplicates" && hasScanned && (
        dupGroups.length === 0 ? (
          <p className="text-[11px] text-gray-500 italic">No duplicates found.</p>
        ) : (
          <>
            {dupMeta && (
              <p className="text-[11px] text-sky-400 mb-2">
                Found {dupGroups.length} duplicate groups · wasted space: {dupMeta.total_wasted_human}
              </p>
            )}
            <div className="space-y-2 max-h-72 overflow-y-auto scrollbar-thin pr-1">
              {dupGroups.map((g) => (
                <div key={g.hash} className="bg-gray-800/40 border border-gray-800/30 rounded-lg p-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] text-gray-500">{g.count} copies · {g.size_each_human} each · wasted: <span className="text-amber-400">{g.wasted_human}</span></span>
                  </div>
                  <div className="space-y-1">
                    {g.files.map((f, i) => (
                      <label
                        key={f.path}
                        className={cn(
                          "flex items-center justify-between py-1 px-2 rounded border cursor-pointer text-[11px] transition-colors",
                          i === 0 && "border-emerald-800/30 bg-emerald-900/10",
                          i > 0 && (selected.has(f.path)
                            ? "border-red-800/30 bg-red-900/10"
                            : "border-gray-700/40 bg-gray-800/30 hover:bg-gray-800/60")
                        )}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          {i > 0 ? (
                            <input type="checkbox" checked={selected.has(f.path)} onChange={() => toggleFile(f.path)} className="w-3 h-3" />
                          ) : (
                            <span className="w-3 h-3 text-[9px] text-emerald-500 font-bold">✓</span>
                          )}
                          <span className={cn("truncate", i === 0 ? "text-emerald-300" : "text-gray-400")}>
                            {f.path.split("/").slice(-2).join("/")}
                          </span>
                        </div>
                        {i === 0 && <span className="text-[9px] text-emerald-600 shrink-0 ml-2">keep</span>}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )
      )}
    </div>
  );
}

// ── Processes ─────────────────────────────────────────────────────────────

type Process = Awaited<ReturnType<typeof getProcesses>>["processes"][number];

function ProcessCard() {
  const [procs, setProcs] = useState<Process[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetch = useCallback(() => {
    setLoading(true);
    getProcesses()
      .then((r) => setProcs(r.processes))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetch, 5000);
    return () => clearInterval(id);
  }, [autoRefresh, fetch]);

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800/60 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          <Activity size={15} className="text-emerald-400" /> Top Processes
        </h2>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="w-3 h-3"
            />
            Auto-refresh 5s
          </label>
          <button
            onClick={fetch}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800/50 transition-colors"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-gray-600 border-b border-gray-800/40">
              <th className="text-left pb-2 font-medium">Process</th>
              <th className="text-right pb-2 font-medium">CPU %</th>
              <th className="text-right pb-2 font-medium">MEM %</th>
              <th className="text-left pb-2 font-medium pl-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/30">
            {procs.map((p) => (
              <tr key={p.pid} className="hover:bg-gray-800/20 transition-colors">
                <td className="py-1.5 text-gray-300 font-medium max-w-[160px] truncate">
                  {p.name}
                  <span className="text-gray-700 ml-1">#{p.pid}</span>
                </td>
                <td className="py-1.5 text-right">
                  <span className={cn("tabular-nums", p.cpu_percent > 30 ? "text-amber-400" : "text-gray-400")}>
                    {p.cpu_percent.toFixed(1)}
                  </span>
                </td>
                <td className="py-1.5 text-right">
                  <span className={cn("tabular-nums", p.memory_percent > 5 ? "text-red-400" : "text-sky-400")}>
                    {p.memory_percent.toFixed(2)}
                  </span>
                </td>
                <td className="py-1.5 pl-4">
                  <span className={cn(
                    "px-1.5 py-0.5 rounded text-[9px] font-medium",
                    p.status === "running" ? "bg-emerald-900/30 text-emerald-400" :
                    p.status === "sleeping" ? "bg-gray-800 text-gray-500" :
                    "bg-amber-900/30 text-amber-400"
                  )}>
                    {p.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function SystemManagerPage() {
  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Page header */}
        <div className="flex items-center gap-3">
          <HardDrive size={20} className="text-indigo-400" />
          <div>
            <h1 className="text-lg font-bold text-gray-100">System Manager</h1>
            <p className="text-xs text-gray-500">Disk hygiene, cache cleanup, duplicate files, and process monitoring</p>
          </div>
        </div>

        {/* Top row: Disk + Cache side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <DiskCard />
          <CacheCard />
        </div>

        {/* File Scanner full width */}
        <FileScannerCard />

        {/* Processes full width */}
        <ProcessCard />
      </div>
    </div>
  );
}
