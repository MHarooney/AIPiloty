import { test, expect, Page } from '@playwright/test'

/**
 * Critical chat / testing journeys with mocked SSE (no live LLM).
 */

async function mockChatStream(page: Page, events: Array<{ type: string; data: unknown }>) {
  await page.route('**/api/v1/chat/stream', async (route) => {
    const chunks = events
      .map((ev) => `data: ${JSON.stringify({ type: ev.type, data: ev.data })}\n\n`)
      .join('')
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body: chunks + 'data: [DONE]\n\n',
    })
  })
}

test.describe('Critical journeys', () => {
  test('login / home loads chat shell', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('body')).not.toContainText('Application error')
    // Chat input or nav should be present
    const shell = page.locator('nav, aside, textarea, [data-testid="chat-input"], input').first()
    await expect(shell).toBeVisible({ timeout: 15_000 })
  })

  test('mocked SSE needs_model_choice shows model card and selects GPT Image 1', async ({
    page,
  }) => {
    await mockChatStream(page, [
      { type: 'session', data: { session_key: 'e2e-sess-1' } },
      { type: 'thinking', data: { iteration: 1 } },
      {
        type: 'tool_start',
        data: { tool: 'generate_image', arguments: { prompt: 'Accounting cover' } },
      },
      {
        type: 'tool_output',
        data: {
          tool: 'generate_image',
          output: JSON.stringify({
            status: 'needs_model_choice',
            message: 'Which image model?',
            options: [
              {
                id: 'gpt-image-1',
                label: 'GPT Image 1',
                provider: 'openai',
                available: true,
              },
              {
                id: 'gemini-2.5-flash-image',
                label: 'Nano Banana',
                provider: 'gemini',
                available: false,
              },
            ],
          }),
        },
      },
      { type: 'token', data: { token: 'Choose an image model below.', done: true } },
      { type: 'done', data: {} },
    ])

    await page.goto('/chat')
    // If /chat redirects, try home
    if (page.url().endsWith('/') || (await page.locator('textarea').count()) === 0) {
      await page.goto('/')
    }

    const input = page.locator('textarea').first()
    if (await input.count()) {
      await input.fill('Generate a course cover image for Accounting')
      await input.press('Enter')
    }

    // Card may appear after stream; look for model label
    const gpt = page.getByText('GPT Image 1', { exact: false })
    await expect(gpt.first()).toBeVisible({ timeout: 20_000 })
    await gpt.first().click()
  })

  test('mocked approval_required shows Deny / Approve', async ({ page }) => {
    await mockChatStream(page, [
      { type: 'session', data: { session_key: 'e2e-sess-2' } },
      {
        type: 'approval_required',
        data: {
          tool: 'ssh_command',
          arguments: { command: 'uptime' },
          risk_level: 'high',
          explanation: 'SSH requires approval',
        },
      },
      { type: 'done', data: {} },
    ])

    await page.goto('/')
    const input = page.locator('textarea').first()
    if (await input.count()) {
      await input.fill('ssh into the server and check uptime')
      await input.press('Enter')
    }

    const deny = page.getByRole('button', { name: /deny/i })
    const approve = page.getByRole('button', { name: /approve/i })
    await expect(deny.or(approve).first()).toBeVisible({ timeout: 20_000 })
  })

  test('testing page loads with target bar', async ({ page }) => {
    await page.goto('/testing')
    await expect(page.locator('body')).not.toContainText('404')
    await expect(page.getByText(/AI Testing Agent|Testing/i).first()).toBeVisible({
      timeout: 15_000,
    })
    // Target bar: URL field or globe/target affordance
    const target = page.locator(
      'input[placeholder*="URL" i], input[placeholder*="http" i], input[type="url"], [data-testid="testing-target"]',
    )
    await expect(target.first()).toBeVisible({ timeout: 15_000 })
  })
})
