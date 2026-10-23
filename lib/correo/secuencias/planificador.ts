import { diaDeMadrid, diaHabilDesde, instanteDeMadrid, partesDeMadrid, siguienteDiaHabil } from './fechas'
import { esDominioLibre, type AjustesDelMotor } from './reglas'

/**
 * EL PLANIFICADOR: A QUÉ HORA EXACTA SALE CADA SEGUIMIENTO.
 * ==========================================================
 * PURO: no toca la base ni la red. Se comprueba con planificador.prueba.ts.
 *
 * Mira TODOS los buzones a la vez (un único calendario del día, en hora de Madrid) y reparte los envíos al azar entre las 9:00 y las 18:00 de
 * lunes a viernes sin festivos, cumpliendo siempre:
 *
 *   · un hueco mínimo entre dos envíos cualesquiera de todo el sistema (`huecoGlobalS`) y otro, mayor, entre dos del mismo buzón (`huecoBuzonS`):
 *     nunca salen dos a la vez ni dos seguidos desde el mismo buzón;
 *   · media hora de separación entre dos correos a la misma empresa, aunque salgan de comerciales distintos;
 *   · la capacidad de cada buzón en cada día (su tope por la rampa menos lo ya enviado y lo ya programado): lo que no cabe pasa al siguiente
 *     día hábil, y así hasta encontrar hueco.
 *
 * EL AZAR NO ES UNIFORME. Cada tramo de 5 minutos pesa más o menos: `pesoMananaPct` reparte cuánto cae antes de las 14:00, y las horas en las
 * que el dueño del buzón llama (y escribe sus correos a mano) pesan menos, para que el buzón salga parejo a lo largo del día y no se apilen sus
 * correos automáticos justo cuando más manda a mano. El azar se saca de una semilla (la del paso + la general), así que el mismo encargo da
 * siempre el mismo reparto: se puede comprobar, y volver a calcularlo no mueve lo ya programado (eso entra como «ocupado», no se vuelve a elegir).
 */

export interface PasoPorPlanificar {
  id: string
  buzonId: string
  /** El primer día en que puede salir (YYYY-MM-DD). Si no es hábil, o ya pasó, se busca el siguiente que sí */
  desde: string
  /** Dominio de quien lo recibe, en minúsculas ('' si no se sabe) */
  dominio: string
}

export interface Ocupacion {
  /** El instante, en ms */
  en: number
  buzonId: string
  dominio: string
}

export interface HorarioDelBuzon {
  /** En qué horas llama su dueño (y manda a mano), en minutos desde la medianoche */
  llamadasDesdeMin: number
  llamadasHastaMin: number
}

export interface EntradaDelPlanificador {
  pasos: readonly PasoPorPlanificar[]
  buzones: ReadonlyMap<string, HorarioDelBuzon>
  /** Lo que ya está enviado o programado: no se pisa */
  ocupados: readonly Ocupacion[]
  /** Cuántos correos MÁS cabe mandar desde un buzón en un día. Con 0 o menos, ese día está lleno */
  capacidad: (buzonId: string, dia: string) => number
  ahora: number
  ajustes: Pick<AjustesDelMotor, 'ventanaDesdeMin' | 'ventanaHastaMin' | 'huecoGlobalS' | 'huecoBuzonS' | 'pesoMananaPct' | 'festivos'>
  semilla?: number
  /** Cuántos días hábiles hacia delante se busca hueco como mucho (por defecto 30) */
  horizonteDias?: number
}

export interface Asignacion {
  pasoId: string
  programadoAt: number
  dia: string
}

export interface ResultadoDelPlan {
  asignaciones: Asignacion[]
  /** Los pasos para los que no ha habido hueco dentro del horizonte */
  sinHueco: string[]
}

/** Tramo de azar: 5 minutos */
const TRAMO_MIN = 5
/** Separación entre dos correos a la misma empresa */
export const HUECO_POR_EMPRESA_MS = 30 * 60_000
/** Lo que se deja por delante de «ahora» al planificar el día de hoy */
const MARGEN_DE_HOY_MS = 90_000
/**
 * Lo que se deja libre al FINAL de la ventana. El motor pasa una vez por minuto y los huecos entre envíos (3 minutos por buzón) pueden atrasar un
 * poco uno que ya tocaba: un correo programado a las 17:59:30 solo se vería a las 18:00:00, ya fuera de horario, y se iría al día siguiente. Con
 * este margen nada se programa tan al límite.
 */
