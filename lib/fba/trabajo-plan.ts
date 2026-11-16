/**
 * EL TRABAJO CON LOS ENVÍOS PROPUESTOS: ESTADOS, PENDIENTES Y AVISOS SIN SPAM.
 * ===========================================================================
 * PURO (spec remesas-pro §4.1, §4.3, §4.4 con §11 D18, D19, D22 y D24). Sin base de datos, sin red y sin
 * `Date.now()`: `hoy` llega siempre de fuera. La escritura (historial, campana, chat) está en el servidor
 * (`plan-avisos.ts`, `envios-propuestos-servidor.ts`); aquí solo se DECIDE.
 *
 * ============ LOS ESTADOS DE UN ENVÍO PROPUESTO ============
 *
 *   nuevo ──▶ hablado ⇄ esperando_cliente ──(convertir)──▶ en_preparacion ──(remesa enviada)──▶ enviado
 *     │                                                          ▲   │                             │
 *     │                                                          │   └─(desenlazar / remesa borrada)─▶ hablado
 *     │                                                          └──────(la remesa vuelve a «lista»)┘
 *     ├──▶ descartado (motivo obligatorio; cuarentena de 14 días) ──(Recuperar)──▶ nuevo
 *     └──▶ caducado (lo pone la pasada: el plan ya no lo pide)
 *
 * ============ PENDIENTES ============
 *
 * `pendientes()` junta en una sola lista lo que se nos puede escapar: envíos propuestos vencidos o sin dueño,
 * remesas paradas, envíos que Amazon no recibe, envíos cerrados con faltantes (con la cuenta atrás para
 * reclamar), lo que Amazon tiene entrante sin remesa en el ERP, modelos agotados, agotados largos y mermas.
 * Cada tarea dice QUÉ hacer (imperativo, de tú), POR QUÉ (con cifras) y ADÓNDE ir, como `lib/ads/hoy.ts`.
 * Se ordena por gravedad y, dentro, por € en juego.
 *
 * ============ AVISOS SIN SPAM ============
 *
 * Campana: una vez por NIVEL (tarde, urgente, esta semana) y solo cuando aparece o SUBE; bajar no avisa.
 * Al vencer, una vez. Nada de `proximas_2|este_mes`, y nada provisional salvo que lleve un agotado con ventas.
 * Chat: como mucho un resumen al día (8 líneas), solo si hay tarde, urgente o vencidos.
 */

import type {
  CalidadDatos,
  EnvioPropuestoGuardado,
  EstadoEnvioPropuesto,
  LineaPlan,
  Moneda,
  Prioridad,
  TareaPendiente,
  TipoPendiente,
} from './plan-tipos'
import type { EstadoRemesa } from './flujo'
import { columnaDe } from './tablero-propuestas'

/* =============================================================================================
 * Utilidades (fechas en días «YYYY-MM-DD», cifras en español)
 * ============================================================================================= */

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function aUtc(dia: string): number {
  return Date.UTC(Number(dia.slice(0, 4)), Number(dia.slice(5, 7)) - 1, Number(dia.slice(8, 10)))
}

/** Días de `desde` a `hasta` (negativo si `hasta` va antes). Acepta marcas de tiempo: se queda con el día */
export function diasEntreDias(desde: string, hasta: string): number {
  return Math.round((aUtc(hasta.slice(0, 10)) - aUtc(desde.slice(0, 10))) / 86_400_000)
}

/** «2026-12-03» → «3 dic» */
export function diaCorto(dia: string | null | undefined): string {
  if (!dia || !/^\d{4}-\d{2}-\d{2}/.test(dia)) return '—'
  return `${Number(dia.slice(8, 10))} ${MESES_CORTOS[Number(dia.slice(5, 7)) - 1]}`
}

/** Miles con punto siempre («3.200»; `toLocaleString('es-ES')` deja «3200» con cuatro cifras) */
function miles(n: number): string {
  const r = Math.round(n)
  const s = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return r < 0 ? `-${s}` : s
}

const SIMBOLOS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', SEK: 'kr', PLN: 'zł', CAD: 'CA$', MXN: 'MX$' }
export function simboloDe(moneda: Moneda | null | undefined): string {
  if (!moneda) return '€'
  return SIMBOLOS[moneda] ?? moneda
}

/** «3.200 €», «1.200 $» */
export function dinero(n: number, moneda: Moneda | null | undefined): string {
  return `${miles(n)} ${simboloDe(moneda)}`
}

const ud = (n: number) => `${miles(n)} ud`
const plural = (n: number, uno: string, varios: string) => `${miles(n)} ${n === 1 ? uno : varios}`
const ritmoTexto = (r: number) => `${r.toLocaleString('es-ES', { maximumFractionDigits: r < 1 ? 2 : 1 })} ud/día`

/* =============================================================================================
 * 1) Estados y transiciones (§4.1 + D19)
 * ============================================================================================= */

/** Quién mueve el envío propuesto. `sistema` = la pasada del planificador o un cambio de la remesa enlazada */
export type ActorPlan = 'agencia' | 'cliente' | 'sistema'

export interface TransicionPlan {
  desde: EstadoEnvioPropuesto
  hasta: EstadoEnvioPropuesto
  quien: Array<Exclude<ActorPlan, 'cliente'>>
  /** Texto del botón (o de la entrada del historial si es automática) */
  accion: string
  /** Lo que hace además de cambiar el estado */
  efecto: string
}

