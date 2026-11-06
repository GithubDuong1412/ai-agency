import { Check, ExternalLink, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import { skillsApi, type ProfileScope, type SkillInfo } from '../api'
import { Button, Empty } from './common'

const kb = (n: number) => n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
const stripFm = (t: string) => t.replace(/^---[\s\S]*?\n---\s*\n/, '')

export function SourceBadge({ s }: { s: SkillInfo }) {
  return s.source === 'agency'
    ? <span className="rounded-full bg-teal-400/15 px-2 py-0.5 text-[10px] text-teal-200">Đã cài vào agency</span>
    : <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] text-amber-200" title={s.path}>Trên máy (~/.claude/skills)</span>
}

/** Khối "Skill" trong hồ sơ một nhân viên: xem skill đang gán, gán thêm, gỡ. */
export function RoleSkills({ role, assigned, onChanged, onOpenLibrary }: {
  role: string; assigned: string[]; onChanged: () => void; onOpenLibrary: () => void
}) {
  const [all, setAll] = useState<SkillInfo[]>([])
  const [pick, setPick] = useState('')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { skillsApi.list().then(r => setAll(r.skills)).catch(e => setErr(e.message)) }, [role, assigned.join(',')])

  const save = async (next: string[]) => {
    setErr(null)
    try { await skillsApi.assign(role, next); onChanged() } catch (e) { setErr((e as Error).message) }
  }
  const [busy, setBusy] = useState(false)
  // Chép skill từ ~/.claude/skills vào skills/ của agency (đi cùng dự án, không phụ thuộc máy)
  const installHere = async (name: string) => {
    setBusy(true); setErr(null)
    try { await skillsApi.install({ name }); setAll((await skillsApi.list()).skills) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const options = all.filter(s => !assigned.includes(s.name))
  const byName = Object.fromEntries(all.map(s => [s.name, s]))

  return (
    <div className="mt-3 border-t border-white/5 pt-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="label">Skill được giao</span>
        <button onClick={onOpenLibrary} className="cursor-pointer text-[10px] text-teal-300 hover:text-teal-200 inline-flex items-center gap-1">Thư viện<ExternalLink className="h-3 w-3" aria-hidden="true" /></button>
      </div>
      {assigned.length ? (
        <ul className="flex flex-col gap-1">
          {assigned.map(n => (
            <li key={n} className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[11px] text-slate-200">{n}</span>
                {!byName[n] && <span className="block text-[10px] text-rose-300">Không tìm thấy trên máy</span>}
                {byName[n]?.source === 'machine' && (
                  <span className="block text-[10px] text-slate-400" title={byName[n].path}>
                    <span className="inline-flex items-center gap-0.5 text-emerald-300"><Check className="h-3 w-3" aria-hidden="true" />Đã gán</span> · dùng bản trên máy ·{' '}
                    <button onClick={() => installHere(n)} disabled={busy}
                      className="cursor-pointer text-teal-300 underline-offset-2 hover:underline disabled:opacity-50">
                      {busy ? 'đang cài…' : 'cài vào agency'}
                    </button>
                  </span>
                )}
                {byName[n]?.source === 'agency' && <span className="flex items-center gap-0.5 text-[10px] text-emerald-300"><Check className="h-3 w-3" aria-hidden="true" />Đã gán · đã cài vào agency</span>}
              </span>
              <button onClick={() => save(assigned.filter(x => x !== n))} aria-label={`Gỡ skill ${n}`}
                className="cursor-pointer rounded px-1.5 text-xs text-slate-400 hover:bg-white/10 hover:text-white"><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      ) : <p className="text-[11px] text-muted">Chưa có skill.</p>}
      <div className="mt-2 flex gap-2">
        <label htmlFor={`add-skill-${role}`} className="sr-only">Chọn skill để gán</label>
        <select id={`add-skill-${role}`} value={pick} onChange={e => setPick(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-ink-950 px-2 py-1.5 text-xs outline-none focus:border-teal-400">
          <option value="">Chọn skill…</option>
          {options.map(s => <option key={s.name} value={s.name}>{s.name}{s.source === 'machine' ? ' (trên máy)' : ''}</option>)}
        </select>
        <Button variant="subtle" disabled={!pick} onClick={() => { save([...assigned, pick]); setPick('') }}>Gán</Button>
      </div>
      {err && <p role="alert" className="mt-1 text-[11px] text-rose-300">{err}</p>}
    </div>
  )
}

/** Thư viện skill: skill đã cài trong agency + skill Claude Code trên máy; cài, gỡ, xem, gán nhanh. */
export function SkillLibrary({ scopes, onChanged }: { scopes: ProfileScope[]; onChanged: () => void }) {
  const [data, setData] = useState<{ skills: SkillInfo[]; agency_dir: string; machine_dir: string } | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [doc, setDoc] = useState<string>('')
  const [path, setPath] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const roles = scopes.filter(s => s.key !== '_team')

  const load = () => skillsApi.list().then(r => { setData(r); if (!sel && r.skills[0]) setSel(r.skills[0].name) })
    .catch(e => setMsg({ kind: 'err', text: e.message }))
  useEffect(() => { load() }, [])
  useEffect(() => { if (sel) skillsApi.doc(sel).then(r => setDoc(r.content)).catch(() => setDoc('')) }, [sel])

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null)
    try { await fn(); setMsg({ kind: 'ok', text: ok }); await load(); onChanged() }
    catch (e) { setMsg({ kind: 'err', text: (e as Error).message }) }
    finally { setBusy(false) }
  }
  const toggle = (s: SkillInfo, role: string) => {
    const cur = scopes.find(x => x.key === role)?.skills || []
    const next = cur.includes(s.name) ? cur.filter(x => x !== s.name) : [...cur, s.name]
    return act(() => skillsApi.assign(role, next), cur.includes(s.name) ? `Đã gỡ ${s.name} khỏi ${role}.` : `Đã gán ${s.name}.`)
  }
  const s = data?.skills.find(x => x.name === sel)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 lg:flex-row">
      <div className="panel flex shrink-0 flex-col p-3 lg:w-80 lg:overflow-y-auto scroll-thin">
        <div className="mb-2 px-1">
          <div className="text-sm font-semibold">Thư viện skill</div>
          <div className="text-[11px] text-muted">Skill dạng SKILL.md (giống Claude Code). Gán cho nhân viên để họ dùng khi làm việc.</div>
        </div>
        {!data ? <Empty>Đang tải…</Empty> : data.skills.length ? (
          <ul className="flex flex-col gap-1">
            {data.skills.map(x => (
              <li key={x.name}>
                <button onClick={() => setSel(x.name)} aria-current={x.name === sel ? 'true' : undefined}
                  className={`w-full cursor-pointer rounded-lg px-2.5 py-2 text-left transition-colors ${x.name === sel ? 'bg-teal-400/15' : 'hover:bg-white/5'}`}>
                  <span className="flex items-center gap-2">
                    <span className="flex-1 truncate font-mono text-xs text-slate-100">{x.name}</span>
                    <span className={`h-1.5 w-1.5 rounded-full ${x.source === 'agency' ? 'bg-teal-300' : 'bg-amber-300'}`} aria-hidden="true" />
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted">
                    {x.assigned_to.length ? `Gán cho: ${x.assigned_to.join(', ')}` : 'Chưa gán'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : <Empty>Chưa có skill nào.</Empty>}
        <div className="mt-3 border-t border-white/5 pt-3">
          <label htmlFor="skill-path" className="label mb-1 block">Cài skill từ thư mục</label>
          <input id="skill-path" value={path} onChange={e => setPath(e.target.value)} placeholder="C:\path\to\my-skill (có SKILL.md)"
            className="w-full rounded-lg border border-white/10 bg-ink-950 px-2.5 py-1.5 font-mono text-[11px] outline-none focus:border-teal-400" />
          <Button variant="subtle" className="mt-2 w-full" disabled={!path.trim() || busy}
            onClick={() => act(() => skillsApi.install({ path: path.trim() }), 'Đã cài skill vào agency.').then(() => setPath(''))}>
            Cài từ thư mục
          </Button>
          <p className="mt-1 text-[10px] leading-snug text-muted">
            Muốn dùng skill trên GitHub: clone về máy trước rồi dán đường dẫn thư mục skill vào đây.
            Chỉ cài skill bạn tin tưởng — agent có thể chạy script của skill.
          </p>
        </div>
      </div>

      <section className="panel flex min-h-[28rem] min-w-0 flex-1 flex-col lg:min-h-0" aria-label="Chi tiết skill">
        {msg && <div role="status" className={`px-4 py-2 text-xs ${msg.kind === 'ok' ? 'bg-emerald-400/10 text-emerald-200' : 'bg-rose-500/10 text-rose-200'}`}>{msg.text}</div>}
        {!s ? <div className="p-4"><Empty>Chọn một skill.</Empty></div> : (
          <>
            <div className="border-b border-white/5 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold">{s.name}</span>
                <SourceBadge s={s} />
                <span className="text-[10px] text-muted">{s.files} file · {kb(s.size)}{s.scripts.length ? ` · ${s.scripts.length} script` : ''}</span>
                <span className="ml-auto flex gap-2">
                  {s.source === 'machine' && (
                    <Button variant="primary" disabled={busy} onClick={() => act(() => skillsApi.install({ name: s.name }), `Đã cài ${s.name} vào agency.`)}>Cài vào agency</Button>
                  )}
                  {s.source === 'agency' && s.on_machine && (
                    <Button variant="ghost" disabled={busy} onClick={() => window.confirm('Cập nhật từ bản trên máy (ghi đè bản trong agency)?') &&
                      act(() => skillsApi.install({ name: s.name, overwrite: true }), 'Đã cập nhật từ bản trên máy.')}>Cập nhật từ máy</Button>
                  )}
                  {s.source === 'agency' && (
                    <Button variant="danger" disabled={busy} onClick={() => window.confirm(`Gỡ ${s.name} khỏi agency? (bản trên máy, nếu có, vẫn giữ)`) &&
                      act(() => skillsApi.uninstall(s.name), `Đã gỡ ${s.name} khỏi agency.`)}>Gỡ khỏi agency</Button>
                  )}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-400 [overflow-wrap:anywhere]">{s.description}</p>
              <fieldset className="mt-3">
                <legend className="label mb-1.5">Gán cho</legend>
                <div className="flex flex-wrap gap-2">
                  {roles.map(r => {
                    const on = (r.skills || []).includes(s.name)
                    return (
                      <button key={r.key} onClick={() => toggle(s, r.key)} disabled={busy} aria-pressed={on}
                        className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50 ${on ? 'border-teal-400/60 bg-teal-400/15 text-teal-100' : 'border-white/10 text-slate-400 hover:text-slate-200'}`}>
                        <span className="h-2 w-2 rounded-full" style={{ background: r.color }} aria-hidden="true" />
                        {r.name}<span className="text-muted">· {r.title}</span>{on && <Check className="h-3 w-3" aria-hidden="true" />}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
              {s.source === 'machine' && s.assigned_to.length > 0 && (
                <p className="mt-2 text-[11px] text-amber-200/90">Skill đang được dùng trực tiếp từ máy. Nên "Cài vào agency" để dự án giữ bản cố định, không bị đổi khi skill trên máy cập nhật.</p>
              )}
            </div>
            <div className="md min-h-0 flex-1 overflow-auto p-5 text-sm text-slate-200 scroll-thin">
              {doc ? <Markdown>{stripFm(doc)}</Markdown> : <Empty>Đang tải SKILL.md…</Empty>}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
