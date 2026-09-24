import { describe, expect, it, vi } from 'vitest'
import { attachGlassScrollMotion } from '../glassScrollMotion'

const setup = (reduce = false) => {
  const scroller = Object.assign(new EventTarget(), { scrollTop: 0, clientHeight: 800 })
  const page = Object.assign(new EventTarget(), { hidden: false })
  const preference = Object.assign(new EventTarget(), { matches: reduce })
  const frames = new Map()
  let nextId = 0
  const host = Object.assign(new EventTarget(), {
    matchMedia: () => preference,
    requestAnimationFrame: vi.fn((callback) => { frames.set(++nextId, callback); return nextId }),
    cancelAnimationFrame: vi.fn((id) => frames.delete(id)),
  })
  const layer = { style: {} }
  const dispose = attachGlassScrollMotion(scroller, layer, host, page)
  const scroll = (top) => { scroller.scrollTop = top; scroller.dispatchEvent(new Event('scroll')) }
  const flush = () => {
    const pending = Array.from(frames.values())
    frames.clear()
    pending.forEach((callback) => callback())
  }
  return { scroller, page, preference, frames, host, layer, dispose, scroll, flush }
}

describe('smooth glass scroll budget', () => {
  it('has no idle loop and coalesces scroll bursts into one frame using the latest position', () => {
    const env = setup()
    expect(env.frames.size).toBe(0)
    const resting = { ...env.layer.style }
    env.scroll(100)
    env.scroll(300)
    env.scroll(600)
    expect(env.host.requestAnimationFrame).toHaveBeenCalledTimes(1)
    env.flush()
    expect(env.frames.size).toBe(0)
    expect(env.layer.style).not.toEqual(resting)
    expect(Object.keys(env.layer.style).sort()).toEqual(['opacity', 'transform'])
    env.scroll(0)
    env.flush()
    expect(env.layer.style).toEqual(resting)
    env.dispose()
  })

  it('stops pending work when hidden, catches up when visible, and removes all listeners on unmount', () => {
    const env = setup()
    env.scroll(500)
    env.page.hidden = true
    env.page.dispatchEvent(new Event('visibilitychange'))
    env.scroll(700)
    expect(env.frames.size).toBe(0)
    env.page.hidden = false
    env.page.dispatchEvent(new Event('visibilitychange'))
    expect(env.frames.size).toBe(1)
    env.flush()
    env.scroll(900)
    env.dispose()
    const finalStyle = { ...env.layer.style }
    env.scroll(1200)
    env.host.dispatchEvent(new Event('resize'))
    env.page.dispatchEvent(new Event('visibilitychange'))
    env.preference.dispatchEvent(new Event('change'))
    env.flush()
    expect(env.frames.size).toBe(0)
    expect(env.layer.style).toEqual(finalStyle)
  })

  it('respects reduced motion, including a preference change during scrolling', () => {
    const env = setup(true)
    const resting = { ...env.layer.style }
    env.scroll(600)
    expect(env.frames.size).toBe(0)
    env.preference.matches = false
    env.preference.dispatchEvent(new Event('change'))
    expect(env.layer.style).not.toEqual(resting)
    env.scroll(800)
    env.preference.matches = true
    env.preference.dispatchEvent(new Event('change'))
    expect(env.frames.size).toBe(0)
    expect(env.layer.style).toEqual(resting)
    env.dispose()
  })

  it('keeps light movement bounded even on very long Console pages or zero-height containers', () => {
    const env = setup()
    env.scroller.clientHeight = 0
    for (const top of [-40, 0, 100, 10000, 1000000]) {
      env.scroll(top)
      env.flush()
      const y = Number(env.layer.style.transform.match(/, ([\d.-]+)px/)[1])
      expect(Math.abs(y)).toBeLessThanOrEqual(14)
      expect(Number(env.layer.style.opacity)).toBeGreaterThanOrEqual(0.6)
      expect(Number(env.layer.style.opacity)).toBeLessThanOrEqual(0.92)
    }
    env.dispose()
  })
})
