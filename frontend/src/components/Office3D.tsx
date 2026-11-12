import { fillNames } from '../names'
import { GizmoHelper, GizmoViewport, OrbitControls } from '@react-three/drei'
import { Html } from '../vendor/drei-html'  // Html của drei, vá lỗi gỡ nhãn khi rời sơ đồ 3D (React 19)
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Cake, CircleDot, Coffee, Gamepad2, Heart, Laugh, MessageCircle, Music2, Pizza, Smile, Spade, ThumbsUp } from 'lucide-react'
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
const HALL_D = 9        // chiều sâu Sảnh giải trí (bi-a) phía trước sảnh lễ tân

// Tông "kem ấm + gỗ"
const WALL_CREAM = '#ede6da'   // tường bao
const WALL_IVORY = '#f6f1e8'   // tường phòng
const WOOD = '#a0704a'         // chân tường, khung cửa, quầy
const GLASS = '#bfe3f2'        // kính cửa sổ, vách kính
const LOBBY_FLOOR = '#c9a57a'  // sàn gỗ sảnh
const ACCENT = '#2dd4bf'       // viền teal

/** face: góc xoay bàn quanh trục Y (0 = màn hình hướng −Z, π/2 = hướng −X, quay vào tường trái) */
type Seat = { role: Role; x: number; z: number; face?: number }
/** lead = phòng riêng Trưởng dự án (giữa hàng sau); dept = phòng có người (Phòng IT, phòng ban khác); empty = phòng trống chờ tuyển */
type Room = {
  id: string; name: string; color: string; x: number; z: number; w: number; d: number; seats: Seat[]
  kind: 'lead' | 'dept' | 'empty'; side: 'back' | 'left' | 'right'
}
type Rect = { x: number; z: number; w: number; d: number }

/** Các phòng ban ngồi chung Phòng IT (cột trái, cao 2 ô). */
const IT_DEPARTMENTS = ['UI/UX', 'Dev', 'QA', 'Kiểm duyệt']
const IT_COLS = 2        // số bàn ở hàng sát vách sau của Phòng IT
const WALL_STEP = 3.6   // khoảng cách giữa các bàn xếp dọc tường trái Phòng IT
const WALL_Z0 = 4.8      // bàn đầu tiên dọc tường trái cách vách sau (chừa chỗ cho ghế hàng sau)
const EMPTY_COLOR = '#94a3b8'

/**
 * Bố cục: phòng Trưởng dự án (phòng ban có role `pm`) ở giữa hàng sau; cột trái là Phòng IT (gộp 2 ô) chứa mọi
 * agent thuộc `IT_DEPARTMENTS`; cột phải gồm các ô phòng ban khác, ô chưa có ai là phòng trống (để tuyển thêm sau).
 * Sảnh là khoảng giữa hai cột, trước phòng Trưởng dự án.
 */
function layout(roles: Role[]): { rooms: Room[]; lobby: Rect; hall: Rect; extentX: number; extentZ: number } {
  const deps = [...new Set(roles.map(r => r.department))]
  const leadDep = roles.find(r => r.key === 'pm')?.department ?? deps[0]
  const isIT = (d: string) => d !== leadDep && IT_DEPARTMENTS.includes(d)
  const itRoles = roles.filter(r => isIT(r.department))
  const others = deps.filter(d => d !== leadDep && !isIT(d))
  const members = (d: string) => roles.filter(m => m.department === d)
  const deptW = (d: string) => Math.max(2, members(d).length) * SEAT + ROOM_PAD
  const colW = Math.max(SEAT * IT_COLS + ROOM_PAD, ...others.map(deptW))
  const leadW = Math.max(2, leadDep ? members(leadDep).length : 1) * SEAT + 5
  const rows = Math.max(2, others.length)
  const wallN = Math.max(0, itRoles.length - IT_COLS)
  const itD = Math.max(2 * ROOM_D + GAP, WALL_Z0 + (wallN - 1) * WALL_STEP + 3.5)
  const itSlots = Math.ceil((itD + GAP) / (ROOM_D + GAP))  // số ô hàng ở cột trái mà Phòng IT chiếm
  const totalW = colW * 2 + leadW + GAP * 2
  const officeD = Math.max(rows * ROOM_D + (rows - 1) * GAP, itD, ROOM_D + GAP + LOBBY_MIN_D)
  const totalD = officeD + HALL_D  // + Sảnh giải trí phía trước, rộng hết bề ngang
  const top = -totalD / 2

  const mk = (name: string, x: number, z: number, w: number, kind: Room['kind'], side: Room['side']): Room => {
    const ms = members(name)
    const span = (ms.length - 1) * SEAT
    const seats = ms.map((role, k) => ({ role, x: x - span / 2 + k * SEAT, z: z + 0.2 }))
    return { id: `${side}:${name}`, name, color: ms[0]?.color || '#64748b', x, z, w, d: ROOM_D, seats, kind, side }
  }
  const empty = (side: 'left' | 'right', r: number, x: number, z: number): Room =>
    ({ id: `${side}:empty${r}`, name: 'Phòng trống', color: EMPTY_COLOR, x, z, w: colW, d: ROOM_D, seats: [], kind: 'empty', side })
  const rooms: Room[] = []
  if (leadDep) {
    // phòng Trưởng dự án: bàn dồn vào góc sau bên trái (giá sách nằm ở vách sau phía phải), xoay ngược:
    // ngồi lưng dựa tường, mặt nhìn ra cửa, màn hình quay vào trong (riêng tư)
    const lead = mk(leadDep, 0, top + ROOM_D / 2, leadW, 'lead', 'back')
    lead.seats = lead.seats.map((s, k) => ({ ...s, x: -leadW / 2 + 2.0 + k * SEAT, z: top + 1.7, face: Math.PI }))
    rooms.push(lead)
  }
  const colX = (s: 'left' | 'right') => (s === 'left' ? -1 : 1) * (leadW / 2 + GAP + colW / 2)
  const rowZ = (r: number) => top + r * (ROOM_D + GAP) + ROOM_D / 2
  // Phòng IT: cột trái, mép sau trùng hàng 0. IT_COLS bàn đầu xếp sát vách sau (nhìn −Z);
  // các bàn còn lại xếp dọc tường trái, màn hình quay vào tường (nhìn −X), giữa phòng để trống làm lối đi.
  {
    const x = colX('left'), z = top + itD / 2
    const back = top
    const wallX = x - colW / 2 + 1.15
    const seats: Seat[] = itRoles.map((role, i) => i < IT_COLS
      ? { role, x: x + (i - (IT_COLS - 1) / 2) * SEAT, z: back + 1.9 }
      : { role, x: wallX, z: back + WALL_Z0 + (i - IT_COLS) * WALL_STEP, face: Math.PI / 2 })
    rooms.push({ id: 'left:it', name: 'Phòng IT', color: ACCENT, x, z, w: colW, d: itD, seats, kind: 'dept', side: 'left' })
  }
  for (let r = itSlots; r < rows; r++) rooms.push(empty('left', r, colX('left'), rowZ(r)))
  for (let r = 0; r < rows; r++) {
    const name = others[r]
    rooms.push(name ? mk(name, colX('right'), rowZ(r), deptW(name), 'dept', 'right') : empty('right', r, colX('right'), rowZ(r)))
  }
  const lobbyZ0 = top + ROOM_D + GAP, lobbyZ1 = top + officeD
  const lobby = { x: 0, z: (lobbyZ0 + lobbyZ1) / 2, w: leadW + GAP, d: lobbyZ1 - lobbyZ0 }
  const hall = { x: 0, z: lobbyZ1 + HALL_D / 2, w: totalW, d: HALL_D }
  return { rooms, lobby, hall, extentX: totalW, extentZ: totalD }
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
  const lead = kind === 'lead', vacant = kind === 'empty'
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
        {/* kệ sách gỗ sát vách sau, phía phải (góc trái dành cho bàn làm việc) */}
        <mesh castShadow position={[x + w / 2 - 2.6, 0.95, zB + 0.35]}><boxGeometry args={[1.6, 1.5, 0.45]} /><meshStandardMaterial color={WOOD} /></mesh>
        {[0.55, 1.0, 1.45].map(y => <mesh key={y} position={[x + w / 2 - 2.6, y, zB + 0.58]}><boxGeometry args={[1.4, 0.04, 0.02]} /><meshStandardMaterial color="#f2e6d0" /></mesh>)}
      </>}
      <Plant position={[x + w / 2 - 0.6, 0.2, z - d / 2 + 0.6]} />
      {/* tên phòng in trên sàn, đặt ở khoảng trống (né bàn, sofa) */}
      <FloorLabel text={lead ? 'Phòng Trưởng dự án' : name} color={lead ? '#b45309' : color}
        {...(lead ? { at: [x - 1, z + d / 2 - 1.0], size: 0.7, maxW: 6 }
          : vacant ? { at: [x, z], size: 1.0, maxW: w - 2 }
          : room.seats.some(s => s.face) ? { at: [x + 1.2, z + 1], size: 1.1, maxW: 6.5 }
          : { at: [x, z + d / 2 - 1.0], size: 0.7, maxW: w - 2 })} />
    </group>
  )
}

/**
 * Chữ in nằm trên sàn (vẽ bằng canvas để dùng font của trang, đủ dấu tiếng Việt). Chữ chạy theo trục X,
 * đầu chữ hướng −Z, nên đọc được từ góc camera. `size` = chiều cao dòng chữ, `maxW` = bề ngang tối đa.
 */
