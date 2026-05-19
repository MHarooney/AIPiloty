"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, CheckCircle2, XCircle, Loader2, Trash2, X, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useActivityQueue, type TaskStatus } from "@/stores/activity-queue-store";
import { useI18n } from "@/i18n";

const STATUS_CONFIG: Record<TaskStatus, { icon: typeof Loader2; color: string; bgColor: string }> = {
  pending: { icon: Loader2, color: "text-gray-400", bgColor: "bg-gray-500/10" },
  running: { icon: Loader2, color: "text-indigo-400", bgColor: "bg-indigo-500/10" },
  completed: { icon: CheckCircle2, color: "text-emerald-400", bgColor: "bg-emerald-500/10" },
  failed: { icon: XCircle, color: "text-red-400", bgColor: "bg-red-500/10" },
};

export default function ActivityQueue() {
  const { tasks, removeTask, clearCompleted } = useActivityQueue();
  const [expanded, setExpanded] = useState(true);
  const { t } = useI18n();

  const activeTasks = tasks.filter((t) => t.status === "running" || t.status === "pending");
  const hasCompleted = tasks.some((t) => t.status === "completed" || t.status === "failed");

  if (tasks.length === 0) return null;

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      className="fixed bottom-4 right-4 z-40 w-80 rounded-xl border border-gray-200 dark:border-gray-800/60 bg-white dark:bg-gray-950/95 backdrop-blur-xl shadow-xl overflow-hidden"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100 dark:border-gray-800/40 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-indigo-400" />
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
            {t("activityQueue.title")}
          </span>
          {activeTasks.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-600/20 text-[10px] font-bold text-indigo-600 dark:text-indigo-300">
              {activeTasks.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {hasCompleted && (
            <button
              onClick={(e) => { e.stopPropagation(); clearCompleted(); }}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              aria-label={t("activityQueue.clearCompleted")}
            >
              <Trash2 size={12} />
            </button>
          )}
          {expanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronUp size={14} className="text-gray-400" />}
        </div>
      </div>

      {/* Tasks list */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="max-h-60 overflow-y-auto p-1.5 space-y-1">
              {tasks.map((task) => {
                const config = STATUS_CONFIG[task.status];
                const Icon = config.icon;
                return (
                  <div
                    key={task.id}
                    className={cn(
                      "flex items-center gap-2 px-2.5 py-2 rounded-lg transition-colors",
                      config.bgColor
                    )}
                  >
                    <Icon
                      size={14}
                      className={cn(config.color, task.status === "running" && "animate-spin")}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-gray-700 dark:text-gray-200 truncate">
                        {task.label}
                      </p>
                      {task.progress !== undefined && task.status === "running" && (
                        <div className="mt-1 h-1 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                      )}
                      {task.error && (
                        <p className="text-[10px] text-red-400 mt-0.5 truncate">{task.error}</p>
                      )}
                    </div>
                    <button
                      onClick={() => removeTask(task.id)}
                      className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors flex-shrink-0"
                      aria-label="Remove"
                    >
                      <X size={10} />
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
