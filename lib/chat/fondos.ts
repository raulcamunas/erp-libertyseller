import { PALETAS } from '@/lib/fondos/paletas'
import { PATRONES } from '@/lib/fondos/patrones'

/**
 * LOS FONDOS DEL CHAT — PURO. Una pantalla de 69 fondos en tres familias:
 *   · LUCES: manchas de luz del color del tema que se elija (y el liso);
 *   · PATRONES: dibujos (puntos, cuadrícula, olas, hexágonos…) teñidos con el color del tema o en gris;
 *   · ESCENAS: paisajes de color fijos (océano, bosque, lava…) que no dependen del tema.
 * Cada fondo son cuatro variables de CSS (`variablesDeFondo`): el fondo en sí (`--chat-fondo`) y, si lleva dibujo, la máscara del dibujo (`--chat-patron`, `--chat-tam`) y su color
 * (`--chat-tinte`). Se pintan sobre toda la columna del chat (cabecera, mensajes y caja de escribir), no solo sobre la lista de mensajes. Se comprueba en fondos.prueba.ts.
 */

export type GrupoDeFondo = 'luces' | 'patrones' | 'escenas'
type Tinte = 'acento' | 'acento2' | 'neutro' | 'suave'

export interface FondoDeChat {
  id: string
  nombre: string
  grupo: GrupoDeFondo
  /** El `background` de la columna */
  fondo?: string
  /** La capa del dibujo (se usa como máscara) y el tamaño de su baldosa */
  patron?: string
  tam?: string | null
  tinte?: Tinte
}

const ACENTO = 'var(--c-acc, var(--ls-acc))'
const ACENTO_DOS = 'var(--c-acc-dos, var(--ls-acc))'
const mezcla = (color: string, por: number) => `color-mix(in srgb, ${color} ${por}%, transparent)`
const a1 = (p: number) => mezcla(ACENTO, p)
const a2 = (p: number) => mezcla(ACENTO_DOS, p)

export const TINTES: Record<Tinte, string> = {
  acento: mezcla(ACENTO, 26),
  acento2: mezcla(ACENTO_DOS, 24),
  neutro: 'color-mix(in srgb, var(--ls-t1) 11%, transparent)',
  suave: 'color-mix(in srgb, var(--ls-t1) 5%, transparent)',
}

const luz = (id: string, nombre: string, fondo?: string): FondoDeChat => ({ id, nombre, grupo: 'luces', fondo })

const LUCES: FondoDeChat[] = [
  luz('liso', 'Liso'),
  luz('aurora', 'Aurora', `radial-gradient(900px 520px at 90% -8%, ${a1(12)}, transparent 62%), radial-gradient(760px 520px at -6% 108%, ${a2(10)}, transparent 62%)`),
  luz('haz', 'Haz', `linear-gradient(160deg, ${a1(16)} 0%, transparent 46%)`),
  luz('esquina-arriba', 'Esquina arriba', `radial-gradient(820px 520px at 0% 0%, ${a1(20)}, transparent 65%)`),
  luz('esquina-abajo', 'Esquina abajo', `radial-gradient(820px 520px at 100% 100%, ${a1(20)}, transparent 65%)`),
  luz('foco', 'Foco', `radial-gradient(700px 500px at 50% 40%, ${a1(13)}, transparent 70%)`),
  luz('horizonte', 'Horizonte', `linear-gradient(0deg, ${a2(18)} 0%, transparent 38%)`),
  luz('mitades', 'Mitades', `linear-gradient(90deg, ${a1(9)}, ${a2(9)})`),
  luz('halo', 'Halo', `radial-gradient(closest-side at 50% 45%, transparent 55%, ${a1(14)} 72%, transparent 100%)`),
  luz('nubes', 'Nubes', `radial-gradient(520px 300px at 20% 25%, ${a1(12)}, transparent 70%), radial-gradient(560px 320px at 78% 40%, ${a2(11)}, transparent 70%), radial-gradient(500px 300px at 40% 85%, ${a1(9)}, transparent 70%)`),
  luz('amanecer', 'Amanecer', `radial-gradient(1200px 520px at 50% 118%, ${a2(28)}, transparent 66%), linear-gradient(0deg, ${a1(6)}, transparent 40%)`),
  luz('doble-foco', 'Doble foco', `radial-gradient(620px 420px at 15% 20%, ${a1(17)}, transparent 70%), radial-gradient(620px 420px at 85% 80%, ${a2(17)}, transparent 70%)`),
  luz('diagonal', 'Diagonal', `linear-gradient(120deg, transparent 30%, ${a1(10)} 50%, transparent 70%)`),
  luz('velo', 'Velo', `linear-gradient(180deg, ${a1(13)}, ${a2(5)} 60%, transparent)`),
]

