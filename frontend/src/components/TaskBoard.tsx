import { ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { Project, Role, Task } from '../api'
import { STATUS_LABEL } from '../api'
import { Avatar, Empty } from './common'

const COLUMNS = ['todo', 'in_progress', 'testing', 'done', 'needs_attention']
const EMPTY: Record<string, string> = {
  todo: 'Không có việc chờ', in_progress: 'Không ai đang làm', testing: 'Không có việc đang test',
  done: 'Chưa xong việc nào', needs_attention: 'Không có việc cần xem lại',
}
const GROUP_PREVIEW = 4  // mỗi nhóm trong cột Xong hiện trước 4 việc mới nhất

export function TaskBoard({ tasks, roles, projects, onOpenProject }: {
  tasks: Task[]; roles: Role[]; projects: Project[]; onOpenProject: (id: string) => void
}) {
  const roleBy = (k: string) => roles.find(r => r.key === k)
  const title = (id: string) => projects.find(p => p.id === id)?.title || id
  // Một dự án (trang chi tiết): gom việc đã xong theo vòng; nhiều dự án: gom theo dự án
  const single = new Set(tasks.map(t => t.project_id)).size <= 1
  if (!tasks.length) return <Empty>Chưa có công việc nào.</Empty>

  const card = (t: Task, showProject: boolean) => (
    <button key={t.id} onClick={() => onOpenProject(t.project_id)}
      className="w-full cursor-pointer rounded-lg border border-white/5 bg-ink-800 p-2.5 text-left transition hover:-translate-y-px hover:border-teal-400/40">
      <div className="text-xs font-medium leading-snug [overflow-wrap:anywhere]">{t.title}</div>
      {showProject && <div className="mt-1 truncate text-[10px] text-muted" title={title(t.project_id)}>{title(t.project_id)}</div>}
      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-400">
        <Avatar role={roleBy(t.assignee)} size={18} />
        {roleBy(t.assignee)?.name}
        <span className="ml-auto flex gap-1">
          {t.source === 'review' && <span className="rounded bg-rose-500/15 px-1.5 text-rose-300">kiểm duyệt</span>}
          {t.attempts > 1 && <span className="text-muted">lần {t.attempts}</span>}
        </span>
      </div>
    </button>
  )

  return (
    // Cột giữ bề rộng tối thiểu và cuộn ngang khi chật, thay vì bị bóp làm cắt tên việc
    <div className="grid gap-3 md:auto-cols-[minmax(13rem,1fr)] md:grid-flow-col md:overflow-x-auto md:pb-1 scroll-thin">
      {COLUMNS.map(col => {
        const list = tasks.filter(t => t.status === col).sort((a, b) => b.updated_at - a.updated_at)
        return (
          <section key={col} aria-label={STATUS_LABEL[col]} className="flex min-w-0 flex-col rounded-xl bg-ink-850 p-3">
            <h3 className={`label flex justify-between ${list.length ? 'mb-3' : 'md:mb-3'}`}><span>{STATUS_LABEL[col]}</span><span className="tabular-nums">{list.length}</span></h3>
            {!list.length ? (
              <div className="grid min-h-16 place-items-center rounded-lg border border-dashed max-md:hidden border-white/10 px-2 text-center text-[11px] text-muted">
                {EMPTY[col]}
              </div>
            ) : col === 'done' ? (
              <DoneGroups list={list} single={single} title={title} card={card} />
            ) : (
              <div className="flex flex-col gap-2">{list.slice(0, 40).map(t => card(t, !single))}</div>
            )}
          </section>
        )
      })}
    </div>
  )
}

/** Cột Xong: gom theo dự án (hoặc theo vòng), nhóm mới nhất mở sẵn, mỗi nhóm hiện 4 việc rồi "Xem thêm". */
function DoneGroups({ list, single, title, card }: {
  list: Task[]; single: boolean; title: (id: string) => string; card: (t: Task, showProject: boolean) => ReactNode
}) {
  const groups: { key: string; label: string; items: Task[] }[] = []
  for (const t of list) {  // list đã xếp mới nhất trước → nhóm cũng theo thứ tự đó
    const key = single ? `run-${t.run_no}` : t.project_id
    let g = groups.find(x => x.key === key)
    if (!g) groups.push(g = { key, label: single ? `Vòng ${t.run_no}` : title(t.project_id), items: [] })
    g.items.push(t)
  }
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  return (
    <div className="flex flex-col gap-2">
      {groups.map((g, i) => {
        const all = expanded[g.key]
        return (
          <details key={g.key} open={i === 0} className="group/d rounded-lg">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-1 py-1 text-[11px] text-slate-300 hover:bg-white/5">
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted transition group-open/d:rotate-90" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate" title={g.label}>{g.label}</span>
              <span className="tabular-nums text-muted">{g.items.length}</span>
            </summary>
            <div className="mt-1.5 flex flex-col gap-2">
              {(all ? g.items : g.items.slice(0, GROUP_PREVIEW)).map(t => card(t, false))}
              {g.items.length > GROUP_PREVIEW && (
                <button onClick={() => setExpanded(e => ({ ...e, [g.key]: !all }))}
                  className="cursor-pointer rounded-md py-1.5 text-[11px] text-teal-300 hover:bg-white/5">
                  {all ? 'Thu gọn' : `Xem thêm ${g.items.length - GROUP_PREVIEW} việc`}
                </button>
              )}
            </div>
          </details>
        )
      })}
    </div>
  )
}
