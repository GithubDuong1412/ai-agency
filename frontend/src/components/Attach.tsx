import { ImagePlus, X } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import { MAX_IMAGES, imagesFromClipboard, prepareImage } from '../images'
import { useLightbox } from './Lightbox'

/** Ảnh Sếp đính kèm cho một ô chat: dán (Ctrl+V), kéo-thả hoặc chọn file. */
export function useAttachments() {
  const [images, setImages] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const pickerRef = useRef<HTMLInputElement>(null)

  const add = async (files: File[]) => {
    if (!files.length) return
    setErr(null)
    const room = MAX_IMAGES - images.length
    if (room <= 0) { setErr(`Tối đa ${MAX_IMAGES} ảnh mỗi lần gửi.`); return }
    if (files.length > room) setErr(`Tối đa ${MAX_IMAGES} ảnh mỗi lần gửi, đã bỏ bớt ${files.length - room} ảnh.`)
    const out: string[] = []
    for (const f of files.slice(0, room)) {
      try { out.push(await prepareImage(f)) } catch (e) { setErr((e as Error).message) }
    }
    setImages(prev => [...prev, ...out].slice(0, MAX_IMAGES))
  }

  return {
    images, err, dragging, pickerRef,
    remove: (i: number) => { setImages(prev => prev.filter((_, n) => n !== i)); setErr(null) },
    clear: () => { setImages([]); setErr(null) },
    openPicker: () => pickerRef.current?.click(),
    onPicked: (files: FileList | null) => { add(Array.from(files ?? [])); if (pickerRef.current) pickerRef.current.value = '' },
    onPaste: (e: React.ClipboardEvent) => {
      const files = imagesFromClipboard(e)
      if (files.length) { e.preventDefault(); add(files) }  // dán chữ thì để mặc định
    },
    dropProps: {
      onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } },
      onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) },
      onDrop: (e: DragEvent) => {
        setDragging(false)
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
        if (files.length) { e.preventDefault(); add(files) }
      },
    },
  }
}

export type Attachments = ReturnType<typeof useAttachments>

/** Hàng ảnh thu nhỏ phía trên ô nhập, mỗi ảnh có nút bỏ */
export function AttachThumbs({ a, disabled }: { a: Attachments; disabled?: boolean }) {
  const box = useLightbox()
  if (!a.images.length && !a.err) return null
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
      {box.view}
      {a.images.map((src, i) => (
        <div key={i} className="group relative h-14 w-14 overflow-hidden rounded-lg border border-white/10 bg-ink-950">
          <button type="button" onClick={() => box.open(src, `Ảnh đính kèm ${i + 1}`)} aria-label={`Xem lớn ảnh ${i + 1}`}
            className="block h-full w-full cursor-zoom-in">
            <img src={src} alt={`Ảnh đính kèm ${i + 1}`} className="h-full w-full object-cover" />
          </button>
          <button type="button" onClick={() => a.remove(i)} disabled={disabled} aria-label={`Bỏ ảnh ${i + 1}`}
            className="absolute right-0.5 top-0.5 grid h-6 w-6 cursor-pointer place-items-center rounded-md bg-ink-950/85 text-slate-200 hover:bg-rose-500 hover:text-white disabled:hidden">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
      {a.err && <span role="alert" className="text-xs text-rose-300">{a.err}</span>}
    </div>
  )
}

/** Nút đính kèm ảnh, cao bằng ô nhập, đặt cạnh nút gửi */
export function AttachButton({ a, disabled }: { a: Attachments; disabled?: boolean }) {
  return (<>
    <input ref={a.pickerRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden
      onChange={e => a.onPicked(e.target.files)} />
    <button type="button" onClick={a.openPicker} disabled={disabled} title="Đính kèm ảnh (hoặc dán Ctrl+V, kéo-thả)"
      aria-label="Đính kèm ảnh"
      className="flex shrink-0 cursor-pointer items-center justify-center self-stretch rounded-lg px-3 text-slate-300 ring-1 ring-inset ring-white/10 transition hover:bg-white/5 hover:text-white active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40">
      <ImagePlus className="h-4 w-4" aria-hidden="true" />
      {a.images.length > 0 && <span className="ml-1 text-xs tabular-nums">{a.images.length}</span>}
    </button>
  </>)
}