function FloorLabel({ text, color, at, size, maxW }: { text: string; color: string; at: [number, number]; size: number; maxW: number }) {
  const [tex, setTex] = useState<{ map: THREE.CanvasTexture; aspect: number } | null>(null)
  useEffect(() => {
    let alive = true, made: THREE.CanvasTexture | null = null
    const draw = () => {
      if (!alive) return
      const font = `700 120px ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`
      const c = document.createElement('canvas'), g = c.getContext('2d')!
      g.font = font
      const tw = Math.ceil(g.measureText(text).width)
      c.width = tw + 48; c.height = 168
      g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'
      g.fillStyle = '#' + new THREE.Color(color).lerp(new THREE.Color('#0b1220'), 0.15).getHexString()
      g.fillText(text, c.width / 2, c.height / 2 + 6)
      made = new THREE.CanvasTexture(c)
      made.colorSpace = THREE.SRGBColorSpace
      made.anisotropy = 8
      setTex({ map: made, aspect: c.width / c.height })
    }
    // chờ font của trang tải xong rồi mới vẽ (không thì canvas rơi về font mặc định)
    if (document.fonts?.ready) document.fonts.ready.then(draw)
    else draw()
    return () => { alive = false; made?.dispose() }
  }, [text, color])
  if (!tex) return null
  const h = Math.min(size * 1.4, maxW / tex.aspect)  // canvas có lề trên/dưới: 1.4 × chiều cao chữ
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[at[0], 0.212, at[1]]}>
      <planeGeometry args={[h * tex.aspect, h]} />
      <meshBasicMaterial map={tex.map} transparent opacity={0.8} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

type P3 = [number, number, number]
const ROOM_FLOOR = 0.2, GROUND = 0.002, LOBBY_Y = 0.035

/** Thảm tròn giữa sảnh: tâm và bán kính (dùng chung cho Lobby và chỗ ngồi của nhân viên rảnh). */
const rugOf = (lobby: Rect) => ({ x: lobby.x, z: lobby.z + 0.4, r: Math.max(1.5, Math.min(lobby.w, lobby.d) * 0.32) })
/** Quầy lễ tân ở cuối sảnh (tâm z) — lối đi vòng qua phía trước quầy. */
const counterZ = (lobby: Rect) => lobby.z - lobby.d / 2 + 1.1

type Spot = { key: string; x: number; z: number; color: string }
/** Chỗ ngồi ở sảnh: ghế đôn xếp vòng quanh thảm, đều nhau, mặt hướng vào giữa. */
function lobbySpots(lobby: Rect, roles: Role[]): Spot[] {
  const rug = rugOf(lobby)
  const R = TABLE_R + 0.85  // ngồi quanh bàn tròn
  return roles.map((role, i) => {
    const a = Math.PI / 2 + (i + 0.5) * (2 * Math.PI / roles.length)  // bắt đầu từ phía trước (phía camera)
    return { key: role.key, x: rug.x + Math.cos(a) * R, z: rug.z + Math.sin(a) * R, color: tint(role.color, 0.55) }
  })
}

/** Bàn tròn giữa thảm: mặt gỗ, chân trụ; trên bàn có bộ bài tây (xấp bài + vài lá xoè) và bình nước + cốc. */
const TABLE_R = 1.0
function RoundTable({ x, z }: { x: number; z: number }) {
  const top = 0.74
  const cards = [-0.5, -0.25, 0, 0.25, 0.5]  // lá bài xoè hình quạt
  return (
    <group position={[x, LOBBY_Y, z]}>
      <mesh castShadow receiveShadow position={[0, top, 0]}><cylinderGeometry args={[TABLE_R, TABLE_R, 0.08, 40]} /><meshStandardMaterial color="#b98552" /></mesh>
      <mesh position={[0, top + 0.041, 0]}><cylinderGeometry args={[TABLE_R - 0.08, TABLE_R - 0.08, 0.004, 40]} /><meshStandardMaterial color="#c99663" /></mesh>
      <mesh castShadow position={[0, top / 2, 0]}><cylinderGeometry args={[0.1, 0.14, top, 12]} /><meshStandardMaterial color={WOOD} /></mesh>
      <mesh castShadow position={[0, 0.03, 0]}><cylinderGeometry args={[0.5, 0.55, 0.06, 24]} /><meshStandardMaterial color={WOOD} /></mesh>
      {/* xấp bài (mặt sau đỏ) */}
      <group position={[-0.35, top + 0.05, -0.15]} rotation={[0, 0.3, 0]}>
        <mesh castShadow><boxGeometry args={[0.24, 0.07, 0.34]} /><meshStandardMaterial color="#f8f4ec" /></mesh>
        <mesh position={[0, 0.036, 0]}><boxGeometry args={[0.2, 0.002, 0.3]} /><meshStandardMaterial color="#b91c1c" /></mesh>
      </group>
      {/* lá bài xoè: mặt trắng, góc chấm đỏ/đen */}
      {cards.map((a, i) => (
        <group key={i} position={[0.1, top + 0.045 + i * 0.003, 0.35]} rotation={[0, a, 0]}>
          <mesh position={[0, 0, -0.14]}><boxGeometry args={[0.2, 0.004, 0.3]} /><meshStandardMaterial color="#ffffff" /></mesh>
          <mesh position={[-0.06, 0.003, -0.25]}><boxGeometry args={[0.04, 0.002, 0.04]} /><meshStandardMaterial color={i % 2 ? '#111827' : '#dc2626'} /></mesh>
        </group>
      ))}
      {/* bình nước + 3 cốc */}
      <group position={[0.45, top + 0.04, -0.3]}>
        <mesh castShadow position={[0, 0.2, 0]}><cylinderGeometry args={[0.1, 0.13, 0.4, 16]} /><meshStandardMaterial color="#bfe3f2" transparent opacity={0.55} /></mesh>
        <mesh position={[0, 0.13, 0]}><cylinderGeometry args={[0.115, 0.125, 0.24, 16]} /><meshStandardMaterial color="#60a5fa" transparent opacity={0.55} /></mesh>
        <mesh position={[0, 0.42, 0]}><cylinderGeometry args={[0.06, 0.08, 0.06, 12]} /><meshStandardMaterial color="#e2e8f0" /></mesh>
        {[[0.3, 0.1], [0.12, 0.32], [-0.2, 0.28]].map(([gx, gz], i) => (
          <mesh key={i} castShadow position={[gx, 0.07, gz]}><cylinderGeometry args={[0.05, 0.045, 0.14, 12]} /><meshStandardMaterial color="#dbeafe" transparent opacity={0.6} /></mesh>
        ))}
      </group>
    </group>
  )
}

/** TV lớn đặt trên quầy lễ tân, mặt hướng ra sảnh: màn hình có logo và biểu đồ cột nhấp nhô nhẹ. */
function ReceptionTV({ still }: { still: boolean }) {
  const bars = useRef<(THREE.Mesh | null)[]>([])
  const H = [0.35, 0.55, 0.42, 0.7, 0.5]
  useFrame(({ clock }) => {
    const t = still ? 0 : clock.getElapsedTime()
    bars.current.forEach((m, i) => {
      if (!m) return
      const h = H[i] * (0.8 + 0.2 * Math.sin(t * 1.3 + i))
      m.scale.y = h; m.position.y = -0.38 + h / 2
    })
  })
  return (
    <group position={[0, 1.06, -0.15]}>
      <mesh castShadow position={[0, 0.06, 0]}><boxGeometry args={[0.7, 0.04, 0.3]} /><meshStandardMaterial color="#1f2937" /></mesh>
      <mesh castShadow position={[0, 0.25, 0]}><boxGeometry args={[0.1, 0.36, 0.08]} /><meshStandardMaterial color="#1f2937" /></mesh>
      <group position={[0, 1.2, 0]}>
        <mesh castShadow><boxGeometry args={[2.7, 1.55, 0.1]} /><meshStandardMaterial color="#0b1220" /></mesh>
        <mesh position={[0, 0, 0.052]}><planeGeometry args={[2.55, 1.4]} /><meshBasicMaterial color="#0f2f4a" /></mesh>
        {/* logo HD + thanh tiêu đề */}
        <mesh position={[-0.95, 0.47, 0.055]}><planeGeometry args={[0.36, 0.26]} /><meshBasicMaterial color={ACCENT} /></mesh>
        <mesh position={[-0.2, 0.52, 0.055]}><planeGeometry args={[0.9, 0.07]} /><meshBasicMaterial color="#e2e8f0" /></mesh>
        <mesh position={[-0.35, 0.4, 0.055]}><planeGeometry args={[0.6, 0.05]} /><meshBasicMaterial color="#64748b" /></mesh>
        {/* biểu đồ cột */}
        <group position={[0.15, 0, 0.056]}>
          {H.map((_, i) => (
            <mesh key={i} ref={el => { bars.current[i] = el }} position={[i * 0.22 - 0.9, -0.2, 0]}>
              <planeGeometry args={[0.15, 1]} /><meshBasicMaterial color={['#5eead4', '#fcd34d', '#93c5fd', '#f9a8d4', '#86efac'][i]} />
            </mesh>
          ))}
        </group>
        <mesh position={[0.95, 0.05, 0.055]}><circleGeometry args={[0.28, 32]} /><meshBasicMaterial color="#fcd34d" /></mesh>
        <mesh position={[0.95, 0.05, 0.056]}><circleGeometry args={[0.16, 32]} /><meshBasicMaterial color="#0f2f4a" /></mesh>
      </group>
    </group>
  )
}

