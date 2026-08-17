// Playwright is not a dependency of the app — it is whatever the machine
// running the tests happens to have. Resolving it here means a new environment
// sets PLAYWRIGHT_MODULE once instead of every suite being edited by hand.
const spec = process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs'
export const { chromium } = await import(spec)
