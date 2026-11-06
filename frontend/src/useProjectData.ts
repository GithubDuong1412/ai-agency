import { useCallback, useEffect, useState } from 'react'
import { api, type AgencyEvent, type Project, type Report, type Task } from './api'

export type ProjectData = { project: Project; tasks: Task[]; reports: Report[] }

/** Tải dữ liệu một dự án và tự tải lại khi có sự kiện mới. id = null thì trả null.
 *  Dùng chung cho ProjectDetail và thanh góp ý của Sếp ở đáy màn hình. */
export function useProjectData(id: string | null, events: AgencyEvent[]) {
  const [data, setData] = useState<ProjectData | null>(null)
  const pEvents = id ? events.filter(e => e.project_id === id) : []
  const lastEventId = pEvents.length ? pEvents[pEvents.length - 1].id : 0
  const reload = useCallback(async () => {
    if (!id) { setData(null); return }
    setData(await api.project(id))
  }, [id])
  useEffect(() => { reload() }, [reload, lastEventId])
  return { data: data && data.project.id === id ? data : null, reload }
}