/** Sảnh lễ tân: sàn gỗ, thảm tròn, quầy lễ tân có TV lớn, bàn tròn (bài tây, bình nước), ghế đôn quanh bàn. */
function Lobby({ rect, spots, still }: { rect: Rect; spots: Spot[]; still: boolean }) {
  const { x, z, w, d } = rect
  const rug = rugOf(rect)
  const r = rug.r
  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.015, z]}><planeGeometry args={[w, d]} /><meshStandardMaterial color={LOBBY_FLOOR} /></mesh>
      {/* thảm tròn teal, viền sáng */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.03, rug.z]}><circleGeometry args={[r + 0.15, 48]} /><meshStandardMaterial color="#7fe3d4" /></mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.035, rug.z]}><circleGeometry args={[r, 48]} /><meshStandardMaterial color="#2a9d8f" /></mesh>
      {/* quầy lễ tân ở cuối sảnh, ngay trước phòng Trưởng dự án; TV lớn trên quầy */}
      <group position={[x, 0, counterZ(rect)]}>
        <mesh castShadow position={[0, 0.5, 0]}><boxGeometry args={[3.4, 1, 0.9]} /><meshStandardMaterial color={WOOD} /></mesh>
        <mesh castShadow position={[0, 1.03, 0]}><boxGeometry args={[3.6, 0.06, 1]} /><meshStandardMaterial color="#f8f4ec" /></mesh>
        <mesh position={[0, 0.55, 0.46]}><boxGeometry args={[1.6, 0.35, 0.02]} /><meshBasicMaterial color={ACCENT} /></mesh>
        <ReceptionTV still={still} />
        <Html position={[0, 3.3, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
          <div className="whitespace-nowrap rounded-md bg-ink-900/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-teal-200 shadow max-sm:hidden">Sảnh · Lễ tân</div>
        </Html>
      </group>
      <RoundTable x={rug.x} z={rug.z} />
      {/* ghế đôn quanh bàn tròn: chỗ ngồi của nhân viên đang rảnh */}
      {spots.map(s => (
        <group key={s.key} position={[s.x, 0.035, s.z]}>
          <mesh castShadow receiveShadow position={[0, 0.2, 0]}><cylinderGeometry args={[0.34, 0.38, 0.4, 20]} /><meshStandardMaterial color={s.color} /></mesh>
          <mesh position={[0, 0.405, 0]}><cylinderGeometry args={[0.3, 0.3, 0.02, 20]} /><meshStandardMaterial color="#f8f4ec" /></mesh>
        </group>
      ))}
      <Plant position={[x - w / 2 + 0.7, 0.02, z - d / 2 + 0.7]} />
      <Plant position={[x + w / 2 - 0.7, 0.02, z - d / 2 + 0.7]} />
    </group>
  )
}

// ---------- Sảnh giải trí: bàn bi-a ----------
const BALL_COLORS = ['#facc15', '#2563eb', '#dc2626', '#7c3aed', '#f97316', '#16a34a', '#7f1d1d', '#111827',
  '#fde047', '#3b82f6', '#ef4444', '#a855f7', '#fb923c', '#22c55e', '#991b1b']

function Cue({ position, rotation }: { position: P3; rotation: P3 }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow><cylinderGeometry args={[0.022, 0.035, 2.6, 10]} /><meshStandardMaterial color="#d6a46a" /></mesh>
      <mesh position={[0, -0.95, 0]}><cylinderGeometry args={[0.036, 0.04, 0.7, 10]} /><meshStandardMaterial color="#3b2a20" /></mesh>
      <mesh position={[0, 1.31, 0]}><cylinderGeometry args={[0.022, 0.022, 0.03, 10]} /><meshStandardMaterial color="#38bdf8" /></mesh>
    </group>
  )
}

/** Bàn bi-a: thân gỗ, 4 chân, băng cao su, nỉ xanh, 6 lỗ; 15 bi xếp tam giác + bi cái; 1 gậy nằm trên bàn. */
function PoolTable({ x, z, playing = false, still = false }: { x: number; z: number; playing?: boolean; still?: boolean }) {
  const L = 4.4, W = 2.4, top = 0.86, felt = top - 0.02
  const R = 0.075
  const balls: P3[] = useMemo(() => {
    const out: P3[] = []
    for (let row = 0; row < 5; row++) for (let k = 0; k <= row; k++) out.push([0.9 + row * R * 1.75, felt + R, (k - row / 2) * R * 2.05])
    return out
  }, [felt])
  const ballRefs = useRef<(THREE.Mesh | null)[]>([])
  const cueBall = useRef<THREE.Mesh>(null)
  // Mỗi lượt: bi cái lăn vào cụm bi, 2 bi bị đánh lăn về phía lỗ; sang lượt mới thì xếp lại.
  // Người đánh 0 đứng đầu −X (bi cái ở −X), người đánh 1 đứng đầu +X (bi cái đặt sau cụm bi).
  const SHOTS = [
    { cue: [-1.1, 0], hit: [0.72, 0], balls: [[0, [1.95, 0.88]], [2, [1.5, -0.86]]] },
    { cue: [2.0, 0], hit: [1.55, 0], balls: [[10, [-1.6, 0.86]], [14, [-1.95, -0.88]]] },
  ] as const
  useFrame(({ clock }) => {
    const ph = poolPhase(still ? 0 : clock.getElapsedTime())
    const shot = SHOTS[playing ? ph.shooter : 0]
    const ease = (k: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, k)), 3)
    const go = playing && !still
    balls.forEach((p, i) => {
      const m = ballRefs.current[i]
      if (!m) return
      const hit = shot.balls.find(([bi]) => bi === i)
      if (go && hit) {
        const k = ease((ph.at - 1.1) / 1.4)
        m.position.set(p[0] + (hit[1][0] - p[0]) * k, p[1], p[2] + (hit[1][1] - p[2]) * k)
      } else m.position.set(p[0], p[1], p[2])
    })
    if (cueBall.current) {
      const k = go ? ease((ph.at - 0.55) / 0.55) : 0
      cueBall.current.position.set(shot.cue[0] + (shot.hit[0] - shot.cue[0]) * k, felt + R, shot.cue[1] + (shot.hit[1] - shot.cue[1]) * k)
    }
  })
  const pockets: [number, number][] = [[-1, -1], [0, -1], [1, -1], [-1, 1], [0, 1], [1, 1]]
  return (
    <group position={[x, GROUND, z]}>
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <mesh key={i} castShadow position={[sx * (L / 2 - 0.3), 0.3, sz * (W / 2 - 0.3)]}><boxGeometry args={[0.28, 0.6, 0.28]} /><meshStandardMaterial color="#5b3a24" /></mesh>
      ))}
      <mesh castShadow receiveShadow position={[0, 0.7, 0]}><boxGeometry args={[L, 0.3, W]} /><meshStandardMaterial color="#6b4428" /></mesh>
      <mesh receiveShadow position={[0, felt, 0]}><boxGeometry args={[L - 0.36, 0.02, W - 0.36]} /><meshStandardMaterial color="#1f7a4a" /></mesh>
      {/* băng (viền) gỗ quanh mặt nỉ */}
      {[[0, -(W / 2 - 0.09), L, 0.18], [0, W / 2 - 0.09, L, 0.18]].map(([bx, bz, bl, bw], i) => (
        <mesh key={`a${i}`} castShadow position={[bx, top + 0.05, bz]}><boxGeometry args={[bl, 0.12, bw]} /><meshStandardMaterial color="#7a4d2e" /></mesh>
      ))}
      {[[-(L / 2 - 0.09), 0], [L / 2 - 0.09, 0]].map(([bx, bz], i) => (
        <mesh key={`b${i}`} castShadow position={[bx, top + 0.05, bz]}><boxGeometry args={[0.18, 0.12, W]} /><meshStandardMaterial color="#7a4d2e" /></mesh>
      ))}
      {pockets.map(([px, pz], i) => (
        <mesh key={`p${i}`} position={[px * (L / 2 - 0.2), top + 0.005, pz * (W / 2 - 0.2)]}><cylinderGeometry args={[0.12, 0.12, 0.03, 16]} /><meshStandardMaterial color="#0a0a0a" /></mesh>
      ))}
      {/* 15 bi xếp tam giác, đỉnh hướng về bi cái */}
      {balls.map((p, i) => (
        <mesh key={`ball${i}`} ref={el => { ballRefs.current[i] = el }} castShadow position={p}><sphereGeometry args={[R, 16, 12]} /><meshStandardMaterial color={BALL_COLORS[i]} roughness={0.25} /></mesh>
      ))}
      <mesh ref={cueBall} castShadow position={[-1.1, felt + R, 0]}><sphereGeometry args={[R, 16, 12]} /><meshStandardMaterial color="#f8fafc" roughness={0.2} /></mesh>
      {/* gậy nằm chéo trên bàn (cất đi khi có người đang chơi) */}
      {!playing && <Cue position={[-1.55, top + 0.13, 0.55]} rotation={[0, 0.35, Math.PI / 2 - 0.05]} />}
    </group>
  )
}

/** Giá treo gậy bi-a đứng sàn với 3 gậy dựng nghiêng. */
function CueRack({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, GROUND, z]}>
      <mesh castShadow position={[0, 0.9, -0.08]}><boxGeometry args={[1.0, 1.8, 0.08]} /><meshStandardMaterial color="#6b4428" /></mesh>
      <mesh castShadow position={[0, 0.06, 0.05]}><boxGeometry args={[1.1, 0.12, 0.3]} /><meshStandardMaterial color="#5b3a24" /></mesh>
      {[-0.3, 0, 0.3].map((dx, i) => (
        <Cue key={i} position={[dx, 1.35, 0.06]} rotation={[0.04, 0, (i - 1) * 0.05]} />
      ))}
    </group>
  )
}

/** Góc sofa: 2 sofa chữ L quanh bàn trà thấp, thảm vuông, đèn cây. */
function Lounge({ x, z }: { x: number; z: number }) {
  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.02, z]}><planeGeometry args={[4.6, 3.8]} /><meshStandardMaterial color="#d9c7a7" /></mesh>
      <Sofa position={[x, 0.02, z - 1.2]} color="#5b7c99" />
      <Sofa position={[x - 1.7, 0.02, z + 0.2]} rotation={Math.PI / 2} color="#5b7c99" />
      <mesh castShadow position={[x + 0.1, 0.28, z + 0.2]}><boxGeometry args={[1.4, 0.08, 0.9]} /><meshStandardMaterial color={WOOD} /></mesh>
      <mesh castShadow position={[x + 0.1, 0.13, z + 0.2]}><boxGeometry args={[1.2, 0.22, 0.7]} /><meshStandardMaterial color="#7a5232" /></mesh>
      {/* ấm trà + 2 tách trên bàn */}
      <mesh castShadow position={[x + 0.2, 0.42, z + 0.15]}><sphereGeometry args={[0.13, 16, 12]} /><meshStandardMaterial color="#f8f4ec" /></mesh>
      {[[-0.25, 0.35], [0.5, 0.4]].map(([dx, dz], i) => (
        <mesh key={i} castShadow position={[x + dx, 0.37, z + dz]}><cylinderGeometry args={[0.06, 0.05, 0.1, 12]} /><meshStandardMaterial color="#f8f4ec" /></mesh>
      ))}
      {/* đèn cây */}
      <mesh castShadow position={[x + 1.8, 0.75, z - 1.4]}><cylinderGeometry args={[0.03, 0.03, 1.5, 8]} /><meshStandardMaterial color="#334155" /></mesh>
      <mesh castShadow position={[x + 1.8, 1.55, z - 1.4]}><cylinderGeometry args={[0.18, 0.28, 0.32, 16]} /><meshStandardMaterial color="#fde68a" emissive="#fbbf24" emissiveIntensity={0.4} /></mesh>
      <Plant position={[x + 2.1, 0.012, z + 1.4]} />
    </group>
  )
}

