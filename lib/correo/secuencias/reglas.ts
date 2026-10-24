import { diasHabilesEntre, esDia } from './fechas'

/**
 * LOS AJUSTES DEL MOTOR DE SECUENCIAS Y LAS PEQUEÑAS REGLAS QUE TODO LO DEMÁS USA.
 * ================================================================================
 * PURO: no toca la base ni la red. Se comprueba con reglas.prueba.ts.
 *
 * Los ajustes viven en una sola fila de la base (migración 245, `correo_secuencia_ajustes`). Aquí se leen SIN CONFIAR EN ELLA: un campo que
 * falta o que no tiene sentido se sustituye por el valor de siempre en vez de romper el motor, porque lo que se lee aquí decide cuántos
 * correos salen y a qué horas.
 */

export interface TramoDeRampa {
  /** A partir de qué día hábil de funcionamiento del buzón vale este tope (el primero es el 1) */
  desde: number
  /** Cuántos correos como máximo al día, contando los que escribe la persona a mano y los automáticos */
  tope: number
}

export interface AjustesDelMotor {
  activa: boolean
  modoEnsayo: boolean
  /** Minutos desde la medianoche, hora de Madrid */
  ventanaDesdeMin: number
  ventanaHastaMin: number
  huecoGlobalS: number
  huecoBuzonS: number
  pesoMananaPct: number
  rampa: TramoDeRampa[]
  topeHora: number
  diasHastaNoInteresa: number
  frenoRebotesPct: number
  frenoMinimoEnvios: number
  festivos: string[]
  /** Leer con IA las respuestas de los leads (con el motor en ensayo solo las apunta; en envío real también actúa en la ficha) */
  respuestasIa: boolean
  /** Pasar el lead a «No le interesa» cuando dice que no */
  respuestasCerrarNo: boolean
  /** Poner la rellamada cuando pide que le escribamos más adelante */
  respuestasRellamada: boolean
  /** La migración 246 está lanzada (existen las columnas de arriba). Solo se lee: no se guarda ni se cambia desde la pantalla */
  respuestasDisponible: boolean
}

export const RAMPA_POR_DEFECTO: TramoDeRampa[] = [
  { desde: 1, tope: 40 },
  { desde: 4, tope: 70 },
  { desde: 8, tope: 100 },
  { desde: 15, tope: 150 },
]

export const AJUSTES_POR_DEFECTO: AjustesDelMotor = {
  activa: false,
  modoEnsayo: true,
  ventanaDesdeMin: 540,
  ventanaHastaMin: 1080,
  huecoGlobalS: 45,
  huecoBuzonS: 180,
  pesoMananaPct: 60,
  rampa: RAMPA_POR_DEFECTO,
  topeHora: 25,
  diasHastaNoInteresa: 7,
  frenoRebotesPct: 4,
  frenoMinimoEnvios: 20,
  festivos: ['2026-12-08', '2026-12-25', '2027-01-01', '2027-01-06', '2027-03-26', '2027-10-12', '2027-11-01', '2027-12-06', '2027-12-08'],
  respuestasIa: true,
  respuestasCerrarNo: true,
  respuestasRellamada: true,
  respuestasDisponible: false,
}

/** Cuántos días hábiles dura una secuencia por defecto: el primer correo y los seguimientos a los 3 y a los 7 */
export const PASOS_POR_DEFECTO: ReadonlyArray<{ orden: number; dias: number }> = [
  { orden: 1, dias: 3 },
  { orden: 2, dias: 7 },
]

const entero = (v: unknown, minimo: number, maximo: number, defecto: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN
  return Number.isFinite(n) && Number.isInteger(n) && n >= minimo && n <= maximo ? n : defecto
}

/** Lee una rampa venida de la base. Una rampa rota se sustituye entera por la de siempre */
export function leerRampa(valor: unknown): TramoDeRampa[] {
  if (!Array.isArray(valor) || valor.length === 0 || valor.length > 12) return RAMPA_POR_DEFECTO
  const tramos: TramoDeRampa[] = []
  for (const t of valor) {
    const o = t as { desde?: unknown; tope?: unknown } | null
    const desde = entero(o?.desde, 1, 3650, -1)
    const tope = entero(o?.tope, 1, 1000, -1)
    if (desde < 0 || tope < 0) return RAMPA_POR_DEFECTO
    tramos.push({ desde, tope })
  }
  tramos.sort((a, b) => a.desde - b.desde)
  // Tiene que empezar en el día 1: si no, los primeros días no tendrían tope
  if (tramos[0].desde !== 1) tramos.unshift({ desde: 1, tope: tramos[0].tope })
  return tramos
}

/** Lee los pasos (días hábiles de cada seguimiento) de la definición de una secuencia */
export function leerPasos(valor: unknown): Array<{ orden: number; dias: number }> {
  if (!Array.isArray(valor) || valor.length === 0 || valor.length > 4) return PASOS_POR_DEFECTO.map((p) => ({ ...p }))
  const pasos: Array<{ orden: number; dias: number }> = []
  let anterior = 0
  for (const p of valor) {
    const o = p as { orden?: unknown; dias?: unknown } | null
    const orden = entero(o?.orden, 1, 4, -1)
    const dias = entero(o?.dias, 1, 60, -1)
    // Cada seguimiento sale DESPUÉS del anterior
    if (orden < 0 || dias < 0 || dias <= anterior) return PASOS_POR_DEFECTO.map((x) => ({ ...x }))
    anterior = dias
    pasos.push({ orden: pasos.length + 1, dias })
  }
  return pasos
}

