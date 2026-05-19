"use client";

import { cn } from "@/lib/utils";

interface UserAvatarProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeMap = { sm: "w-7 h-7 text-xs", md: "w-9 h-9 text-sm", lg: "w-14 h-14 text-lg" };

export default function UserAvatar({ size = "md", className }: UserAvatarProps) {
  return (
    <div
      className={cn(
        "flex-shrink-0 rounded-xl flex items-center justify-center font-bold text-white",
        "bg-gradient-to-br from-cyan-500 to-blue-600",
        sizeMap[size],
        className
      )}
    >
      U
    </div>
  );
}