/** Góc quầy nước: quầy gỗ, cây nước, kệ cốc, 2 ghế cao. */
function WaterBar({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, GROUND, z]}>
      <mesh castShadow position={[0, 0.55, 0]}><boxGeometry args={[2.6, 1.1, 0.7]} /><meshStandardMaterial color={WOOD} /></mesh>
      <mesh castShadow position={[0, 1.13, 0]}><boxGeometry args={[2.8, 0.06, 0.85]} /><meshStandardMaterial color="#f8f4ec" /></mesh>
      {/* cây nước: thân trắng + bình xanh */}
      <mesh castShadow position={[0.85, 1.45, -0.1]}><boxGeometry args={[0.4, 0.6, 0.4]} /><meshStandardMaterial color="#f1f5f9" /></mesh>
      <mesh castShadow position={[0.85, 1.95, -0.1]}><cylinderGeometry args={[0.16, 0.16, 0.42, 16]} /><meshStandardMaterial color="#7dd3fc" transparent opacity={0.7} /></mesh>
      {[-0.7, -0.45, -0.2].map((dx, i) => (
        <mesh key={i} castShadow position={[dx, 1.22, 0.1]}><cylinderGeometry args={[0.06, 0.05, 0.13, 12]} /><meshStandardMaterial color="#dbeafe" transparent opacity={0.65} /></mesh>
      ))}
      {[-0.6, 0.4].map((dx, i) => (
        <group key={i} position={[dx, 0, 0.8]}>
          <mesh castShadow position={[0, 0.42, 0]}><cylinderGeometry args={[0.04, 0.06, 0.84, 8]} /><meshStandardMaterial color="#334155" /></mesh>
          <mesh castShadow position={[0, 0.86, 0]}><cylinderGeometry args={[0.24, 0.24, 0.07, 16]} /><meshStandardMaterial color="#b45309" /></mesh>
        </group>
      ))}
    </group>
  )
}

/** Sảnh giải trí (phía trước sảnh lễ tân, rộng hết văn phòng): sàn gỗ đậm, thảm xanh dưới bàn bi-a,
 *  giá gậy, sofa xem đánh, cây xanh. Không có vách ngăn để lối đi giữa các phòng vẫn thông. */
function GameHall({ rect, playing, still }: { rect: Rect; playing: boolean; still: boolean }) {
  const { x, z, w, d } = rect
  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.012, z]}><planeGeometry args={[w, d]} /><meshStandardMaterial color="#8d6a48" /></mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.02, z + 0.3]}><planeGeometry args={[7.4, 5.2]} /><meshStandardMaterial color="#24524a" /></mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.022, z + 0.3]}><planeGeometry args={[7.0, 4.8]} /><meshStandardMaterial color="#2c6358" /></mesh>
      <PoolTable x={x} z={z + 0.3} playing={playing} still={still} />
      <CueRack x={x - 5.2} z={z - 1.4} />
      <Sofa position={[x + 5.4, 0.02, z + 0.3]} rotation={-Math.PI / 2} color="#8b5e3c" />
      <Lounge x={x + w / 4 + 2.5} z={z} />
      <WaterBar x={x - w / 4 - 2.5} z={z - 0.4} />
      <Plant position={[x - w / 2 + 0.9, 0.012, z + d / 2 - 0.9]} />
      <Plant position={[x + w / 2 - 0.9, 0.012, z + d / 2 - 0.9]} />
      <Plant position={[x - w / 2 + 0.9, 0.012, z - d / 2 + 1.4]} />
      <Html position={[x, 1.6, z + 3.2]} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
        <div className="whitespace-nowrap rounded-md bg-ink-900/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-200 shadow max-sm:hidden">Sảnh giải trí · Bi-a</div>
      </Html>
    </group>
  )
}

// ---------- bàn làm việc ----------
const SCREEN_W = 1.08, SCREEN_H = 0.63
const CODE_COLORS = ['#5eead4', '#e2e8f0', '#fcd34d', '#93c5fd', '#f9a8d4']

/** Các dòng "code" chạy lên trên màn hình khi đang làm (chỉ là hiệu ứng, không đọc được). */
function ScreenText({ on, still, seed }: { on: boolean; still: boolean; seed: number }) {
  const rows = useMemo(() => Array.from({ length: 9 }, (_, i) => {
    const r = Math.abs(Math.sin(seed * 12.9898 + i * 78.233)) % 1
    return { w: 0.18 + r * 0.6, indent: (i % 3) * 0.08, color: CODE_COLORS[(i + Math.floor(r * 5)) % CODE_COLORS.length] }
  }), [seed])
  const refs = useRef<(THREE.Mesh | null)[]>([])
  const GAP = SCREEN_H / rows.length
  useFrame(({ clock }) => {
    const t = still ? 0 : clock.getElapsedTime()
    rows.forEach((row, i) => {
      const m = refs.current[i]
      if (!m) return
      // cuộn lên đều, vòng lại từ dưới; dòng sát mép trên/dưới mờ đi để không bị "cắt"
      const y = ((i * GAP + t * 0.32 + seed) % SCREEN_H) - SCREEN_H / 2 + GAP / 2
      m.position.y = y
      m.position.x = -SCREEN_W / 2 + 0.07 + row.indent + row.w / 2
      const edge = Math.min(1, (SCREEN_H / 2 - Math.abs(y)) / 0.06)
      ;(m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, edge) * 0.9
    })
  })
  if (!on) return null
  return (
    <group position={[0, 1.25, -0.548]}>
      {rows.map((row, i) => (
        <mesh key={i} ref={el => { refs.current[i] = el }}>
          <planeGeometry args={[row.w, 0.028]} />
          <meshBasicMaterial color={row.color} transparent opacity={0.9} />
        </mesh>
      ))}
    </group>
  )
}

/** Bàn, màn hình, bàn phím, ghế. Nhân vật là component riêng (đi lại giữa sảnh và bàn). */
function Desk({ seat, screenOn, still, task, onPick }: {
  seat: Seat; screenOn: boolean; still: boolean; task?: string; onPick: () => void
}) {
  const screen = useRef<THREE.MeshStandardMaterial>(null)
  const { x, z } = seat
  useFrame(({ clock }) => {
    if (screen.current) screen.current.emissiveIntensity = screenOn ? 0.55 + (still ? 0 : Math.sin(clock.getElapsedTime() * 3 + x) * 0.08) : 0.04
  })
  return (
    <group position={[x, 0.2, z]} rotation={[0, seat.face ?? 0, 0]} onClick={e => { e.stopPropagation(); onPick() }}>
      {/* bàn */}
      <mesh castShadow receiveShadow position={[0, 0.75, -0.3]}><boxGeometry args={[2.2, 0.12, 1.1]} /><meshStandardMaterial color="#ffffff" /></mesh>
      {[-0.95, 0.95].map(dx => (
        <mesh key={dx} castShadow position={[dx, 0.35, -0.3]}><boxGeometry args={[0.1, 0.7, 1]} /><meshStandardMaterial color="#c9cfc8" /></mesh>
      ))}
      {/* màn hình: mặt sáng hướng về camera; bật thì nền xanh đậm + chữ chạy */}
      <mesh castShadow position={[0, 1.25, -0.6]}><boxGeometry args={[1.2, 0.75, 0.08]} /><meshStandardMaterial color="#142033" /></mesh>
      <mesh position={[0, 1.25, -0.555]}>
        <planeGeometry args={[SCREEN_W, SCREEN_H]} />
        <meshStandardMaterial ref={screen} color={screenOn ? '#0f2a44' : '#2a3b57'} emissive="#1e6fa8" emissiveIntensity={0.04} />
      </mesh>
      <ScreenText on={screenOn} still={still} seed={Math.abs(x * 7.3 + z * 3.1) % 10} />
      <mesh position={[0, 0.88, -0.6]}><boxGeometry args={[0.12, 0.2, 0.12]} /><meshStandardMaterial color="#142033" /></mesh>
      {/* bàn phím */}
      <mesh castShadow position={[0, 0.83, 0.12]}><boxGeometry args={[0.72, 0.035, 0.24]} /><meshStandardMaterial color="#d6dbe1" /></mesh>
      <mesh position={[0, 0.85, 0.12]}><boxGeometry args={[0.64, 0.008, 0.18]} /><meshStandardMaterial color="#9aa4b1" /></mesh>
      {/* ghế */}
      <mesh castShadow position={[0, 0.45, 0.75]}><boxGeometry args={[0.8, 0.1, 0.8]} /><meshStandardMaterial color="#334155" /></mesh>
      <mesh castShadow position={[0, 0.85, 1.12]}><boxGeometry args={[0.8, 0.75, 0.1]} /><meshStandardMaterial color="#334155" /></mesh>
      {task && (
        <Html position={[0, 2.25, -0.6]} center zIndexRange={[6, 0]} style={{ pointerEvents: 'none' }}>
          <div className="max-w-44 truncate rounded-md bg-ink-900 px-2 py-1 text-[10px] text-teal-200 shadow-lg"><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-teal-300 align-middle" aria-hidden="true" />{task}</div>
        </Html>
      )}
    </group>
  )
}

// ---------- đường đi giữa sảnh và bàn ----------

/** Lối đi từ ghế ở sảnh tới ghế ở bàn: ra khỏi phòng qua mặt trước (phòng TDA qua cửa giữa),
 *  đi dọc hành lang tới mép sảnh, vòng qua phía trước quầy lễ tân rồi tới ghế đôn. Trả về thứ tự sảnh → bàn. */
