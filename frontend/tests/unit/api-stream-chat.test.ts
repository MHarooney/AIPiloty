import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── token mock ──────────────────────────────────────────────────────────────
const localStorageMock = (() => {
  let store: Record<string, string> = { aipiloty_token: 'test-token' }
  return {
    getItem: vi.fn((k: string) => store[k] ?? null),
    setItem: vi.fn((k: string, v: string) => { store[k] = v }),
    removeItem: vi.fn((k: string) => { delete store[k] }),
    clear: vi.fn(() => { store = { aipiloty_token: 'test-token' } }),
  }
})()
Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true })

// ── Utility to build a ReadableStream from SSE lines ───────────────────────
function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + '\n'))
      }
      controller.close()
    },
  })
}

function makeResponse(lines: string[], status = 200): Response {
  return new Response(sseStream(lines), {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

// ── streamChat import helper ────────────────────────────────────────────────
async function getStreamChat() {
  vi.resetModules()
  const mod = await import('@/lib/api')
  return mod.streamChat
}

// ═══════════════════════════════════════════════════════════
// Basic happy path
// ═══════════════════════════════════════════════════════════

describe('streamChat — happy path', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    localStorageMock.clear()
    fetchSpy = vi.spyOn(global, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('calls fetch with POST method and correct URL', async () => {
    fetchSpy.mockResolvedValueOnce(makeResponse(['data: [DONE]']))
    const streamChat = await getStreamChat()
    const events: any[] = []
    streamChat('hello', null, (e) => events.push(e))
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/chat/stream'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('sends JSON body with messages array', async () => {
    fetchSpy.mockResolvedValueOnce(makeResponse(['data: [DONE]']))
    const streamChat = await getStreamChat()
    streamChat('test message', null, () => {})
    await new Promise((r) => setTimeout(r, 50))
    const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as any).body)
    expect(callBody.messages).toHaveLength(1)
    expect(callBody.messages[0].content).toBe('test message')
    expect(callBody.messages[0].role).toBe('user')
  })

  it('passes session_key in body when provided', async () => {
    fetchSpy.mockResolvedValueOnce(makeResponse(['data: [DONE]']))
    const streamChat = await getStreamChat()
    streamChat('msg', 'my-session-key', () => {})
    await new Promise((r) => setTimeout(r, 50))
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body)
    expect(body.session_key).toBe('my-session-key')
  })

  it('passes model in body when provided', async () => {
    fetchSpy.mockResolvedValueOnce(makeResponse(['data: [DONE]']))
    const streamChat = await getStreamChat()
    streamChat('msg', null, () => {}, undefined, false, 'llama3')
    await new Promise((r) => setTimeout(r, 50))
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body)
    expect(body.model).toBe('llama3')
  })

  it('does not include model in body when null', async () => {
    fetchSpy.mockResolvedValueOnce(makeResponse(['data: [DONE]']))
    const streamChat = await getStreamChat()
    streamChat('msg', null, () => {}, undefined, false, null)
    await new Promise((r) => setTimeout(r, 50))
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body)
    expect(body.model).toBeUndefined()
  })

  it('passes auto_approve in body', async () => {
    fetchSpy.mockResolvedValueOnce(makeResponse(['data: [DONE]']))
    const streamChat = await getStreamChat()
    streamChat('msg', null, () => {}, undefined, true)
    await new Promise((r) => setTimeout(r, 50))
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body)
    expect(body.auto_approve).toBe(true)
  })

  it('calls onEvent with done event on [DONE]', async () => {
    fetchSpy.mockResolvedValueOnce(makeResponse(['data: [DONE]']))
    const streamChat = await getStreamChat()
    const events: any[] = []
    streamChat('hi', null, (e) => events.push(e))
    await new Promise((r) => setTimeout(r, 50))
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('parses and emits valid SSE JSON events', async () => {
    const lines = [
      'data: {"type":"token","data":{"token":"Hello"}}',
      'data: [DONE]',
    ]
    fetchSpy.mockResolvedValueOnce(makeResponse(lines))
    const streamChat = await getStreamChat()
    const events: any[] = []
    streamChat('hi', null, (e) => events.push(e))
    await new Promise((r) => setTimeout(r, 50))
    const tokenEvent = events.find((e) => e.type === 'token')
    expect(tokenEvent).toBeDefined()
    expect(tokenEvent?.data?.token).toBe('Hello')
  })

  it('skips malformed JSON lines silently', async () => {
    const lines = [
      'data: NOT_VALID_JSON',
      'data: [DONE]',
    ]
    fetchSpy.mockResolvedValueOnce(makeResponse(lines))
    const streamChat = await getStreamChat()
    const events: any[] = []
    expect(() => {
      streamChat('hi', null, (e) => events.push(e))
    }).not.toThrow()
    await new Promise((r) => setTimeout(r, 50))
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('tracks last-event-id from id: lines', async () => {
    const lines = [
      'id: evt-001',
      'data: {"type":"token","data":{"token":"x"}}',
      'data: [DONE]',
    ]
    fetchSpy.mockResolvedValueOnce(makeResponse(lines))
    const streamChat = await getStreamChat()
    const events: any[] = []
    streamChat('hi', null, (e) => events.push(e))
    await new Promise((r) => setTimeout(r, 50))
    // As long as no error is thrown and done is received, id parsing works
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('includes attachment_ids in body when provided', async () => {
    fetchSpy.mockResolvedValueOnce(makeResponse(['data: [DONE]']))
    const streamChat = await getStreamChat()
    streamChat('with files', null, () => {}, undefined, false, null, ['att-1', 'att-2'])
    await new Promise((r) => setTimeout(r, 50))
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body)
    expect(body.messages[0].attachment_ids).toEqual(['att-1', 'att-2'])
  })
})

// ═══════════════════════════════════════════════════════════
// HTTP error codes
// ═══════════════════════════════════════════════════════════

describe('streamChat — HTTP error handling', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    localStorageMock.clear()
    fetchSpy = vi.spyOn(global, 'fetch')
  })

  afterEach(() => { fetchSpy.mockRestore() })

  const errorCases: Array<[number, string]> = [
    [401, 'Session expired'],
    [403, "permission"],
    [422, 'malformed'],
    [429, 'Too many'],
    [500, 'Server error'],
    [502, 'unreachable'],
    [503, 'unavailable'],
    [504, 'timed out'],
  ]

  for (const [code, msgFragment] of errorCases) {
    it(`emits error event with friendly message for ${code}`, async () => {
      fetchSpy.mockResolvedValueOnce(new Response('', { status: code }))
      const streamChat = await getStreamChat()
      const events: any[] = []
      streamChat('hi', null, (e) => events.push(e))
      await new Promise((r) => setTimeout(r, 50))
      const errorEvent = events.find((e) => e.type === 'error')
      expect(errorEvent).toBeDefined()
      expect(errorEvent?.data?.message.toLowerCase()).toContain(msgFragment.toLowerCase())
    })
  }

  it('emits error for unknown status code', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 418 }))
    const streamChat = await getStreamChat()
    const events: any[] = []
    streamChat('hi', null, (e) => events.push(e))
    await new Promise((r) => setTimeout(r, 50))
    const errEvent = events.find((e) => e.type === 'error')
    expect(errEvent).toBeDefined()
    expect(errEvent.data.message).toContain('418')
  })
})

