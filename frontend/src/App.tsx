import { setOwnerName } from './names'
import { ClipboardCheck, Crosshair, List, MessagesSquare, Network, Pause, Play, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { timeAgo, type Role } from './api'
import { Avatar, Empty, StatusPill } from './components/common'
import { Office, OfficeFloor } from './components/Office'
import type { SafeArea } from './components/Office3D'
import { ApprovalPanel, CommandBar, HandoffTicker, PendingCard, ProjectCommandBar } from './components/Panels'
import { Profiles } from './components/Profiles'
import { ProjectDetail } from './components/ProjectDetail'
import { Header, MobileNav, Sidebar, type View } from './components/Shell'
import { StatCards } from './components/StatCards'
import { TaskBoard } from './components/TaskBoard'
import { Timeline } from './components/Timeline'
import { typingIn } from './components/typing'
import { useAgency } from './store'
import { useProjectData } from './useProjectData'

// three.js khá nặng: chỉ tải khi mở sơ đồ 3D
const Office3D = lazy(() => import('./components/Office3D'))

export default function App() {
  const { config, overview, events, live, connected, error } = useAgency()
  setOwnerName(config?.owner_name)  // cách xưng hô với chủ agency trong câu có {@owner}
  const [view, setView] = useState<View>({ kind: 'overview' })
  const [mode, setMode] = useState<'office' | 'chat' | 'list'>('office')
  const [picked, setPicked] = useState<Role | null>(null)
  const roles = config?.roles || []
  const projects = overview?.projects || []
  const projectTitle = (id: string) => projects.find(p => p.id === id)?.title || ''
  const openProject = (id: string) => setView({ kind: 'project', id })
  const [showPanel, setShowPanel] = useState(false)
  const pendingCount = overview?.stats.pending_reviews ?? 0
  const fullMap = view.kind === 'overview' && mode === 'office'
  // Dữ liệu dự án đang mở: dùng chung cho trang chi tiết và thanh góp ý ở đáy
  const { data: projectData, reload: reloadProject } = useProjectData(view.kind === 'project' ? view.id : null, events)
  // khối nổi trên sơ đồ: bóng đậm + viền sáng mảnh để tách khỏi nền sân khấu
  const float = 'shadow-xl shadow-black/40 ring-1 ring-white/10'

  // 3D / 2D (nhớ lựa chọn trên trình duyệt này)
  const [dim, setDim] = useState<'3d' | '2d'>(() => {
    // Màn hẹp (điện thoại, tablet dọc): 3D quá nhỏ, nhãn đè nhau → mặc định 2D nếu chưa từng chọn
    const narrow = typeof window !== 'undefined' && window.innerWidth < 768
    try {
      const saved = localStorage.getItem('office-dim')
      return saved === '2d' || saved === '3d' ? saved : narrow ? '2d' : '3d'
    } catch { return narrow ? '2d' : '3d' }
  })
  const chooseDim = (d: '3d' | '2d') => {
    setDim(d)
    try { localStorage.setItem('office-dim', d) } catch { /* bỏ qua */ }
  }
  const [fitSignal, setFitSignal] = useState(0)
  // Chuyển động liên tục (nhân vật 3D, thanh bàn giao chạy chữ) cần nút dừng; mặc định tắt nếu máy bật "giảm chuyển động"
  const [motionOn, setMotionOn] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('office-motion')
      if (saved) return saved === 'on'
    } catch { /* bỏ qua */ }
    return !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  })
  const toggleMotion = () => setMotionOn(v => {
    try { localStorage.setItem('office-motion', v ? 'off' : 'on') } catch { /* bỏ qua */ }
    return !v
  })
  // vùng giữa không bị panel che: camera 3D căn scene vào đây
  const mainRef = useRef<HTMLElement>(null)
  const freeRef = useRef<HTMLDivElement>(null)
  const [safe, setSafe] = useState<SafeArea>({ left: 0, top: 0, right: 0, bottom: 0 })
  useEffect(() => {
    const m = mainRef.current, f = freeRef.current
    if (!m || !f) return
    const measure = () => {
      const a = m.getBoundingClientRect(), b = f.getBoundingClientRect()
      const next = { left: b.left - a.left, top: b.top - a.top, right: a.right - b.right, bottom: a.bottom - b.bottom }
      setSafe(s => (Object.keys(next) as (keyof SafeArea)[]).every(k => Math.abs(s[k] - next[k]) < 4) ? s : next)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(m); ro.observe(f)
    measure()
    return () => ro.disconnect()
  }, [fullMap])

  const modeToggle = (
    <div className="flex gap-1 rounded-xl bg-ink-900/90 p-1 shadow-lg" role="tablist" aria-label="Chế độ xem">
      {([['office', 'Sơ đồ', Network], ['chat', 'Hội thoại', MessagesSquare], ['list', 'Danh sách', List]] as const).map(([k, l, Icon]) => (
        <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
          className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs transition-colors ${mode === k ? 'bg-teal-400 text-ink-950' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}><span className="inline-flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" aria-hidden="true" />{l}</span></button>
      ))}
    </div>
  )

  const pickedPanel = picked && (
    <div className="panel flex min-h-0 flex-1 flex-col p-4">
      <div className="mb-3 flex items-center gap-3">
        <Avatar role={picked} size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{picked.name} · {picked.title}</div>
          <div className="text-[11px] text-muted">{picked.department} · {picked.model}</div>
        </div>
        <button onClick={() => setView({ kind: 'profiles', scope: picked.key })}
          className="cursor-pointer rounded-lg px-2 py-1 text-xs text-teal-300 hover:bg-white/5 hover:text-teal-200">Hồ sơ</button>
        <button onClick={() => setPicked(null)}
          className="cursor-pointer rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-white/5 hover:text-white"><span className="inline-flex items-center gap-1">Đóng <X className="h-3.5 w-3.5" aria-hidden="true" /></span></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <Timeline events={events.filter(e => e.agent === picked.key)} roles={roles} showTools projectTitle={projectTitle} />
      </div>
    </div>
  )

  const pickAgent = (r: Role) => { setPicked(r); setShowPanel(true) }
  const is3D = dim === '3d'

  // Sơ đồ làm việc: sàn văn phòng (3D hoặc 2D) phủ kín Main, các panel nổi phía trên
  const mapMain = (
    <main ref={mainRef} className="relative min-w-0 flex-1 overflow-hidden">
      {is3D && <div aria-hidden="true" className={`scene-bg pointer-events-none absolute inset-0 ${motionOn ? "" : "still"}`} />}
      {is3D ? (
        <Suspense fallback={<><div className="absolute inset-0 grid place-items-center text-sm text-white/90">Đang dựng văn phòng 3D…</div></>}>
          <Office3D config={config} overview={overview} live={live} events={events} picked={picked}
            onPickAgent={pickAgent} safe={safe} fitSignal={fitSignal} paused={!motionOn} />
        </Suspense>
      ) : <OfficeFloor />}
      <div className={`pointer-events-none relative z-10 flex h-full flex-col gap-3 p-4 ${motionOn ? '' : 'motion-off'}`}>
        <div className="pointer-events-auto"><StatCards overview={overview} live={live} className={float} /></div>
        <div className="flex flex-wrap items-center gap-3 *:pointer-events-auto">
          {modeToggle}
          <div className="flex gap-1 rounded-xl bg-ink-900/90 p-1 shadow-lg" role="tablist" aria-label="Kiểu sơ đồ">
            {(['3d', '2d'] as const).map(k => (
              <button key={k} role="tab" aria-selected={dim === k} onClick={() => chooseDim(k)}
                className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold uppercase transition-colors ${dim === k ? 'bg-teal-400 text-ink-950' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}>{k}</button>
            ))}
          </div>
          <button onClick={toggleMotion} aria-pressed={!motionOn} title={motionOn ? 'Dừng nhân vật và thanh bàn giao chạy chữ' : 'Cho nhân vật và thanh bàn giao chuyển động lại'}
            className="cursor-pointer rounded-xl bg-ink-900/90 px-3 py-2 text-xs text-slate-200 shadow-lg hover:text-white">
            <span className="inline-flex items-center gap-1.5">{motionOn ? <><Pause className="h-3.5 w-3.5" aria-hidden="true" />Dừng chuyển động</> : <><Play className="h-3.5 w-3.5" aria-hidden="true" />Bật chuyển động</>}</span>
          </button>
          <button onClick={() => setShowPanel(v => !v)} aria-expanded={showPanel}
            className="ml-auto cursor-pointer rounded-xl bg-ink-900/90 px-3 py-2 text-xs text-slate-200 shadow-lg hover:text-white xl:hidden">
            <span className="inline-flex items-center gap-1.5"><ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />Chờ duyệt {pendingCount}</span>
          </button>
        </div>
        <div className="relative flex min-h-0 flex-1 gap-4">
          <div ref={freeRef} className={`relative min-h-0 min-w-0 flex-1 ${is3D ? '' : 'pointer-events-auto overflow-y-auto px-1 pb-2 scroll-thin'}`}>
            {is3D ? (
              <div className="pointer-events-auto absolute bottom-1 left-1 flex flex-wrap items-center gap-2 text-[11px] text-white">
                <button onClick={() => setFitSignal(n => n + 1)}
                  className="cursor-pointer rounded-full bg-ink-900/90 px-3 py-1.5 font-medium shadow-lg hover:bg-ink-800"><span className="inline-flex items-center gap-1.5"><Crosshair className="h-3.5 w-3.5" aria-hidden="true" />Căn giữa</span></button>
                <span className="hidden rounded-full bg-ink-900/80 px-3 py-1.5 sm:inline">Kéo: xoay · Chuột phải: di chuyển · Cuộn: zoom · Bấm nhân vật: xem lịch sử</span>
              </div>
            ) : <Office config={config} overview={overview} live={live} events={events} onPickAgent={pickAgent} />}
          </div>
          <div className={`${showPanel || picked ? 'flex' : 'hidden'} pointer-events-auto min-h-0 w-80 max-w-full shrink-0 flex-col max-xl:absolute max-xl:inset-y-0 max-xl:right-0 max-xl:z-20 xl:flex`}>
            {pickedPanel
              ? <div className={`flex min-h-0 flex-1 flex-col rounded-2xl ${float}`}>{pickedPanel}</div>
              : <ApprovalPanel overview={overview} config={config} live={live} onOpenProject={openProject}
                  className={`min-h-0 flex-1 ${float}`} />}
          </div>
        </div>
        <div className="pointer-events-auto flex flex-col gap-3">
          <CommandBar onCreated={openProject} disabled={!connected} className={float} />
        </div>
      </div>
    </main>
  )

  let main
  if (view.kind === 'profiles') {
    main = <Profiles initialScope={view.scope} onScopeChange={scope => setView({ kind: 'profiles', scope })} />
  } else if (view.kind === 'project') {
    main = <ProjectDetail id={view.id} data={projectData} reload={reloadProject} roles={roles} events={events} live={live}
      onBack={() => setView({ kind: 'overview' })} />
  } else if (view.kind === 'tasks') {
    main = <div className="panel p-4"><TaskBoard tasks={overview?.tasks || []} roles={roles} projects={projects} onOpenProject={openProject} /></div>
  } else if (view.kind === 'handoffs') {
    main = <div className="panel p-4"><Timeline events={events.filter(e => e.type === 'handoff')} roles={roles} projectTitle={projectTitle} /></div>
  } else if (view.kind === 'reviews') {
    const pending = overview?.pending_reports || []
    main = (
      <div className="flex flex-col gap-4">
        <section className="panel p-4" aria-labelledby="pending-h">
          <div className="mb-3 flex items-baseline gap-2">
            <h2 id="pending-h" className="text-base font-semibold">Chờ anh duyệt</h2>
            <span className="text-xs text-muted">{pending.length} báo cáo</span>
          </div>
          {pending.length ? (
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {pending.map(r => <PendingCard key={r.id} r={r} onOpen={() => openProject(r.project_id)} />)}
            </div>
          ) : <Empty>Không có gì chờ duyệt.</Empty>}
        </section>
        <section className="panel p-4" aria-labelledby="review-log-h">
          <h2 id="review-log-h" className="label mb-3">Nhật ký kiểm duyệt & báo cáo</h2>
          <Timeline events={events.filter(e => ['review', 'report'].includes(e.type))} roles={roles} projectTitle={projectTitle} />
        </section>
      </div>
    )
  } else if (view.kind === 'projects') {
    main = (
      <div className="panel divide-y divide-white/5">
        {projects.length ? projects.map(p => (
          <button key={p.id} onClick={() => openProject(p.id)} className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-white/5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{p.title}</div>
              <div className="truncate text-[11px] text-muted">{p.prompt}</div>
            </div>
            <div className="text-[11px] text-muted">~${p.cost_usd.toFixed(2)}</div>
            <div className="w-24 text-right text-[11px] text-muted">{timeAgo(p.updated_at)}</div>
            <StatusPill status={p.running ? 'running' : p.status} />
          </button>
        )) : <div className="p-4"><Empty>Chưa có dự án nào.</Empty></div>}
      </div>
    )
  } else if (view.kind === 'department') {
    const members = roles.filter(r => r.department === view.name)
    const keys = new Set(members.map(m => m.key))
    main = (
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          {members.map(m => (
            <div key={m.key} className="panel flex items-center gap-3 p-4">
              <Avatar role={m} size={40} />
              <div className="min-w-0">
                <div className="text-sm font-semibold">{m.name} · {m.title}</div>
                <div className="text-[11px] text-muted">{m.model} · effort {m.effort}</div>
                <div className="truncate text-[11px] text-slate-400">{live[m.key]?.lastTool || 'Chưa có hoạt động'}</div>
              </div>
              <button onClick={() => setView({ kind: 'profiles', scope: m.key })}
                className="ml-auto shrink-0 cursor-pointer rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-slate-200 hover:bg-white/5">Hồ sơ chuyên môn</button>
            </div>
          ))}
        </div>
        <div className="panel p-4"><Timeline events={events.filter(e => e.agent && keys.has(e.agent))} roles={roles} showTools projectTitle={projectTitle} /></div>
      </div>
    )
  } else {
    main = (
      <div className="flex flex-col gap-4">
        <StatCards overview={overview} live={live} />
        <div className="flex">{modeToggle}</div>
        {mode === 'chat' && <div className="panel p-4"><Timeline events={events} roles={roles} projectTitle={projectTitle} typing={typingIn(live, roles)} /></div>}
        {mode === 'list' && <div className="panel p-4"><TaskBoard tasks={overview?.tasks || []} roles={roles} projects={projects} onOpenProject={openProject} /></div>}
        {pickedPanel}
        <HandoffTicker events={events} roles={roles} />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <Header config={config} connected={connected} staff={roles.length} />
      <MobileNav view={view} setView={setView} overview={overview} />
      {error && <div className="bg-rose-500/15 px-5 py-2 text-xs text-rose-200">Không kết nối được backend: {error}. Hãy chạy server Python (xem README).</div>}
      <div className="flex min-h-0 flex-1">
        <Sidebar view={view} setView={setView} config={config} overview={overview} live={live} />
        {fullMap ? mapMain : <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 scroll-thin">
          {/* shrink-0: không cho khối nội dung co lại trong cột flex có cuộn, nếu không nội dung tràn ra sau CommandBar */}
          <div className="flex shrink-0 flex-col gap-4 xl:flex-row">
            <div className="min-w-0 flex-1">{main}</div>
            {/* Panel Chờ duyệt chỉ ở Toàn cảnh; màn Review & duyệt có danh sách đầy đủ, các màn khác xem số trên menu */}
            {view.kind === 'overview' && (
              <ApprovalPanel overview={overview} config={config} live={live} onOpenProject={openProject} />
            )}
          </div>
          {/* Nền + padding che phần nội dung cuộn bên dưới thanh lệnh (khoảng p-4 của main) */}
          {/* -bottom-4: sticky tính theo mép padding của main, nên kéo xuống 1rem cho sát đáy */}
          <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 mt-auto bg-ink-950 px-4 pb-4 pt-2">
            {view.kind === 'project'
              ? projectData && <ProjectCommandBar key={projectData.project.id} project={projectData.project}
                  report={projectData.reports[0]} onDone={reloadProject} />
              : <CommandBar onCreated={openProject} disabled={!connected} />}
          </div>
        </main>}
      </div>
    </div>
  )
}
