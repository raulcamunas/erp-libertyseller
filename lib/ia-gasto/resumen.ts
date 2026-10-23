/**
 * EL GASTO EN IA, CONTADO A PARTIR DE LO QUE DICE OPENAI.
 * =======================================================
 * PURO: no toca la red ni la base. Se comprueba con resumen.prueba.ts.
 *
 * Los datos vienen de `GET /v1/organization/costs` de OpenAI (lib/ia-gasto/openai.ts): un «cubo» por día (en UTC) con una fila por concepto
 * —un modelo y si es entrada, salida o caché, p. ej. «gpt-6-luna, input»— y por proyecto. Es la cifra de la factura, no una estimación del ERP.
 *
 * LO QUE ESTO NO SABE: qué función del ERP gastó cada céntimo. OpenAI solo dice el MODELO, y varias funciones comparten modelo (gpt-6-luna lo usan
 * las llamadas de Rinkel, el auditor, el listing builder, tres pantallas de marketing, el tracker, el validador y las citas; hasta el 23 oct 2026 los dos últimos grupos eran gpt-4o). Por eso el desglose es por modelo, con una pista de
 * para qué se usa habitualmente (`USO_HABITUAL`), y no por función. Para saber la función exacta haría falta que el propio ERP apuntara cada llamada.
 *
 * LOS DÍAS Y LOS MESES SON LOS DE UTC, que es como los corta OpenAI: el cubo de «hoy» llega a medias (se va rellenando) y el último mes se
 * parte con una diferencia de dos horas respecto a la hora de Madrid. Para un contador de gasto no importa; sí hay que decirlo.
 */

export interface FilaDeCoste {
  /** El día, «2026-10-23», en UTC */
  dia: string
  /** «gpt-6-luna, input». null si OpenAI no desglosó por concepto */
  concepto: string | null
  /** «proj_…», o null si no desglosó por proyecto */
  proyecto: string | null
  /** «key_…»: la clave de API que hizo el gasto, o null si no desglosó por clave (o ya no existe) */
  clave: string | null
  /** Dólares. Una devolución o un ajuste pueden salir en negativo */
  dolares: number
}

export interface PaginaDeCostes {
  filas: FilaDeCoste[]
  hayMas: boolean
  siguiente: string | null
}

const DIA_S = 86_400

const texto = (x: unknown): string | null => (typeof x === 'string' && x.trim() !== '' ? x.trim() : null)
const numero = (x: unknown): number | null => {
  const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN
  return Number.isFinite(n) ? n : null
}

/** «2026-10-23» (UTC) de un instante en segundos UNIX */
export function diaUtc(segundos: number): string {
  return new Date(segundos * 1000).toISOString().slice(0, 10)
}

/**
 * Una página de la respuesta de OpenAI -> filas. Devuelve null si lo que llega no tiene la forma esperada (sin `data`, que no sea una lista…):
 * es mejor decir «OpenAI ha contestado algo que no entiendo» que enseñar un cero que parezca gasto cero.
 *
 * Es tolerante con lo que sí se puede leer: el importe puede venir como número o como texto, y un cubo o una fila rotos se saltan sin tumbar el resto.
 * Una moneda que no sea dólares se salta (no se mezclan monedas en una suma).
 */
export function normalizarCostes(cuerpo: unknown): PaginaDeCostes | null {
  if (!cuerpo || typeof cuerpo !== 'object') return null
  const o = cuerpo as Record<string, unknown>
  if (!Array.isArray(o.data)) return null

  const filas: FilaDeCoste[] = []
  for (const cubo of o.data) {
    if (!cubo || typeof cubo !== 'object') continue
    const c = cubo as Record<string, unknown>
    const inicio = numero(c.start_time)
    if (inicio === null || !Array.isArray(c.results)) continue
    const dia = diaUtc(inicio)
    for (const r of c.results) {
      if (!r || typeof r !== 'object') continue
      const f = r as Record<string, unknown>
      const importe = f.amount && typeof f.amount === 'object' ? (f.amount as Record<string, unknown>) : null
      const valor = numero(importe?.value)
      if (valor === null) continue
      const moneda = texto(importe?.currency)
      if (moneda && moneda.toLowerCase() !== 'usd') continue
      filas.push({ dia, concepto: texto(f.line_item), proyecto: texto(f.project_id), clave: texto(f.api_key_id), dolares: valor })
    }
  }
  return { filas, hayMas: o.has_more === true, siguiente: texto(o.next_page) }
}

