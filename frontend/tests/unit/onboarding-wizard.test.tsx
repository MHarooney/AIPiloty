import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'

// ── Mocks ───────────────────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((k: string) => store[k] ?? null),
    setItem: vi.fn((k: string, v: string) => { store[k] = v }),
    removeItem: vi.fn((k: string) => { delete store[k] }),
    clear: vi.fn(() => { store = {} }),
    _setRaw: (k: string, v: string) => { store[k] = v },
  }
})()
Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true })

// Mock getHealth from api
vi.mock('@/lib/api', () => ({
  getHealth: vi.fn(),
  streamChat: vi.fn(),
}))

// Mock lucide-react icons used by the component
vi.mock('lucide-react', () => ({
  Bot: () => null,
  CheckCircle2: () => React.createElement('span', { 'data-testid': 'check-icon' }),
  ChevronRight: () => null,
  Wifi: () => null,
  Key: () => null,
  Server: () => null,
  Sparkles: () => null,
}))

// Mock cn utility
vi.mock('@/lib/utils', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}))

async function getComponent() {
  vi.resetModules()
  const mod = await import('@/components/onboarding-wizard')
  return mod.default
}

// ═══════════════════════════════════════════════════════════
// Visibility based on localStorage
// ═══════════════════════════════════════════════════════════

describe('OnboardingWizard — visibility', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.resetModules()
  })

  it('renders when onboarding_complete is not set', async () => {
    localStorageMock.getItem.mockReturnValue(null)
    const OnboardingWizard = await getComponent()
    render(React.createElement(OnboardingWizard))
    await waitFor(() => {
      expect(screen.getByText(/Welcome to AIPiloty/i)).toBeInTheDocument()
    })
  })

  it('does not render when onboarding_complete is "1"', async () => {
    localStorageMock.getItem.mockReturnValue('1')
    const OnboardingWizard = await getComponent()
    render(React.createElement(OnboardingWizard))
    await waitFor(() => {
      expect(screen.queryByText(/Welcome to AIPiloty/i)).not.toBeInTheDocument()
    })
  })

  it('shows step indicator "Step 1 of 4" on first render', async () => {
    localStorageMock.getItem.mockReturnValue(null)
    const OnboardingWizard = await getComponent()
    render(React.createElement(OnboardingWizard))
    await waitFor(() => {
      expect(screen.getByText(/Step 1 of 4/i)).toBeInTheDocument()
    })
  })
})

// ═══════════════════════════════════════════════════════════
// Step navigation
// ═══════════════════════════════════════════════════════════

describe('OnboardingWizard — step navigation', () => {
  beforeEach(() => {
    localStorageMock.clear()
    localStorageMock.getItem.mockReturnValue(null)
    vi.resetModules()
  })

  it('advances to step 2 when Next is clicked', async () => {
    const OnboardingWizard = await getComponent()
    render(React.createElement(OnboardingWizard))
    await waitFor(() => screen.getByText(/Welcome to AIPiloty/i))

    await act(async () => {
      fireEvent.click(screen.getByText(/Next/i))
    })

    await waitFor(() => {
      expect(screen.getByText(/Step 2 of 4/i)).toBeInTheDocument()
    })
  })

  it('shows "Verify backend connection" on step 2', async () => {
    const OnboardingWizard = await getComponent()
    render(React.createElement(OnboardingWizard))
    await waitFor(() => screen.getByText(/Welcome to AIPiloty/i))

    await act(async () => {
      fireEvent.click(screen.getByText(/Next/i))
    })

    await waitFor(() => {
      expect(screen.getByText(/Verify backend connection/i)).toBeInTheDocument()
    })
  })

  it('advances through all steps and shows "Get started" on last step', async () => {
    const OnboardingWizard = await getComponent()
    render(React.createElement(OnboardingWizard))
    await waitFor(() => screen.getByText(/Welcome to AIPiloty/i))

    // Click Next 3 times to reach last step (step 4)
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Next|Get started/i }))
      })
      // Small wait between steps
      await new Promise((r) => setTimeout(r, 10))
    }

    await waitFor(() => {
      expect(screen.getByText(/Get started/i)).toBeInTheDocument()
    })
  })
})

// ═══════════════════════════════════════════════════════════
// Skip setup
// ═══════════════════════════════════════════════════════════

