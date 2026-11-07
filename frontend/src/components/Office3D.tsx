import { fillNames } from '../names'
import { GizmoHelper, GizmoViewport, OrbitControls, QuadraticBezierLine } from '@react-three/drei'
import { Html } from '../vendor/drei-html'  // Html của drei, vá lỗi gỡ nhãn khi rời sơ đồ 3D (React 19)
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import * as THREE from 'three'

type OrbitControlsImpl = ComponentRef<typeof OrbitControls>
import type { AgencyEvent, Config, Overview, Role } from '../api'
import type { AgentLive } from '../store'

/** Vùng màn hình không bị panel nổi che (px, tính từ mép canvas). */
export type SafeArea = { left: number; top: number; right: number; bottom: number }

type Props = {
  config: Config | null; overview: Overview | null; live: Record<string, AgentLive>; events: AgencyEvent[]
  picked: Role | null; onPickAgent: (role: Role) => void; safe: SafeArea; fitSignal: number
  /** Tạm dừng: chỉ vẽ lại khi người dùng xoay/zoom (frameloop demand), nhân vật đứng yên */
  paused?: boolean
}

// ---------- bố cục ----------
const SEAT = 3.8        // khoảng cách giữa 2 bàn
const ROOM_D = 8        // chiều sâu phòng
const ROOM_PAD = 2.8    // khoảng trống hai bên dãy bàn trong phòng ban
const GAP = 2.2         // lối đi giữa các phòng

const LOBBY_MIN_D = 7   // chiều sâu tối thiểu của sảnh

// Tông "kem ấm + gỗ"
const WALL_CREAM = '#ede6da'   // tường bao
const WALL_IVORY = '#f6f1e8'   // tường phòng
const WOOD = '#a0704a'         // chân tường, khung cửa, quầy
const GLASS = '#bfe3f2'        // kính cửa sổ, vách kính
const LOBBY_FLOOR = '#c9a57a'  // sàn gỗ sảnh
const ACCENT = '#2dd4bf'       // viền teal

type Seat = { role: Role; x: number; z: number }
/** lead = phòng riêng Trưởng dự án (giữa hàng sau); left/right = cột phòng ban hai bên sảnh */
type Room = {
  name: string; color: string; x: number; z: number; w: number; d: number; seats: Seat[]
  kind: 'lead' | 'dept'; side: 'back' | 'left' | 'right'
}
type Rect = { x: number; z: number; w: number; d: number }

/**
 * Bố cục: phòng Trưởng dự án (phòng ban có role `pm`) ở giữa hàng sau; các phòng ban còn lại chia xen kẽ
 * hai cột trái/phải (theo thứ tự trong config); sảnh là khoảng giữa hai cột, trước phòng Trưởng dự án.
 */
function layout(roles: Role[]): { rooms: Room[]; lobby: Rect; extentX: number; extentZ: number } {
  const deps = [...new Set(roles.map(r => r.department))]
  const leadDep = roles.find(r => r.key === 'pm')?.department ?? deps[0]
  const others = deps.filter(d => d !== leadDep)
  const members = (d: string) => roles.filter(m => m.department === d)
  const deptW = (d: string) => Math.max(2, members(d).length) * SEAT + ROOM_PAD
  const left = others.filter((_, i) => i % 2 === 0), right = others.filter((_, i) => i % 2 === 1)
  const colW = Math.max(SEAT * 2 + ROOM_PAD, ...others.map(deptW))
  const leadW = Math.max(2, leadDep ? members(leadDep).length : 1) * SEAT + 5
  const rows = Math.max(1, left.length, right.length)
  const totalW = colW * 2 + leadW + GAP * 2
  const totalD = Math.max(rows * ROOM_D + (rows - 1) * GAP, ROOM_D + GAP + LOBBY_MIN_D)
  const top = -totalD / 2

  const mk = (name: string, x: number, z: number, w: number, kind: Room['kind'], side: Room['side']): Room => {
    const ms = members(name)
    const span = (ms.length - 1) * SEAT
    const seats = ms.map((role, k) => ({ role, x: x - span / 2 + k * SEAT, z: z + 0.2 }))
    return { name, color: ms[0]?.color || '#64748b', x, z, w, d: ROOM_D, seats, kind, side }
  }
  const rooms: Room[] = []
  if (leadDep) rooms.push(mk(leadDep, 0, top + ROOM_D / 2, leadW, 'lead', 'back'))
  const colX = (s: 'left' | 'right') => (s === 'left' ? -1 : 1) * (leadW / 2 + GAP + colW / 2)
  for (const [list, s] of [[left, 'left'], [right, 'right']] as const) {
    list.forEach((name, r) => rooms.push(mk(name, colX(s), top + r * (ROOM_D + GAP) + ROOM_D / 2, deptW(name), 'dept', s)))
  }
  const lobbyZ0 = top + ROOM_D + GAP
  const lobby = { x: 0, z: (lobbyZ0 + totalD / 2) / 2, w: leadW + GAP, d: totalD / 2 - lobbyZ0 }
  return { rooms, lobby, extentX: totalW, extentZ: totalD }
}

