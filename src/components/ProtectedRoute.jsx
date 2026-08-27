import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Spinner } from './ui'

export default function ProtectedRoute({ children }) {
  const { user, loading, isCloud, redirectError } = useAuth()

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Starting up…" />
      </div>
    )
  }

  if (isCloud && !user) {
    // Somebody who has just come back from a sign-in that failed does not need
    // the landing page: they need to know what went wrong, and the reason is
    // only rendered on the login screen. Sending them to /welcome swallows it
    // and the whole round trip looks like a button that did nothing.
    return <Navigate to={redirectError ? '/login' : '/welcome'} replace />
  }

  return children
}