/* ------------------------------------------------------------------ */
/* Qué es cada concepto                                                */
/* ------------------------------------------------------------------ */

export type TipoDeConcepto = 'entrada' | 'salida' | 'cache' | 'audio' | 'otro'

/** «gpt-6-luna-2026-08-01, input» -> { modelo: 'gpt-6-luna-2026-08-01', tipo: 'entrada' } */
export function separarConcepto(concepto: string | null): { modelo: string; tipo: TipoDeConcepto } {
  const limpio = (concepto ?? '').trim()
  if (!limpio) return { modelo: 'Sin desglosar', tipo: 'otro' }
  const coma = limpio.lastIndexOf(',')
  const modelo = (coma === -1 ? limpio : limpio.slice(0, coma)).trim() || 'Sin desglosar'
  const cola = (coma === -1 ? '' : limpio.slice(coma + 1)).trim().toLowerCase()
  let tipo: TipoDeConcepto = 'otro'
  if (/cached/.test(cola)) tipo = 'cache'
  else if (/audio/.test(cola)) tipo = 'audio'
  else if (/input|prompt/.test(cola)) tipo = 'entrada'
  else if (/output|completion/.test(cola)) tipo = 'salida'
  return { modelo, tipo }
}

/** La familia del modelo sin la fecha de la versión: «gpt-4o-2024-08-06» -> «gpt-4o», «gpt-5.6-terra-2026-03-01» -> «gpt-5.6-terra» */
export function familiaDeModelo(modelo: string): string {
  // Algunos conceptos de audio llevan una palabra pegada al modelo sin coma: «gpt-4o-mini-transcribe-2025-12-15 audio»
  return modelo.replace(/\s+(audio|text)$/i, '').replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-\d{4}$/, '')
}

/**
 * Para qué se usa HABITUALMENTE cada modelo en este ERP. Es una pista y no una cuenta: gpt-6-luna lo comparten varias pantallas (y, hasta el 23 oct 2026, gpt-4o y gpt-4o-mini), y el
 * modelo del correo con IA y el de las remesas se pueden cambiar en el servidor (CORREO_IA_MODELO, FBA_IA_MODELO) o por versión en «Configuración de
 * correos». El orden importa: la primera que encaja gana.
 */
export const USO_HABITUAL: ReadonlyArray<{ patron: RegExp; uso: string }> = [
  { patron: /^gpt-transcribe/, uso: 'Transcripción de las llamadas de Rinkel' },
  { patron: /^gpt-6-luna/, uso: 'Llamadas de Rinkel, citas, auditor, listing, marketing, tracker y validador' },
  { patron: /^whisper/, uso: 'Transcripción de las citas' },
  { patron: /^gpt-4o-(mini-)?transcribe/, uso: 'Transcripción de audio' },
  { patron: /^gpt-5\.6-terra/, uso: 'Correo con IA' },
  { patron: /^gpt-5\.5/, uso: 'Remesas: propuesta con IA' },
  { patron: /^gpt-(5\.6-(sol|luna)|6-sol)/, uso: 'Correo con IA (versiones del laboratorio)' },
  { patron: /^gpt-4o-mini/, uso: 'Resumen de citas y marketing' },
  { patron: /^gpt-4o/, uso: 'Auditor, listing, marketing, tracker y validador' },
]

export function usoHabitual(modelo: string): string {
  return USO_HABITUAL.find((u) => u.patron.test(familiaDeModelo(modelo)))?.uso ?? 'Otros usos'
}

/* ------------------------------------------------------------------ */
/* Las claves de API                                                   */
/* ------------------------------------------------------------------ */

/** Una clave de API de la cuenta de OpenAI, tal como la lista OpenAI (el valor de la clave NUNCA llega: solo cómo termina) */
export interface ClaveDeApi {
  id: string
  nombre: string
  /** Los cuatro últimos caracteres, que es lo único que enseña OpenAI de una clave */
  terminaEn: string | null
  proyecto: string | null
}

