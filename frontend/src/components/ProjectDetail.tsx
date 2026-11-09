import { fillNames } from '../names'
import { ArrowLeft, ExternalLink, Play, RefreshCw, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import { api, screenshotUrl, type AgencyEvent, type Role } from '../api'
import type { ProjectData } from '../useProjectData'
import { Button, Empty, StatusPill } from './common'
import { useLightbox } from './Lightbox'
import { useProjectHistory } from '../useProjectHistory'
import { TaskBoard } from './TaskBoard'
import { Timeline } from './Timeline'
import { Versions } from './Versions'

type Tab = 'report' | 'chat' | 'tasks' | 'versions' | 'files' | 'preview' | 'spec'

export function ProjectDetail({ id, data, reload, roles, events, onBack }: {
  id: string; data: ProjectData | null; reload: () => void; roles: Role[]; events: AgencyEvent[]; onBack: () => void
}) {
  const [tab, setTab] = useState<Tab>('chat')
  const [msg, setMsg] = useState<string | null>(null)
  const [files, setFiles] = useState<{ path: string; size: number }[]>([])
  const [openFile, setOpenFile] = useState<{ path: string; content: string } | null>(null)
  const [openedPreview, setPreviewUrl] = useState<string | null>(null)
  const [frameKey, setFrameKey] = useState(0)
  const [reloading, setReloading] = useState(false)
  const box = useLightbox()
  const history = useProjectHistory(id, events)  // hội thoại riêng của dự án, tải dần khi cuộn lên
  const pEvents = events.filter(e => e.project_id === id)
  const lastEventId = pEvents.length ? pEvents[pEvents.length - 1].id : 0

  useEffect(() => {
    if (data?.reports.length && data.reports[0].status === 'pending') setTab('report')
  }, [data?.reports.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'files') api.files(id).then(r => setFiles(r.files)) }, [tab, id, lastEventId])

  // Mở tab Xem trước: đảm bảo server còn sống (backend có thể đã khởi động lại) rồi mới nạp khung
  const hasPreview = !!(openedPreview || data?.project.preview_url)
  useEffect(() => {
    if (tab !== 'preview' || !hasPreview) return
    setReloading(true)
    api.preview(id).then(r => { setPreviewUrl(r.url); setFrameKey(k => k + 1) })
      .catch(e => setMsg((e as Error).message)).finally(() => setReloading(false))
  }, [tab, id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <div className="p-6 text-sm text-muted">Đang tải…</div>
  const { project, tasks, reports } = data
  const report = reports[0]
  const N = (t?: string) => fillNames(t || '', roles)  // {@designer}… → tên hiện tại
  const previewUrl = openedPreview || project.preview_url
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null)
    try { await fn(); setMsg(ok); reload() } catch (e) { setMsg((e as Error).message) }
  }
  const openPreview = async () => {
    try { const r = await api.preview(id); setPreviewUrl(r.url); setTab('preview') } catch (e) { setMsg((e as Error).message) }
  }
  // Server xem trước có thể đã tắt (backend khởi động lại, vòng mới, quay về phiên bản): gọi lại để bật nếu cần rồi nạp lại khung
  const reloadPreview = async () => {
    setReloading(true)
    try { const r = await api.preview(id); setPreviewUrl(r.url); setFrameKey(k => k + 1) }
    catch (e) { setMsg((e as Error).message) }
    finally { setReloading(false) }
  }

  const TABS: [Tab, string][] = [['chat', 'Hội thoại'], ['tasks', `Công việc ${tasks.length}`], ['report', 'Báo cáo'],
    ['versions', 'Phiên bản'], ['preview', 'Xem trước'], ['files', 'File'], ['spec', 'Spec']]

  return (
    <div className="flex flex-col gap-4">
      {box.view}
      <div className="panel p-4">
        <div className="flex flex-wrap items-start gap-3">
          <Button onClick={onBack}><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Quay lại</Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold">{project.title}</h1>
              <StatusPill status={project.status} />
            </div>
            <div className="mt-1 line-clamp-2 text-xs text-slate-400">{project.prompt}</div>
            <div className="mt-1 text-[11px] text-muted">
              Lần chạy {project.run_count} · {(project.input_tokens / 1000).toFixed(0)}k token vào / {(project.output_tokens / 1000).toFixed(0)}k ra · ~${project.cost_usd.toFixed(2)}
            </div>
            {project.error && <div className="mt-2 rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">{project.error}</div>}
          </div>
          <div className="flex gap-2">
            {project.running && <Button variant="danger" onClick={() => act(() => api.stop(id), 'Đã gửi lệnh dừng.')}><Square className="h-3 w-3 fill-current" aria-hidden="true" />Dừng</Button>}
            {!project.running && ['failed', 'stopped', 'interrupted'].includes(project.status) && (
              <Button onClick={() => act(() => api.resume(id), 'Đã chạy lại.')}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Chạy lại</Button>
            )}
            <Button onClick={openPreview}><Play className="h-3.5 w-3.5" aria-hidden="true" />Xem trước</Button>
          </div>
        </div>
        <div className="mt-4 flex gap-1 overflow-x-auto border-b border-white/5">
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`whitespace-nowrap border-b-2 px-3 pb-2 text-xs ${tab === k ? 'border-teal-400 text-white' : 'border-transparent text-muted hover:text-slate-300'}`}>{l}</button>
          ))}
        </div>
      </div>

      {msg && <div className="rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-300">{msg}</div>}

      {tab === 'chat' && (
        <div className="panel p-4">
          <Timeline key={id} events={history.events} roles={roles} showTools limit={Infinity}
            older={{ hasMore: history.hasMore, loading: history.loadingOlder, loaded: history.loaded, load: history.loadOlder }} />
        </div>
      )}
      {tab === 'tasks' && <div className="panel p-4"><TaskBoard tasks={tasks} roles={roles} projects={[project]} onOpenProject={() => {}} /></div>}

      {tab === 'report' && (report ? (
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <div className="panel p-5">
            <div className="label">Báo cáo lần {report.run_no} · {report.status === 'pending' ? 'chờ duyệt' : report.status === 'approved' ? 'đã duyệt' : 'đã yêu cầu sửa'}</div>
            <h2 className="mt-1 text-lg font-semibold">{N(report.content.headline)}</h2>
            <div className="md mt-3 text-sm text-slate-200"><Markdown>{N(report.content.summary_markdown)}</Markdown></div>
            {!!report.content.screenshots?.length && (
              <div className="mt-5">
                <div className="label mb-2">Ảnh chụp vòng {report.run_no} · trang có giao diện thay đổi</div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {report.content.screenshots.map(s => (
                    <button key={s} type="button" onClick={() => box.open(screenshotUrl(id, s), s)} aria-label={`Xem lớn ảnh ${s}`}
                      className="block cursor-zoom-in overflow-hidden rounded-lg border border-white/10 text-left transition hover:border-teal-300/60">
                      <img src={screenshotUrl(id, s)} alt={s} loading="lazy" className="h-40 w-full object-cover object-top" />
                      <div className="truncate bg-ink-850 px-2 py-1 text-[10px] text-muted">{s}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-4">
            <div className="panel p-4">
              <div className="label mb-2">Kiểm duyệt</div>
              <div className={`text-sm font-semibold ${report.content.verdict === 'approve' ? 'text-emerald-300' : 'text-rose-300'}`}>
                {report.content.verdict === 'approve' ? 'Đạt' : 'Còn vấn đề'} · {report.content.score}/10
              </div>
              <p className="mt-1 text-xs text-slate-400">{N(report.content.review_summary)}</p>
              {!!report.content.open_issues?.length && (
                <ul className="mt-2 space-y-1 text-xs text-rose-200">
                  {report.content.open_issues.map((i, n) => <li key={n}>• [{i.severity}] {N(i.title)}</li>)}
                </ul>
              )}
            </div>
            <div className="panel p-4">
              <div className="label mb-2">Cách tự kiểm tra</div>
              <ol className="list-decimal space-y-1 pl-4 text-xs text-slate-300">
                {report.content.how_to_check.map((s, n) => <li key={n}>{N(s)}</li>)}
              </ol>
              {!!report.content.known_issues.length && <>
                <div className="label mb-1 mt-3">Vấn đề còn tồn tại</div>
                <ul className="space-y-1 text-xs text-amber-200">{report.content.known_issues.map((s, n) => <li key={n}>• {N(s)}</li>)}</ul>
              </>}
            </div>
            {!project.running && (
              <div className="rounded-xl border border-teal-400/20 bg-teal-400/5 p-3 text-xs text-teal-100">
                {report.status === 'pending' ? 'Duyệt hoặc yêu cầu sửa' : 'Muốn chỉnh sửa thêm? Gửi góp ý'} ở thanh dưới cùng.
              </div>
            )}
          </div>
        </div>
      ) : <Empty>Chưa có báo cáo. Đội đang làm việc…</Empty>)}

      {tab === 'preview' && (previewUrl ? (
        <div className="panel overflow-hidden">
          <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2 text-xs text-slate-400">
            <span className="truncate">{previewUrl}</span>
            <button type="button" onClick={reloadPreview} disabled={reloading}
              className="ml-auto inline-flex cursor-pointer items-center gap-1 text-slate-300 hover:text-white disabled:opacity-50">
              <RefreshCw className={`h-3 w-3 ${reloading ? 'animate-spin' : ''}`} aria-hidden="true" />{reloading ? 'Đang bật…' : 'Tải lại'}
            </button>
            <a href={previewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-teal-300">Mở tab mới<ExternalLink className="h-3 w-3" aria-hidden="true" /></a>
          </div>
          <iframe key={frameKey} src={previewUrl} title="preview" className="h-[70vh] w-full bg-white" />
        </div>
      ) : <Empty><Button onClick={openPreview}><Play className="h-3.5 w-3.5" aria-hidden="true" />Bật server xem trước</Button></Empty>)}

      {tab === 'versions' && (
        <Versions id={id} running={project.running} refreshKey={project.running ? 0 : lastEventId}
          onRestored={() => { setOpenFile(null); setPreviewUrl(null); reload() }} />
      )}

      {tab === 'files' && (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="panel max-h-[70vh] overflow-y-auto p-2 scroll-thin">
            {files.length ? files.map(f => (
              <button key={f.path} onClick={() => api.file(id, f.path).then(r => setOpenFile({ path: f.path, content: r.content }))}
                className={`block w-full truncate rounded px-2 py-1 text-left text-[11px] hover:bg-white/5 ${openFile?.path === f.path ? 'bg-white/10 text-white' : 'text-slate-400'}`}>
                {f.path}
              </button>
            )) : <Empty>Chưa có file.</Empty>}
          </div>
          <div className="panel max-h-[70vh] overflow-auto p-4 scroll-thin">
            {openFile ? <>
              <div className="label mb-2">{openFile.path}</div>
              <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-300">{openFile.content}</pre>
            </> : <Empty>Chọn một file để xem.</Empty>}
          </div>
        </div>
      )}

      {tab === 'spec' && (
        <div className="panel md p-5 text-sm">{project.spec ? <Markdown>{project.spec}</Markdown> : <Empty>Chưa có spec.</Empty>}</div>
      )}
    </div>
  )
}
