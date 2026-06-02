"use client";

import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-5">
        <AlertTriangle size={28} className="text-red-400" />
      </div>
      <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Something went wrong</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-sm">
        {error.message || "An unexpected error occurred. Your data is safe."}
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={reset}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors"
        >
          <RefreshCw size={15} />
          Try again
        </button>
        <Link
          href="/"
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <Home size={15} />
          Go home
        </Link>
      </div>
    </div>
  );
}
