import OpenAI from 'openai'
import { createServiceClient } from '@/lib/supabase/service'
import { modeloDeIa, parametrosDeIa } from '@/lib/ia/modelo'
import { costeDeUso } from '@/lib/ia/precios'
import { diaEnEspana } from './fechas'
import { ESQUEMA_PLAN_IA, construirMensajesPlan, hashDelPlan, leerRespuestaPlan, lineasParaIa, validarAjustesIa, type RecalcularAjuste } from './ia-plan'
import type { ClienteIa } from './ia-reposicion'
import { faltaLaTabla } from './planificacion'
import { planificarSku, recalcularConLlegada, sumarDias, type ContextoPlan } from './planificador'
import { ESTADOS_ACTIVOS, type EntradaSku, type LineaPlan, type LlegadaPrevista, type PlanCliente, type RespuestaPlanIa, type RevisionIa } from './plan-tipos'

/**
 * LA IA REVISA EL PLAN DE REPOSICIÓN — LA LLAMADA (spec remesas-pro §3, D31 y D33). SOLO SERVIDOR.
 * ================================================================================================
 * Lo puro (mensaje, esquema, lectura, validación de ajustes y huella) está en ia-plan.ts. Aquí: pedir a la IA, validar lo
 * que vuelve con la ARITMÉTICA (planificarSku / recalcularConLlegada), guardar la revisión y su coste en `fba_plan_ia`,
 * copiarla en los envíos propuestos activos del cliente y dar la pasada por revisada (`ia_pendiente = false`).
 *
 *
 * ============ NUNCA LANZA ============
 *
 * Igual que lib/fba/ia-reposicion.ts (y con su cliente inyectable para las pruebas): sin clave, con la IA caída, pasada de
 * tiempo o con una respuesta ilegible, la revisión vuelve con `aviso` («La revisión de la IA no ha llegado (motivo); el plan
 * es solo aritmética») y el plan sigue exactamente igual. Solo un fallo inesperado devuelve null.
 *
 *
 * ============ QUÉ IA (D33) ============
 *
 * La de siempre del ERP: `modeloDeIa()` (gpt-6-luna; `IA_MODELO` lo cambia) con `parametrosDeIa({ esfuerzo: 'low',
 * maxSalida: 6000 })`, y 30 s como mucho por llamada. Se pasan SIEMPRE por opciones: los valores por defecto de
 * ia-reposicion.ts (gpt-5.5, 120 s) son de la «Propuesta a medida» y no se tocan.
 *
 *
 * ============ LOS AJUSTES SE RECALCULAN CON LA ARITMÉTICA ============
 *
 * La pasada guarda las líneas (`LineaPlan`), no las entradas del planificador (`EntradaSku`). Para recalcular un ajuste se
 * reconstruye la entrada desde la línea (`entradaDesdeLinea`: stock, ritmo, caja, de camino y comprometido con una fecha de
 * llegada aproximada). Como la reconstrucción no es exacta, la cifra que se enseña es la de la línea MÁS la diferencia que
 * produce el ajuste en la reconstrucción (antes y después calculados igual): así la diferencia sí sale de la aritmética y la
 * cifra de partida es la del plan. Si la reconstrucción ni siquiera propone la línea, se estima con el ritmo (×factor o
 * ±días × ritmo). Los ajustes válidos NO se aplican solos: salen como sugerencia y al aplicarlos el servidor recalcula (S3).
 */

type Servicio = ReturnType<typeof createServiceClient>

/** Tiempo máximo de una llamada (D31/D33) */
export const TIEMPO_IA_PLAN_MS = 30_000
/** Revisiones a mano por cliente y día (§3) */
export const MAX_MANUALES_DIA = 2
export const TEXTO_TOPE_MANUAL = 'Ya se ha revisado 2 veces hoy'
/** Margen que se deja al presupuesto del cron antes de empezar otra llamada */
const MARGEN_PRESUPUESTO_MS = 2_000

/* ------------------------------------------------------------------ */
/* La llamada                                                          */
/* ------------------------------------------------------------------ */

