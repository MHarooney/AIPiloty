"use client";

import { create } from "zustand";

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface BackgroundTask {
  id: string;
  label: string;
  status: TaskStatus;
  progress?: number; // 0-100
  error?: string;
  createdAt: number;
  completedAt?: number;
}

interface ActivityQueueStore {
  tasks: BackgroundTask[];
  addTask: (id: string, label: string) => void;
  updateTask: (id: string, updates: Partial<BackgroundTask>) => void;
  removeTask: (id: string) => void;
  clearCompleted: () => void;
}

export const useActivityQueue = create<ActivityQueueStore>((set) => ({
  tasks: [],
  addTask: (id, label) =>
    set((s) => ({
      tasks: [
        ...s.tasks,
        { id, label, status: "pending", createdAt: Date.now() },
      ],
    })),
  updateTask: (id, updates) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),
  removeTask: (id) =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
  clearCompleted: () =>
    set((s) => ({
      tasks: s.tasks.filter((t) => t.status !== "completed" && t.status !== "failed"),
    })),
}));