function routeOf(seat: Seat, room: Room, lobby: Rect, spot: Spot): P3[] {
  const f = seat.face ?? 0
  const chair: P3 = [seat.x + Math.sin(f) * 0.65, ROOM_FLOOR, seat.z + Math.cos(f) * 0.65]
  const front = room.z + room.d / 2
  const below = counterZ(lobby) + 1.0
  const pts: P3[] = [chair]
  if (room.kind === 'lead') {
    const side = spot.x >= room.x ? 1 : -1
    // bàn xoay ngược (ghế sát tường): ra khỏi ghế thì đi vòng qua cạnh phải của bàn
    const exitX = f ? seat.x + 1.6 : seat.x
    if (f) pts.push([exitX, ROOM_FLOOR, chair[2]])
    pts.push([exitX, ROOM_FLOOR, front - 0.6], [room.x, ROOM_FLOOR, front - 0.6], [room.x, GROUND, front + 0.9],
      [room.x + side * 2.6, GROUND, front + 0.9], [room.x + side * 2.6, GROUND, below])
  } else {
    const sx = (room.side === 'left' ? -1 : 1) * (lobby.w / 2 - 0.6)
    const zc = front + 0.7
    // ra sau ghế (lối giữa hai hàng bàn) → lối đi giữa phòng → cửa trước, không đi xuyên bàn hàng trước
    // bàn quay vào tường trái: lùi ra giữa phòng theo hướng ghế rồi đi thẳng ra cửa
    if (f) pts.push([room.x, ROOM_FLOOR, chair[2]])
    else {
      const aisleZ = seat.z + 1.6
      pts.push([seat.x, ROOM_FLOOR, aisleZ], [room.x, ROOM_FLOOR, aisleZ])
    }
    pts.push([room.x, ROOM_FLOOR, front - 0.4],
      [room.x, GROUND, zc], [sx, GROUND, zc], [sx, GROUND, Math.max(zc, below)])
  }
  pts.push([spot.x, LOBBY_Y, spot.z])
  return pts.reverse()
}

class Path {
  pts: THREE.Vector3[]; acc: number[]; length: number
  constructor(points: P3[]) {
    this.pts = points.map(p => new THREE.Vector3(...p))
    this.acc = [0]
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1], b = this.pts[i]
      this.acc.push(this.acc[i - 1] + Math.hypot(b.x - a.x, b.z - a.z) + Math.abs(b.y - a.y))
    }
    this.length = this.acc[this.acc.length - 1]
  }
  /** điểm và hướng đi (dx, dz) tại quãng đường d */
  at(d: number, out: THREE.Vector3): [number, number] {
    d = Math.max(0, Math.min(this.length, d))
    let i = 1
    while (i < this.acc.length - 1 && this.acc[i] < d) i++
    const a = this.pts[i - 1], b = this.pts[i]
    const seg = this.acc[i] - this.acc[i - 1] || 1
    out.copy(a).lerp(b, (d - this.acc[i - 1]) / seg)
    return [b.x - a.x, b.z - a.z]
  }
}

// ---------- nhân vật ----------
const WALK_SPEED = 2.6   // đơn vị/giây
const yawOf = (dx: number, dz: number) => Math.atan2(-dx, -dz)  // hướng mặt (trục −Z của nhân vật) theo (dx, dz)
const lerpAngle = (a: number, b: number, k: number) => {
  let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  return a + d * k
}

// Câu nói vui khi xong việc, trên đường về sảnh (ngồi xuống thì tắt)
const CHEERS = [
  'Yeah! Xong việc rồi!', 'Trà chiều thôi!', 'Làm ván game thôi không mọi người?', 'Làm trận bi-a đê!',
  'Ra tâm sự nào!', 'Ai làm ván bài không?', 'Nghỉ tay 5 phút nào!', 'Xong deadline, nhẹ cả người!',
  'Pha ấm trà thôi!', 'Test xanh hết, đỉnh!', 'Đi làm cốc nước đã!', 'Ai thua bi-a thì khao trà sữa nhé!',
  'Hôm nay năng suất ghê!', 'Duỗi lưng cái đã…',
]
let cheerDeck: string[] = []
/** Rút câu từ bộ đã xáo: trong một lượt về sảnh không ai trùng câu (hết bộ thì xáo lại). */
function nextCheer(): string {
  if (!cheerDeck.length) {
    cheerDeck = [...CHEERS]
    for (let i = cheerDeck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cheerDeck[i], cheerDeck[j]] = [cheerDeck[j], cheerDeck[i]]
    }
  }
  return cheerDeck.pop()!
}

/** Bong bóng đám mây suy nghĩ có 3 chấm nhấp nháy (đang chờ model trả lời). */
function ThinkingCloud() {
  return (
    <div className="relative" aria-hidden="true">
      <div className="flex items-center gap-1 rounded-[999px] bg-white px-3 py-2 shadow-xl ring-1 ring-black/5">
        <span className="typing-dot h-2 w-2 rounded-full bg-slate-500" />
        <span className="typing-dot h-2 w-2 rounded-full bg-slate-500 [animation-delay:.15s]" />
        <span className="typing-dot h-2 w-2 rounded-full bg-slate-500 [animation-delay:.3s]" />
      </div>
      {/* 2 bọt nhỏ nối xuống đầu: dấu hiệu "đang nghĩ" */}
      <span className="absolute -bottom-2 left-3 h-2.5 w-2.5 rounded-full bg-white shadow" />
      <span className="absolute -bottom-4 left-1.5 h-1.5 w-1.5 rounded-full bg-white shadow" />
    </div>
  )
}

// ---------- hoạt động lúc rảnh ----------
type Place = 'lobby' | 'desk' | 'walk' | 'away'
/** Một hoạt động lúc rảnh: đi theo `path` (bắt đầu từ ghế ở sảnh) tới nơi, ở đó tới khi `active` tắt rồi đi về. */
type IdleAct = {
  kind: 'wander' | 'pool'; path: Path; active: boolean; until: number; face: number; side?: 0 | 1
  /** tới nơi thì ngồi: chiều cao hông khi ngồi (sofa ~0.5, ghế cao quầy nước ~0.9) và mã ghế (để không ai ngồi trùng) */
  seatHip?: number; seatId?: string
}

const POOL_TURN = 4  // giây mỗi lượt đánh; 2 người thay phiên
/** Pha của lượt đánh hiện tại: người đánh (0/1) và thời điểm trong lượt (giây). Bàn bi-a và người chơi dùng chung. */
const poolPhase = (t: number) => ({ shooter: (Math.floor(t / POOL_TURN) % 2) as 0 | 1, at: t % POOL_TURN })
/** Gậy thụt ra (+) / vào (−) theo pha: kéo về 0.4 s, thúc nhanh 0.15 s, giữ, rồi thu về. */
const strokeOf = (at: number) => at < 0.4 ? 0.3 * (at / 0.4) : at < 0.55 ? 0.3 - 0.75 * ((at - 0.4) / 0.15) : at < 1.6 ? -0.45 : -0.45 * Math.max(0, 1 - (at - 1.6) / 0.8)

// Icon tám chuyện ở sảnh (chỉ icon, không chữ)
const CHAT_ICONS = { Coffee, Gamepad2, Laugh, MessageCircle, Cake, Spade, ThumbsUp, Music2, Smile, Pizza, Heart, CircleDot }
type ChatIcon = keyof typeof CHAT_ICONS
const CHAT_ICON_KEYS = Object.keys(CHAT_ICONS) as ChatIcon[]

/**
 * Nhân viên: ngồi ghế đôn ở sảnh khi rảnh; có việc thì đứng dậy, đi về bàn, ngồi xuống.
 * Ở bàn: đang thao tác thì gõ phím (2 tay), đang suy nghĩ thì đám mây "…" trên đầu.
 * Lúc rảnh có thể đi dạo / chơi bi-a (theo `idle`) hoặc ngồi tám chuyện (bong bóng icon `chatIcon`).
 */