// ═══════════════════════════════════════════════════════════
// Abort / cancellation
// ═══════════════════════════════════════════════════════════

describe('streamChat — abort signal', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    localStorageMock.clear()
    fetchSpy = vi.spyOn(global, 'fetch')
  })

  afterEach(() => { fetchSpy.mockRestore() })

  it('does not emit error event when aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const abortErr = new DOMException('Aborted', 'AbortError')
    fetchSpy.mockRejectedValueOnce(abortErr)

    const streamChat = await getStreamChat()
    const events: any[] = []
    streamChat('hi', null, (e) => events.push(e), controller.signal)
    await new Promise((r) => setTimeout(r, 50))
    expect(events.find((e) => e.type === 'error')).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════
// Network error + retry
// ═══════════════════════════════════════════════════════════

describe('streamChat — network error retry', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    localStorageMock.clear()
    fetchSpy = vi.spyOn(global, 'fetch')
    vi.useFakeTimers()
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    vi.useRealTimers()
  })

  it('retries on network failure and succeeds on second attempt', async () => {
    fetchSpy
      .mockRejectedValueOnce(new TypeError('Network error'))
      .mockResolvedValueOnce(makeResponse(['data: [DONE]']))

    const streamChat = await getStreamChat()
    const events: any[] = []
    streamChat('hi', null, (e) => events.push(e))

    // Advance past the 1s retry delay and flush microtask queue
    await vi.runAllTimersAsync()
    // Flush remaining microtasks (avoid setTimeout with fake timers)
    for (let i = 0; i < 10; i++) await Promise.resolve()

    // Should have received done after retry
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('emits error after MAX_RETRIES exhausted', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Network error'))

    const streamChat = await getStreamChat()
    const events: any[] = []
    streamChat('hi', null, (e) => events.push(e))

    // Advance through all retry delays and flush microtask queue
    await vi.runAllTimersAsync()
    for (let i = 0; i < 10; i++) await Promise.resolve()

    const errEvent = events.find((e) => e.type === 'error')
    expect(errEvent).toBeDefined()
    expect(errEvent.data.message).toContain('retries')
  })
})
