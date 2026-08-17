import { useEffect } from 'react'

// The four things every dialog has to get right, in one place.
//
// Escape closes it. Tab cycles inside it instead of wandering off into the page
// behind. The page behind doesn't scroll. And when the dialog closes, focus goes
// back to whatever opened it — otherwise a keyboard user is dumped at the top of
// the document with no idea where they are.
//
// Written once because getting three of the four right is the normal outcome,
// and the one that's missed is always the last.

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

const visible = (el) => el.offsetParent !== null || el === document.activeElement

export function useModal(ref, { open, onClose, initialFocus } = {}) {
  useEffect(() => {
    if (!open) return
    const node = ref?.current
    if (!node) return

    // Remember where focus came from before we move it.
    const opener = document.activeElement

    // Focus the field the dialog wants, falling back to the dialog itself so
    // the next Tab lands inside rather than in the page behind.
    const target = initialFocus?.current || node.querySelector(FOCUSABLE) || node
    // A frame's delay: the dialog may still be animating in, and focusing a
    // display:none element silently does nothing.
    const raf = requestAnimationFrame(() => {
      try { target.focus({ preventScroll: true }) } catch { /* not focusable */ }
    })

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose?.()
        return
      }
      if (e.key !== 'Tab') return
      const items = [...node.querySelectorAll(FOCUSABLE)].filter(visible)
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      // Wrap at both ends. Without this, Tab off the last control lands on the
      // browser chrome and the user cannot get back without a mouse.
      if (e.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)

    // Lock the page behind. Restoring the previous inline value rather than
    // clearing it means nested dialogs don't unlock the page on the inner
    // one's close.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
      // Only take focus back if it is still inside the dialog — if something
      // else has legitimately claimed it since, leave it alone.
      if (opener instanceof HTMLElement && (!document.activeElement || node.contains(document.activeElement))) {
        try { opener.focus({ preventScroll: true }) } catch { /* gone from the DOM */ }
      }
    }
  }, [open, onClose, ref, initialFocus])
}

export default useModal
