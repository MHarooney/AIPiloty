import { create } from "zustand";
import {
  DSNotebook,
  DSSource,
  DSArtifact,
  DSTemplate,
  SSEEvent,
  listNotebooks,
  createNotebook,
  renameNotebook,
  deleteNotebook as apiDeleteNotebook,
  listSources,
  uploadSource as apiUploadSource,
  addUrlSource as apiAddUrlSource,
  addProjectSource as apiAddProjectSource,
  toggleSource as apiToggleSource,
  deleteSource as apiDeleteSource,
  listArtifacts,
  getArtifact,
  deleteArtifact as apiDeleteArtifact,
  listDSTemplates,
  streamNotebookChat,
  streamStudioRun,
} from "@/lib/api";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  citations?: string[];
};

type StreamPhase = "idle" | "retrieving" | "generating" | "saving";

interface DocStudioState {
  // data
  notebooks: DSNotebook[];
  currentNotebookId: string | null;
  sources: DSSource[];
  artifacts: DSArtifact[];
  templates: DSTemplate[];
  messages: ChatMessage[];
  currentArtifact: DSArtifact | null;

  // ui
  isLoadingNotebooks: boolean;
  isLoadingSources: boolean;
  isLoadingArtifacts: boolean;
  isStreaming: boolean;
  streamPhase: StreamPhase;
  streamBuffer: string;
  activeTab: "chat" | "preview";
  abortController: AbortController | null;

  // actions
  loadNotebooks: () => Promise<void>;
  setNotebook: (id: string | null) => void;
  createNotebook: (name: string, projectId?: string) => Promise<void>;
  renameNotebook: (id: string, name: string) => Promise<void>;
  deleteNotebook: (id: string) => Promise<void>;
  loadSources: (notebookId: string) => Promise<void>;
  uploadSource: (notebookId: string, file: File) => Promise<void>;
  addUrlSource: (notebookId: string, url: string, title?: string) => Promise<void>;
  addProjectSource: (notebookId: string, path: string, title?: string) => Promise<void>;
  toggleSource: (notebookId: string, sourceId: string, enabled: boolean) => Promise<void>;
  deleteSource: (notebookId: string, sourceId: string) => Promise<void>;
  loadArtifacts: (notebookId: string) => Promise<void>;
  loadArtifact: (notebookId: string, artifactId: string) => Promise<void>;
  deleteArtifact: (notebookId: string, artifactId: string) => Promise<void>;
  setCurrentArtifact: (a: DSArtifact | null) => void;
  loadTemplates: () => Promise<void>;
  sendChat: (notebookId: string, message: string, modelOverride?: string) => void;
  runStudio: (notebookId: string, templateId: string, extraContext: string, modelOverride?: string) => void;
  stopStream: () => void;
  setActiveTab: (tab: "chat" | "preview") => void;
}

