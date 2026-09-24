// No synchronous fallback: unsupported/failed workers must not freeze settings.
// Every data revision gets a fresh worker; terminate drops obsolete calculations
// and their caches. UI-only events do not create a new revision.
export const startConsoleAnalytics = ({ snapshot, onPhase, onError }) => {
  let worker
  let timer
  let disposed = false
  const stop = () => {
    disposed = true
    clearTimeout(timer)
    if (worker) {
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
    }
  }
  const fail = (message) => {
    if (disposed) return
    stop()
    onError(message)
  }
  try {
    worker = new Worker(new URL('../workers/consoleAnalytics.worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
      if (disposed) return
      if (data.error) { fail('分析计算失败，请重试'); return }
      onPhase(data.phase, data.result)
      if (data.phase === 'validation') stop()
    }
    worker.onerror = (event) => { event.preventDefault(); fail('后台分析不可用，请重试') }
    worker.onmessageerror = () => fail('分析结果读取失败，请重试')
    timer = setTimeout(() => fail('分析计算超时，请重试'), 120000)
    worker.postMessage(snapshot)
  } catch (_) {
    fail('后台分析不可用，请使用支持 Worker 的浏览器重试')
  }
  return stop
}
