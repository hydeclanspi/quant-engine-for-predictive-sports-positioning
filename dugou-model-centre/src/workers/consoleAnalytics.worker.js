import { setAnalyticsWorkerSnapshot } from '../lib/analyticsSource'
import { runConsoleAnalytics } from '../lib/consoleAnalyticsJob'

self.onmessage = ({ data }) => {
  try {
    setAnalyticsWorkerSnapshot(data)
    runConsoleAnalytics((phase, result) => self.postMessage({ phase, result }))
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '分析计算失败' })
  }
}
