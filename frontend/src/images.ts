/** Chuẩn bị ảnh Sếp đính kèm trước khi gửi: thu nhỏ để nhẹ và tốn ít token, trả về data URL. */

export const MAX_IMAGES = 4
const MAX_SIDE = 1568            // cạnh dài tối đa Claude khuyến nghị; lớn hơn chỉ tốn token
const KEEP_AS_IS = 1.5 * 1024 * 1024
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

const readDataUrl = (blob: Blob) => new Promise<string>((ok, fail) => {
  const r = new FileReader()
  r.onload = () => ok(String(r.result))
  r.onerror = () => fail(r.error)
  r.readAsDataURL(blob)
})

const loadImage = (src: string) => new Promise<HTMLImageElement>((ok, fail) => {
  const img = new Image()
  img.onload = () => ok(img)
  img.onerror = () => fail(new Error('Không đọc được ảnh'))
  img.src = src
})

export async function prepareImage(file: File): Promise<string> {
  if (!TYPES.includes(file.type)) throw new Error(`"${file.name}" không phải ảnh PNG, JPEG, WebP hoặc GIF.`)
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    // ảnh đã nhỏ: giữ nguyên (giữ nền trong suốt của PNG, giữ chuyển động của GIF)
    if (scale === 1 && file.size <= KEEP_AS_IS) return readDataUrl(file)
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')!
    const png = file.type === 'image/png'
    if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h) }  // JPEG không có nền trong suốt
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Lấy file ảnh từ sự kiện dán (Ctrl+V ảnh chụp màn hình) */
export const imagesFromClipboard = (e: ClipboardEvent | React.ClipboardEvent) =>
  Array.from(e.clipboardData?.files ?? []).filter(f => f.type.startsWith('image/'))
