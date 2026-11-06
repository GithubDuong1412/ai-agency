export type Role = {
  key: string; name: string; title: string; department: string; color: string; model: string; effort: string
}
export type Project = {
  id: string; title: string; prompt: string; status: string; spec: string | null; run_count: number
  input_tokens: number; output_tokens: number; cost_usd: number; error: string | null
  created_at: number; updated_at: number; running: boolean; preview_url: string | null
}
export type Task = {
  id: string; project_id: string; title: string; description: string; assignee: string; status: string
  source: string; run_no: number; attempts: number; created_at: number; updated_at: number
}
export type Issue = { title: string; detail: string; assignee: string; severity: string }
export type ReportContent = {
  headline: string; summary_markdown: string; how_to_check: string[]; known_issues: string[]; next_steps: string[]
  verdict?: string; score?: number; review_summary?: string; open_issues?: Issue[]; preview_url?: string | null
  screenshots?: string[]; run_no?: number; cost_usd?: number
  tasks?: { task: string; assignee: string; attempts: number; passed: boolean; work?: string; qa?: string }[]
}
export type Report = {
  id: string; project_id: string; run_no: number; content: ReportContent; status: string
  feedback: string | null; created_at: number; project_title?: string
}
export type AgencyEvent = {
  id: number; project_id: string; type: string; agent: string | null; data: Record<string, any>; created_at: number
}
export type Config = {
  agency_name: string; owner_name: string; agency_tagline?: string | null; owner_display?: string | null; roles: Role[]; has_api_key: boolean; demo?: boolean
  limits: Record<string, number>
}
export type Overview = {
  stats: { staff: number; running_projects: number; open_tasks: number; pending_reviews: number; cost_usd: number }
  projects: Project[]; tasks: Task[]; pending_reports: Report[]
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  if (!res.ok) {
    let msg = res.statusText
    try { msg = (await res.json()).detail || msg } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.json()
}

export const api = {
  config: () => req<Config>('/api/config'),
  overview: () => req<Overview>('/api/overview'),
  project: (id: string) => req<{ project: Project; tasks: Task[]; reports: Report[] }>(`/api/projects/${id}`),
  create: (prompt: string) => req<Project>('/api/projects', { method: 'POST', body: JSON.stringify({ prompt }) }),
  stop: (id: string) => req(`/api/projects/${id}/stop`, { method: 'POST' }),
  approve: (id: string, feedback = '') =>
    req(`/api/projects/${id}/approve`, { method: 'POST', body: JSON.stringify({ feedback }) }),
  revise: (id: string, feedback: string) =>
    req(`/api/projects/${id}/revise`, { method: 'POST', body: JSON.stringify({ feedback }) }),
  resume: (id: string, feedback = '') =>
    req(`/api/projects/${id}/resume`, { method: 'POST', body: JSON.stringify({ feedback }) }),
  preview: (id: string) => req<{ url: string }>(`/api/projects/${id}/preview`, { method: 'POST' }),
  versions: (id: string) => req<{ available: boolean; versions: Version[] }>(`/api/projects/${id}/versions`),
  versionDiff: (id: string, sha: string) => req<{ files: VersionFile[] }>(`/api/projects/${id}/versions/${sha}/diff`),
  restoreVersion: (id: string, sha: string) =>
    req<{ ok: boolean; sha: string }>(`/api/projects/${id}/versions/${sha}/restore`, { method: 'POST' }),
  files: (id: string) => req<{ files: { path: string; size: number }[] }>(`/api/projects/${id}/files`),
  file: (id: string, path: string) =>
    req<{ content: string }>(`/api/projects/${id}/file?path=${encodeURIComponent(path)}`),
  history: (after = 0, projectId?: string) =>
    req<AgencyEvent[]>(`/api/events/history?after=${after}&limit=400${projectId ? `&project_id=${projectId}` : ''}`),
}

export type Version = {
  sha: string; time: number; title: string; run_no: number | null
  files: number; insertions: number; deletions: number; current: boolean
}
export type VersionFile = {
  path: string; status: 'added' | 'modified' | 'deleted' | 'renamed'; insertions: number; deletions: number
  binary: boolean; patch: string | null; truncated?: boolean
}

export type ProfileFile = { path: string; exists: boolean; size: number; title: string }
export type ProfileScope = {
  key: string; name: string; title: string; color: string; files: ProfileFile[]; skills?: string[]
}
export type SkillInfo = {
  name: string; description: string; source: 'agency' | 'machine'; path: string; files: number; size: number
  scripts: string[]; assigned_to: string[]; installed: boolean; on_machine: boolean
}
export const skillsApi = {
  list: () => req<{ skills: SkillInfo[]; assignments: Record<string, string[]>; agency_dir: string; machine_dir: string }>('/api/skills'),
  doc: (name: string) => req<{ content: string }>(`/api/skills/${encodeURIComponent(name)}/doc`),
  install: (body: { name?: string; path?: string; overwrite?: boolean }) =>
    req<SkillInfo>('/api/skills/install', { method: 'POST', body: JSON.stringify(body) }),
  uninstall: (name: string) => req(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  assign: (role: string, skills: string[]) =>
    req<{ skills: string[] }>(`/api/profiles/${role}/skills`, { method: 'PUT', body: JSON.stringify({ skills }) }),
}

const q = encodeURIComponent
export const profilesApi = {
  list: () => req<ProfileScope[]>('/api/profiles'),
  read: (scope: string, path: string) => req<{ content: string }>(`/api/profiles/${scope}/file?path=${q(path)}`),
  save: (scope: string, path: string, content: string) =>
    req(`/api/profiles/${scope}/file`, { method: 'PUT', body: JSON.stringify({ path, content }) }),
  remove: (scope: string, path: string) => req(`/api/profiles/${scope}/file?path=${q(path)}`, { method: 'DELETE' }),
  prompt: (role: string) => req<{ prompt: string; chars: number }>(`/api/profiles/${role}/prompt`),
}

export const screenshotUrl = (pid: string, name: string) => `/api/projects/${pid}/screenshots/${name}`

export const STATUS_LABEL: Record<string, string> = {
  queued: 'Đang chờ', running: 'Đang làm', awaiting_approval: 'Chờ duyệt', approved: 'Đã duyệt',
  failed: 'Lỗi', stopped: 'Đã dừng', interrupted: 'Gián đoạn',
  todo: 'Chưa làm', in_progress: 'Đang làm', testing: 'Đang test', done: 'Xong', needs_attention: 'Cần xem lại',
}

export const STATUS_COLOR: Record<string, string> = {
  queued: 'bg-slate-500', running: 'bg-sky-400', awaiting_approval: 'bg-amber-400', approved: 'bg-emerald-400',
  failed: 'bg-rose-500', stopped: 'bg-slate-400', interrupted: 'bg-orange-400',
  todo: 'bg-slate-500', in_progress: 'bg-sky-400', testing: 'bg-violet-400', done: 'bg-emerald-400',
  needs_attention: 'bg-rose-500',
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Date.now() / 1000 - ts)
  if (s < 60) return 'vừa xong'
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`
  return new Date(ts * 1000).toLocaleDateString('vi-VN')
}

export function clock(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}