export const TRANSICIONES_PLAN: readonly TransicionPlan[] = [
  { desde: 'nuevo', hasta: 'hablado', quien: ['agencia'], accion: 'Hablado con el cliente', efecto: 'Congela lo hablado (lineas_aceptadas = lineas).' },
  { desde: 'hablado', hasta: 'esperando_cliente', quien: ['agencia'], accion: 'Esperando al cliente', efecto: 'Apunta desde cuándo se espera (esperando_desde = hoy).' },
  { desde: 'esperando_cliente', hasta: 'hablado', quien: ['agencia'], accion: 'El cliente ha contestado', efecto: 'Deja de contar la espera.' },
  { desde: 'nuevo', hasta: 'en_preparacion', quien: ['agencia'], accion: 'Convertir en remesa', efecto: 'Crea la remesa en borrador y la enlaza.' },
  { desde: 'hablado', hasta: 'en_preparacion', quien: ['agencia'], accion: 'Convertir en remesa', efecto: 'Crea la remesa en borrador con lo hablado y la enlaza.' },
  { desde: 'esperando_cliente', hasta: 'en_preparacion', quien: ['agencia'], accion: 'Convertir en remesa', efecto: 'Crea la remesa en borrador con lo hablado y la enlaza.' },
  { desde: 'en_preparacion', hasta: 'enviado', quien: ['sistema'], accion: 'La remesa ha salido', efecto: 'Lo pasa la pasada o al marcar la remesa como enviada.' },
  { desde: 'enviado', hasta: 'en_preparacion', quien: ['sistema'], accion: 'La remesa vuelve a «lista»', efecto: 'La remesa se marcó como enviada por error.' },
  { desde: 'en_preparacion', hasta: 'hablado', quien: ['agencia', 'sistema'], accion: 'Desenlazar de la remesa', efecto: 'Queda en «hablado»; si la remesa se borró, se anota «remesa_borrada».' },
  { desde: 'enviado', hasta: 'hablado', quien: ['sistema'], accion: 'Se ha borrado la remesa', efecto: 'Sin remesa no hay envío: vuelve a «hablado» con nota en el historial.' },
  { desde: 'nuevo', hasta: 'descartado', quien: ['agencia'], accion: 'Descartar', efecto: 'Pide motivo; cuarentena de 14 días.' },
  { desde: 'hablado', hasta: 'descartado', quien: ['agencia'], accion: 'Descartar', efecto: 'Pide motivo; cuarentena de 14 días.' },
  { desde: 'esperando_cliente', hasta: 'descartado', quien: ['agencia'], accion: 'Descartar', efecto: 'Pide motivo; cuarentena de 14 días.' },
  { desde: 'descartado', hasta: 'nuevo', quien: ['agencia'], accion: 'Recuperar', efecto: 'Vuelve a la lista como nuevo.' },
  { desde: 'nuevo', hasta: 'caducado', quien: ['sistema'], accion: 'El plan ya no lo pide', efecto: 'Lo pone la pasada (§2.8).' },
]

const NOMBRE_ESTADO: Record<EstadoEnvioPropuesto, string> = {
  nuevo: 'nuevo',
  hablado: 'hablado',
  esperando_cliente: 'esperando al cliente',
  en_preparacion: 'en preparación',
  enviado: 'enviado',
  descartado: 'descartado',
  caducado: 'caducado',
}

export function puedeCambiar(
  desde: EstadoEnvioPropuesto,
  hasta: EstadoEnvioPropuesto,
  actor: ActorPlan,
): { ok: true } | { ok: false; motivo: string } {
  if (desde === hasta) return { ok: false, motivo: `Ya está ${NOMBRE_ESTADO[hasta]}.` }
  if (actor === 'cliente') return { ok: false, motivo: 'Los envíos propuestos los gestiona la agencia.' }
  const t = TRANSICIONES_PLAN.find((x) => x.desde === desde && x.hasta === hasta)
  if (!t) return { ok: false, motivo: `No se puede pasar de «${NOMBRE_ESTADO[desde]}» a «${NOMBRE_ESTADO[hasta]}».` }
  if (!t.quien.includes(actor)) {
    return {
      ok: false,
      motivo: actor === 'agencia'
        ? `«${t.accion}» lo hace solo el sistema: ${t.efecto}`
        : `«${t.accion}» lo hace una persona de la agencia.`,
    }
  }
  return { ok: true }
}

/** Qué le pasa al envío propuesto enlazado cuando su remesa cambia (D19). null = nada */
export function efectoDeRemesa(
  evento: 'enviada' | 'vuelve_a_lista' | 'borrada',
  estadoEnvio: EstadoEnvioPropuesto,
): EstadoEnvioPropuesto | null {
  if (evento === 'enviada') return estadoEnvio === 'en_preparacion' ? 'enviado' : null
  if (evento === 'vuelve_a_lista') return estadoEnvio === 'enviado' ? 'en_preparacion' : null
  // borrada: sin remesa no hay ni preparación ni envío; lo hablado sigue valiendo
  return estadoEnvio === 'en_preparacion' || estadoEnvio === 'enviado' ? 'hablado' : null
}

/** Estados en los que todavía hay que decidir algo (los que vencen) */
const DECIDIENDO: readonly EstadoEnvioPropuesto[] = ['nuevo', 'hablado', 'esperando_cliente']

/** Vencido = todavía por decidir y la fecha límite ya pasó */
export function esVencido(envio: { estado: EstadoEnvioPropuesto; fechaLimite: string | null }, hoy: string): boolean {
  return DECIDIENDO.includes(envio.estado) && !!envio.fechaLimite && envio.fechaLimite.slice(0, 10) < hoy
}

/* =============================================================================================
 * 2) Pendientes (§4.3 + D18)
 * ============================================================================================= */

/** Plazo de Amazon para reclamar unidades de un envío cerrado con faltantes, contado desde el cierre */
export const PLAZO_RECLAMACION_DIAS = 60

/** Una remesa del ERP tal como la necesita `pendientes` (la prepara el servidor) */
export interface RemesaParaPendientes {
  id: string
  clienteId: string
  clienteNombre: string
  nombre: string | null
  referenciaEnvio: string | null
  estado: EstadoRemesa
  estadoAmazon: string | null
  fechaEnvio: string | null
  /** Último cambio de la remesa en el ERP (para «parada») */
  actualizadaAt: string | null
  /** Último cambio de estado en Amazon (para CLOSED: el día del cierre) */
  estadoAmazonDesde: string | null
  propuestaEnviadaAt: string | null
  clienteAceptoAt: string | null
  enviadas: number
  /** null = Amazon todavía no ha contado nada */
  recibidas: number | null
  moneda: Moneda | null
  /** Por referencia, para el € de los faltantes a precio actual */
  lineas?: Array<{ sku: string; unidades: number; recibidas: number | null; precio: number | null }>
  /** Nació de un envío propuesto */
  envioPropuestoId?: string | null
}

export interface ClienteParaPendientes {
  clienteId: string
  clienteNombre: string
  calidad: CalidadDatos | null
  /** Todas las líneas del último plan (para entrantes sin remesa, modelos y agotados) */
  lineas: LineaPlan[]
  /** Transporte mediano medido (para «dudoso»); null = de partida */
  transporteMediano: number | null
  moneda: Moneda
}

