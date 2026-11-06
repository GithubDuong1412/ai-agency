import { fillNames } from '../names'
import { useEffect, useState } from 'react'
import type { AgencyEvent, Config, Overview, Role } from '../api'
import type { AgentLive } from '../store'

/** Văn phòng 2D (giai đoạn 1): mỗi phòng ban là một khu, mỗi agent ngồi một bàn. */
export function Office({ config, overview, live, events, onPickAgent }: {
  config: Config | null; overview: Overview | null; live: Record<string, AgentLive>; events: AgencyEvent[]
  onPickAgent: (role: Role) => void
}) {
  const [now, setNow] = useState(Date.now() / 1000)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 2000)
    return () => clearInterval(t)
  }, [])
  const roles = config?.roles || []
  const departments = [...new Set(roles.map(r => r.department))]
  const lastHandoff = [...events].reverse().find(e => e.type === 'handoff')
  const handoffActive = lastHandoff && now - lastHandoff.created_at < 25
  const roleBy = (k?: string | null) => roles.find(r => r.key === k)

  const currentTask = (key: string) => {
    const tasks = overview?.tasks || []
    if (key === 'qa') return tasks.find(t => t.status === 'testing')?.title
    return tasks.find(t => t.assignee === key && t.status === 'in_progress')?.title
  }

  return (
    <div className="relative">
      {handoffActive && lastHandoff && (
        <div className="animate-pop mb-4 inline-flex max-w-full items-center rounded-full bg-ink-900/90 px-3 py-1.5 text-xs shadow-lg" role="status">
          <span style={{ color: roleBy(lastHandoff.agent)?.color }}>{roleBy(lastHandoff.agent)?.name}</span>
          <span className="mx-1.5 text-slate-400" aria-hidden="true">→</span>
          <span style={{ color: roleBy(lastHandoff.data.to)?.color }}>{roleBy(lastHandoff.data.to)?.name}</span>
          <span className="ml-2 truncate text-slate-300">{fillNames(String(lastHandoff.data.note || ''), roles).slice(0, 80)}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-x-5 gap-y-8 pt-3 md:grid-cols-2 2xl:grid-cols-3">
        {departments.map(dep => {
          const members = roles.filter(r => r.department === dep)
          const color = members[0]?.color || '#64748b'
          return (
            <div key={dep} className="relative rounded-2xl border-2 border-white/40 bg-[#eef3ef] p-4 pt-8 shadow-[0_10px_0_rgba(0,0,0,.12)]">
              <div className="absolute -top-3 left-4 flex items-center gap-1.5 rounded-lg bg-ink-900 px-2.5 py-1 text-[11px] font-medium shadow">
                <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />{dep}<span className="text-muted">{members.length}</span>
              </div>
              <div className="flex flex-wrap gap-6">
                {members.map(r => {
                  const a = live[r.key]
                  const working = a?.status === 'working'
                  const bubble = a?.lastText && a.lastAt && now - a.lastAt < 40 ? fillNames(a.lastText, roles) : null
                  const highlight = handoffActive && (lastHandoff?.agent === r.key || lastHandoff?.data.to === r.key)
                  const task = working ? currentTask(r.key) : undefined
                  return (
                    <button key={r.key} onClick={() => onPickAgent(r)} aria-label={`${r.name}, ${r.title}${working ? ', đang làm việc' : ''}`}
                      className="group relative w-36 cursor-pointer rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-teal-300">
                      {bubble && (
                        <div className="animate-pop absolute -top-16 left-0 z-10 w-56 rounded-xl bg-white p-2 text-[11px] leading-snug text-slate-800 shadow-xl">
                          <div className="mb-0.5 text-[10px] text-slate-600">{r.name} · {r.title}</div>
                          <div className="line-clamp-2">{bubble}</div>
                        </div>
                      )}
                      {/* bàn làm việc */}
                      <div className={`relative h-20 rounded-xl border-b-4 border-[#c9cfc8] bg-white transition group-hover:-translate-y-0.5 ${highlight ? 'ring-4 ring-amber-300' : ''}`}>
                        <div className="absolute left-1/2 top-2 h-8 w-14 -translate-x-1/2 rounded-md bg-ink-800">
                          <div className={`m-1 h-6 rounded-sm ${working ? 'bg-sky-400/70' : 'bg-ink-600'}`} />
                        </div>
                        <div className={`absolute -bottom-3 left-1/2 -translate-x-1/2 ${working ? 'animate-bob' : ''}`}>
                          <div className="h-9 w-9 rounded-full border-4 border-white shadow-md" style={{ background: r.color }} />
                        </div>
                      </div>
                      <div className="mt-5 text-center">
                        <div className="text-xs font-semibold text-slate-800">{r.name}</div>
                        <div className="text-[10px] text-slate-600">{r.title}</div>
                      </div>
                      {task && (
                        <div className="mt-1 truncate rounded-md bg-ink-900 px-2 py-1 text-[10px] text-teal-200" title={task}>
                          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-teal-300 align-middle" aria-hidden="true" />{task}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-6 flex flex-wrap gap-2 text-[11px] text-white">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-900/80 px-2.5 py-1"><span className="h-2 w-2 rounded-full bg-sky-400" aria-hidden="true" />Đang làm: màn hình sáng</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-900/80 px-2.5 py-1"><span className="h-2 w-2 rounded-sm ring-2 ring-amber-300" aria-hidden="true" />Bàn giao: khung vàng</span>
        <span className="rounded-full bg-ink-900/80 px-2.5 py-1">Bấm vào nhân vật để xem lịch sử</span>
      </div>
    </div>
  )
}

/** Nền sàn văn phòng: phủ kín vùng Main, đặt dưới mọi lớp nổi. */
export function OfficeFloor() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-floor" style={{
      backgroundImage: [
        'radial-gradient(ellipse at center, transparent 45%, rgba(7,12,22,.35) 100%)',
        'linear-gradient(rgba(255,255,255,.07) 1px, transparent 1px)',
        'linear-gradient(90deg, rgba(255,255,255,.07) 1px, transparent 1px)',
        'linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px)',
        'linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px)',
      ].join(','),
      backgroundSize: '100% 100%, 112px 112px, 112px 112px, 28px 28px, 28px 28px',
    }} />
  )
}
