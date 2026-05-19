import { test, expect } from '@playwright/test'

test.describe('Smoke tests', () => {
  test('home page loads', async ({ page }) => {
    await page.goto('/')
    await expect(page).not.toHaveTitle('Error')
  })

  test('health endpoint is reachable', async ({ request }) => {
    const baseURL = process.env.BACKEND_URL || 'http://localhost:8100'
    const resp = await request.get(`${baseURL}/api/v1/health`)
    expect([200, 503]).toContain(resp.status())
    const body = await resp.json()
    expect(body).toHaveProperty('status')
  })

  test('testing page loads without errors', async ({ page }) => {
    await page.goto('/testing')
    // Should not show a 404 or crash
    await expect(page.locator('body')).not.toContainText('404')
    await expect(page.locator('body')).not.toContainText('Application error')
  })

  test('sidebar navigation is visible', async ({ page }) => {
    await page.goto('/')
    // Sidebar should have at least one nav link
    const navLinks = page.locator('nav a, aside a')
    await expect(navLinks.first()).toBeVisible({ timeout: 10_000 })
  })
})