/**
 * ¿Cuál de las claves de la cuenta es la del ERP? La cuenta de OpenAI se comparte con otras cosas (n8n, la web…), así que para decir «lo que gasta el ERP» hay que
 * separar su clave. Se busca por cómo termina la `OPENAI_API_KEY` del servidor y, si eso no da una sola, por el nombre («LibertyERP»). Si tampoco hay una sola,
 * null: mejor enseñar el gasto de toda la cuenta y decirlo que atribuir al ERP lo de otro.
 */
export function identificarClaveDelErp(claves: readonly ClaveDeApi[], claveDeLaIa: string | undefined | null): string | null {
  const final = claveDeLaIa && claveDeLaIa.length >= 8 ? claveDeLaIa.slice(-4) : null
  const porFinal = final ? claves.filter((c) => c.terminaEn === final) : []
  if (porFinal.length === 1) return porFinal[0].id
  const candidatas = porFinal.length > 1 ? porFinal : claves
  const porNombre = candidatas.filter((c) => /erp/i.test(c.nombre))
  return porNombre.length === 1 ? porNombre[0].id : null
}

/* ------------------------------------------------------------------ */
/* El resumen                                                          */
/* ------------------------------------------------------------------ */

export interface GastoDeUnModelo {
  /** La familia: «gpt-4o», sin la fecha de la versión */
  modelo: string
  uso: string
  dolares: number
  /** De 0 a 1 respecto al total del periodo */
  parte: number
}

export interface GastoDeUnProyecto {
  id: string
  nombre: string | null
  dolares: number
}

export interface GastoDeUnaClave {
  /** null = gasto que OpenAI no atribuye a ninguna clave */
  id: string | null
  /** «LibertyERP», «n8n»… , o «Clave borrada» si ya no existe */
  nombre: string
  esteMes: number
  /** Lo leído (hasta 12 meses) */
  total: number
  esErp: boolean
}

export interface TotalesDeGasto {
  esteMes: number
  mesAnterior: number
  ultimos30: number
  total: number
}

export interface ResumenDeGasto {
  /** De quién son las cifras de arriba: de la clave del ERP o, si no se ha podido separar, de toda la cuenta de OpenAI */
  alcance: { tipo: 'erp' | 'cuenta'; nombre: string }
  /** El último día con datos que se ha leído, o null si OpenAI no ha devuelto ninguno */
  ultimoDia: string | null
  /** El primer día con gasto de lo leído (los últimos 12 meses como mucho) */
  primerDia: string | null
  hoy: number
  ayer: number
  esteMes: number
  mesAnterior: number
  ultimos30: number
  /** Todo lo leído: hasta 12 meses */
  total: number
  /** Lo que se gasta de media al día en lo que va de mes (sin contar hoy, que va a medias) */
  mediaDiaria: number | null
  /** Lo gastado hasta hoy más el ritmo medio de los días que quedan: cuánto se llevaría el mes entero. null los primeros días, que no dan para una media */
  previsionDelMes: number | null
  /** Los últimos 30 días, de más antiguo a más reciente, con los ceros incluidos */
  dias: Array<{ dia: string; dolares: number }>
  /** Los últimos 12 meses (de más antiguo a más reciente) */
  meses: Array<{ mes: string; dolares: number }>
  /** Este mes por modelo, de más a menos */
  porModelo: GastoDeUnModelo[]
  /** Este mes por proyecto, solo si el gasto está repartido entre más de uno */
  porProyecto: GastoDeUnProyecto[]
  /** TODA la cuenta de OpenAI (todas las claves): el contexto de la cifra del ERP */
  cuenta: TotalesDeGasto
  /** Cada clave de la cuenta, de la que más ha gastado a la que menos */
  porClave: GastoDeUnaClave[]
}

export interface OpcionesDelResumen {
  proyectos?: ReadonlyMap<string, string>
  claves?: readonly ClaveDeApi[]
  /** El id de la clave del ERP, si se ha podido identificar (identificarClaveDelErp) */
  claveDelErp?: string | null
}