/** Pha màu phòng ban vào nền trắng ngà cho vách sau (nhạt, vẫn nhận ra phòng). */
const tint = (color: string, amount = 0.16) => '#' + new THREE.Color(WALL_IVORY).lerp(new THREE.Color(color), amount).getHexString()

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// ---------- vật thể ----------
function Plant({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh castShadow position={[0, 0.25, 0]}><cylinderGeometry args={[0.28, 0.22, 0.5, 12]} /><meshStandardMaterial color="#e7e1d6" /></mesh>
      <mesh castShadow position={[0, 0.85, 0]}><icosahedronGeometry args={[0.45, 0]} /><meshStandardMaterial color="#3f9b58" flatShading /></mesh>
      <mesh castShadow position={[0.15, 1.25, 0.05]}><icosahedronGeometry args={[0.3, 0]} /><meshStandardMaterial color="#4fb36a" flatShading /></mesh>
    </group>
  )
}

const WALL_H = 1.3

/** Vách kính trong suốt có khung gỗ mảnh ở mép trên. */
function GlassWall({ position, size }: { position: [number, number, number]; size: [number, number, number] }) {
  const [px, py, pz] = position, [sx, sy, sz] = size
  return (
    <group>
      <mesh position={position}><boxGeometry args={size} /><meshStandardMaterial color={GLASS} transparent opacity={0.28} depthWrite={false} /></mesh>
      <mesh position={[px, py + sy / 2 + 0.03, pz]}><boxGeometry args={[Math.max(sx, 0.08), 0.06, Math.max(sz, 0.08)]} /><meshStandardMaterial color={WOOD} /></mesh>
    </group>
  )
}

function Sofa({ position, rotation = 0, color = '#5b7c99' }: { position: [number, number, number]; rotation?: number; color?: string }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh castShadow position={[0, 0.3, 0]}><boxGeometry args={[2, 0.4, 0.9]} /><meshStandardMaterial color={color} /></mesh>
      <mesh castShadow position={[0, 0.65, -0.35]}><boxGeometry args={[2, 0.5, 0.2]} /><meshStandardMaterial color={color} /></mesh>
      {[-0.95, 0.95].map(dx => <mesh key={dx} castShadow position={[dx, 0.45, 0]}><boxGeometry args={[0.15, 0.4, 0.9]} /><meshStandardMaterial color={color} /></mesh>)}
    </group>
  )
}

/**
 * Một phòng ban. Tường đặc chỉ ở phía sau (−Z) và phía ngoài bên trái (−X): camera nhìn từ góc +X +Z nên
 * các tường này không che gì. Cạnh hướng sảnh / hướng camera là vách kính thấp hoặc tường lửng.
 */
