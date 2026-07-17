/**
 * Shared API headers helper — re-exports the headers function from api.ts
 * so components can import from a stable path without circular deps.
 */
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "aipiloty-dev-key";

export function headers(): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "X-API-Key": API_KEY,
  };
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("jwt_token");
    if (token) h["Authorization"] = `Bearer ${token}`;
  }
  return h;
}
