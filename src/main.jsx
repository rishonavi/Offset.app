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

// Before the first render, so an error thrown on the way up is still caught and
// available to a bug report.
installErrorLog()
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
