/**
 * EL PANEL «INFORMES» DE COLD CALLING (solo administradores): cómo va la recogida de informes, de las filas crudas al JSON que pinta la pantalla.
 *
 * Todo sale de lo que YA hay guardado, sin migración:
 *   · analisis_amazon.creado_en  la hora real de cada informe hecho (histórico completo desde el 13 nov 2026)
 *   · cron_ejecuciones           una fila por pasada del proceso `analisis-keepa`: estado y saldo de Keepa minuto a minuto (se purga a 30 días)
 *   · Storage                    las colas, saltados.json (sin fecha) y bitacora.json (desde el 16 nov: fecha de saltos y fallos, y tokens)
 *   · cold_lead_notes            los envíos por correo (marca «📈 Con su análisis de Amazon:»)
 *
 * El comercial de un informe hecho es el dueño ACTUAL del lead (lo que se ve en Cold Calling); el de lo pendiente, el de la entrada de la cola.
 * Nunca lleva el token del informe: abrir /analisis/<token> sin sesión cuenta como apertura del lead.
 *
 * Lógica pura: pruebas en panel.prueba.ts (`npx tsx lib/analisis-amazon/panel.prueba.ts`).
 */
import type { EnCola, EnColaSinAmazon, EventoDeBitacora } from './almacen'
import { comercialDe, cumplimientoDelTurno, estadoDelTurno, hechosDelTurno, idPorNombre, IDS_DEL_ORDEN, ORDEN_DE_COMERCIALES, RESTO, simularTurnos, type TipoDeCola } from './turnos'

export const SELLER_SIN_AMAZON = 'SINAMAZON'
const HORA = 3_600_000
const DIA = 24 * HORA

/* ------------------------------------------------------------------ */
/* Entrada                                                             */
/* ------------------------------------------------------------------ */

export interface FilaDeInforme {
  id: string
  lead_id: string
  seller_id: string
  version: number | null
  aperturas: number | null
  abierto_ultima_at: string | null
  creado_en: string
  lead: { store_name: string | null; assigned_to: string | null } | null
}

export interface FilaDeCron {
  iniciado_at: string
  terminado_at: string | null
  ok: boolean | null
  resumen: string | null
  error: string | null
  duracion_ms: number | null
}

export interface EntradaDelPanel {
  ahora: number
  informes: readonly FilaDeInforme[]
  envios: ReadonlyArray<{ lead_id: string; occurred_at: string }>
  /** Las pasadas de las últimas 48 h, en cualquier orden */
  cron: readonly FilaDeCron[]
  config: { activo: boolean; cadaMinutos: number } | null
  cola: readonly EnCola[]
  colaSin: readonly EnColaSinAmazon[]
  saltados: Readonly<Record<string, string>>
  bitacora: readonly EventoDeBitacora[]
  perfiles: ReadonlyArray<{ id: string; full_name: string | null }>
  /** El saldo preguntado a Keepa ahora mismo (null si no ha contestado) */
  saldoAhora: { tokens: number; ritmo: number } | null
  /** ¿Hay una pasada en marcha en este proceso? */
  enMarcha: boolean
}

/* ------------------------------------------------------------------ */
/* Salida                                                              */
/* ------------------------------------------------------------------ */

export type Cuenta = { amazon: number; sin: number; total: number }
export type EstadoDelProceso = 'trabajando' | 'esperando_saldo' | 'parado' | 'falla' | 'apagado' | 'cola_terminada'

export interface FilaDelLog {
  /** null = saltado antes de la bitácora (16 nov 2026): no se sabe cuándo */
  at: string | null
  tipo: TipoDeCola
  leadId: string | null
  tienda: string
  comercialId: string | null
  comercial: string
  resultado: 'hecho' | 'saltado' | 'fallo'
  motivo: string | null
  version: number | null
  aperturas: number
  abiertoUltima: string | null
  enviadoAt: string | null
  tokens: number | null
}

