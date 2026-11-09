import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type AgencyEvent } from './api'

/** Loại sự kiện tab Hội thoại hiển thị (khớp SHOWN trong Timeline) */
export const CHAT_TYPES = ['message', 'handoff', 'plan', 'review', 'report', 'project_status', 'tool', 'design']
const PAGE = 300

/** Lịch sử hội thoại riêng của một dự án: nạp trang mới nhất, loadOlder() nạp trang cũ hơn,
 *  gộp với sự kiện realtime của dự án từ store (bỏ trùng theo id). */
export function useProjectHistory(id: string, liveEvents: AgencyEvent[]) {
  const [older, setOlder] = useState<AgencyEvent[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const busy = useRef(false)
  const currentId = useRef(id)
  currentId.current = id

  useEffect(() => {
    let cancelled = false
    setOlder([]); setHasMore(false); setLoaded(false)
    busy.current = true
    api.projectHistory(id, 0, CHAT_TYPES, PAGE)
      .then(r => { if (!cancelled) { setOlder(r.events); setHasMore(r.has_more) } })
      .catch(() => { /* vẫn còn sự kiện realtime trong store */ })
      .finally(() => { if (!cancelled) { busy.current = false; setLoaded(true) } })
    return () => { cancelled = true }
  }, [id])

  const live = useMemo(() => liveEvents.filter(e => e.project_id === id), [liveEvents, id])
  const events = useMemo(() => {
    const byId = new Map<number, AgencyEvent>()
    for (const e of older) byId.set(e.id, e)
    for (const e of live) byId.set(e.id, e)
    return [...byId.values()].sort((a, b) => a.id - b.id)
  }, [older, live])

  const loadOlder = useCallback(async () => {
    if (busy.current || !hasMore) return
    const oldest = older[0]?.id
    if (!oldest) return
    busy.current = true
    setLoadingOlder(true)
    const forId = id
    try {
      const r = await api.projectHistory(id, oldest, CHAT_TYPES, PAGE)
      if (currentId.current !== forId) return  // đã chuyển sang dự án khác trong lúc tải
      setOlder(prev => [...r.events, ...prev])
      setHasMore(r.has_more)
    } catch {
      /* lỗi mạng: lần cuộn sau thử lại */
    } finally {
      busy.current = false
      setLoadingOlder(false)
    }
  }, [id, older, hasMore])

  return { events, hasMore, loadingOlder, loaded, loadOlder }
}
