import { Activity, ClipboardCheck, ListTodo, Users } from 'lucide-react'
import type { Overview } from '../api'
import type { AgentLive } from '../store'

export function StatCards({ overview, live, className = '' }: {
  overview: Overview | null; live: Record<string, AgentLive>; className?: string
}) {
  const working = Object.values(live).filter(a => a.status === 'working').length
  const s = overview?.stats
  const cards = [
    { label: 'Nhân sự', short: 'Nhân sự', value: s?.staff ?? 0, unit: 'người', sub: 'agent trong đội', icon: Users, tone: 'text-slate-300' },
    { label: 'Đang làm việc', short: 'Đang làm', value: working, unit: 'người', sub: `${s?.running_projects ?? 0} dự án đang chạy`, icon: Activity, tone: 'text-sky-300' },
    { label: 'Việc đang mở', short: 'Việc mở', value: s?.open_tasks ?? 0, unit: 'việc', sub: 'Giao việc & theo dõi', icon: ListTodo, tone: 'text-amber-300' },
    { label: 'Chờ anh duyệt', short: 'Chờ duyệt', value: s?.pending_reviews ?? 0, unit: 'mục', sub: `Chi phí ~$${(s?.cost_usd ?? 0).toFixed(2)}`, icon: ClipboardCheck, tone: 'text-rose-300' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map(c => (
        <div key={c.label} className={`panel flex min-w-0 items-center gap-3 p-3 2xl:gap-4 2xl:p-4 ${className}`}>
          <div aria-hidden="true" className={`grid h-10 w-10 shrink-0 max-sm:hidden place-items-center rounded-xl bg-white/5 ${c.tone}`}><c.icon className="h-5 w-5" strokeWidth={1.75} /></div>
          <div className="min-w-0">
            <div className="label truncate" title={c.label}>
              <span className="sm:hidden">{c.short}</span><span className="max-sm:hidden">{c.label}</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold tabular-nums 2xl:text-3xl">{c.value}</span>
              <span className="text-xs text-muted">{c.unit}</span>
            </div>
            <div className="truncate text-[11px] text-slate-400 max-sm:hidden" title={c.sub}>{c.sub}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
