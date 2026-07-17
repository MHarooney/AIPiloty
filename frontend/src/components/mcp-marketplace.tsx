"use client";

/**
 * MCPMarketplace — curated MCP server browser with one-click install.
 *
 * Shows the catalogue returned by GET /api/v1/mcp/marketplace grouped by
 * category.  Each card has:
 *  • Install button (one-click for servers with no required env vars)
 *  • Env-var form for servers that need API keys
 *  • Installed badge for already-configured servers
 *  • Official badge for servers from the @modelcontextprotocol org
 *
 * Design mirrors VS Code Extensions view — familiar to any IDE user.
 */

import { useState, useEffect, useCallback } from "react";
import {
  X, Package, Check, Loader2, AlertCircle, ChevronDown,
  ChevronUp, Zap, Star, Shield, Globe, Database, Code,
  Terminal, MessageSquare, Brain, Search,
} from "lucide-react";
import { getMCPMarketplace, installFromMCPMarketplace, type MCPMarketplaceItem } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import type { LucideIcon } from "lucide-react";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Files: Code,
  Development: Code,
  Databases: Database,
  Search: Search,
  Browser: Globe,
  Communication: MessageSquare,
  AI: Brain,
  Network: Globe,
  DevOps: Terminal,
};

const CATEGORY_COLORS: Record<string, string> = {
  Files: "text-blue-400",
  Development: "text-violet-400",
  Databases: "text-green-400",
  Search: "text-amber-400",
  Browser: "text-cyan-400",
  Communication: "text-pink-400",
  AI: "text-purple-400",
  Network: "text-teal-400",
  DevOps: "text-orange-400",
};

interface Props {
  onClose: () => void;
  onInstalled?: () => void;  // called after any successful install
}

