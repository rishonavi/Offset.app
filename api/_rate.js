// A ceiling on how often one caller can reach an endpoint that costs the
// operator money — a Gemini call, an email, a provider request.
//
// Prefixed with an underscore so Vercel treats it as a helper and does not
// route it.
//
// This is a speed bump, not a quota. Serverless instances come and go and each
// one counts on its own, so a determined caller spread across instances gets
// more than `max`. It exists to stop an open endpoint being drained by a script
// pointed at it, which is the realistic failure — a real quota needs shared
// state, and where one exists (submit_report() in Postgres) that is the limit
// that counts.

const buckets = new Map()

// Identity first, address second. A signed-in user is the thing worth counting;
// an IP is what is left when there is nobody signed in, and it is shared by
// everyone behind one office router, so it is the weaker of the two.
export function callerKey(req, user) {
  if (user?.id) return `user:${user.id}`
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
  return `ip:${forwarded || req.headers?.['x-real-ip'] || req.socket?.remoteAddress || 'anon'}`
}

// Returns true when this call is over the limit. Recording the attempt whether
// or not it is allowed is deliberate: a caller who keeps hammering a closed
// door should not have the door open again the moment their window rolls.
export function overRate(key, { max = 20, windowMs = 60 * 60 * 1000 } = {}) {
  const now = Date.now()
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs)
  hits.push(now)
  buckets.set(key, hits)
  // Without this the map is a slow leak: one entry per address ever seen, kept
  // for the lifetime of the instance.
  if (buckets.size > 500) {
    for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k)
  }
  return hits.length > max
}

// The shape every caller wants: check and answer in one step. Returns true when
// the response has been sent and the handler should stop.
export function rateLimited(req, res, user, options) {
  if (!overRate(callerKey(req, user), options)) return false
  res.status(429).json({ error: 'rate_limited' })
  return true
}

// Exposed for tests — instances are long-lived and a suite that cannot reset
// the bucket ends up asserting against whatever the previous case left behind.
export function __resetRates() {
  buckets.clear()
}
