"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ConfidenceIndicatorProps {
  score: number;
  size?: number;
  className?: string;
}

/**
 * Animated circular confidence gauge with count-up animation
 * and color gradient: red (< 50%) → amber (50-80%) → green (> 80%).
 */
export default function ConfidenceIndicator({ score, size = 60, className }: ConfidenceIndicatorProps) {
  const [displayScore, setDisplayScore] = useState(0);
  const [animatedDash, setAnimatedDash] = useState(0);
  const animRef = useRef<number>(0);

  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const targetDash = (score / 100) * circumference;

  useEffect(() => {
    const startTime = performance.now();
    const duration = 1200;
    const startScore = 0;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease out cubic

      setDisplayScore(Math.round(startScore + (score - startScore) * eased));
      setAnimatedDash(targetDash * eased);

      if (progress < 1) {
        animRef.current = requestAnimationFrame(animate);
      }
    };

    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [score, targetDash]);

  const getColor = (value: number): string => {
    if (value < 50) return "#f87171";  // red-400
    if (value < 80) return "#fbbf24";  // amber-400
    return "#34d399";                   // emerald-400
  };

  const getGlowColor = (value: number): string => {
    if (value < 50) return "rgba(248,113,113,0.3)";
    if (value < 80) return "rgba(251,191,36,0.3)";
    return "rgba(52,211,153,0.3)";
  };

  const color = getColor(displayScore);
  const glowColor = getGlowColor(displayScore);

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="transform -rotate-90">
        {/* Background ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(55,65,81,0.4)"
          strokeWidth="3"
        />
        {/* Progress ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - animatedDash}
          style={{
            filter: `drop-shadow(0 0 6px ${glowColor})`,
            transition: "stroke 0.3s ease",
          }}
        />
      </svg>
      {/* Score text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold tabular-nums" style={{ color }}>{displayScore}%</span>
      </div>
    </div>
  );
}