function Character({ role, path, deskYaw = 0, onDuty, typing, thinking, bubble, bubbleAt, highlight, selected, still, onPick, onPlace, posStore, idle, chatIcon }: {
  role: Role; path: Path
  /** hướng mặt khi ngồi bàn = góc xoay của bàn (seat.face) */
  deskYaw?: number; onDuty: boolean; typing: boolean; thinking: boolean; bubble: string | null; bubbleAt?: number
  highlight: boolean; selected: boolean; still: boolean; onPick: () => void
  onPlace: (place: Place) => void
  posStore: Map<string, THREE.Vector3>
  idle?: IdleAct | null; chatIcon?: ChatIcon | null
}) {
  const root = useRef<THREE.Group>(null)
  const turn = useRef<THREE.Group>(null)
  const upper = useRef<THREE.Group>(null)
  const legL = useRef<THREE.Group>(null), legR = useRef<THREE.Group>(null)
  const armL = useRef<THREE.Group>(null), armR = useRef<THREE.Group>(null)
  const cue = useRef<THREE.Group>(null)
  const dist = useRef(onDuty ? path.length : 0)   // quãng đã đi từ sảnh về phía bàn
  const idist = useRef(0)                          // quãng đã đi trên lộ trình rảnh (từ ghế ở sảnh)
  const idlePath = useRef<IdleAct | null>(null)    // giữ lộ trình đang đi kể cả khi hoạt động đã kết thúc
  const sit = useRef(1)                            // 1 = ngồi, 0 = đứng
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const [hover, setHover] = useState(false)
  const [place, setPlace] = useState<Place>(onDuty ? 'desk' : 'lobby')
  useEffect(() => { onPlace(place) }, [place])  // eslint-disable-line react-hooks/exhaustive-deps
  // bắt đầu trực lúc nào: bong bóng chỉ hiện câu nói từ lúc này (không lấy câu của vòng trước)
  const [dutySince, setDutySince] = useState(() => (onDuty ? 0 : Infinity))
  useEffect(() => { setDutySince(onDuty ? Date.now() / 1000 - 2 : Infinity) }, [onDuty])
  // Xong việc (hết trực): nói một câu vui trên đường về sảnh; ngồi vào ghế ở sảnh thì tắt
  const [cheer, setCheer] = useState<string | null>(null)
  const wasOnDuty = useRef(onDuty)
  useEffect(() => {
    if (wasOnDuty.current && !onDuty) setCheer(nextCheer())
    if (onDuty) setCheer(null)
    wasOnDuty.current = onDuty
  }, [onDuty])
  useEffect(() => { if (place === 'lobby') setCheer(null) }, [place])
  useEffect(() => { document.body.style.cursor = hover ? 'pointer' : ''; return () => { document.body.style.cursor = '' } }, [hover])
  if (idle) idlePath.current = idle

  const lobbyFacing = useMemo(() => {
    const s = path.pts[0], next = path.pts[1]
    return yawOf(s.x - next.x, s.z - next.z)  // quay lưng về lối đi = mặt hướng vào giữa thảm
  }, [path])
  // ngồi bàn: mặt nhìn theo hướng bước cuối cùng vào ghế (bàn thường nhìn −Z, bàn sát tường trái nhìn −X)

  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime()
    const dt = Math.min(delta, 0.5)  // tab bị ẩn / máy chậm: vẫn bắt kịp trạng thái thật
    const act = idlePath.current
    const idleLen = act?.path.length ?? 0
    // Thứ tự: có việc mà đang ở ngoài (đi dạo / bi-a) thì về ghế trước rồi mới về bàn; ngược lại, đang trên
    // đường bàn ↔ sảnh thì chưa đi chơi.
    const idleTarget = !onDuty && act?.active && dist.current <= 0.01 ? idleLen : 0
    const target = onDuty && idist.current <= 0.01 ? path.length : 0
    const idleMove = Math.abs(idist.current - idleTarget) > 0.01
    const mainMove = !idleMove && Math.abs(dist.current - target) > 0.01
    const needMove = idleMove || mainMove
    const seatedAway = !!act && act.seatHip != null && idleTarget > 0 && idist.current >= idleLen - 0.01
    const seatable = (dist.current <= 0.01 && idist.current <= 0.01) || dist.current >= path.length - 0.01 || seatedAway
    if (still) { dist.current = onDuty ? path.length : 0; idist.current = 0; sit.current = 1 }
    else if (needMove) {
      if (sit.current > 0) sit.current = Math.max(0, sit.current - dt * 3)  // đứng dậy trước rồi mới đi
      else if (idleMove) idist.current += Math.sign(idleTarget - idist.current) * Math.min(Math.abs(idleTarget - idist.current), WALK_SPEED * 0.8 * dt)
      else dist.current += Math.sign(target - dist.current) * Math.min(Math.abs(target - dist.current), WALK_SPEED * dt)
    } else if (seatable) sit.current = Math.min(1, sit.current + dt * 3)
    const walking = needMove && sit.current === 0 && !still

    let dx = 0, dz = 0, forward = true
    if (dist.current > 0.01 || !act || idist.current <= 0.01) {
      ;[dx, dz] = path.at(dist.current, tmp); forward = target > dist.current
    } else {
      ;[dx, dz] = act.path.at(idist.current, tmp); forward = idleTarget > idist.current
    }
    const g = root.current
    if (!g) return
    g.position.copy(tmp)
    const atDesk = dist.current >= path.length - 0.01
    const atLobby = dist.current <= 0.01 && idist.current <= 0.01
    const away = !atLobby && !atDesk && !needMove
    const nowPlace: Place = needMove ? 'walk' : atDesk ? 'desk' : atLobby ? 'lobby' : 'away'
    if (nowPlace !== place) setPlace(nowPlace)
    // hướng mặt: đi thì theo hướng đi; ngồi bàn nhìn màn hình; ngồi sảnh nhìn vào bàn tròn; đi chơi thì theo hoạt động
    const wantYaw = atDesk ? deskYaw : atLobby ? lobbyFacing : away && act ? act.face : (forward ? yawOf(dx, dz) : yawOf(-dx, -dz))
    if (turn.current) turn.current.rotation.y = still ? wantYaw : lerpAngle(turn.current.rotation.y, wantYaw, Math.min(1, dt * 10))

    // bi-a: tới lượt thì cúi người, 2 tay đưa ra trước, gậy thụt; không tới lượt thì cầm gậy dựng đứng
    const playing = away && act?.kind === 'pool' && act.active
    const ph = poolPhase(t)
    const myTurn = playing && ph.shooter === act!.side
    const stroke = myTurn ? strokeOf(ph.at) : 0
    if (cue.current) {
      cue.current.visible = playing
      if (myTurn) { cue.current.position.set(0.1, 0.93, -0.75 + stroke); cue.current.rotation.set(-Math.PI / 2 + 0.12, 0, 0) }
      else { cue.current.position.set(0.5, 1.25, -0.05); cue.current.rotation.set(0.08, 0, 0.1) }
    }

    // tư thế: hông hạ khi ngồi; chân gập ra trước khi ngồi, đung đưa khi đi; tay gõ phím / vung khi đi
    const s = sit.current
    // chiều cao hông khi ngồi: ghế đôn sảnh 0.42, ghế làm việc 0.5, sofa / ghế cao theo chỗ ngồi
    const seatHip = atLobby ? 0.42 : atDesk ? 0.5 : act?.seatHip ?? 0.5
    const hip = 0.62 + (seatHip - 0.62) * s
    const fold = seatHip > 0.7 ? 0.55 : 1  // ghế cao: chân buông xuống nhiều hơn
    const swing = walking ? Math.sin(t * 9) * 0.6 : 0
    if (upper.current) {
      upper.current.position.y = hip + (walking ? Math.abs(Math.sin(t * 9)) * 0.04 : 0)
      upper.current.rotation.x = myTurn ? -0.55 : 0  // cúi người ngắm
    }
    if (legL.current) { legL.current.position.y = hip; legL.current.rotation.x = s * (Math.PI / 2) * fold + swing }
    if (legR.current) { legR.current.position.y = hip; legR.current.rotation.x = s * (Math.PI / 2) * fold - swing }
    const typingNow = typing && atDesk && !still
    const armBase = atDesk ? 0.95 * s : seatHip > 0.7 && away ? 0.9 * s : 0.35 * s  // ở bàn: tay chạm bàn phím; ghế quầy: tay đặt lên quầy
    const tapL = typingNow ? Math.max(0, Math.sin(t * 22)) * 0.16 : 0
    const tapR = typingNow ? Math.max(0, Math.sin(t * 22 + 2.1)) * 0.16 : 0
    if (armL.current) armL.current.rotation.x = myTurn ? 1.25 : playing ? 0.25 : armBase - swing - tapL
    if (armR.current) armR.current.rotation.x = myTurn ? 0.9 - stroke * 0.8 : playing ? 0.5 : armBase + swing - tapR

    // vị trí đầu cho máy bay giấy nhắm tới
    let p = posStore.get(role.key)
    if (!p) { p = new THREE.Vector3(); posStore.set(role.key, p) }
    p.set(tmp.x, tmp.y + hip + 1.15, tmp.z)
  })

  const ring = highlight ? '#fbbf24' : selected ? '#5eead4' : hover ? '#ffffff' : null
  const Icon = chatIcon ? CHAT_ICONS[chatIcon] : null
  return (
    <group ref={root}
      onClick={e => { e.stopPropagation(); onPick() }}
      onPointerOver={e => { e.stopPropagation(); setHover(true) }}
      onPointerOut={() => setHover(false)}>
      {ring && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.6, 0.75, 40]} /><meshBasicMaterial color={ring} transparent opacity={0.9} />
        </mesh>
      )}
      <group ref={turn}>
        {/* chân: trục xoay ở hông */}
        {[[-0.14, legL], [0.14, legR]].map(([lx, ref]) => (
          <group key={lx as number} ref={ref as React.RefObject<THREE.Group>} position={[lx as number, 0.62, 0]}>
            <mesh castShadow position={[0, -0.28, 0]}><capsuleGeometry args={[0.1, 0.36, 4, 8]} /><meshStandardMaterial color="#334155" /></mesh>
          </group>
        ))}
        <group ref={upper} position={[0, 0.62, 0]}>
          <mesh castShadow position={[0, 0.42, 0]}><capsuleGeometry args={[0.32, 0.4, 4, 12]} /><meshStandardMaterial color={role.color} /></mesh>
          <mesh castShadow position={[0, 1.05, 0]}><sphereGeometry args={[0.3, 20, 16]} /><meshStandardMaterial color="#f2c9a0" /></mesh>
          {/* tóc trùm phía sau đầu (phía +Z) */}
          <mesh castShadow position={[0, 1.13, 0.05]}><sphereGeometry args={[0.31, 20, 16, 0, Math.PI * 2, 0, Math.PI / 1.9]} /><meshStandardMaterial color="#3b2a20" /></mesh>
          {/* tay: trục xoay ở vai, xoay về phía trước (−Z) để gõ phím */}
          {[[-0.4, armL], [0.4, armR]].map(([ax, ref]) => (
            <group key={ax as number} ref={ref as React.RefObject<THREE.Group>} position={[ax as number, 0.7, 0]}>
              <mesh castShadow position={[0, -0.26, 0]}><capsuleGeometry args={[0.08, 0.36, 4, 8]} /><meshStandardMaterial color={role.color} /></mesh>
              <mesh castShadow position={[0, -0.5, 0]}><sphereGeometry args={[0.085, 12, 10]} /><meshStandardMaterial color="#f2c9a0" /></mesh>
            </group>
          ))}
        </group>
        {/* gậy bi-a cầm trên tay (chỉ hiện khi đang chơi) */}
        <group ref={cue} visible={false}>
          <mesh castShadow><cylinderGeometry args={[0.02, 0.032, 2.0, 8]} /><meshStandardMaterial color="#d6a46a" /></mesh>
          <mesh position={[0, -0.75, 0]}><cylinderGeometry args={[0.033, 0.036, 0.5, 8]} /><meshStandardMaterial color="#3b2a20" /></mesh>
        </group>
      </group>

      {place === 'lobby' || place === 'away' ? (
        // ở sảnh / đang chơi: chỉ tên, nhỏ (ở sảnh đẩy ra ngoài vòng ngồi cho đỡ chen nhau)
        <Html position={place === 'lobby' ? [Math.sin(lobbyFacing) * 0.85, 1.7, Math.cos(lobbyFacing) * 0.85] : [0, 2.05, 0]}
          center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
          <div className="whitespace-nowrap rounded bg-ink-900/85 px-1.5 py-px text-[10px] font-semibold leading-tight text-white shadow"
            style={{ boxShadow: `inset 0 -2px 0 ${role.color}` }}>{role.name}</div>
        </Html>
      ) : (
        <Html position={[0, 0, 1.15]} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
          <div className="whitespace-nowrap rounded-md bg-ink-900/90 px-2 py-0.5 text-center text-[11px] leading-tight text-white shadow">
            <span className="font-semibold">{role.name}</span><span className="ml-1 text-slate-300 max-sm:hidden">· {role.title}</span>
          </div>
        </Html>
      )}
      {cheer && place !== 'lobby' ? (
        <Html position={[0, 2.35, 0]} zIndexRange={[8, 0]} style={{ pointerEvents: 'none', transform: 'translate(-20%, -100%)' }}>
          <div className="animate-pop whitespace-nowrap rounded-2xl rounded-bl-sm bg-amber-100 px-3 py-1.5 text-[12px] font-semibold text-amber-900 shadow-xl ring-1 ring-amber-300/60">
            {cheer}
          </div>
        </Html>
      ) : Icon && place === 'lobby' ? (
        // tám chuyện: bong bóng chỉ có icon
        <Html position={[0, 2.05, 0]} zIndexRange={[7, 0]} style={{ pointerEvents: 'none', transform: 'translate(-30%, -100%)' }}>
          <div className="animate-pop grid h-8 w-8 place-items-center rounded-full rounded-bl-sm bg-white shadow-lg ring-1 ring-black/5" aria-hidden="true">
            <Icon className="h-4 w-4" style={{ color: role.color }} strokeWidth={2.4} />
          </div>
        </Html>
      ) : thinking && place !== 'walk' ? (
        <Html position={[0.15, 2.35, 0]} zIndexRange={[9, 0]} style={{ pointerEvents: 'none', transform: 'translate(0, -100%)' }}>
          <ThinkingCloud />
        </Html>
      ) : bubble && place === 'desk' && onDuty && (bubbleAt ?? 0) >= dutySince && (
        // lời vừa nói: chỉ khi đang ngồi làm ở bàn (đi lại / ngồi sảnh thì ẩn cho đỡ rối)
        <Html position={[0, 2.4, 0]} zIndexRange={[8, 0]} style={{ pointerEvents: 'none', transform: 'translate(-20%, -100%)' }}>
          <div className="animate-pop w-48 rounded-xl bg-white p-2 text-[11px] leading-snug text-slate-800 shadow-xl">
            <div className="mb-0.5 text-[10px] text-slate-600">{role.name} · {role.title}</div>
            <div className="line-clamp-2">{bubble}</div>
          </div>
        </Html>
      )}
    </group>
  )
}

