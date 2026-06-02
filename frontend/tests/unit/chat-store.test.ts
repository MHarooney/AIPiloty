import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── localStorage mock ───────────────────────────────────────────────────────
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, val: string) => { store[key] = val }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()

Object.defineProperty(global, 'localStorage', { value: localStorageMock })
Object.defineProperty(global, 'crypto', {
  value: { randomUUID: () => `test-uuid-${Math.random()}` },
})

// ── Helpers ─────────────────────────────────────────────────────────────────
function makeFreshStore() {
  vi.resetModules()
  localStorageMock.clear()
  // Re-import the store fresh for each test group to avoid cross-test state
  return import('@/stores/chat-store')
}

// ═══════════════════════════════════════════════════════════
// addUserMessage
// ═══════════════════════════════════════════════════════════

describe('addUserMessage', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.resetModules()
  })

  it('appends a user message with correct role', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.getState().addUserMessage('Hello!')
    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('user')
    expect(msgs[0].content).toBe('Hello!')
  })

  it('assigns a unique id to each message', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.getState().addUserMessage('Msg 1')
    useChatStore.getState().addUserMessage('Msg 2')
    const ids = useChatStore.getState().messages.map((m) => m.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('sets lastUserMessage', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.getState().addUserMessage('test content')
    expect(useChatStore.getState().lastUserMessage).toBe('test content')
  })

  it('clears pendingAttachments', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.setState({ pendingAttachments: [{ id: '1', filename: 'f', mime_type: 'image/png', category: 'image' }] })
    useChatStore.getState().addUserMessage('with attachments')
    expect(useChatStore.getState().pendingAttachments).toHaveLength(0)
  })

  it('stores attachments on the message when provided', async () => {
    const { useChatStore } = await makeFreshStore()
    const att = [{ id: 'a1', filename: 'img.png', mime_type: 'image/png', category: 'image' as const }]
    useChatStore.getState().addUserMessage('with file', att)
    expect(useChatStore.getState().messages[0].attachments).toEqual(att)
  })

  it('records timestamp as a number', async () => {
    const { useChatStore } = await makeFreshStore()
    const before = Date.now()
    useChatStore.getState().addUserMessage('ts test')
    const after = Date.now()
    const ts = useChatStore.getState().messages[0].timestamp
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  it('resets confidenceScore to null', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.setState({ confidenceScore: 0.9 })
    useChatStore.getState().addUserMessage('reset score')
    expect(useChatStore.getState().confidenceScore).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════
// startAssistantMessage / appendToken / finalizeAssistantMessage
// ═══════════════════════════════════════════════════════════

describe('streaming lifecycle', () => {
  beforeEach(() => { vi.resetModules(); localStorageMock.clear() })

  it('startAssistantMessage adds streaming assistant message', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.getState().startAssistantMessage()
    const last = useChatStore.getState().messages.at(-1)!
    expect(last.role).toBe('assistant')
    expect(last.isStreaming).toBe(true)
    expect(last.content).toBe('')
  })

  it('appendToken accumulates tokens on last assistant message', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.getState().startAssistantMessage()
    useChatStore.getState().appendToken('Hel')
    useChatStore.getState().appendToken('lo')
    expect(useChatStore.getState().messages.at(-1)!.content).toBe('Hello')
  })

  it('appendToken does nothing if last message is not assistant', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.getState().addUserMessage('user msg')
    useChatStore.getState().appendToken('should be ignored')
    expect(useChatStore.getState().messages.at(-1)!.content).toBe('user msg')
  })

  it('finalizeAssistantMessage sets isStreaming to false', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.getState().startAssistantMessage()
    useChatStore.getState().finalizeAssistantMessage()
    expect(useChatStore.getState().messages.at(-1)!.isStreaming).toBe(false)
  })

  it('finalizeAssistantMessage sets store isStreaming to false', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.setState({ isStreaming: true })
    useChatStore.getState().finalizeAssistantMessage()
    expect(useChatStore.getState().isStreaming).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════
// setSessionKey + localStorage persistence
// ═══════════════════════════════════════════════════════════

describe('setSessionKey', () => {
  beforeEach(() => { vi.resetModules(); localStorageMock.clear() })

  it('updates sessionKey in store', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.getState().setSessionKey('sess-abc')
    expect(useChatStore.getState().sessionKey).toBe('sess-abc')
  })

  it('persists session key to localStorage', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.getState().setSessionKey('sess-xyz')
    expect(localStorageMock.setItem).toHaveBeenCalledWith('aipiloty_last_session', 'sess-xyz')
  })
})

// ═══════════════════════════════════════════════════════════
// clearChat
// ═══════════════════════════════════════════════════════════

