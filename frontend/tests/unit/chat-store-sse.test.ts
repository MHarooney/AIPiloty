import { describe, it, expect, vi, beforeEach } from 'vitest'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, val: string) => {
      store[key] = val
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
  }
})()

Object.defineProperty(global, 'localStorage', { value: localStorageMock })
Object.defineProperty(global, 'crypto', {
  value: { randomUUID: () => 'aabbccddeeff00112233445566778899' },
})

const streamChatMock = vi.fn()
vi.mock('@/lib/api', () => ({
  streamChat: (...args: unknown[]) => streamChatMock(...args),
}))

async function freshStore() {
  vi.resetModules()
  localStorageMock.clear()
  streamChatMock.mockReset()
  return import('@/stores/chat-store')
}

describe('ensureSessionKey', () => {
  beforeEach(() => {
    localStorageMock.clear()
    streamChatMock.mockReset()
  })

  it('creates a stable key on first send and reuses it', async () => {
    const { useChatStore } = await freshStore()
    expect(useChatStore.getState().sessionKey).toBeNull()
    const a = useChatStore.getState().ensureSessionKey()
    const b = useChatStore.getState().ensureSessionKey()
    expect(a).toBeTruthy()
    expect(a).toBe(b)
    expect(useChatStore.getState().sessionKey).toBe(a)
  })
})

describe('handleSSEEvent', () => {
  beforeEach(() => {
    localStorageMock.clear()
    streamChatMock.mockReset()
  })

  it('handles session event', async () => {
    const { useChatStore } = await freshStore()
    useChatStore.getState().handleSSEEvent({
      type: 'session',
      data: { session_key: 'sess123' },
    })
    expect(useChatStore.getState().sessionKey).toBe('sess123')
  })

  it('handles token event', async () => {
    const { useChatStore } = await freshStore()
    useChatStore.getState().handleSSEEvent({
      type: 'token',
      data: { token: 'Hello' },
    })
    const msgs = useChatStore.getState().messages
    expect(msgs.some((m) => m.role === 'assistant' && m.content.includes('Hello'))).toBe(true)
    expect(useChatStore.getState().isStreaming).toBe(true)
  })

  it('handles tool_start and tool_output', async () => {
    const { useChatStore } = await freshStore()
    useChatStore.getState().startAssistantMessage()
    useChatStore.getState().handleSSEEvent({
      type: 'tool_start',
      data: { tool: 'generate_image', arguments: { prompt: 'x' } },
    })
    useChatStore.getState().handleSSEEvent({
      type: 'tool_output',
      data: {
        tool: 'generate_image',
        output: JSON.stringify({ status: 'needs_model_choice', options: [] }),
      },
    })
    const last = useChatStore.getState().messages.at(-1)!
    expect(last.toolCalls?.some((t) => t.name === 'generate_image')).toBe(true)
    expect(last.toolResults?.length).toBeGreaterThan(0)
  })

  it('handles approval_required', async () => {
    const { useChatStore } = await freshStore()
    useChatStore.getState().addUserMessage('run rm -rf /tmp/x')
    useChatStore.getState().startAssistantMessage()
    useChatStore.getState().handleSSEEvent({
      type: 'approval_required',
      data: {
        tool: 'run_terminal_command',
        arguments: { command: 'rm -rf /tmp/x' },
        risk_level: 'high',
        explanation: 'destructive',
      },
    })
    const state = useChatStore.getState()
    expect(state.systemState).toBe('waiting_approval')
    expect(state.isStreaming).toBe(false)
    const last = state.messages.at(-1)!
    expect(last.pendingApproval?.status).toBe('pending')
    expect(last.pendingApproval?.tool).toBe('run_terminal_command')
  })

  it('handles error and done', async () => {
    const { useChatStore } = await freshStore()
    useChatStore.getState().handleSSEEvent({
      type: 'error',
      data: { message: 'boom' },
    })
    expect(useChatStore.getState().messages.at(-1)?.content).toContain('boom')

    const { useChatStore: store2 } = await freshStore()
    store2.getState().startAssistantMessage()
    store2.getState().handleSSEEvent({ type: 'token', data: { token: 'ok' } })
    store2.getState().handleSSEEvent({ type: 'done', data: {} })
    expect(store2.getState().systemState).toBe('idle')
    expect(store2.getState().messages.at(-1)?.isStreaming).toBe(false)
  })

  it('handles final_report', async () => {
    const { useChatStore } = await freshStore()
    useChatStore.getState().startAssistantMessage()
    useChatStore.getState().handleSSEEvent({
      type: 'final_report',
      data: {
        summary: 'Done',
        confidence: 90,
        steps: [],
        findings: [],
        duration_ms: 100,
        tools_used: 1,
        iterations: 1,
      },
    })
    expect(useChatStore.getState().messages.at(-1)?.finalReport?.summary).toBe('Done')
    expect(useChatStore.getState().confidenceScore).toBe(90)
  })
})

describe('approveToolExecution / denyToolExecution', () => {
  beforeEach(() => {
    localStorageMock.clear()
    streamChatMock.mockReset()
  })

  it('approve sends streamChat with auto_approve=true', async () => {
    const { useChatStore } = await freshStore()
    useChatStore.getState().addUserMessage('deploy frontend')
    useChatStore.getState().startAssistantMessage()
    useChatStore.getState().handleSSEEvent({
      type: 'approval_required',
      data: { tool: 'deploy', arguments: {}, risk_level: 'high' },
    })
    useChatStore.getState().approveToolExecution()
    expect(streamChatMock).toHaveBeenCalled()
    const args = streamChatMock.mock.calls[0]
    // streamChat(originalMessage, sessionKey, handler, undefined, true, ...)
    expect(args[0]).toBe('deploy frontend')
    expect(args[4]).toBe(true)
    expect(useChatStore.getState().messages.at(-1)?.pendingApproval?.status).toBe('approved')
  })

  it('deny sends streamChat("no")', async () => {
    const { useChatStore } = await freshStore()
    useChatStore.setState({ sessionKey: 'sess-deny' })
    useChatStore.getState().addUserMessage('ssh into box')
    useChatStore.getState().startAssistantMessage()
    useChatStore.getState().handleSSEEvent({
      type: 'approval_required',
      data: { tool: 'ssh_command', arguments: {}, risk_level: 'high' },
    })
    useChatStore.getState().denyToolExecution()
    expect(streamChatMock).toHaveBeenCalled()
    const args = streamChatMock.mock.calls[0]
    expect(args[0]).toBe('no')
    expect(args[1]).toBe('sess-deny')
    expect(useChatStore.getState().messages.at(-1)?.pendingApproval?.status).toBe('denied')
  })
})