export interface ResultadoLlamadaPlan {
  respuesta: RespuestaPlanIa | null
  modelo: string
  aviso: string | null
  tokens: { entrada: number; salida: number; cache: number } | null
}

/** Un error de la API, reducido a lo que se le puede contar a quien usa la pantalla (como ia-reposicion.ts) */
function motivoDe(error: unknown): string {
  const e = error as { status?: number; name?: string; code?: string; message?: string }
  if (e?.name === 'AbortError' || e?.name === 'APIConnectionTimeoutError' || /timed? ?out|timeout|abort/i.test(e?.message ?? '')) {
    return 'la IA ha tardado demasiado en contestar'
  }
  if (e?.status === 401) return 'la clave de la IA no es válida (OPENAI_API_KEY)'
  if (e?.status === 402 || e?.code === 'insufficient_quota') return 'la cuenta de la IA se ha quedado sin saldo'
  if (e?.status === 429) return 'la IA está saturada o ha llegado a su límite'
  if (typeof e?.status === 'number' && e.status >= 500) return 'la IA tiene un problema ahora mismo'
  return 'no se ha podido hablar con la IA'
}

/**
 * Pide la revisión. Nunca lanza. `modelo` y `tiempoMaximoMs` llegan siempre de fuera (D33); el resto de la petición sale de
 * `parametrosDeIa` (esfuerzo bajo, 6.000 tokens de salida).
 */
