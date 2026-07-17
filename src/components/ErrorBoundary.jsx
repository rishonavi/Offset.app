import { Component } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

// Catches render/runtime errors in its subtree so one broken component can't
// blank the entire app. When `resetKey` changes (e.g. the route path), a
// previously-caught error is cleared automatically, so navigating away from a
// broken page recovers without a full reload.
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="grid min-h-[60vh] place-items-center px-4">
        <div className="w-full max-w-md border border-border-light bg-white p-8 text-center shadow-sm">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-red-50 text-red-500">
            <AlertTriangle size={24} />
          </span>
          <h2 className="mt-4 font-serif text-xl font-bold text-slate-900">Something went wrong</h2>
          <p className="mt-2 text-sm text-slate-500">
            This part of the app hit an unexpected error. Your data is safe — try again, and if it keeps
            happening, reload the page.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button onClick={() => this.setState({ error: null })} className="btn-primary">
              <RotateCcw size={16} /> Try again
            </button>
            <button onClick={() => window.location.reload()} className="btn-ghost">
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
