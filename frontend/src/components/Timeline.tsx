import { fillNames } from '../names'
import { ChevronDown, ChevronRight, Loader2, Wrench } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { attachmentUrl, clock, type AgencyEvent, type Role } from '../api'
import { Avatar, Empty } from './common'
import { useLightbox } from './Lightbox'

const SHOWN = new Set(['message', 'handoff', 'plan', 'review', 'report', 'project_status', 'tool', 'design'])

type Badge = { label: string; cls: string }
// Màu chỉ dành cho nhãn kết luận/loại tin; nội dung luôn là màu chữ thường để dễ đọc và có thứ bậc
const B = {
  command: { label: 'Giao việc', cls: 'bg-amber-400/10 text-amber-200' },
  feedback: { label: 'Góp ý', cls: 'bg-amber-400/10 text-amber-200' },
  interject: { label: 'Nhắn chen ngang', cls: 'bg-sky-400/10 text-sky-200' },
  handoff: { label: 'Bàn giao', cls: 'bg-sky-400/10 text-sky-200' },
  plan: { label: 'Kế hoạch', cls: 'bg-teal-400/10 text-teal-200' },
  design: { label: 'Thiết kế', cls: 'bg-sky-400/10 text-sky-200' },
  approve: { label: 'Duyệt', cls: 'bg-emerald-400/10 text-emerald-300' },
  changes: { label: 'Yêu cầu sửa', cls: 'bg-rose-400/10 text-rose-300' },
  report: { label: 'Báo cáo', cls: 'bg-amber-400/10 text-amber-200' },
  lessons: { label: 'Bài học rút ra', cls: 'bg-violet-400/10 text-violet-200' },
} satisfies Record<string, Badge>

const STATUS: Record<string, string> = {
  queued: 'Đã xếp hàng', running: 'Đang làm', awaiting_approval: 'Chờ Sếp duyệt', approved: 'Sếp đã duyệt',
  changes_requested: 'Sếp yêu cầu sửa', failed: 'Lỗi', stopped: 'Đã dừng', done: 'Hoàn tất',
}

// Tên thao tác dễ hiểu cho dòng tóm tắt
const TOOL: Record<string, string> = {
  read_file: 'đọc file', list_dir: 'xem thư mục', search_files: 'tìm kiếm', read_knowledge: 'tra kiến thức',
  write_file: 'tạo file', edit_file: 'sửa file', run_command: 'chạy lệnh', screenshot: 'chụp màn hình',
  post_message: 'nhắn tin', view_image: 'xem ảnh',
}

function describe(ev: AgencyEvent, roleBy: (k?: string | null) => Role | undefined): { text: string; badge?: Badge; extra?: string } {
  const d = ev.data
  switch (ev.type) {
    case 'message':
      if (d.kind === 'command') return { text: d.text, badge: B.command }
      if (d.kind === 'feedback') return { text: d.text, badge: B.feedback }
      if (d.kind === 'interject') return { text: d.text, badge: B.interject }
      if (d.kind === 'lessons') return { text: '\n' + d.text, badge: B.lessons }
      return { text: (d.to && d.to !== 'all' ? `@${roleBy(d.to)?.name || d.to} ` : '') + d.text }
    case 'handoff':
      return { text: d.note, badge: { ...B.handoff, label: `Bàn giao → ${roleBy(d.to)?.name || d.to}` } }
    case 'plan':
      return { text: `"${d.title}" · ${d.tasks?.length} việc:\n${(d.tasks || []).map((t: string) => `• ${t}`).join('\n')}`, badge: B.plan }
    case 'design':
      return { text: d.summary, badge: B.design }
    case 'review':
      return { text: d.summary, badge: d.verdict === 'approve' ? B.approve : B.changes, extra: `${d.score}/10` }
    case 'report':
      return { text: d.headline, badge: B.report }
    default:
      return { text: ev.type }
  }
}

/** Gộp: chuỗi thao tác liền nhau của cùng một người thành một dòng; tin liền nhau của cùng người (≤3 phút) bỏ phần đầu. */
type Item =
  | { kind: 'msg'; ev: AgencyEvent; head: boolean }
  | { kind: 'tools'; id: number; agent: string | null; evs: AgencyEvent[] }
  | { kind: 'status'; ev: AgencyEvent }

