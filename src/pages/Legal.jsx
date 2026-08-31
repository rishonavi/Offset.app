import { Link } from 'react-router-dom'
import { Wallet, ArrowLeft } from 'lucide-react'

function LegalShell({ title, children }) {
  return (
    <div className="min-h-screen bg-surface-sunk px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-serif text-lg font-bold text-navy">
            <span className="grid h-8 w-8 place-items-center bg-gold text-navy">
              <Wallet size={16} />
            </span>
            Offset
          </Link>
          <Link to="/" className="inline-flex items-center gap-1 text-sm text-ink-5 hover:text-brand">
            <ArrowLeft size={15} /> Back
          </Link>
        </div>
        <h1 className="mt-8 font-serif text-3xl font-bold text-navy">{title}</h1>
        <p className="mt-1 text-xs text-ink-6">Last updated {new Date().getFullYear()}</p>
        <div className="prose mt-6 space-y-4 text-sm leading-relaxed text-ink-4">{children}</div>
        <p className="mt-10 text-xs text-ink-6">
          <Link to="/terms" className="hover:text-brand">Terms</Link> ·{' '}
          <Link to="/privacy" className="hover:text-brand">Privacy</Link> ·{' '}
          <Link to="/pricing" className="hover:text-brand">Pricing</Link>
        </p>
      </div>
    </div>
  )
}

const H = ({ children }) => <h2 className="pt-2 font-semibold text-ink-2">{children}</h2>

export function Terms() {
  return (
    <LegalShell title="Terms of Service">
      <p>
        These terms govern your use of Offset (the “Service”). By creating an account or using the Service you agree to
        them. This is a template — replace it with terms reviewed for your jurisdiction before charging customers.
      </p>
      <H>The Service</H>
      <p>Offset helps you record income and expenses for your assets. You are responsible for the accuracy of the data you enter and for meeting your own tax and accounting obligations.</p>
      <H>Accounts</H>
      <p>You are responsible for safeguarding your login and for all activity under your account. You must provide accurate information and be old enough to form a binding contract.</p>
      <H>Subscriptions &amp; billing</H>
      <p>Paid plans are billed in advance on a recurring basis through our payment processor (Stripe). You can cancel anytime from the billing portal; access continues until the end of the paid period. Fees are non-refundable except where required by law.</p>
      <H>Acceptable use</H>
      <p>Don’t misuse the Service, attempt to break its security, or use it to violate any law. We may suspend accounts that do.</p>
      <H>Disclaimer &amp; liability</H>
      <p>The Service is provided “as is”, without warranties. Offset is not an accountant and does not provide financial or tax advice. To the extent permitted by law, our liability is limited to the amount you paid in the last 12 months.</p>
      <H>Changes</H>
      <p>We may update these terms; continued use after changes means you accept them.</p>
      <H>Contact</H>
      <p>Questions? Reach us at the support email listed on your account.</p>
    </LegalShell>
  )
}

export function Privacy() {
  return (
    <LegalShell title="Privacy Policy">
      <p>This policy explains what we collect and why. It’s a template — have it reviewed before launch.</p>
      <H>What we collect</H>
      <p>Account details (email), the financial records you enter (assets, income, expenses, receipts), and basic usage/diagnostic data. If you connect Google Drive or Gmail, we access only what’s needed for backup or bill import, using tokens that stay in your browser.</p>
      <H>How we use it</H>
      <p>To provide the Service, process payments (via Stripe), and keep the product secure and working. Receipt images you scan may be sent to our AI provider (Google Gemini) solely to extract the bill’s details.</p>
      <H>Storage &amp; security</H>
      <p>Data is stored in Supabase with row-level security so each account only sees its own records. We don’t sell your data.</p>
      <H>Your choices</H>
      <p>You can export or delete your data anytime from Settings, and disconnect any cloud integration. Deleting your account removes your records.</p>
      <H>Third parties</H>
      <p>We rely on Supabase (database/auth/storage), Stripe (payments), and Google (optional Drive/Gmail, and Gemini for scanning). Their handling of data is governed by their own policies.</p>
      <H>Contact</H>
      <p>Privacy questions? Use the support email listed on your account.</p>
    </LegalShell>
  )
}