export interface EntradaPendientes {
  hoy: string
  envios: EnvioPropuestoGuardado[]
  remesas: RemesaParaPendientes[]
  clientes: ClienteParaPendientes[]
  /** Por defecto `PLAZO_RECLAMACION_DIAS` */
  plazoReclamacionDias?: number
}

const ORDEN_GRAVEDAD = { alta: 0, media: 1, baja: 2 } as const
const RANGO_PRIORIDAD: Record<Prioridad, number> = { tarde: 0, urgente: 1, esta_semana: 2, proximas_2: 3, este_mes: 4, mas_adelante: 5 }

const nombreRemesa = (r: Pick<RemesaParaPendientes, 'nombre' | 'referenciaEnvio' | 'fechaEnvio'>) =>
  r.referenciaEnvio
    ? `${r.referenciaEnvio}${r.fechaEnvio ? ` (salió el ${diaCorto(r.fechaEnvio)})` : ''}`
    : r.nombre || (r.fechaEnvio ? `la remesa del ${diaCorto(r.fechaEnvio)}` : 'la remesa')

/** Dudoso (D3): lleva más de max(30, 2,5 × transporte) días y Amazon no ha recibido nada */
function dudoso(edadDias: number, recibidas: number | null, transporteMediano: number | null): boolean {
  if ((recibidas ?? 0) > 0) return false
  return edadDias > Math.max(30, 2.5 * (transporteMediano ?? 0))
}

/** Una línea agotada que vende (V = 0 con ventas en 30 días): lo único que se avisa aunque el plan sea provisional */
export function esAgotadaConVentas(l: Pick<LineaPlan, 'vendibles' | 'ritmo'>): boolean {
  return l.vendibles <= 0 && (l.ritmo?.ventas30 ?? 0) > 0
}

function tareaDeEnvioPropuesto(e: EnvioPropuestoGuardado, hoy: string): TareaPendiente | null {
  if (!DECIDIENDO.includes(e.estado)) return null
  const refs = e.lineas?.length ?? 0
  const euros = e.eurosEnRiesgo != null && e.eurosEnRiesgo > 0 ? e.eurosEnRiesgo : null
  const cifras = [ud(e.unidades), refs ? plural(refs, 'referencia', 'referencias') : null, euros != null ? `${dinero(euros, e.moneda)} en juego si no sale` : null]
    .filter(Boolean)
    .join(' · ')
  const porque = e.porque?.[0] ? ` ${e.porque[0]}` : ''
  const provisional = e.provisional ? ' (Plan provisional: las ventas no están al día.)' : ''
  const base = {
    clienteId: e.clienteId,
    clienteNombre: e.clienteNombre,
    euros,
    moneda: euros != null ? e.moneda : null,
    ir: { vista: 'plan' as const, params: { envio: e.id, cliente: e.clienteId } },
    envioPropuestoId: e.id,
    remesaId: e.remesaId,
  }
  const queHacer =
    e.estado === 'nuevo' ? `Habla con ${e.clienteNombre} del envío` :
    e.estado === 'hablado' ? `Convierte en remesa el envío de ${e.clienteNombre}` :
    `Recuérdale a ${e.clienteNombre} el envío`
  const urgente = e.prioridad === 'tarde' || e.prioridad === 'urgente'

  // 1) vencido
  if (esVencido(e, hoy)) {
    const dias = diasEntreDias(e.fechaLimite, hoy)
    return {
      ...base,
      id: `envio_vencido:${e.id}`,
      tipo: 'envio_vencido',
      gravedad: 'alta',
      titulo: `${queHacer}: venció el ${diaCorto(e.fechaLimite)}`,
      detalle: `Lleva ${plural(dias, 'día', 'días')} vencido. ${cifras}. Tiene que salir antes del ${diaCorto(e.salirAntesDe)}.${porque}${provisional}`,
      diasRestantes: -dias,
    }
  }
  // 2) tarde o urgente sin responsable
  if (urgente && !e.responsableId) {
    return {
      ...base,
      id: `sin_responsable:${e.id}`,
      tipo: 'sin_responsable',
      gravedad: 'alta',
      titulo: `Asígnate el envío ${e.prioridad === 'tarde' ? 'que ya va tarde' : 'urgente'} de ${e.clienteNombre}`,
      detalle: `Nadie lo lleva. Decidir antes del ${diaCorto(e.fechaLimite)} y salir antes del ${diaCorto(e.salirAntesDe)}. ${cifras}.${porque}${provisional}`,
      diasRestantes: diasEntreDias(hoy, e.fechaLimite),
    }
  }
  // 3) vence esta semana
  const quedan = diasEntreDias(hoy, e.fechaLimite)
  if (quedan >= 0 && quedan <= 6) {
    return {
      ...base,
      id: `vence_esta_semana:${e.id}`,
      tipo: 'vence_esta_semana',
      gravedad: urgente || quedan <= 1 ? 'alta' : 'media',
      titulo: `${queHacer}: ${quedan === 0 ? 'vence hoy' : quedan === 1 ? 'vence mañana' : `vence el ${diaCorto(e.fechaLimite)}`}`,
      detalle: `${cifras}. Tiene que salir antes del ${diaCorto(e.salirAntesDe)}.${porque}${provisional}`,
      diasRestantes: quedan,
    }
  }
  // 4) esperando al cliente desde hace ≥ 3 días
  if (e.estado === 'esperando_cliente' && e.esperandoDesde) {
    const espera = diasEntreDias(e.esperandoDesde, hoy)
    if (espera >= 3) {
      return {
        ...base,
        id: `esperando_cliente:${e.id}`,
        tipo: 'esperando_cliente',
        gravedad: 'media',
        titulo: `Recuérdaselo a ${e.clienteNombre}: lleva ${plural(espera, 'día', 'días')} sin contestar`,
        detalle: `Esperando desde el ${diaCorto(e.esperandoDesde)}. Hay que decidir antes del ${diaCorto(e.fechaLimite)}. ${cifras}.${provisional}`,
        diasRestantes: quedan,
      }
    }
  }
  return null
}