export interface ComercialDelPanel {
  id: string | null
  nombre: string
  enTurno: boolean
  posicion: number | null
  hechos: { amazon: number; sin: number; hoy: number; ayer: number }
  pendientes: { amazon: number; sin: number }
  saltados: number
  aperturas: number
  enviados: number
  /** Cuándo se acabarían sus pendientes al ritmo de ahora, repartido por turnos (aproximado) */
  finEstimado: string | null
}

export interface PanelDeInformes {
  generadoAt: string
  cifras: {
    hoy: Cuenta
    ayer: Cuenta
    /** Los de ayer hasta la misma hora que ahora: para comparar «hoy» sin que parezca que se hunde a primera hora */
    ayerALaMismaHora: number
    ultimos7: Cuenta
    total: Cuenta
    saltados: Cuenta
    enCola: Cuenta & { deLosCinco: number; resto: number }
    /** Informes por hora en las últimas 24 h */
    ritmoHora: number
    /** Informes por día: media de los últimos 3 días completos */
    ritmoDia: number
    finEstimado: { amazon: string | null; sin: string | null; cinco: string | null }
    aperturas: { informes: number; veces: number }
    enviadosPorCorreo: number
    primerInforme: string | null
  }
  porDia: Array<{ dia: string; amazon: number; sin: number; saltados: number }>
  porHora: Array<{ hora: string; amazon: number; sin: number }>
  /** El saldo de Keepa en tramos de 30 min (`at` = inicio del tramo): mínimo, máximo y media de las pasadas con saldo en el resumen */
  saldo: Array<{ at: string; min: number; max: number; media: number; pasadas: number }>
  comerciales: ComercialDelPanel[]
  turno: {
    orden: Array<{ id: string; nombre: string }>
    siguiente: { id: string | null; nombre: string; tipo: TipoDeCola } | null
    proximos: Array<{ id: string | null; nombre: string; tipo: TipoDeCola }>
    ultimos: Array<{ comercialId: string | null; nombre: string; tipo: TipoDeCola; at: string }>
    cumplimiento: number | null
    /** Desde cuándo se mide el cumplimiento (el primer apunte de la bitácora = el cambio de turnos) */
    desde: string | null
  }
  proceso: {
    activo: boolean
    ultimaPasadaAt: string | null
    minutosDesde: number | null
    ok: boolean | null
    enMarcha: boolean
    estado: EstadoDelProceso
    motivo: string
    saldo: number | null
    ritmoKeepa: number | null
    umbral: number | null
    minutosParaSiguiente: number | null
    ultimoError: { at: string; texto: string } | null
    pasadas24h: number
    fallos24h: number
    tokens24h: number
  }
  log: FilaDelLog[]
}

/* ------------------------------------------------------------------ */
/* Fechas en Madrid                                                    */
/* ------------------------------------------------------------------ */

const FORMATO_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
/** El día de Madrid de un instante: 'YYYY-MM-DD' */
export const diaMadrid = (t: number | string): string => FORMATO_DIA.format(new Date(t))

/** Los días de Madrid de `desde` a `hasta`, ambos incluidos */
export function diasEntre(desde: string, hasta: string): string[] {
  const salida: string[] = []
  let t = Date.parse(`${desde}T12:00:00Z`)
  const fin = Date.parse(`${hasta}T12:00:00Z`)
  while (t <= fin && salida.length < 400) {
    salida.push(new Date(t).toISOString().slice(0, 10))
    t += DIA
  }
  return salida
}

const diaAnterior = (dia: string, n = 1) => new Date(Date.parse(`${dia}T12:00:00Z`) - n * DIA).toISOString().slice(0, 10)

/* ------------------------------------------------------------------ */
/* Saldo de Keepa en el resumen del cron                               */
/* ------------------------------------------------------------------ */

const RE_SALDO = /saldo de Keepa \((-?\d+)\/(\d+)\)/
const RE_TOKENS = /(\d+) tokens/

export function leerSaldo(resumen: string | null | undefined): { tokens: number; umbral: number } | null {
  const m = resumen ? RE_SALDO.exec(resumen) : null
  return m ? { tokens: Number(m[1]), umbral: Number(m[2]) } : null
}

