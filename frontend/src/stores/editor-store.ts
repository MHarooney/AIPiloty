import { create } from "zustand";

interface PendingCode {
  language: string;
  content: string;
}

interface DiffProposal {
  filePath: string;
  original: string;
  modified: string;
  language: string;
}

interface EditorStore {
  pendingCode: PendingCode | null;
  setPendingCode: (code: PendingCode) => void;
  consumePendingCode: () => PendingCode | null;
  diffProposal: DiffProposal | null;
  setDiffProposal: (proposal: DiffProposal) => void;
  clearDiffProposal: () => void;
  explainSelection: string | null;
  setExplainSelection: (text: string) => void;
  clearExplainSelection: () => void;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  pendingCode: null,
  setPendingCode: (code) => set({ pendingCode: code }),
  consumePendingCode: () => {
    const code = get().pendingCode;
    set({ pendingCode: null });
    return code;
  },
  diffProposal: null,
  setDiffProposal: (proposal) => set({ diffProposal: proposal }),
  clearDiffProposal: () => set({ diffProposal: null }),
  explainSelection: null,
  setExplainSelection: (text) => set({ explainSelection: text }),
  clearExplainSelection: () => set({ explainSelection: null }),
}));