function group(events: AgencyEvent[]): Item[] {
  const out: Item[] = []
  let lastMsg: AgencyEvent | null = null
  for (const ev of events) {
    const prev = out[out.length - 1]
    if (ev.type === 'tool') {
      if (prev?.kind === 'tools' && prev.agent === ev.agent) prev.evs.push(ev)
      else out.push({ kind: 'tools', id: ev.id, agent: ev.agent, evs: [ev] })
      continue
    }
    if (ev.type === 'project_status') { out.push({ kind: 'status', ev }); lastMsg = null; continue }
    const same = lastMsg && lastMsg.agent === ev.agent && lastMsg.project_id === ev.project_id
      && Math.abs(ev.created_at - lastMsg.created_at) < 180
    out.push({ kind: 'msg', ev, head: !same })
    lastMsg = ev
  }
  return out
}

const LIMIT = 320  // ký tự; dài hơn thì thu gọn, bấm "Xem thêm"

function LongText({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const lines = text.split('\n')
  const long = text.length > LIMIT || lines.length > 5
  if (!long) return <>{text}</>
  const short = lines.slice(0, 5).join('\n').slice(0, LIMIT).trimEnd() + '…'
  return (
    <>
      {open ? text : short}
      <button type="button" onClick={() => setOpen(o => !o)}
        className="ml-2 cursor-pointer whitespace-nowrap text-[13px] font-medium text-teal-300 hover:text-teal-200">
        {open ? 'Thu gọn' : 'Xem thêm'}
      </button>
    </>
  )
}

function ToolGroup({ evs }: { evs: AgencyEvent[] }) {
  const [open, setOpen] = useState(false)
  const errors = evs.filter(e => e.data.is_error).length
  const counts = new Map<string, number>()
  for (const e of evs) { const k = TOOL[e.data.tool] || e.data.tool; counts.set(k, (counts.get(k) || 0) + 1) }
  const parts = [...counts].map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ''}`).join(' · ')
  const Icon = open ? ChevronDown : ChevronRight
  return (
    <div className="pl-12">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] text-muted hover:bg-white/5 hover:text-slate-300">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <Wrench className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{evs.length} thao tác: {parts}</span>
        {errors > 0 && <span className="shrink-0 rounded bg-rose-400/10 px-1.5 text-rose-300">{errors} lỗi</span>}
      </button>
      {open && (
        <ul className="mt-1 space-y-1 border-l border-white/10 pl-3">
          {evs.map(e => (
            <li key={e.id} className={`break-words text-[13px] ${e.data.is_error ? 'text-rose-300' : 'text-muted'}`}>
              {TOOL[e.data.tool] || e.data.tool} · {e.data.summary}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Tải tin cũ khi cuộn lên (tab Hội thoại của dự án) */
export type OlderPaging = { hasMore: boolean; loading: boolean; loaded: boolean; load: () => void }
const NEAR_TOP = 200  // px: còn cách đầu bao nhiêu thì tải trước

export function Timeline({ events, roles, showTools = false, projectTitle, limit = 400, older }: {
  events: AgencyEvent[]; roles: Role[]; showTools?: boolean; projectTitle?: (id: string) => string
  limit?: number; older?: OlderPaging
}) {
  const ref = useRef<HTMLDivElement>(null)
  const box = useLightbox()
  const roleBy = (k?: string | null) => roles.find(r => r.key === k)
  const filtered = events.filter(e => SHOWN.has(e.type) && (showTools || e.type !== 'tool')).slice(-limit)
  const items = group(filtered)
  const firstId = filtered[0]?.id ?? 0
  const lastId = filtered[filtered.length - 1]?.id ?? 0

  // Mốc giữ chỗ đang đọc khi tin cũ chèn lên trên
  const anchor = useRef<{ height: number; top: number; firstId: number } | null>(null)
  const didInitialScroll = useRef(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !anchor.current || anchor.current.firstId === firstId) return
    el.scrollTop = anchor.current.top + (el.scrollHeight - anchor.current.height)
    anchor.current = null
  }, [firstId])
  // Tin mới nhất thay đổi (không phải nạp tin cũ) thì cuộn xuống cuối; lần đầu nhảy thẳng, sau đó cuộn mượt
  // (lịch sử dự án chưa tải xong thì chưa tính là lần đầu, để khi trang mới nhất về vẫn nhảy xuống cuối)
  const settled = !older || older.loaded
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !lastId) return
    if (!didInitialScroll.current) { el.scrollTop = el.scrollHeight; didInitialScroll.current = settled }
    else el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [lastId, settled])

  const maybeLoadOlder = () => {
    const el = ref.current
    if (!el || !older || !older.loaded || !older.hasMore || older.loading || anchor.current) return
    if (el.scrollTop > NEAR_TOP) return
    anchor.current = { height: el.scrollHeight, top: el.scrollTop, firstId }
    older.load()
  }
  // Tải xong mà không có tin cũ mới (lỗi mạng, hoặc chỉ toàn loại bị ẩn) thì bỏ mốc để lần sau thử lại
  useEffect(() => {
    if (older && !older.loading && anchor.current?.firstId === firstId) anchor.current = null
  }, [older?.loading])  // eslint-disable-line react-hooks/exhaustive-deps
  // Sau mỗi lần tải: khung chưa đủ dài để cuộn (trang toàn thao tác bị gộp) hoặc vẫn ở gần đầu thì tải tiếp
  useEffect(() => { maybeLoadOlder() })  // eslint-disable-line react-hooks/exhaustive-deps

  if (!items.length) {
    if (older && (!older.loaded || older.loading)) return <Empty>Đang tải hội thoại…</Empty>
    return <Empty>Chưa có trao đổi nào. Giao việc ở ô "Chỉ huy AI" bên dưới.</Empty>
  }
  return (
    <div ref={ref} onScroll={older ? maybeLoadOlder : undefined}
      className="flex max-h-[62vh] flex-col gap-2 overflow-y-auto pr-2 scroll-thin">
      {box.view}
      {older && (
        <div aria-live="polite" className="flex items-center justify-center gap-2 py-2 text-[13px] text-muted">
          {older.loading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Đang tải tin cũ hơn…</>
            : older.hasMore ? <span className="opacity-0">·</span>
            : <>Đầu cuộc hội thoại · {clock(filtered[0].created_at)} {new Date(filtered[0].created_at * 1000).toLocaleDateString('vi-VN')}</>}
        </div>
      )}
      {items.map(it => {
        if (it.kind === 'tools') return <ToolGroup key={`t${it.id}`} evs={it.evs} />
        if (it.kind === 'status') {
          const d = it.ev.data
          const failed = d.status === 'failed'
          return (
            <div key={it.ev.id} className="flex items-center gap-3 py-1 text-[13px] text-muted">
              <span className="h-px flex-1 bg-white/5" />
              <span className={failed ? 'text-rose-300' : ''}>{STATUS[d.status] || d.status}{d.error ? ` · ${d.error}` : ''} · {clock(it.ev.created_at)}</span>
              <span className="h-px flex-1 bg-white/5" />
            </div>
          )
        }
        const ev = it.ev
        const role = roleBy(ev.agent)
        const d = describe(ev, roleBy)
        const text = fillNames(d.text || '', roles)
        return (
          <div key={ev.id} className={`flex gap-3 ${it.head ? 'mt-2' : ''}`}>
            <div className="w-9 shrink-0">{it.head && <Avatar role={ev.agent === 'owner' ? undefined : role} size={36} />}</div>
            <div className="min-w-0 flex-1">
              {it.head && (
                <div className="mb-1 flex items-baseline gap-2 text-[13px] text-muted">
                  <span className="text-[15px] font-semibold text-slate-100">{ev.agent === 'owner' ? 'Sếp' : role?.name || 'Hệ thống'}</span>
                  {role && <span>{role.title}</span>}
                  <span>· {clock(ev.created_at)}</span>
                  {projectTitle && <span className="truncate">· {projectTitle(ev.project_id)}</span>}
                </div>
              )}
              <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-200">
                {d.badge && (
                  <span className={`mr-2 inline-flex items-center gap-1 rounded-md px-2 py-0.5 align-[1px] text-[12.5px] font-semibold ${d.badge.cls}`}>
                    {d.badge.label}{d.extra && <span className="font-normal tabular-nums opacity-90">· {d.extra}</span>}
                  </span>
                )}
                <LongText text={text} />
              </div>
              {Array.isArray(ev.data.images) && ev.data.images.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {(ev.data.images as string[]).map((n, i) => (
                    <button key={n} type="button" aria-label={`Xem lớn ảnh đính kèm ${i + 1}`}
                      onClick={() => box.open(attachmentUrl(ev.project_id, n), `Ảnh đính kèm ${i + 1}`)}
                      className="block h-24 w-24 cursor-zoom-in overflow-hidden rounded-lg border border-white/10 bg-ink-950 transition hover:border-teal-300/60">
                      <img src={attachmentUrl(ev.project_id, n)} alt={`Ảnh đính kèm ${i + 1}`} loading="lazy"
                        className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