export function leerTokens(resumen: string | null | undefined): number {
  const m = resumen ? RE_TOKENS.exec(resumen) : null
  return m ? Number(m[1]) : 0
}

/* ------------------------------------------------------------------ */
/* Estimaciones                                                        */
/* ------------------------------------------------------------------ */

/** Fecha (ISO) en que se acaba `pendientes` a `porDia` informes al día. null si no hay ritmo */
export function finA(ahora: number, pendientes: number, porDia: number): string | null {
  if (pendientes <= 0) return new Date(ahora).toISOString()
  if (!(porDia > 0)) return null
  return new Date(ahora + (pendientes / porDia) * DIA).toISOString()
}

/**
 * CUÁNDO TERMINA CADA UNO, REPARTIDO POR TURNOS: mientras a k comerciales les queden, cada uno recibe 1/k del ritmo; el que antes acaba deja
 * su parte a los demás (llenado por niveles). El resto empieza cuando acaban los del turno. Devuelve días desde ahora por llave.
 */
export function diasHastaAcabar(pendientes: ReadonlyMap<string, number>, resto: number, porDia: number): { por: Map<string, number>; cinco: number; resto: number } | null {
  if (!(porDia > 0)) return null
  const lista = [...pendientes].filter(([, n]) => n > 0).sort((a, b) => a[1] - b[1])
  const por = new Map<string, number>()
  for (const [k, n] of pendientes) if (n <= 0) por.set(k, 0)
  let t = 0
  let previo = 0
  lista.forEach(([k, n], i) => {
    const activos = lista.length - i
    t += ((n - previo) * activos) / porDia
    previo = n
    por.set(k, t)
  })
  return { por, cinco: t, resto: t + resto / porDia }
}

/* ------------------------------------------------------------------ */
/* Estado del proceso                                                  */
/* ------------------------------------------------------------------ */

export function estadoDelProceso(
  cron: readonly FilaDeCron[],
  config: { activo: boolean; cadaMinutos: number } | null,
  saldoAhora: { tokens: number; ritmo: number } | null,
  enMarcha: boolean,
  enCola: number,
  ahora: number,
): PanelDeInformes['proceso'] {
  const ordenadas = [...cron].sort((a, b) => Date.parse(a.iniciado_at) - Date.parse(b.iniciado_at))
  const ultima = ordenadas[ordenadas.length - 1] ?? null
  const minutosDesde = ultima ? Math.max(0, Math.floor((ahora - Date.parse(ultima.iniciado_at)) / 60_000)) : null
  const hace24 = ahora - DIA
  const de24 = ordenadas.filter((f) => Date.parse(f.iniciado_at) >= hace24)
  const conError = [...ordenadas].reverse().find((f) => f.ok === false) ?? null
  const ultimoConSaldo = [...ordenadas].reverse().find((f) => leerSaldo(f.resumen)) ?? null
  const delResumen = ultimoConSaldo ? leerSaldo(ultimoConSaldo.resumen) : null
  const saldo = saldoAhora?.tokens ?? delResumen?.tokens ?? null
  const ritmoKeepa = saldoAhora?.ritmo ?? null
  const umbral = delResumen?.umbral ?? null
  const activo = config?.activo ?? true
  const cada = Math.max(1, config?.cadaMinutos ?? 1)

  let estado: EstadoDelProceso
  if (!activo) estado = 'apagado'
  else if (!ultima || (minutosDesde ?? 0) > Math.max(5, cada * 3)) estado = 'parado'
  else if (ultima.ok === false || (ultima.ok === null && (minutosDesde ?? 0) > 6)) estado = 'falla'
  else if (enCola === 0 || /cola terminada/.test(ultima.resumen ?? '')) estado = 'cola_terminada'
  else if (enMarcha || ultima.ok === null) estado = 'trabajando'
  else if (leerSaldo(ultima.resumen)) estado = 'esperando_saldo'
  else estado = 'trabajando'

  const falta = saldo != null && umbral != null ? umbral - saldo : null
  const minutosParaSiguiente = estado === 'esperando_saldo' && falta != null ? (falta <= 0 ? 0 : ritmoKeepa && ritmoKeepa > 0 ? Math.ceil(falta / ritmoKeepa) : null) : null

  const motivo =
    estado === 'apagado'
      ? 'Apagado desde Sistema: no se hace ningún informe hasta que se vuelva a encender.'
      : estado === 'parado'
        ? ultima
          ? `El cron no pasa desde hace ${minutosDesde} min: puede que el servidor se esté reiniciando o que el cron se haya caído.`
          : 'No hay ninguna pasada registrada en las últimas 48 horas.'
        : estado === 'falla'
          ? `La última pasada ha fallado${ultima?.error ? `: ${ultima.error.slice(0, 160)}` : ''}.`
          : estado === 'cola_terminada'
            ? 'No queda nada en las colas: todo está hecho o saltado.'
            : estado === 'esperando_saldo'
              ? `Esperando saldo de Keepa: ${saldo ?? '?'} de ${umbral ?? '?'}${minutosParaSiguiente != null ? (minutosParaSiguiente === 0 ? ' (ya llega: en la próxima pasada)' : ` (unos ${minutosParaSiguiente} min)`) : ''}.`
              : 'Haciendo informes ahora mismo.'

  return {
    activo,
    ultimaPasadaAt: ultima?.iniciado_at ?? null,
    minutosDesde,
    ok: ultima?.ok ?? null,
    enMarcha,
    estado,
    motivo,
    saldo,
    ritmoKeepa,
    umbral,
    minutosParaSiguiente,
    ultimoError: conError ? { at: conError.iniciado_at, texto: (conError.error ?? 'sin detalle').slice(0, 300) } : null,
    pasadas24h: de24.length,
    fallos24h: de24.filter((f) => f.ok === false).length,
    tokens24h: de24.reduce((s, f) => s + leerTokens(f.resumen), 0),
  }
}

