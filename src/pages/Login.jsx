import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wallet } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Field, Input, Button } from '../components/ui'

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.6l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l6.2 5.2C41.1 36 44 30.5 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 384 512" fill="currentColor" aria-hidden="true">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  )
}

// Supabase reports a provider nobody switched on as "Unsupported provider",
// which reads like the app asked for something that does not exist. It is
// nearly always the one setting still turned off, and saying which one is the
// difference between a two-minute fix and an afternoon.
function explain(message) {
  const text = String(message || '')
  if (/unsupported provider|provider is not enabled|not enabled/i.test(text)) {
    return 'That provider isn’t switched on in this project’s Supabase. Enable it under Authentication → Providers, and paste in the client ID and secret from Google Cloud.'
  }
  if (/redirect|requested path is invalid|not allowed|invalid.*url/i.test(text)) {
    return `Supabase refused the return address. Add ${window.location.origin} to Authentication → URL Configuration → Redirect URLs, and set Site URL to the same thing.`
  }
  if (/exchange external code|invalid.*code|bad_oauth/i.test(text)) {
    return 'Google accepted the sign-in but Supabase could not complete it — usually a client ID or secret that does not match the one in Google Cloud, or a redirect URI there that is not https://<your-project>.supabase.co/auth/v1/callback.'
  }
  return text
}

export default function Login() {
  const { user, signIn, signUp, signInWithProvider, isCloud, redirectError } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)

  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])

  // A provider that refused says so on the way back rather than by throwing.
  useEffect(() => {
    if (redirectError) setError(explain(redirectError))
  }, [redirectError])

  const oauth = async (provider) => {
    setError(null)
    setInfo(null)
    try {
      await signInWithProvider(provider) // redirects to the provider
    } catch (err) {
      setError(explain(err?.message || String(err)))
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      if (mode === 'signin') {
        await signIn({ email, password })
      } else {
        const res = await signUp({ email, password })
        if (!res?.session) {
          setInfo('Account created. If email confirmation is on, confirm via the link we sent, then sign in.')
          setMode('signin')
        }
      }
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative grid min-h-screen place-items-center bg-navy px-4">
      <div className="noise-overlay" />
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="grid h-14 w-14 place-items-center bg-gold text-navy">
            <Wallet size={26} />
          </div>
          <h1 className="mt-5 font-serif text-3xl font-bold text-white">Offset</h1>
          <span className="mt-3 block h-[2px] w-12 bg-gold" />
          <p className="mt-3 text-sm text-white/50">
            {mode === 'signin' ? 'Sign in to your account' : 'Create your account'}
          </p>
        </div>

        <div className="card p-6">
          {/* Without Supabase there are no accounts, and these buttons could
              only ever throw. Reaching this page in that state is already
              unlikely — the demo backend reports a signed-in user, so /login
              redirects away — but "unlikely" is not a reason to render a
              control that cannot work. The README has always said these appear
              in cloud mode; now they do. Anyone in that state sees the demo
              banner in the app itself, which says what is missing. */}
          {isCloud ? (
            <>
              <div className="space-y-2.5">
                <button type="button" onClick={() => oauth('google')} className="btn-ghost w-full">
                  <GoogleIcon /> Continue with Google
                </button>
                <button type="button" onClick={() => oauth('apple')} className="btn-ghost w-full">
                  <AppleIcon /> Continue with Apple
                </button>
              </div>

              <div className="my-5 flex items-center gap-3 text-[0.6rem] font-semibold uppercase tracking-[2px] text-ink-6">
                <span className="h-px flex-1 bg-border-light" /> or <span className="h-px flex-1 bg-border-light" />
              </div>
            </>
          ) : null}

          <form onSubmit={submit} className="space-y-4">
            <Field label="Email">
              <Input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </Field>

            {error && <p className="bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {info && <p className="bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{info}</p>}

            <Button type="submit" className="w-full" loading={busy}>
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-ink-5">
            {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin')
                setError(null)
                setInfo(null)
              }}
              className="font-semibold text-gold hover:underline"
            >
              {mode === 'signin' ? 'Create one' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
