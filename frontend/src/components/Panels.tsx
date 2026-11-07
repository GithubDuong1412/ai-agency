import { fillNames } from '../names'
import { ArrowLeftRight, ArrowRight, Check, ChevronUp, CircleAlert, PenLine, RefreshCw, RotateCcw, SendHorizontal, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { api, timeAgo, type AgencyEvent, type Config, type Overview, type Project, type Report, type Role } from '../api'
import type { AgentLive } from '../store'
import { AttachButton, AttachThumbs, useAttachments } from './Attach'
import { Avatar, Empty, StatusPill } from './common'

/** Thẻ một báo cáo chờ duyệt: cả thẻ bấm được, kết luận có chữ + ký hiệu (không chỉ dựa vào màu). */
export function PendingCard({ r, onOpen }: { r: Report; onOpen: () => void }) {
  const ok = r.content.verdict === 'approve'
  return (
    <button onClick={onOpen}
      className="group flex w-full cursor-pointer flex-col rounded-xl border border-white/5 bg-ink-850 p-3 text-left transition hover:-translate-y-px hover:border-teal-400/40">
      <div className="truncate text-[11px] font-medium text-teal-200" title={r.project_title}>{r.project_title}</div>
      <div className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug text-slate-100" title={r.content.headline}>{r.content.headline}</div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className={`rounded-md px-1.5 py-0.5 ${ok ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'}`}>
          <span className="inline-flex items-center gap-1">{ok ? <Check className="h-3 w-3" aria-hidden="true" /> : <CircleAlert className="h-3 w-3" aria-hidden="true" />}{ok ? 'Đạt' : 'Còn vấn đề'} · {r.content.score}/10</span>
        </span>
        <span className="text-muted">Lần {r.run_no} · {timeAgo(r.created_at)}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-teal-300">Xem & duyệt<ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" aria-hidden="true" /></span>
      </div>
    </button>
  )
}

export function ApprovalPanel({ overview, config, live, onOpenProject, className = '' }: {
  overview: Overview | null; config: Config | null; live: Record<string, AgentLive>
  onOpenProject: (id: string) => void; className?: string
}) {
  const [tab, setTab] = useState<'pending' | 'staff'>('pending')
  const pending = overview?.pending_reports || []
  const roles = config?.roles || []
  return (
    <aside className={`panel flex w-full flex-col xl:w-80 xl:shrink-0 ${className}`}>
      <div className="p-4 pb-2">
        <div className="label">Trung tâm điều hành</div>
        <div className="text-base font-semibold">Chờ anh duyệt</div>
      </div>
      <div className="flex gap-4 border-b border-white/5 px-4 text-xs">
        {([['pending', `Chờ duyệt ${pending.length}`], ['staff', `Nhân sự ${roles.length}`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`border-b-2 pb-2 ${tab === k ? 'border-teal-400 text-white' : 'border-transparent text-muted'}`}>{l}</button>
        ))}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4 scroll-thin">
        {tab === 'pending' && (pending.length ? pending.map(r => (
          <PendingCard key={r.id} r={r} onOpen={() => onOpenProject(r.project_id)} />
        )) : <Empty>Không có gì chờ duyệt.</Empty>)}
        {tab === 'staff' && roles.map(r => {
          const a = live[r.key]
          return (
            <div key={r.key} className="flex items-center gap-3 rounded-xl bg-ink-850 p-2.5">
              <Avatar role={r} size={32} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.name}</div>
                <div className="truncate text-xs text-slate-400">{r.title}</div>
              </div>
              <StatusPill status={a?.status === 'working' ? 'in_progress' : 'todo'} />
            </div>
          )
        })}
      </div>
    </aside>
  )
}

