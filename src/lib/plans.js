// Commercial plans & entitlements. Billing stays OFF until VITE_BILLING_ENABLED
// is set — while off, everyone is treated as "pro" so the app behaves exactly as
// before. Turn it on (with Stripe configured) to enforce the limits below.

export const billingEnabled = String(import.meta.env.VITE_BILLING_ENABLED || '').toLowerCase() === 'true'

// Price shown on the pricing page (in major currency units). Override with
// VITE_PRO_PRICE; the actual charge is whatever your Stripe price is set to.
export const PRO_PRICE = Number(import.meta.env.VITE_PRO_PRICE || 499)

export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    tagline: 'Get started tracking a couple of assets.',
    limits: { assets: 2, scansPerMonth: 10, gmailImport: false, cloudBackup: true },
    features: [
      'Up to 2 assets',
      '10 AI receipt scans / month',
      'Income, expenses & receipts',
      'Dashboard, charts & reports',
      'Excel / CSV / PDF export',
      'Cloud & file backup',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: PRO_PRICE,
    tagline: 'For portfolios and serious tracking.',
    limits: { assets: Infinity, scansPerMonth: Infinity, gmailImport: true, cloudBackup: true },
    features: [
      'Unlimited assets',
      'Unlimited AI receipt scanning',
      'Import bills from Gmail',
      'Tax & year-end reports',
      'Everything in Free',
    ],
  },
}

export const planById = (id) => PLANS[id] || PLANS.free