describe('clearChat', () => {
  beforeEach(() => { vi.resetModules(); localStorageMock.clear() })

  it('clears all messages', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.getState().addUserMessage('msg 1')
    useChatStore.getState().addUserMessage('msg 2')
    useChatStore.getState().clearChat()
    expect(useChatStore.getState().messages).toHaveLength(0)
  })

  it('resets sessionKey to null', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.getState().setSessionKey('some-key')
    useChatStore.getState().clearChat()
    expect(useChatStore.getState().sessionKey).toBeNull()
  })

  it('removes localStorage session key', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.getState().setSessionKey('key-to-clear')
    localStorageMock.removeItem.mockClear()
    useChatStore.getState().clearChat()
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('aipiloty_last_session')
  })

  it('resets isStreaming to false', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.setState({ isStreaming: true })
    useChatStore.getState().clearChat()
    expect(useChatStore.getState().isStreaming).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════
// restoreLastSession
// ═══════════════════════════════════════════════════════════

describe('restoreLastSession', () => {
  beforeEach(() => { vi.resetModules(); localStorageMock.clear() })

  it('returns the stored session key when present', async () => {
    const { useChatStore } = await makeFreshStore()
    // Set after makeFreshStore to avoid clear() wiping it
    localStorageMock.setItem('aipiloty_last_session', 'restored-key')
    const key = useChatStore.getState().restoreLastSession()
    expect(key).toBe('restored-key')
  })

  it('returns null when no session is stored', async () => {
    localStorageMock.getItem.mockReturnValueOnce(null)
    const { useChatStore } = await makeFreshStore()
    const key = useChatStore.getState().restoreLastSession()
    expect(key).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════
// setIsStreaming — document.title side effect
// ═══════════════════════════════════════════════════════════

describe('setIsStreaming', () => {
  beforeEach(() => { vi.resetModules(); localStorageMock.clear() })

  it('updates isStreaming to true', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.getState().setIsStreaming(true)
    expect(useChatStore.getState().isStreaming).toBe(true)
  })

  it('updates isStreaming to false', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.getState().setIsStreaming(false)
    expect(useChatStore.getState().isStreaming).toBe(false)
  })

  it('sets document.title to generating when streaming', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.getState().setIsStreaming(true)
    expect(document.title).toContain('Generating')
  })

  it('resets document.title when streaming ends', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.getState().setIsStreaming(true)
    useChatStore.getState().setIsStreaming(false)
    expect(document.title).toBe('AIPiloty')
  })
})

// ═══════════════════════════════════════════════════════════
// setIntensityLevel — clamping
// ═══════════════════════════════════════════════════════════

describe('setIntensityLevel', () => {
  beforeEach(() => { vi.resetModules(); localStorageMock.clear() })

  it('sets normal value', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.getState().setIntensityLevel(0.5)
    expect(useChatStore.getState().intensityLevel).toBe(0.5)
  })

  it('clamps value below 0 to 0', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.getState().setIntensityLevel(-5)
    expect(useChatStore.getState().intensityLevel).toBe(0)
  })

  it('clamps value above 1 to 1', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.getState().setIntensityLevel(99)
    expect(useChatStore.getState().intensityLevel).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════
// addToolCall / addToolResult
// ═══════════════════════════════════════════════════════════

describe('tool call mutations', () => {
  beforeEach(() => { vi.resetModules(); localStorageMock.clear() })

  it('addToolCall appends tool call to last assistant message', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.getState().startAssistantMessage()
    useChatStore.getState().addToolCall({ name: 'run_command', arguments: { cmd: 'ls' } })
    const last = useChatStore.getState().messages.at(-1)!
    expect(last.toolCalls).toHaveLength(1)
    expect(last.toolCalls![0].name).toBe('run_command')
  })

  it('addToolResult appends result to last assistant message', async () => {
    const { useChatStore } = await makeFreshStore()
    useChatStore.getState().startAssistantMessage()
    useChatStore.getState().addToolResult({ name: 'run_command', output: 'file1.txt' })
    const last = useChatStore.getState().messages.at(-1)!
    expect(last.toolResults).toHaveLength(1)
    expect(last.toolResults![0].output).toBe('file1.txt')
  })
})

// ═══════════════════════════════════════════════════════════
// normalizeFinalReport
// ═══════════════════════════════════════════════════════════

describe('normalizeFinalReport', () => {
  beforeEach(() => { vi.resetModules(); localStorageMock.clear() })

  it('normalizes a complete report', async () => {
    const { normalizeFinalReport } = await makeFreshStore()
    const result = normalizeFinalReport({
      summary: 'Done',
      steps: [],
      findings: [],
      confidence: 0.9,
      duration_ms: 1200,
      tools_used: 3,
      iterations: 2,
    })
    expect(result!.summary).toBe('Done')
    expect(result!.confidence).toBe(0.9)
  })

  it('returns undefined for null input', async () => {
    const { normalizeFinalReport } = await makeFreshStore()
    expect(normalizeFinalReport(null)).toBeUndefined()
  })

  it('returns undefined for non-object input', async () => {
    const { normalizeFinalReport } = await makeFreshStore()
    expect(normalizeFinalReport('string')).toBeUndefined()
  })

  it('defaults missing numeric fields to 0', async () => {
    const { normalizeFinalReport } = await makeFreshStore()
    const result = normalizeFinalReport({ summary: 'x' })
    expect(result!.confidence).toBe(0)
    expect(result!.duration_ms).toBe(0)
    expect(result!.tools_used).toBe(0)
  })

  it('defaults missing arrays to empty arrays', async () => {
    const { normalizeFinalReport } = await makeFreshStore()
    const result = normalizeFinalReport({ summary: 'x' })
    expect(Array.isArray(result!.steps)).toBe(true)
    expect(Array.isArray(result!.findings)).toBe(true)
  })
})
