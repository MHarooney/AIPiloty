import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import ToolOutputCard from '@/components/tool-output-card'

describe('ToolOutputCard', () => {
  it('styles nested success:false as error', () => {
    const { container } = render(
      <ToolOutputCard
        result={{
          name: 'generate_image',
          output: JSON.stringify({
            success: true,
            output: { success: false, error: 'quota exceeded' },
          }),
        }}
      />,
    )
    expect(container.querySelector('.text-red-400')).toBeTruthy()
    const badge = container.querySelector('.uppercase')
    expect(badge?.textContent?.toLowerCase()).toBe('error')
  })

  it('does not treat plain success as error', () => {
    const { container } = render(
      <ToolOutputCard
        result={{
          name: 'kb_search',
          output: JSON.stringify({ success: true, results: [] }),
        }}
      />,
    )
    const badge = container.querySelector('.uppercase')
    expect(badge?.textContent?.toLowerCase()).toBe('success')
  })
})
