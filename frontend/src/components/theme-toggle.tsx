"use client";

import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

const THEMES = [
  { key: "light", Icon: Sun, tKey: "settings.themeLight" },
  { key: "dark", Icon: Moon, tKey: "settings.themeDark" },
  { key: "system", Icon: Monitor, tKey: "settings.themeSystem" },
] as const;

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();

  return (
    <div className="flex gap-1.5 bg-gray-100 dark:bg-gray-900/50 p-1 rounded-lg border border-gray-200 dark:border-gray-800/40">
      {THEMES.map(({ key, Icon, tKey }) => (
        <button
          key={key}
          onClick={() => setTheme(key)}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors",
            theme === key
              ? "bg-white dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-300 shadow-sm dark:shadow-none border border-gray-200 dark:border-indigo-500/40"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/60"
          )}
          aria-label={t(tKey)}
        >
          <Icon size={12} />
          <span className="hidden sm:inline">{t(tKey)}</span>
        </button>
      ))}
    </div>
  );
}
