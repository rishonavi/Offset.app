import { isCloud } from '../cloudConfig'
import * as local from './local'
import * as remote from './supabase'

// `db` exposes one stable interface regardless of backend:
//   auth:      getCurrentUser, onAuthStateChange, signIn, signUp, signOut
//   data:      getProperties / addProperty / updateProperty / deleteProperty
//              getExpenses   / addExpense   / updateExpense   / deleteExpense
//   receipts:  uploadReceipt(file) -> stored string, getReceiptUrl(stored) -> url
//
// Which backend is in use is decided by `cloudConfig.js`, which reads two
// environment variables and nothing else. It used to be decided here from a
// flag that lived beside `createClient`, so choosing a backend downloaded the
// cloud library even when the answer was "local".
export { isCloud }
export const db = isCloud ? remote : local