export const MARGEN_FINAL_MS = 4 * 60_000
/** Cuánto pesan los tramos en los que el dueño del buzón llama (y manda a mano) respecto a los demás */
const PESO_EN_HORAS_DE_LLAMADAS = 0.6
/** A las 14:00 acaba «la mañana» a efectos del reparto */
const FIN_DE_LA_MANANA_MIN = 840

/* ------------------------------------------------------------------ */
/* El azar con semilla                                                 */
/* ------------------------------------------------------------------ */

function hashDeTexto(texto: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: un generador pequeño y repetible */
function generador(semilla: number): () => number {
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------------------------------------------ */
/* Listas ordenadas de instantes                                       */
/* ------------------------------------------------------------------ */

/** Primer índice con un valor >= x */
function cotaInferior(lista: readonly number[], x: number): number {
  let lo = 0
  let hi = lista.length
  while (lo < hi) {
    const m = (lo + hi) >>> 1
    if (lista[m] < x) lo = m + 1
    else hi = m
  }
  return lo
}

function insertar(lista: number[], x: number): void {
  lista.splice(cotaInferior(lista, x), 0, x)
}

/** ¿Hay en la lista algún valor a menos de `hueco` ms de `x`? */
function hayCerca(lista: readonly number[], x: number, hueco: number): boolean {
  const i = cotaInferior(lista, x - hueco + 1)
  return i < lista.length && lista[i] < x + hueco
}

/* ------------------------------------------------------------------ */
/* El planificador                                                     */
/* ------------------------------------------------------------------ */

interface Estado {
  global: number[]
  porBuzon: Map<string, number[]>
  porEmpresa: Map<string, number[]>
  capacidad: Map<string, number>
}

function lista(mapa: Map<string, number[]>, clave: string): number[] {
  let l = mapa.get(clave)
  if (!l) {
    l = []
    mapa.set(clave, l)
  }
  return l
}

export function planificar(entrada: EntradaDelPlanificador): ResultadoDelPlan {
  const { ajustes, ahora } = entrada
  const festivos = new Set(ajustes.festivos)
  const horizonte = entrada.horizonteDias ?? 30
  const huecoGlobal = ajustes.huecoGlobalS * 1000
  const huecoBuzon = ajustes.huecoBuzonS * 1000
  const hoy = diaDeMadrid(ahora)

  const estado: Estado = { global: [], porBuzon: new Map(), porEmpresa: new Map(), capacidad: new Map() }
  for (const o of entrada.ocupados) {
    estado.global.push(o.en)
    lista(estado.porBuzon, o.buzonId).push(o.en)
    if (!esDominioLibre(o.dominio)) lista(estado.porEmpresa, o.dominio).push(o.en)
  }
  estado.global.sort((a, b) => a - b)
  for (const l of estado.porBuzon.values()) l.sort((a, b) => a - b)
  for (const l of estado.porEmpresa.values()) l.sort((a, b) => a - b)

  const capacidadDe = (buzonId: string, dia: string): number => {
    const clave = `${buzonId}|${dia}`
    let c = estado.capacidad.get(clave)
    if (c === undefined) {
      c = Math.max(0, Math.floor(entrada.capacidad(buzonId, dia)))
      estado.capacidad.set(clave, c)
    }
    return c
  }

  // Primero lo que antes puede salir; a igualdad, por id (para que el resultado no dependa del orden en que lleguen)
  const pasos = [...entrada.pasos].sort((a, b) => (a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const asignaciones: Asignacion[] = []
  const sinHueco: string[] = []

  for (const paso of pasos) {
    const horario = entrada.buzones.get(paso.buzonId)
    const azar = generador(hashDeTexto(`${paso.id}|${entrada.semilla ?? 0}`))
    const empresa = esDominioLibre(paso.dominio) ? null : paso.dominio

    let dia = diaHabilDesde(paso.desde > hoy ? paso.desde : hoy, festivos)
    let asignado = false
    for (let i = 0; i < horizonte && !asignado; i++, dia = siguienteDiaHabil(dia, festivos)) {
      if (capacidadDe(paso.buzonId, dia) <= 0) continue

      let desdeMin = ajustes.ventanaDesdeMin
      if (dia === hoy) {
        const p = partesDeMadrid(ahora + MARGEN_DE_HOY_MS)
        desdeMin = Math.max(desdeMin, p.minutos + (p.segundo > 0 ? 1 : 0))
      }
      if (desdeMin >= ajustes.ventanaHastaMin - MARGEN_FINAL_MS / 60_000) continue

      const inicioMs = Math.max(instanteDeMadrid(dia, ajustes.ventanaDesdeMin), dia === hoy ? ahora + MARGEN_DE_HOY_MS : 0)
      const finMs = instanteDeMadrid(dia, ajustes.ventanaHastaMin) - MARGEN_FINAL_MS
      const libre = (x: number): boolean =>
        x >= inicioMs &&
        x < finMs &&
        !hayCerca(estado.global, x, huecoGlobal) &&
        !hayCerca(lista(estado.porBuzon, paso.buzonId), x, huecoBuzon) &&
        (empresa === null || !hayCerca(lista(estado.porEmpresa, empresa), x, HUECO_POR_EMPRESA_MS))

      const instante = elegirInstante({ dia, desdeMin, ajustes, horario, azar, libre, inicioMs, finMs })
      if (instante === null) continue

      insertar(estado.global, instante)
      insertar(lista(estado.porBuzon, paso.buzonId), instante)
      if (empresa !== null) insertar(lista(estado.porEmpresa, empresa), instante)
      estado.capacidad.set(`${paso.buzonId}|${dia}`, capacidadDe(paso.buzonId, dia) - 1)
      asignaciones.push({ pasoId: paso.id, programadoAt: instante, dia })
      asignado = true
    }
    if (!asignado) sinHueco.push(paso.id)
  }

  return { asignaciones, sinHueco }
}

interface ParaElegir {
  dia: string
  desdeMin: number
  ajustes: EntradaDelPlanificador['ajustes']
  horario: HorarioDelBuzon | undefined
  azar: () => number
  libre: (instante: number) => boolean
  inicioMs: number
  finMs: number
}

/** Elige un instante libre del día con los tramos de 5 minutos pesados; si por azar no lo encuentra, barre el día desde un punto al azar */
function elegirInstante(p: ParaElegir): number | null {
  const tramos: Array<{ inicioMin: number; peso: number }> = []
  const primero = Math.floor(p.desdeMin / TRAMO_MIN) * TRAMO_MIN
  for (let m = primero; m < p.ajustes.ventanaHastaMin; m += TRAMO_MIN) tramos.push({ inicioMin: m, peso: 1 })

  const antesDeLas14 = tramos.filter((t) => t.inicioMin < FIN_DE_LA_MANANA_MIN).length
  const despues = tramos.length - antesDeLas14
  const mañana = p.ajustes.pesoMananaPct / 100
  // Si solo queda un lado del día (hoy por la tarde), se reparte sin más
  const pesoMañana = antesDeLas14 > 0 && despues > 0 ? mañana / antesDeLas14 : 1 / Math.max(tramos.length, 1)
  const pesoTarde = antesDeLas14 > 0 && despues > 0 ? (1 - mañana) / despues : 1 / Math.max(tramos.length, 1)
  for (const t of tramos) {
    t.peso = t.inicioMin < FIN_DE_LA_MANANA_MIN ? pesoMañana : pesoTarde
    if (p.horario && t.inicioMin >= p.horario.llamadasDesdeMin && t.inicioMin < p.horario.llamadasHastaMin) t.peso *= PESO_EN_HORAS_DE_LLAMADAS
  }
  const total = tramos.reduce((s, t) => s + t.peso, 0)
  if (tramos.length === 0 || total <= 0) return null

  // 1. Al azar, con los pesos
  for (let intento = 0; intento < 60; intento++) {
    let r = p.azar() * total
    let tramo = tramos[tramos.length - 1]
    for (const t of tramos) {
      r -= t.peso
      if (r < 0) {
        tramo = t
        break
      }
    }
    const instante = instanteDeMadrid(p.dia, tramo.inicioMin) + Math.floor(p.azar() * TRAMO_MIN * 60) * 1000
    if (p.libre(instante)) return instante
  }

  // 2. Barrido del día entero de 5 en 5 segundos, empezando en un punto al azar y dando la vuelta
  const paso = 5000
  const celdas = Math.max(1, Math.floor((p.finMs - p.inicioMs) / paso))
  const arranque = Math.floor(p.azar() * celdas)
  for (let k = 0; k < celdas; k++) {
    const instante = p.inicioMs + ((arranque + k) % celdas) * paso
    if (p.libre(instante)) return instante
  }
  return null
}
