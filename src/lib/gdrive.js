// Optional Google Drive backup — the user connects their own Drive and we
// store a single JSON backup of their data in the private appDataFolder.
// Requires a Google OAuth Web client id in VITE_GOOGLE_CLIENT_ID.

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
const FILE_NAME = 'offset-backup.json'

export const driveConfigured = Boolean(CLIENT_ID)

let accessToken = null

function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve()
    const existing = document.getElementById('gis-script')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Failed to load Google script')))
      return
    }
    const s = document.createElement('script')
    s.id = 'gis-script'
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Failed to load Google script'))
    document.head.appendChild(s)
  })
}

// Pops the Google consent screen and stores a short-lived access token.
export async function connectDrive() {
  if (!CLIENT_ID) throw new Error('Google Drive is not configured (set VITE_GOOGLE_CLIENT_ID).')
  await loadGis()
  return new Promise((resolve, reject) => {
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: (resp) => {
          if (resp.error) return reject(new Error(resp.error))
          accessToken = resp.access_token
          resolve(true)
        },
      })
      client.requestAccessToken({ prompt: '' })
    } catch (e) {
      reject(e)
    }
  })
}

async function withToken() {
  if (!accessToken) await connectDrive()
  return accessToken
}

async function findBackupId(token) {
  const q = encodeURIComponent(`name='${FILE_NAME}'`)
  const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name)`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok) throw new Error('Could not read Google Drive.')
  const data = await r.json()
  return data.files?.[0]?.id || null
}

export async function backupToDrive(payload) {
  const token = await withToken()
  const id = await findBackupId(token)
  const body = JSON.stringify(payload)

  if (id) {
    const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body,
    })
    if (!r.ok) throw new Error('Backup upload failed.')
  } else {
    const boundary = 'pl_' + Math.random().toString(36).slice(2)
    const metadata = { name: FILE_NAME, parents: ['appDataFolder'] }
    const multipart =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`
    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipart,
    })
    if (!r.ok) throw new Error('Backup upload failed.')
  }
  return true
}

export async function restoreFromDrive() {
  const token = await withToken()
  const id = await findBackupId(token)
  if (!id) return null
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) throw new Error('Could not download backup.')
  return r.json()
}
