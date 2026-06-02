"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { login, storeToken } from "@/lib/api";
import { Bot, Lock, Loader2, Eye, EyeOff, AlertCircle } from "lucide-react";
import { useI18n } from "@/i18n";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { t } = useI18n();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!username.trim() || !password.trim()) {
      setError("Username and password are required");
      return;
    }
    setLoading(true);
    try {
      const { access_token } = await login(username, password);
      storeToken(access_token);
      router.replace("/");
    } catch (err: any) {
      setError(err.message?.includes("401") ? "Invalid username or password" : "Connection failed — is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center">
            <Bot size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-100">{t("app.name")}</h1>
          <p className="text-sm text-gray-500">{t("login.subtitle")}</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-gray-900/80 border border-gray-800/50 rounded-2xl p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/20 border border-red-800/30 text-red-400 text-sm">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-500 mb-1.5">{t("login.username")}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-indigo-500 transition-colors"
              placeholder="admin"
              autoFocus
              autoComplete="username"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1.5">{t("login.password")}</label>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 pr-10 text-sm text-gray-200 focus:outline-none focus:border-indigo-500 transition-colors"
                placeholder="••••••••"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                aria-label={showPw ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
            {loading ? "Signing in…" : t("login.signIn")}
          </button>
        </form>

      </div>
    </div>
  );
}
