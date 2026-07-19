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

function sseBody(events: Array<{ type: string; data: unknown }>) {
  return (
    events.map((e) => `data: ${JSON.stringify({ type: e.type, data: e.data })}\n\n`).join('') +
    'data: [DONE]\n\n'
  )
}

async function freshStore() {
  vi.resetModules()
  localStorageMock.clear()
  return import('@/stores/testing-store')
}

describe('testing-store SSE handling', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.restoreAllMocks()
  })

  it('handles session, token, tool_start, done', async () => {
    const body = sseBody([
      { type: 'session', data: { session_key: 't-sess' } },
      { type: 'token', data: { token: 'Hello' } },
      { type: 'tool_start', data: { tool: 'probe_api_target', arguments: {} } },
      { type: 'done', data: {} },
    ])

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: () => {
            let done = false
            return {
              read: async () => {
                if (done) return { done: true, value: undefined }
                done = true
                return { done: false, value: new TextEncoder().encode(body) }
              },
            }
          },
        },
      }),
    )

    const { useTestingStore } = await freshStore()
    useTestingStore.getState().setTargetUrl('https://example.com')
    await useTestingStore.getState().sendMessage('probe the target')

    const state = useTestingStore.getState()
    expect(state.sessionKey).toBe('t-sess')
    expect(state.messages.some((m) => m.role === 'assistant' && m.content.includes('Hello'))).toBe(
      true,
    )
    expect(state.isStreaming).toBe(false)
    expect(state.systemState).toBe('idle')
  })

  it('handles screenshot events', async () => {
    const body = sseBody([
      {
        type: 'screenshot',
        data: { image_b64: 'abc', caption: 'home', step: 1, url: 'https://example.com' },
      },
      { type: 'done', data: {} },
    ])

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: () => {
            let done = false
            return {
              read: async () => {
                if (done) return { done: true, value: undefined }
                done = true
                return { done: false, value: new TextEncoder().encode(body) }
              },
            }
          },
        },
      }),
    )

    const { useTestingStore } = await freshStore()
    await useTestingStore.getState().sendMessage('open https://example.com')
    expect(useTestingStore.getState().screenshots).toHaveLength(1)
    expect(useTestingStore.getState().browserSessionActive).toBe(true)
  })

  it('handles error events', async () => {
    const body = sseBody([{ type: 'error', data: { message: 'probe failed' } }])
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: () => {
            let done = false
            return {
              read: async () => {
                if (done) return { done: true, value: undefined }
                done = true
                return { done: false, value: new TextEncoder().encode(body) }
              },
            }
          },
        },
      }),
    )

    const { useTestingStore } = await freshStore()
    await useTestingStore.getState().sendMessage('break things')
    expect(useTestingStore.getState().systemState).toBe('error')
    expect(useTestingStore.getState().messages.at(-1)?.content).toContain('probe failed')
  })
})
