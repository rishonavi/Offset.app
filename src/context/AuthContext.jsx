import { createContext, useContext, useEffect, useState } from 'react'
import { db, isCloud } from '../lib/storage'

const AuthContext = createContext(null)

export const useAuth = () => useContext(AuthContext)

// An OAuth sign-in leaves the page: the browser goes to the provider and comes
// back here. So a failure never returns as a thrown error from the call that
// started it — it arrives as query or hash parameters on the URL we land on,
// and if nobody reads them the user sees a login screen that simply did
// nothing. Supabase uses the hash for implicit flow and the query string for
// PKCE, so both are checked.
//
// Read once, at the moment the app starts, because the redirect target is "/"
// and being bounced to /login would otherwise drop it.
function readRedirectError() {
  if (typeof window === 'undefined') return null
  const from = (search) => new URLSearchParams(search)
  const hash = from(window.location.hash.replace(/^#/, ''))
  const query = from(window.location.search)
  const code = hash.get('error') || query.get('error')
  if (!code) return null
  const detail = hash.get('error_description') || query.get('error_description') || code

  // Clear it, so a reload does not re-report a failure that is over.
  window.history.replaceState({}, '', window.location.pathname)
  return decodeURIComponent(detail.replace(/\+/g, ' '))
}

const REDIRECT_ERROR = readRedirectError()

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [redirectError] = useState(REDIRECT_ERROR)

  useEffect(() => {
    const unsubscribe = db.onAuthStateChange((u) => {
      setUser(u)
      setLoading(false)
    })
    return unsubscribe
  }, [])

  const value = {
    user,
    loading,
    isCloud,
    // Whatever the provider said on the way back, if it said anything.
    redirectError,
    signIn: (creds) => db.signIn(creds),
    signUp: (creds) => db.signUp(creds),
    signInWithProvider: (provider) => db.signInWithProvider(provider),
    signOut: async () => {
      await db.signOut()
      setUser(null)
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
