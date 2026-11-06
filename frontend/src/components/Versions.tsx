import { Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, timeAgo, type Version, type VersionFile } from '../api'
import { Button, Empty } from './common'

const STATUS: Record<VersionFile['status'], [string, string]> = {
  added: ['Thêm', 'text-emerald-300'], modified: ['Sửa', 'text-sky-300'],
  deleted: ['Xoá', 'text-rose-300'], renamed: ['Đổi tên', 'text-amber-300'],
}

function versionLabel(v: Version) {
  if (v.run_no === 0) return 'Ban đầu'
  if (v.run_no) return `Vòng ${v.run_no}`
  return v.title.startsWith('Quay về') ? 'Quay về' : 'Chỉnh tay'
}

function Patch({ text }: { text: string }) {
  return (
    <pre className="overflow-x-auto bg-ink-950/60 py-2 text-[11px] leading-relaxed scroll-thin">
      {text.split('\n').map((ln, i) => {
        const cls = ln.startsWith('+') ? 'bg-emerald-500/10 text-emerald-200'
          : ln.startsWith('-') ? 'bg-rose-500/10 text-rose-200'
          : ln.startsWith('@@') ? 'text-sky-300/80' : 'text-slate-400'
        return <div key={i} className={`whitespace-pre px-3 ${cls}`}>{ln || ' '}</div>
      })}
    </pre>
  )
}

/** Tab "Phiên bản": mỗi vòng chạy là một phiên bản code; xem đã sửa gì và quay về khi cần. */
export function Versions({ id, running, refreshKey, onRestored }: {
  id: string; running: boolean; refreshKey: number; onRestored: () => void
}) {
  const [list, setList] = useState<Version[] | null>(null)
  const [available, setAvailable] = useState(true)
  const [sel, setSel] = useState<string | null>(null)
  const [files, setFiles] = useState<VersionFile[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = () => api.versions(id).then(r => {
    setAvailable(r.available); setList(r.versions)
    setSel(s => (s && r.versions.some(v => v.sha === s)) ? s : r.versions[0]?.sha ?? null)
  }).catch(e => setMsg({ ok: false, text: (e as Error).message }))

  useEffect(() => { load() }, [id, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setFiles(null)
    if (sel) api.versionDiff(id, sel).then(r => setFiles(r.files)).catch(e => setMsg({ ok: false, text: (e as Error).message }))
  }, [id, sel])

  if (!list) return <div className="panel p-4 text-xs text-muted">Đang tải lịch sử…</div>
  if (!available) return <Empty>Máy chưa cài git nên chưa lưu được lịch sử phiên bản.</Empty>
  if (!list.length) return <Empty>Chưa có phiên bản nào. Phiên bản đầu tiên được lưu khi đội bắt đầu làm.</Empty>

  const v = list.find(x => x.sha === sel)
  const restore = async () => {
    if (!v || busy) return
    if (!window.confirm(`Đưa code về phiên bản "${v.title}"?\n\nCode hiện tại vẫn được lưu trong lịch sử, có thể quay lại sau.`)) return
    setBusy(true); setMsg(null)
    try {
      await api.restoreVersion(id, v.sha)
      setMsg({ ok: true, text: `Đã quay về "${v.title}". Bấm Xem trước để kiểm tra; vòng sửa sau làm tiếp từ đây.` })
      await load(); onRestored()
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) }
    finally { setBusy(false) }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="panel max-h-[70vh] overflow-y-auto p-2 scroll-thin" role="list" aria-label="Các phiên bản">
        {list.map(x => (
          <button key={x.sha} role="listitem" onClick={() => setSel(x.sha)} aria-current={x.sha === sel}
            className={`mb-1 block w-full cursor-pointer rounded-lg px-3 py-2 text-left transition hover:bg-white/5 ${x.sha === sel ? 'bg-white/10' : ''}`}>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="rounded bg-teal-400/15 px-1.5 py-0.5 font-medium text-teal-200">{versionLabel(x)}</span>
              {x.current && <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-emerald-200">Đang dùng</span>}
              <span className="ml-auto text-muted">{timeAgo(x.time)}</span>
            </div>
            <div className="mt-1 line-clamp-2 text-xs text-slate-200">{x.title}</div>
            <div className="mt-1 text-[10px] tabular-nums text-muted">
              {x.files} file · <span className="text-emerald-300/80">+{x.insertions}</span> <span className="text-rose-300/80">−{x.deletions}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {v && (
          <div className="panel flex flex-wrap items-start gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="label">{versionLabel(v)} · {new Date(v.time * 1000).toLocaleString('vi-VN')} · {v.sha.slice(0, 7)}</div>
              <div className="mt-1 text-sm font-semibold">{v.title}</div>
              <div className="mt-1 text-[11px] text-muted">Những file thay đổi so với phiên bản ngay trước.</div>
            </div>
            <Button onClick={restore} disabled={busy || running || v.current} className="h-10"
              variant={v.current ? 'subtle' : 'ghost'}>
              {v.current ? 'Đang dùng phiên bản này' : running ? 'Dừng dự án để quay về' : busy ? 'Đang quay về…' : <><Undo2 className="h-3.5 w-3.5" aria-hidden="true" />Quay về phiên bản này</>}
            </Button>
          </div>
        )}
        {msg && <div role="status" className={`rounded-lg bg-white/5 px-3 py-2 text-xs ${msg.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{msg.text}</div>}
        {!files ? <div className="panel p-4 text-xs text-muted">Đang tải thay đổi…</div>
          : !files.length ? <Empty>Phiên bản này không thay đổi file nào.</Empty>
          : (
            <div className="flex flex-col gap-2">
              {files.map(f => (
                <details key={f.path} className="panel overflow-hidden" open={files.length <= 6}>
                  <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs hover:bg-white/5">
                    <span className={`w-14 shrink-0 ${STATUS[f.status][1]}`}>{STATUS[f.status][0]}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-slate-200" title={f.path}>{f.path}</span>
                    <span className="shrink-0 tabular-nums text-[11px]">
                      <span className="text-emerald-300">+{f.insertions}</span> <span className="text-rose-300">−{f.deletions}</span>
                    </span>
                  </summary>
                  {f.binary ? <div className="px-3 py-2 text-[11px] text-muted">File nhị phân (ảnh, database…), không hiển thị nội dung.</div>
                    : f.patch === null ? <div className="px-3 py-2 text-[11px] text-muted">Quá nhiều thay đổi, không hiển thị hết.</div>
                    : <>
                      <Patch text={f.patch} />
                      {f.truncated && <div className="px-3 py-1 text-[10px] text-muted">… đã cắt bớt</div>}
                    </>}
                </details>
              ))}
            </div>
          )}
      </div>
    </div>
  )
}
