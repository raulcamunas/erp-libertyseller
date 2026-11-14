/**
 * LAS PALABRAS, LOS ASIN Y LAS NEGATIVAS CON LAS QUE NACEN LAS CAMPAÑAS DE UN PRODUCTO — PURO.
 *
 * Hasta el 14 nov 2026 «Crear campañas» dejaba las 4 campañas vacías y la persona de marketing las rellenaba a mano con la skill «ppc-arranque-frase-exacta»
 * (Cerebro + ASIN Grabber de Helium 10). Ahora el ERP lo propone y el administrativo revisa y aplica:
 *
 *   · FRASE    (→ MANUAL AMPLIA, coincidencia de frase)  lo relevante con volumen: la fábrica. 25–35 como mucho.
 *   · EXACTA   (→ MANUAL EXACTA / DOMINIO)               como mucho 6 de día 1: lo que ya vende (términos con 2+ pedidos) o donde ya nos compran.
 *   · ASIN     (→ ATAQUE ASIN)                           los productos de la competencia que se llevan las búsquedas del producto.
 *   · NEGATIVA (→ AUTO RADAR y MANUAL AMPLIA)            lo que ya gastó sin vender, y lo que Helium 10 dice que es otro producto. Se carga ANTES de activar.
 *   · NEGATIVA ASIN (→ AUTO RADAR)                       fichas de producto que gastaron sin vender.
 *
 * Fuentes: los términos de búsqueda de la cuenta (las campañas de ESE producto), las búsquedas de Brand Analytics del producto (SEO de fichas), la competencia de
 * Brand Analytics (los 3 ASIN que más clics se llevan en cada búsqueda) y, si se suben, los CSV de Helium 10 (la clasificación de Cerebro la hace la IA:
 * semillas-ia.ts; aquí solo se juntan).
 */
import type { FilaDeTermino } from './terminos'

export type DestinoDeSemilla = 'frase' | 'exacta' | 'asin' | 'negativa' | 'negativa-asin'
export type FuenteDeSemilla = 'terminos' | 'busquedas' | 'competencia' | 'cerebro' | 'grabber'

export interface Semilla {
  /** destino|texto: único por propuesta */
  id: string
  texto: string
  destino: DestinoDeSemilla
  fuente: FuenteDeSemilla
  motivo: string
  volumen?: number | null
  /** Puja propuesta (no aplica a negativas) */
  puja: number | null
}

export const MAX_EXACTA = 6
export const MAX_FRASE = 35
export const MAX_ASIN = 20
export const MAX_NEGATIVAS = 120

export const NOMBRE_DESTINO: Record<DestinoDeSemilla, { titulo: string; donde: string }> = {
  frase: { titulo: 'Palabras de frase', donde: 'MANUAL AMPLIA' },
  exacta: { titulo: 'Palabras exactas', donde: 'MANUAL EXACTA / DOMINIO (y negativas exactas en AUTO y AMPLIA para que no compitan)' },
  asin: { titulo: 'Productos a atacar', donde: 'ATAQUE ASIN' },
  negativa: { titulo: 'Negativas', donde: 'AUTO RADAR y MANUAL AMPLIA' },
  'negativa-asin': { titulo: 'Productos excluidos', donde: 'AUTO RADAR' },
}

/** El término ES la keyword (o el ASIN) que lo trajo: eso no se negativiza ni se duplica, se arregla con la puja */
const esSuya = (t: Pick<FilaDeTermino, 'keyword' | 'esSuSegmentacion'>, texto: string) => Boolean(t.esSuSegmentacion) || (t.keyword ?? '').trim().toLowerCase() === texto
const esAsin = (t: string) => /^b0[a-z0-9]{8}$/i.test(t.trim())
const redondear = (n: number) => Math.max(0.02, Math.round(n * 100) / 100)
const clave = (d: DestinoDeSemilla, t: string) => `${d}|${t.trim().toLowerCase()}`

export interface BusquedaDelProducto {
  consulta: string
  volumen: number | null
  cuotaCompras: number | null
  comprasAsin: number | null
  /** El embudo de SEO dice que es del producto (ni ruido ni de otro precio) */
  relevante: boolean
}

