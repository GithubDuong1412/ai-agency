import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type AgencyEvent, type Config, type Overview } from './api'

export type AgentLive = {
  status: 'idle' | 'working'
  /** đang chờ model trả lời (đám mây "…" / dấu 3 chấm); false = đang thao tác (chạy tool) */
  thinking?: boolean
  projectId?: string
  lastText?: string
  lastAt?: number
  lastTool?: string
}

const REFRESH_TYPES = new Set(['task_update', 'project_status', 'report', 'plan', 'project_created', 'usage', 'review',
  'hiring_update', 'roster_changed'])
/** project_id của sự kiện chung (tuyển dụng, đổi nhân sự), không thuộc dự án nào */
export const AGENCY_PID = '_agency'

/** Tải config + overview, nghe SSE và suy ra trạng thái từng agent. */
export function useAgency() {
  const [config, setConfig] = useState<Config | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [events, setEvents] = useState<AgencyEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastId = useRef(0)
  const refreshTimer = useRef<number | undefined>(undefined)

  const refresh = useCallback(async () => {
    try {
      setOverview(await api.overview())
      setError(null)
    } catch (e) {
      setError(String((e as Error).message || e))
    }
  }, [])

  const scheduleRefresh = useCallback(() => {
    window.clearTimeout(refreshTimer.current)
    refreshTimer.current = window.setTimeout(refresh, 400)
  }, [refresh])

  useEffect(() => {
    api.config().then(setConfig).catch(e => setError(String(e.message || e)))
    refresh()
    let es: EventSource | null = null
    let cancelled = false
    api.history(0).then(h => {
      if (cancelled) return
      setEvents(h)
      lastId.current = h.length ? h[h.length - 1].id : 0
      es = new EventSource(`/api/events?after=${lastId.current}`)
      es.onopen = () => setConnected(true)
      es.onerror = () => setConnected(false)
      es.onmessage = msg => {
        const ev: AgencyEvent = JSON.parse(msg.data)
        if (ev.id <= lastId.current) return
        lastId.current = ev.id
        setEvents(prev => (prev.length > 1500 ? [...prev.slice(-1000), ev] : [...prev, ev]))
        if (REFRESH_TYPES.has(ev.type)) scheduleRefresh()
        // tuyển / sửa / cho nghỉ nhân sự: tải lại danh sách đội (văn phòng, thanh bên, hồ sơ)
        if (ev.type === 'roster_changed') api.config().then(setConfig).catch(() => {})
      }
    }).catch(() => setConnected(false))
    return () => { cancelled = true; es?.close() }
  }, [refresh, scheduleRefresh])

  const live = useMemo(() => {
    const m: Record<string, AgentLive> = {}
    for (const ev of events) {
      if (!ev.agent || ev.agent === 'owner') continue
      const a = (m[ev.agent] ||= { status: 'idle' })
      if (ev.type === 'agent_status') {
        // backend: thinking (chờ model) | working (chạy tool) | idle; nơi khác chỉ cần biết có đang làm không
        a.status = ev.data.status === 'idle' ? 'idle' : 'working'
        a.thinking = ev.data.status === 'thinking'
        a.projectId = ev.project_id
      } else if (ev.type === 'message') {
        a.lastText = ev.data.text
        a.lastAt = ev.created_at
      } else if (ev.type === 'tool') {
        a.lastTool = `${ev.data.tool}: ${ev.data.summary}`
        a.lastAt = ev.created_at
      }
    }
    // dự án bị dừng / lỗi → mọi người về trạng thái rảnh
    const running = new Set(overview?.projects.filter(p => p.running).map(p => p.id))
    // (việc chung như soạn đề xuất tuyển dụng không thuộc dự án: giữ theo agent_status)
    for (const a of Object.values(m)) if (a.projectId && a.projectId !== AGENCY_PID && !running.has(a.projectId)) { a.status = 'idle'; a.thinking = false }
    return m
  }, [events, overview])

  const reloadConfig = useCallback(() => api.config().then(setConfig).catch(() => {}), [])
  return { config, overview, events, live, connected, error, refresh, reloadConfig }
}