export const useDocStudioStore = create<DocStudioState>((set, get) => ({
  notebooks: [],
  currentNotebookId: null,
  sources: [],
  artifacts: [],
  templates: [],
  messages: [],
  currentArtifact: null,
  isLoadingNotebooks: false,
  isLoadingSources: false,
  isLoadingArtifacts: false,
  isStreaming: false,
  streamPhase: "idle",
  streamBuffer: "",
  activeTab: "chat",
  abortController: null,

  loadNotebooks: async () => {
    set({ isLoadingNotebooks: true });
    try {
      const data = await listNotebooks();
      set({ notebooks: data.notebooks });
    } catch {
      // backend not reachable — silently reset
    } finally {
      set({ isLoadingNotebooks: false });
    }
  },

  setNotebook: (id) => {
    set({ currentNotebookId: id, sources: [], artifacts: [], messages: [], currentArtifact: null });
    if (id) {
      get().loadSources(id);
      get().loadArtifacts(id);
    }
  },

  createNotebook: async (name, projectId) => {
    const nb = await createNotebook(name, projectId);
    set((s) => ({ notebooks: [nb, ...s.notebooks], currentNotebookId: nb.id, sources: [], artifacts: [], messages: [] }));
  },

  renameNotebook: async (id, name) => {
    const updated = await renameNotebook(id, name);
    set((s) => ({
      notebooks: s.notebooks.map((nb) => (nb.id === id ? { ...nb, name: updated.name } : nb)),
    }));
  },

  deleteNotebook: async (id) => {
    await apiDeleteNotebook(id);
    set((s) => ({
      notebooks: s.notebooks.filter((nb) => nb.id !== id),
      currentNotebookId: s.currentNotebookId === id ? null : s.currentNotebookId,
      sources: s.currentNotebookId === id ? [] : s.sources,
      artifacts: s.currentNotebookId === id ? [] : s.artifacts,
    }));
  },

  loadSources: async (notebookId) => {
    set({ isLoadingSources: true });
    try {
      const data = await listSources(notebookId);
      set({ sources: data.sources });
    } catch {
      // ignore
    } finally {
      set({ isLoadingSources: false });
    }
  },

  uploadSource: async (notebookId, file) => {
    const source = await apiUploadSource(notebookId, file);
    set((s) => ({ sources: [...s.sources, source] }));
  },

  addUrlSource: async (notebookId, url, title) => {
    const source = await apiAddUrlSource(notebookId, url, title);
    set((s) => ({ sources: [...s.sources, source] }));
  },

  addProjectSource: async (notebookId, path, title) => {
    const source = await apiAddProjectSource(notebookId, path, title);
    set((s) => ({ sources: [...s.sources, source] }));
  },

  toggleSource: async (notebookId, sourceId, enabled) => {
    const updated = await apiToggleSource(notebookId, sourceId, enabled);
    set((s) => ({
      sources: s.sources.map((src) => (src.id === sourceId ? { ...src, is_enabled: updated.is_enabled } : src)),
    }));
  },

  deleteSource: async (notebookId, sourceId) => {
    await apiDeleteSource(notebookId, sourceId);
    set((s) => ({ sources: s.sources.filter((src) => src.id !== sourceId) }));
  },

  loadArtifacts: async (notebookId) => {
    set({ isLoadingArtifacts: true });
    try {
      const data = await listArtifacts(notebookId);
      set({ artifacts: data.artifacts });
    } catch {
      // ignore
    } finally {
      set({ isLoadingArtifacts: false });
    }
  },

  loadArtifact: async (notebookId, artifactId) => {
    const artifact = await getArtifact(notebookId, artifactId);
    set({ currentArtifact: artifact, activeTab: "preview" });
  },

  deleteArtifact: async (notebookId, artifactId) => {
    await apiDeleteArtifact(notebookId, artifactId);
    set((s) => ({
      artifacts: s.artifacts.filter((a) => a.id !== artifactId),
      currentArtifact: s.currentArtifact?.id === artifactId ? null : s.currentArtifact,
    }));
  },

  setCurrentArtifact: (a) => set({ currentArtifact: a, activeTab: a ? "preview" : "chat" }),

  loadTemplates: async () => {
    const data = await listDSTemplates();
    set({ templates: data.templates });
  },

  sendChat: (notebookId, message, modelOverride) => {
    const { isStreaming } = get();
    if (isStreaming) return;
    const abort = new AbortController();
    set((s) => ({
      messages: [...s.messages, { role: "user", content: message }],
      isStreaming: true,
      streamPhase: "retrieving",
      streamBuffer: "",
      abortController: abort,
    }));

    let assistantContent = "";
    let citations: string[] = [];

    const onEvent = (event: SSEEvent) => {
      if (event.type === "status") {
        set({ streamPhase: (event.data.phase as StreamPhase) || "generating" });
      } else if (event.type === "citations") {
        citations = event.data.sources || [];
      } else if (event.type === "token") {
        assistantContent += event.data.content || "";
        set({ streamBuffer: assistantContent });
      } else if (event.type === "done" || event.type === "error") {
        const msg: ChatMessage = {
          role: "assistant",
          content: event.type === "error" ? `Error: ${event.data.message}` : assistantContent,
          citations,
        };
        set((s) => ({
          messages: [...s.messages, msg],
          isStreaming: false,
          streamPhase: "idle",
          streamBuffer: "",
          abortController: null,
        }));
      }
    };

    streamNotebookChat(notebookId, message, onEvent, abort.signal, modelOverride);
  },

  runStudio: (notebookId, templateId, extraContext, modelOverride) => {
    const { isStreaming } = get();
    if (isStreaming) return;
    const abort = new AbortController();
    set({ isStreaming: true, streamPhase: "retrieving", streamBuffer: "", abortController: abort, activeTab: "chat" });

    let buffer = "";

    const onEvent = (event: SSEEvent) => {
      if (event.type === "status") {
        set({ streamPhase: (event.data.phase as StreamPhase) || "generating" });
      } else if (event.type === "token") {
        buffer += event.data.content || "";
        set({ streamBuffer: buffer });
      } else if (event.type === "done") {
        // Reload artifacts to show the new one
        const currentId = get().currentNotebookId;
        if (currentId) get().loadArtifacts(currentId);
        set({ isStreaming: false, streamPhase: "idle", streamBuffer: "", abortController: null, activeTab: "preview" });
      } else if (event.type === "error") {
        set({ isStreaming: false, streamPhase: "idle", streamBuffer: "", abortController: null });
      }
    };

    streamStudioRun(notebookId, templateId, extraContext, onEvent, abort.signal, modelOverride);
  },

  stopStream: () => {
    const { abortController } = get();
    if (abortController) abortController.abort();
    set({ isStreaming: false, streamPhase: "idle", streamBuffer: "", abortController: null });
  },

  setActiveTab: (tab) => set({ activeTab: tab }),
}));
