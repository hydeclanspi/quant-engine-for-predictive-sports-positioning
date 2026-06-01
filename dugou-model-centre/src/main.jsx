import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { bootstrapCloudSnapshotOnLoad, ensureCurrentMonthSnapshot } from './lib/localData'
import { isPreviewMode } from './lib/displayMode'
import './index.css'

// Apply the demo 90%-zoom class pre-paint so there's no 100%→90% flash on
// first load. App.jsx keeps it in sync afterwards (unlock/lock at runtime).
if (isPreviewMode()) {
  document.documentElement.classList.add('dugou-preview-zoom')
}

const renderApp = () => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      {/* Opt into React Router v7 behaviours early — silences the two future
          flag warnings and pre-aligns for the v7 upgrade. Safe here: all
          routes are flat & absolute with no splat routes, so v7_relativeSplatPath
          is behaviour-neutral and v7_startTransition is the recommended path. */}
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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

bootstrapBeforeRender().finally(renderApp)