function RoomBlock({ room }: { room: Room }) {
  const { x, z, w, d, color, name, kind, side } = room
  const back = tint(color)
  const zB = z - d / 2 + 0.08, xL = x - w / 2 + 0.08, xR = x + w / 2 - 0.08, zF = z + d / 2 - 0.08
  const lead = kind === 'lead'
  return (
    <group>
      {/* sàn phòng + sọc màu phòng ở mép trước */}
      <mesh receiveShadow position={[x, 0.1, z]}><boxGeometry args={[w, 0.2, d]} /><meshStandardMaterial color={lead ? '#f3ede2' : '#eef1ee'} /></mesh>
      <mesh position={[x, 0.205, z + d / 2 - 0.12]}><boxGeometry args={[w, 0.01, 0.24]} /><meshStandardMaterial color={color} /></mesh>
      {/* vách sau: tô nhạt màu phòng ban + viền màu */}
      <mesh castShadow receiveShadow position={[x, 0.2 + WALL_H / 2, zB]}><boxGeometry args={[w, WALL_H, 0.16]} /><meshStandardMaterial color={back} /></mesh>
      <mesh position={[x, 0.2 + WALL_H + 0.03, zB]}><boxGeometry args={[w, 0.06, 0.18]} /><meshStandardMaterial color={color} /></mesh>
      <mesh position={[x, 0.32, zB + 0.09]}><boxGeometry args={[w, 0.24, 0.02]} /><meshStandardMaterial color={WOOD} /></mesh>
      {/* cạnh trái */}
      {side === 'right'
        ? <GlassWall position={[xL, 0.2 + WALL_H / 2, z]} size={[0.06, WALL_H, d]} />
        : <>
            <mesh castShadow receiveShadow position={[xL, 0.2 + WALL_H / 2, z]}><boxGeometry args={[0.16, WALL_H, d]} /><meshStandardMaterial color={WALL_IVORY} /></mesh>
            <mesh position={[xL, 0.2 + WALL_H + 0.03, z]}><boxGeometry args={[0.18, 0.06, d]} /><meshStandardMaterial color={color} /></mesh>
          </>}
      {/* cạnh phải: phòng bên phải là tường ngoài nhưng thấp (không che); còn lại là vách kính thấp */}
      {side === 'right'
        ? <mesh castShadow position={[xR, 0.45, z]}><boxGeometry args={[0.16, 0.5, d]} /><meshStandardMaterial color={WALL_IVORY} /></mesh>
        : <GlassWall position={[xR, 0.55, z]} size={[0.06, 0.7, d]} />}
      {/* phòng Trưởng dự án: vách kính thấp phía trước, chừa cửa ở giữa ra sảnh */}
      {lead && [-1, 1].map(s => (
        <GlassWall key={s} position={[x + s * (w / 4 + 0.6), 0.55, zF]} size={[w / 2 - 1.2, 0.7, 0.06]} />
      ))}
      {lead && <>
        <Sofa position={[x + w / 2 - 1.5, 0.2, z + d / 2 - 1.3]} rotation={Math.PI} color="#8b5e3c" />
        {/* kệ sách gỗ sát vách sau */}
        <mesh castShadow position={[x - w / 2 + 1.2, 0.95, zB + 0.35]}><boxGeometry args={[1.6, 1.5, 0.45]} /><meshStandardMaterial color={WOOD} /></mesh>
        {[0.55, 1.0, 1.45].map(y => <mesh key={y} position={[x - w / 2 + 1.2, y, zB + 0.58]}><boxGeometry args={[1.4, 0.04, 0.02]} /><meshStandardMaterial color="#f2e6d0" /></mesh>)}
      </>}
      <Plant position={[x + w / 2 - 0.6, 0.2, z - d / 2 + 0.6]} />
      {/* phòng Trưởng dự án: biển tên giữa đỉnh vách sau; phòng ban: nhãn trên đỉnh vách trái */}
      <Html position={lead ? [x, 2.0, zB] : [x - w / 2 + 0.08, 1.75, z]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`flex items-center max-sm:hidden gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-medium shadow-lg ${lead ? 'bg-amber-300 text-ink-950' : 'bg-ink-900/95 text-slate-100'}`}>
          <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: lead ? '#0b1220' : color }} aria-hidden="true" />
          {lead ? 'Phòng Trưởng dự án' : name}
          <span className={lead ? 'text-ink-800' : 'text-slate-400'}>{lead ? name : room.seats.length}</span>
        </div>
      </Html>
    </group>
  )
}

