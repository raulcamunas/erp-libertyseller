import { diaDeMadrid, esDiaHabil, sumarDias } from './fechas'
import { topeDelBuzonEnElDia, type TramoDeRampa } from './reglas'

/**
 * CUÁNTOS CORREOS CABEN TODAVÍA EN UN DÍA DE UN BUZÓN.
 * ====================================================
 * PURO: no toca la base ni la red. Se comprueba con capacidad.prueba.ts.
 *
 * El tope de un buzón (la rampa de volumen) cuenta TODO lo que sale de él en un día: lo que la persona escribe a mano y lo que mandan las
 * secuencias. Para repartir los seguimientos entre los días que vienen hay que saber cuánto cabe de los segundos DESPUÉS de lo primero:
 *
 *     lo que cabe = tope − lo que la persona manda a mano − lo que ya ha salido de secuencias − lo que ya está programado
 *
 * Lo de «a mano» de un día futuro no se sabe: se estima con lo que ese buzón ha mandado a mano en sus últimos días hábiles (el más alto entre
 * la media y el último, para no quedarse corto cuando la persona va a más). Hoy se usa lo que ya ha mandado si supera a la estimación. La
 * persona manda a mano lo que quiere: los automáticos se ajustan a ella y nunca al revés.
 */

/** Lo que devuelve `correo_secuencia_salientes_por_hora` (migración 245): una fila por buzón, día y hora de Madrid */
export interface SalientesPorHora {
  buzonId: string
  dia: string
  hora: number
  total: number
  /** Cuántos de ellos salieron de una secuencia */
  automaticos: number
}

export interface DatosDeCapacidad {
  tope: number
  manualHecho: number
  manualEsperado: number
  automaticosHechos: number
  automaticosProgramados: number
}

/** Cuántos correos MÁS caben (nunca negativo) */
export function capacidadDelDia(d: DatosDeCapacidad): number {
  const reservaDeLaPersona = Math.max(d.manualHecho, d.manualEsperado)
  return Math.max(0, d.tope - reservaDeLaPersona - d.automaticosHechos - d.automaticosProgramados)
}

/** Cuántos días hábiles hacia atrás se mira para estimar lo que manda a mano un buzón */
export const DIAS_PARA_ESTIMAR = 5

/**
 * Lo que un buzón suele mandar a mano un día hábil: el más alto entre la media de sus últimos `DIAS_PARA_ESTIMAR` días hábiles (sin contar hoy) y
 * el último de ellos. Sin historial, cero. Los días sin ningún envío cuentan como cero SI son hábiles (un buzón parado no reserva sitio).
 */
export function manualEsperado(manualPorDia: ReadonlyMap<string, number>, hoy: string, festivos: readonly string[]): number {
  const valores: number[] = []
  let dia = hoy
  for (let i = 0; i < 40 && valores.length < DIAS_PARA_ESTIMAR; i++) {
    dia = sumarDias(dia, -1)
    if (esDiaHabil(dia, festivos)) valores.push(manualPorDia.get(dia) ?? 0)
  }
  if (valores.length === 0) return 0
  const media = valores.reduce((s, v) => s + v, 0) / valores.length
  // valores[0] es el último día hábil anterior a hoy
  return Math.ceil(Math.max(media, valores[0]))
}

export interface DatosDelBuzonParaCapacidad {
  rampaInicio: string | null
  topeFijo: number | null
}

export interface EntradaDeCapacidad {
  buzones: ReadonlyMap<string, DatosDelBuzonParaCapacidad>
  rampa: readonly TramoDeRampa[]
  festivos: readonly string[]
  salientes: readonly SalientesPorHora[]
  /** Los pasos pendientes que ya tienen hora: cuenta cada uno en el día de su hora */
  programados: ReadonlyArray<{ buzonId: string; en: number }>
  ahora: number
}

/** Construye la función `capacidad(buzonId, dia)` que usa el planificador */
export function constructorDeCapacidad(e: EntradaDeCapacidad): (buzonId: string, dia: string) => number {
  const hoy = diaDeMadrid(e.ahora)

  const manual = new Map<string, Map<string, number>>()
  const automaticos = new Map<string, Map<string, number>>()
  const sumar = (mapa: Map<string, Map<string, number>>, buzonId: string, dia: string, n: number) => {
    let porDia = mapa.get(buzonId)
    if (!porDia) mapa.set(buzonId, (porDia = new Map()))
    porDia.set(dia, (porDia.get(dia) ?? 0) + n)
  }
  for (const s of e.salientes) {
    sumar(manual, s.buzonId, s.dia, Math.max(0, s.total - s.automaticos))
    sumar(automaticos, s.buzonId, s.dia, s.automaticos)
  }
  const programados = new Map<string, Map<string, number>>()
  for (const p of e.programados) sumar(programados, p.buzonId, diaDeMadrid(p.en), 1)

  const esperados = new Map<string, number>()
  const esperadoDe = (buzonId: string): number => {
    let v = esperados.get(buzonId)
    if (v === undefined) {
      v = manualEsperado(manual.get(buzonId) ?? new Map(), hoy, e.festivos)
      esperados.set(buzonId, v)
    }
    return v
  }

  return (buzonId, dia) => {
    const datos = e.buzones.get(buzonId)
    // Un buzón que no se conoce no recibe nada
    if (!datos) return 0
    return capacidadDelDia({
      tope: topeDelBuzonEnElDia({ rampa: e.rampa, rampaInicio: datos.rampaInicio, topeFijo: datos.topeFijo, dia, festivos: e.festivos }),
      manualHecho: dia <= hoy ? (manual.get(buzonId)?.get(dia) ?? 0) : 0,
      manualEsperado: dia >= hoy ? esperadoDe(buzonId) : 0,
      automaticosHechos: automaticos.get(buzonId)?.get(dia) ?? 0,
      automaticosProgramados: programados.get(buzonId)?.get(dia) ?? 0,
    })
  }
}
