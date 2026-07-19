import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  parseImageChoicePayload,
  default as ImageModelChoiceCard,
} from '@/components/image-model-choice-card'

const sendQuickPrompt = vi.fn()
const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

vi.mock('@/stores/chat-store', () => ({
  useChatStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      sendQuickPrompt,
      isStreaming: false,
    }),
}))

describe('parseImageChoicePayload', () => {
  it('parses needs_model_choice', () => {
    const p = parseImageChoicePayload(
      JSON.stringify({
        status: 'needs_model_choice',
        message: 'Pick one',
        options: [{ id: 'gpt-image-1', label: 'GPT Image 1', available: true }],
      }),
    )
    expect(p?.status).toBe('needs_model_choice')
    expect(p?.options).toHaveLength(1)
  })

  it('unwraps nested ToolResult output', () => {
    const p = parseImageChoicePayload(
      JSON.stringify({
        success: true,
        output: {
          status: 'needs_api_key',
          message: 'Add a key',
          options: [],
        },
      }),
    )
    expect(p?.status).toBe('needs_api_key')
  })

  it('returns null for unrelated payloads', () => {
    expect(parseImageChoicePayload(JSON.stringify({ success: true }))).toBeNull()
    expect(parseImageChoicePayload(undefined)).toBeNull()
  })
})

describe('ImageModelChoiceCard', () => {
  beforeEach(() => {
    sendQuickPrompt.mockReset()
    push.mockReset()
  })

  it('selects model and calls sendQuickPrompt with model id', () => {
    render(
      <ImageModelChoiceCard
        originalPrompt="Accounting cover"
        payload={{
          status: 'needs_model_choice',
          options: [
            {
              id: 'gpt-image-1',
              label: 'GPT Image 1',
              provider: 'openai',
              available: true,
            },
          ],
        }}
      />,
    )
    fireEvent.click(screen.getByText('GPT Image 1'))
    expect(sendQuickPrompt).toHaveBeenCalled()
    const prompt = sendQuickPrompt.mock.calls[0][0] as string
    expect(prompt).toContain('gpt-image-1')
    expect(prompt).toContain('Accounting cover')
  })

  it('locked option navigates to settings', () => {
    render(
      <ImageModelChoiceCard
        originalPrompt="x"
        payload={{
          status: 'needs_model_choice',
          options: [
            {
              id: 'gemini-2.5-flash-image',
              label: 'Nano Banana',
              provider: 'gemini',
              available: false,
            },
          ],
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Nano Banana/i }))
    expect(push).toHaveBeenCalledWith('/settings')
    expect(sendQuickPrompt).not.toHaveBeenCalled()
  })

  it('needs_api_key shows settings CTA', () => {
    render(
      <ImageModelChoiceCard
        originalPrompt="x"
        payload={{
          status: 'needs_api_key',
          message: 'Add a key',
          options: [],
        }}
      />,
    )
    fireEvent.click(screen.getByText(/Open Image Providers/i))
    expect(push).toHaveBeenCalledWith('/settings')
  })
})
