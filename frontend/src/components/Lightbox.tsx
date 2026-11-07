import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** Popup xem ảnh lớn (80vw × 90vh), nút ✕ góc phải trên; Esc hoặc bấm ra ngoài để đóng. */
export function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const closeFn = useRef(onClose)
  closeFn.current = onClose
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeFn.current() } }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.() }
  }, [])

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={alt} onClick={onClose}
      className="fixed inset-0 z-[100] grid place-items-center bg-black/80 backdrop-blur-sm">
      <div onClick={e => e.stopPropagation()}
        className="animate-pop relative grid h-[90vh] w-[80vw] place-items-center overflow-hidden rounded-xl border border-white/10 bg-ink-950 shadow-2xl">
        <img src={src} alt={alt} className="max-h-full max-w-full object-contain" />
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Đóng ảnh"
          className="absolute right-3 top-3 grid h-10 w-10 cursor-pointer place-items-center rounded-lg bg-ink-900/90 text-slate-200 ring-1 ring-white/15 transition hover:bg-rose-500 hover:text-white focus-visible:outline-2 focus-visible:outline-teal-300">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  )
}

/** Trạng thái ảnh đang mở: open(src, alt) để mở, view là phần tử popup (null khi đóng). */
export function useLightbox() {
  const [img, setImg] = useState<{ src: string; alt: string } | null>(null)
  return {
    open: (src: string, alt: string) => setImg({ src, alt }),
    view: img && <Lightbox src={img.src} alt={img.alt} onClose={() => setImg(null)} />,
  }
}