/** Sảnh giữa: sàn gỗ, thảm tròn, quầy lễ tân có biển tên, 2 sofa đối diện, cây xanh ở góc. */
function Lobby({ rect }: { rect: Rect }) {
  const { x, z, w, d } = rect
  const r = Math.max(1.5, Math.min(w, d) * 0.32)
  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.015, z]}><planeGeometry args={[w, d]} /><meshStandardMaterial color={LOBBY_FLOOR} /></mesh>
      {/* thảm tròn teal, viền sáng */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.03, z + 0.4]}><circleGeometry args={[r + 0.15, 48]} /><meshStandardMaterial color="#7fe3d4" /></mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.035, z + 0.4]}><circleGeometry args={[r, 48]} /><meshStandardMaterial color="#2a9d8f" /></mesh>
      {/* quầy lễ tân ở cuối sảnh, ngay trước phòng Trưởng dự án */}
      <group position={[x, 0, z - d / 2 + 1.1]}>
        <mesh castShadow position={[0, 0.5, 0]}><boxGeometry args={[3.4, 1, 0.9]} /><meshStandardMaterial color={WOOD} /></mesh>
        <mesh castShadow position={[0, 1.03, 0]}><boxGeometry args={[3.6, 0.06, 1]} /><meshStandardMaterial color="#f8f4ec" /></mesh>
        <mesh position={[0, 0.55, 0.46]}><boxGeometry args={[1.6, 0.35, 0.02]} /><meshBasicMaterial color={ACCENT} /></mesh>
        <Html position={[0, 1.6, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
          <div className="whitespace-nowrap rounded-md bg-ink-900/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-teal-200 shadow max-sm:hidden">Sảnh · Lễ tân</div>
        </Html>
      </group>
      <Sofa position={[x - r - 0.4, 0.02, z + 0.4]} rotation={Math.PI / 2} />
      <Sofa position={[x + r + 0.4, 0.02, z + 0.4]} rotation={-Math.PI / 2} />
      <Plant position={[x - w / 2 + 0.7, 0.02, z + d / 2 - 0.7]} />
      <Plant position={[x + w / 2 - 0.7, 0.02, z + d / 2 - 0.7]} />
    </group>
  )
}