/** Los tramos del gráfico del saldo */
export const MINUTOS_POR_TRAMO_DE_SALDO = 30

/**
 * El saldo de las últimas 48 h en tramos de 30 min: el mínimo, el máximo y la media de las pasadas del tramo. El saldo va en dientes de
 * sierra (sube a ~21/min y cae de golpe al hacer una tienda); punto a punto era un código de barras. Con la banda se ve de un vistazo si
 * Keepa recarga y se gasta (banda ancha de 0 a ~280) o si se ha quedado quieto (banda estrecha, arriba o abajo).
 */
export function serieDeSaldo(cron: readonly FilaDeCron[], ahora: number): PanelDeInformes['saldo'] {
  const desde = ahora - 2 * DIA
  const ancho = MINUTOS_POR_TRAMO_DE_SALDO * 60_000
  const tramos = new Map<number, { min: number; max: number; suma: number; n: number }>()
  for (const f of cron) {
    const t = Date.parse(f.iniciado_at)
    if (t < desde || t > ahora) continue
    const s = leerSaldo(f.resumen)
    if (!s) continue
    const tramo = Math.floor(t / ancho)
    const a = tramos.get(tramo) ?? { min: Infinity, max: -Infinity, suma: 0, n: 0 }
    a.min = Math.min(a.min, s.tokens)
    a.max = Math.max(a.max, s.tokens)
    a.suma += s.tokens
    a.n++
    tramos.set(tramo, a)
  }
  return [...tramos.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tramo, a]) => ({ at: new Date(tramo * ancho).toISOString(), min: a.min, max: a.max, media: Math.round(a.suma / a.n), pasadas: a.n }))
}

/* ------------------------------------------------------------------ */
/* El panel                                                            */
/* ------------------------------------------------------------------ */

const vacia = (): Cuenta => ({ amazon: 0, sin: 0, total: 0 })
const sumar = (c: Cuenta, tipo: TipoDeCola, n = 1) => {
  c[tipo] += n
  c.total += n
}
const tipoDe = (f: { seller_id: string }): TipoDeCola => (f.seller_id === SELLER_SIN_AMAZON ? 'sin' : 'amazon')

