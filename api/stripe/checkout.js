// Creates a Stripe Checkout Session for the Pro subscription. The Supabase user
// id is passed as client_reference_id so the webhook can mark that account Pro.
//
// Env: STRIPE_SECRET_KEY, STRIPE_PRICE_ID (the recurring price for Pro).

import Stripe from 'stripe'
import { requireUser } from '../_auth.js'
import { rateLimited } from '../_rate.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }
  const key = process.env.STRIPE_SECRET_KEY
  const price = process.env.STRIPE_PRICE_ID
  if (!key || !price) {
    res.status(501).json({ error: 'Billing is not configured.' })
    return
  }
  // Who this subscription is for comes from the token.
  //
  // It used to come from the body: `client_reference_id: body.userId`, with no
  // authentication on the endpoint at all. That id is exactly what the webhook
  // writes `plan: 'pro'` against, so anyone who knew the URL could open a
  // checkout that credits somebody else's account — and anyone at all could
  // make Stripe sessions on the operator's account for as long as they liked.
  const auth = await requireUser(req)
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error })
    return
  }
  if (rateLimited(req, res, auth.user, { max: 20 })) return

  try {
    const origin = req.headers.origin || `https://${req.headers.host}`
    const stripe = new Stripe(key)
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      client_reference_id: auth.user.id,
      customer_email: auth.user.email || undefined,
      allow_promotion_codes: true,
      success_url: `${origin}/settings?upgraded=1`,
      cancel_url: `${origin}/pricing`,
    })
    res.status(200).json({ url: session.url })
  } catch (err) {
    res.status(500).json({ error: err?.message || 'checkout_failed' })
  }
}
