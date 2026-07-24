"use client";

import { useState, useRef, useCallback, useEffect, DragEvent } from "react";
import { Send, Square, Shield, Paperclip, X, FileText, Image as ImageIcon, Mic, MicOff, FileCode, Folder } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { streamChat, uploadAttachment, getWorkspaceFile } from "@/lib/api";
import { useChatStore } from "@/stores/chat-store";
import { useEditorStore } from "@/stores/editor-store";
import { useMissionStore } from "@/stores/mission-store";
import ChatModeToggle from "./chat-mode-toggle";
import ChatModelPicker from "./chat-model-picker";
import ContextMention, { type MentionSelection } from "./context-mention";

const ACCEPTED_TYPES = "image/png,image/jpeg,image/gif,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation";

interface WorkspaceFile {
  path: string;
  name: string;
  type: "file" | "directory";
  content?: string;
  language?: string;
  loading?: boolean;
}

interface ScopeChip {
  id: string;
  kind: "mission" | "vm";
  label: string;
  missionId?: number;
  vmId?: number;
  hostIp?: string;
  sshUsername?: string;
}

function buildScopePrefix(chips: ScopeChip[]): string {
  if (!chips.length) return "";
  const lines: string[] = ["[FLIGHT DECK SCOPE — user @mentioned]"];
  for (const c of chips) {
    if (c.kind === "mission" && c.missionId != null) {
      lines.push(
        `- Active Mission id=${c.missionId} (“${c.label}”)` +
          (c.hostIp ? ` on VM ${c.hostIp}` : "") +
          ". Prefer this Mission for tools / ensure_missions / probe."
      );
    } else if (c.kind === "vm" && c.vmId != null) {
      lines.push(
        `- Target VM id=${c.vmId}` +
          (c.hostIp ? ` host=${c.hostIp}` : "") +
          (c.sshUsername ? ` user=${c.sshUsername}` : "") +
          ` (“${c.label}”). Prefer this VM for ssh / vm_health_check / ensure_missions host=.`
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

export default function ChatInput() {
  const [input, setInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [showMention, setShowMention] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [scopeChips, setScopeChips] = useState<ScopeChip[]>([]);
  const recognitionRef = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isStreaming, addUserMessage, handleSSEEvent, selectedModel } = useChatStore();
  const pendingAttachments = useChatStore((s) => s.pendingAttachments);
  const addPendingAttachment = useChatStore((s) => s.addPendingAttachment);
  const removePendingAttachment = useChatStore((s) => s.removePendingAttachment);
  const systemState = useChatStore((s) => s.systemState);
  const intensityLevel = useChatStore((s) => s.intensityLevel);
  const chatMode = useChatStore((s) => s.chatMode);
  const isWaitingApproval = systemState === "waiting_approval";
  const setActiveMission = useMissionStore((s) => s.setActiveMission);
  const selectMissionById = useMissionStore((s) => s.selectMissionById);
  const loadMissions = useMissionStore((s) => s.loadMissions);
  const missions = useMissionStore((s) => s.missions);

  // Prefetch missions for mention + Flight Deck
  useEffect(() => {
    if (!missions.length) {
      void loadMissions();
    }
  }, [missions.length, loadMissions]);

  // Consume explain-selection from code editor
  useEffect(() => {
    const text = useEditorStore.getState().explainSelection;
    if (text) {
      const prompt = text.startsWith("Please refactor")
        ? text
        : `Explain this code:\n\`\`\`\n${text}\n\`\`\``;
      setInput(prompt);
      useEditorStore.getState().clearExplainSelection();
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, []);

  const handleFileUpload = useCallback(async (files: FileList | File[]) => {
    setIsUploading(true);
    try {
      for (const file of Array.from(files)) {
        try {
          const meta = await uploadAttachment(file);
          const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
          addPendingAttachment({
            id: meta.id,
            filename: meta.filename,
            mime_type: meta.mime_type,
            category: meta.category,
            previewUrl,
          });
        } catch (err: any) {
          toast.error(`Failed to upload ${file.name}: ${err.message}`);
        }
      }
    } finally {
      setIsUploading(false);
    }
  }, [addPendingAttachment]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (
      (!text && pendingAttachments.length === 0 && workspaceFiles.length === 0 && scopeChips.length === 0) ||
      isStreaming
    ) {
      return;
    }

    // Build workspace context prefix (injected silently into the message)
    let contextPrefix = "";
    for (const wf of workspaceFiles) {
      if (wf.type === "file" && wf.content !== undefined) {
        contextPrefix += `File \`${wf.path}\` (${wf.language ?? "text"}):\n\`\`\`${wf.language ?? "text"}\n${wf.content.slice(0, 8000)}${wf.content.length > 8000 ? "\n… (truncated)" : ""}\n\`\`\`\n\n`;
      } else if (wf.type === "directory") {
        contextPrefix += `Folder \`${wf.path}\` has been attached for reference.\n\n`;
      }
    }

    const scopePrefix = buildScopePrefix(scopeChips);
    const fullMessage =
      scopePrefix +
      contextPrefix +
      (text || (scopeChips.length ? "Work on the @mentioned Mission/VM." : "Please analyze the attached file(s)."));
    const attachments = pendingAttachments.length > 0 ? [...pendingAttachments] : undefined;
    const attachmentIds = attachments?.map((a) => a.id);

    const scopeNote = scopeChips.length
      ? `*(scoped: ${scopeChips.map((c) => `@${c.label}`).join(", ")})*\n`
      : "";
    const displayContent = workspaceFiles.length > 0
      ? `${scopeNote}*(with ${workspaceFiles.map(f => f.name).join(", ")})*\n${text || "Please analyze."}`
      : scopeNote
        ? `${scopeNote}${text || "Work on the @mentioned Mission/VM."}`
        : (text || "(attached files)");

    addUserMessage(displayContent, attachments);
    setInput("");
    setWorkspaceFiles([]);
    setScopeChips([]);
    setShowMention(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    // Flight Deck: detect incident patterns + scope chat to mentioned / active Mission
    useMissionStore.getState().detectIncidentFromText(fullMessage);
    const mentionedMission = scopeChips.find((c) => c.kind === "mission" && c.missionId != null);
    if (mentionedMission?.missionId != null) {
      selectMissionById(mentionedMission.missionId);
    }
    const missionId =
      mentionedMission?.missionId ??
      useMissionStore.getState().activeMission?.id ??
      null;

    const abort = new AbortController();
    abortRef.current = abort;
    const key = useChatStore.getState().ensureSessionKey();
    const modelPayload = selectedModel === "auto" ? null : selectedModel;
    streamChat(
      fullMessage,
      key,
      handleSSEEvent,
      abort.signal,
      false,
      modelPayload,
      attachmentIds,
      chatMode,
      missionId
    );
  }, [
    input,
    isStreaming,
    addUserMessage,
    handleSSEEvent,
    selectedModel,
    pendingAttachments,
    workspaceFiles,
    chatMode,
    scopeChips,
    selectMissionById,
  ]);

  const handleStop = () => {
    abortRef.current?.abort();
    useChatStore.getState().finalizeAssistantMessage();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Mention picker owns Enter / arrows while open
    if (showMention && (e.key === "Enter" || e.key === "Tab" || e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Escape")) {
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    // Workspace node drop (dragged from the code editor file tree)
    const nodeType = e.dataTransfer.getData("application/x-aipiloty-node-type") as "file" | "directory" | "";
    if (nodeType) {
      const path = e.dataTransfer.getData("text/plain");
      const name = e.dataTransfer.getData("application/x-aipiloty-node-name") || path.split("/").pop() || path;
      if (!path) return;
      if (workspaceFiles.find(f => f.path === path)) return; // avoid duplicates

      if (nodeType === "directory") {
        setWorkspaceFiles(prev => [...prev, { path, name, type: "directory" }]);
        return;
      }

      // File — fetch content from workspace API
      setWorkspaceFiles(prev => [...prev, { path, name, type: "file", loading: true }]);
      getWorkspaceFile(path).then(data => {
        setWorkspaceFiles(prev =>
          prev.map(f => f.path === path
            ? { ...f, content: data.content, language: data.language, loading: false }
            : f
          )
        );
      }).catch(() => {
        setWorkspaceFiles(prev => prev.filter(f => f.path !== path));
        toast.error(`Could not load ${name}`);
      });
      return;
    }

    // OS file drop (from system file manager)
    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  // Voice recognition (Web Speech API)
  const toggleVoice = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Voice input not supported in this browser");
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = document.documentElement.lang || "en-US";
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((r: any) => r[0].transcript)
        .join("");
      setInput((prev) => prev + transcript);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening]);

  // Cleanup: stop recognition when component unmounts
  useEffect(() => {
    return () => {
      const rec = recognitionRef.current;
      if (rec) {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        try { rec.stop(); } catch { /* already stopped */ }
        recognitionRef.current = null;
      }
    };
  }, []);

  // @-mention trigger in textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
    const val = el.value;
    setInput(val);
    const cursorPos = el.selectionStart;
    const textBefore = val.slice(0, cursorPos);
    // Allow query after @ until whitespace (missions/VMs filter as you type)
    const atMatch = textBefore.match(/@([^\s@]*)$/);
    if (atMatch) {
      setShowMention(true);
      setMentionQuery(atMatch[1] || "");
    } else {
      setShowMention(false);
      setMentionQuery("");
    }
  };

  const handleMentionSelect = (item: MentionSelection) => {
    const cursorPos = textareaRef.current?.selectionStart || input.length;
    const textBefore = input.slice(0, cursorPos);
    const textAfter = input.slice(cursorPos);
    const replaced = textBefore.replace(/@[^\s@]*$/, `${item.insertText} `);
    setInput(replaced + textAfter);
    setShowMention(false);
    setMentionQuery("");

    if (item.kind === "mission" || item.kind === "vm") {
      const kind = item.kind;
      setScopeChips((prev) => {
        const withoutDup = prev.filter((c) => c.id !== item.id);
        // One mission chip at a time (Flight Deck single scope)
        const cleared =
          kind === "mission"
            ? withoutDup.filter((c) => c.kind !== "mission")
            : withoutDup;
        const next: ScopeChip = {
          id: item.id,
          kind,
          label: item.label,
          missionId: item.missionId,
          vmId: item.vmId,
          hostIp: item.hostIp,
          sshUsername: item.sshUsername,
        };
        return [...cleared, next];
      });
      if (kind === "mission" && item.missionId != null) {
        const m = useMissionStore.getState().missions.find((x) => x.id === item.missionId);
        if (m) setActiveMission(m);
        else selectMissionById(item.missionId);
      }
    }

    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const pos = replaced.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const canSend =
    !!input.trim() ||
    pendingAttachments.length > 0 ||
    workspaceFiles.length > 0 ||
    scopeChips.length > 0;

  return (
    <div
      className={cn(
        "border-t border-gray-800/50 glass p-4 transition-all duration-500",
        isWaitingApproval && "opacity-60",
        isDragging && "ring-2 ring-indigo-500/50 bg-indigo-500/5"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="w-full">
        {/* Waiting approval overlay */}
        {isWaitingApproval && (
          <div className="flex items-center justify-center gap-2 mb-2 text-amber-400/70 text-[11px]" role="status" aria-live="polite">
            <Shield size={12} className="animate-pulse" />
            <span>Awaiting your decision on the pending command…</span>
          </div>
        )}

        {/* @mention scope chips (Mission / VM) */}
        {scopeChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2" role="list" aria-label="Mentioned Mission or VM">
            {scopeChips.map((chip) => (
              <div
                key={chip.id}
                role="listitem"
                className={cn(
                  "flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-md text-[11px] border",
                  chip.kind === "mission"
                    ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-300"
                    : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                )}
              >
                <span className="text-[9px] uppercase tracking-wide opacity-70">
                  {chip.kind}
                </span>
                <span className="max-w-[180px] truncate font-medium">@{chip.label}</span>
                {chip.hostIp && (
                  <span className="text-[10px] opacity-60 truncate max-w-[100px]">{chip.hostIp}</span>
                )}
                <button
                  type="button"
                  onClick={() => setScopeChips((prev) => prev.filter((c) => c.id !== chip.id))}
                  className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity"
                  aria-label={`Remove @${chip.label}`}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Workspace file pills (dragged from file tree) */}
        {workspaceFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {workspaceFiles.map((wf) => (
              <div
                key={wf.path}
                className="flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-md text-[11px] border"
                style={{
                  background: wf.type === "directory" ? "rgba(251,191,36,0.08)" : "rgba(99,102,241,0.1)",
                  borderColor: wf.type === "directory" ? "rgba(251,191,36,0.25)" : "rgba(99,102,241,0.25)",
                  color: wf.type === "directory" ? "#fbbf24" : "#a5b4fc",
                }}
              >
                {wf.loading ? (
                  <span className="w-2.5 h-2.5 border border-indigo-400 border-t-transparent rounded-full animate-spin" />
                ) : wf.type === "directory" ? (
                  <Folder size={11} />
                ) : (
                  <FileCode size={11} />
                )}
                <span className="max-w-[160px] truncate">{wf.name}</span>
                <button
                  onClick={() => setWorkspaceFiles(prev => prev.filter(f => f.path !== wf.path))}
                  className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity"
                  aria-label={`Remove ${wf.name}`}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Pending attachment chips */}
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2" role="list" aria-label="Pending attachments">
            {pendingAttachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-1.5 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300"
                role="listitem"
              >
                {att.category === "image" ? (
                  att.previewUrl ? (
                    <img src={att.previewUrl} alt={att.filename} className="w-6 h-6 rounded object-cover" />
                  ) : (
                    <ImageIcon size={14} className="text-indigo-400" />
                  )
                ) : (
                  <FileText size={14} className="text-emerald-400" />
                )}
                <span className="max-w-[120px] truncate">{att.filename}</span>
                <button
                  onClick={() => removePendingAttachment(att.id)}
                  className="text-gray-500 hover:text-red-400 transition-colors"
                  aria-label={`Remove ${att.filename}`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Drag overlay */}
        {isDragging && (
          <div className="flex items-center justify-center gap-2 mb-2 text-indigo-400 text-xs">
            <Paperclip size={14} />
            <span>Drop files to attach</span>
          </div>
        )}

        <div className="relative flex items-end gap-2">
          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isWaitingApproval || isUploading}
            className={cn(
              "p-2 rounded-lg transition-colors mb-0.5",
              isUploading
                ? "text-indigo-400 animate-pulse"
                : "text-gray-500 hover:text-gray-300 hover:bg-gray-800/50"
            )}
            aria-label="Attach file"
          >
            <Paperclip size={18} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) {
                handleFileUpload(e.target.files);
                e.target.value = "";
              }
            }}
          />

          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              isWaitingApproval
                ? "Approve or skip the command above…"
                : workspaceFiles.length > 0
                  ? `Ask about the attached file${workspaceFiles.length > 1 ? "s" : ""}… (↵ send)`
                  : "Message AIPiloty… (@ Mission, VM, or files)"
            }
            aria-label="Chat message input"
            aria-autocomplete="list"
            aria-expanded={showMention}
            rows={1}
            disabled={isWaitingApproval}
            className={cn(
              "flex-1 resize-none rounded-xl bg-gray-100 dark:bg-gray-800/80 border border-gray-300 dark:border-gray-700/50",
              "px-4 py-3 pr-24 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500",
              "focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50",
              "transition-all duration-300",
              isWaitingApproval && "cursor-not-allowed opacity-50",
              intensityLevel > 0.5 && !isWaitingApproval && "animate-breathe-glow"
            )}
          />

          {/* @-mention dropdown */}
          {showMention && (
            <div className="absolute left-12 bottom-16 z-50">
              <ContextMention
                query={mentionQuery}
                onSelect={handleMentionSelect}
                onClose={() => {
                  setShowMention(false);
                  setMentionQuery("");
                }}
              />
            </div>
          )}

          <div className="absolute right-2 bottom-1.5 flex items-center gap-1">
            {/* Voice button */}
            <button
              onClick={toggleVoice}
              className={cn(
                "p-2 rounded-lg transition-colors",
                isListening
                  ? "bg-red-600 text-white animate-pulse"
                  : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800/50"
              )}
              aria-label={isListening ? "Stop listening" : "Voice input"}
            >
              {isListening ? <MicOff size={14} /> : <Mic size={14} />}
            </button>

            {isStreaming ? (
              <button
                onClick={handleStop}
                className="p-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none"
                aria-label="Stop generating"
              >
                <Square size={16} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!canSend || isWaitingApproval}
                aria-label="Send message"
                className={cn(
                  "p-2 rounded-lg transition-all",
                  canSend && !isWaitingApproval
                    ? "bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-500/20"
                    : "bg-gray-700/50 text-gray-500 cursor-not-allowed"
                )}
              >
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 mt-2">
          <ChatModeToggle />
          <ChatModelPicker />
        </div>
      </div>
    </div>
  );
}
