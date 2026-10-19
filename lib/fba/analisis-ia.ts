import { textoSeguro, type Nivel } from './reposicion'

/**
 * EL ANÁLISIS DE LA IA QUE SE GUARDA JUNTO A UNA PROPUESTA.
 * =========================================================
 * PURO. Se comprueba con analisis-ia.prueba.ts.
 *
 * Cuando una propuesta nace de la IA, lo que se guarda en la base no es solo la lista de
 * referencias y cantidades —eso ya es la remesa—, sino el PORQUÉ: el resumen, el criterio, los
 * riesgos, lo que habría que confirmar con el cliente y el motivo de cada línea. Meses después,
 * cuando el cliente pregunte «¿por qué mandamos 120 de esto?», la respuesta tiene que estar
 * a un clic y no depender de que alguien se acuerde.
 *
 * Va en UNA columna JSONB de fba_remesas (migración 230) y no en las líneas, a propósito: el
 * editor del boceto reescribe cada línea entera al guardar (EditorBoceto), y un campo nuevo
 * en la línea se habría perdido en el primer cambio de cantidad. Aquí no se toca.
 *
 * LO QUE LLEGA DEL NAVEGADOR NO SE GUARDA TAL CUAL. El cuerpo de la petición lo puede escribir
 * cualquiera con acceso a la ruta; `limpiarAnalisis` reconstruye el objeto desde cero, campo a
 * campo, con topes de longitud y de tamaño total. Lo que no encaja se descarta; nada se
 * ejecuta ni se interpreta.
 */

export interface LineaAnalizada {
  motivo: string
  prioridad: Nivel
  confianza: Nivel | null
  /** Quién puso la cantidad inicial: la IA o el cálculo */
  origen: 'ia' | 'calculo'
  /** Lo que salía de la cuenta base */
  base: number
  /** Lo que propuso la propuesta antes de que nadie la tocara */
  propuestas: number
}

export interface AnalisisIa {
  version: 1
  /** ISO */
  generadaEn: string
  modelo: string | null
  /** false = la propuesta salió solo del cálculo: la IA no contestó o no se pidió */
  usada: boolean
  aviso: string | null
  resumen: string | null
  estrategia: string | null
  riesgos: string[]
  dudas: string[]
  notas: string[]
  parametros: {
    coberturaObjetivo: number
    plazoDias: number
    margenDias: number
    multiplo: number
    minimoLinea: number
    topeUnidades: number | null
    notas: string
  }
  /** Por SKU */
  lineas: Record<string, LineaAnalizada>
  descartadas: Array<{ sku: string; nombre: string | null; motivo: string; base: number }>
}

/** Un objeto de más de esto no se guarda entero: es ruido, no un análisis */
export const MAX_BYTES_ANALISIS = 200_000
const MAX_LINEAS = 3000

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const num = (v: unknown, defecto = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : defecto)
const entero = (v: unknown, defecto = 0): number => Math.round(num(v, defecto))
const nivel = (v: unknown): Nivel | null => (v === 'alta' || v === 'media' || v === 'baja' ? v : null)
const textoONulo = (v: unknown, max: number): string | null => {
  const t = textoSeguro(v, max)
  return t === '' ? null : t
}
const listaDe = (v: unknown, max: number, largo: number): string[] =>
  Array.isArray(v) ? v.map((x) => textoSeguro(x, largo)).filter((x) => x !== '').slice(0, max) : []

/** Lo que llega, o null si no se parece a un análisis. Nunca lanza */
export function limpiarAnalisis(crudo: unknown): AnalisisIa | null {
  const o = obj(crudo)
  if (!o) return null

  const p = obj(o.parametros) ?? {}
  const lineas: AnalisisIa['lineas'] = {}
  const entrada = obj(o.lineas) ?? {}
  for (const [sku, valor] of Object.entries(entrada).slice(0, MAX_LINEAS)) {
    const l = obj(valor)
    const limpio = sku.trim().slice(0, 120)
    // «__proto__» es una clave propia al venir de un JSON, pero asignarla a un objeto normal
    // le cambia el prototipo en vez de crear la entrada: ningún SKU de verdad se llama así
    if (!l || !limpio || limpio === '__proto__') continue
    lineas[limpio] = {
      motivo: textoSeguro(l.motivo, 300),
      prioridad: nivel(l.prioridad) ?? 'media',
      confianza: nivel(l.confianza),
      origen: l.origen === 'ia' ? 'ia' : 'calculo',
      base: Math.max(0, entero(l.base)),
      propuestas: Math.max(0, entero(l.propuestas)),
    }
  }

  const descartadas: AnalisisIa['descartadas'] = []
  if (Array.isArray(o.descartadas)) {
    for (const d of o.descartadas.slice(0, MAX_LINEAS)) {
      const x = obj(d)
      const sku = typeof x?.sku === 'string' ? x.sku.trim().slice(0, 120) : ''
      if (x && sku) descartadas.push({ sku, nombre: textoONulo(x.nombre, 120), motivo: textoSeguro(x.motivo, 300), base: Math.max(0, entero(x.base)) })
    }
  }

  const tope = p.topeUnidades === null || p.topeUnidades === undefined ? null : Math.max(1, entero(p.topeUnidades, 1))
  const analisis: AnalisisIa = {
    version: 1,
    generadaEn: typeof o.generadaEn === 'string' && !Number.isNaN(Date.parse(o.generadaEn)) ? new Date(o.generadaEn).toISOString() : new Date().toISOString(),
    modelo: textoONulo(o.modelo, 60),
    usada: o.usada === true,
    aviso: textoONulo(o.aviso, 400),
    resumen: textoONulo(o.resumen, 1500),
    estrategia: textoONulo(o.estrategia, 1500),
    riesgos: listaDe(o.riesgos, 12, 400),
    dudas: listaDe(o.dudas, 12, 400),
    notas: listaDe(o.notas, 12, 400),
    parametros: {
      coberturaObjetivo: Math.max(0, entero(p.coberturaObjetivo)),
      plazoDias: Math.max(0, entero(p.plazoDias)),
      margenDias: Math.max(0, entero(p.margenDias)),
      multiplo: Math.max(1, entero(p.multiplo, 1)),
      minimoLinea: Math.max(1, entero(p.minimoLinea, 1)),
      topeUnidades: tope,
      notas: textoSeguro(p.notas, 1500),
    },
    lineas,
    descartadas,
  }

  // Demasiado grande: se conserva lo importante y se tira el detalle de lo descartado
  if (JSON.stringify(analisis).length > MAX_BYTES_ANALISIS) analisis.descartadas = []
  if (JSON.stringify(analisis).length > MAX_BYTES_ANALISIS) return null
  return analisis
}