export interface EntradaDeSemillas {
  asin: string
  /** Los ASIN del propio cliente (no se atacan ni se excluyen) */
  propios: ReadonlySet<string>
  /** Los términos de búsqueda de las campañas de este producto (30 días) */
  terminos: readonly FilaDeTermino[]
  busquedas: readonly BusquedaDelProducto[]
  /** ASIN de la competencia que más clics se llevan en las búsquedas del producto */
  competencia: ReadonlyArray<{ asin: string; consulta: string; cuotaClics: number | null }>
  pujaBase: number
  /** Conversión de la cuenta (pedidos ÷ clics): fija cuántos clics sin venta bastan para cortar. null = 10 clics */
  cvr: number | null
  /** El título (y el resumen) del producto: lo que lo describe NUNCA se propone como negativa */
  descripcion?: string
}

const raizDe = (w: string) => w.replace(/(es|s)$/, '')
const palabrasDe = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3)
    .map(raizDe)

/** ¿El término describe el propio producto? Todas sus palabras de 3+ letras están en el título. Ej.: «jamonero giratorio» en «Jamonero giratorio profesional» */
export function describeElProducto(termino: string, descripcion: string | undefined): boolean {
  if (!descripcion) return false
  const delProducto = new Set(palabrasDe(descripcion))
  const p = palabrasDe(termino)
  return p.length > 0 && p.every((w) => delProducto.has(w))
}

/** Clics sin venta a partir de los cuales un término se excluye: 3 ÷ conversión (lo que sale en la investigación de 2026), entre 8 y 40 */
export const clicsParaCortar = (cvr: number | null) => (cvr && cvr > 0 ? Math.min(40, Math.max(8, Math.ceil(3 / cvr))) : 10)

