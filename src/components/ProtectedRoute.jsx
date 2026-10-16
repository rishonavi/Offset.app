import { Link, Navigate } from 'react-router-dom'
import { CloudOff, RefreshCw } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Button, Card, Spinner } from './ui'

// What somebody sees when the app is running and the cloud behind it is not.
//
// It replaces the two things that used to happen instead, both of which read as
// the app being broken. Either the spinner never stopped — a paused Supabase
// project accepts the connection and never answers, so the promise that cleared
// it never settled — or the refresh eventually failed and the failure was
// reported as "nobody is signed in", which bounced somebody with a year of
// books in the cloud onto the marketing landing page.
//
// So it says the one thing that is actually known, which is that the server did
// not answer, and leaves the two useful doors open: try again, or sign in.
// Reloading is the fix for most of the causes and costs nothing when it is not.
function CloudUnreachable({ error }) {
  const reason = String(error?.message || error || '').trim()
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <Card className="max-w-md space-y-4 text-center">
        <CloudOff className="mx-auto text-ink-5" size={32} aria-hidden="true" />
        <h1 className="font-serif text-xl font-bold">Can’t reach your books</h1>
        <p className="text-sm text-ink-6">
          Offset is working, but the server holding your data didn’t answer. Your books are not lost — nothing
          can be read or saved until it is back.
        </p>
        <p className="text-sm text-ink-6">
          Usually this is the connection at your end, or the database being asleep after a quiet spell. Try
          again in a moment.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => window.location.reload()}>
            <RefreshCw size={16} aria-hidden="true" />
            Try again
          </Button>
          <Link to="/login" className="btn-ghost">
            Sign in
          </Link>
        </div>
        {/* The library's own words, small and last. Useless to most people and
            the only useful thing in the screen to somebody reporting it. */}
        {reason && <p className="text-xs text-ink-5">{reason}</p>}
      </Card>
    </div>
  )
}

export default function ProtectedRoute({ children }) {
  const { user, loading, isCloud, redirectError, cloudError } = useAuth()

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Starting up…" />
      </div>
    )
  }

  // Before the signed-out branch, because "we could not ask" is not "you are
  // not signed in" and only one of the two is somebody's fault to fix.
  if (isCloud && !user && cloudError) return <CloudUnreachable error={cloudError} />

  if (isCloud && !user) {
    // Somebody who has just come back from a sign-in that failed does not need
    // the landing page: they need to know what went wrong, and the reason is
    // only rendered on the login screen. Sending them to /welcome swallows it
    // and the whole round trip looks like a button that did nothing.
    return <Navigate to={redirectError ? '/login' : '/welcome'} replace />
  }

  return children
}
