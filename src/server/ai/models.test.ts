import { describe, expect, it } from 'vitest'
import { parseModelSetting } from './models'

describe('parseModelSetting', () => {
  it('splits provider and model', () => {
    expect(parseModelSetting('anthropic:claude-sonnet-5-5')).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
    })
  })

  it('keeps colons inside the model name', () => {
    expect(parseModelSetting('openai:ft:gpt-5:archiv').model).toBe('ft:gpt-5:archiv')
  })

  it.each(['claude-sonnet-5-5', 'google:gemini', 'openai:', ':gpt-5'])('refuses %s', (value) => {
    expect(() => parseModelSetting(value)).toThrow()
  })
})