export function CommandBar({ onCreated, disabled, className = '' }: {
  onCreated: (id: string) => void; disabled?: boolean; className?: string
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Điện thoại: thu gọn thành một nút để không chiếm 1/4 màn hình; desktop luôn mở
  const [open, setOpen] = useState(false)
  const att = useAttachments()
  const submit = async () => {
    if (!text.trim() || busy) return
    setBusy(true); setErr(null)
    try {
      const p = await api.create(text.trim(), att.images)
      setText('')
      att.clear()
      onCreated(p.id)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (<>
    {!open && (
      <button onClick={() => setOpen(true)} aria-expanded={false}
        className={`panel flex min-h-11 w-full cursor-pointer items-center gap-2 px-4 text-left text-sm text-slate-200 hover:bg-ink-800 sm:hidden ${className}`}>
        <Sparkles className="h-4 w-4 text-teal-300" aria-hidden="true" /> Giao lệnh mới cho Trưởng dự án
        <ChevronUp className="ml-auto h-4 w-4 text-teal-300" aria-hidden="true" />
      </button>
    )}
    <div className={`panel p-3 ${open ? '' : 'max-sm:hidden'} ${className}`}>
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-teal-400/15"><Sparkles className="h-3.5 w-3.5 text-teal-300" aria-hidden="true" /></span>
        <label htmlFor="command-input" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">Chỉ huy AI · giao lệnh cho Trưởng dự án</label>
        <span className="ml-auto text-[11px] text-muted max-sm:hidden">Ctrl + Enter để gửi · dán/kéo ảnh vào ô · mỗi lệnh tạo một dự án mới</span>
        {open && <button onClick={() => setOpen(false)} className="ml-auto cursor-pointer px-2 py-1 text-xs text-slate-400 hover:text-white sm:hidden">Thu gọn</button>}
      </div>
      <AttachThumbs a={att} disabled={busy} />
      {/* ô nhập nổi khối: nền sâu hơn panel, viền teal nhạt, sáng lên khi focus; nút gửi cao bằng ô nhập */}
      <div {...att.dropProps} className={`flex items-stretch gap-2 rounded-xl border bg-ink-950/80 p-1.5 shadow-inner shadow-black/40 transition focus-within:border-teal-300/60 focus-within:ring-2 focus-within:ring-teal-400/20 ${att.dragging ? 'border-teal-300 ring-2 ring-teal-400/30' : 'border-teal-400/25'}`}>
        <textarea id="command-input" value={text} onChange={e => setText(e.target.value)} rows={2} autoFocus={open}
          onPaste={att.onPaste}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit() }}
          placeholder='Ví dụ: "Làm website Laravel cho tiệm bánh mì: trang chủ, menu, form đặt bàn lưu vào DB"'
          className="min-w-0 flex-1 resize-none bg-transparent px-2.5 py-2 text-[15px] leading-relaxed text-slate-100 outline-none placeholder:text-muted" />
        <AttachButton a={att} disabled={busy} />
        <button type="button" onClick={submit} disabled={disabled || busy || !text.trim()} aria-label="Gửi lệnh"
          className="flex shrink-0 cursor-pointer items-center justify-center gap-2 self-stretch rounded-lg bg-teal-400 px-5 text-sm font-semibold text-ink-950 transition hover:bg-teal-300 active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-teal-400/20 disabled:text-teal-100/50">
          <SendHorizontal className="h-4 w-4" aria-hidden="true" /><span className="max-sm:hidden">{busy ? 'Đang gửi…' : 'Giao lệnh'}</span>
        </button>
      </div>
      {err && <div className="mt-1.5 px-1 text-xs text-rose-300">{err}</div>}
    </div>
  </>)
}

// Nút trong ô nhập của thanh đáy: cao bằng ô nhập, nhấn lún nhẹ, mờ khi chưa dùng được
const BAR_BTN = 'flex shrink-0 cursor-pointer items-center justify-center gap-2 self-stretch rounded-lg px-4 text-sm font-semibold transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40'

/** Thanh đáy khi đang mở một dự án: Sếp duyệt / yêu cầu sửa / chỉnh sửa thêm cho CHÍNH dự án đó. */
export function ProjectCommandBar({ project, report, onDone, className = '' }: {
  project: Project; report?: Report; onDone: () => void; className?: string
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const att = useAttachments()

  const running = project.running
  const pending = report?.status === 'pending'
  const halted = ['failed', 'stopped', 'interrupted'].includes(project.status)
  const fb = text.trim()

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (busy) return
    setBusy(true); setMsg(null)
    try { await fn(); setText(''); att.clear(); setMsg({ ok: true, text: ok }); onDone() }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }) }
    finally { setBusy(false) }
  }
  const imgs = att.images
  const revise = () => fb && run(() => api.revise(project.id, fb, imgs), 'Đã gửi yêu cầu, đội đang làm vòng mới.')
  const resume = () => run(() => api.resume(project.id, fb, imgs), 'Đã chạy lại dự án.')
  const approve = () => run(() => api.approve(project.id, fb, imgs), 'Đã duyệt dự án.')
  // Ctrl+Enter: hành động chính theo trạng thái
  const primary = halted ? resume : revise

  const placeholder = running ? 'Đội đang làm việc… Bấm "Dừng" ở trên nếu muốn đổi hướng.'
    : pending ? 'Góp ý cần sửa (bắt buộc khi Yêu cầu sửa; tuỳ chọn khi Duyệt)…'
    : halted ? 'Ghi chú thêm cho lần chạy lại (tuỳ chọn)…'
    : 'Muốn chỉnh sửa gì thêm? Ví dụ: "Đổi màu nút Đặt bàn sang đỏ, thêm Google Map ở trang chủ"'

  return (
    <div className={`panel p-3 ${className}`}>
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-amber-400/15"><PenLine className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" /></span>
        <label htmlFor="project-feedback" className="min-w-0 truncate text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">
          Góp ý cho dự án “{project.title}”
        </label>
        <span className="ml-auto shrink-0 text-[11px] text-muted max-md:hidden">
          {running ? 'Thanh này mở lại khi đội làm xong' : 'Ctrl + Enter để gửi · dán/kéo ảnh vào ô · đội sửa trên code hiện tại'}
        </span>
      </div>
      <AttachThumbs a={att} disabled={busy || running} />
      {/* cùng kiểu với thanh giao lệnh: ô nhập nổi khối, các nút cao bằng ô nhập */}
      <div {...(running ? {} : att.dropProps)}
        className={`flex items-stretch gap-2 rounded-xl border bg-ink-950/80 p-1.5 shadow-inner shadow-black/40 transition focus-within:ring-2 ${att.dragging
        ? 'border-teal-300 ring-2 ring-teal-400/30'
        : pending
        ? 'border-amber-300/30 focus-within:border-amber-200/60 focus-within:ring-amber-300/20'
        : 'border-teal-400/25 focus-within:border-teal-300/60 focus-within:ring-teal-400/20'} ${running ? 'opacity-60' : ''}`}>
        <textarea id="project-feedback" value={text} onChange={e => setText(e.target.value)} rows={2} disabled={running || busy}
          onPaste={att.onPaste}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) primary() }}
          placeholder={placeholder}
          className="min-w-0 flex-1 resize-none bg-transparent px-2.5 py-2 text-[15px] leading-relaxed text-slate-100 outline-none placeholder:text-muted disabled:cursor-not-allowed" />
        {!running && <AttachButton a={att} disabled={busy} />}
        {!running && (pending ? <>
          <button type="button" onClick={approve} disabled={busy} className={`${BAR_BTN} bg-teal-400 text-ink-950 hover:bg-teal-300`}>
            <Check className="h-4 w-4" aria-hidden="true" /><span className="max-sm:hidden">Duyệt</span>
          </button>
          <button type="button" onClick={revise} disabled={busy || !fb} title={fb ? undefined : 'Nhập góp ý trước khi yêu cầu sửa'}
            className={`${BAR_BTN} bg-rose-500/15 text-rose-200 ring-1 ring-inset ring-rose-400/40 hover:bg-rose-500/25`}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" /><span className="max-sm:hidden">Yêu cầu sửa</span>
          </button>
        </> : halted ? (
          <button type="button" onClick={resume} disabled={busy} className={`${BAR_BTN} bg-teal-400 text-ink-950 hover:bg-teal-300`}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /><span className="max-sm:hidden">Chạy lại</span>
          </button>
        ) : (
          <button type="button" onClick={revise} disabled={busy || !fb} className={`${BAR_BTN} bg-teal-400 text-ink-950 hover:bg-teal-300`}>
            <SendHorizontal className="h-4 w-4" aria-hidden="true" /><span className="max-sm:hidden">{busy ? 'Đang gửi…' : 'Gửi yêu cầu'}</span>
          </button>
        ))}
      </div>
      {msg && <div role="status" className={`mt-1.5 px-1 text-xs ${msg.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{msg.text}</div>}
    </div>
  )
}

export function HandoffTicker({ events, roles, className = '' }: {
  events: AgencyEvent[]; roles: Role[]; className?: string
}) {
  const items = events.filter(e => e.type === 'handoff').slice(-12)
  const roleBy = (k?: string | null) => roles.find(r => r.key === k)
  if (!items.length) return null
  const line = items.map(e => `${roleBy(e.agent)?.name} → ${roleBy(e.data.to)?.name}: ${fillNames(String(e.data.note ?? ''), roles)}`).join('   •   ')
  return (
    <div className={`panel flex items-center gap-3 overflow-hidden px-4 py-2 text-[11px] text-slate-400 ${className}`}>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-teal-300"><ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />Bàn giao</span>
      <div className="relative flex-1 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_6%,#000_94%,transparent)]">
        <div className="animate-ticker whitespace-nowrap">{line}   •   {line}</div>
      </div>
    </div>
  )
}
