import type { Role } from '../api'
import type { AgentLive } from '../store'
import type { TypingAgent } from './Timeline'

/** Người đang làm hoặc đang suy nghĩ (theo thứ tự đội), lọc theo dự án nếu có. */
export function typingIn(live: Record<string, AgentLive>, roles: Role[], projectId?: string): TypingAgent[] {
  return roles
    .filter(r => live[r.key]?.status === 'working' && (!projectId || live[r.key]?.projectId === projectId))
    .map(r => ({ role: r, thinking: !!live[r.key]?.thinking }))
}