export const TOPE_DEL_LOG = 3_000
const SIN_ASIGNAR = 'sin-asignar'

export function construirPanel(e: EntradaDelPanel): PanelDeInformes {
  const { ahora } = e
  const hoy = diaMadrid(ahora)
  const ayer = diaAnterior(hoy)
  const hace7 = diaAnterior(hoy, 6)
  const porNombre = idPorNombre(e.perfiles)
  const nombreDePerfil = new Map(e.perfiles.map((p) => [p.id, (p.full_name ?? '').trim().split(/\s+/)[0] || 'Sin nombre']))
  for (const c of ORDEN_DE_COMERCIALES) if (!nombreDePerfil.has(c.id)) nombreDePerfil.set(c.id, c.nombre)
  const nombreDe = (id: string | null) => (id ? (nombreDePerfil.get(id) ?? 'Otro') : 'Sin asignar')
  const comercialIdDe = (v: EnCola | EnColaSinAmazon) => comercialDe(v, porNombre)

  const informes = [...e.informes].sort((a, b) => Date.parse(a.creado_en) - Date.parse(b.creado_en))
  const hechos = new Set(informes.map((f) => f.lead_id))

  // Envíos por correo: el primero de cada lead
  const enviadoA = new Map<string, string>()
  for (const n of e.envios) {
    const previo = enviadoA.get(n.lead_id)
    if (!previo || Date.parse(n.occurred_at) < Date.parse(previo)) enviadoA.set(n.lead_id, n.occurred_at)
  }

  // Bitácora: tokens de cada hecho y hora de cada saltado (por lead y tipo; el último manda)
  const bitacora = [...e.bitacora].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const tokensDelHecho = new Map<string, number>()
  const saltoDe = new Map<string, EventoDeBitacora>()
  for (const ev of bitacora) {
    const k = `${ev.tipo}:${ev.lead}`
    if (ev.resultado === 'hecho') tokensDelHecho.set(k, ev.tokens)
    else if (ev.resultado === 'saltado') saltoDe.set(k, ev)
  }

  /* ---------- cifras de hechos ---------- */
  const total = vacia()
  const deHoy = vacia()
  const deAyer = vacia()
  const ultimos7 = vacia()
  const porDiaMapa = new Map<string, { amazon: number; sin: number; saltados: number }>()
  const horaDesde = Math.floor((ahora - 47 * HORA) / HORA) * HORA
  const porHoraMapa = new Map<number, { amazon: number; sin: number }>()
  for (let t = horaDesde; t <= ahora; t += HORA) porHoraMapa.set(t, { amazon: 0, sin: 0 })
  let ultimas24 = 0
  let ayerALaMismaHora = 0
  let aperturasInformes = 0
  let aperturasVeces = 0

  for (const f of informes) {
    const tipo = tipoDe(f)
    const t = Date.parse(f.creado_en)
    const dia = diaMadrid(t)
    sumar(total, tipo)
    if (dia === hoy) sumar(deHoy, tipo)
    if (dia === ayer) {
      sumar(deAyer, tipo)
      if (t <= ahora - DIA) ayerALaMismaHora++
    }
    if (dia >= hace7) sumar(ultimos7, tipo)
    const d = porDiaMapa.get(dia) ?? { amazon: 0, sin: 0, saltados: 0 }
    d[tipo]++
    porDiaMapa.set(dia, d)
    const h = porHoraMapa.get(Math.floor(t / HORA) * HORA)
    if (h) h[tipo]++
    if (t > ahora - DIA) ultimas24++
    if ((f.aperturas ?? 0) > 0) {
      aperturasInformes++
      aperturasVeces += f.aperturas ?? 0
    }
  }
  for (const ev of bitacora) {
    if (ev.resultado !== 'saltado') continue
    const dia = diaMadrid(ev.at)
    const d = porDiaMapa.get(dia) ?? { amazon: 0, sin: 0, saltados: 0 }
    d.saltados++
    porDiaMapa.set(dia, d)
  }

  const primerDia = informes.length ? diaMadrid(informes[0].creado_en) : hoy
  const porDia = diasEntre(primerDia, hoy).map((dia) => ({ dia, ...(porDiaMapa.get(dia) ?? { amazon: 0, sin: 0, saltados: 0 }) }))
  const porHora = [...porHoraMapa.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ hora: new Date(t).toISOString(), ...v }))

  // Ritmo por día: media de los últimos 3 días COMPLETOS (sin hoy); si aún no hay, el de las últimas 24 h
  const completos = porDia.filter((d) => d.dia < hoy).slice(-3)
  const ritmoHora = ultimas24 / 24
  const media = (f: (d: (typeof porDia)[number]) => number) => (completos.length ? completos.reduce((s, d) => s + f(d), 0) / completos.length : null)
  const ritmoDia = media((d) => d.amazon + d.sin) ?? ritmoHora * 24
  const ritmoAm = media((d) => d.amazon) ?? ritmoDia / 2
  const ritmoSin = media((d) => d.sin) ?? ritmoDia / 2

  /* ---------- colas: pendientes y saltados ---------- */
  const pendientes = e.cola.filter((v) => !hechos.has(v.lead) && !e.saltados[v.seller])
  const pendientesSin = e.colaSin.filter((v) => !hechos.has(v.lead) && !e.saltados[`lead:${v.lead}`])
  const pendientesPor = new Map<string, { amazon: number; sin: number }>()
  const sumarPendiente = (id: string | null, tipo: TipoDeCola) => {
    const k = id ?? SIN_ASIGNAR
    const p = pendientesPor.get(k) ?? { amazon: 0, sin: 0 }
    p[tipo]++
    pendientesPor.set(k, p)
  }
  for (const v of pendientes) sumarPendiente(comercialIdDe(v), 'amazon')
  for (const v of pendientesSin) sumarPendiente(comercialIdDe(v), 'sin')

  const deLosCinco = IDS_DEL_ORDEN.reduce((s, id) => s + (pendientesPor.get(id)?.amazon ?? 0) + (pendientesPor.get(id)?.sin ?? 0), 0)
  const enColaTotal = pendientes.length + pendientesSin.length

  // Saltados: de la clave a su entrada de la cola (en Amazon la clave es el seller)
  const porSeller = new Map<string, EnCola>()
  for (const v of e.cola) if (!porSeller.has(v.seller)) porSeller.set(v.seller, v)
  const porLeadSin = new Map(e.colaSin.map((v) => [v.lead, v]))
  const saltadosCuenta = vacia()
  const saltadosPor = new Map<string, number>()
  const filasSaltadas: FilaDelLog[] = []
  for (const [clave, motivo] of Object.entries(e.saltados)) {
    const esSin = clave.startsWith('lead:')
    const tipo: TipoDeCola = esSin ? 'sin' : 'amazon'
    sumar(saltadosCuenta, tipo)
    const entrada: EnCola | EnColaSinAmazon | undefined = esSin ? porLeadSin.get(clave.slice(5)) : porSeller.get(clave)
    const leadId = esSin ? clave.slice(5) : (entrada?.lead ?? null)
    const comercialId = entrada ? comercialIdDe(entrada) : null
    saltadosPor.set(comercialId ?? SIN_ASIGNAR, (saltadosPor.get(comercialId ?? SIN_ASIGNAR) ?? 0) + 1)
    const ev = leadId ? saltoDe.get(`${tipo}:${leadId}`) : undefined
    filasSaltadas.push({
      at: ev?.at ?? null,
      tipo,
      leadId,
      tienda: entrada?.tienda ?? (esSin ? 'Tienda sin Amazon' : `Vendedor ${clave}`),
      comercialId,
      comercial: nombreDe(comercialId),
      resultado: 'saltado',
      motivo,
      version: null,
      aperturas: 0,
      abiertoUltima: null,
      enviadoAt: leadId ? (enviadoA.get(leadId) ?? null) : null,
      tokens: ev?.tokens ?? null,
    })
  }

  /* ---------- por comercial ---------- */
  type Acum = { amazon: number; sin: number; hoy: number; ayer: number; aperturas: number; enviados: number }
  const hechosPor = new Map<string, Acum>()
  const acum = (k: string) => {
    let a = hechosPor.get(k)
    if (!a) {
      a = { amazon: 0, sin: 0, hoy: 0, ayer: 0, aperturas: 0, enviados: 0 }
      hechosPor.set(k, a)
    }
    return a
  }
  for (const f of informes) {
    const a = acum(f.lead?.assigned_to ?? SIN_ASIGNAR)
    a[tipoDe(f)]++
    const dia = diaMadrid(f.creado_en)
    if (dia === hoy) a.hoy++
    if (dia === ayer) a.ayer++
    a.aperturas += f.aperturas ?? 0
    if (enviadoA.has(f.lead_id)) a.enviados++
  }

  const otros = new Set<string>([...hechosPor.keys(), ...pendientesPor.keys()])
  for (const id of IDS_DEL_ORDEN) otros.delete(id)
  otros.delete(SIN_ASIGNAR)
  const llaves = [...IDS_DEL_ORDEN, ...[...otros].sort((a, b) => nombreDe(a).localeCompare(nombreDe(b), 'es')), SIN_ASIGNAR]

  // Fin estimado de cada uno: los del turno se reparten el ritmo; los demás (resto) van después, en el orden del fichero
  const pendientesDelTurno = new Map(IDS_DEL_ORDEN.map((id) => [id, (pendientesPor.get(id)?.amazon ?? 0) + (pendientesPor.get(id)?.sin ?? 0)]))
  const finTurno = diasHastaAcabar(pendientesDelTurno, enColaTotal - deLosCinco, ritmoDia)

  const comerciales: ComercialDelPanel[] = llaves
    .map((k) => {
      const enTurno = IDS_DEL_ORDEN.includes(k)
      const h = hechosPor.get(k) ?? { amazon: 0, sin: 0, hoy: 0, ayer: 0, aperturas: 0, enviados: 0 }
      const p = pendientesPor.get(k) ?? { amazon: 0, sin: 0 }
      const dias = enTurno ? finTurno?.por.get(k) : p.amazon + p.sin > 0 ? finTurno?.resto : 0
      return {
        id: k === SIN_ASIGNAR ? null : k,
        nombre: k === SIN_ASIGNAR ? 'Sin asignar' : nombreDe(k),
        enTurno,
        posicion: enTurno ? IDS_DEL_ORDEN.indexOf(k) + 1 : null,
        hechos: { amazon: h.amazon, sin: h.sin, hoy: h.hoy, ayer: h.ayer },
        pendientes: p,
        saltados: saltadosPor.get(k) ?? 0,
        aperturas: h.aperturas,
        enviados: h.enviados,
        finEstimado: dias == null ? null : new Date(ahora + dias * DIA).toISOString(),
      }
    })
    .filter((c) => c.enTurno || c.hechos.amazon + c.hechos.sin + c.pendientes.amazon + c.pendientes.sin + c.saltados > 0)

  /* ---------- turno ---------- */
  const recientes = [...informes].reverse()
  // El turno sale de la misma fuente que el Repartidor: la bitácora, con el comercial de la ENTRADA DE LA COLA (no el dueño actual del lead,
  // que cambia con las reasignaciones). El dueño actual solo rellena lo anterior a la bitácora.
  const hechosTurno = hechosDelTurno(
    bitacora,
    recientes.slice(0, 60).map((f) => ({ comercialId: f.lead?.assigned_to ?? null, tipo: tipoDe(f), at: f.creado_en, lead: f.lead_id })),
    30,
  )
  const estado = estadoDelTurno(hechosTurno.slice(0, 25))
  const proximas = simularTurnos<EnCola, EnColaSinAmazon>(pendientes, pendientesSin, comercialIdDe, estado, 10)
  const aProximo = (x: (typeof proximas)[number]) => {
    const id = x.grupo === RESTO ? comercialIdDe(x.v) : x.grupo
    return { id, nombre: x.grupo === RESTO ? `${nombreDe(id)} (resto)` : nombreDe(id), tipo: x.tipo }
  }
  const conPendientes = new Set(IDS_DEL_ORDEN.filter((id) => (pendientesDelTurno.get(id) ?? 0) > 0))
  const desde = bitacora[0]?.at ?? null
  // Desde el cambio todo hecho está en la bitácora (ya va del más viejo al más nuevo), con el comercial con el que se repartió
  const trasElCambio = bitacora.filter((ev) => ev.resultado === 'hecho').slice(-31)
  const cumplimiento = cumplimientoDelTurno(
    trasElCambio.map((ev) => ({ comercialId: ev.comercialId ?? null })),
    conPendientes,
  )

  /* ---------- log ---------- */
  const filasHechas: FilaDelLog[] = recientes.map((f) => {
    const tipo = tipoDe(f)
    const comercialId = f.lead?.assigned_to ?? null
    return {
      at: f.creado_en,
      tipo,
      leadId: f.lead_id,
      tienda: f.lead?.store_name?.trim() || 'Sin nombre',
      comercialId,
      comercial: nombreDe(comercialId),
      resultado: 'hecho',
      motivo: (f.version ?? 1) > 1 ? `versión ${f.version}` : null,
      version: f.version,
      aperturas: f.aperturas ?? 0,
      abiertoUltima: f.abierto_ultima_at,
      enviadoAt: enviadoA.get(f.lead_id) ?? null,
      tokens: tokensDelHecho.get(`${tipo}:${f.lead_id}`) ?? null,
    }
  })
  const filasFallidas: FilaDelLog[] = bitacora
    .filter((ev) => ev.resultado === 'fallo')
    .map((ev) => ({
      at: ev.at,
      tipo: ev.tipo,
      leadId: ev.lead,
      tienda: ev.tienda,
      comercialId: ev.comercialId,
      comercial: nombreDe(ev.comercialId),
      resultado: 'fallo',
      motivo: ev.motivo ?? null,
      version: null,
      aperturas: 0,
      abiertoUltima: null,
      enviadoAt: null,
      tokens: ev.tokens || null,
    }))
  const log = [...filasHechas, ...filasSaltadas, ...filasFallidas]
    .sort((a, b) => (a.at && b.at ? Date.parse(b.at) - Date.parse(a.at) : a.at ? -1 : b.at ? 1 : 0))
    .slice(0, TOPE_DEL_LOG)

  const proceso = estadoDelProceso(e.cron, e.config, e.saldoAhora, e.enMarcha, enColaTotal, ahora)

  return {
    generadoAt: new Date(ahora).toISOString(),
    cifras: {
      hoy: deHoy,
      ayer: deAyer,
      ayerALaMismaHora,
      ultimos7,
      total,
      saltados: saltadosCuenta,
      enCola: { amazon: pendientes.length, sin: pendientesSin.length, total: enColaTotal, deLosCinco, resto: enColaTotal - deLosCinco },
      ritmoHora,
      ritmoDia,
      finEstimado: {
        amazon: finA(ahora, pendientes.length, ritmoAm),
        sin: finA(ahora, pendientesSin.length, ritmoSin),
        cinco: finTurno ? new Date(ahora + finTurno.cinco * DIA).toISOString() : null,
      },
      aperturas: { informes: aperturasInformes, veces: aperturasVeces },
      enviadosPorCorreo: enviadoA.size,
      primerInforme: informes[0]?.creado_en ?? null,
    },
    porDia,
    porHora,
    saldo: serieDeSaldo(e.cron, ahora),
    comerciales,
    turno: {
      orden: ORDEN_DE_COMERCIALES.map((c) => ({ id: c.id, nombre: nombreDe(c.id) })),
      siguiente: proximas[0] ? aProximo(proximas[0]) : null,
      proximos: proximas.map(aProximo),
      ultimos: hechosTurno.map((h) => ({ comercialId: h.comercialId, nombre: nombreDe(h.comercialId), tipo: h.tipo, at: h.at })),
      cumplimiento,
      desde,
    },
    proceso,
    log,
  }
}