/**
 * Lộ trình rảnh từ ghế ở sảnh: bước ra ngoài vòng ngồi, đi vòng tới phía trước bàn tròn, ra mép trên Sảnh giải trí
 * (lối đi `laneZ`, phía sau bàn bi-a), rồi qua các điểm `stops` (mỗi điểm là chuỗi điểm tiếp cận từ lối đi).
 */
function idleRoute(spot: Spot, lobby: Rect, hall: Rect, stops: P3[][]): Path {
  const rug = rugOf(lobby)
  const R2 = TABLE_R + 0.85 + 1.0
  const a0 = Math.atan2(spot.z - rug.z, spot.x - rug.x)
  const ring = (a: number): P3 => [rug.x + Math.cos(a) * R2, LOBBY_Y, rug.z + Math.sin(a) * R2]
  const pts: P3[] = [[spot.x, LOBBY_Y, spot.z], ring(a0)]
  let d = Math.PI / 2 - a0
  d = Math.atan2(Math.sin(d), Math.cos(d))  // đường ngắn nhất quanh vòng tới phía trước (+Z)
  const steps = Math.ceil(Math.abs(d) / 0.7)
  for (let i = 1; i <= steps; i++) pts.push(ring(a0 + (d * i) / steps))
  const laneZ = hall.z - hall.d / 2 + 1.0
  pts.push([rug.x, GROUND, laneZ])
  stops.forEach((approach, i) => {
    pts.push(...approach)
    if (i < stops.length - 1) pts.push(...[...approach].reverse())  // quay ra lối đi rồi sang điểm kế
  })
  return new Path(pts)
}

/** Các điểm đến lúc rảnh trong Sảnh giải trí: mỗi điểm = chuỗi điểm tiếp cận từ lối đi (né bàn, quầy, sofa). */
function hallStops(hall: Rect) {
  const laneZ = hall.z - hall.d / 2 + 1.0
  const bx = hall.x - hall.w / 4 - 2.5, lx = hall.x + hall.w / 4 + 2.5
  const g = (x: number, z: number): P3 => [x, GROUND, z]
  const tz = hall.z + 0.3  // tâm bàn bi-a
  return {
    pool: [
      { pts: [g(hall.x - 2.9, laneZ), g(hall.x - 2.9, tz)], face: yawOf(1, 0) },   // đầu bàn phía −X, nhìn +X
      { pts: [g(hall.x + 2.9, laneZ), g(hall.x + 2.9, tz)], face: yawOf(-1, 0) },  // đầu bàn phía +X, nhìn −X
    ],
    // điểm dạo qua trước khi ngồi
    stroll: [
      [g(hall.x - hall.w / 2 + 3, laneZ), g(hall.x - hall.w / 2 + 3, hall.z + 3.2)], // góc trước trái
      [g(hall.x + hall.w / 2 - 3, laneZ), g(hall.x + hall.w / 2 - 3, hall.z + 3.2)], // góc trước phải
      [g(hall.x - 6, laneZ), g(hall.x - 6, hall.z + 3.4), g(hall.x + 6, hall.z + 3.4)], // dạo ngang trước bàn bi-a
    ],
    // chỗ ngồi: lối vào (né quầy, bàn trà, sofa) + hướng mặt + chiều cao hông khi ngồi
    seats: [
      // 2 ghế cao ở quầy nước (mặt nhìn vào quầy, −Z)
      ...[-0.6, 0.4].map((dx, i) => ({
        id: `bar${i}`, hip: 0.9, face: yawOf(0, -1),
        pts: [g(bx + 2.0, laneZ), g(bx + 2.0, hall.z + 1.3), g(bx + dx, hall.z + 1.3), g(bx + dx, hall.z + 0.45)],
      })),
      // sofa sau bàn trà ở góc sofa (mặt nhìn +Z): vào từ phía đông, đi ngang phía sau bàn trà
      ...[0.5, -0.5].map((dx, i) => ({
        id: `loungeA${i}`, hip: 0.5, face: yawOf(0, 1),
        pts: [g(lx + 1.4, laneZ), g(lx + 1.4, hall.z - 0.45), g(lx + dx, hall.z - 0.45), g(lx + dx, hall.z - 1.12)],
      })),
      // sofa bên trái bàn trà (mặt nhìn +X): đi khe giữa sofa và bàn trà
      ...[-0.3, 0.7].map((dz, i) => ({
        id: `loungeB${i}`, hip: 0.5, face: yawOf(1, 0),
        pts: [g(lx + 1.4, laneZ), g(lx + 1.4, hall.z - 0.45), g(lx - 0.95, hall.z - 0.45), g(lx - 0.95, hall.z + dz), g(lx - 1.62, hall.z + dz)],
      })),
      // sofa cạnh bàn bi-a (mặt nhìn về bàn, −X)
      ...[-0.2, 0.8].map((dz, i) => ({
        id: `poolSofa${i}`, hip: 0.5, face: yawOf(-1, 0),
        pts: [g(hall.x + 4.4, laneZ), g(hall.x + 4.4, hall.z + dz), g(hall.x + 5.33, hall.z + dz)],
      })),
    ],
  }
}

// ---------- máy bay giấy khi bàn giao ----------
const FLIGHT = 2.4  // giây
function planeGeometry() {
  // mũi ở +Z (Object3D.lookAt hướng +Z về đích); 2 cánh + sống thuyền
  const nose = [0, 0, 0.5], l = [-0.36, 0.02, -0.32], r = [0.36, 0.02, -0.32], c = [0, 0, -0.26], k = [0, -0.14, -0.3]
  const tri = [nose, l, c, nose, c, r, nose, k, c, nose, c, k].flat()
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3))
  g.computeVertexNormals()
  return g
}