const redondear = (x: number): number => Math.round(x * 1e6) / 1e6

const sumarDias = (dia: string, n: number): string => new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA_S * 1000).toISOString().slice(0, 10)

/** Los días de ese mes (el mes es «2026-10») */
function diasDelMes(mes: string): number {
  const [a, m] = mes.split('-').map(Number)
  return new Date(Date.UTC(a, m, 0)).getUTCDate()
}

/** Los cortes de tiempo que usan todas las cuentas: hoy, ayer, este mes, el anterior y el primer día de los últimos 30 */
function cortes(ahoraMs: number) {
  const hoy = new Date(ahoraMs).toISOString().slice(0, 10)
  const mesActual = hoy.slice(0, 7)
  return { hoy, ayer: sumarDias(hoy, -1), mesActual, mesPrevio: sumarDias(`${mesActual}-01`, -1).slice(0, 7), hace30: sumarDias(hoy, -29) }
}

function totales(filas: readonly FilaDeCoste[], c: ReturnType<typeof cortes>): TotalesDeGasto {
  let esteMes = 0
  let mesAnterior = 0
  let ultimos30 = 0
  let total = 0
  for (const f of filas) {
    total += f.dolares
    const mes = f.dia.slice(0, 7)
    if (mes === c.mesActual) esteMes += f.dolares
    else if (mes === c.mesPrevio) mesAnterior += f.dolares
    if (f.dia >= c.hace30 && f.dia <= c.hoy) ultimos30 += f.dolares
  }
  return { esteMes: redondear(esteMes), mesAnterior: redondear(mesAnterior), ultimos30: redondear(ultimos30), total: redondear(total) }
}

