import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { ToastProvider } from './context/ToastContext.jsx'
import { ConfigProvider } from './context/ConfigContext.jsx'
import { installErrorLog } from './lib/errorLog.js'
import { pruneDrafts } from './lib/draft.js'
import { isCloud } from './lib/storage/index.js'
import { sweepOrphanedBlobs } from './lib/storage/local.js'

// Before the first render, so an error thrown on the way up is still caught and
// available to a bug report.
installErrorLog()

// Two sweeps that were written and never called, so neither ever ran.
//
// A draft expires after a day but nothing was removing the expired ones, so a
// browser accumulated a key per form abandoned, forever, inside a five-megabyte
// quota shared with the ledger itself.
pruneDrafts()

// And an attachment whose entry is gone is unreachable but not deleted. Only in
// local mode: in cloud mode receipts live in Supabase, and these tokens belong
// to a demo-mode ledger the user may still come back to. Deliberately not
// awaited — nothing on screen depends on it, and a failed sweep must not delay
// the first paint.
if (!isCloud) sweepOrphanedBlobs().catch(() => {})
import { LanguageProvider } from './context/LanguageContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <LanguageProvider>
      <ThemeProvider>
        <ToastProvider>
          <ConfigProvider>
            <BrowserRouter>
              <AuthProvider>
                <App />
              </AuthProvider>
            </BrowserRouter>
          </ConfigProvider>
        </ToastProvider>
      </ThemeProvider>
      </LanguageProvider>
    </ErrorBoundary>
  </StrictMode>,
)

// Register the PWA service worker (production only; safe to fail).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