function tareasDeRemesa(r: RemesaParaPendientes, c: ClienteParaPendientes | undefined, hoy: string, plazoReclamacion: number): TareaPendiente[] {
  const salida: TareaPendiente[] = []
  const base = {
    clienteId: r.clienteId,
    clienteNombre: r.clienteNombre,
    envioPropuestoId: r.envioPropuestoId ?? null,
    remesaId: r.id,
  }
  const irEnvio = { vista: 'cliente' as const, seccion: 'envios', params: { cliente: r.clienteId, remesa: r.id } }
  const irPropuesta = { vista: 'cliente' as const, seccion: 'propuestas', params: { cliente: r.clienteId, remesa: r.id } }
  const amz = (r.estadoAmazon ?? '').toUpperCase()

  /* --- envíos ya enviados --- */
  if (r.estado === 'enviada' || r.estado === 'cerrada') {
    // cerrado con faltantes (D18): recibidas < 95 % o faltan ≥ 5, dentro del plazo de reclamación
    if (amz === 'CLOSED' && r.enviadas > 0 && r.recibidas != null) {
      const faltan = r.enviadas - r.recibidas
      if (faltan > 0 && (r.recibidas < 0.95 * r.enviadas || faltan >= 5)) {
        const cierre = r.estadoAmazonDesde ?? r.actualizadaAt
        const desdeCierre = cierre ? Math.max(0, diasEntreDias(cierre, hoy)) : null
        const restantes = desdeCierre != null ? plazoReclamacion - desdeCierre : null
        if (restantes == null || restantes >= 0) {
          let euros: number | null = null
          if (r.lineas?.length) {
            const v = r.lineas.reduce((s, l) => {
              const f = Math.max(0, l.unidades - (l.recibidas ?? 0))
              return s + (l.precio != null ? f * l.precio : 0)
            }, 0)
            euros = v > 0 ? Math.round(v) : null
          }
          const moneda = r.moneda ?? c?.moneda ?? 'EUR'
          const pct = Math.round((r.recibidas / r.enviadas) * 100)
          salida.push({
            ...base,
            id: `cerrado_con_faltantes:${r.id}`,
            tipo: 'cerrado_con_faltantes',
            gravedad: (restantes != null && restantes <= 10) || faltan >= 20 || (euros ?? 0) >= 200 ? 'alta' : 'media',
            titulo: `Reclama a Amazon ${ud(faltan)} de ${nombreRemesa(r)}`,
            detalle:
              `Amazon lo cerró con ${miles(r.recibidas)} de ${ud(r.enviadas)} recibidas (${pct} %)` +
              (euros != null ? `: unos ${dinero(euros, moneda)} a precio actual` : '') +
              (desdeCierre != null ? `. Cerrado hace ${plural(desdeCierre, 'día', 'días')}` : '') +
              (restantes != null ? `; te quedan ${plural(restantes, 'día', 'días')} para reclamar (plazo de ${plazoReclamacion}).` : '. Comprueba la fecha de cierre en Seller Central.') +
              (r.estado === 'enviada' ? ' Después, ciérralo en el ERP.' : ''),
            euros,
            moneda: euros != null ? moneda : null,
            diasRestantes: restantes,
            ir: irEnvio,
          })
          return salida
        }
      }
    }
    // cerrar envío: Amazon lo cerró hace ≥ 7 días y en el ERP sigue «enviada»
    if (r.estado === 'enviada' && amz === 'CLOSED') {
      const cierre = r.estadoAmazonDesde ?? r.actualizadaAt
      const desde = cierre ? diasEntreDias(cierre, hoy) : null
      if (desde == null || desde >= 7) {
        salida.push({
          ...base,
          id: `cerrar_envio:${r.id}`,
          tipo: 'cerrar_envio',
          gravedad: 'baja',
          titulo: `Cierra ${nombreRemesa(r)} en el ERP`,
          detalle: `Amazon lo cerró${desde != null ? ` hace ${plural(desde, 'día', 'días')}` : ''} y aquí sigue como enviado, así que cuenta como «de camino».`,
          euros: null,
          moneda: null,
          diasRestantes: null,
          ir: irEnvio,
        })
      }
      return salida
    }
    // envío dudoso (D3): SHIPPED o IN_TRANSIT sin nada recibido desde hace demasiado
    if (r.estado === 'enviada' && (amz === 'SHIPPED' || amz === 'IN_TRANSIT') && r.fechaEnvio) {
      const edad = diasEntreDias(r.fechaEnvio, hoy)
      const t = c?.transporteMediano ?? null
      if (dudoso(edad, r.recibidas, t)) {
        salida.push({
          ...base,
          id: `envio_dudoso:${r.id}`,
          tipo: 'envio_dudoso',
          gravedad: 'alta',
          titulo: `Pregunta a Amazon por ${nombreRemesa(r)}`,
          detalle:
            `Lleva ${plural(edad, 'día', 'días')} en ${amz} con 0 de ${ud(r.enviadas)} recibidas` +
            (t != null ? ` (lo normal son ${t} días de transporte)` : '') +
            '. El plan no lo cuenta como stock que llega: confirma que salió y, si se ha perdido, reclámalo.',
          euros: null,
          moneda: null,
          diasRestantes: null,
          ir: irEnvio,
        })
      }
    }
    return salida
  }

  /* --- remesas todavía en el ERP --- */
  const parada = r.actualizadaAt ? Math.max(0, diasEntreDias(r.actualizadaAt, hoy)) : null
  const columna = columnaDe({ estado: r.estado, propuestaEnviadaAt: r.propuestaEnviadaAt, clienteAceptoAt: r.clienteAceptoAt })
  if (columna === 'revision') {
    salida.push({
      ...base,
      id: `acepto_sin_revisar:${r.id}`,
      tipo: 'acepto_sin_revisar',
      gravedad: parada != null && parada >= 2 ? 'alta' : 'media',
      titulo: `Revisa y aprueba la propuesta que aceptó ${r.clienteNombre}`,
      detalle: `${r.nombre || 'La propuesta'}: ${ud(r.enviadas)}, aceptada${r.clienteAceptoAt ? ` el ${diaCorto(r.clienteAceptoAt)}` : ''}. Hasta que la apruebes no puede imprimir etiquetas.`,
      euros: null,
      moneda: null,
      diasRestantes: null,
      ir: irPropuesta,
    })
    return salida
  }
  if (parada != null && (r.estado === 'aprobada' || r.estado === 'encajando' || r.estado === 'lista') && parada >= 7) {
    const que = r.estado === 'lista'
      ? 'Las cajas están cerradas: crea el envío en Amazon o pregunta qué falta.'
      : r.estado === 'encajando'
        ? 'El cliente no termina de encajar: pregúntale qué le falta.'
        : 'El cliente no ha empezado a etiquetar: pregúntale si necesita algo.'
    salida.push({
      ...base,
      id: `remesa_parada:${r.id}`,
      tipo: 'remesa_parada',
      gravedad: parada >= 14 ? 'alta' : 'media',
      titulo: `Desatasca ${r.nombre || 'la remesa'} de ${r.clienteNombre}`,
      detalle: `Lleva ${plural(parada, 'día', 'días')} en «${r.estado}» sin moverse (${ud(r.enviadas)}). ${que}`,
      euros: null,
      moneda: null,
      diasRestantes: null,
      ir: irPropuesta,
    })
  } else if (parada != null && r.estado === 'borrador' && parada >= 21) {
    salida.push({
      ...base,
      id: `remesa_parada:${r.id}`,
      tipo: 'remesa_parada',
      gravedad: 'baja',
      titulo: `Decide qué hacer con ${r.nombre || 'el borrador'} de ${r.clienteNombre}`,
      detalle: `Es un borrador parado desde hace ${plural(parada, 'día', 'días')} (${ud(r.enviadas)}): el plan ya no lo cuenta como comprometido. Sigue con él o bórralo.`,
      euros: null,
      moneda: null,
      diasRestantes: null,
      ir: irPropuesta,
    })
  }
  return salida
}

