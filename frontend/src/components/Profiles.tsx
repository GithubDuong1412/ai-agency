import { Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Markdown from 'react-markdown'
import { profilesApi, type ProfileFile, type ProfileScope } from '../api'
import { Button, Empty } from './common'
import { RoleSkills, SkillLibrary } from './Skills'

const TEAM = '_team'
const SKILLS = '__skills'
const fileLabel = (f: ProfileFile) =>
  f.path === 'rules.md' ? 'Luật' : f.path === 'checklist.md' ? 'Checklist tự kiểm' : f.title
const fileHint = (path: string) =>
  path === 'rules.md' ? 'Luôn nạp vào prompt · nên dưới ~30 dòng'
    : path === 'checklist.md' ? 'Luôn nạp vào prompt · agent tự kiểm trước khi nộp'
      : 'Agent tự đọc khi cần (tool read_knowledge) · dòng đầu là tiêu đề'

/** Hồ sơ chuyên môn: xem/sửa luật, checklist, kiến thức của từng agent (file trong agents/). */
export function Profiles({ initialScope, onScopeChange }: { initialScope?: string; onScopeChange?: (s: string) => void }) {
  const [scopes, setScopes] = useState<ProfileScope[]>([])
  const [scope, setScope] = useState(initialScope || TEAM)
  const [path, setPath] = useState('rules.md')
  const [saved, setSaved] = useState('')
  const [text, setText] = useState('')
  const [tab, setTab] = useState<'edit' | 'preview' | 'prompt'>('edit')
  const [prompt, setPrompt] = useState<{ prompt: string; chars: number } | null>(null)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [newSlug, setNewSlug] = useState('')
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const key = `${scope}/${path}`
  const ready = loadedKey === key   // nội dung đang hiển thị đúng là của file đang chọn
  const dirty = ready && text !== saved

  const reload = useCallback(() => profilesApi.list().then(setScopes).catch(e => setStatus({ kind: 'err', msg: e.message })), [])
  useEffect(() => { reload() }, [reload])
  useEffect(() => { if (initialScope) setScope(initialScope) }, [initialScope])

  useEffect(() => {
    if (scope === SKILLS) return
    let alive = true
    setStatus(null)
    setLoadedKey(null)
    profilesApi.read(scope, path)
      .then(r => { if (alive) { setSaved(r.content); setText(r.content); setLoadedKey(`${scope}/${path}`) } })
      .catch(e => alive && setStatus({ kind: 'err', msg: e.message }))
    return () => { alive = false }
  }, [scope, path])

  useEffect(() => {
    if (tab !== 'prompt' || scope === TEAM || scope === SKILLS) return
    setPrompt(null)
    profilesApi.prompt(scope).then(setPrompt).catch(e => setStatus({ kind: 'err', msg: e.message }))
  }, [tab, scope, saved])

  // cảnh báo khi rời trang mà chưa lưu
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const guard = () => !dirty || window.confirm('Bạn có thay đổi chưa lưu. Bỏ thay đổi?')
  const pickScope = (s: string) => {
    if (s === scope || !guard()) return
    setScope(s); setPath('rules.md'); onScopeChange?.(s)
    if (s === TEAM && tab === 'prompt') setTab('edit')
  }
  const pickFile = (p: string) => { if (p !== path && guard()) setPath(p) }

  const save = async () => {
    if (!ready) return
    setBusy(true); setStatus(null)
    try {
      await profilesApi.save(scope, path, text)
      setSaved(text)
      setStatus({ kind: 'ok', msg: 'Đã lưu. Có hiệu lực từ lượt agent làm việc tiếp theo.' })
      reload()
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message })
    } finally { setBusy(false) }
  }

  const slugOk = /^[a-z0-9][a-z0-9-]{0,63}$/.test(newSlug)
  const create = async () => {
    if (!slugOk || !guard()) return
    const p = `knowledge/${newSlug}.md`
    try {
      await profilesApi.save(scope, p, `# Tiêu đề ngắn mô tả chủ đề\n\nNội dung…\n`)
      setNewSlug(''); await reload(); setPath(p); setTab('edit')
    } catch (e) { setStatus({ kind: 'err', msg: (e as Error).message }) }
  }

  const remove = async () => {
    if (!window.confirm(`Xoá chủ đề "${path}"? Không hoàn tác được.`)) return
    try {
      await profilesApi.remove(scope, path)
      await reload(); setPath('rules.md')
    } catch (e) { setStatus({ kind: 'err', msg: (e as Error).message }) }
  }

  const current = useMemo(() => scopes.find(s => s.key === scope), [scopes, scope])
  const lines = text.split('\n').length

  return (
    <div className="flex min-h-0 flex-col gap-4 lg:h-[calc(100dvh-15rem)] lg:min-h-[30rem] lg:flex-row">
      {/* danh sách người */}
      <nav aria-label="Chọn hồ sơ" className="panel flex shrink-0 flex-row gap-1 overflow-x-auto p-2 lg:w-56 lg:flex-col lg:overflow-y-auto">
        <div className="label hidden px-2 py-1 lg:block">Hồ sơ nhân sự</div>
        {scopes.map(s => (
          <button key={s.key} onClick={() => pickScope(s.key)} aria-current={s.key === scope ? 'page' : undefined}
            className={`flex shrink-0 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${s.key === scope ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block truncate font-medium">{s.name}</span>
              <span className="block truncate text-[10px] text-muted">{s.title}</span>
            </span>
          </button>
        ))}
        <button onClick={() => pickScope(SKILLS)} aria-current={scope === SKILLS ? 'page' : undefined}
          className={`flex shrink-0 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors lg:mt-2 lg:border-t lg:border-white/5 lg:pt-3 ${scope === SKILLS ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}>
          <Sparkles className="h-3 w-3 shrink-0 text-teal-300" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block truncate font-medium">Thư viện skill</span>
            <span className="block truncate text-[10px] text-muted">Cài và gán skill</span>
          </span>
        </button>
      </nav>

      {scope === SKILLS ? <SkillLibrary scopes={scopes} onChanged={reload} /> : <>
      {/* danh sách file */}
      <div className="panel flex shrink-0 flex-col overflow-y-auto p-3 scroll-thin lg:w-72">
        <div className="mb-2 px-1">
          <div className="text-sm font-semibold">{current?.name}</div>
          <div className="text-[11px] text-muted">{current?.title}</div>
        </div>
        <ul className="flex flex-col gap-1">
          {(current?.files || []).map(f => (
            <li key={f.path}>
              <button onClick={() => pickFile(f.path)} aria-current={f.path === path ? 'true' : undefined}
                className={`w-full cursor-pointer rounded-lg px-2.5 py-2 text-left transition-colors ${f.path === path ? 'bg-teal-400/15 text-teal-100' : 'text-slate-300 hover:bg-white/5'}`}>
                <span className="block truncate text-xs font-medium">{fileLabel(f)}</span>
                <span className="block truncate font-mono text-[10px] text-muted">{f.path}{!f.exists && ' · chưa có'}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 border-t border-white/5 pt-3">
          <label htmlFor="new-topic" className="label mb-1 block">Thêm chủ đề kiến thức</label>
          <div className="flex gap-2">
            <input id="new-topic" value={newSlug} onChange={e => setNewSlug(e.target.value.trim().toLowerCase())}
              placeholder="vd. quy-trinh-deploy" aria-describedby="new-topic-help"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-ink-950 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-teal-400" />
            <Button variant="subtle" onClick={create} disabled={!slugOk}>Thêm</Button>
          </div>
          <p id="new-topic-help" className={`mt-1 text-[10px] ${newSlug && !slugOk ? 'text-rose-300' : 'text-muted'}`}>
            Chữ thường không dấu, số, gạch ngang.
          </p>
        </div>
        {scope !== TEAM && (
          <RoleSkills role={scope} assigned={current?.skills || []} onChanged={reload}
            onOpenLibrary={() => pickScope(SKILLS)} />
        )}
      </div>

      {/* trình sửa */}
      <section className="panel flex h-[70dvh] min-h-0 min-w-0 flex-1 flex-col lg:h-auto" aria-label="Nội dung file">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-xs text-slate-200">agents/{scope}/{path}{dirty && <span className="ml-1 inline-flex items-center gap-1 text-amber-300"><span className="h-1.5 w-1.5 rounded-full bg-amber-300" aria-hidden="true" />chưa lưu</span>}</div>
            <div className="text-[10px] text-muted">{fileHint(path)} · {lines} dòng</div>
          </div>
          <div className="flex gap-1 rounded-lg bg-ink-950 p-0.5" role="tablist" aria-label="Chế độ">
            {([['edit', 'Sửa'], ['preview', 'Xem'], ...(scope !== TEAM ? [['prompt', 'Prompt đầy đủ']] : [])] as [typeof tab, string][]).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`cursor-pointer rounded-md px-2.5 py-1 text-[11px] ${tab === k ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}>{l}</button>
            ))}
          </div>
          {path.startsWith('knowledge/') && <Button variant="danger" onClick={remove}>Xoá</Button>}
          <Button variant="primary" onClick={save} disabled={!dirty || busy}>{busy ? 'Đang lưu…' : 'Lưu (Ctrl+S)'}</Button>
        </div>
        {status && (
          <div role="status" className={`px-4 py-2 text-xs ${status.kind === 'ok' ? 'bg-emerald-400/10 text-emerald-200' : 'bg-rose-500/10 text-rose-200'}`}>{status.msg}</div>
        )}
        {path === 'rules.md' && lines > 45 && tab === 'edit' && (
          <div className="bg-amber-400/10 px-4 py-2 text-xs text-amber-200">Luật đang dài ({lines} dòng). Luật quá dài dễ bị bỏ sót, nên chuyển chi tiết sang một chủ đề kiến thức.</div>
        )}
        <div className="min-h-0 flex-1 overflow-auto scroll-thin">
          {tab === 'edit' && (
            <textarea value={ready ? text : ''} onChange={e => setText(e.target.value)} spellCheck={false} aria-label={`Nội dung ${path}`}
              disabled={!ready} placeholder={ready ? 'File trống' : 'Đang tải…'}
              onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (dirty) save() } }}
              className="block h-full w-full resize-none bg-transparent p-4 font-mono text-[12.5px] leading-relaxed text-slate-200 outline-none" />
          )}
          {tab === 'preview' && <div className="md p-5 text-sm text-slate-200">{!ready ? <Empty>Đang tải…</Empty> : text.trim() ? <Markdown>{text.replace(/<!--[\s\S]*?-->/g, '')}</Markdown> : <Empty>File trống.</Empty>}</div>}
          {tab === 'prompt' && (
            <div className="p-4">
              <p className="mb-3 text-[11px] text-slate-400">
                Đây là system prompt agent nhận khi bắt đầu làm việc (đã bỏ chú thích HTML).
                {prompt && ` ${prompt.chars.toLocaleString('vi-VN')} ký tự ≈ ${Math.round(prompt.chars / 3.2).toLocaleString('vi-VN')} token.`}
                {dirty && ' Bạn có thay đổi chưa lưu, prompt chưa phản ánh chúng.'}
              </p>
              {prompt ? <pre className="whitespace-pre-wrap rounded-lg bg-ink-950 p-4 font-mono text-[11.5px] leading-relaxed text-slate-300">{prompt.prompt}</pre>
                : <Empty>Đang tải…</Empty>}
            </div>
          )}
        </div>
      </section>
      </>}
    </div>
  )
}
