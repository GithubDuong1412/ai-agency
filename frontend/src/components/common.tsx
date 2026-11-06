import type { ReactNode } from 'react'
import { STATUS_COLOR, STATUS_LABEL, type Role } from '../api'

export function Avatar({ role, size = 28, ring = false }: { role?: Role; size?: number; ring?: boolean }) {
  const initials = role ? role.name.slice(0, 1).toUpperCase() : 'S'
  const color = role?.color || '#f8fafc'
  return (
    <div
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-ink-950 ${ring ? 'ring-2 ring-white/70' : ''}`}
      style={{ width: size, height: size, background: color, fontSize: size * 0.42 }}
      title={role ? `${role.name} · ${role.title}` : 'Sếp'}
    >
      {initials}
    </div>
  )
}

export function StatusDot({ status, pulse }: { status: string; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2">
      {pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${STATUS_COLOR[status] || 'bg-slate-500'}`} />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${STATUS_COLOR[status] || 'bg-slate-500'}`} />
    </span>
  )
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">
      <StatusDot status={status} pulse={status === 'running' || status === 'in_progress' || status === 'testing'} />
      {STATUS_LABEL[status] || status}
    </span>
  )
}

export function Button({ children, onClick, variant = 'ghost', disabled, className = '', type = 'button' }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger' | 'subtle'
  disabled?: boolean; className?: string; type?: 'button' | 'submit'
}) {
  const styles = {
    primary: 'bg-teal-400 text-ink-950 hover:bg-teal-300',
    ghost: 'border border-white/10 text-slate-200 hover:bg-white/5',
    danger: 'border border-rose-400/40 text-rose-300 hover:bg-rose-500/10',
    subtle: 'bg-white/5 text-slate-200 hover:bg-white/10',
  }[variant]
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}>
      {children}
    </button>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="grid place-items-center rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-muted">{children}</div>
}