function tareasDeCliente(c: ClienteParaPendientes): TareaPendiente[] {
  const salida: TareaPendiente[] = []
  const base = { clienteId: c.clienteId, clienteNombre: c.clienteNombre, envioPropuestoId: null, remesaId: null }
  const lineas = c.lineas ?? []
  const provisional = !!c.calidad?.provisional

  /* --- entrante sin remesa (D2) --- */
  const entrantes = lineas.filter((l) => (l.entranteSinRemesa ?? 0) >= 5).sort((a, b) => b.entranteSinRemesa - a.entranteSinRemesa)
  if (entrantes.length) {
    const total = entrantes.reduce((s, l) => s + l.entranteSinRemesa, 0)
    const lista = entrantes.slice(0, 3).map((l) => `${l.sku} (${ud(l.entranteSinRemesa)})`).join(', ') + (entrantes.length > 3 ? ` y ${entrantes.length - 3} más` : '')
    salida.push({
      ...base,
      id: `entrante_sin_remesa:${c.clienteId}`,
      tipo: 'entrante_sin_remesa',
      gravedad: total >= 100 ? 'alta' : 'media',
      titulo: `Importa los envíos de ${c.clienteNombre} que no están en el ERP`,
      detalle: entrantes.length === 1
        ? `Amazon tiene ${ud(entrantes[0].entranteSinRemesa)} entrantes de ${entrantes[0].sku} que no están en ninguna remesa. El plan ya las cuenta como de camino; impórtalo para seguirlo y para el FIFO.`
        : `Amazon tiene ${ud(total)} entrantes de ${entrantes.length} referencias que no están en ninguna remesa: ${lista}. El plan ya las cuenta como de camino; impórtalos para seguirlos y para el FIFO.`,
      euros: null,
      moneda: null,
      diasRestantes: null,
      ir: { vista: 'cliente', seccion: 'envios', params: { cliente: c.clienteId, importar: '1' } },
    })
  }

  /* --- modelo agotado en todas sus tallas (D6) --- */
  const porModelo = new Map<string, LineaPlan[]>()
  for (const l of lineas) {
    if (!l.modelo || l.fuera === 'descatalogada') continue
    const g = porModelo.get(l.modelo) ?? []
    g.push(l)
    porModelo.set(l.modelo, g)
  }
  const modelosAgotados: Array<{ modelo: string; tallas: number; ventas90: number; ritmo: number; euros: number | null; llega: { unidades: number } | null }> = []
  for (const [modelo, tallas] of porModelo) {
    if (tallas.length < 2) continue
    if (!tallas.every((l) => l.vendibles <= 0)) continue
    if (tallas.every((l) => l.fuera === 'agotado_largo')) continue // eso va en «¿se repone?»
    const ventas90 = tallas.reduce((s, l) => s + (l.ritmo?.ventas90 ?? 0), 0)
    if (ventas90 < 3) continue
    const ritmo = tallas.reduce((s, l) => s + (l.ritmo?.base ?? 0), 0)
    const eurosT = tallas.reduce((s, l) => s + (l.eurosEnRiesgo ?? 0), 0)
    const viene = tallas.reduce((s, l) => s + (l.deCamino ?? 0) + (l.comprometido ?? 0), 0)
    modelosAgotados.push({ modelo, tallas: tallas.length, ventas90, ritmo, euros: eurosT > 0 ? Math.round(eurosT) : null, llega: viene > 0 ? { unidades: viene } : null })
  }
  for (const m of modelosAgotados) {
    salida.push({
      ...base,
      id: `modelo_agotado:${c.clienteId}:${m.modelo}`,
      tipo: 'modelo_agotado',
      gravedad: m.llega ? 'media' : 'alta',
      titulo: `Repón el modelo ${m.modelo} de ${c.clienteNombre}: agotado en sus ${m.tallas} tallas`,
      detalle:
        `0 ud en FBA en todas las tallas; vendió ${ud(m.ventas90)} en 90 días${m.ritmo > 0 ? ` (${ritmoTexto(m.ritmo)})` : ''}. ` +
        (m.llega ? `Vienen ${ud(m.llega.unidades)} de camino o en preparación. ` : 'No viene nada de camino. ') +
        'Sin ninguna talla a la venta, la ficha pierde posicionamiento.',
      euros: m.euros,
      moneda: m.euros != null ? c.moneda : null,
      diasRestantes: null,
      ir: { vista: 'cliente', seccion: 'reposicion', params: { cliente: c.clienteId, modelo: m.modelo } },
    })
  }

  /* --- agotados largos: ¿se repone? (D8) — se avisan aunque el plan sea provisional --- */
  const largos = lineas.filter((l) => l.fuera === 'agotado_largo')
  if (largos.length) {
    const potencial = largos.reduce((s, l) => s + (l.precio != null && l.ritmo?.base ? l.precio * l.ritmo.base * 30 : 0), 0)
    const top = [...largos]
      .sort((a, b) => (b.ritmo?.base ?? 0) - (a.ritmo?.base ?? 0))
      .slice(0, 3)
      .map((l) => `${l.sku}${l.ritmo?.base ? ` vendía ${ritmoTexto(l.ritmo.base)}` : ''}${l.ritmo?.ultimoPeriodoHasta ? ` hasta el ${diaCorto(l.ritmo.ultimoPeriodoHasta)}` : ''}`)
      .join('; ')
    salida.push({
      ...base,
      id: `agotado_se_repone:${c.clienteId}`,
      tipo: 'agotado_se_repone',
      gravedad: potencial >= 300 ? 'media' : 'baja',
      titulo: `Pregunta a ${c.clienteNombre} si repone ${plural(largos.length, 'referencia agotada', 'referencias agotadas')} desde hace meses`,
      detalle:
        `${top}${largos.length > 3 ? ` y ${largos.length - 3} más` : ''}.` +
        (potencial > 0 ? ` Juntas venderían unos ${dinero(potencial, c.moneda)} al mes.` : '') +
        ' El plan no las propone solas: si no las repone, descártalas como «descatalogada» y dejarán de salir.',
      euros: potencial > 0 ? Math.round(potencial) : null,
      moneda: potencial > 0 ? c.moneda : null,
      diasRestantes: null,
      ir: { vista: 'cliente', seccion: 'reposicion', params: { cliente: c.clienteId, grupo: 'agotados' } },
    })
  }

  /* --- merma alta (D12) --- */
  const merma = c.calidad?.pctMerma90
  if (merma != null && merma > 5) {
    salida.push({
      ...base,
      id: `merma_alta:${c.clienteId}`,
      tipo: 'merma_alta',
      gravedad: merma > 10 ? 'alta' : 'media',
      titulo: `Revisa el embalaje de ${c.clienteNombre} y reclama los daños`,
      detalle: `${c.clienteNombre} pierde el ${merma.toLocaleString('es-ES', { maximumFractionDigits: 1 })} % de lo vendido en daños y retiradas (90 días). Lo normal es menos del 5 %.${provisional ? ' Cifra con ventas no al día.' : ''}`,
      euros: null,
      moneda: null,
      diasRestantes: null,
      ir: { vista: 'cliente', seccion: 'lotes', params: { cliente: c.clienteId } },
    })
  }

  /* --- calidad de datos: una tarea por cliente con todo lo que falla --- */
  const q = c.calidad
  if (q) {
    const motivos: string[] = []
    let gravedad: TareaPendiente['gravedad'] = 'baja'
    let titulo = ''
    if (q.sinConexion) {
      motivos.push('no tiene la API de Amazon conectada: las ventas no se descuentan solas')
      gravedad = 'media'
      titulo = `Conecta la cuenta de Amazon de ${c.clienteNombre}`
    }
    if (q.libro === 'sin_leer') {
      motivos.push('no hay ventas leídas: no se puede planificar')
      gravedad = 'alta'
      titulo ||= `Lee las ventas de ${c.clienteNombre}`
    } else if (q.diasAtraso != null && q.diasAtraso > 3) {
      motivos.push(`las ventas están leídas hasta el ${diaCorto(q.leidoHasta)} (${plural(q.diasAtraso, 'día', 'días')} de atraso)${q.diasAtraso > 7 ? ': el plan sale provisional y no avisa' : ''}`)
      gravedad = q.diasAtraso > 7 ? 'alta' : gravedad === 'baja' ? 'media' : gravedad
      titulo ||= `Pon al día las ventas de ${c.clienteNombre}`
    }
    if (q.ultimoError) {
      motivos.push(`la última lectura falló: ${q.ultimoError.slice(0, 140)}`)
      if (gravedad === 'baja') gravedad = 'media'
      titulo ||= `Revisa la lectura de Amazon de ${c.clienteNombre}`
    }
    if (q.plazoDePartida) {
      motivos.push('el plazo de reposición es el de partida, sin confirmar')
      titulo ||= `Confirma los plazos de ${c.clienteNombre}`
    }
    if (motivos.length) {
      const frase = motivos.join('; ')
      salida.push({
        ...base,
        id: `calidad_datos:${c.clienteId}`,
        tipo: 'calidad_datos',
        gravedad,
        titulo,
        detalle: frase.charAt(0).toUpperCase() + frase.slice(1) + '.',
        euros: null,
        moneda: null,
        diasRestantes: null,
        ir: { vista: 'cliente', seccion: 'resumen', params: { cliente: c.clienteId } },
      })
    }
  }
  return salida
}

