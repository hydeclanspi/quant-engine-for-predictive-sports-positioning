import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startConsoleAnalytics } from '../consoleAnalyticsClient'

let instances
beforeEach(() => {
  vi.useFakeTimers()
  instances = []
  vi.stubGlobal('Worker', class {
    constructor() { this.postMessage = vi.fn(); this.terminate = vi.fn(); instances.push(this) }
  })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
const start = () => {
  const onPhase = vi.fn()
  const onError = vi.fn()
  const snapshot = { config: {}, investments: [], teamProfiles: [] }
  const dispose = startConsoleAnalytics({ snapshot, onPhase, onError })
  return { onPhase, onError, snapshot, dispose, worker: instances.at(-1) }
}

describe('Console background computation lifecycle', () => {
  it('posts one snapshot, delivers incremental phases, then releases the worker', () => {
    const job = start()
    expect(job.worker.postMessage).toHaveBeenCalledOnce()
    expect(job.worker.postMessage).toHaveBeenCalledWith(job.snapshot)
    for (const phase of ['rating', 'kelly', 'calibration', 'validation']) job.worker.onmessage({ data: { phase, result: { phase } } })
    expect(job.onPhase).toHaveBeenCalledTimes(4)
    expect(job.worker.terminate).toHaveBeenCalledOnce()
    vi.runAllTimers()
    expect(job.onError).not.toHaveBeenCalled()
  })

  it('cancels obsolete computations and ignores a queued response after disposal', () => {
    const old = start()
    const queuedResponse = old.worker.onmessage
    old.dispose()
    const current = start()
    queuedResponse({ data: { phase: 'calibration', result: { stale: true } } })
    expect(old.onPhase).not.toHaveBeenCalled()
    expect(old.worker.terminate).toHaveBeenCalledOnce()
    expect(current.worker).not.toBe(old.worker)
    current.dispose()
    vi.runAllTimers()
    expect(current.onError).not.toHaveBeenCalled()
  })

  it.each(['error', 'onerror', 'onmessageerror', 'timeout'])('reports %s without a main-thread fallback or infinite spinner', (kind) => {
    const job = start()
    if (kind === 'error') job.worker.onmessage({ data: { error: 'failed' } })
    if (kind === 'onerror') job.worker.onerror({ preventDefault: vi.fn() })
    if (kind === 'onmessageerror') job.worker.onmessageerror()
    if (kind === 'timeout') vi.advanceTimersByTime(120000)
    expect(job.onError).toHaveBeenCalledOnce()
    expect(job.onPhase).not.toHaveBeenCalled()
    expect(job.worker.terminate).toHaveBeenCalledOnce()
    vi.runAllTimers()
    expect(job.onError).toHaveBeenCalledOnce()
  })

  it('shows unavailable when workers are unsupported', () => {
    vi.stubGlobal('Worker', undefined)
    const job = start()
    expect(job.onError).toHaveBeenCalledOnce()
    expect(job.onPhase).not.toHaveBeenCalled()
    expect(instances).toHaveLength(0)
    job.dispose()
  })
})