/** Người giao phi một chiếc máy bay giấy tới người nhận (bám theo vị trí hiện tại của người nhận). */
function PaperPlane({ fromKey, toKey, color, posStore, still }: {
  fromKey: string; toKey: string; color: string; posStore: Map<string, THREE.Vector3>; still: boolean
}) {
  const plane = useRef<THREE.Mesh>(null)
  const trail = useRef<THREE.Mesh>(null)
  const start = useRef<number | null>(null)
  const from = useRef<THREE.Vector3 | null>(null)
  const geo = useMemo(planeGeometry, [])
  const a = useMemo(() => new THREE.Vector3(), []), b = useMemo(() => new THREE.Vector3(), [])
  const mid = useMemo(() => new THREE.Vector3(), []), p = useMemo(() => new THREE.Vector3(), [])
  const q = useMemo(() => new THREE.Vector3(), [])
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(a, mid, b), [a, mid, b])
  useFrame(({ clock }) => {
    const m = plane.current
    const src = posStore.get(fromKey), dst = posStore.get(toKey)
    if (!m || !src || !dst) return
    if (start.current === null) { start.current = clock.getElapsedTime(); from.current = src.clone().setY(src.y + 0.3) }
    const k = still ? 1 : Math.min(1, (clock.getElapsedTime() - start.current) / FLIGHT)
    a.copy(from.current!)
    b.copy(dst).setY(dst.y + 0.25)
    mid.copy(a).lerp(b, 0.5).setY(Math.max(a.y, b.y) + 1.2 + a.distanceTo(b) * 0.18)
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2  // nhanh dần rồi chậm dần
    curve.getPoint(e, p)
    curve.getPoint(Math.min(1, e + 0.02), q)
    m.position.copy(p)
    if (q.distanceToSquared(p) > 1e-6) m.lookAt(q)
    m.rotateZ(Math.sin(e * Math.PI * 3) * 0.35)  // chao cánh nhẹ
    m.visible = k < 1
    if (trail.current) { trail.current.position.copy(b); trail.current.visible = k >= 1 && k < 1.01 }
  })
  return (
    <group>
      <mesh ref={plane} geometry={geo} scale={1.6} castShadow>
        <meshStandardMaterial color="#ffffff" emissive={color} emissiveIntensity={0.25} side={THREE.DoubleSide} flatShading />
      </mesh>
      <mesh ref={trail} visible={false}><sphereGeometry args={[0.12, 10, 8]} /><meshBasicMaterial color={color} /></mesh>
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
  const { rooms, lobby, hall, extentX, extentZ } = useMemo(() => layout(roles), [roles])
  const box = useMemo(() => backdropBox(extentX, extentZ), [extentX, extentZ])
  const seats = rooms.flatMap(r => r.seats)
  const seatOf = (k?: string | null) => seats.find(s => s.role.key === k)
  const lastHandoff = [...events].reverse().find(e => e.type === 'handoff' && seatOf(e.agent) && seatOf(e.data.to) && e.agent !== e.data.to)
  const handoffActive = !!lastHandoff && now - lastHandoff.created_at < 12
  const hFrom = handoffActive ? seatOf(lastHandoff!.agent) : undefined
  const hTo = handoffActive ? seatOf(lastHandoff!.data.to) : undefined
  const still = useMemo(reducedMotion, []) || paused

  // Chỗ ngồi ở sảnh và lối đi sảnh → bàn của từng người
  const spots = useMemo(() => lobbySpots(lobby, seats.map(s => s.role)), [lobby, rooms])  // eslint-disable-line react-hooks/exhaustive-deps
  const paths = useMemo(() => {
    const m = new Map<string, Path>()
    for (const room of rooms) for (const seat of room.seats) {
      const spot = spots.find(sp => sp.key === seat.role.key)
      if (spot) m.set(seat.role.key, new Path(routeOf(seat, room, lobby, spot)))
    }
    return m
  }, [rooms, lobby, spots])
  const posStore = useMemo(() => new Map<string, THREE.Vector3>(), [])
  const [places, setPlaces] = useState<Record<string, Place>>({})


  // Ai đang "trực" (ở bàn): trong vòng đang chạy của một dự án, người đã được giao việc / nhận bàn giao / đang làm.
  // Trưởng dự án đứng dậy ngay khi Sếp giao lệnh; người khác lần lượt khi tới lượt. Hết vòng: cả đội về sảnh.
  const onDuty = useMemo(() => {
    const duty = new Set<string>()
    const running = new Set((overview?.projects || []).filter(p => p.running).map(p => p.id))
    if (!running.size) return duty
    const started = new Map<string, number>()  // vị trí sự kiện bắt đầu vòng của từng dự án đang chạy
    events.forEach((e, i) => {
      if (e.type === 'project_status' && running.has(e.project_id) && e.data.status === 'running') started.set(e.project_id, i)
    })
    for (const pid of running) {
      duty.add('pm')
      const from = started.get(pid) ?? 0
      for (let i = from; i < events.length; i++) {
        const e = events[i]
        if (e.project_id !== pid) continue
        if (e.type === 'agent_status' && e.data.status !== 'idle' && e.agent) duty.add(e.agent)
        if (e.type === 'handoff' && e.data.to) duty.add(e.data.to)
        if (e.type === 'task_update' && e.data.task?.assignee) duty.add(e.data.task.assignee)
      }
      // tải trang giữa chừng (sự kiện bắt đầu vòng đã trôi khỏi bộ nhớ): dựa vào task đang mở của dự án
      if (!started.has(pid)) for (const t of overview?.tasks || []) if (t.project_id === pid && t.status !== 'done') duty.add(t.assignee)
    }
    for (const [k, a] of Object.entries(live)) if (a.status === 'working') duty.add(k)
    return duty
  }, [events, overview, live])

  // ---- Hoạt động lúc rảnh: đi dạo, chơi bi-a (2 người), tám chuyện (bong bóng icon) ----
  // Chỉ người đang ngồi ở sảnh và không có việc mới được giao hoạt động; có việc thì hoạt động tắt ngay,
  // nhân vật tự đi về ghế rồi về bàn. Bộ điều phối chạy mỗi giây, xác suất thấp để trông tự nhiên.
  const [idle, setIdle] = useState<Record<string, IdleAct>>({})
  const [chat, setChat] = useState<Record<string, { icon: ChatIcon; until: number }>>({})
  const latest = useRef({ places, onDuty, spots, lobby, hall })
  latest.current = { places, onDuty, spots, lobby, hall }
  useEffect(() => {
    if (still) { setIdle({}); setChat({}); return }
    const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]
    const tick = () => {
      const { places: pl, onDuty: duty, spots: sp, lobby: lb, hall: hl } = latest.current
      const now = Date.now() / 1000
      setIdle(prev => {
        const next: Record<string, IdleAct> = { ...prev }
        // kết thúc: hết giờ hoặc có việc; bi-a thiếu người thì người còn lại cũng nghỉ
        for (const [k, a] of Object.entries(next)) if (a.active && (duty.has(k) || now > a.until)) next[k] = { ...a, active: false }
        const poolers = Object.entries(next).filter(([, a]) => a.kind === 'pool')
        if (poolers.some(([, a]) => !a.active)) for (const [k, a] of poolers) if (a.active) next[k] = { ...a, active: false }
        // đã về tới ghế thì xoá hoạt động
        for (const [k, a] of Object.entries(next)) if (!a.active && pl[k] === 'lobby') delete next[k]
        // bắt đầu hoạt động mới cho người đang ngồi rảnh
        const free = sp.filter(s => !duty.has(s.key) && pl[s.key] === 'lobby' && !next[s.key])
        const stops = hallStops(hl)
        const hasPool = Object.values(next).some(a => a.kind === 'pool')
        if (!hasPool && free.length >= 2 && Math.random() < 0.12) {
          const a = free.splice(Math.floor(Math.random() * free.length), 1)[0]
          const b = free.splice(Math.floor(Math.random() * free.length), 1)[0]
          const until = now + 25 + Math.random() * 20
          ;[a, b].forEach((spot, side) => {
            const st = stops.pool[side]
            next[spot.key] = { kind: 'pool', path: idleRoute(spot, lb, hl, [st.pts]), active: true, until, face: st.face, side: side as 0 | 1 }
          })
        }
        const wandering = Object.values(next).filter(a => a.kind === 'wander').length
        const taken = new Set(Object.values(next).map(a => a.seatId).filter(Boolean))
        const seatsFree = stops.seats.filter(st => !taken.has(st.id))
        if (wandering < 3 && free.length >= 1 && seatsFree.length && Math.random() < 0.12) {
          const spot = free.splice(Math.floor(Math.random() * free.length), 1)[0]
          const seat = pick(seatsFree)
          const route = Math.random() < 0.5 ? [pick(stops.stroll), seat.pts] : [seat.pts]  // đôi khi dạo một vòng trước
          next[spot.key] = {
            kind: 'wander', path: idleRoute(spot, lb, hl, route), active: true,
            until: now + 14 + Math.random() * 14, face: seat.face, seatHip: seat.hip, seatId: seat.id,
          }
        }
        return next
      })
      // tám chuyện: thỉnh thoảng một người đang ngồi ở sảnh hiện bong bóng icon ~2.6 giây
      setChat(prev => {
        const next: typeof prev = {}
        for (const [k, c] of Object.entries(prev)) if (c.until > now) next[k] = c
        const seated = sp.filter(s => !duty.has(s.key) && pl[s.key] === 'lobby' && !next[s.key])
        if (seated.length >= 2 && Object.keys(next).length < 2 && Math.random() < 0.5) {
          next[pick(seated).key] = { icon: pick(CHAT_ICON_KEYS), until: now + 2.6 }
        }
        return next
      })
    }
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [still])
  const poolPlaying = Object.entries(idle).filter(([k, a]) => a.kind === 'pool' && a.active && places[k] === 'away').length === 2

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

        {rooms.length > 0 && <Lobby rect={lobby} spots={spots} still={still} />}
        {rooms.length > 0 && <GameHall rect={hall} playing={poolPlaying} still={still} />}
        {rooms.map(room => <RoomBlock key={room.id} room={room} />)}
        {seats.map(seat => {
          const key = seat.role.key
          const a = live[key]
          const working = a?.status === 'working'
          const duty = onDuty.has(key)
          const bubble = a?.lastText && a.lastAt && now - a.lastAt < 40 ? fillNames(a.lastText, roles) : null
          const path = paths.get(key)
          return (
            <group key={key}>
              <Desk seat={seat} screenOn={duty && working && places[key] === 'desk'} still={still}
                task={working && places[key] === 'desk' ? currentTask(key) : undefined} onPick={() => onPickAgent(seat.role)} />
              {path && (
                <Character role={seat.role} path={path} deskYaw={seat.face ?? 0} onDuty={duty} typing={working && !a?.thinking}
                  thinking={working && !!a?.thinking} bubble={bubble} bubbleAt={a?.lastAt} still={still} posStore={posStore}
                  onPlace={pl => setPlaces(prev => (prev[key] === pl ? prev : { ...prev, [key]: pl }))}
                  idle={idle[key] ?? null} chatIcon={chat[key]?.icon ?? null}
                  highlight={!!handoffActive && (hFrom?.role.key === key || hTo?.role.key === key)}
                  selected={picked?.key === key} onPick={() => onPickAgent(seat.role)} />
              )}
            </group>
          )
        })}
        {lastHandoff && hFrom && hTo && hFrom !== hTo && now - lastHandoff.created_at < 8 && (
          <PaperPlane key={lastHandoff.id} fromKey={hFrom.role.key} toKey={hTo.role.key} color={hFrom.role.color}
            posStore={posStore} still={still} />
        )}

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
