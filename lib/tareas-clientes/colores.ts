import type { ColorNotion } from './tipos'

/**
 * LA PALETA DE TAREAS DE CLIENTES.
 *
 * Los diez colores de Notion, cada uno como una variable CSS `--tc-<nombre>` que declara el bloque «TAREAS DE CLIENTES» de app/globals.css, con su versión para el
 * tema claro. Las piezas pintan SIEMPRE con `colorCss()` o con las clases `tc-*`: ningún color suelto en los componentes.
 *
 * Los degradados de portada y fondo son listas cerradas con nombre (como las opciones de Notion): lo que se guarda es el nombre, y cada nombre es una receta de CSS.
 */

export const COLOR_POR_DEFECTO: ColorNotion = 'default'

const CONOCIDOS: ReadonlySet<string> = new Set(['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'])

/** Un nombre de color que no se conoce (o falta) se pinta como el gris neutro, nunca como un error */
export function colorValido(nombre: string | null | undefined): ColorNotion {
  return nombre && CONOCIDOS.has(nombre) ? (nombre as ColorNotion) : COLOR_POR_DEFECTO
}

/** El color como valor CSS, para `style={{ '--tono': colorCss('blue') }}` */
export function colorCss(nombre: string | null | undefined): string {
  return `var(--tc-${colorValido(nombre)})`
}

export const NOMBRE_DE_COLOR: Record<ColorNotion, string> = {
  default: 'Neutro',
  gray: 'Gris',
  brown: 'Marrón',
  orange: 'Naranja',
  yellow: 'Amarillo',
  green: 'Verde',
  blue: 'Azul',
  purple: 'Violeta',
  pink: 'Rosa',
  red: 'Rojo',
}

/** Los degradados para portadas y fondos: el nombre que se guarda y la receta que se pinta */
export const DEGRADADOS: ReadonlyArray<{ id: string; nombre: string; css: string }> = [
  { id: 'aurora', nombre: 'Aurora', css: 'linear-gradient(120deg, #1f3b73 0%, #6b3fa0 45%, #e0527a 100%)' },
  { id: 'atardecer', nombre: 'Atardecer', css: 'linear-gradient(120deg, #3a1c71 0%, #d76d77 50%, #ffaf7b 100%)' },
  { id: 'oceano', nombre: 'Océano', css: 'linear-gradient(120deg, #0f2027 0%, #1f5f7a 55%, #2c9ab7 100%)' },
  { id: 'bosque', nombre: 'Bosque', css: 'linear-gradient(120deg, #0b3d2e 0%, #1f7a55 55%, #7bc67e 100%)' },
  { id: 'brasa', nombre: 'Brasa', css: 'linear-gradient(120deg, #3b1206 0%, #b8400c 55%, #ff8a2b 100%)' },
  { id: 'noche', nombre: 'Noche', css: 'linear-gradient(120deg, #0b0f1a 0%, #1b2440 55%, #313f73 100%)' },
  { id: 'grafito', nombre: 'Grafito', css: 'linear-gradient(120deg, #15171b 0%, #262b33 55%, #3b4350 100%)' },
  { id: 'menta', nombre: 'Menta', css: 'linear-gradient(120deg, #0d4d4d 0%, #1f9c8c 55%, #b6f0d4 100%)' },
  { id: 'cereza', nombre: 'Cereza', css: 'linear-gradient(120deg, #3b0a1c 0%, #a31948 55%, #ff7aa2 100%)' },
  { id: 'arena', nombre: 'Arena', css: 'linear-gradient(120deg, #3a2e1e 0%, #8c6b3f 55%, #e6c88f 100%)' },
]

const DEGRADADO_POR_ID = new Map(DEGRADADOS.map((d) => [d.id, d.css]))

/** El CSS de fondo de una portada o un fondo guardados; null si no hay ninguno que pintar */
export function fondoCss(p: { tipo?: string; valor?: string; y?: number } | null | undefined): string | null {
  if (!p?.tipo || !p.valor) return null
  if (p.tipo === 'degradado') return DEGRADADO_POR_ID.get(p.valor) ?? null
  if (p.tipo === 'color') return /^#[0-9a-fA-F]{3,8}$/.test(p.valor) ? p.valor : colorCss(p.valor)
  // Una imagen solo se acepta si viene de nuestro almacén o de una dirección https: nada de `javascript:` ni de rutas locales dentro de un `url()`
  if (p.tipo === 'imagen' && /^https:\/\/[^\s"'()]+$/.test(p.valor)) return `url("${p.valor}")`
  return null
}

/**
 * LOS FONDOS ANIMADOS: luces de color que derivan despacio detrás de todo. Se pintan con CSS (clases `tc-fa-*` de app/globals.css), sin imágenes ni scripts, y solo mueven
 * `translate` y `scale` (lo que el navegador anima en la tarjeta gráfica): casi no gastan. Quien pide menos movimiento los ve quietos.
 */
export const FONDOS_ANIMADOS: ReadonlyArray<{ id: string; nombre: string }> = [
  { id: 'aurora', nombre: 'Aurora' },
  { id: 'nebulosa', nombre: 'Nebulosa' },
  { id: 'brasas', nombre: 'Brasas' },
  { id: 'oceano', nombre: 'Océano' },
  { id: 'crepusculo', nombre: 'Crepúsculo' },
  { id: 'malla', nombre: 'Malla' },
]
const ANIMADOS: ReadonlySet<string> = new Set(FONDOS_ANIMADOS.map((f) => f.id))

/** El nombre del fondo animado guardado, o null si no hay (o no se conoce: nunca se pinta algo que no está en la lista) */
export function fondoAnimadoId(p: { tipo?: string; valor?: string } | null | undefined): string | null {
  return p?.tipo === 'animado' && p.valor && ANIMADOS.has(p.valor) ? p.valor : null
}

/** Los colores lisos que se ofrecen para una portada */
export const COLORES_DE_PORTADA: ReadonlyArray<{ id: string; nombre: string; valor: string }> = [
  { id: 'negro', nombre: 'Negro', valor: '#141518' },
  { id: 'pizarra', nombre: 'Pizarra', valor: '#2b3038' },
  { id: 'naranja', nombre: 'Naranja', valor: '#c9540a' },
  { id: 'azul', nombre: 'Azul', valor: '#245ea8' },
  { id: 'verde', nombre: 'Verde', valor: '#2a7d5a' },
  { id: 'violeta', nombre: 'Violeta', valor: '#6a45b0' },
  { id: 'rosa', nombre: 'Rosa', valor: '#b8386f' },
  { id: 'arena', nombre: 'Arena', valor: '#8a7355' },
]