/** Orden de los tipos dentro de la misma gravedad y sin € (el de §4.3 y D18) */
const ORDEN_TIPO: Record<TipoPendiente, number> = {
  envio_vencido: 0,
  sin_responsable: 1,
  vence_esta_semana: 2,
  esperando_cliente: 3,
  remesa_parada: 4,
  acepto_sin_revisar: 5,
  cerrar_envio: 6,
  cerrado_con_faltantes: 7,
  envio_dudoso: 8,
  entrante_sin_remesa: 9,
  modelo_agotado: 10,
  agotado_se_repone: 11,
  merma_alta: 12,
  calidad_datos: 13,
}

/**
 * Todo lo que hay que hacer, ordenado por gravedad y, dentro, por € en juego (sin € al final), por la cuenta
 * atrás más corta y por el orden de §4.3. Un envío propuesto da como mucho una tarea (la más grave).
 */
export function pendientes(entrada: EntradaPendientes): TareaPendiente[] {
  const { hoy } = entrada
  const plazo = entrada.plazoReclamacionDias ?? PLAZO_RECLAMACION_DIAS
  const clientes = new Map(entrada.clientes.map((c) => [c.clienteId, c]))
  const tareas: TareaPendiente[] = []

  for (const e of entrada.envios) {
    const t = tareaDeEnvioPropuesto(e, hoy)
    if (t) tareas.push(t)
  }
  for (const r of entrada.remesas) tareas.push(...tareasDeRemesa(r, clientes.get(r.clienteId), hoy, plazo))
  for (const c of entrada.clientes) tareas.push(...tareasDeCliente(c))

  return tareas.sort((a, b) =>
    ORDEN_GRAVEDAD[a.gravedad] - ORDEN_GRAVEDAD[b.gravedad] ||
    (b.euros ?? -1) - (a.euros ?? -1) ||
    (a.diasRestantes ?? Infinity) - (b.diasRestantes ?? Infinity) ||
    ORDEN_TIPO[a.tipo] - ORDEN_TIPO[b.tipo] ||
    a.id.localeCompare(b.id),
  )
}

