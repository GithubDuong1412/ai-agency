import type { Role } from './api'

const TOKEN = /\{@([a-z_]+)\}/g
let ownerName = 'Sếp'

/** App gọi khi tải config để {@owner} hiện đúng cách xưng hô với chủ agency. */
export function setOwnerName(name?: string | null) {
  if (name) ownerName = name
}

/**
 * Câu chữ của hệ thống/agent nhắc đồng đội bằng mã vai trò, vd. "nhờ {@designer} lên thiết kế".
 * Khi hiển thị, thay mã bằng tên hiện tại trong config, nên đổi tên nhân vật thì mọi câu (kể cả cũ) đổi theo.
 * {@owner} là Sếp. Mã không có trong đội được giữ nguyên dạng chữ (bỏ ngoặc).
 */
export function fillNames(text: string, roles: Role[]): string {
  if (!text || !text.includes('{@')) return text
  return text.replace(TOKEN, (_, key: string) => key === 'owner' ? ownerName : roles.find(r => r.key === key)?.name ?? key)
}