describe('OnboardingWizard — skip setup', () => {
  beforeEach(() => {
    localStorageMock.clear()
    localStorageMock.getItem.mockReturnValue(null)
    vi.resetModules()
  })

  it('hides wizard when Skip setup is clicked', async () => {
    const OnboardingWizard = await getComponent()
    render(React.createElement(OnboardingWizard))
    await waitFor(() => screen.getByText(/Welcome to AIPiloty/i))

    await act(async () => {
      fireEvent.click(screen.getByText(/Skip setup/i))
    })

    await waitFor(() => {
      expect(screen.queryByText(/Welcome to AIPiloty/i)).not.toBeInTheDocument()
    })
  })

  it('sets localStorage onboarding_complete on skip', async () => {
    const OnboardingWizard = await getComponent()
    render(React.createElement(OnboardingWizard))
    await waitFor(() => screen.getByText(/Welcome to AIPiloty/i))

    await act(async () => {
      fireEvent.click(screen.getByText(/Skip setup/i))
    })

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'aipiloty_onboarding_complete',
      '1',
    )
  })
})

// ═══════════════════════════════════════════════════════════
// Get started (final step completion)
// ═══════════════════════════════════════════════════════════

describe('OnboardingWizard — final step completion', () => {
  beforeEach(() => {
    localStorageMock.clear()
    localStorageMock.getItem.mockReturnValue(null)
    vi.resetModules()
  })

  it('hides wizard when Get started is clicked on last step', async () => {
    const OnboardingWizard = await getComponent()
    render(React.createElement(OnboardingWizard))
    await waitFor(() => screen.getByText(/Welcome to AIPiloty/i))

    // Advance to last step
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        const btn = screen.queryByText(/Next/i) || screen.queryByText(/Get started/i)
        if (btn) fireEvent.click(btn)
      })
      await new Promise((r) => setTimeout(r, 10))
    }

    await waitFor(() => screen.getByText(/Get started/i))

    await act(async () => {
      fireEvent.click(screen.getByText(/Get started/i))
    })

    await waitFor(() => {
      expect(screen.queryByText(/Add your first VM/i)).not.toBeInTheDocument()
    })
  })

  it('persists onboarding_complete to localStorage on completion', async () => {
    const OnboardingWizard = await getComponent()
    render(React.createElement(OnboardingWizard))
    await waitFor(() => screen.getByText(/Welcome to AIPiloty/i))

    for (let i = 0; i < 3; i++) {
      await act(async () => {
        const btn = screen.queryByText(/Next/i) || screen.queryByText(/Get started/i)
        if (btn) fireEvent.click(btn)
      })
      await new Promise((r) => setTimeout(r, 10))
    }

    await waitFor(() => screen.getByText(/Get started/i))

    await act(async () => {
      fireEvent.click(screen.getByText(/Get started/i))
    })

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'aipiloty_onboarding_complete',
      '1',
    )
  })
})

// ═══════════════════════════════════════════════════════════
// Health check step (step 2)
// ═══════════════════════════════════════════════════════════

describe('OnboardingWizard — health check step', () => {
  beforeEach(() => {
    localStorageMock.clear()
    localStorageMock.getItem.mockReturnValue(null)
    vi.resetModules()
  })

  it('auto-runs health check on step 2', async () => {
    const { getHealth } = await import('@/lib/api')
    vi.mocked(getHealth).mockResolvedValue({} as any)

    const OnboardingWizard = await getComponent()
    render(React.createElement(OnboardingWizard))
    await waitFor(() => screen.getByText(/Welcome to AIPiloty/i))

    await act(async () => {
      fireEvent.click(screen.getByText(/Next/i))
    })

    // Step 2 renders with the "Verify backend connection" title
    await waitFor(() => {
      expect(screen.getByText(/Verify backend connection/i)).toBeInTheDocument()
    })
    // Health check auto-runs and shows connected state
    await waitFor(() => {
      expect(screen.getByText(/Backend and Ollama are connected/i)).toBeInTheDocument()
    })
  })

  it('shows "connected" message when health check succeeds', async () => {
    const { getHealth } = await import('@/lib/api')
    vi.mocked(getHealth).mockResolvedValue({} as any)

    const OnboardingWizard = await getComponent()
    render(React.createElement(OnboardingWizard))
    await waitFor(() => screen.getByText(/Welcome to AIPiloty/i))

    await act(async () => {
      fireEvent.click(screen.getByText(/Next/i))
    })

    // Health check auto-runs on step 2
    await waitFor(() => {
      expect(screen.getByText(/Backend and Ollama are connected/i)).toBeInTheDocument()
    })
  })

  it('shows error message when health check fails', async () => {
    const { getHealth } = await import('@/lib/api')
    vi.mocked(getHealth).mockRejectedValue(new Error('Connection refused'))

    const OnboardingWizard = await getComponent()
    render(React.createElement(OnboardingWizard))
    await waitFor(() => screen.getByText(/Welcome to AIPiloty/i))

    await act(async () => {
      fireEvent.click(screen.getByText(/Next/i))
    })

    // Health check auto-runs and shows error
    await waitFor(() => {
      expect(screen.getByText(/Could not reach the backend/i)).toBeInTheDocument()
    })
  })
})
