import { useEffect, useState } from 'react'
import { X, ExternalLink, Loader2, FileText } from 'lucide-react'
import { db } from '../lib/storage'

// In-app lightbox for viewing a receipt/bill (image or PDF) without opening a
// new browser window. `stored` is the receipt_url value (signed path or data URL).
export default function ReceiptViewer({ stored, onClose }) {
  const [url, setUrl] = useState(null)
  const [state, setState] = useState('loading') // loading | ready | error

  useEffect(() => {
    let active = true
    // In demo mode this is now an object URL minted from IndexedDB rather than
    // a data URL. Those hold their blob in memory until revoked, so opening a
    // few receipts and closing them again would otherwise keep every one.
    let objectUrl = null
    setState('loading')
    setUrl(null)
    db.getReceiptUrl(stored)
      .then((u) => {
        if (!active) {
          if (u?.startsWith('blob:')) URL.revokeObjectURL(u)
          return
        }
        if (u) {
          if (u.startsWith('blob:')) objectUrl = u
          setUrl(u)
          setState('ready')
        } else {
          setState('error')
        }
      })
      .catch(() => active && setState('error'))
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [stored])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const isPdf = /\.pdf(\?|$)/i.test(stored || '') || String(stored || '').startsWith('data:application/pdf')

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between py-2">
          <span className="text-sm font-medium text-white/90">Receipt</span>
          <div className="flex items-center gap-3">
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-white/70 hover:text-white"
              >
                <ExternalLink size={14} /> Open in new tab
              </a>
            )}
            <button
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-lg text-white/80 transition hover:bg-white/10"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-xl bg-white">
          {state === 'loading' && (
            <div className="flex h-full items-center justify-center gap-2 py-20 text-slate-400">
              <Loader2 size={20} className="animate-spin" /> Loading…
            </div>
          )}
          {state === 'error' && (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-20 text-center text-slate-400">
              <FileText size={28} />
              <span className="text-sm">Couldn’t load this receipt.</span>
            </div>
          )}
          {state === 'ready' &&
            url &&
            (isPdf ? (
              <iframe src={url} title="Receipt" className="h-full min-h-[70vh] w-full" />
            ) : (
              <img src={url} alt="Receipt" className="mx-auto block max-h-full w-auto" />
            ))}
        </div>
      </div>
    </div>
  )
}
