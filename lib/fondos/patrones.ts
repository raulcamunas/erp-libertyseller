/**
 * LOS DIBUJOS DE LOS FONDOS — PURO. Cada patrón se escribe UNA vez, como función del color con el que se pinta: el chat lo usa de máscara (con `#000`, y lo tiñe con el color del tema) y las
 * tareas lo pintan tal cual sobre un color oscuro. Son degradados de CSS y dibujos SVG pequeños en una dirección `data:` (nada se descarga, nada viene de fuera).
 */

export interface Patron {
  id: string
  nombre: string
  /** El tamaño de cada baldosa (`background-size` / `mask-size`); null si el patrón no se repite */
  tam: string | null
  /** El CSS de la imagen (una o varias capas) pintada con el color `c` */
  imagen: (c: string) => string
}

const svg = (w: number, h: number, c: string, cuerpo: string, relleno = false): string => {
  const estilo = relleno ? `fill='${c}' stroke='none'` : `fill='none' stroke='${c}' stroke-width='1' stroke-linecap='round' stroke-linejoin='round'`
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><g ${estilo}>${cuerpo}</g></svg>`)}")`
}

const lineas = (c: string, grados: number, cada: number, grosor = 1) => `repeating-linear-gradient(${grados}deg, ${c} 0 ${grosor}px, transparent ${grosor}px ${cada}px)`

