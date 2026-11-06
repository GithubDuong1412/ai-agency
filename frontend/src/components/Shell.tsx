import { ArrowLeftRight, ClipboardCheck, FolderKanban, LayoutDashboard, ListTodo, UserCog, type LucideIcon } from 'lucide-react'
import type { Config, Overview } from '../api'
import type { AgentLive } from '../store'

export type View =
  | { kind: 'overview' } | { kind: 'tasks' } | { kind: 'reviews' } | { kind: 'handoffs' } | { kind: 'projects' }
  | { kind: 'department'; name: string } | { kind: 'project'; id: string } | { kind: 'profiles'; scope?: string }

const NAV: { kind: View['kind']; label: string; icon: LucideIcon }[] = [
  { kind: 'overview', label: 'Toàn cảnh', icon: LayoutDashboard },
  { kind: 'projects', label: 'Dự án', icon: FolderKanban },
  { kind: 'tasks', label: 'Công việc', icon: ListTodo },
  { kind: 'reviews', label: 'Review & duyệt', icon: ClipboardCheck },
  { kind: 'handoffs', label: 'Bàn giao', icon: ArrowLeftRight },
  { kind: 'profiles', label: 'Hồ sơ nhân sự', icon: UserCog },
]

export function Header({ config, connected, staff }: { config: Config | null; connected: boolean; staff: number }) {
  const agency = config?.agency_name || 'AI Web Agency'
  const tagline = config?.agency_tagline || `Đội agent dựng web của ${config?.owner_name || 'Sếp'}`
  const owner = config?.owner_display || config?.owner_name || 'Sếp'
  // Logo: chữ đầu của tên agency (vd. "HD Agency" → "HD"); avatar chủ agency: chữ cái đầu của tên hiển thị
  const logo = agency.split(/\s+/)[0].slice(0, 2).toUpperCase()
  const initial = (owner.match(/\p{L}/u)?.[0] || 'S').toUpperCase()
  return (
    <header className="flex items-center gap-3 border-b border-white/5 bg-ink-900 px-4 py-3 sm:gap-4">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-teal-300 to-emerald-500 font-bold text-ink-950">{logo}</div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{agency}</div>
        <div className="whitespace-nowrap text-[11px] text-slate-400 max-sm:hidden">{tagline}</div>
      </div>
      <div className="ml-4 hidden items-center gap-2 whitespace-nowrap text-[11px] text-slate-400 lg:flex">
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-500'}`} />
        {connected ? 'Văn phòng số · trực tuyến' : 'Mất kết nối server'}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3 text-[11px] text-slate-400 sm:gap-4">
        {config?.demo && (
          <span className="whitespace-nowrap rounded-full bg-amber-400/15 px-2.5 py-1 text-amber-200">Chế độ demo<span className="max-sm:hidden"> · agent giả lập</span></span>
        )}
        {config && !config.has_api_key && (
          <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-amber-300">Chưa có API key: xem README</span>
        )}
        <span className="whitespace-nowrap max-sm:hidden">{staff} thành viên</span>
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-xs font-semibold">{initial}</div>
          <div className="hidden sm:block">
            <div className="text-xs text-slate-200">{owner}</div>
            <div className="text-[10px]">Team owner</div>
          </div>
        </div>
      </div>
    </header>
  )
}

export function Sidebar({ view, setView, config, overview, live }: {
  view: View; setView: (v: View) => void; config: Config | null; overview: Overview | null
  live: Record<string, AgentLive>
}) {
  const departments = [...new Set((config?.roles || []).map(r => r.department))]
  const counts: Record<string, number | undefined> = {
    reviews: overview?.stats.pending_reviews || undefined,
    projects: overview?.projects.length || undefined,
  }
  return (
    <aside className="hidden w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-white/5 bg-ink-900 p-4 scroll-thin lg:flex">
      <div>
        <div className="label mb-2 px-2">Không gian làm việc</div>
        {NAV.map(n => (
          <button key={n.kind} onClick={() => setView({ kind: n.kind } as View)}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${view.kind === n.kind ? 'bg-white/8 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}>
            <n.icon className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.75} aria-hidden="true" />
            <span className="flex-1">{n.label}</span>
            {counts[n.kind] ? <span className="text-[11px] text-muted">{counts[n.kind]}</span> : null}
          </button>
        ))}
      </div>
      <div>
        <div className="label mb-2 flex justify-between px-2"><span>Phòng ban</span><span>{departments.length}</span></div>
        {departments.map(d => {
          const members = (config?.roles || []).filter(r => r.department === d)
          const busy = members.some(m => live[m.key]?.status === 'working')
          const color = members[0]?.color || '#64748b'
          return (
            <button key={d} onClick={() => setView({ kind: 'department', name: d })}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${view.kind === 'department' && view.name === d ? 'bg-white/8 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}>
              <span className="grid h-6 w-6 place-items-center rounded-md" style={{ background: color + '26' }}><span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" /></span>
              <span className="flex-1">{d}</span>
              {busy && <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />}
              <span className="text-[11px] text-muted">{members.length}</span>
            </button>
          )
        })}
      </div>
      <div className="mt-auto px-2 text-[10px] text-muted">Dữ liệu lưu trên máy · data/agency.db</div>
    </aside>
  )
}

/** Menu ngang cho màn hẹp (dưới lg): sidebar bị ẩn nên cần đường đi tới các màn khác. */
export function MobileNav({ view, setView, overview }: {
  view: View; setView: (v: View) => void; overview: Overview | null
}) {
  const counts: Record<string, number | undefined> = {
    reviews: overview?.stats.pending_reviews || undefined,
    projects: overview?.projects.length || undefined,
  }
  return (
    <nav aria-label="Điều hướng" className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/5 bg-ink-900 px-4 py-2 [scrollbar-width:none] lg:hidden">
      {NAV.map(n => {
        const active = view.kind === n.kind
        return (
          <button key={n.kind} onClick={() => setView({ kind: n.kind } as View)} aria-current={active ? 'page' : undefined}
            className={`flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs transition ${active ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}>
            {n.label}
            {counts[n.kind] ? <span className="rounded-full bg-white/10 px-1.5 text-[10px] text-slate-300">{counts[n.kind]}</span> : null}
          </button>
        )
      })}
    </nav>
  )
}