export function semillasDeLaCuenta(e: EntradaDeSemillas): Semilla[] {
  const salida = new Map<string, Semilla>()
  const poner = (s: Omit<Semilla, 'id'>) => {
    const id = clave(s.destino, s.texto)
    if (!salida.has(id)) salida.set(id, { ...s, id, texto: s.texto.trim().toLowerCase() })
  }
  const corte = clicsParaCortar(e.cvr)

  // Términos de la cuenta, sumados por texto (un mismo término en varias campañas del producto)
  const porTermino = new Map<string, { clics: number; gasto: number; compras: number; ventas: number; yaEsSuya: boolean }>()
  for (const t of e.terminos) {
    const k = t.termino.trim().toLowerCase()
    if (!k) continue
    const x = porTermino.get(k) ?? { clics: 0, gasto: 0, compras: 0, ventas: 0, yaEsSuya: false }
    x.clics += t.clics
    x.gasto += t.gasto
    x.compras += t.compras
    x.ventas += t.ventas
    // Ya es una keyword EXACTA propia: no se vuelve a proponer
    x.yaEsSuya = x.yaEsSuya || (esSuya(t, k) && (t.matchType ?? '').toUpperCase() === 'EXACT')
    porTermino.set(k, x)
  }
  const ordenados = [...porTermino].sort((a, b) => b[1].compras - a[1].compras || b[1].ventas - a[1].ventas)

  // EXACTA: lo que ya vende
  for (const [texto, x] of ordenados) {
    if (esAsin(texto) || x.yaEsSuya || x.compras < 2) continue
    const cpc = x.clics > 0 ? x.gasto / x.clics : e.pujaBase
    poner({ texto, destino: 'exacta', fuente: 'terminos', motivo: `${x.compras} pedidos con ${x.clics} clics en 30 días`, puja: redondear(cpc * 1.1) })
  }
  // EXACTA: donde Brand Analytics dice que ya nos compran (dominio)
  for (const b of [...e.busquedas].filter((b) => b.relevante && (b.comprasAsin ?? 0) >= 2).sort((a, b) => (b.comprasAsin ?? 0) - (a.comprasAsin ?? 0))) {
    poner({ texto: b.consulta, destino: 'exacta', fuente: 'busquedas', motivo: `Te compran ahí: ${b.comprasAsin} compras (${((b.cuotaCompras ?? 0) * 100).toFixed(1)} % de la búsqueda)`, volumen: b.volumen, puja: e.pujaBase })
  }
  const exactas = new Set([...salida.values()].filter((s) => s.destino === 'exacta').slice(0, MAX_EXACTA).map((s) => s.texto))
  for (const s of [...salida.values()]) if (s.destino === 'exacta' && !exactas.has(s.texto)) salida.delete(s.id)

  // FRASE: lo relevante con volumen de Brand Analytics, y los términos que han vendido una vez
  for (const b of [...e.busquedas].filter((b) => b.relevante).sort((a, b) => (b.volumen ?? 0) - (a.volumen ?? 0))) {
    if (exactas.has(b.consulta.toLowerCase())) continue
    // Una sola palabra («tarjeta») es demasiado genérica para arrancar, salvo que ya te compren por ella
    if (b.consulta.trim().split(/\s+/).length < 2 && (b.comprasAsin ?? 0) === 0) continue
    poner({ texto: b.consulta, destino: 'frase', fuente: 'busquedas', motivo: `Búsqueda del producto en Brand Analytics${b.volumen ? `: ${b.volumen.toLocaleString('es-ES')} búsquedas` : ''}`, volumen: b.volumen, puja: e.pujaBase })
  }
  for (const [texto, x] of ordenados) {
    if (esAsin(texto) || exactas.has(texto) || x.compras !== 1) continue
    poner({ texto, destino: 'frase', fuente: 'terminos', motivo: `1 pedido con ${x.clics} clics`, puja: e.pujaBase })
  }

  // NEGATIVA: lo que gastó sin vender (y no es la propia keyword que lo trajo: eso se arregla con la puja)
  for (const [texto, x] of [...porTermino].sort((a, b) => b[1].gasto - a[1].gasto)) {
    if (x.compras > 0 || x.clics < corte) continue
    // Lo que describe el propio producto no se excluye nunca: si gasta sin vender, es la puja, el precio o la ficha
    if (!esAsin(texto) && describeElProducto(texto, e.descripcion)) continue
    if (esAsin(texto)) {
      if (!e.propios.has(texto.toUpperCase())) poner({ texto, destino: 'negativa-asin', fuente: 'terminos', motivo: `${x.clics} clics y ${x.gasto.toFixed(2).replace('.', ',')} gastados sin vender`, puja: null })
    } else if (!e.terminos.some((t) => t.termino.trim().toLowerCase() === texto && esSuya(t, texto))) {
      poner({ texto, destino: 'negativa', fuente: 'terminos', motivo: `${x.clics} clics y ${x.gasto.toFixed(2).replace('.', ',')} gastados sin vender`, puja: null })
    }
  }

  // ASIN: los que vendieron como término, y la competencia de Brand Analytics (los que más se repiten en las búsquedas del producto)
  for (const [texto, x] of ordenados) {
    if (!esAsin(texto) || x.compras < 1 || e.propios.has(texto.toUpperCase())) continue
    poner({ texto, destino: 'asin', fuente: 'terminos', motivo: `Desde su ficha te compraron ${x.compras} ${x.compras === 1 ? 'vez' : 'veces'}`, puja: e.pujaBase })
  }
  const veces = new Map<string, string[]>()
  for (const c of e.competencia) {
    const a = c.asin.toUpperCase()
    if (a === e.asin.toUpperCase() || e.propios.has(a)) continue
    veces.set(a, [...(veces.get(a) ?? []), c.consulta])
  }
  for (const [a, consultas] of [...veces].sort((x, y) => y[1].length - x[1].length)) {
    poner({ texto: a, destino: 'asin', fuente: 'competencia', motivo: `Se lleva clics en ${consultas.length} ${consultas.length === 1 ? 'búsqueda' : 'búsquedas'} del producto («${consultas[0]}»${consultas.length > 1 ? '…' : ''})`, puja: e.pujaBase })
  }

  return limitar([...salida.values()])
}