function Desk({ seat, working, highlight, selected, bubble, task, onPick }: {
  seat: Seat; working: boolean; highlight: boolean; selected: boolean; bubble: string | null; task?: string
  onPick: () => void
}) {
  const body = useRef<THREE.Group>(null)
  const screen = useRef<THREE.MeshStandardMaterial>(null)
  const [hover, setHover] = useState(false)
  const still = useMemo(reducedMotion, [])
  const { role, x, z } = seat

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    if (body.current) body.current.position.y = working && !still ? Math.abs(Math.sin(t * 4 + x)) * 0.08 : 0
    if (screen.current) screen.current.emissiveIntensity = working ? 0.9 + (still ? 0 : Math.sin(t * 6 + x) * 0.25) : 0.05
  })
  useEffect(() => { document.body.style.cursor = hover ? 'pointer' : ''; return () => { document.body.style.cursor = '' } }, [hover])

  const ring = highlight ? '#fbbf24' : selected ? '#5eead4' : hover ? '#ffffff' : null
  return (
    <group position={[x, 0.2, z]}
      onClick={e => { e.stopPropagation(); onPick() }}
      onPointerOver={e => { e.stopPropagation(); setHover(true) }}
      onPointerOut={() => setHover(false)}>
      {ring && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0.4]}>
          <ringGeometry args={[1.15, 1.35, 40]} /><meshBasicMaterial color={ring} transparent opacity={0.9} />
        </mesh>
      )}
      {/* bàn */}
      <mesh castShadow receiveShadow position={[0, 0.75, -0.3]}><boxGeometry args={[2.2, 0.12, 1.1]} /><meshStandardMaterial color="#ffffff" /></mesh>
      {[-0.95, 0.95].map(dx => (
        <mesh key={dx} castShadow position={[dx, 0.35, -0.3]}><boxGeometry args={[0.1, 0.7, 1]} /><meshStandardMaterial color="#c9cfc8" /></mesh>
      ))}
      {/* màn hình: mặt sáng hướng về camera */}
      <mesh castShadow position={[0, 1.25, -0.6]}><boxGeometry args={[1.2, 0.75, 0.08]} /><meshStandardMaterial color="#142033" /></mesh>
      <mesh position={[0, 1.25, -0.555]}>
        <planeGeometry args={[1.08, 0.63]} />
        <meshStandardMaterial ref={screen} color={working ? '#7dd3fc' : '#2a3b57'} emissive="#38bdf8" emissiveIntensity={0.05} />
      </mesh>
      <mesh position={[0, 0.88, -0.6]}><boxGeometry args={[0.12, 0.2, 0.12]} /><meshStandardMaterial color="#142033" /></mesh>
      {/* ghế */}
      <mesh castShadow position={[0, 0.45, 0.75]}><boxGeometry args={[0.8, 0.1, 0.8]} /><meshStandardMaterial color="#334155" /></mesh>
      <mesh castShadow position={[0, 0.85, 1.12]}><boxGeometry args={[0.8, 0.75, 0.1]} /><meshStandardMaterial color="#334155" /></mesh>
      {/* nhân vật: quay lưng về camera, nhìn vào màn hình */}
      <group ref={body} position={[0, 0, 0.65]}>
        <mesh castShadow position={[0, 0.95, 0]}><capsuleGeometry args={[0.32, 0.45, 4, 12]} /><meshStandardMaterial color={role.color} /></mesh>
        <mesh castShadow position={[0, 1.6, 0]}><sphereGeometry args={[0.3, 20, 16]} /><meshStandardMaterial color="#f2c9a0" /></mesh>
        <mesh castShadow position={[0, 1.7, 0.05]}><sphereGeometry args={[0.31, 20, 16, 0, Math.PI * 2, 0, Math.PI / 1.9]} /><meshStandardMaterial color="#3b2a20" /></mesh>
      </group>

      <Html position={[0, 0, 1.9]} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
        <div className="whitespace-nowrap rounded-md bg-ink-900/90 px-2 py-0.5 text-center text-[11px] leading-tight text-white shadow">
          <span className="font-semibold">{role.name}</span><span className="ml-1 text-slate-300 max-sm:hidden">· {role.title}</span>
        </div>
      </Html>
      {task && (
        <Html position={[0, 2.25, -0.6]} center zIndexRange={[6, 0]} style={{ pointerEvents: 'none' }}>
          <div className="max-w-44 truncate rounded-md bg-ink-900 px-2 py-1 text-[10px] text-teal-200 shadow-lg"><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-teal-300 align-middle" aria-hidden="true" />{task}</div>
        </Html>
      )}
      {bubble && (
        <Html position={[0, 2.6, 0.65]} zIndexRange={[8, 0]} style={{ pointerEvents: 'none', transform: 'translate(-20%, -100%)' }}>
          <div className="animate-pop w-56 rounded-xl bg-white p-2 text-[11px] leading-snug text-slate-800 shadow-xl">
            <div className="mb-0.5 text-[10px] text-slate-600">{role.name} · {role.title}</div>
            <div className="line-clamp-2">{bubble}</div>
          </div>
        </Html>
      )}
    </group>
  )
}

/** Luồng bàn giao: vòng cung sáng nối 2 bàn, có "phong bì" chạy dọc theo. */
function HandoffArc({ from, to, color }: { from: Seat; to: Seat; color: string }) {
  const token = useRef<THREE.Mesh>(null)
  const still = useMemo(reducedMotion, [])
  const a = useMemo(() => new THREE.Vector3(from.x, 2.4, from.z + 0.65), [from])
  const b = useMemo(() => new THREE.Vector3(to.x, 2.4, to.z + 0.65), [to])
  const mid = useMemo(() => a.clone().lerp(b, 0.5).setY(2.4 + Math.min(6, a.distanceTo(b) * 0.35)), [a, b])
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(a, mid, b), [a, mid, b])
  useFrame(({ clock }) => {
    if (!token.current) return
    const t = still ? 0.5 : (clock.getElapsedTime() * 0.45) % 1
    token.current.position.copy(curve.getPoint(t))
  })
  return (
    <group>
      <QuadraticBezierLine start={a} end={b} mid={mid} color="#fbbf24" lineWidth={3} dashed dashSize={0.4} gapSize={0.25} />
      <mesh ref={token}><boxGeometry args={[0.45, 0.3, 0.06]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} /></mesh>
    </group>
  )
}

// ---------- nền tổng theo 3 trục ----------
const BD_PAD = 1      // lề bệ quanh các phòng
const BD_WALL_H = 3.4   // chiều cao 2 vách sau
const BD_STEP = 1.6     // bước lưới (nửa khoảng cách bàn)
const AXIS = { x: '#f87171', y: '#4ade80', z: '#60a5fa' }

