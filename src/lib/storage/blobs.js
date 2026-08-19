// Attachment storage for demo mode.
//
// Receipts used to be base64 data URLs inside localStorage, which is one ~5MB
// budget shared with the entire ledger. Base64 inflates a file by a third, so
// two photographed bills filled it and the third refused to save — and the
// failure landed on whichever entry someone happened to be adding, not on the
// attachment that caused it.
//
// IndexedDB stores the file as a Blob, with no base64 inflation and a quota
// measured in hundreds of megabytes rather than five. The ledger keeps a short
// token instead of the file, so the rows stay small no matter what is attached.

const DB_NAME = 'offset-attachments'
const STORE = 'blobs'
const VERSION = 1

// `idb:<id>#<filename>` — the name rides along because callers decide how to
// render an attachment from the stored string alone (a PDF gets an embed, an
// image gets an <img>), and asking IndexedDB for that would make a synchronous
// decision asynchronous everywhere it is made.
const PREFIX = 'idb:'

export const isBlobToken = (stored) => typeof stored === 'string' && stored.startsWith(PREFIX)
const tokenFor = (id, name) => `${PREFIX}${id}#${encodeURIComponent(name || '')}`
const idFrom = (token) => String(token).slice(PREFIX.length).split('#')[0]
export const nameFrom = (token) =>
  isBlobToken(token) ? decodeURIComponent(String(token).split('#').slice(1).join('#')) : ''

const available = () => typeof indexedDB !== 'undefined'

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore(mode, fn) {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const result = fn(tx.objectStore(STORE))
      // Resolve on the transaction rather than the request: a write is not
      // durable until the transaction commits, and resolving early means a
      // reload straight after saving can find nothing there.
      tx.oncomplete = () => resolve(result?.result ?? result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'b-' + Math.random().toString(36).slice(2) + Date.now().toString(36)

// Stores the file and returns the token to keep on the row.
export async function putBlob(file) {
  if (!available()) throw new Error('This browser cannot store attachments offline.')
  const id = uid()
  await withStore('readwrite', (store) => store.put({ blob: file, type: file.type, name: file.name }, id))
  return tokenFor(id, file.name)
}

export async function getBlob(token) {
  if (!available() || !isBlobToken(token)) return null
  const record = await withStore('readonly', (store) => store.get(idFrom(token)))
  return record?.blob || null
}

// Called when an entry is destroyed for good. An attachment whose row is gone
// is unreachable, and without this the store keeps every file anyone ever
// deleted — the same slow leak the ledger itself was fixed for.
export async function deleteBlob(token) {
  if (!available() || !isBlobToken(token)) return
  try {
    await withStore('readwrite', (store) => store.delete(idFrom(token)))
  } catch {
    // A failed cleanup is not worth failing the delete the user asked for.
  }
}

// Every token the ledger still refers to; anything else in the store is
// unreachable. Used to sweep up after deletes that predate this file.
export async function pruneBlobs(keepTokens = []) {
  if (!available()) return 0
  const keep = new Set(keepTokens.filter(isBlobToken).map(idFrom))
  const ids = await withStore('readonly', (store) => store.getAllKeys())
  const stale = (ids || []).filter((id) => !keep.has(id))
  if (stale.length) await withStore('readwrite', (store) => stale.forEach((id) => store.delete(id)))
  return stale.length
}

// For a backup, which has to be openable on a device that has never seen this
// browser's IndexedDB. The token means nothing there, so the file itself has to
// travel — as a data URL, which is what backups carried before this change.
export async function blobToDataUrl(token) {
  const blob = await getBlob(token)
  if (!blob) return null
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