/** Recorta cada destino a su máximo (en el orden en que llegaron: lo primero es lo mejor) */
export function limitar(xs: readonly Semilla[]): Semilla[] {
  const max: Record<DestinoDeSemilla, number> = { exacta: MAX_EXACTA, frase: MAX_FRASE, asin: MAX_ASIN, negativa: MAX_NEGATIVAS, 'negativa-asin': 60 }
  const cuenta: Record<string, number> = {}
  return xs.filter((s) => (cuenta[s.destino] = (cuenta[s.destino] ?? 0) + 1) <= max[s.destino])
}

/** Junta las de la cuenta con las de Helium 10 sin repetir; ante el mismo texto, manda la de la cuenta (tiene datos propios) */
export function juntar(...listas: ReadonlyArray<readonly Semilla[]>): Semilla[] {
  const vistas = new Map<string, Semilla>()
  for (const l of listas) for (const s of l) if (!vistas.has(s.id)) vistas.set(s.id, s)
  // Una palabra que va a exacta no va también a frase ni a negativa
  const exactas = new Set([...vistas.values()].filter((s) => s.destino === 'exacta').map((s) => s.texto))
  return limitar([...vistas.values()].filter((s) => s.destino === 'exacta' || !exactas.has(s.texto) || s.destino === 'asin'))
}

/** Del ASIN Grabber: la competencia que conviene atacar, según el perfil del propio producto (skill ppc-arranque, asin-targeting) */
export function semillasDelGrabber(filas: ReadonlyArray<{ asin: string; marca: string | null; precio: number | null; valoracion: number | null; resenas: number | null }>, propio: { asin: string; marca: string | null; precio: number | null; propios: ReadonlySet<string> }, pujaBase: number): Semilla[] {
  const marca = (propio.marca ?? '').trim().toLowerCase()
  const salida: Semilla[] = []
  for (const f of filas) {
    if (f.asin === propio.asin.toUpperCase() || propio.propios.has(f.asin)) continue
    if (marca && (f.marca ?? '').trim().toLowerCase() === marca) continue
    const motivos: string[] = []
    if (propio.precio && f.precio && f.precio >= propio.precio * 1.1) motivos.push(`más caro (${f.precio.toLocaleString('es-ES')})`)
    if (f.valoracion != null && f.valoracion < 4.2) motivos.push(`peor valorado (${f.valoracion.toLocaleString('es-ES')}★)`)
    // La trampa del SOP: mal valorado pero con miles de reseñas no es una oportunidad (las nuestras quedan en evidencia al lado)
    if (motivos.length === 0 || (f.resenas ?? 0) > 3000) continue
    salida.push({ id: clave('asin', f.asin), texto: f.asin.toLowerCase(), destino: 'asin', fuente: 'grabber', motivo: `ASIN Grabber: ${motivos.join(' y ')}`, puja: pujaBase })
  }
  return salida.slice(0, MAX_ASIN)
}

/** Las de Cerebro, ya clasificadas por la IA (semillas-ia.ts) */
export function semillasDeCerebro(c: { frase: ReadonlyArray<{ texto: string; volumen: number | null; puja: number | null }>; exacta: ReadonlyArray<{ texto: string; volumen: number | null; puja: number | null; motivo: string }>; negativas: ReadonlyArray<{ texto: string; familia: string }> }, pujaBase: number): Semilla[] {
  return [
    ...c.exacta.map((x) => ({ id: clave('exacta', x.texto), texto: x.texto.toLowerCase(), destino: 'exacta' as const, fuente: 'cerebro' as const, motivo: `Cerebro: ${x.motivo}`, volumen: x.volumen, puja: redondear(x.puja ?? pujaBase) })),
    ...c.frase.map((x) => ({ id: clave('frase', x.texto), texto: x.texto.toLowerCase(), destino: 'frase' as const, fuente: 'cerebro' as const, motivo: `Cerebro${x.volumen ? `: ${x.volumen.toLocaleString('es-ES')} búsquedas al mes` : ''}`, volumen: x.volumen, puja: redondear(x.puja ?? pujaBase) })),
    ...c.negativas.map((x) => ({ id: clave('negativa', x.texto), texto: x.texto.toLowerCase(), destino: 'negativa' as const, fuente: 'cerebro' as const, motivo: `Cerebro · ${x.familia}`, puja: null })),
  ]
}
