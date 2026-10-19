// Opens the Stripe billing portal for an existing customer so they can manage
// or cancel their subscription. Looks up their Stripe customer id (saved by the
// webhook) from the profiles table using the service-role key.
//
// Env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { requireUser } from '../_auth.js'
import { rateLimited } from '../_rate.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    res.status(501).json({ error: 'Billing is not configured.' })
    return
  }
  // Whose billing this is comes from the token, and only from the token.
  //
  // It used to be `body.userId`, on an endpoint with no authentication, looked
  // up with the service-role key so row-level security could not stop it. Post
  // somebody else's user id and Stripe handed back a live billing-portal link
  // to their subscription: their invoices, their card, and a button that
  // cancels it. User ids are not secret — a shared workspace shows them in its
  // own membership rows.
  const auth = await requireUser(req)
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error })
    return
  }
  if (rateLimited(req, res, auth.user, { max: 20 })) return

  try {
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const { data } = await admin
      .from('profiles').select('stripe_customer_id').eq('user_id', auth.user.id).maybeSingle()
    if (!data?.stripe_customer_id) {
      res.status(400).json({ error: 'No billing account yet — subscribe first.' })
      return
    }
    const origin = req.headers.origin || `https://${req.headers.host}`
    const stripe = new Stripe(key)
    const session = await stripe.billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: `${origin}/settings`,
    })
    res.status(200).json({ url: session.url })
  } catch (err) {
    res.status(500).json({ error: err?.message || 'portal_failed' })
  }
}