type Box = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }
type Ax = 'x' | 'y' | 'z'

function backdropBox(extentX: number, extentZ: number): Box {
  const w = extentX / 2 + BD_PAD, d = extentZ / 2 + BD_PAD
  return { x0: -w, x1: w, y0: 0, y1: BD_WALL_H, z0: -d, z1: d }
}

/** Lưới trên một mặt phẳng (2 trục a, b; trục còn lại cố định): cặp điểm cho lineSegments. */
function gridLines(axA: Ax, a0: number, a1: number, axB: Ax, b0: number, b1: number, fixed: Partial<Record<Ax, number>>) {
  const pts: number[] = []
  const P = (a: number, b: number) => {
    const v: Record<Ax, number> = { x: 0, y: 0, z: 0, ...fixed }
    v[axA] = a; v[axB] = b
    pts.push(v.x, v.y, v.z)
  }
  for (let a = a0; a <= a1 + 1e-6; a += BD_STEP) { P(a, b0); P(a, b1) }
  for (let b = b0; b <= b1 + 1e-6; b += BD_STEP) { P(a0, b); P(a1, b) }
  return new Float32Array(pts)
}

function Lines({ positions, color, opacity = 1 }: { positions: Float32Array; color: string; opacity?: number }) {
  return (
    <lineSegments>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
      <lineBasicMaterial color={color} transparent={opacity < 1} opacity={opacity} />
    </lineSegments>
  )
}

/** Dải cửa sổ trên mặt trong của một tường bao: các ô kính xanh nhạt có khung gỗ, đều nhau. */
function WindowRow({ along, from, to, at }: { along: 'x' | 'z'; from: number; to: number; at: number }) {
  const PANE = 2.0, STEP = 3.0, Y = 2.0, H = 1.1
  const n = Math.max(1, Math.floor((to - from - 1) / STEP))
  const start = (from + to) / 2 - ((n - 1) * STEP) / 2
  return (
    <group>
      {Array.from({ length: n }, (_, i) => {
        const c = start + i * STEP
        const pos = (o: number): [number, number, number] => along === 'x' ? [c, Y, at + o] : [at + o, Y, c]
        const frame: [number, number, number] = along === 'x' ? [PANE + 0.16, H + 0.16, 0.04] : [0.04, H + 0.16, PANE + 0.16]
        const pane: [number, number, number] = along === 'x' ? [PANE, H, 0.02] : [0.02, H, PANE]
        const bar: [number, number, number] = along === 'x' ? [0.06, H, 0.03] : [0.03, H, 0.06]
        return (
          <group key={i}>
            <mesh position={pos(0.02)}><boxGeometry args={frame} /><meshStandardMaterial color={WOOD} /></mesh>
            <mesh position={pos(0.045)}><boxGeometry args={pane} /><meshStandardMaterial color={GLASS} emissive={GLASS} emissiveIntensity={0.25} /></mesh>
            <mesh position={pos(0.06)}><boxGeometry args={bar} /><meshStandardMaterial color={WOOD} /></mesh>
          </group>
        )
      })}
    </group>
  )
}

