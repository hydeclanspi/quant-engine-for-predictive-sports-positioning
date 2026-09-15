import { describe, expect, it } from 'vitest'
import {
  initializeLayoutMode,
  LAYOUT_KEY,
  normalizeLayoutMode,
} from '../layoutMode.js'

const store = (initial = {}) => {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  }
}

describe('new layout default', () => {
  it('moves an existing Modern installation once and respects later choices', () => {
    const storage = store({ [LAYOUT_KEY]: 'modern' })
    expect(initializeLayoutMode('modern', storage)).toBe('inpiration')
    storage.setItem(LAYOUT_KEY, 'modern')
    expect(initializeLayoutMode('inpiration', storage)).toBe('modern')
    storage.setItem(LAYOUT_KEY, 'sidebar')
    expect(initializeLayoutMode('modern', storage)).toBe('sidebar')
  })
  it('uses the new default without storage and maps earlier names', () => {
    expect(initializeLayoutMode(undefined, store())).toBe('inpiration')
    expect(
      initializeLayoutMode(undefined, {
        getItem() {
          throw Error('blocked')
        },
      }),
    ).toBe('inpiration')
    for (const name of ['temp_title', 'inspration', 'inspiration'])
      expect(normalizeLayoutMode(name)).toBe('inpiration')
  })
})