export function resumirGasto(filas: readonly FilaDeCoste[], ahoraMs: number, opciones: OpcionesDelResumen = {}): ResumenDeGasto {
  const c = cortes(ahoraMs)
  const { hoy, ayer, mesActual, hace30 } = c
  const nombresDeProyecto = opciones.proyectos ?? new Map<string, string>()
  const claves = new Map((opciones.claves ?? []).map((k) => [k.id, k]))

  // Si OpenAI no atribuyó ninguna fila a una clave, no hay forma de separar nada: las cifras son las de toda la cuenta
  const hayClaves = filas.some((f) => f.clave !== null)
  const claveDelErp = hayClaves && opciones.claveDelErp ? opciones.claveDelErp : null
  const foco = claveDelErp ? filas.filter((f) => f.clave === claveDelErp) : filas
  const alcance: ResumenDeGasto['alcance'] = claveDelErp ? { tipo: 'erp', nombre: claves.get(claveDelErp)?.nombre ?? 'ERP' } : { tipo: 'cuenta', nombre: 'Toda la cuenta de OpenAI' }

  const porDia = new Map<string, number>()
  const porMes = new Map<string, number>()
  const modelosDelMes = new Map<string, number>()
  const proyectosDelMes = new Map<string, number>()
  let primerDia: string | null = null
  let ultimoDia: string | null = null

  for (const f of foco) {
    porDia.set(f.dia, (porDia.get(f.dia) ?? 0) + f.dolares)
    porMes.set(f.dia.slice(0, 7), (porMes.get(f.dia.slice(0, 7)) ?? 0) + f.dolares)
    if (primerDia === null || f.dia < primerDia) primerDia = f.dia
    if (ultimoDia === null || f.dia > ultimoDia) ultimoDia = f.dia
    if (f.dia.slice(0, 7) === mesActual) {
      const familia = familiaDeModelo(separarConcepto(f.concepto).modelo)
      modelosDelMes.set(familia, (modelosDelMes.get(familia) ?? 0) + f.dolares)
      if (f.proyecto) proyectosDelMes.set(f.proyecto, (proyectosDelMes.get(f.proyecto) ?? 0) + f.dolares)
    }
  }

  const dias = Array.from({ length: 30 }, (_, i) => {
    const dia = sumarDias(hace30, i)
    return { dia, dolares: redondear(porDia.get(dia) ?? 0) }
  })

  // Los últimos 12 meses, aunque alguno no tenga gasto
  const meses: ResumenDeGasto['meses'] = []
  for (let i = 11; i >= 0; i--) {
    const [a, m] = mesActual.split('-').map(Number)
    const mes = new Date(Date.UTC(a, m - 1 - i, 1)).toISOString().slice(0, 7)
    meses.push({ mes, dolares: redondear(porMes.get(mes) ?? 0) })
  }

  const t = totales(foco, c)
  // La media y la previsión cuentan los días COMPLETOS del mes (el de hoy va a medias); con menos de tres no se da: sale una cifra que engaña
  const diaDelMes = Number(hoy.slice(8))
  const completos = diaDelMes - 1
  const gastoCompleto = t.esteMes - (porDia.get(hoy) ?? 0)
  const mediaDiaria = completos >= 3 ? redondear(gastoCompleto / completos) : null
  // Lo que ya se ha gastado (hoy incluido) más el ritmo medio de los días que quedan: así nunca sale menos de lo que ya hay
  const previsionDelMes = mediaDiaria === null ? null : redondear(t.esteMes + mediaDiaria * (diasDelMes(mesActual) - diaDelMes))

  const totalModelos = [...modelosDelMes.values()].reduce((s, v) => s + Math.max(v, 0), 0)
  const porModelo: GastoDeUnModelo[] = [...modelosDelMes.entries()]
    .map(([modelo, dolares]) => ({ modelo, uso: usoHabitual(modelo), dolares: redondear(dolares), parte: totalModelos > 0 ? Math.max(dolares, 0) / totalModelos : 0 }))
    .filter((m) => Math.abs(m.dolares) >= 0.000001)
    .sort((a, b) => b.dolares - a.dolares)

  const porProyecto: GastoDeUnProyecto[] =
    proyectosDelMes.size > 1
      ? [...proyectosDelMes.entries()].map(([id, dolares]) => ({ id, nombre: nombresDeProyecto.get(id) ?? null, dolares: redondear(dolares) })).sort((a, b) => b.dolares - a.dolares)
      : []

  // Cada clave de la cuenta, con TODO lo leído (no solo el foco): es lo que dice dónde está el resto del gasto
  const porIdDeClave = new Map<string | null, { esteMes: number; total: number }>()
  for (const f of filas) {
    const g = porIdDeClave.get(f.clave) ?? { esteMes: 0, total: 0 }
    g.total += f.dolares
    if (f.dia.slice(0, 7) === mesActual) g.esteMes += f.dolares
    porIdDeClave.set(f.clave, g)
  }
  const porClave: GastoDeUnaClave[] = [...porIdDeClave.entries()]
    .map(([id, g]) => ({
      id,
      nombre: id === null ? 'Sin clave' : (claves.get(id)?.nombre ?? 'Clave borrada'),
      esteMes: redondear(g.esteMes),
      total: redondear(g.total),
      esErp: id !== null && id === claveDelErp,
    }))
    .filter((k) => Math.abs(k.total) >= 0.000001)
    .sort((a, b) => b.total - a.total)

  return {
    alcance,
    ultimoDia,
    primerDia,
    hoy: redondear(porDia.get(hoy) ?? 0),
    ayer: redondear(porDia.get(ayer) ?? 0),
    esteMes: t.esteMes,
    mesAnterior: t.mesAnterior,
    ultimos30: t.ultimos30,
    total: t.total,
    mediaDiaria,
    previsionDelMes,
    dias,
    meses,
    porModelo,
    porProyecto,
    cuenta: totales(filas, c),
    porClave,
  }
}

/* ------------------------------------------------------------------ */
/* Cómo se escribe el dinero                                           */
/* ------------------------------------------------------------------ */

/** «12,34 $», «0,042 $», «0,0004 $»: más decimales cuanto más pequeño, para no decir «0,00 $» de algo que sí cuesta */
export function enDolares(cantidad: number): string {
  const n = Math.abs(cantidad)
  const decimales = n >= 1 ? 2 : n >= 0.1 ? 2 : n >= 0.01 ? 3 : n === 0 ? 2 : 4
  const t = n.toLocaleString('es-ES', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })
  return `${cantidad < 0 ? '−' : ''}${t} $`
}