/** Bệ sàn (mặt XZ) + 2 tường bao (mặt XY và YZ) tông kem ấm, chân tường gỗ, dải cửa sổ kính. Hướng 3 trục: la bàn trục. */
function Backdrop({ box }: { box: Box }) {
  const { x0, x1, z0, z1, y1 } = box
  const W = x1 - x0, D = z1 - z0
  const floorGrid = useMemo(() => gridLines('x', x0, x1, 'z', z0, z1, { y: 0.012 }), [x0, x1, z0, z1])
  return (
    <group>
      {/* bệ sàn: thân tối + mặt trên, lưới mờ */}
      <mesh receiveShadow position={[0, -0.35, 0]}><boxGeometry args={[W, 0.7, D]} /><meshStandardMaterial color="#1c3a40" /></mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <planeGeometry args={[W, D]} /><meshStandardMaterial color="#2f655f" />
      </mesh>
      <Lines positions={floorGrid} color="#6aa69d" opacity={0.18} />
      {/* tường bao dọc trục X (mặt XY) và dọc trục Z (mặt YZ): kem ấm */}
      <mesh receiveShadow position={[0, y1 / 2, z0 - 0.1]}><boxGeometry args={[W, y1, 0.2]} /><meshStandardMaterial color={WALL_CREAM} /></mesh>
      <mesh receiveShadow position={[x0 - 0.1, y1 / 2, 0]}><boxGeometry args={[0.2, y1, D]} /><meshStandardMaterial color="#e4dccd" /></mesh>
      {/* chân tường gỗ */}
      <mesh position={[0, 0.2, z0 + 0.01]}><boxGeometry args={[W, 0.4, 0.04]} /><meshStandardMaterial color={WOOD} /></mesh>
      <mesh position={[x0 + 0.01, 0.2, 0]}><boxGeometry args={[0.04, 0.4, D]} /><meshStandardMaterial color={WOOD} /></mesh>
      <WindowRow along="x" from={x0} to={x1} at={z0} />
      <WindowRow along="z" from={z0} to={z1} at={x0} />
      {/* viền teal mép trên 2 tường */}
      <mesh position={[0, y1 + 0.03, z0 - 0.1]}><boxGeometry args={[W, 0.06, 0.22]} /><meshBasicMaterial color={ACCENT} /></mesh>
      <mesh position={[x0 - 0.1, y1 + 0.03, 0]}><boxGeometry args={[0.22, 0.06, D]} /><meshBasicMaterial color={ACCENT} /></mesh>
    </group>
  )
}

// ---------- camera ----------
function CameraRig({ rooms, box, safe, fitSignal, controls }: {
  rooms: Room[]; box: Box; safe: SafeArea; fitSignal: number
  controls: React.RefObject<OrbitControlsImpl | null>
}) {
  const { camera, size } = useThree()
  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera
    const availW = Math.max(200, size.width - safe.left - safe.right - 40)
    const availH = Math.max(160, size.height - safe.top - safe.bottom - 40)
    // chiếu các góc của khối scene ở zoom=1 để đo kích thước thật trên màn hình
    cam.clearViewOffset()
    cam.position.set(30, 30, 30)
    cam.lookAt(0, 0, 0)
    cam.zoom = 1
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    // khung cần thấy trọn: các phòng + bệ nền và 2 vách sau (kể cả nhãn trục ở đầu mút)
    const boxes: Box[] = rooms.map(r => ({ x0: r.x - r.w / 2, x1: r.x + r.w / 2, y0: 0, y1: 2.8, z0: r.z - r.d / 2, z1: r.z + r.d / 2 }))
    // bệ + vách chỉ cần lọt khung (không chừa thêm) để các phòng vẫn đủ to, nhãn không đè nhau
    if (rooms.length) boxes.push({ ...box, y0: -0.7 })
    for (const r of boxes) {
      for (const px of [r.x0, r.x1]) for (const pz of [r.z0, r.z1]) for (const py of [r.y0, r.y1]) {
        const v = new THREE.Vector3(px, py, pz).project(cam)
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y)
      }
    }
    if (!rooms.length) { minX = minY = -0.1; maxX = maxY = 0.1 }
    const pw = ((maxX - minX) / 2) * size.width, ph = ((maxY - minY) / 2) * size.height
    const zoom = Math.max(8, Math.min(120, Math.min(availW / pw, availH / ph)))
    cam.zoom = zoom
    // dịch khung nhìn: tâm các phòng nằm giữa vùng không bị panel che
    const cx = ((minX + maxX) / 2) * (size.width / 2) * zoom
    const cy = -((minY + maxY) / 2) * (size.height / 2) * zoom
    const ox = (safe.right - safe.left) / 2 + cx
    const oy = (safe.bottom - safe.top) / 2 + cy
    cam.setViewOffset(size.width, size.height, ox, oy, size.width, size.height)
    cam.updateProjectionMatrix()
    controls.current?.target.set(0, 0, 0)
    controls.current?.update()
  }, [camera, size.width, size.height, safe.left, safe.top, safe.right, safe.bottom, rooms, box, fitSignal, controls])
  return null
}

