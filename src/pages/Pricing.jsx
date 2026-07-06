import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Wallet, ArrowLeft } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { PLANS, billingEnabled } from '../lib/plans'
import { startCheckout } from '../lib/billing'
import { formatCurrency } from '../lib/format'
import { Button } from '../components/ui'

export default function Pricing() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const upgrade = async () => {
    if (!user) return navigate('/login')
    setBusy(true)
    setError(null)
    try {
      await startCheckout(user)
    } catch (e) {
      setError(e?.message || 'Could not start checkout.')
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-navy via-[#0d2747] to-navy-dark px-4 py-10 text-white">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-serif text-lg font-bold">
            <span className="grid h-8 w-8 place-items-center bg-gold text-navy">
              <Wallet size={16} />
            </span>
            Offset
          </Link>
          <Link to="/" className="inline-flex items-center gap-1 text-sm text-white/70 hover:text-gold">
            <ArrowLeft size={15} /> Back to app
          </Link>
        </div>

        <div className="mt-10 text-center">
          <h1 className="font-serif text-4xl font-bold">Simple pricing</h1>
          <p className="mt-2 text-white/60">Track a couple of assets free. Go Pro for unlimited everything.</p>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {[PLANS.free, PLANS.pro].map((p) => {
            const isPro = p.id === 'pro'
            return (
              <div
                key={p.id}
                className={`flex flex-col border bg-white/5 p-6 backdrop-blur ${isPro ? 'border-gold' : 'border-white/15'}`}
              >
                <div className="flex items-baseline justify-between">
                  <h2 className="font-serif text-2xl font-bold">{p.name}</h2>
                  {isPro && <span className="bg-gold px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-navy">Best value</span>}
                </div>
                <div className="mt-3 font-serif text-3xl font-bold">
                  {p.price === 0 ? 'Free' : `${formatCurrency(p.price)}`}
                  {p.price !== 0 && <span className="text-base font-normal text-white/50"> / month</span>}
                </div>
                <p className="mt-1 text-sm text-white/60">{p.tagline}</p>
                <ul className="mt-5 flex-1 space-y-2 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check size={16} className="mt-0.5 shrink-0 text-gold" /> {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-6">
                  {isPro ? (
                    <Button onClick={upgrade} loading={busy} className="w-full">
                      {billingEnabled ? 'Upgrade to Pro' : 'Get Pro'}
                    </Button>
                  ) : (
                    <Link to={user ? '/' : '/login'} className="btn-ghost w-full border-white/30 bg-transparent text-white hover:text-gold">
                      Get started
                    </Link>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {!billingEnabled && (
          <p className="mt-6 text-center text-xs text-white/40">
            Billing isn’t enabled on this deployment yet — set up Stripe and <code>VITE_BILLING_ENABLED=true</code> to take payments.
          </p>
        )}
        {error && <p className="mt-4 text-center text-sm text-red-300">{error}</p>}

        <p className="mt-10 text-center text-xs text-white/40">
          <Link to="/terms" className="hover:text-gold">Terms</Link> · <Link to="/privacy" className="hover:text-gold">Privacy</Link>
        </p>
      </div>
    </div>
  )
}