/** Lee la fila de ajustes de la base. Con `null` (la tabla no existe todavía) salen los de siempre, apagados y en ensayo */
export function leerAjustes(fila: Record<string, unknown> | null | undefined): AjustesDelMotor {
  const d = AJUSTES_POR_DEFECTO
  if (!fila) return { ...d, rampa: d.rampa.map((t) => ({ ...t })), festivos: [...d.festivos] }
  const desde = entero(fila.ventana_desde_min, 0, 1439, d.ventanaDesdeMin)
  let hasta = entero(fila.ventana_hasta_min, 1, 1440, d.ventanaHastaMin)
  const [desdeBuena, hastaBueno] = hasta > desde ? [desde, hasta] : [d.ventanaDesdeMin, d.ventanaHastaMin]
  hasta = hastaBueno
  const festivos = Array.isArray(fila.festivos) ? (fila.festivos as unknown[]).filter(esDia) : d.festivos
  return {
    // Solo un `true` de verdad enciende: cualquier otra cosa (null, texto…) es apagado. Y el ensayo es al revés: solo un `false` de verdad lo quita
    activa: fila.activa === true,
    modoEnsayo: fila.modo_ensayo !== false,
    ventanaDesdeMin: desdeBuena,
    ventanaHastaMin: hasta,
    huecoGlobalS: entero(fila.hueco_global_s, 5, 3600, d.huecoGlobalS),
    huecoBuzonS: entero(fila.hueco_buzon_s, 10, 7200, d.huecoBuzonS),
    pesoMananaPct: entero(fila.peso_manana_pct, 0, 100, d.pesoMananaPct),
    rampa: leerRampa(fila.rampa),
    topeHora: entero(fila.tope_hora, 1, 500, d.topeHora),
    diasHastaNoInteresa: entero(fila.dias_hasta_no_interesa, 1, 60, d.diasHastaNoInteresa),
    frenoRebotesPct: entero(fila.freno_rebotes_pct, 1, 100, d.frenoRebotesPct),
    frenoMinimoEnvios: entero(fila.freno_minimo_envios, 5, 1000, d.frenoMinimoEnvios),
    festivos,
    // Estos tres, al revés que el motor: solo un `false` de verdad los apaga (nacen encendidos; el motor, en cambio, nace apagado)
    respuestasIa: fila.respuestas_ia !== false,
    respuestasCerrarNo: fila.respuestas_cerrar_no !== false,
    respuestasRellamada: fila.respuestas_rellamada !== false,
    respuestasDisponible: 'respuestas_ia' in fila,
  }
}

/** El tope de un día de la rampa: el del último tramo que ya ha empezado. `diaHabil` cuenta desde 1 */
export function topeDeLaRampa(rampa: readonly TramoDeRampa[], diaHabil: number): number {
  let tope = rampa[0]?.tope ?? RAMPA_POR_DEFECTO[0].tope
  for (const t of rampa) if (diaHabil >= t.desde) tope = t.tope
  return tope
}

/**
 * Cuántos correos como máximo puede mandar un buzón un día concreto: el tope fijo del buzón si lo tiene, y si no el de la rampa según los días
 * hábiles que lleva funcionando (el día en que empezó es el 1). Un buzón sin fecha de inicio cuenta como si empezara ese mismo día.
 */
export function topeDelBuzonEnElDia(opciones: { rampa: readonly TramoDeRampa[]; rampaInicio: string | null; topeFijo: number | null; dia: string; festivos: readonly string[] }): number {
  if (opciones.topeFijo !== null && opciones.topeFijo > 0) return opciones.topeFijo
  const inicio = opciones.rampaInicio && esDia(opciones.rampaInicio) ? opciones.rampaInicio : opciones.dia
  // Los días hábiles que ya han pasado desde el inicio, contando el de hoy como uno más
  const diaHabil = inicio >= opciones.dia ? 1 : diasHabilesEntre(inicio, opciones.dia, opciones.festivos) + 1
  return topeDeLaRampa(opciones.rampa, diaHabil)
}

/* ------------------------------------------------------------------ */
/* Direcciones y empresas                                              */
/* ------------------------------------------------------------------ */

/** Proveedores de correo que usa cualquiera: un correo de uno de ellos NO dice nada de la empresa de quien lo escribe */
export const DOMINIOS_LIBRES: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.es',
  'outlook.com',
  'outlook.es',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.es',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'gmx.es',
  'aol.com',
  'telefonica.net',
  'terra.es',
  'movistar.es',
  'orange.es',
  'wanadoo.es',
  'ono.com',
  'vodafone.es',
])

export const dominioDeDireccion = (direccion: string): string => (direccion.trim().toLowerCase().split('@')[1] ?? '').trim()

export const esDominioLibre = (dominio: string): boolean => dominio === '' || DOMINIOS_LIBRES.has(dominio.toLowerCase())

/**
 * ¿Un mensaje de `remitente` es de la misma empresa que `destinatario`? Si son la misma dirección, sí. Si los dos son del mismo dominio y NO es un
 * proveedor libre (info@tienda.es y ana@tienda.es), también: contesta la empresa aunque no sea la misma persona. Con un gmail no se puede saber.
 */
export function esDeLaMismaEmpresa(remitente: string, destinatario: string): boolean {
  const a = remitente.trim().toLowerCase()
  const b = destinatario.trim().toLowerCase()
  if (a === '' || b === '') return false
  if (a === b) return true
  const da = dominioDeDireccion(a)
  return da !== '' && da === dominioDeDireccion(b) && !esDominioLibre(da)
}
