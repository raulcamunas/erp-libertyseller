/**
 * LAS PALETAS DE LOS FONDOS — PURO. Tres colores por paleta: los de las luces de un fondo del chat y los de un fondo animado de las tareas. Aquí también están los pequeños ayudantes de color
 * (transparencia y oscurecer) que usan los catálogos. Se comprueba en fondos.prueba.ts.
 */

export interface Paleta {
  id: string
  nombre: string
  a: string
  b: string
  c: string
}

export const PALETAS: readonly Paleta[] = [
  { id: 'oceano', nombre: 'Océano', a: '#0ea5e9', b: '#14b8a6', c: '#3b5bdb' },
  { id: 'bosque', nombre: 'Bosque', a: '#22c55e', b: '#0d9488', c: '#a3e635' },
  { id: 'atardecer', nombre: 'Atardecer', a: '#fb7185', b: '#f59e0b', c: '#6366f1' },
  { id: 'neon', nombre: 'Neón', a: '#22d3ee', b: '#a855f7', c: '#f43f5e' },
  { id: 'lava', nombre: 'Lava', a: '#ef4444', b: '#f97316', c: '#b91c1c' },
  { id: 'hielo', nombre: 'Hielo', a: '#67e8f9', b: '#60a5fa', c: '#c7d2fe' },
  { id: 'sakura', nombre: 'Sakura', a: '#f9a8d4', b: '#fb7185', c: '#c084fc' },
  { id: 'dorado', nombre: 'Dorado', a: '#f5b301', b: '#f97316', c: '#fde047' },
  { id: 'medianoche', nombre: 'Medianoche', a: '#1d4ed8', b: '#4338ca', c: '#0ea5e9' },
  { id: 'menta', nombre: 'Menta', a: '#34d399', b: '#2dd4bf', c: '#a7f3d0' },
  { id: 'cereza', nombre: 'Cereza', a: '#e11d48', b: '#be185d', c: '#fb7185' },
  { id: 'arena', nombre: 'Arena', a: '#d6a85c', b: '#b45309', c: '#fcd34d' },
  { id: 'violeta', nombre: 'Violeta', a: '#8b5cf6', b: '#7c3aed', c: '#e879f9' },
  { id: 'cobre', nombre: 'Cobre', a: '#c2410c', b: '#ea580c', c: '#fdba74' },
  { id: 'jade', nombre: 'Jade', a: '#059669', b: '#10b981', c: '#6ee7b7' },
  { id: 'zafiro', nombre: 'Zafiro', a: '#2563eb', b: '#0ea5e9', c: '#818cf8' },
  { id: 'coral', nombre: 'Coral', a: '#fb7185', b: '#fb923c', c: '#f472b6' },
  { id: 'lima', nombre: 'Lima', a: '#84cc16', b: '#22c55e', c: '#facc15' },
  { id: 'cafe', nombre: 'Café', a: '#92400e', b: '#78350f', c: '#d6a85c' },
  { id: 'ciruela', nombre: 'Ciruela', a: '#86198f', b: '#581c87', c: '#c026d3' },
  { id: 'cielo', nombre: 'Cielo', a: '#38bdf8', b: '#7dd3fc', c: '#a5b4fc' },
  { id: 'pizarra', nombre: 'Pizarra', a: '#64748b', b: '#475569', c: '#94a3b8' },
  { id: 'musgo', nombre: 'Musgo', a: '#4d7c0f', b: '#3f6212', c: '#a3e635' },
  { id: 'mandarina', nombre: 'Mandarina', a: '#fb923c', b: '#f97316', c: '#fbbf24' },
  { id: 'turquesa', nombre: 'Turquesa', a: '#14b8a6', b: '#06b6d4', c: '#5eead4' },
  { id: 'magenta', nombre: 'Magenta', a: '#d946ef', b: '#ec4899', c: '#a855f7' },
  { id: 'esmeralda', nombre: 'Esmeralda', a: '#10b981', b: '#059669', c: '#34d399' },
  { id: 'ambar', nombre: 'Ámbar', a: '#f59e0b', b: '#d97706', c: '#fcd34d' },
]

/** Fondos animados NUEVOS de las tareas: las paletas de arriba que aún no tenían uno, más unas cuantas con nombre propio */
export const PALETAS_ANIMADAS_NUEVAS: readonly Paleta[] = [
  ...PALETAS.filter((p) => !['oceano', 'bosque', 'lava', 'hielo', 'sakura', 'medianoche', 'dorado', 'neon', 'coral', 'atardecer'].includes(p.id)),
  { id: 'rubi', nombre: 'Rubí', a: '#e11d48', b: '#9f1239', c: '#fb7185' },
  { id: 'amatista', nombre: 'Amatista', a: '#a855f7', b: '#6d28d9', c: '#f0abfc' },
  { id: 'tropical', nombre: 'Tropical', a: '#14b8a6', b: '#f472b6', c: '#facc15' },
  { id: 'galaxia', nombre: 'Galaxia', a: '#6366f1', b: '#c026d3', c: '#22d3ee' },
  { id: 'otono', nombre: 'Otoño', a: '#ea580c', b: '#b45309', c: '#dc2626' },
  { id: 'primavera', nombre: 'Primavera', a: '#86efac', b: '#f9a8d4', c: '#fde047' },
  { id: 'verano', nombre: 'Verano', a: '#facc15', b: '#38bdf8', c: '#fb7185' },
  { id: 'invierno', nombre: 'Invierno', a: '#93c5fd', b: '#cbd5e1', c: '#818cf8' },
  { id: 'cristal', nombre: 'Cristal', a: '#a5f3fc', b: '#e9d5ff', c: '#bae6fd' },
  { id: 'ceniza', nombre: 'Ceniza', a: '#9ca3af', b: '#6b7280', c: '#d1d5db' },
]

/** «#rrggbb» (o «#rgb») con transparencia, como `rgba()` */
export function conAlfa(hex: string, alfa: number): string {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map((x) => x + x).join('') : h
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alfa})`
}

/** El mismo color mezclado con negro: `f` = 1 no cambia nada, 0 es negro */
export function oscurecer(hex: string, f: number): string {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map((x) => x + x).join('') : h
  const trozo = (i: number) => Math.round(parseInt(n.slice(i, i + 2), 16) * f).toString(16).padStart(2, '0')
  return `#${trozo(0)}${trozo(2)}${trozo(4)}`
}
