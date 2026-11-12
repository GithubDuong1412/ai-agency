import { AlertTriangle, BookOpen, Check, ExternalLink, FileText, Globe, Pencil, RotateCcw, Search, Send, Sparkles, UserMinus, UserPlus, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { hiringApi, rolesApi, timeAgo, type AgencyEvent, type Candidate, type Config, type HiringRequest, type Role, type StagedSkill } from '../api'
import { Avatar, Button, Empty } from './common'

const INP = 'w-full rounded-lg border border-white/10 bg-ink-950 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-teal-400'
const STATUS: Record<HiringRequest['status'], { label: string; cls: string }> = {
  drafting: { label: 'Đang soạn', cls: 'bg-sky-400/10 text-sky-200' },
  pending: { label: 'Chờ duyệt', cls: 'bg-amber-400/10 text-amber-200' },
  approved: { label: 'Đã tuyển', cls: 'bg-emerald-400/10 text-emerald-200' },
  rejected: { label: 'Đã từ chối', cls: 'bg-white/5 text-slate-400' },
  failed: { label: 'Lỗi', cls: 'bg-rose-500/10 text-rose-200' },
}
const DEFAULT_PERMS = [
  { key: 'write', label: 'Ghi / sửa file dự án' }, { key: 'run', label: 'Chạy lệnh' },
  { key: 'screenshot', label: 'Chụp màn hình trang web' }, { key: 'message', label: 'Nhắn tin cho đồng đội' },
]

type Props = {
  config: Config | null; events: AgencyEvent[]; projectTitle: (id: string) => string
  onOpenProject: (id: string) => void; onOpenProfile: (key: string) => void
}

/** Trang Tuyển dụng: Sếp nêu nhu cầu → Trưởng dự án soạn đề xuất → Sếp sửa / duyệt; quản lý nhân sự tuyển thêm. */
export function Hiring({ config, events, projectTitle, onOpenProject, onOpenProfile }: Props) {
  const [requests, setRequests] = useState<HiringRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // tải lại khi có sự kiện tuyển dụng / đổi nhân sự mới
  const stamp = useMemo(() => events.filter(e => e.type === 'hiring_update' || e.type === 'roster_changed').at(-1)?.id ?? 0, [events])
  useEffect(() => {
    hiringApi.list().then(r => { setRequests(r.requests); setError(null) }).catch(e => setError(String(e.message || e)))
  }, [stamp])
  const reload = () => hiringApi.list().then(r => setRequests(r.requests)).catch(() => {})

  const open = (requests || []).filter(r => r.status === 'drafting' || r.status === 'pending' || r.status === 'failed')
  const done = (requests || []).filter(r => r.status === 'approved' || r.status === 'rejected')
  const hired = (config?.roles || []).filter(r => r.hired)

  return (
    <div className="flex flex-col gap-4">
      <RequestBox onSent={reload} />
      {error && <div className="rounded-xl bg-rose-500/10 p-3 text-xs text-rose-200">{error}</div>}

      <section className="panel p-4" aria-labelledby="hire-open-h">
        <div className="mb-3 flex items-baseline gap-2">
          <h2 id="hire-open-h" className="text-base font-semibold">Đề xuất tuyển dụng</h2>
          <span className="text-xs text-muted">{open.length} đề xuất đang mở</span>
        </div>
        {requests === null ? <Empty>Đang tải…</Empty> : open.length ? (
          <div className="flex flex-col gap-4">
            {open.map(r => <RequestCard key={r.id} r={r} config={config} projectTitle={projectTitle} events={events}
              onOpenProject={onOpenProject} onChanged={reload} />)}
          </div>
        ) : <Empty>Chưa có đề xuất nào. Nêu nhu cầu ở trên, hoặc Trưởng dự án sẽ tự đề xuất khi dự án thiếu người.</Empty>}
      </section>

      <section className="panel p-4" aria-labelledby="hire-staff-h">
        <div className="mb-3 flex items-baseline gap-2">
          <h2 id="hire-staff-h" className="text-base font-semibold">Nhân sự tuyển thêm</h2>
          <span className="text-xs text-muted">{hired.length} người</span>
        </div>
        {hired.length ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {hired.map(r => <HiredCard key={r.key} role={r} config={config} onOpenProfile={() => onOpenProfile(r.key)} />)}
          </div>
        ) : <Empty>Chưa tuyển thêm ai. 6 thành viên gốc không thể cho nghỉ.</Empty>}
      </section>

      {done.length > 0 && (
        <details className="panel p-4">
          <summary className="cursor-pointer text-sm font-semibold">Lịch sử đề xuất <span className="text-xs font-normal text-muted">({done.length})</span></summary>
          <ul className="mt-3 flex flex-col gap-2">
            {done.map(r => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-ink-850 p-2.5 text-xs">
                <span className={`rounded-md px-2 py-0.5 ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                <span className="min-w-0 flex-1 truncate text-slate-300" title={r.request}>{r.request}</span>
                {r.hired?.length ? <span className="text-emerald-300">{r.hired.join(', ')}</span> : null}
                <span className="text-muted">{timeAgo(r.updated_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function RequestBox({ onSent }: { onSent: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const send = async () => {
    if (!text.trim()) return
    setBusy(true); setErr(null)
    try { await hiringApi.request(text.trim()); setText(''); onSent() } catch (e) { setErr(String((e as Error).message)) }
    setBusy(false)
  }
  return (
    <section className="panel p-4" aria-labelledby="hire-req-h">
      <h2 id="hire-req-h" className="mb-1 text-base font-semibold">Cần tuyển người làm gì?</h2>
      <p className="mb-3 text-xs text-muted">Trưởng dự án tìm và đọc tài liệu chuẩn nghề trên Internet, rồi soạn hồ sơ ứng viên (tên, chức vụ, quyền, cách làm việc, rules, checklist, kiến thức, skill) để anh duyệt hoặc sửa trước khi tạo.</p>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={3} className={INP}
        placeholder="Vd: Cần 1 người viết nội dung chuẩn SEO cho các trang web và blog của khách."
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send() }} />
      <div className="mt-2 flex items-center gap-3">
        <Button variant="primary" onClick={send} disabled={busy || !text.trim()}><Send className="h-3.5 w-3.5" aria-hidden="true" />Nhờ Trưởng dự án đề xuất</Button>
        <span className="text-[11px] text-muted max-sm:hidden">Ctrl + Enter để gửi</span>
        {err && <span className="text-xs text-rose-300">{err}</span>}
      </div>
    </section>
  )
}

type Draft = Candidate & { include: boolean; keep: boolean[]; proposedExisting: string[] }

/** Trạng thái form ban đầu: giữ mọi tài liệu; cài skill tự soạn và skill tải về không có script (có script: Sếp tự bật). */
function toDraft(c: Candidate): Draft {
  const staged = c.staged_skills || []
  return {
    ...c, include: true, keep: (c.knowledge || []).map(() => true),
    install_skills: staged.filter(s => s.ok && (s.kind === 'authored' || !s.scripts.length)).map(s => s.name),
    existing_skills: c.existing_skills || [], proposedExisting: c.existing_skills || [],
  }
}

function fromDraft({ include: _i, keep, proposedExisting: _p, ...c }: Draft): Candidate {
  return { ...c, knowledge: (c.knowledge || []).filter((_, i) => keep[i]) }
}

function RequestCard({ r, config, projectTitle, events, onOpenProject, onChanged }: {
  r: HiringRequest; config: Config | null; projectTitle: (id: string) => string; events: AgencyEvent[]
  onOpenProject: (id: string) => void; onChanged: () => void
}) {
  const [cands, setCands] = useState<Draft[]>([])
  useEffect(() => { setCands((r.proposal?.candidates || []).map(toDraft)) }, [r.proposal])
  const [feedback, setFeedback] = useState('')
  const [askRevise, setAskRevise] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null)
    try { await fn(); onChanged() } catch (e) { setErr(String((e as Error).message)) }
    setBusy(false)
  }
  const chosen = cands.filter(c => c.include)
  const st = STATUS[r.status]

  return (
    <article className="rounded-xl border border-white/5 bg-ink-850 p-3">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`rounded-md px-2 py-0.5 text-[11px] ${st.cls}`}>{st.label}</span>
        {r.source_project && (
          <button onClick={() => onOpenProject(r.source_project!)} className="truncate text-[11px] text-teal-300 hover:underline">
            Từ dự án: {projectTitle(r.source_project) || r.source_project}
          </button>
        )}
        <span className="ml-auto text-[11px] text-muted">{timeAgo(r.updated_at)}{r.cost_usd ? ` · ~$${r.cost_usd.toFixed(3)}` : ''}</span>
      </header>
      <p className="mb-2 whitespace-pre-wrap text-xs text-slate-300"><span className="text-muted">Yêu cầu: </span>{r.request}</p>
      {r.feedback && r.status === 'drafting' && <p className="mb-2 text-xs text-slate-400"><span className="text-muted">Góp ý soạn lại: </span>{r.feedback}</p>}

      {r.status === 'drafting' && <ResearchProgress r={r} events={events} />}

      {r.status === 'failed' && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-rose-500/10 p-2.5 text-xs text-rose-200">
          <span className="flex-1">{r.error || 'Soạn đề xuất bị lỗi.'}</span>
          <Button onClick={() => act(() => hiringApi.revise(r.id, 'Soạn lại đề xuất.'))} disabled={busy}><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Soạn lại</Button>
        </div>
      )}

      {r.status === 'pending' && (
        <>
          {r.proposal?.summary && <div className="mb-3 rounded-xl border border-teal-400/20 bg-teal-400/5 p-3 text-xs text-teal-100">{r.proposal.summary}</div>}
          <div className="flex flex-col gap-3">
            {cands.map((c, i) => (
              <CandidateForm key={i} c={c} hid={r.id} config={config}
                onChange={patch => setCands(prev => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)))} />
            ))}
          </div>
          {askRevise && (
            <div className="mt-3">
              <label className="label mb-1 block" htmlFor={`fb-${r.id}`}>Góp ý để Trưởng dự án soạn lại</label>
              <textarea id={`fb-${r.id}`} value={feedback} onChange={e => setFeedback(e.target.value)} rows={2} className={INP}
                placeholder="Vd: Chỉ cần 1 người, không cần quyền chạy lệnh; rules thêm phần giọng văn thân thiện." />
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={busy || !chosen.length}
              onClick={() => act(() => hiringApi.approve(r.id, chosen.map(fromDraft)))}>
              <Check className="h-3.5 w-3.5" aria-hidden="true" />Duyệt tuyển {chosen.length > 1 ? `${chosen.length} người` : ''}
            </Button>
            {askRevise
              ? <Button disabled={busy || !feedback.trim()} onClick={() => act(() => hiringApi.revise(r.id, feedback.trim()))}><Send className="h-3.5 w-3.5" aria-hidden="true" />Gửi góp ý</Button>
              : <Button disabled={busy} onClick={() => setAskRevise(true)}><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Yêu cầu soạn lại</Button>}
            <Button variant="danger" disabled={busy} onClick={() => act(() => hiringApi.reject(r.id))}><X className="h-3.5 w-3.5" aria-hidden="true" />Từ chối</Button>
            {err && <span className="text-xs text-rose-300">{err}</span>}
          </div>
        </>
      )}
    </article>
  )
}

/** Một ô nhập có nhãn. */
function Field({ label, id, children, className = '' }: { label: string; id: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label mb-1 block" htmlFor={id}>{label}</label>
      {children}
    </div>
  )
}

type Editable = Pick<Candidate, 'name' | 'title' | 'department' | 'color' | 'model' | 'effort' | 'permissions' | 'working_style'>

/** Thông tin chung của một nhân sự: tên, chức vụ, phòng ban, màu, model, quyền, cách làm việc. */
function ProfileFields({ v, config, idp, onChange }: {
  v: Editable; config: Config | null; idp: string; onChange: (patch: Partial<Editable>) => void
}) {
  const deps = [...new Set((config?.roles || []).map(r => r.department))]
  const models = config?.models?.length ? config.models : [v.model]
  const efforts = config?.efforts?.length ? config.efforts : ['low', 'medium', 'high']
  const perms = config?.permission_groups?.length ? config.permission_groups : DEFAULT_PERMS
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      <Field label="Tên" id={`${idp}-name`}><input id={`${idp}-name`} className={INP} value={v.name} onChange={e => onChange({ name: e.target.value })} /></Field>
      <Field label="Chức vụ" id={`${idp}-title`}><input id={`${idp}-title`} className={INP} value={v.title} onChange={e => onChange({ title: e.target.value })} /></Field>
      <Field label="Phòng ban (gõ tên mới để lập phòng mới)" id={`${idp}-dep`}>
        <input id={`${idp}-dep`} className={INP} list={`${idp}-deps`} value={v.department} onChange={e => onChange({ department: e.target.value })} />
        <datalist id={`${idp}-deps`}>{deps.map(d => <option key={d} value={d} />)}</datalist>
      </Field>
      <div className="grid grid-cols-[auto_1fr_1fr] gap-2">
        <Field label="Màu" id={`${idp}-color`}>
          <input id={`${idp}-color`} type="color" value={v.color} onChange={e => onChange({ color: e.target.value })}
            className="h-[30px] w-10 cursor-pointer rounded-lg border border-white/10 bg-ink-950 p-0.5" />
        </Field>
        <Field label="Model" id={`${idp}-model`}>
          <select id={`${idp}-model`} className={INP} value={v.model} onChange={e => onChange({ model: e.target.value })}>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Effort" id={`${idp}-effort`}>
          <select id={`${idp}-effort`} className={INP} value={v.effort} onChange={e => onChange({ effort: e.target.value })}>
            {efforts.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="label mb-1">Quyền <span className="normal-case tracking-normal text-muted">· đọc file dự án luôn có; cần “Ghi / sửa file” để được giao task</span></legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {perms.map(p => (
            <label key={p.key} className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-200">
              <input type="checkbox" className="accent-teal-400" checked={v.permissions.includes(p.key)}
                onChange={e => onChange({ permissions: e.target.checked ? [...v.permissions, p.key] : v.permissions.filter(x => x !== p.key) })} />
              {p.label}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Cách làm việc" id={`${idp}-ws`} className="sm:col-span-2">
        <textarea id={`${idp}-ws`} rows={4} className={INP} value={v.working_style} onChange={e => onChange({ working_style: e.target.value })} />
      </Field>
    </div>
  )
}

/** Khi PM đang soạn: hiện các lượt tìm / đọc web gần nhất của đề xuất này. */
function ResearchProgress({ r, events }: { r: HiringRequest; events: AgencyEvent[] }) {
  const steps = useMemo(() => events.filter(e => e.type === 'tool' && e.data?.hiring_id === r.id
    && e.created_at >= r.updated_at - 1), [events, r.id, r.updated_at])
  const searches = steps.filter(e => e.data.tool === 'web_search').length
  const reads = steps.filter(e => e.data.tool === 'web_fetch').length
  const refs = new Set(steps.filter(e => e.data.tool === 'read_reference').map(e => e.data.summary)).size
  return (
    <div className="py-2 text-xs">
      <div className="flex items-center gap-2 text-sky-200">
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-sky-300" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-sky-300 [animation-delay:.15s]" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-sky-300 [animation-delay:.3s]" />
        {steps.length ? 'Trưởng dự án đang nghiên cứu và soạn hồ sơ ứng viên…' : 'Trưởng dự án đang soạn hồ sơ ứng viên…'}
        {steps.length > 0 && <span className="ml-auto text-muted">{refs} mẫu đã đọc · {searches} lượt tìm · {reads} trang web</span>}
      </div>
      {steps.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {steps.slice(-5).map(e => {
            const t = e.data.tool
            const Icon = t === 'read_reference' ? BookOpen : t === 'web_fetch' ? Globe : Search
            const label = t === 'read_reference' ? 'Đọc mẫu' : t === 'web_fetch' ? 'Đọc web' : t === 'web_search' ? 'Tìm' : t
            return (
              <li key={e.id} className="flex min-w-0 items-center gap-2 text-slate-400">
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                <span className="shrink-0 text-muted">{label}</span>
                <span className="truncate" title={e.data.summary}>{e.data.summary}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Khối thu gọn được trong thẻ ứng viên. */
function Block({ icon: Icon, title, meta, children, open = false }: {
  icon: typeof BookOpen; title: string; meta?: ReactNode; children: ReactNode; open?: boolean
}) {
  return (
    <details open={open} className="group rounded-lg border border-white/5 bg-ink-950/40">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-200 [&::-webkit-details-marker]:hidden">
        <Icon className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
        {title}
        {meta && <span className="font-normal text-muted">{meta}</span>}
        <span className="ml-auto text-[10px] font-normal text-muted group-open:hidden">Mở</span>
        <span className="ml-auto hidden text-[10px] font-normal text-muted group-open:inline">Thu gọn</span>
      </summary>
      <div className="border-t border-white/5 p-3">{children}</div>
    </details>
  )
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

function SourcesBlock({ sources }: { sources: NonNullable<Candidate['sources']> }) {
  if (!sources.length) return null
  return (
    <Block icon={Globe} title="Nguồn tham khảo (mẫu + web)" meta={`${sources.length} nguồn PM đã đọc`}>
      <ul className="flex flex-col gap-1.5">
        {sources.map((s, i) => (
          <li key={i} className="text-xs">
            <a href={s.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-teal-300 hover:underline">
              {s.title || s.url}<ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
            {s.note && <span className="text-slate-400"> · {s.note}</span>}
          </li>
        ))}
      </ul>
    </Block>
  )
}

function KnowledgeBlock({ c, idp, onChange }: { c: Draft; idp: string; onChange: (patch: Partial<Draft>) => void }) {
  const docs = c.knowledge || []
  if (!docs.length) return null
  const kept = c.keep.filter(Boolean).length
  return (
    <Block icon={BookOpen} title="Kiến thức chuyên môn" meta={`${kept}/${docs.length} tài liệu · lưu vào knowledge/, người mới tự tra khi cần`}>
      <div className="flex flex-col gap-2">
        {docs.map((d, i) => (
          <details key={d.slug} className="rounded-lg bg-ink-900 p-2">
            <summary className="flex cursor-pointer items-center gap-2 text-xs">
              <input type="checkbox" className="accent-teal-400" checked={c.keep[i]} aria-label={`Giữ tài liệu ${d.title}`}
                onClick={e => e.stopPropagation()}
                onChange={e => onChange({ keep: c.keep.map((k, j) => (j === i ? e.target.checked : k)) })} />
              <span className="font-medium text-slate-200">{d.title}</span>
              <code className="text-[10px] text-muted">knowledge/{d.slug}.md</code>
              <span className="ml-auto text-[10px] text-muted">{d.content_markdown.length.toLocaleString('vi-VN')} ký tự</span>
            </summary>
            <textarea aria-label={`Nội dung ${d.title}`} id={`${idp}-kn-${i}`} rows={10} className={`${INP} mt-2 font-mono`} value={d.content_markdown}
              onChange={e => onChange({ knowledge: docs.map((x, j) => (j === i ? { ...x, content_markdown: e.target.value } : x)) })} />
          </details>
        ))}
      </div>
    </Block>
  )
}

function SkillPreview({ hid, name }: { hid: string; name: string }) {
  const [text, setText] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const toggle = () => {
    setOpen(o => !o)
    if (text === null) hiringApi.skillFile(hid, name).then(r => setText(r.content)).catch(e => setErr(String(e.message || e)))
  }
  return (
    <>
      <button type="button" onClick={toggle} className="text-[11px] text-teal-300 hover:underline">{open ? 'Ẩn SKILL.md' : 'Xem SKILL.md'}</button>
      {open && (
        <pre className="mt-2 max-h-72 w-full overflow-auto whitespace-pre-wrap rounded-lg bg-ink-950 p-2.5 text-[11px] text-slate-300 scroll-thin">
          {err || text || 'Đang tải…'}
        </pre>
      )}
    </>
  )
}

function SkillsBlock({ c, hid, idp, onChange }: { c: Draft; hid: string; idp: string; onChange: (patch: Partial<Draft>) => void }) {
  const staged = c.staged_skills || []
  const existing = c.existing_skills || []
  const proposedExisting = c.proposedExisting
  const install = c.install_skills || []
  const authored = staged.find(s => s.kind === 'authored')
  const github = staged.filter(s => s.kind === 'github')
  if (!staged.length && !proposedExisting.length) return null
  const toggle = (name: string, on: boolean) => onChange({ install_skills: on ? [...install, name] : install.filter(n => n !== name) })
  const count = install.length + existing.length
  return (
    <Block icon={Sparkles} title="Skill" meta={`${count} skill sẽ gắn cho người này`}>
      <div className="flex flex-col gap-2.5">
        {authored && c.skill && (
          <div className="rounded-lg bg-ink-900 p-2.5">
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input type="checkbox" className="accent-teal-400" checked={install.includes(authored.name)} onChange={e => toggle(authored.name, e.target.checked)} />
              <span className="font-medium text-slate-200">{authored.name}</span>
              <span className="rounded-md bg-teal-400/10 px-1.5 py-0.5 text-[10px] text-teal-200">PM tự soạn · chỉ tài liệu</span>
            </label>
            {install.includes(authored.name) && (
              <div className="mt-2 grid gap-2">
                <Field label="Mô tả (khi nào dùng)" id={`${idp}-sk-desc`}>
                  <input id={`${idp}-sk-desc`} className={INP} value={c.skill.description}
                    onChange={e => onChange({ skill: { ...c.skill!, description: e.target.value } })} />
                </Field>
                <Field label="Nội dung SKILL.md" id={`${idp}-sk-body`}>
                  <textarea id={`${idp}-sk-body`} rows={8} className={`${INP} font-mono`} value={c.skill.content_markdown}
                    onChange={e => onChange({ skill: { ...c.skill!, content_markdown: e.target.value } })} />
                </Field>
              </div>
            )}
          </div>
        )}
        {github.map(s => <GithubSkill key={s.name + (s.url || '')} s={s} hid={hid} on={install.includes(s.name)} onToggle={on => toggle(s.name, on)} />)}
        {proposedExisting.length > 0 && (
          <div className="rounded-lg bg-ink-900 p-2.5">
            <div className="mb-1.5 text-[11px] text-muted">Skill đã có trên máy, PM đề xuất gắn thêm:</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {proposedExisting.map(n => (
                <label key={n} className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-200">
                  <input type="checkbox" className="accent-teal-400" checked={existing.includes(n)}
                    onChange={e => onChange({ existing_skills: e.target.checked ? [...existing, n] : existing.filter(x => x !== n) })} />
                  {n}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </Block>
  )
}

function GithubSkill({ s, hid, on, onToggle }: { s: StagedSkill; hid: string; on: boolean; onToggle: (on: boolean) => void }) {
  return (
    <div className="rounded-lg bg-ink-900 p-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" className="accent-teal-400" disabled={!s.ok} checked={on} onChange={e => onToggle(e.target.checked)} />
          <span className="font-medium text-slate-200">{s.name}</span>
        </label>
        <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300">Tải từ GitHub</span>
        {s.ok && <span className="text-[10px] text-muted">{s.files} file · {kb(s.size)}</span>}
        {s.url && (
          <a href={s.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 truncate text-[11px] text-teal-300 hover:underline">
            Nguồn<ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        )}
      </div>
      {s.description && <p className="mt-1 text-slate-400">{s.description}</p>}
      {s.reason && <p className="mt-0.5 text-slate-500">PM: {s.reason}</p>}
      {!s.ok && <p className="mt-1 text-rose-300">Không tải được: {s.error}</p>}
      {s.ok && s.scripts.length > 0 && (
        <div className="mt-1.5 flex gap-1.5 rounded-md bg-amber-400/10 p-2 text-amber-100">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <div>
            Có {s.scripts.length} script sẽ chạy trên máy khi agent dùng skill. Chỉ bật khi anh tin nguồn này.
            <div className="mt-0.5 font-mono text-[10px] text-amber-200/80">{s.scripts.slice(0, 8).join(', ')}{s.scripts.length > 8 ? ', …' : ''}</div>
          </div>
        </div>
      )}
      {s.ok && <div className="mt-1.5"><SkillPreview hid={hid} name={s.name} /></div>}
    </div>
  )
}

function CandidateForm({ c, hid, config, onChange }: {
  c: Draft; hid: string; config: Config | null; onChange: (patch: Partial<Draft>) => void
}) {
  const idp = `cand-${c.key}`
  return (
    <div className={`rounded-xl border p-3 transition ${c.include ? 'border-white/10 bg-ink-900' : 'border-white/5 bg-ink-900/40 opacity-60'}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <Avatar role={{ key: c.key, name: c.name || '?', title: c.title, department: c.department, color: c.color, model: c.model, effort: c.effort }} size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{c.name || 'Chưa đặt tên'} <span className="font-normal text-slate-400">· {c.title}</span></div>
          <div className="text-[11px] text-muted">Mã vai trò: <code>{c.key}</code> · Phòng {c.department}</div>
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-200">
          <input type="checkbox" className="accent-teal-400" checked={c.include} onChange={e => onChange({ include: e.target.checked })} />
          Tuyển người này
        </label>
      </div>
      {c.reason && <p className="mb-3 text-xs text-slate-400"><span className="text-muted">Lý do đề xuất: </span>{c.reason}</p>}
      {!!c.reference_meta?.length && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted">Dựa trên mẫu:</span>
          {c.reference_meta.map(r => (
            <a key={r.path} href={r.url} target="_blank" rel="noreferrer noopener" title={r.path}
              className="inline-flex items-center gap-1 rounded-full border border-teal-400/30 bg-teal-400/10 px-2 py-0.5 text-teal-200 hover:bg-teal-400/20">
              {r.name}<ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          ))}
        </div>
      )}
      {c.include && (
        <>
          <ProfileFields v={c} config={config} idp={idp} onChange={onChange} />
          <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
            <Field label="Rules nghiệp vụ" id={`${idp}-rules`}>
              <textarea id={`${idp}-rules`} rows={12} className={`${INP} font-mono`} value={c.rules_markdown} onChange={e => onChange({ rules_markdown: e.target.value })} />
            </Field>
            <Field label="Checklist trước khi nộp" id={`${idp}-check`}>
              <textarea id={`${idp}-check`} rows={12} className={`${INP} font-mono`} value={c.checklist_markdown} onChange={e => onChange({ checklist_markdown: e.target.value })} />
            </Field>
          </div>
          <div className="mt-2.5 flex flex-col gap-2">
            <SourcesBlock sources={c.sources || []} />
            <KnowledgeBlock c={c} idp={idp} onChange={onChange} />
            <SkillsBlock c={c} hid={hid} idp={idp} onChange={onChange} />
          </div>
        </>
      )}
    </div>
  )
}

function HiredCard({ role, config, onOpenProfile }: { role: Role; config: Config | null; onOpenProfile: () => void }) {
  const [edit, setEdit] = useState<Editable | null>(null)
  const [confirmFire, setConfirmFire] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const start = () => setEdit({
    name: role.name, title: role.title, department: role.department, color: role.color, model: role.model,
    effort: role.effort, permissions: role.permissions || [], working_style: role.working_style || '',
  })
  const act = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true); setErr(null)
    try { await fn(); after?.() } catch (e) { setErr(String((e as Error).message)) }
    setBusy(false)
  }
  const permLabel = (k: string) => (config?.permission_groups || DEFAULT_PERMS).find(p => p.key === k)?.label || k
  return (
    <article className="rounded-xl border border-white/5 bg-ink-850 p-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <Avatar role={role} size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{role.name} <span className="font-normal text-slate-400">· {role.title}</span></div>
          <div className="text-[11px] text-muted">Phòng {role.department} · {role.model}{role.hired_at ? ` · tuyển ${role.hired_at}` : ''}</div>
        </div>
        {!edit && (
          <div className="flex flex-wrap gap-1.5">
            <Button variant="subtle" onClick={start}><Pencil className="h-3.5 w-3.5" aria-hidden="true" />Sửa</Button>
            <Button variant="subtle" onClick={onOpenProfile}><FileText className="h-3.5 w-3.5" aria-hidden="true" />Rules · Skill</Button>
            <Button variant="danger" onClick={() => setConfirmFire(true)} disabled={busy}><UserMinus className="h-3.5 w-3.5" aria-hidden="true" />Cho nghỉ</Button>
          </div>
        )}
      </div>
      {!edit && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(role.permissions || []).length
            ? role.permissions!.map(p => <span key={p} className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">{permLabel(p)}</span>)
            : <span className="text-[11px] text-muted">Chỉ đọc</span>}
          {!role.assignable && <span className="rounded-md bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200">Chưa nhận task (thiếu quyền ghi file)</span>}
        </div>
      )}
      {confirmFire && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-rose-500/10 p-2.5 text-xs text-rose-100">
          <span className="flex-1">Cho {role.name} nghỉ việc? Hồ sơ và bài học được lưu vào agents/_archive.</span>
          <Button variant="danger" disabled={busy} onClick={() => act(() => rolesApi.remove(role.key), () => setConfirmFire(false))}>Xác nhận</Button>
          <Button disabled={busy} onClick={() => setConfirmFire(false)}>Huỷ</Button>
        </div>
      )}
      {edit && (
        <div className="mt-3">
          <ProfileFields v={edit} config={config} idp={`role-${role.key}`} onChange={p => setEdit(prev => prev && { ...prev, ...p })} />
          <div className="mt-3 flex items-center gap-2">
            <Button variant="primary" disabled={busy} onClick={() => act(() => rolesApi.update(role.key, edit), () => setEdit(null))}>
              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />Lưu
            </Button>
            <Button disabled={busy} onClick={() => setEdit(null)}>Huỷ</Button>
          </div>
        </div>
      )}
      {err && <p className="mt-2 text-xs text-rose-300">{err}</p>}
    </article>
  )
}