// ---------- scene ----------
export default function Office3D({ config, overview, live, events, picked, onPickAgent, safe, fitSignal, paused = false }: Props) {
  const [now, setNow] = useState(Date.now() / 1000)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 2000)
    return () => clearInterval(t)
  }, [])
  const controls = useRef<OrbitControlsImpl | null>(null)
  const roles = config?.roles || []
  const { rooms, lobby, extentX, extentZ } = useMemo(() => layout(roles), [roles])
  const box = useMemo(() => backdropBox(extentX, extentZ), [extentX, extentZ])
  const seats = rooms.flatMap(r => r.seats)
  const seatOf = (k?: string | null) => seats.find(s => s.role.key === k)
  const lastHandoff = [...events].reverse().find(e => e.type === 'handoff' && seatOf(e.agent) && seatOf(e.data.to) && e.agent !== e.data.to)
  const handoffActive = !!lastHandoff && now - lastHandoff.created_at < 25
  const hFrom = handoffActive ? seatOf(lastHandoff!.agent) : undefined
  const hTo = handoffActive ? seatOf(lastHandoff!.data.to) : undefined

  const currentTask = (key: string) => {
    const tasks = overview?.tasks || []
    if (key === 'qa') return tasks.find(t => t.status === 'testing')?.title
    return tasks.find(t => t.assignee === key && t.status === 'in_progress')?.title
  }

  return (
    <div className="absolute inset-0 isolate">
      <Canvas gl={{ alpha: true }} frameloop={paused ? 'demand' : 'always'} shadows={{ type: THREE.PCFShadowMap }} orthographic dpr={[1, 2]} camera={{ position: [30, 30, 30], zoom: 30, near: 0.1, far: 500 }}
        aria-label="Sơ đồ văn phòng 3D">
        {/* nền trong suốt: phía sau là nền sân khấu .scene-bg (CSS) của khu sơ đồ */}
        <ambientLight intensity={0.75} />
        <hemisphereLight args={['#ffffff', '#2e6660', 0.5]} />
        <directionalLight castShadow position={[14, 24, 10]} intensity={1.4}
          shadow-mapSize={[2048, 2048]} shadow-camera-left={-40} shadow-camera-right={40}
          shadow-camera-top={40} shadow-camera-bottom={-40} shadow-bias={-0.0004} />

        {/* nền tổng: bệ sàn XZ + vách XY, YZ + 3 trục */}
        {rooms.length > 0 && <Backdrop box={box} />}

        {rooms.length > 0 && <Lobby rect={lobby} />}
        {rooms.map(room => <RoomBlock key={room.name} room={room} />)}
        {seats.map(seat => {
          const a = live[seat.role.key]
          const working = a?.status === 'working'
          const bubble = a?.lastText && a.lastAt && now - a.lastAt < 40 ? fillNames(a.lastText, roles) : null
          return (
            <Desk key={seat.role.key} seat={seat} working={working} bubble={bubble}
              task={working ? currentTask(seat.role.key) : undefined}
              highlight={!!handoffActive && (hFrom?.role.key === seat.role.key || hTo?.role.key === seat.role.key)}
              selected={picked?.key === seat.role.key} onPick={() => onPickAgent(seat.role)} />
          )
        })}
        {hFrom && hTo && hFrom !== hTo && <HandoffArc from={hFrom} to={hTo} color={hFrom.role.color} />}

        <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} screenSpacePanning
          minPolarAngle={0.35} maxPolarAngle={1.15} minAzimuthAngle={Math.PI / 4 - 0.65} maxAzimuthAngle={Math.PI / 4 + 0.65}
          minZoom={8} maxZoom={120} />
        {/* la bàn trục X/Y/Z: xoay theo góc nhìn; tắt bấm-để-xoay vì dễ đưa camera ra ngoài góc cho phép */}
        <GizmoHelper alignment="bottom-left" margin={[safe.left + 56, safe.bottom + 92]}>
          <GizmoViewport axisColors={[AXIS.x, AXIS.y, AXIS.z]} labelColor="#0b1220" axisHeadScale={0.9} onClick={e => { e.stopPropagation(); return null }} />
        </GizmoHelper>
        <CameraRig rooms={rooms} box={box} safe={safe} fitSignal={fitSignal} controls={controls} />
      </Canvas>

      {/* thay thế bàn phím / trình đọc màn hình cho canvas */}
      <ul className="sr-only">
        {roles.map(r => (
          <li key={r.key}><button onClick={() => onPickAgent(r)}>Xem lịch sử {r.name} · {r.title}</button></li>
        ))}
      </ul>
    </div>
  )
}