export const PATRONES: readonly Patron[] = [
  { id: 'puntos', nombre: 'Puntos', tam: '22px 22px', imagen: (c) => `radial-gradient(${c} 1px, transparent 1.4px)` },
  { id: 'malla', nombre: 'Cuadrícula', tam: '30px 30px', imagen: (c) => `linear-gradient(${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)` },
  { id: 'milimetrado', nombre: 'Milimetrado', tam: '10px 10px, 10px 10px, 50px 50px, 50px 50px', imagen: (c) => `linear-gradient(${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px), linear-gradient(${c} 2px, transparent 2px), linear-gradient(90deg, ${c} 2px, transparent 2px)` },
  { id: 'lineas', nombre: 'Líneas', tam: null, imagen: (c) => lineas(c, 0, 26) },
  { id: 'cuaderno', nombre: 'Cuaderno', tam: null, imagen: (c) => `linear-gradient(90deg, transparent 56px, ${c} 56px 57px, transparent 57px), ${lineas(c, 0, 28)}` },
  { id: 'diagonales', nombre: 'Diagonales', tam: null, imagen: (c) => lineas(c, 45, 16) },
  { id: 'cruzadas', nombre: 'Cruzadas', tam: null, imagen: (c) => `${lineas(c, 45, 20)}, ${lineas(c, -45, 20)}` },
  { id: 'rayas', nombre: 'Rayas', tam: null, imagen: (c) => lineas(c, 90, 22, 2) },
  { id: 'tablero', nombre: 'Tablero', tam: '44px 44px', imagen: (c) => `conic-gradient(${c} 25%, transparent 0 50%, ${c} 0 75%, transparent 0)` },
  { id: 'vichy', nombre: 'Vichy', tam: '36px 36px', imagen: (c) => `linear-gradient(90deg, ${c} 50%, transparent 50%), linear-gradient(${c} 50%, transparent 50%)` },
  { id: 'polka', nombre: 'Polka', tam: '36px 36px', imagen: (c) => `radial-gradient(circle at 25% 25%, ${c} 3px, transparent 3.5px), radial-gradient(circle at 75% 75%, ${c} 3px, transparent 3.5px)` },
  { id: 'isometrica', nombre: 'Isométrica', tam: null, imagen: (c) => `${lineas(c, 30, 22)}, ${lineas(c, 150, 22)}, ${lineas(c, 90, 38)}` },
  { id: 'rombos', nombre: 'Rombos', tam: '40px 40px', imagen: (c) => svg(40, 40, c, "<path d='M20 0L40 20L20 40L0 20Z'/>") },
  { id: 'cruces', nombre: 'Cruces', tam: '32px 32px', imagen: (c) => svg(32, 32, c, "<path d='M16 11v10M11 16h10'/>") },
  { id: 'zigzag', nombre: 'Zigzag', tam: '40px 20px', imagen: (c) => svg(40, 20, c, "<path d='M0 15l10-10 10 10 10-10 10 10'/>") },
  { id: 'ladrillo', nombre: 'Ladrillo', tam: '48px 24px', imagen: (c) => svg(48, 24, c, "<path d='M0 0h48M0 12h48M24 0v12M0 12v12M48 12v12'/>") },
  { id: 'olas', nombre: 'Olas', tam: '60px 20px', imagen: (c) => svg(60, 20, c, "<path d='M0 10Q15 0 30 10T60 10'/>") },
  { id: 'hexagonos', nombre: 'Hexágonos', tam: '56px 100px', imagen: (c) => svg(56, 100, c, "<path d='M28 66L0 50L0 16L28 0L56 16L56 50L28 66L28 100'/><path d='M28 0L28 34L0 50L0 84L28 100L56 84L56 50L28 34'/>") },
  { id: 'topografia', nombre: 'Topografía', tam: '200px 200px', imagen: (c) => svg(200, 200, c, "<ellipse cx='60' cy='70' rx='50' ry='34'/><ellipse cx='60' cy='70' rx='36' ry='23'/><ellipse cx='60' cy='70' rx='22' ry='12'/><ellipse cx='150' cy='140' rx='44' ry='30'/><ellipse cx='150' cy='140' rx='30' ry='19'/><ellipse cx='150' cy='140' rx='16' ry='8'/>") },
  { id: 'escamas', nombre: 'Escamas', tam: '40px 20px', imagen: (c) => svg(40, 20, c, "<path d='M0 20a20 20 0 0 1 40 0M-20 10a20 20 0 0 1 40 0M20 10a20 20 0 0 1 40 0'/>") },
  { id: 'triangulos', nombre: 'Triángulos', tam: '40px 35px', imagen: (c) => svg(40, 35, c, "<path d='M0 35L20 0L40 35Z'/>") },
  { id: 'confeti', nombre: 'Confeti', tam: '120px 120px', imagen: (c) => svg(120, 120, c, "<path d='M10 20l6 2M40 12l-3 6M70 30l5-4M100 14l2 6M20 60l6-3M52 70l-2 6M88 66l6 2M112 90l-5 4M30 100l4 5M64 108l6-2'/><circle cx='28' cy='38' r='2'/><circle cx='84' cy='46' r='2'/><circle cx='104' cy='62' r='1.5'/><circle cx='10' cy='88' r='2'/><circle cx='76' cy='92' r='1.5'/>") },
  { id: 'estrellas', nombre: 'Estrellas', tam: '160px 160px', imagen: (c) => svg(160, 160, c, "<circle cx='12' cy='20' r='1.2'/><circle cx='48' cy='8' r='.8'/><circle cx='90' cy='30' r='1.5'/><circle cx='130' cy='14' r='1'/><circle cx='150' cy='60' r='1.3'/><circle cx='30' cy='70' r='1'/><circle cx='70' cy='86' r='.8'/><circle cx='112' cy='96' r='1.4'/><circle cx='20' cy='124' r='1.2'/><circle cx='58' cy='140' r='1'/><circle cx='100' cy='146' r='.8'/><circle cx='142' cy='128' r='1.5'/>", true) },
  { id: 'anillos', nombre: 'Anillos', tam: '48px 48px', imagen: (c) => svg(48, 48, c, "<circle cx='24' cy='24' r='14'/>") },
  { id: 'circuitos', nombre: 'Circuitos', tam: '80px 80px', imagen: (c) => svg(80, 80, c, "<path d='M0 20h30v20h20M50 0v30h30M20 80v-20h30M0 60h10'/><circle cx='50' cy='40' r='2'/><circle cx='80' cy='30' r='2'/><circle cx='50' cy='60' r='2'/>") },
  { id: 'arcos', nombre: 'Arcos', tam: '48px 24px', imagen: (c) => svg(48, 24, c, "<path d='M0 24a24 24 0 0 1 48 0'/><path d='M12 24a12 12 0 0 1 24 0'/>") },
  { id: 'grano', nombre: 'Grano', tam: '160px 160px', imagen: () => `url("data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>")}")` },
]

export const patronPorId = (id: string): Patron | undefined => PATRONES.find((p) => p.id === id)

/** Las capas de un valor de CSS separadas por comas de primer nivel (sin romper las que están dentro de paréntesis o comillas) */
export function capasDeCss(css: string): string[] {
  const capas: string[] = []
  let nivel = 0
  let comilla = ''
  let desde = 0
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (comilla) {
      if (ch === comilla) comilla = ''
    } else if (ch === '"' || ch === "'") comilla = ch
    else if (ch === '(') nivel += 1
    else if (ch === ')') nivel -= 1
    else if (ch === ',' && nivel === 0) {
      capas.push(css.slice(desde, i).trim())
      desde = i + 1
    }
  }
  capas.push(css.slice(desde).trim())
  return capas.filter(Boolean)
}

/** Un `background` completo: el dibujo pintado con `color`, cada capa con su tamaño, sobre un color de base */
export function patronComoFondo(p: Patron, color: string, base: string): string {
  const capas = capasDeCss(p.imagen(color))
  const tamanos = p.tam ? capasDeCss(p.tam) : []
  const conTamano = capas.map((c, i) => (tamanos.length > 0 ? `${c} 0 0 / ${tamanos[i % tamanos.length]}` : c))
  return [...conTamano, base].join(', ')
}
