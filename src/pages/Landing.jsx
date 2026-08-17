import { Link } from 'react-router-dom'
import { Wallet, ScanLine, BarChart3, Mail, ShieldCheck, ArrowRight, Check } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { PLANS, billingEnabled } from '../lib/plans'
import { formatCurrency } from '../lib/format'

const FEATURES = [
  { icon: ScanLine, title: 'Scan any receipt', body: 'Snap a bill and AI fills in the amount, tax, date, vendor and category.' },
  { icon: Mail, title: 'Import from Gmail', body: 'Pull invoices straight from your inbox and add them in one tap.' },
  { icon: BarChart3, title: 'See the whole picture', body: 'Income vs expenses, net position, budgets, ROI and tax summaries.' },
  { icon: ShieldCheck, title: 'Private & secure', body: 'Bank-style row-level security — your records are yours alone.' },
]

export default function Landing() {
  const { user } = useAuth()

  return (
    <div className="min-h-screen bg-gradient-to-b from-navy via-[#0d2747] to-navy-dark text-white">
      {/* Nav */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5">
        <div className="flex items-center gap-2 font-serif text-lg font-bold">
          <span className="grid h-8 w-8 place-items-center bg-gold text-navy">
            <Wallet size={16} />
          </span>
          Offset
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <Link to="/pricing" className="text-white/70 hover:text-gold">Pricing</Link>
          {user ? (
            <Link to="/" className="btn-primary">Open app</Link>
          ) : (
            <Link to="/login" className="btn-primary">Sign in</Link>
          )}
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-3xl px-4 pt-16 pb-12 text-center">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[3px] text-gold/80">Income &amp; expenses for every asset</p>
        <h1 className="mt-4 font-serif text-4xl font-bold leading-tight sm:text-6xl">
          Track what every asset <span className="text-gold">earns and costs.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-white/70">
          Properties, vehicles, jewellery, stocks and more — log income and expenses, scan receipts with AI, and see
          profit, budgets and tax at a glance.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link to={user ? '/' : '/login'} className="btn-primary">
            {user ? 'Open app' : 'Get started free'} <ArrowRight size={16} />
          </Link>
          <Link to="/pricing" className="btn-ghost border-white/30 bg-transparent text-white hover:text-gold">
            See pricing
          </Link>
        </div>
        <p className="mt-3 text-xs text-white/40">No card required for the free plan.</p>
      </section>

      {/* Features */}
      <section className="mx-auto grid max-w-4xl gap-4 px-4 pb-14 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div key={f.title} className="border border-white/10 bg-white/5 p-5 backdrop-blur">
            <span className="grid h-10 w-10 place-items-center bg-gold/15 text-gold">
              <f.icon size={18} />
            </span>
            <h2 className="mt-3 font-semibold">{f.title}</h2>
            <p className="mt-1 text-sm text-white/60">{f.body}</p>
          </div>
        ))}
      </section>

      {/* Pricing teaser */}
      <section className="mx-auto max-w-4xl px-4 pb-16">
        <div className="grid gap-4 sm:grid-cols-2">
          {[PLANS.free, PLANS.pro].map((p) => {
            const pro = p.id === 'pro'
            return (
              <div key={p.id} className={`flex flex-col border p-6 ${pro ? 'border-gold bg-white/5' : 'border-white/15'}`}>
                <h2 className="font-serif text-2xl font-bold">{p.name}</h2>
                <div className="mt-2 font-serif text-3xl font-bold">
                  {p.price === 0 ? 'Free' : formatCurrency(p.price)}
                  {p.price !== 0 && <span className="text-base font-normal text-white/50"> / mo</span>}
                </div>
                <ul className="mt-4 flex-1 space-y-2 text-sm">
                  {p.features.slice(0, 4).map((x) => (
                    <li key={x} className="flex items-start gap-2">
                      <Check size={15} className="mt-0.5 shrink-0 text-gold" /> {x}
                    </li>
                  ))}
                </ul>
                <Link to={user ? '/' : '/login'} className={`mt-5 ${pro ? 'btn-primary' : 'btn-ghost border-white/30 bg-transparent text-white hover:text-gold'} w-full`}>
                  {pro ? (billingEnabled ? 'Go Pro' : 'Get Pro') : 'Start free'}
                </Link>
              </div>
            )
          })}
        </div>
      </section>

      <footer className="border-t border-white/10 py-8 text-center text-xs text-white/40">
        <Link to="/pricing" className="hover:text-gold">Pricing</Link> ·{' '}
        <Link to="/terms" className="hover:text-gold">Terms</Link> ·{' '}
        <Link to="/privacy" className="hover:text-gold">Privacy</Link>
        <p className="mt-2">© {new Date().getFullYear()} Offset</p>
      </footer>
    </div>
  )
}