function EnvForm({
  item,
  onInstall,
  onCancel,
}: {
  item: MCPMarketplaceItem;
  onInstall: (values: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(item.requires_env.map(k => [k, ""]))
  );
  const complete = item.requires_env.every(k => values[k]?.trim());

  return (
    <div className="mt-3 p-3 rounded-lg bg-zinc-800/60 border border-zinc-700/50 space-y-2">
      <p className="text-[11px] text-zinc-400 font-medium">Required credentials:</p>
      {item.requires_env.map(key => (
        <div key={key}>
          <label className="text-[10px] text-zinc-500 font-mono">{key}</label>
          <input
            type={key.toLowerCase().includes("key") || key.toLowerCase().includes("token") || key.toLowerCase().includes("secret") || key.toLowerCase().includes("password") ? "password" : "text"}
            value={values[key] || ""}
            onChange={e => setValues(prev => ({ ...prev, [key]: e.target.value }))}
            placeholder={key}
            className="w-full mt-0.5 px-2 py-1 text-xs rounded bg-zinc-900 border border-zinc-700 text-zinc-200 outline-none focus:border-blue-500 font-mono"
          />
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onInstall(values)}
          disabled={!complete}
          className="text-xs px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Install
        </button>
        <button
          onClick={onCancel}
          className="text-xs px-3 py-1 rounded-lg border border-zinc-600 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function MarketplaceCard({
  item,
  onInstalled,
}: {
  item: MCPMarketplaceItem;
  onInstalled: () => void;
}) {
  const [installing, setInstalling] = useState(false);
  const [showEnvForm, setShowEnvForm] = useState(false);
  const Icon = CATEGORY_ICONS[item.category] ?? Package;
  const colorClass = CATEGORY_COLORS[item.category] ?? "text-zinc-400";

  const doInstall = async (envValues: Record<string, string> = {}) => {
    setInstalling(true);
    setShowEnvForm(false);
    try {
      await installFromMCPMarketplace(item.id, envValues);
      toast.success(`${item.name} installed successfully`);
      onInstalled();
    } catch (err: any) {
      toast.error(err.message || "Installation failed");
    } finally {
      setInstalling(false);
    }
  };

  const handleInstallClick = () => {
    if (item.requires_env.length > 0) {
      setShowEnvForm(true);
    } else {
      doInstall();
    }
  };

  return (
    <div className={cn(
      "border rounded-xl p-4 transition-all",
      item.installed
        ? "border-green-800/40 bg-green-950/20"
        : "border-zinc-800/60 bg-zinc-900/60 hover:border-zinc-700/60 hover:bg-zinc-900"
    )}>
      <div className="flex items-start gap-3">
        <div className={cn("p-2 rounded-lg bg-zinc-800/80 mt-0.5", colorClass)}>
          <Icon size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-zinc-200">{item.name}</span>
            {item.official && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-900/40 border border-blue-700/40 text-blue-400 font-medium flex items-center gap-0.5">
                <Shield size={8} /> official
              </span>
            )}
            {item.popular && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-900/30 border border-amber-700/30 text-amber-400 font-medium flex items-center gap-0.5">
                <Star size={8} /> popular
              </span>
            )}
            <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full border font-medium ml-auto", colorClass, "border-current bg-current/10")}>
              {item.category}
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{item.description}</p>

          {item.requires_env.length > 0 && !item.installed && (
            <p className="text-[10px] text-amber-500/80 mt-1 flex items-center gap-1">
              <AlertCircle size={10} />
              Requires: {item.requires_env.join(", ")}
            </p>
          )}

          {showEnvForm && (
            <EnvForm
              item={item}
              onInstall={doInstall}
              onCancel={() => setShowEnvForm(false)}
            />
          )}
        </div>
        <div className="flex-shrink-0">
          {item.installed ? (
            <span className="flex items-center gap-1 text-[11px] text-green-400 font-medium">
              <Check size={12} /> Installed
            </span>
          ) : installing ? (
            <Loader2 size={16} className="animate-spin text-zinc-400" />
          ) : !showEnvForm ? (
            <button
              onClick={handleInstallClick}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors font-medium flex items-center gap-1"
            >
              <Zap size={11} /> Install
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function MCPMarketplace({ onClose, onInstalled }: Props) {
  const [items, setItems] = useState<MCPMarketplaceItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getMCPMarketplace();
      setItems(data.items);
      setCategories(data.categories);
    } catch (err: any) {
      toast.error("Failed to load marketplace");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = items.filter(item => {
    const matchCat = !activeCategory || item.category === activeCategory;
    const matchSearch = !search || item.name.toLowerCase().includes(search.toLowerCase()) || item.description.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const handleInstalled = () => {
    load();
    onInstalled?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl bg-zinc-950 border border-zinc-800 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow">
              <Package size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-100">MCP Marketplace</h2>
              <p className="text-xs text-zinc-500">Extend the AI with tools — databases, search, GitHub, and more</p>
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 p-1 rounded-lg transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Search + category filter */}
        <div className="px-5 py-3 border-b border-zinc-800/50 flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-40">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              className="w-full pl-7 pr-3 py-1.5 text-xs rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 outline-none focus:border-blue-500"
              placeholder="Search MCP servers…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setActiveCategory("")}
              className={cn("text-[11px] px-2.5 py-1 rounded-full border transition-all",
                !activeCategory ? "bg-zinc-700 border-zinc-600 text-zinc-100" : "border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
              )}
            >All</button>
            {categories.map(cat => {
              const Icon = CATEGORY_ICONS[cat] ?? Package;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat === activeCategory ? "" : cat)}
                  className={cn("text-[11px] px-2.5 py-1 rounded-full border transition-all flex items-center gap-1",
                    activeCategory === cat ? "bg-zinc-700 border-zinc-600 text-zinc-100" : "border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
                  )}
                >
                  <Icon size={9} /> {cat}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-zinc-400">
              <Loader2 size={24} className="animate-spin mr-2" />
              Loading marketplace…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-zinc-500 text-sm">No results found</div>
          ) : (
            <>
              {/* Popular first */}
              {!activeCategory && !search && (
                <>
                  <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">⭐ Popular</p>
                  {filtered.filter(i => i.popular).map(item => (
                    <MarketplaceCard key={item.id} item={item} onInstalled={handleInstalled} />
                  ))}
                  {filtered.some(i => !i.popular) && (
                    <>
                      <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider pt-2">All Servers</p>
                      {filtered.filter(i => !i.popular).map(item => (
                        <MarketplaceCard key={item.id} item={item} onInstalled={handleInstalled} />
                      ))}
                    </>
                  )}
                </>
              )}
              {(activeCategory || search) && filtered.map(item => (
                <MarketplaceCard key={item.id} item={item} onInstalled={handleInstalled} />
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-between">
          <p className="text-[10px] text-zinc-600">
            {filtered.filter(i => i.installed).length} installed · {filtered.length} total
          </p>
          <p className="text-[10px] text-zinc-600">
            Source: Model Context Protocol · <span className="text-zinc-500">modelcontextprotocol.io</span>
          </p>
        </div>
      </div>
    </div>
  );
}