export async function pedirRevisionPlanIa(
  mensajes: { system: string; usuario: string },
  opciones: { modelo: string; tiempoMaximoMs: number; cliente?: ClienteIa; clavesValidas?: Iterable<string> },
): Promise<ResultadoLlamadaPlan> {
  const parametros = { ...parametrosDeIa({ esfuerzo: 'low', maxSalida: 6000 }), model: opciones.modelo }
  const modelo = opciones.modelo
  const sinRespuesta = (aviso: string, tokens: ResultadoLlamadaPlan['tokens'] = null): ResultadoLlamadaPlan => ({ respuesta: null, modelo, aviso, tokens })

  let cliente = opciones.cliente
  if (!cliente) {
    const clave = process.env.OPENAI_API_KEY?.trim()
    if (!clave) return sinRespuesta('la IA no está configurada en el servidor (falta OPENAI_API_KEY)')
    cliente = new OpenAI({ apiKey: clave, maxRetries: 1 }) as unknown as ClienteIa
  }

  const control = new AbortController()
  const temporizador = setTimeout(() => control.abort(), opciones.tiempoMaximoMs)
  try {
    const completion = await cliente.chat.completions.create(
      {
        ...parametros,
        response_format: { type: 'json_schema', json_schema: { name: 'revision_del_plan', strict: true, schema: ESQUEMA_PLAN_IA } },
        messages: [
          { role: 'system', content: mensajes.system },
          { role: 'user', content: mensajes.usuario },
        ],
      },
      { signal: control.signal },
    )
    const uso = completion.usage as { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | undefined
    const tokens = uso ? { entrada: uso.prompt_tokens ?? 0, salida: uso.completion_tokens ?? 0, cache: uso.prompt_tokens_details?.cached_tokens ?? 0 } : null
    const modeloReal = completion.model ?? modelo
    const eleccion = completion.choices?.[0]
    if (eleccion?.message?.refusal) return { ...sinRespuesta('la IA se ha negado a contestar', tokens), modelo: modeloReal }

    const respuesta = leerRespuestaPlan(eleccion?.message?.content, opciones.clavesValidas)
    if (!respuesta) {
      return {
        ...sinRespuesta(eleccion?.finish_reason === 'length' ? 'la respuesta de la IA era demasiado larga y se ha cortado' : 'la IA ha devuelto algo que no se entiende', tokens),
        modelo: modeloReal,
      }
    }
    return { respuesta, modelo: modeloReal, aviso: null, tokens }
  } catch (error) {
    // Del error solo sale una frase: la clave y el cuerpo de la petición no se cuentan a nadie
    return sinRespuesta(motivoDe(error))
  } finally {
    clearTimeout(temporizador)
  }
}

/** La frase que ve la pantalla cuando la IA no contesta */
export const avisoSinRevision = (motivo: string): string => `La revisión de la IA no ha llegado (${motivo}); el plan es solo aritmética.`

/* ------------------------------------------------------------------ */
/* Recalcular un ajuste con la aritmética (puro)                       */
/* ------------------------------------------------------------------ */

const maxFecha = (a: string, b: string) => (a > b ? a : b)

/**
 * La entrada del planificador reconstruida desde una línea guardada. Lo que la línea no guarda se aproxima con prudencia:
 *   · de camino del ERP: llega con el primer envío en camino del cliente que no es dudoso (o hoy + recepción);
 *   · entrante de Amazon sin remesa: hoy + transporte + recepción (D2);
 *   · comprometido: hoy + preparación + transporte + recepción;
 *   · lo dudoso va como llegada descartada (no cuenta, D3).
 * Las marcas de exclusión salen de `fuera` y de los avisos. El stock viejo no se repite (la línea ya trae la confianza bajada).
 */
export function entradaDesdeLinea(l: LineaPlan, plan: Pick<PlanCliente, 'hoy' | 'plazo' | 'enCamino' | 'calidad'>): EntradaSku {
  const H = plan.hoy
  const { preparacion, transporte, recepcion } = plan.plazo
  const llegadas: LlegadaPrevista[] = []
  const llegada = (fecha: string, unidades: number, origen: LlegadaPrevista['origen']): LlegadaPrevista => ({
    fecha, unidades, origen, remesaId: null, envioPropuestoId: null, nombre: null, dudoso: false, fechaEnvio: null,
  })
  const caminoErp = Math.max(0, l.deCamino - l.entranteSinRemesa)
  if (caminoErp > 0) {
    const proxima = (plan.enCamino ?? [])
      .filter((c) => !c.dudoso && c.llegadaPrevista)
      .map((c) => maxFecha(c.llegadaPrevista as string, H))
      .sort()[0]
    llegadas.push(llegada(proxima ?? sumarDias(H, recepcion), caminoErp, 'camino'))
  }
  if (l.entranteSinRemesa > 0) llegadas.push(llegada(sumarDias(H, transporte + recepcion), l.entranteSinRemesa, 'amazon_sin_remesa'))
  if (l.comprometido > 0) llegadas.push(llegada(sumarDias(H, preparacion + transporte + recepcion), l.comprometido, 'comprometido'))

  return {
    sku: l.sku, asin: l.asin, fnsku: l.fnsku, nombre: l.nombre,
    modelo: l.modelo, talla: l.talla, precio: l.precio, moneda: l.moneda,
    vendibles: l.vendibles, reservadas: l.reservadas, entranteAmazon: l.entranteSinRemesa,
    llegadas,
    llegadasDescartadas: l.dudoso > 0 ? [{ unidades: l.dudoso, motivo: 'dudoso', nombre: null, desde: null }] : [],
    ritmo: l.ritmo,
    comprable: l.fuera !== 'no_comprable',
    descatalogada: l.fuera === 'descatalogada',
    excluida: null,
    cajaSku: l.caja?.origen === 'sku' ? l.caja.unidades : null,
    cajaDeducida: l.caja?.origen === 'deducida' ? l.caja.unidades : null,
    coberturaSku: null,
    diasSinVenta: null,
    pctMasDe180: l.avisos.includes('antiguo') ? 0.3 : null,
    tasaDevolucion90: l.avisos.includes('devoluciones_altas') ? 0.26 : null,
    ventas90: l.ritmo.ventas90,
    enCuarentena: null,
    provisional: plan.calidad.provisional,
    stockViejoDias: null,
    almacenCliente: null,
  }
}

const esPropuesta = (l: LineaPlan) => l.fuera === null && l.cantidad > 0
const ritmoDe = (l: LineaPlan) => Math.max(0, l.ritmo.consumoNeto ?? l.ritmo.previsto ?? l.ritmo.base ?? 0)

/**
 * El recálculo que se inyecta a `validarAjustesIa`. La línea propuesta se recalcula a su salida (`recalcularConLlegada`), igual
 * antes y después del ajuste, y se devuelve la línea guardada con la diferencia aplicada. Una línea que no se propone se
 * recalcula con `planificarSku` sin forzar llegada (así un «aún no toca» sigue fuera y el ajuste se rechaza).
 */
export function recalculadorDelPlan(plan: Pick<PlanCliente, 'hoy' | 'plazo' | 'ajustes' | 'medidas' | 'enCamino' | 'calidad'>): RecalcularAjuste {
  const ctx: ContextoPlan = { hoy: plan.hoy, plazo: plan.plazo, ajustes: plan.ajustes, medidas: plan.medidas }
  return (linea, cambio) => {
    const e = entradaDesdeLinea(linea, plan)
    const factorActual = linea.ajusteIa?.tipo === 'factor_ritmo' && linea.ajusteIa.valor ? linea.ajusteIa.valor : 1
    const propuesta = esPropuesta(linea)
    const conFactor = (f: number): LineaPlan =>
      f === 1 ? { ...linea, ajusteIa: null } : { ...linea, ajusteIa: { tipo: 'factor_ritmo', valor: f, motivo: '' } }

    let antes: LineaPlan
    let despues: LineaPlan
    if (cambio.tipo === 'factor_ritmo') {
      const f = factorActual * cambio.factor
      if (propuesta && linea.salirAntesDe) {
        antes = recalcularConLlegada(conFactor(factorActual), e, linea.salirAntesDe, ctx)
        despues = recalcularConLlegada(conFactor(f), e, linea.salirAntesDe, ctx)
      } else {
        antes = planificarSku(e, ctx.hoy, ctx.plazo, ctx.ajustes, ctx.medidas, { factorIa: factorActual })
        despues = planificarSku(e, ctx.hoy, ctx.plazo, ctx.ajustes, ctx.medidas, { factorIa: f })
      }
    } else {
      if (!linea.salirAntesDe) return null
      const base = conFactor(factorActual)
      antes = propuesta ? recalcularConLlegada(base, e, linea.salirAntesDe, ctx) : planificarSku(e, ctx.hoy, ctx.plazo, ctx.ajustes, ctx.medidas, { factorIa: factorActual })
      despues = recalcularConLlegada(base, e, cambio.nuevaSalida, ctx)
      if (!propuesta && despues.fuera === null) {
        // Mover algo que no se propone no lo mete en el envío: eso es «adelantar», y lo decide agruparEnvios
        return { ...despues, fuera: linea.fuera, cantidad: 0 }
      }
    }

    if (!propuesta) return despues
    if (despues.fuera !== null) return despues

    // La línea guardada más la diferencia del ajuste (antes y después calculados igual)
    if (antes.fuera === null && antes.cantidad > 0) {
      const cantidad = Math.max(0, Math.round(linea.cantidad + (despues.cantidad - antes.cantidad)))
      const tope = Math.max(0, Math.round((linea.tope + (despues.tope - antes.tope)) * 10) / 10)
      return { ...despues, cantidad, tope, fuera: cantidad > 0 ? null : 'stock_de_sobra' }
    }

    // La reconstrucción no propone la línea: estimación con el ritmo
    const d = ritmoDe(linea)
    const delta = cambio.tipo === 'factor_ritmo'
      ? (cambio.factor - 1) * d * factorActual * (linea.coberturaEfectiva + ctx.plazo.margen)
      : cambio.dias * d
    const cantidad = Math.max(0, Math.round(linea.cantidad + delta))
    const tope = Math.max(0, Math.round((linea.tope + (cambio.tipo === 'factor_ritmo' ? (cambio.factor - 1) * linea.tope : delta)) * 10) / 10)
    return {
      ...linea,
      cantidad, tope, fuera: cantidad > 0 ? null : 'stock_de_sobra',
      salirAntesDe: cambio.tipo === 'mover_envio' ? cambio.nuevaSalida : linea.salirAntesDe,
      decidirAntesDe: cambio.tipo === 'mover_envio' && linea.decidirAntesDe ? sumarDias(linea.decidirAntesDe, cambio.dias) : linea.decidirAntesDe,
    }
  }
}

/**
 * Las líneas que se validan: las del plan, sustituidas por la versión que va dentro de cada envío propuesto (agruparEnvios
 * las recalcula a la salida del envío y esas son las cifras que ve el equipo).
 */
export function lineasParaValidar(plan: Pick<PlanCliente, 'lineas' | 'envios'>): LineaPlan[] {
  const delEnvio = new Map<string, LineaPlan>()
  for (const v of plan.envios) for (const l of v.lineas) if (!delEnvio.has(l.sku)) delEnvio.set(l.sku, l)
  const vistas = new Set<string>()
  const salida: LineaPlan[] = []
  for (const l of plan.lineas) {
    vistas.add(l.sku)
    salida.push(delEnvio.get(l.sku) ?? l)
  }
  for (const [sku, l] of delEnvio) if (!vistas.has(sku)) salida.push(l)
  return salida
}

/** La revisión a partir de lo que contestó la IA (o del aviso si no contestó). Puro */
export function construirRevision(
  plan: PlanCliente,
  llamada: ResultadoLlamadaPlan,
  creadoAt: string,
  recalcular: RecalcularAjuste = recalculadorDelPlan(plan),
): RevisionIa {
  const costeUsd = llamada.tokens ? costeDeUso(llamada.modelo, llamada.tokens) : null
  if (!llamada.respuesta) {
    return {
      resumen: '', avisos: [], orden: [], ajustesValidos: [], ajustesRechazados: [], mensajeCliente: '', mensajeEquipo: '',
      modelo: llamada.modelo, costeUsd, aviso: avisoSinRevision(llamada.aviso ?? 'motivo desconocido'), creadoAt,
    }
  }
  const r = llamada.respuesta
  const { validos, rechazados } = validarAjustesIa(r.ajustes, lineasParaValidar(plan), plan.hoy, recalcular, { minLinea: plan.ajustes.minLinea })
  return {
    resumen: r.resumen, avisos: r.avisos, orden: r.orden,
    ajustesValidos: validos, ajustesRechazados: rechazados,
    mensajeCliente: r.mensajeCliente, mensajeEquipo: r.mensajeEquipo,
    modelo: llamada.modelo, costeUsd, aviso: null, creadoAt,
  }
}

/* ------------------------------------------------------------------ */
/* Lecturas auxiliares                                                 */
/* ------------------------------------------------------------------ */

async function nombreDelCliente(service: Servicio, clienteId: string): Promise<string> {
  const { data } = await service.from('amazon_clients').select('name').eq('id', clienteId).maybeSingle()
  return (data as { name: string } | null)?.name ?? 'Cliente'
}

/** La recomendación de Amazon (fba_planificacion) de las líneas que viajan: solo contraste. Sin la 231 o con error, nada */
async function recomendacionesDeAmazon(service: Servicio, plan: PlanCliente): Promise<Map<string, { accion: string | null; diasSuministro: number | null }> | null> {
  if (!plan.connectionId || !plan.calidad.mercado) return null
  const skus = lineasParaIa(plan.lineas).lineas.map((l) => l.sku)
  if (skus.length === 0) return null
  try {
    const { data, error } = await service
      .from('fba_planificacion')
      .select('sku, accion, dias_suministro')
      .eq('connection_id', plan.connectionId)
      .eq('marketplace_id', plan.calidad.mercado)
      .in('sku', skus)
    if (error) return null
    const mapa = new Map<string, { accion: string | null; diasSuministro: number | null }>()
    for (const f of (data ?? []) as Array<{ sku: string; accion: string | null; dias_suministro: number | string | null }>) {
      const dias = f.dias_suministro === null || f.dias_suministro === undefined ? null : Number(f.dias_suministro)
      mapa.set(f.sku, { accion: f.accion, diasSuministro: dias !== null && Number.isFinite(dias) ? dias : null })
    }
    return mapa
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Revisar un plan                                                     */
/* ------------------------------------------------------------------ */

export interface OpcionesRevision {
  service?: Servicio
  /** 30 s por defecto (D31) */
  timeoutMs?: number
  /** Para las pruebas: el cliente de OpenAI */
  clienteIa?: ClienteIa
  clienteNombre?: string
  ahora?: Date
}

/**
 * Revisa el plan de un cliente con la IA y lo guarda. NUNCA LANZA.
 *   · Llama con `modeloDeIa()` y 30 s (D33).
 *   · Valida los ajustes con la aritmética (`validarAjustesIa` + `recalculadorDelPlan`).
 *   · Guarda en `fba_plan_ia` modelo, tokens, coste (`costeDeUso`), respuesta, válidos, rechazados y aviso.
 *   · Si la IA contestó, copia la revisión en `fba_envios_propuestos.ia` de los envíos ACTIVOS del cliente (si no, deja la de antes).
 *   · Pone `ia_pendiente = false` en la pasada (también si falló: el intento queda en fba_plan_ia y se reintenta cuando el plan
 *     cambie o a mano; reintentar cada 15 min un fallo de clave o de saldo no arregla nada).
 * Devuelve la revisión (con `aviso` si la IA no llegó) o null si algo inesperado lo impidió.
 */
export async function revisarPlanConIa(
  clienteId: string,
  plan: PlanCliente,
  pasadaId: string | null,
  origen: 'cron' | 'manual',
  pedidoPor?: string,
  opciones: OpcionesRevision = {},
): Promise<RevisionIa | null> {
  try {
    const service = opciones.service ?? createServiceClient()
    const creadoAt = (opciones.ahora ?? new Date()).toISOString()
    const [clienteNombre, amazon] = await Promise.all([
      opciones.clienteNombre ? Promise.resolve(opciones.clienteNombre) : nombreDelCliente(service, clienteId),
      recomendacionesDeAmazon(service, plan),
    ])

    const mensajes = construirMensajesPlan({ plan, clienteNombre, amazon })
    const llamada = await pedirRevisionPlanIa(mensajes, {
      modelo: modeloDeIa(),
      tiempoMaximoMs: opciones.timeoutMs ?? TIEMPO_IA_PLAN_MS,
      cliente: opciones.clienteIa,
      clavesValidas: plan.envios.map((v) => v.clave),
    })

    let revision: RevisionIa
    try {
      revision = construirRevision(plan, llamada, creadoAt)
    } catch (error) {
      // Una validación que se rompe no tumba la revisión: los ajustes se descartan, lo demás se enseña
      console.error('[fba/ia-plan] validar ajustes', error)
      revision = construirRevision(plan, { ...llamada, respuesta: llamada.respuesta ? { ...llamada.respuesta, ajustes: [] } : null }, creadoAt, () => null)
    }

    await guardarRevision(service, { clienteId, pasadaId, origen, pedidoPor: pedidoPor ?? null, plan, llamada, revision })
    return revision
  } catch (error) {
    console.error('[fba/ia-plan] revisar plan', error)
    return null
  }
}

async function guardarRevision(
  service: Servicio,
  p: { clienteId: string; pasadaId: string | null; origen: 'cron' | 'manual'; pedidoPor: string | null; plan: PlanCliente; llamada: ResultadoLlamadaPlan; revision: RevisionIa },
): Promise<void> {
  const { clienteId, pasadaId, origen, pedidoPor, plan, llamada, revision } = p
  // 1) La revisión y su coste (sin la 316 no se guarda, pero la revisión se devuelve igual)
  const { error: errorIa } = await service.from('fba_plan_ia').insert({
    client_id: clienteId,
    pasada_id: pasadaId,
    origen,
    pedido_por: pedidoPor,
    hash_plan: hashDelPlan(plan),
    modelo: llamada.modelo,
    tokens_entrada: llamada.tokens?.entrada ?? null,
    tokens_salida: llamada.tokens?.salida ?? null,
    coste_usd: revision.costeUsd,
    respuesta: llamada.respuesta,
    ajustes_validos: revision.ajustesValidos,
    ajustes_rechazados: revision.ajustesRechazados,
    aviso: revision.aviso,
    creado_at: revision.creadoAt,
  })
  if (errorIa && !faltaLaTabla(errorIa)) console.error('[fba/ia-plan] guardar en fba_plan_ia', errorIa)

  // 2) La copia en los envíos propuestos activos del cliente (solo si la IA contestó; no se toca `version`: no es una persona)
  if (llamada.respuesta) {
    const { error } = await service
      .from('fba_envios_propuestos')
      .update({ ia: revision })
      .eq('client_id', clienteId)
      .in('estado', [...ESTADOS_ACTIVOS])
    if (error && !faltaLaTabla(error)) console.error('[fba/ia-plan] copiar en los envíos propuestos', error)
  }

  // 3) La pasada queda revisada
  if (pasadaId) {
    const { error } = await service.from('fba_plan_pasadas').update({ ia_pendiente: false }).eq('id', pasadaId)
    if (error && !faltaLaTabla(error)) console.error('[fba/ia-plan] marcar la pasada', error)
  }
}

/* ------------------------------------------------------------------ */
/* Revisiones a mano: el tope diario                                   */
/* ------------------------------------------------------------------ */

/**
 * Cuántas revisiones a mano lleva hoy (Europe/Madrid) el cliente. Cuentan las que llegaron a hablar con la IA (con respuesta
 * o con tokens): un fallo de red sin llamada no gasta el cupo. null = falta la 316.
 */
export async function revisionesManualesDeHoy(service: Servicio, clienteId: string, ahora: Date = new Date()): Promise<number | null> {
  const desde = new Date(ahora.getTime() - 48 * 3_600_000).toISOString()
  const { data, error } = await service
    .from('fba_plan_ia')
    .select('creado_at, respuesta, tokens_entrada')
    .eq('client_id', clienteId)
    .eq('origen', 'manual')
    .gte('creado_at', desde)
  if (error) {
    if (faltaLaTabla(error)) return null
    throw error
  }
  const hoy = diaEnEspana(ahora)
  return ((data ?? []) as Array<{ creado_at: string; respuesta: unknown; tokens_entrada: number | null }>)
    .filter((f) => diaEnEspana(new Date(f.creado_at)) === hoy && (f.respuesta !== null || f.tokens_entrada !== null))
    .length
}

/* ------------------------------------------------------------------ */
/* El cron: las pasadas pendientes de revisar                          */
/* ------------------------------------------------------------------ */

type LeerUltimoPlan = (
  service: Servicio,
  clienteId: string,
  opciones: { lineas: 'propuestas' | 'todas'; sku?: string; pagina?: number },
) => Promise<{ plan: PlanCliente; calculadoAt: string } | null>

/** leerUltimoPlan vive en plan-datos.ts (S1), que a su vez arranca el cron que llama aquí: se carga al usarlo, sin ciclo */
export async function cargarLeerUltimoPlan(): Promise<LeerUltimoPlan> {
  const m = await import('./plan-datos')
  return m.leerUltimoPlan as unknown as LeerUltimoPlan
}

/**
 * La IA del cron (D31): como mucho 3 pasadas con `ia_pendiente` (la más vieja primero), 2 a la vez, 30 s por llamada y sin
 * empezar ninguna que no quepa en el presupuesto. Las pasadas que ya no son la última de su cliente, sin envíos propuestos o con
 * la misma huella que la última revisión buena se dan por revisadas sin llamar. NUNCA LANZA.
 */
export async function revisarPendientesIa(opciones: {
  presupuestoMs: number
  maxClientes?: number
  concurrencia?: number
  timeoutMs?: number
}): Promise<{ revisados: string[]; quedan: number }> {
  const inicio = Date.now()
  const maxClientes = Math.max(0, opciones.maxClientes ?? 3)
  const concurrencia = Math.max(1, opciones.concurrencia ?? 2)
  const timeoutMs = opciones.timeoutMs ?? TIEMPO_IA_PLAN_MS
  const revisados: string[] = []
  let service: Servicio
  try {
    service = createServiceClient()
  } catch (error) {
    console.error('[fba/ia-plan] cron sin cliente de servicio', error)
    return { revisados, quedan: 0 }
  }

  const marcar = async (id: string) => {
    const { error } = await service.from('fba_plan_pasadas').update({ ia_pendiente: false }).eq('id', id)
    if (error) console.error('[fba/ia-plan] marcar la pasada', error)
  }

  try {
    const { data, error } = await service
      .from('fba_plan_pasadas')
      .select('id, client_id, calculado_at')
      .eq('ia_pendiente', true)
      .order('calculado_at', { ascending: true })
      .limit(30)
    if (error) {
      if (!faltaLaTabla(error)) console.error('[fba/ia-plan] leer pendientes', error)
      return { revisados, quedan: 0 }
    }
    const pendientes = (data ?? []) as Array<{ id: string; client_id: string; calculado_at: string }>
    if (pendientes.length === 0 || maxClientes === 0) return { revisados, quedan: pendientes.length }

    // La última pasada de cada cliente: las anteriores ya no hace falta revisarlas
    const clientes = [...new Set(pendientes.map((p) => p.client_id))]
    const { data: ultimas } = await service.from('fba_plan_ultima').select('id, client_id').in('client_id', clientes)
    const ultimaDe = new Map(((ultimas ?? []) as Array<{ id: string; client_id: string }>).map((u) => [u.client_id, u.id]))
    const elegidas: typeof pendientes = []
    const vistos = new Set<string>()
    for (const p of pendientes) {
      const ultima = ultimaDe.get(p.client_id)
      if ((ultima && ultima !== p.id) || vistos.has(p.client_id)) {
        await marcar(p.id)
        continue
      }
      vistos.add(p.client_id)
      if (elegidas.length < maxClientes) elegidas.push(p)
    }

    const leerUltimoPlan = await cargarLeerUltimoPlan()
    const queda = () => opciones.presupuestoMs - (Date.now() - inicio)
    let siguiente = 0
    const trabajador = async () => {
      while (siguiente < elegidas.length) {
        if (queda() < timeoutMs + MARGEN_PRESUPUESTO_MS) return
        const p = elegidas[siguiente++]
        try {
          const leido = await leerUltimoPlan(service, p.client_id, { lineas: 'todas' })
          if (!leido || leido.plan.envios.length === 0) {
            await marcar(p.id)
            continue
          }
          // Misma huella que la última revisión buena: no se pregunta dos veces lo mismo (§3)
          const hash = hashDelPlan(leido.plan)
          const { data: ultimaIa } = await service
            .from('fba_plan_ia')
            .select('hash_plan')
            .eq('client_id', p.client_id)
            .not('respuesta', 'is', null)
            .order('creado_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if ((ultimaIa as { hash_plan: string | null } | null)?.hash_plan === hash) {
            await marcar(p.id)
            continue
          }
          const revision = await revisarPlanConIa(p.client_id, leido.plan, p.id, 'cron', undefined, { service, timeoutMs })
          if (revision) revisados.push(p.client_id)
          else await marcar(p.id)
        } catch (error) {
          console.error('[fba/ia-plan] revisar pendiente', p.client_id, error)
          await marcar(p.id)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrencia, elegidas.length) }, trabajador))

    const { count } = await service.from('fba_plan_pasadas').select('id', { count: 'exact', head: true }).eq('ia_pendiente', true)
    return { revisados, quedan: count ?? 0 }
  } catch (error) {
    console.error('[fba/ia-plan] cron', error)
    return { revisados, quedan: 0 }
  }
}