/* =============================================================================================
 * 3) Avisos (§4.4 + D24)
 * ============================================================================================= */

/** Adonde lleva un aviso de un envío propuesto: el plan con el panel abierto */
export function urlDeEnvioPropuesto(id: string, clienteId?: string): string {
  return `/dashboard/remesas?vista=plan&envio=${encodeURIComponent(id)}${clienteId ? `&cliente=${encodeURIComponent(clienteId)}` : ''}`
}

/** Los niveles que avisan en la campana, de más a menos grave */
export const PRIORIDADES_QUE_AVISAN: readonly Prioridad[] = ['tarde', 'urgente', 'esta_semana']

/** Lo que `avisosQueTocan` necesita de un envío: la fila guardada y lo ya avisado */
export type EnvioParaAvisar = Pick<
  EnvioPropuestoGuardado,
  'id' | 'clienteId' | 'clienteNombre' | 'estado' | 'prioridad' | 'provisional' | 'moneda' | 'salirAntesDe' | 'decidirAntesDe'
  | 'fechaLimite' | 'responsableId' | 'unidades' | 'eurosEnRiesgo' | 'porque' | 'lineas'
> & {
  /** `prioridad_avisada`: el nivel más grave ya avisado (null = nunca) */
  prioridadAvisada: Prioridad | null
  /** `vencido_avisado_at` */
  vencidoAvisadoAt: string | null
}

export interface ConfigAvisos {
  /** `fba_alertas_config.avisar` del cliente (false = sin campana) */
  avisar: boolean
  /** `fba_reposicion_config.avisar_chat` (lo usa el chat; aquí solo se acepta para pasar la misma config) */
  avisarChat?: boolean
}

export interface AvisoDePlan {
  clave: string
  destino: 'responsable' | 'grupo'
  titulo: string
  cuerpo: string
  url: string
}

/** Provisional solo avisa si lleva una referencia agotada que vende */
function puedeAvisarProvisional(e: Pick<EnvioPropuestoGuardado, 'provisional' | 'lineas'>): boolean {
  return !e.provisional || (e.lineas ?? []).some(esAgotadaConVentas)
}

function cifrasDeEnvio(e: Pick<EnvioPropuestoGuardado, 'unidades' | 'lineas' | 'eurosEnRiesgo' | 'moneda'>): string {
  const refs = e.lineas?.length ?? 0
  return [
    ud(e.unidades) + (refs ? ` de ${plural(refs, 'referencia', 'referencias')}` : ''),
    e.eurosEnRiesgo != null && e.eurosEnRiesgo > 0 ? `${dinero(e.eurosEnRiesgo, e.moneda)} en juego si no sale` : null,
  ].filter(Boolean).join(' · ')
}

const TEXTO_NIVEL: Record<Prioridad, string> = {
  tarde: 'ya va tarde',
  urgente: 'urgente',
  esta_semana: 'para esta semana',
  proximas_2: 'para las próximas 2 semanas',
  este_mes: 'para este mes',
  mas_adelante: 'para más adelante',
}

/**
 * Los avisos de campana que tocan HOY para un envío propuesto. Sin spam:
 * - por nivel (`fba_plan:<id>:<prioridad>`), solo si la prioridad es tarde/urgente/esta_semana y es MÁS grave
 *   que la ya avisada (aparecer o subir; quedarse igual o bajar no avisa);
 * - al vencer, una vez (`fba_plan_vencido:<id>`);
 * - nada si `avisar = false`, si ya no se está decidiendo, o si es provisional sin agotados.
 * Las claves son únicas en `notifications`: aunque se llame dos veces, la base no duplica.
 */
export function avisosQueTocan(envio: EnvioParaAvisar, hoy: string, config: ConfigAvisos): AvisoDePlan[] {
  if (!config.avisar) return []
  if (!DECIDIENDO.includes(envio.estado)) return []
  if (!puedeAvisarProvisional(envio)) return []
  const salida: AvisoDePlan[] = []
  const destino: AvisoDePlan['destino'] = envio.responsableId ? 'responsable' : 'grupo'
  const url = urlDeEnvioPropuesto(envio.id, envio.clienteId)
  const porque = envio.porque?.[0] ? ` ${envio.porque[0]}` : ''

  if (PRIORIDADES_QUE_AVISAN.includes(envio.prioridad)) {
    const sube = envio.prioridadAvisada == null || RANGO_PRIORIDAD[envio.prioridad] < RANGO_PRIORIDAD[envio.prioridadAvisada]
    if (sube) {
      salida.push({
        clave: `fba_plan:${envio.id}:${envio.prioridad}`,
        destino,
        titulo: envio.prioridad === 'tarde'
          ? `${envio.clienteNombre}: el envío ya va tarde`
          : `${envio.clienteNombre}: envío ${TEXTO_NIVEL[envio.prioridad]}`,
        cuerpo: envio.prioridad === 'tarde'
          ? `Habrá días sin stock aunque salga ya: que salga cuanto antes (antes del ${diaCorto(envio.salirAntesDe)}). ${cifrasDeEnvio(envio)}.${porque}`
          : `Decide antes del ${diaCorto(envio.fechaLimite)} para que salga antes del ${diaCorto(envio.salirAntesDe)}. ${cifrasDeEnvio(envio)}.${porque}`,
        url,
      })
    }
  }
  if (esVencido(envio, hoy) && !envio.vencidoAvisadoAt) {
    salida.push({
      clave: `fba_plan_vencido:${envio.id}`,
      destino,
      titulo: `${envio.clienteNombre}: el envío propuesto ha vencido`,
      cuerpo: `Había que decidirlo antes del ${diaCorto(envio.fechaLimite)} y sigue ${NOMBRE_ESTADO[envio.estado]}. Tiene que salir antes del ${diaCorto(envio.salirAntesDe)}. ${cifrasDeEnvio(envio)}.`,
      url,
    })
  }
  return salida
}

