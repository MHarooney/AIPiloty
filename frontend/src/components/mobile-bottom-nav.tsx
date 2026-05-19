"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, Rocket, Server, LayoutDashboard, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

const PRIMARY_TABS = [
  { href: "/", icon: MessageSquare, label: "Chat" },
  { href: "/deployments", icon: Rocket, label: "Deploy" },
  { href: "/vms", icon: Server, label: "VMs" },
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
] as const;

interface MobileBottomNavProps {
  onMoreOpen: () => void;
}

export default function MobileBottomNav({ onMoreOpen }: MobileBottomNavProps) {
  const pathname = usePathname();

  const isPrimaryTab = PRIMARY_TABS.some(
    (t) => pathname === t.href || (t.href !== "/" && pathname.startsWith(t.href))
  );

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex items-stretch bg-gray-950/95 backdrop-blur-xl border-t border-gray-800/60"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Mobile bottom navigation"
    >
      {PRIMARY_TABS.map(({ href, icon: Icon, label }) => {
        const active = pathname === href || (href !== "/" && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-semibold transition-colors relative",
              active ? "text-indigo-400" : "text-gray-600 hover:text-gray-400"
            )}
          >
            <Icon size={20} strokeWidth={active ? 2.5 : 2} />
            <span>{label}</span>
            {active && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-indigo-500" />
            )}
          </Link>
        );
      })}

      {/* More — opens sidebar drawer */}
      <button
        onClick={onMoreOpen}
        aria-label="More navigation options"
        className={cn(
          "flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-semibold transition-colors relative",
          !isPrimaryTab ? "text-indigo-400" : "text-gray-600 hover:text-gray-400"
        )}
      >
        <MoreHorizontal size={20} strokeWidth={!isPrimaryTab ? 2.5 : 2} />
        <span>More</span>
        {!isPrimaryTab && (
          <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-indigo-500" />
        )}
      </button>
    </nav>
  );
}
