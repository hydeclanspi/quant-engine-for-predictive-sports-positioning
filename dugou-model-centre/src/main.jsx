import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { bootstrapCloudSnapshotOnLoad, ensureCurrentMonthSnapshot, initializeFlagshipGlassDefault } from './lib/localData'
import { isOwnerRoute, OWNER_ROUTE_BASENAME } from './lib/displayMode'
import { getDesignPreviewBase } from './design/labEditions'
import './index.css'
import './design/labEditions.css'
import './design/inspiration2609.css'
import './design/liquidGlassThemes.css'
import './design/flagshipGlass.css'
import './design/glassQuality.css'

const renderApp = () => {
  // 存量用户一次性切到旗舰「光谱」（只执行一次；之后尊重手动选择）
  initializeFlagshipGlassDefault()
  // The hidden owner entry behaves like a complete copy of the app mounted at
  // `/arsenal`: every existing absolute navigation automatically retains the
  // prefix, so `/arsenal/dashboard` never falls back into the public demo.
  const basename = getDesignPreviewBase(window.location.pathname) || (isOwnerRoute() ? OWNER_ROUTE_BASENAME : undefined)
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      {/* Opt into React Router v7 behaviours early — silences the two future
          flag warnings and pre-aligns for the v7 upgrade. Safe here: all
          routes are flat & absolute with no splat routes, so v7_relativeSplatPath
          is behaviour-neutral and v7_startTransition is the recommended path. */}
      <BrowserRouter basename={basename} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  )
}

const bootstrapBeforeRender = async () => {
  const timeout = new Promise((resolve) => {
    window.setTimeout(resolve, 2500)
  })
  try {
    await Promise.race([bootstrapCloudSnapshotOnLoad(), timeout])
  } catch {
    // Fall back to local snapshot when cloud bootstrap fails.
  }

  // Ensure monthly snapshot (fire and forget)
  ensureCurrentMonthSnapshot().catch(() => {
    // Silently ignore errors for monthly snapshot
  })
}

// The standalone design studio never needs a live snapshot or a monthly
// backup. Returning to the app reloads the document to run normal bootstrap.
if (getDesignPreviewBase(window.location.pathname)) {
  renderApp()
} else {
  bootstrapBeforeRender().finally(renderApp)
}