/** Mensaje inmediato al chat cuando un envío PASA a tarde (`fba_plan_tarde:<id>`); null si no toca */
export function avisoTardeChat(envio: EnvioParaAvisar, config: { avisarChat: boolean }): { clave: string; titulo: string; cuerpo: string } | null {
  if (!config.avisarChat || envio.prioridad !== 'tarde' || envio.prioridadAvisada === 'tarde') return null
  if (!DECIDIENDO.includes(envio.estado) || !puedeAvisarProvisional(envio)) return null
  return {
    clave: `fba_plan_tarde:${envio.id}`,
    titulo: `${envio.clienteNombre}: el envío ya va tarde`,
    cuerpo: `**${envio.clienteNombre}** · habrá días sin stock aunque salga ya · ${cifrasDeEnvio(envio)}.${envio.porque?.[0] ? ` ${envio.porque[0]}` : ''}\n${urlDeEnvioPropuesto(envio.id, envio.clienteId)}`,
  }
}

function semanaIso(dia: string): string {
  const d = new Date(aUtc(dia))
  const diaSemana = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - diaSemana)
  const inicio = Date.UTC(d.getUTCFullYear(), 0, 1)
  const semana = Math.ceil(((d.getTime() - inicio) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`
}

/** Mensaje semanal al chat si el libro va > 7 días atrasado (`fba_datos:<cliente>:<año-W>`); null si no toca */
export function avisoDatosChat(
  cliente: { clienteId: string; clienteNombre: string; avisarChat: boolean },
  calidad: Pick<CalidadDatos, 'diasAtraso' | 'leidoHasta'> | null,
  hoy: string,
): { clave: string; titulo: string; cuerpo: string } | null {
  if (!cliente.avisarChat || !calidad || calidad.diasAtraso == null || calidad.diasAtraso <= 7) return null
  return {
    clave: `fba_datos:${cliente.clienteId}:${semanaIso(hoy)}`,
    titulo: `El plan de ${cliente.clienteNombre} no es fiable`,
    cuerpo: `El plan de **${cliente.clienteNombre}** no es fiable: ventas leídas hasta el ${diaCorto(calidad.leidoHasta)} (${plural(calidad.diasAtraso, 'día', 'días')} de atraso). Pide a un administrador que lea las ventas.`,
  }
}

/** Máximo de envíos en el resumen diario del chat */
export const MAX_LINEAS_RESUMEN = 8

/**
 * Un resumen al día como mucho (`fba_plan_dia:<fecha>`), solo si hay envíos tarde, urgentes o vencidos de
 * clientes con `avisarChat`. Hasta 8 líneas (si hay más, la 8.ª dice «y N más»), los € sumados por moneda
 * sin convertir y el enlace al plan.
 */
export function resumenDiarioChat(
  envios: EnvioPropuestoGuardado[],
  clientes: Array<{ clienteId: string; avisarChat: boolean }>,
  hoy: string,
): { clave: string; titulo: string; cuerpo: string } | null {
  const conChat = new Set(clientes.filter((c) => c.avisarChat).map((c) => c.clienteId))
  const graves = envios
    .filter((e) => conChat.has(e.clienteId) && DECIDIENDO.includes(e.estado) && puedeAvisarProvisional(e))
    .map((e) => ({ e, vencido: esVencido(e, hoy) }))
    .filter(({ e, vencido }) => vencido || e.prioridad === 'tarde' || e.prioridad === 'urgente')
    .sort((a, b) =>
      RANGO_PRIORIDAD[a.e.prioridad] - RANGO_PRIORIDAD[b.e.prioridad] ||
      Number(b.vencido) - Number(a.vencido) ||
      (b.e.eurosEnRiesgo ?? -1) - (a.e.eurosEnRiesgo ?? -1) ||
      a.e.salirAntesDe.localeCompare(b.e.salirAntesDe),
    )
  if (!graves.length) return null

  const linea = ({ e, vencido }: { e: EnvioPropuestoGuardado; vencido: boolean }) =>
    `• **${e.clienteNombre}** · tiene que salir antes del **${diaCorto(e.salirAntesDe)}** · ${ud(e.unidades)}` +
    (e.eurosEnRiesgo != null && e.eurosEnRiesgo > 0 ? ` · ${dinero(e.eurosEnRiesgo, e.moneda)} en juego` : '') +
    (e.prioridad === 'tarde' ? ' · ya va tarde' : '') +
    (vencido ? ` · venció el ${diaCorto(e.fechaLimite)}` : '')
  const lineas = graves.length <= MAX_LINEAS_RESUMEN
    ? graves.map(linea)
    : [...graves.slice(0, MAX_LINEAS_RESUMEN - 1).map(linea), `• y ${plural(graves.length - (MAX_LINEAS_RESUMEN - 1), 'envío más', 'envíos más')}`]

  const porMoneda = new Map<string, number>()
  for (const { e } of graves) {
    if (e.eurosEnRiesgo != null && e.eurosEnRiesgo > 0) porMoneda.set(e.moneda || 'EUR', (porMoneda.get(e.moneda || 'EUR') ?? 0) + e.eurosEnRiesgo)
  }
  const total = [...porMoneda.entries()].sort((a, b) => b[1] - a[1]).map(([m, n]) => dinero(n, m)).join(' + ')
  const tarde = graves.filter((g) => g.e.prioridad === 'tarde').length
  const vencidos = graves.filter((g) => g.vencido).length

  return {
    clave: `fba_plan_dia:${hoy}`,
    titulo: `Remesas: ${plural(graves.length, 'envío que no puede esperar', 'envíos que no pueden esperar')}`,
    cuerpo: [
      `${plural(graves.length, 'envío', 'envíos')} por decidir${tarde ? ` (${tarde} ya ${tarde === 1 ? 'va' : 'van'} tarde)` : ''}${vencidos ? `, ${plural(vencidos, 'vencido', 'vencidos')}` : ''}${total ? `. En juego: ${total}` : ''}.`,
      ...lineas,
      '/dashboard/remesas?vista=plan',
    ].join('\n'),
  }
}

/** Fecha límite por defecto y aviso si se edita más tarde que `decidirAntesDe` (§4.1) */
export function avisoDeFechaLimite(fechaLimite: string, decidirAntesDe: string): string | null {
  return fechaLimite > decidirAntesDe ? 'Pasada esta fecha ya no llega antes de la rotura.' : null
}

/** Para la pantalla: días que faltan (negativo = vencido) */
export function diasHastaLimite(fechaLimite: string, hoy: string): number {
  return diasEntreDias(hoy, fechaLimite)
}