/** Qué tinte lleva cada patrón (alternados, y los muy llenos más suaves) */
const TINTE_DE_PATRON: Record<string, Tinte> = {
  puntos: 'neutro', malla: 'neutro', milimetrado: 'acento', lineas: 'neutro', cuaderno: 'acento2', diagonales: 'neutro', cruzadas: 'acento', rayas: 'suave', tablero: 'suave', vichy: 'suave',
  polka: 'acento', isometrica: 'acento2', rombos: 'acento', cruces: 'neutro', zigzag: 'acento2', ladrillo: 'neutro', olas: 'acento', hexagonos: 'neutro', topografia: 'acento2', escamas: 'acento',
  triangulos: 'neutro', confeti: 'acento2', estrellas: 'neutro', anillos: 'acento', circuitos: 'acento2', arcos: 'neutro', grano: 'suave',
}

const PATRONES_DE_CHAT: FondoDeChat[] = PATRONES.map((p) => ({
  id: p.id,
  nombre: p.nombre,
  grupo: 'patrones' as const,
  // Un poco de luz del color del tema detrás del dibujo, para que no quede plano
  fondo: `radial-gradient(900px 520px at 90% -8%, ${a1(8)}, transparent 62%)`,
  patron: p.imagen('#000'),
  tam: p.tam,
  tinte: TINTE_DE_PATRON[p.id] ?? 'neutro',
}))

const ESCENAS: FondoDeChat[] = PALETAS.map((p) => ({
  id: `esc-${p.id}`,
  nombre: p.nombre,
  grupo: 'escenas' as const,
  fondo: `radial-gradient(1000px 560px at 8% -10%, ${mezcla(p.a, 26)}, transparent 62%), radial-gradient(900px 560px at 100% 110%, ${mezcla(p.b, 22)}, transparent 60%), radial-gradient(700px 420px at 58% 46%, ${mezcla(p.c, 10)}, transparent 72%)`,
}))

export const FONDOS_DEL_CHAT: readonly FondoDeChat[] = [...LUCES, ...PATRONES_DE_CHAT, ...ESCENAS]

export const GRUPOS_DE_FONDOS: ReadonlyArray<{ id: GrupoDeFondo; nombre: string }> = [
  { id: 'luces', nombre: 'Luces' },
  { id: 'patrones', nombre: 'Patrones' },
  { id: 'escenas', nombre: 'Escenas' },
]

const POR_ID = new Map(FONDOS_DEL_CHAT.map((f) => [f.id, f]))
export const fondoDelChat = (id: string | null | undefined): FondoDeChat | undefined => (id ? POR_ID.get(id) : undefined)
export const esFondoDelChat = (v: unknown): v is string => typeof v === 'string' && POR_ID.has(v)

/** Las variables de CSS que pintan ese fondo: se ponen en el marco del chat (o en una muestra) */
export function variablesDeFondo(id: string | null | undefined): Record<string, string> {
  const f = fondoDelChat(id)
  const v: Record<string, string> = { '--chat-fondo': f?.fondo ?? 'none', '--chat-patron': 'none', '--chat-tam': 'auto', '--chat-tinte': 'transparent' }
  if (f?.patron) {
    v['--chat-patron'] = f.patron
    v['--chat-tam'] = f.tam ?? 'auto'
    v['--chat-tinte'] = TINTES[f.tinte ?? 'neutro']
  }
  return v
}
