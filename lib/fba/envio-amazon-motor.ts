import { connectionCredentials } from '@/lib/amazon/data'
import { AmazonApiError } from '@/lib/amazon/errors'
import type { AmazonCredentials } from '@/lib/amazon/sp-api'
import { createServiceClient } from '@/lib/supabase/service'
import { cajasDeRemesa, type ClienteDeBase } from './cajas'
import {
  OPERACION_DEL_PASO,
  TEXTO_DEL_PASO,
  accionesPermitidas,
  cambiarSeleccion,
  cancelabilidad,
  cotizacionVigente,
  emparejarCajasDeEnvios,
  cuadraPesoPalets,
  embalajeAutomatico,
  esPasoEnvio,
  fechaDeRecogida,
  siguienteLaborable,
  hayErrores,
  hayQueMandarCajasOtraVez,
  pasoEnCurso,
  proponerTransporte,
  repartirCajasEnGrupos,
  resumirReparto,
  resumirSelecciones,
  sinCobroDeAmazon,
  validarCajas,
  validarPalets,
  validarInventario,
  type AccionEnvio,
  type DatosPalets,
  type DireccionOrigen,
  type ModoEnvio,
  type OpcionEmbalaje,
  type OpcionReparto,
  type OpcionRepartoResumida,
  type OpcionTransporte,
  type PasoEnvio,
  type Problema,
  type SeleccionTransporte,
} from './envio-amazon'
import { registrarEnHistorial } from './historial'
import * as api from './inbound-v2024'

/**
 * EL MOTOR DEL ENVÍO A AMAZON.
 * ============================
 * SOLO SERVIDOR. Lo usan la ruta de administradores (/api/fba/remesas/[id]/amazon) y, para lo que hace
 * el cliente (aceptar el coste del transporte, ver sus etiquetas), las rutas públicas del portal.
 *
 * NO espera dentro de la petición. Cada paso lanza su operación en Amazon, la apunta en
 * fba_inbound_operaciones y vuelve. La pantalla pregunta (GET) mientras haya una en curso; cada pregunta
 * mira el estado de la operación UNA vez y, si acabó bien, hace las lecturas que tocan y lanza la siguiente
 * o se para a esperar a una persona. Si acabó en FAILED, el paso se queda donde estaba con el error.
 *
 * DOS PANTALLAS A LA VEZ no lanzan dos veces lo mismo: el paso se cambia con `.eq('envio_paso', esperado)`
 * y la operación se da por terminada con `.eq('estado', 'en_curso')`; solo quien gana sigue.
 */

const faltaLaMigracion = (e: { code?: string } | null): boolean => e?.code === '42703' || e?.code === 'PGRST204' || e?.code === 'PGRST205' || e?.code === '42P01'

/** No se pregunta a Amazon por la misma operación más de una vez cada tanto, aunque haya varias pantallas */
const ENTRE_COMPROBACIONES_MS = 3_000

/* ------------------------------------------------------------------ */
/* Lo que se guarda en envio_datos                                     */
/* ------------------------------------------------------------------ */

export interface DestinoDeEnvio {
  shipmentId: string
  confirmacion: string | null
  destino: string | null
  ciudad: string | null
  estado: string | null
}

export interface DatosDelEnvio {
  opcionesEmbalaje?: OpcionEmbalaje[]
  skuAGrupo?: Record<string, string>
  opcionesReparto?: Array<OpcionReparto & { destinos: Array<{ shipmentId: string; destino: string | null; ciudad: string | null }> }>
  envios?: DestinoDeEnvio[]
  recogida?: { dia: string; iso: string; contacto: api.Contacto | null }
  /** Envío por palés (LTL). Sin esto, paquetería */
  palets?: DatosPalets | null
  /** Quién prepara y etiqueta cada SKU cuando Amazon no acepta SELLER (lo dice al crear el plan). Se manda igual en las cajas */
  duenos?: api.Duenos
  /** Seguimiento del envío de palés con transporte propio (BOL) */
  seguimientoLtl?: { bol: string; fletes: string[]; at: string; estado?: 'ok' | 'pendiente'; operationId?: string | null } | null
  opcionesTransporte?: OpcionTransporte[]
  sinAsociado?: string[]
  /** Envíos cuya ventana de entrega falta por confirmar (solo transporte propio) */
  ventanasPendientes?: string[]
  ventanaElegida?: { shipmentId: string; deliveryWindowOptionId: string; desde: string | null; hasta: string | null } | null
  /** boxId de Amazon por envío y su número de caja en el ERP */
  cajasAmazon?: Record<string, Array<{ boxId: string; numero: number | null }>>
  seguimiento?: { at: string; estadoPlan: string; envios: Array<{ shipmentId: string; confirmacion: string | null; estado: string | null; destino: string | null; seguimientos: number; invalidos: number; /** Los números de UPS (1Z…), para la recogida */ numeros?: string[] }> }
  planesCancelados?: string[]
  avisos?: string[]
}

interface FilaRemesa {
  id: string
  client_id: string
  nombre: string | null
  fecha_envio: string
  estado: string
  connection_id: string | null
  marketplace_id: string | null
  envio_modo: ModoEnvio
  inbound_plan_id: string | null
  envio_paso: string
  envio_error: string | null
  envio_datos: DatosDelEnvio | null
  envio_actualizado_at: string | null
  packing_option_id: string | null
  placement_option_id: string | null
  transporte_seleccion: SeleccionTransporte[] | null
  coste_reparto: number | string | null
  coste_transporte: number | string | null
  moneda_envio: string | null
  transporte_caduca_at: string | null
  transporte_aceptado_por_cliente_at: string | null
  transporte_aceptado_ip: string | null
  transporte_aceptado_nombre: string | null
  transporte_aceptado_coste: number | string | null
  transporte_confirmado_at: string | null
  anulable_hasta: string | null
  envio_cajas_bloqueadas_at: string | null
}

const COLUMNAS =
  'id, client_id, nombre, fecha_envio, estado, connection_id, marketplace_id, envio_modo, inbound_plan_id, envio_paso, envio_error, envio_datos, envio_actualizado_at, ' +
  'packing_option_id, placement_option_id, transporte_seleccion, coste_reparto, coste_transporte, moneda_envio, transporte_caduca_at, transporte_aceptado_por_cliente_at, ' +
  'transporte_aceptado_ip, transporte_aceptado_nombre, transporte_aceptado_coste, transporte_confirmado_at, anulable_hasta, envio_cajas_bloqueadas_at'

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export class FalloDelEnvio extends Error {
  constructor(
    message: string,
    readonly estadoHttp = 409
  ) {
    super(message)
  }
}

export type ResultadoLectura = { sinMigrar: true } | { sinMigrar: false; fila: FilaRemesa }

export async function leerRemesa(remesaId: string, service: ClienteDeBase = createServiceClient()): Promise<ResultadoLectura | null> {
  const { data, error } = await service.from('fba_remesas').select(COLUMNAS).eq('id', remesaId).maybeSingle()
  if (error) {
    if (faltaLaMigracion(error)) return { sinMigrar: true }
    throw error
  }
  if (!data) return null
  return { sinMigrar: false, fila: data as unknown as FilaRemesa }
}

function pasoDe(f: FilaRemesa): PasoEnvio {
  return esPasoEnvio(f.envio_paso) ? f.envio_paso : 'sin_empezar'
}

/* ------------------------------------------------------------------ */
/* Lo que ve la pantalla                                               */
/* ------------------------------------------------------------------ */

export interface OperacionVista {
  id: string
  paso: string
  operacion: string
  estado: 'en_curso' | 'ok' | 'fallo'
  problemas: api.ProblemaOperacion[]
  creadaAt: string
  terminadaAt: string | null
  autor: string | null
}

export interface EstadoDelEnvio {
  sinMigrar: boolean
  modo: ModoEnvio
  paso: PasoEnvio
  texto: string
  enCurso: boolean
  error: string | null
  remesaEstado: string
  conConexion: boolean
  inboundPlanId: string | null
  cajasBloqueadas: boolean
  inventario: { problemas: Problema[]; referencias: number; unidades: number }
  cajas: { problemas: Problema[]; cajas: number; pesoKg: number; cuadra: boolean }
  direccion: DireccionOrigen | null
  /** Para editar la dirección desde la pantalla del envío */
  clienteId: string | null
  opcionesEmbalaje: OpcionEmbalaje[]
  packingOptionId: string | null
  opcionesReparto: Array<OpcionRepartoResumida & { destinos: Array<{ shipmentId: string; destino: string | null; ciudad: string | null }> }>
  placementOptionId: string | null
  costeReparto: number | null
  envios: DestinoDeEnvio[]
  recogida: DatosDelEnvio['recogida'] | null
  opcionesTransporte: OpcionTransporte[]
  seleccion: SeleccionTransporte[]
  sinAsociado: string[]
  costeTransporte: number | null
  moneda: string | null
  transporteCaduca: string | null
  cotizacionVigente: boolean
  aceptacion: { at: string; nombre: string | null; ip: string | null; coste: number | null } | null
  transporteConfirmadoAt: string | null
  anulableHasta: string | null
  cancelable: ReturnType<typeof cancelabilidad>
  cajasAmazon: DatosDelEnvio['cajasAmazon'] | null
  seguimiento: DatosDelEnvio['seguimiento'] | null
  palets: DatosPalets | null
  seguimientoLtl: DatosDelEnvio['seguimientoLtl'] | null
  /** Transporte propio: Amazon no cobra, no hay coste que acepte el cliente */
  sinCobro: boolean
  acciones: AccionEnvio[]
  operaciones: OperacionVista[]
  avisos: string[]
}

async function direccionDe(clienteId: string, service: ClienteDeBase): Promise<DireccionOrigen | null> {
  const { data } = await service.from('fba_direcciones').select('*').eq('client_id', clienteId).maybeSingle()
  if (!data) return null
  const d = data as Record<string, string | null>
  return { nombre: d.nombre, empresa: d.empresa, linea1: d.linea1, linea2: d.linea2, ciudad: d.ciudad, provincia: d.provincia, codigoPostal: d.codigo_postal, pais: d.pais, telefono: d.telefono, email: d.email }
}

async function lineasDe(remesaId: string, service: ClienteDeBase): Promise<Array<{ sku: string; unidades: number; fnsku: string | null; asin: string | null }>> {
  const { data, error } = await service.from('fba_remesa_lineas').select('sku, unidades, fnsku, asin').eq('remesa_id', remesaId)
  if (error) throw error
  return ((data ?? []) as Array<{ sku: string; unidades: number; fnsku: string | null; asin: string | null }>).filter((l) => l.unidades > 0)
}

/** Las referencias con «ASIN como FNSKU» (código del fabricante): van con labelOwner NONE */
const sinEtiquetaDe = (ls: Array<{ sku: string; fnsku: string | null; asin: string | null }>): Set<string> =>
  new Set(ls.filter((l) => !!l.fnsku && !!l.asin && l.fnsku.trim().toUpperCase() === l.asin.trim().toUpperCase()).map((l) => l.sku))

export async function estadoDelEnvio(remesaId: string, service: ClienteDeBase = createServiceClient(), ahora = new Date()): Promise<EstadoDelEnvio | null> {
  const r = await leerRemesa(remesaId, service)
  if (!r) return null
  if (r.sinMigrar) {
    return {
      ...vacio(),
      sinMigrar: true,
    }
  }
  const f = r.fila
  const paso = pasoDe(f)
  const datos = f.envio_datos ?? {}
  const [direccion, lineas, cajas, ops] = await Promise.all([
    direccionDe(f.client_id, service),
    lineasDe(f.id, service),
    cajasDeRemesa(f.id, service),
    service.from('fba_inbound_operaciones').select('id, paso, operacion, estado, problemas, created_at, terminada_at, user_id').eq('remesa_id', f.id).order('created_at', { ascending: false }).limit(30),
  ])
  const filasOps = ((ops.data ?? []) as Array<{ id: string; paso: string; operacion: string; estado: 'en_curso' | 'ok' | 'fallo'; problemas: api.ProblemaOperacion[] | null; created_at: string; terminada_at: string | null; user_id: string | null }>)
  const ids = [...new Set(filasOps.map((o) => o.user_id).filter((x): x is string => !!x))]
  const nombres = new Map<string, string>()
  if (ids.length) {
    const { data: ps } = await service.from('profiles').select('id, full_name').in('id', ids)
    for (const p of (ps ?? []) as Array<{ id: string; full_name: string | null }>) if (p.full_name) nombres.set(p.id, p.full_name)
  }

  const cajasParaValidar = cajas.cajas.map((c) => ({ numero: c.numero, largoCm: c.largoCm, anchoCm: c.anchoCm, altoCm: c.altoCm, pesoKg: c.pesoKg, contenido: c.contenido }))
  const problemasCajas = validarCajas(cajasParaValidar)
  if (!cajas.cuadre.cuadra) problemasCajas.unshift({ nivel: 'error', texto: 'Las cajas no cuadran con las unidades de la remesa' })
  const modo: ModoEnvio = f.envio_modo === 'api' ? 'api' : 'manual'
  const seleccion = f.transporte_seleccion ?? []
  const costeTransporte = num(f.coste_transporte)
  const aceptacion = f.transporte_aceptado_por_cliente_at
    ? { at: f.transporte_aceptado_por_cliente_at, nombre: f.transporte_aceptado_nombre, ip: f.transporte_aceptado_ip, coste: num(f.transporte_aceptado_coste) }
    : null

  return {
    sinMigrar: false,
    modo,
    paso,
    texto: TEXTO_DEL_PASO[paso],
    enCurso: pasoEnCurso(paso) && !f.envio_error,
    error: f.envio_error,
    remesaEstado: f.estado,
    conConexion: !!f.connection_id,
    inboundPlanId: f.inbound_plan_id,
    cajasBloqueadas: !!f.envio_cajas_bloqueadas_at,
    inventario: {
      problemas: validarInventario({ conConexion: !!f.connection_id, marketplaceId: f.marketplace_id, direccion, lineas, estado: f.estado }),
      referencias: lineas.length,
      unidades: lineas.reduce((s, l) => s + l.unidades, 0),
    },
    cajas: { problemas: problemasCajas, cajas: cajas.cajas.length, pesoKg: cajas.pesoTotalKg, cuadra: cajas.cuadre.cuadra },
    direccion,
    clienteId: f.client_id,
    opcionesEmbalaje: datos.opcionesEmbalaje ?? [],
    packingOptionId: f.packing_option_id,
    opcionesReparto: resumirReparto(datos.opcionesReparto ?? [], ahora).map((o) => ({ ...o, destinos: (datos.opcionesReparto ?? []).find((x) => x.placementOptionId === o.placementOptionId)?.destinos ?? [] })),
    placementOptionId: f.placement_option_id,
    costeReparto: num(f.coste_reparto),
    envios: datos.envios ?? [],
    recogida: datos.recogida ?? null,
    opcionesTransporte: datos.opcionesTransporte ?? [],
    seleccion,
    sinAsociado: datos.sinAsociado ?? [],
    costeTransporte,
    moneda: f.moneda_envio,
    transporteCaduca: f.transporte_caduca_at,
    cotizacionVigente: cotizacionVigente(f.transporte_caduca_at, ahora),
    aceptacion,
    transporteConfirmadoAt: f.transporte_confirmado_at,
    anulableHasta: f.anulable_hasta,
    cancelable: cancelabilidad(paso, f.anulable_hasta, ahora),
    cajasAmazon: datos.cajasAmazon ?? null,
    seguimiento: datos.seguimiento ?? null,
    palets: datos.palets ?? null,
    seguimientoLtl: datos.seguimientoLtl ?? null,
    sinCobro: sinCobroDeAmazon(seleccion),
    acciones: accionesPermitidas({ modo, paso, conError: !!f.envio_error, clienteAcepto: !!aceptacion, anulableHasta: f.anulable_hasta, ahora, sinCobro: sinCobroDeAmazon(seleccion), conPalets: !!datos.palets }),
    operaciones: filasOps.map((o) => ({ id: o.id, paso: o.paso, operacion: o.operacion, estado: o.estado, problemas: o.problemas ?? [], creadaAt: o.created_at, terminadaAt: o.terminada_at, autor: o.user_id ? nombres.get(o.user_id) ?? null : null })),
    avisos: datos.avisos ?? [],
  }
}

function vacio(): EstadoDelEnvio {
  return {
    sinMigrar: false,
    modo: 'manual',
    paso: 'sin_empezar',
    texto: TEXTO_DEL_PASO.sin_empezar,
    enCurso: false,
    error: null,
    remesaEstado: '',
    conConexion: false,
    inboundPlanId: null,
    cajasBloqueadas: false,
    inventario: { problemas: [], referencias: 0, unidades: 0 },
    cajas: { problemas: [], cajas: 0, pesoKg: 0, cuadra: false },
    direccion: null,
    clienteId: null,
    opcionesEmbalaje: [],
    packingOptionId: null,
    opcionesReparto: [],
    placementOptionId: null,
    costeReparto: null,
    envios: [],
    recogida: null,
    opcionesTransporte: [],
    seleccion: [],
    sinAsociado: [],
    costeTransporte: null,
    moneda: null,
    transporteCaduca: null,
    cotizacionVigente: false,
    aceptacion: null,
    transporteConfirmadoAt: null,
    anulableHasta: null,
    cancelable: { puede: false, grave: false, motivo: '' },
    cajasAmazon: null,
    seguimiento: null,
    palets: null,
    seguimientoLtl: null,
    sinCobro: false,
    acciones: [],
    operaciones: [],
    avisos: [],
  }
}

/* ------------------------------------------------------------------ */
/* Contexto de una ejecución                                            */
/* ------------------------------------------------------------------ */

interface Ctx {
  service: ClienteDeBase
  fila: FilaRemesa
  creds: AmazonCredentials
  userId: string | null
  actor: 'agencia' | 'enlace' | 'sistema'
}

async function credencialesDe(f: FilaRemesa): Promise<AmazonCredentials> {
  if (!f.connection_id) throw new FalloDelEnvio('Este cliente no tiene la cuenta de Amazon conectada: usa el modo manual (Seller Central)')
  const c = await connectionCredentials(f.connection_id)
  if (!c) throw new FalloDelEnvio('La conexión de Amazon de esta remesa ya no existe')
  return c.credentials
}

/** Cambia la fila SOLO si sigue en el paso esperado. Devuelve false si otro se adelantó */
async function moverPaso(ctx: Ctx, desde: PasoEnvio | PasoEnvio[], cambios: Record<string, unknown>, ademas: Record<string, string> = {}): Promise<boolean> {
  const lista = Array.isArray(desde) ? desde : [desde]
  let q = ctx.service
    .from('fba_remesas')
    .update({ ...cambios, envio_actualizado_at: new Date().toISOString() })
    .eq('id', ctx.fila.id)
    .in('envio_paso', lista)
  // Condiciones extra: que lo que se leyó siga igual (p. ej. la misma aceptación del cliente)
  for (const [col, val] of Object.entries(ademas)) q = q.eq(col, val)
  const { data, error } = await q.select('id')
  if (error) throw error
  const ok = ((data as unknown[] | null) ?? []).length > 0
  if (ok) Object.assign(ctx.fila, cambios)
  return ok
}

/** El aviso que se pone cuando un paso «en curso» no tiene operación viva. Solo ESTE se borra solo al cambiar de paso (un error real no) */
const TEXTO_SIN_OPERACION = 'No hay ninguna operación de Amazon en marcha para este paso. Reintenta o cancela.'

async function guardar(ctx: Ctx, cambios: Record<string, unknown>): Promise<void> {
  const { error } = await ctx.service.from('fba_remesas').update({ ...cambios, envio_actualizado_at: new Date().toISOString() }).eq('id', ctx.fila.id)
  if (error) throw error
  Object.assign(ctx.fila, cambios)
  // Al pasar a otro paso, el aviso de «no hay operación en marcha» del paso anterior ya no vale (A4.2): se quita solo si es ese texto
  if ('envio_paso' in cambios && !('envio_error' in cambios) && ctx.fila.envio_error === TEXTO_SIN_OPERACION) {
    await ctx.service.from('fba_remesas').update({ envio_error: null }).eq('id', ctx.fila.id).eq('envio_error', TEXTO_SIN_OPERACION)
    ctx.fila.envio_error = null
  }
}

const datosDe = (ctx: Ctx): DatosDelEnvio => ctx.fila.envio_datos ?? {}

const textoDeFallo = (e: unknown): string => (e instanceof AmazonApiError ? e.humanMessage : e instanceof Error ? e.message : 'Fallo desconocido')

/**
 * LANZA UNA OPERACIÓN: pone el paso, llama a Amazon y apunta el operationId. Si la llamada falla (HTTP),
 * el paso se queda puesto con el error para poder reintentar; si Amazon contesta, la operación queda
 * «en curso» hasta que la pantalla pregunte.
 */
async function lanzar(ctx: Ctx, paso: PasoEnvio, llamada: () => Promise<{ operationId: string }>, peticion: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Promise<void> {
  const operacion = OPERACION_DEL_PASO[paso] ?? paso
  await guardar(ctx, { envio_paso: paso, envio_error: null, ...extra })
  let aceptada = false
  try {
    const r = await llamada()
    aceptada = true
    const fila = { remesa_id: ctx.fila.id, paso, operacion, operation_id: r.operationId, estado: 'en_curso', peticion, respuesta: r, actor: ctx.actor, user_id: ctx.userId }
    // A4.3: Amazon YA ha aceptado la operación. Si falla apuntarla en la base, se reintenta una vez; nunca se apunta como «fallo» algo que Amazon aceptó
    let { error } = await ctx.service.from('fba_inbound_operaciones').insert(fila)
    if (error) ({ error } = await ctx.service.from('fba_inbound_operaciones').insert(fila))
    if (error) throw error
  } catch (e) {
    if (aceptada) {
      // La llamada llegó a Amazon pero no se ha podido apuntar: Reintentar comprueba en Amazon si ya está hecho antes de repetir nada
      await guardar(ctx, { envio_error: `Amazon ha aceptado este paso pero no se ha podido apuntar (${textoDeFallo(e)}). Pulsa «Reintentar»: se comprueba en Amazon antes de repetir nada.` })
      return
    }
    const texto = textoDeFallo(e)
    await ctx.service.from('fba_inbound_operaciones').insert({
      remesa_id: ctx.fila.id,
      paso,
      operacion,
      estado: 'fallo',
      // Lo que dijo Amazon tal cual, para poder ver QUÉ campo no le gusta (el mensaje traducido no lo dice)
      problemas: [{ code: null, message: texto, details: e instanceof AmazonApiError ? e.message : null, severity: 'ERROR' }],
      peticion,
      actor: ctx.actor,
      user_id: ctx.userId,
      terminada_at: new Date().toISOString(),
    })
    await guardar(ctx, { envio_error: texto })
    await registrarEnHistorial({ remesaId: ctx.fila.id, actor: ctx.actor === 'enlace' ? 'enlace' : 'agencia', userId: ctx.userId, accion: 'envio_amazon', hasta: paso, detalle: { paso, operacion, error: texto } }, ctx.service)
  }
}

/* ------------------------------------------------------------------ */
/* Cada paso: cómo se lanza                                            */
/* ------------------------------------------------------------------ */

async function lanzarPlan(ctx: Ctx): Promise<void> {
  const f = ctx.fila
  const [direccion, lineas, cajas] = await Promise.all([direccionDe(f.client_id, ctx.service), lineasDe(f.id, ctx.service), cajasDeRemesa(f.id, ctx.service)])
  const problemas = validarInventario({ conConexion: !!f.connection_id, marketplaceId: f.marketplace_id, direccion, lineas, estado: f.estado })
  const pc = validarCajas(cajas.cajas)
  if (!cajas.cuadre.cuadra) pc.push({ nivel: 'error', texto: 'Las cajas no cuadran con las unidades de la remesa' })
  const errores = [...problemas, ...pc].filter((p) => p.nivel === 'error')
  if (errores.length) throw new FalloDelEnvio(errores.map((p) => p.texto).join('. '))

  // LA PREPARACIÓN, antes del plan: lo que en Seller Central es elegir «No necesita preparación» y guardar en cada SKU que le falta, y de paso
  // quién puede preparar y etiquetar cada uno. Si Amazon no contesta, se sigue como siempre (y el plan aprende de su error)
  const desdeAmazon: api.Duenos = {}
  let prepFijada: string[] = []
  const prepAvisos: string[] = []
  const mskus = [...new Set(lineas.filter((l) => l.unidades > 0).map((l) => l.sku))]
  let prep: api.PrepDeSku[] = []
  try {
    prep = await api.leerPreparacion(ctx.creds, f.marketplace_id as string, mskus)
  } catch (e) {
    prepAvisos.push(`leer: ${e instanceof Error ? e.message : String(e)}`.slice(0, 400))
  }
  // Los que Amazon ya dijo en un intento anterior que no tienen categoría (FBA_INB_0182, «resource 'SKU'»): se fijan aunque la lectura falle
  const { data: previas } = await ctx.service.from('fba_inbound_operaciones').select('problemas').eq('remesa_id', f.id).eq('paso', 'plan').eq('estado', 'fallo').order('created_at', { ascending: false }).limit(5)
  const yaDichos = new Set<string>()
  for (const o of previas ?? []) {
    for (const p of (o.problemas ?? []) as Array<{ code?: string | null; details?: string | null; message?: string | null }>) {
      if (p.code !== 'FBA_INB_0182' && !/prep classification/i.test(p.message ?? '')) continue
      const m = /resource '([^']+)'/.exec(p.details ?? '')
      if (m && mskus.includes(m[1])) yaDichos.add(m[1])
    }
  }
  const faltan = [...new Set([...prep.filter(api.sinPreparacion).map((p) => p.msku), ...yaDichos])]
  if (faltan.length) {
    try {
      const op = await api.fijarSinPreparacion(ctx.creds, f.marketplace_id as string, faltan)
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        const st = await api.estadoDeOperacion(ctx.creds, op.operationId)
        if (st.estado === 'ok') { prepFijada = faltan; break }
        if (st.estado === 'fallo') { prepAvisos.push(`fijar: ${st.texto}`.slice(0, 400)); break }
      }
    } catch (e) {
      prepAvisos.push(`fijar: ${e instanceof Error ? e.message : String(e)}`.slice(0, 400))
    }
  }
  Object.assign(desdeAmazon, api.duenosDePreparacion(prep.map((p) => (prepFijada.includes(p.msku) ? { ...p, prepCategory: 'NONE', prepTypes: ['ITEM_NO_PREP'] } : p))))
  for (const sku of prepFijada) desdeAmazon[sku] = { ...desdeAmazon[sku], prep: 'NONE' }

  const cuerpo = api.cuerpoCrearPlan({
    nombre: f.nombre ?? `Remesa ${f.fecha_envio}`,
    marketplaceId: f.marketplace_id as string,
    origen: direccion as DireccionOrigen,
    lineas,
    sinEtiqueta: sinEtiquetaDe(lineas),
    duenos: { ...desdeAmazon, ...(datosDe(ctx).duenos ?? {}) },
  })
  const duenos: api.Duenos = { ...desdeAmazon, ...(datosDe(ctx).duenos ?? {}) }
  const conDuenos = (c: typeof cuerpo) => ({ ...c, items: api.cuerpoCrearPlan({ nombre: c.name, marketplaceId: f.marketplace_id as string, origen: direccion as DireccionOrigen, lineas, sinEtiqueta: sinEtiquetaDe(lineas), duenos }).items })
  const anteriores = [...(datosDe(ctx).planesCancelados ?? [])]
  if (f.inbound_plan_id) anteriores.push(f.inbound_plan_id)
  await lanzar(
    ctx,
    'plan',
    async () => {
      // Si Amazon no verifica la dirección (su callejero no la encuentra), se prueban otras formas de escribir LA MISMA dirección
      // (sin acentos, sin provincia, «C/», la ciudad en la otra lengua…) y se queda la primera que acepta. Por la API no hay
      // «usar esta dirección igualmente» como en Seller Central
      const variantes = api.variantesDeDireccion(direccion as DireccionOrigen)
      let ultimo: unknown = null
      for (const [n, origen] of variantes.entries()) {
        const base = n === 0 ? cuerpo : { ...cuerpo, sourceAddress: api.cuerpoCrearPlan({ nombre: cuerpo.name, marketplaceId: f.marketplace_id as string, origen, lineas }).sourceAddress }
        // Si Amazon dice que un SKU no lleva preparación (o etiqueta) del vendedor, se apunta lo que acepta y se repite: como mucho una vez por referencia
        let direccionMala = false
        for (let vuelta = 0; vuelta <= cuerpo.items.length + 1; vuelta++) {
          const intento = conDuenos(base)
          try {
            if (n > 0 || vuelta > 0) await new Promise((r) => setTimeout(r, 1200)) // createInboundPlan admite pocas llamadas por segundo
            const r = await api.crearPlan(ctx.creds, intento)
            await guardar(ctx, { inbound_plan_id: r.inboundPlanId, ...(Object.keys(duenos).length ? { envio_datos: { ...datosDe(ctx), duenos } } : {}) })
            const extra = Object.keys(duenos).length ? { duenos } : {}
            return n === 0 ? { ...r, ...extra } : { ...r, ...extra, direccionUsada: { linea1: origen.linea1, ciudad: origen.ciudad, provincia: origen.provincia, intento: n + 1 } }
          } catch (e) {
            const pide = api.duenosDelError(e)
            if (pide && Object.entries(pide).some(([sku, d]) => duenos[sku]?.prep !== (d.prep ?? duenos[sku]?.prep) || duenos[sku]?.label !== (d.label ?? duenos[sku]?.label))) {
              for (const [sku, d] of Object.entries(pide)) duenos[sku] = { ...duenos[sku], ...d }
              ultimo = e
              continue
            }
            if (!api.esDireccionSinVerificar(e)) throw e
            ultimo = e
            direccionMala = true
            break
          }
        }
        if (!direccionMala) throw ultimo
      }
      throw ultimo
    },
    { referencias: cuerpo.items.length, unidades: cuerpo.items.reduce((s, i) => s + i.quantity, 0), origen: cuerpo.sourceAddress.postalCode, prepLeida: prep.length, ...(faltan.length ? { sinPreparacion: faltan } : {}), ...(prepFijada.length ? { sinPreparacionFijada: prepFijada } : {}), ...(prepAvisos.length ? { prepAvisos } : {}) },
    {
      inbound_plan_id: null,
      packing_option_id: null,
      placement_option_id: null,
      transporte_seleccion: null,
      coste_reparto: null,
      coste_transporte: null,
      transporte_caduca_at: null,
      transporte_aceptado_por_cliente_at: null,
      transporte_aceptado_ip: null,
      transporte_aceptado_nombre: null,
      transporte_aceptado_coste: null,
      transporte_confirmado_at: null,
      transporte_confirmado_por: null,
      anulable_hasta: null,
      envio_cajas_bloqueadas_at: new Date().toISOString(),
      envio_datos: { planesCancelados: anteriores } satisfies DatosDelEnvio,
    }
  )
}

const plan = (ctx: Ctx): string => {
  if (!ctx.fila.inbound_plan_id) throw new FalloDelEnvio('La remesa no tiene plan en Amazon')
  return ctx.fila.inbound_plan_id
}

async function lanzarCajas(ctx: Ctx): Promise<void> {
  const skuAGrupo = datosDe(ctx).skuAGrupo
  if (!skuAGrupo) throw new FalloDelEnvio('Faltan los grupos de embalaje de Amazon: reintenta el embalaje')
  const [cajas, lineas] = await Promise.all([cajasDeRemesa(ctx.fila.id, ctx.service), lineasDe(ctx.fila.id, ctx.service)])
  const problemas = validarCajas(cajas.cajas)
  if (!cajas.cuadre.cuadra) problemas.push({ nivel: 'error', texto: 'Las cajas no cuadran con las unidades de la remesa' })
  if (hayErrores(problemas)) throw new FalloDelEnvio(problemas.filter((p) => p.nivel === 'error').map((p) => p.texto).join('. '))
  const reparto = repartirCajasEnGrupos(cajas.cajas, skuAGrupo)
  if (!reparto.ok) {
    await guardar(ctx, { envio_paso: 'cajas_conflicto', envio_error: reparto.problemas.join('. '), envio_cajas_bloqueadas_at: null })
    return
  }
  const cuerpo = api.cuerpoCajas(reparto.grupos, sinEtiquetaDe(lineas), datosDe(ctx).duenos)
  await lanzar(ctx, 'cajas', () => api.mandarCajas(ctx.creds, plan(ctx), cuerpo), { grupos: reparto.grupos.length, cajas: cajas.cajas.length, pesoKg: cajas.pesoTotalKg }, { envio_cajas_bloqueadas_at: new Date().toISOString() })
}

async function cotizarSola(ctx: Ctx, envios: DestinoDeEnvio[]): Promise<void> {
  if (!envios.length || datosDe(ctx).palets) return
  const dir = await direccionDe(ctx.fila.client_id, ctx.service)
  const nombre = (dir?.nombre || dir?.empresa || '').trim()
  const telefono = (dir?.telefono ?? '').trim()
  if (!nombre || !telefono) return
  const dia = siguienteLaborable(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date()))
  const fecha = fechaDeRecogida(dia)
  if (!fecha.ok) return
  const recogida = { dia, iso: fecha.iso, contacto: { nombre: nombre.slice(0, 80), telefono: telefono.slice(0, 30), email: (dir?.email ?? '').trim().slice(0, 120) || null } }
  if (!(await moverPaso(ctx, 'transporte_datos', { envio_paso: 'transporte_generar', envio_datos: { ...datosDe(ctx), recogida, palets: null } }))) return
  await lanzarTransporte(ctx)
}

async function lanzarTransporte(ctx: Ctx): Promise<void> {
  const d = datosDe(ctx)
  if (!d.recogida) throw new FalloDelEnvio('Falta la fecha de recogida')
  if (!ctx.fila.placement_option_id) throw new FalloDelEnvio('Falta el reparto confirmado')
  const envios = (d.envios ?? []).map((e) => e.shipmentId)
  if (!envios.length) throw new FalloDelEnvio('El reparto no tiene envíos')
  // La hora se recalcula en cada intento: la guardada puede haber pasado ya (un reintento horas después)
  const fecha = fechaDeRecogida(d.recogida.dia)
  if (!fecha.ok) throw new FalloDelEnvio(`${fecha.error}. Cambia el día de recogida`)
  const cuerpo = api.cuerpoGenerarTransporte(ctx.fila.placement_option_id, envios, fecha.iso, d.recogida.contacto, d.palets ?? null)
  await lanzar(ctx, 'transporte_generar', () => api.generarOpcionesTransporte(ctx.creds, plan(ctx), cuerpo), { envios: envios.length, recogida: d.recogida.dia, palets: d.palets?.cantidad ?? 0 })
}

async function lanzarConfirmarTransporte(ctx: Ctx): Promise<void> {
  const sel = ctx.fila.transporte_seleccion ?? []
  if (!sel.length) throw new FalloDelEnvio('No hay transporte elegido')
  const cuerpo = api.cuerpoConfirmarTransporte(sel, datosDe(ctx).recogida?.contacto ?? null)
  await lanzar(ctx, 'transporte_confirmar', () => api.confirmarTransporte(ctx.creds, plan(ctx), cuerpo), { envios: sel.length, coste: num(ctx.fila.coste_transporte), moneda: ctx.fila.moneda_envio, transportista: sel.map((s) => s.transportista).join(', ') })
}

async function lanzarVentana(ctx: Ctx): Promise<void> {
  const pendiente = datosDe(ctx).ventanasPendientes?.[0]
  if (!pendiente) return lanzarConfirmarTransporte(ctx)
  await lanzar(ctx, 'ventana_generar', () => api.generarVentanas(ctx.creds, plan(ctx), pendiente), { shipmentId: pendiente })
}

/** Vuelve a lanzar la operación del paso en el que se quedó (tras un fallo) */
async function relanzar(ctx: Ctx, paso: PasoEnvio): Promise<void> {
  switch (paso) {
    case 'plan':
      return lanzarPlan(ctx)
    case 'embalaje_generar':
      return lanzar(ctx, 'embalaje_generar', () => api.generarOpcionesEmbalaje(ctx.creds, plan(ctx)))
    case 'embalaje_confirmar': {
      const id = ctx.fila.packing_option_id
      if (!id) throw new FalloDelEnvio('Falta el embalaje elegido')
      return lanzar(ctx, 'embalaje_confirmar', () => api.confirmarEmbalaje(ctx.creds, plan(ctx), id), { packingOptionId: id })
    }
    case 'cajas':
      return lanzarCajas(ctx)
    case 'reparto_generar':
      return lanzar(ctx, 'reparto_generar', () => api.generarOpcionesReparto(ctx.creds, plan(ctx)))
    case 'reparto_confirmar': {
      const id = ctx.fila.placement_option_id
      if (!id) throw new FalloDelEnvio('Falta el reparto elegido')
      return lanzar(ctx, 'reparto_confirmar', () => api.confirmarReparto(ctx.creds, plan(ctx), id), { placementOptionId: id, coste: num(ctx.fila.coste_reparto) })
    }
    case 'transporte_generar':
      return lanzarTransporte(ctx)
    case 'ventana_generar':
      return lanzarVentana(ctx)
    case 'ventana_confirmar': {
      const v = datosDe(ctx).ventanaElegida
      if (!v) return lanzarVentana(ctx)
      return lanzar(ctx, 'ventana_confirmar', () => api.confirmarVentana(ctx.creds, plan(ctx), v.shipmentId, v.deliveryWindowOptionId), v)
    }
    case 'transporte_confirmar':
      return lanzarConfirmarTransporte(ctx)
    case 'cancelando':
      return lanzar(ctx, 'cancelando', () => api.cancelarPlan(ctx.creds, plan(ctx)))
    default:
      throw new FalloDelEnvio('En este paso no hay nada que reintentar')
  }
}

/* ------------------------------------------------------------------ */
/* Cada paso: qué se hace cuando Amazon dice SUCCESS                    */
/* ------------------------------------------------------------------ */

async function trasExito(ctx: Ctx, paso: PasoEnvio): Promise<void> {
  const d = datosDe(ctx)
  switch (paso) {
    case 'plan':
      return lanzar(ctx, 'embalaje_generar', () => api.generarOpcionesEmbalaje(ctx.creds, plan(ctx)))

    case 'embalaje_generar': {
      const opciones = await api.listarOpcionesEmbalaje(ctx.creds, plan(ctx))
      await guardar(ctx, { envio_datos: { ...d, opcionesEmbalaje: opciones } })
      const auto = embalajeAutomatico(opciones)
      if (!auto) {
        await guardar(ctx, { envio_paso: 'embalaje_elegir' })
        return
      }
      return lanzar(ctx, 'embalaje_confirmar', () => api.confirmarEmbalaje(ctx.creds, plan(ctx), auto.packingOptionId), { packingOptionId: auto.packingOptionId, automatico: true }, { packing_option_id: auto.packingOptionId })
    }

    case 'embalaje_confirmar': {
      const opcion = (d.opcionesEmbalaje ?? []).find((o) => o.packingOptionId === ctx.fila.packing_option_id)
      const grupos = opcion?.grupos ?? []
      const skuAGrupo = await api.mapaDeGrupos(ctx.creds, plan(ctx), grupos)
      await guardar(ctx, { envio_datos: { ...d, skuAGrupo } })
      return lanzarCajas(ctx)
    }

    case 'cajas':
      return lanzar(ctx, 'reparto_generar', () => api.generarOpcionesReparto(ctx.creds, plan(ctx)))

    case 'reparto_generar': {
      const opciones = await api.listarOpcionesReparto(ctx.creds, plan(ctx))
      // El destino de cada envío propuesto (centro y ciudad) para comparar. Como mucho 25 lecturas
      const ids = [...new Set(opciones.flatMap((o) => o.envios))].slice(0, 25)
      const destinos = new Map<string, { destino: string | null; ciudad: string | null }>()
      for (const sid of ids) {
        try {
          const e = await api.verEnvio(ctx.creds, plan(ctx), sid)
          destinos.set(sid, { destino: e.destino, ciudad: e.ciudadDestino })
        } catch {
          destinos.set(sid, { destino: null, ciudad: null })
        }
      }
      const conDestinos = opciones.map((o) => ({ ...o, destinos: o.envios.map((sid) => ({ shipmentId: sid, ...(destinos.get(sid) ?? { destino: null, ciudad: null }) })) }))
      await guardar(ctx, { envio_paso: 'reparto_elegir', envio_datos: { ...d, opcionesReparto: conDestinos } })
      return
    }

    case 'reparto_confirmar': {
      const opcion = (d.opcionesReparto ?? []).find((o) => o.placementOptionId === ctx.fila.placement_option_id)
      const envios: DestinoDeEnvio[] = []
      for (const sid of opcion?.envios ?? []) {
        const e = await api.verEnvio(ctx.creds, plan(ctx), sid)
        envios.push({ shipmentId: sid, confirmacion: e.confirmacion, destino: e.destino, ciudad: e.ciudadDestino, estado: e.estado })
      }
      // fba_envios: un registro por envío real (existe desde la 196)
      for (const e of envios) {
        await ctx.service
          .from('fba_envios')
          .upsert({ remesa_id: ctx.fila.id, shipment_id: e.shipmentId, confirmation_id: e.confirmacion, destino: e.destino, ciudad_destino: e.ciudad, estado: e.estado, updated_at: new Date().toISOString() }, { onConflict: 'remesa_id,shipment_id' })
          .then(({ error }) => {
            if (error) console.error('[envío] fba_envios:', error.message)
          })
      }
      await guardar(ctx, { envio_paso: 'transporte_datos', envio_datos: { ...d, envios } })
      await registrarEnHistorial({ remesaId: ctx.fila.id, actor: 'agencia', userId: ctx.userId, accion: 'envio_amazon', hasta: 'reparto_confirmado', detalle: { envios: envios.map((e) => e.confirmacion ?? e.shipmentId), coste: num(ctx.fila.coste_reparto) } }, ctx.service)
      // LA COTIZACIÓN DE UPS, SOLA (Raúl, 27 nov 2026): con el reparto confirmado se pide ya, para el siguiente día laborable y con el contacto
      // de la dirección del cliente. Se llega al transporte con el precio puesto; si el día o el contacto no valen, se cambian y se vuelve a pedir.
      // Paquetería: los palés se piden a mano desde el mismo paso. Si falta el contacto, se queda esperando los datos como antes
      await cotizarSola(ctx, envios).catch((e) => console.error('[envío] cotización automática:', e instanceof Error ? e.message : e))
      return
    }

    case 'transporte_generar': {
      const opciones = await api.listarOpcionesTransporte(ctx.creds, plan(ctx), ctx.fila.placement_option_id as string)
      const envios = (d.envios ?? []).map((e) => e.shipmentId)
      const prop = proponerTransporte(opciones, envios, new Date(), !!d.palets)
      await guardar(ctx, {
        // Transporte propio: Amazon no cobra nada, no hay coste que el cliente tenga que aceptar
        envio_paso: prop.ok ? 'transporte_listo' : 'transporte_elegir',
        envio_datos: { ...d, opcionesTransporte: opciones, sinAsociado: prop.sinAsociado },
        transporte_seleccion: prop.selecciones,
        coste_transporte: prop.selecciones.length ? prop.total : null,
        moneda_envio: prop.moneda,
        transporte_caduca_at: prop.caduca,
        // Cotización nueva: la aceptación del cliente de antes ya no vale
        transporte_aceptado_por_cliente_at: null,
        transporte_aceptado_ip: null,
        transporte_aceptado_nombre: null,
        transporte_aceptado_coste: null,
      })
      return
    }

    case 'ventana_generar': {
      const sid = d.ventanasPendientes?.[0]
      if (!sid) return lanzarConfirmarTransporte(ctx)
      const v = api.primeraVentana(await api.listarVentanas(ctx.creds, plan(ctx), sid))
      if (!v) {
        // A4.4: se apunta como FALLO del paso: así «Reintentar» vuelve a generar las ventanas (con la operación en «ok», reintentar solo releía la lista)
        const texto = `Amazon no ha dado ninguna ventana de entrega válida para ${sid}: pulsa «Reintentar» para pedir otras`
        await ctx.service.from('fba_inbound_operaciones').insert({ remesa_id: ctx.fila.id, paso: 'ventana_generar', operacion: OPERACION_DEL_PASO.ventana_generar ?? 'ventana_generar', estado: 'fallo', problemas: [{ code: null, message: texto, details: null, severity: 'ERROR' }], actor: ctx.actor, user_id: ctx.userId, terminada_at: new Date().toISOString() })
        await guardar(ctx, { envio_error: texto })
        return
      }
      const elegida = { shipmentId: sid, deliveryWindowOptionId: v.deliveryWindowOptionId, desde: v.desde, hasta: v.hasta }
      await guardar(ctx, { envio_datos: { ...d, ventanaElegida: elegida } })
      return lanzar(ctx, 'ventana_confirmar', () => api.confirmarVentana(ctx.creds, plan(ctx), sid, v.deliveryWindowOptionId), elegida)
    }

    case 'ventana_confirmar': {
      const resto = (d.ventanasPendientes ?? []).slice(1)
      await guardar(ctx, { envio_datos: { ...d, ventanasPendientes: resto, ventanaElegida: null } })
      return resto.length ? lanzarVentana(ctx) : lanzarConfirmarTransporte(ctx)
    }

    case 'transporte_confirmar': {
      const sel = ctx.fila.transporte_seleccion ?? []
      const ahora = new Date()
      // voidableUntil de Amazon; si no lo da en paquetería asociada, las 24 h del FAQ desde ahora
      const anulable = resumirSelecciones(sel).anulableHasta ?? (sel.some((s) => s.solucion === 'AMAZON_PARTNERED_CARRIER' && s.modo === 'SMALL_PARCEL') ? new Date(ahora.getTime() + 24 * 3_600_000).toISOString() : null)
      // Las cajas de Amazon (boxId) de cada envío, emparejadas con las nuestras
      const cajas = await cajasDeRemesa(ctx.fila.id, ctx.service)
      const cajasAmazon: NonNullable<DatosDelEnvio['cajasAmazon']> = {}
      const avisos = [...(d.avisos ?? [])]
      // Primero se leen las cajas de TODOS los envíos y luego se emparejan de una vez: cada caja del ERP recibe una sola etiqueta de Amazon
      const leidas: Array<{ shipmentId: string; cajas: Awaited<ReturnType<typeof api.cajasDelEnvio>> }> = []
      for (const e of d.envios ?? []) {
        try {
          leidas.push({ shipmentId: e.shipmentId, cajas: await api.cajasDelEnvio(ctx.creds, plan(ctx), e.shipmentId) })
        } catch (err) {
          avisos.push(`No se han podido leer las cajas de ${e.confirmacion ?? e.shipmentId}: ${textoDeFallo(err)}`)
        }
      }
      const emparejadas = emparejarCajasDeEnvios(cajas.cajas, leidas)
      for (const l of leidas) cajasAmazon[l.shipmentId] = l.cajas.map((b) => ({ boxId: b.boxId, numero: emparejadas.pares.find((p) => p.boxId === b.boxId)?.numero ?? null }))
      // Las etiquetas viejas de un intento anterior se quitan antes, para que ninguna caja se quede con el boxId de otro envío
      if (leidas.length > 0) await ctx.service.from('fba_cajas').update({ box_id_amazon: null }).eq('remesa_id', ctx.fila.id)
      for (const p of emparejadas.pares) {
        await ctx.service.from('fba_cajas').update({ box_id_amazon: p.boxId }).eq('remesa_id', ctx.fila.id).eq('numero', p.numero)
      }
      if (emparejadas.sinPareja.length > 0 || (leidas.length === (d.envios ?? []).length && emparejadas.sobran.length > 0)) {
        avisos.push(
          `${emparejadas.sinPareja.length} caja(s) de Amazon sin caja del ERP${emparejadas.sobran.length ? ` y ${emparejadas.sobran.length} caja(s) del ERP (${emparejadas.sobran.join(', ')}) sin etiqueta` : ''}: revisa el encaje antes de pegar etiquetas`,
        )
      }
      for (const s of sel) {
        await ctx.service
          .from('fba_envios')
          .update({ transportation_option_id: s.transportationOptionId, transportista: s.transportista, es_de_amazon: s.solucion === 'AMAZON_PARTNERED_CARRIER', coste: s.coste, moneda: s.moneda, updated_at: ahora.toISOString() })
          .eq('remesa_id', ctx.fila.id)
          .eq('shipment_id', s.shipmentId)
      }
      await guardar(ctx, { envio_paso: 'etiquetas', transporte_confirmado_at: ahora.toISOString(), anulable_hasta: anulable, envio_datos: { ...d, cajasAmazon, avisos } })
      await registrarEnHistorial({ remesaId: ctx.fila.id, actor: 'agencia', userId: ctx.userId, accion: 'envio_amazon', hasta: 'transporte_confirmado', detalle: { coste: num(ctx.fila.coste_transporte), moneda: ctx.fila.moneda_envio, anulableHasta: anulable } }, ctx.service)
      return
    }

    case 'cancelando': {
      const anteriores = [...(d.planesCancelados ?? [])]
      if (ctx.fila.inbound_plan_id) anteriores.push(ctx.fila.inbound_plan_id)
      await guardar(ctx, { envio_paso: 'cancelado', envio_cajas_bloqueadas_at: null, envio_datos: { ...d, planesCancelados: anteriores } })
      // A4.8: los FBA de este plan quedan cancelados también en el ERP. Si la remesa ya estaba «enviada» con uno de ellos, su estado de Amazon pasa a
      // CANCELLED: si no, el plan seguía contando esas unidades «de camino» semanas. La remesa no se mueve sola de paso: se avisa
      const sids = (d.envios ?? []).map((e) => e.shipmentId)
      const fbas = (d.envios ?? []).map((e) => (e.confirmacion ?? '').trim().toUpperCase()).filter(Boolean)
      if (sids.length > 0) await ctx.service.from('fba_envios').update({ estado: 'CANCELLED', updated_at: new Date().toISOString() }).eq('remesa_id', ctx.fila.id).in('shipment_id', sids)
      const { data: rem } = await ctx.service.from('fba_remesas').select('estado, referencia_envio').eq('id', ctx.fila.id).maybeSingle()
      const r = rem as { estado: string; referencia_envio: string | null } | null
      if (r && r.estado === 'enviada' && r.referencia_envio && fbas.includes(r.referencia_envio.trim().toUpperCase())) {
        await ctx.service.from('fba_remesas').update({ estado_amazon: 'CANCELLED', seguimiento_error: null, updated_at: new Date().toISOString() }).eq('id', ctx.fila.id)
        const dd = datosDe(ctx)
        await guardar(ctx, { envio_datos: { ...dd, avisos: [...(dd.avisos ?? []), 'Envío cancelado en Amazon: devuelve la remesa a «Lista» para reenviarla.'].slice(-20) } })
      }
      await registrarEnHistorial({ remesaId: ctx.fila.id, actor: 'agencia', userId: ctx.userId, accion: 'envio_amazon', hasta: 'cancelado', detalle: { plan: ctx.fila.inbound_plan_id, fba: fbas } }, ctx.service)
      return
    }

    default:
      return
  }
}

/* ------------------------------------------------------------------ */
/* Sondeo: preguntar por la operación en curso                          */
/* ------------------------------------------------------------------ */

/**
 * Pregunta UNA vez por la operación en curso de la remesa (si toca) y, si acabó, sigue. Lo llama la
 * pantalla cada pocos segundos solo mientras hay algo en marcha. No espera nunca.
 */
export async function avanzar(remesaId: string, userId: string | null, service: ClienteDeBase = createServiceClient()): Promise<void> {
  const r = await leerRemesa(remesaId, service)
  if (!r || r.sinMigrar) return
  const f = r.fila
  if (f.envio_modo !== 'api') return
  const { data, error } = await service
    .from('fba_inbound_operaciones')
    .select('id, paso, operation_id, comprobaciones, comprobada_at, created_at')
    .eq('remesa_id', remesaId)
    .eq('estado', 'en_curso')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    if (faltaLaMigracion(error)) return
    throw error
  }
  if (!data) {
    // Un paso «en curso» sin operación viva (se cortó entre apuntar el paso y llamar a Amazon): pasados
    // dos minutos se enseña como error para poder reintentar o cancelar
    const paso = pasoDe(f)
    const desde = Date.parse(f.envio_actualizado_at ?? '')
    if (pasoEnCurso(paso) && !f.envio_error && Number.isFinite(desde) && Date.now() - desde > 120_000) {
      // A4.2: si la última operación de ESTE paso acabó bien hace poco, lo que pasa es que el seguimiento (trasExito) aún está trabajando (puede tardar:
      // el reparto lee hasta 25 envíos). No es una operación perdida: no se pone el aviso (si no, salían Reintentar/Cancelar y Reintentar lo repetía)
      const { data: ultima } = await service.from('fba_inbound_operaciones').select('paso, estado, terminada_at').eq('remesa_id', remesaId).order('created_at', { ascending: false }).limit(1).maybeSingle()
      const u = ultima as { paso: string; estado: string; terminada_at: string | null } | null
      const recienAcabada = u && u.paso === paso && u.estado === 'ok' && u.terminada_at && Date.now() - Date.parse(u.terminada_at) < 3 * 60_000
      if (!recienAcabada) {
        await service.from('fba_remesas').update({ envio_error: TEXTO_SIN_OPERACION }).eq('id', remesaId).eq('envio_paso', paso).is('envio_error', null)
      }
    }
    return
  }
  const op = data as { id: string; paso: string; operation_id: string | null; comprobaciones: number; comprobada_at: string | null; created_at: string }
  const ultima = Date.parse(op.comprobada_at ?? op.created_at)
  if (Date.now() - ultima < ENTRE_COMPROBACIONES_MS) return
  if (!op.operation_id) return

  const creds = await credencialesDe(f)
  // Se apunta la comprobación antes de preguntar: otra pantalla que llegue ahora no repite
  const { data: marcada } = await service
    .from('fba_inbound_operaciones')
    .update({ comprobada_at: new Date().toISOString(), comprobaciones: op.comprobaciones + 1 })
    .eq('id', op.id)
    .eq('estado', 'en_curso')
    .eq('comprobaciones', op.comprobaciones)
    .select('id')
  if (!((marcada as unknown[] | null) ?? []).length) return

  let res: api.ResultadoOperacion
  try {
    res = await api.estadoDeOperacion(creds, op.operation_id)
  } catch (e) {
    // Un fallo al PREGUNTAR no es un fallo de la operación: se vuelve a preguntar en la siguiente vuelta
    console.error('[envío] getInboundOperationStatus:', textoDeFallo(e))
    return
  }
  if (res.estado === 'en_curso') return

  const { data: cerrada } = await service
    .from('fba_inbound_operaciones')
    .update({ estado: res.estado, problemas: res.problemas, terminada_at: new Date().toISOString() })
    .eq('id', op.id)
    .eq('estado', 'en_curso')
    .select('id')
  if (!((cerrada as unknown[] | null) ?? []).length) return
  // El reloj de «no hay operación en marcha» cuenta desde aquí, no desde que se lanzó (A4.2)
  await service.from('fba_remesas').update({ envio_actualizado_at: new Date().toISOString() }).eq('id', remesaId)

  const ctx: Ctx = { service, fila: f, creds, userId, actor: 'sistema' }
  const paso = esPasoEnvio(op.paso) ? op.paso : pasoDe(f)
  // Una operación que ya no es la del paso actual (sobrante de una carrera) se cierra pero NO mueve el envío:
  // seguirla haría saltar el paso hacia atrás o relanzar algo ya hecho
  if (paso !== pasoDe(f)) {
    console.error(`[envío] operación ${op.operation_id} del paso ${paso} acabada con el envío en ${pasoDe(f)}: no se sigue`)
    return
  }
  if (res.estado === 'fallo') {
    await guardar(ctx, { envio_error: res.texto })
    await registrarEnHistorial({ remesaId, actor: 'sistema', accion: 'envio_amazon', hasta: paso, detalle: { paso, error: res.texto } }, service)
    return
  }
  if (res.problemas.length) {
    const d = datosDe(ctx)
    await guardar(ctx, { envio_datos: { ...d, avisos: [...(d.avisos ?? []), ...res.problemas.map((p) => p.message)].slice(-20) } })
  }
  try {
    await trasExito(ctx, paso)
  } catch (e) {
    await guardar(ctx, { envio_error: textoDeFallo(e) })
  }
}

/* ------------------------------------------------------------------ */
/* Las acciones de la agencia                                          */
/* ------------------------------------------------------------------ */

export interface ParametrosDeAccion {
  packingOptionId?: string
  placementOptionId?: string
  transportationOptionId?: string
  dia?: string
  contacto?: { nombre?: string; telefono?: string; email?: string }
  /** La palabra escrita para confirmar (CANCELAR en una cancelación grave) */
  palabra?: string
  palets?: { cantidad?: number; largoCm?: number; anchoCm?: number; altoCm?: number; pesoKg?: number; apilable?: boolean; confirmarPeso?: boolean }
  bol?: string
  fletes?: string[]
}

export async function cambiarModo(remesaId: string, modo: ModoEnvio, userId: string, service: ClienteDeBase = createServiceClient()): Promise<void> {
  const r = await leerRemesa(remesaId, service)
  if (!r) throw new FalloDelEnvio('Esa remesa ya no existe', 404)
  if (r.sinMigrar) throw new FalloDelEnvio('Falta lanzar la migración 310 para enviar desde el ERP', 503)
  const paso = pasoDe(r.fila)
  if (!['sin_empezar', 'cancelado'].includes(paso)) throw new FalloDelEnvio('Con un plan en marcha en Amazon no se cambia el modo: cancélalo antes')
  if (!['aprobada', 'encajando', 'lista'].includes(r.fila.estado)) throw new FalloDelEnvio('El modo se elige antes de enviar: esta remesa ya no está en preparación')
  if (modo === 'api' && !r.fila.connection_id) throw new FalloDelEnvio('Este cliente no tiene la cuenta de Amazon conectada: solo puede ir en modo manual')
  const { error } = await service.from('fba_remesas').update({ envio_modo: modo, envio_actualizado_at: new Date().toISOString() }).eq('id', remesaId)
  if (error) throw error
  await registrarEnHistorial({ remesaId, actor: 'agencia', userId, accion: 'envio_amazon', hasta: `modo_${modo}`, detalle: { modo } }, service)
}

export async function ejecutarAccion(remesaId: string, accion: AccionEnvio, p: ParametrosDeAccion, userId: string, service: ClienteDeBase = createServiceClient()): Promise<void> {
  const r = await leerRemesa(remesaId, service)
  if (!r) throw new FalloDelEnvio('Esa remesa ya no existe', 404)
  if (r.sinMigrar) throw new FalloDelEnvio('Falta lanzar la migración 310 para enviar desde el ERP', 503)
  const f = r.fila
  const paso = pasoDe(f)
  const permitidas = accionesPermitidas({ modo: f.envio_modo, paso, conError: !!f.envio_error, clienteAcepto: !!f.transporte_aceptado_por_cliente_at, anulableHasta: f.anulable_hasta, sinCobro: sinCobroDeAmazon(f.transporte_seleccion ?? []), conPalets: !!f.envio_datos?.palets })
  if (!permitidas.includes(accion)) throw new FalloDelEnvio(`Ahora no se puede: el envío está en «${TEXTO_DEL_PASO[paso]}». Recarga para ver lo último.`)
  const creds = await credencialesDe(f)
  const ctx: Ctx = { service, fila: f, creds, userId, actor: 'agencia' }

  const apuntar = (hasta: string, detalle: Record<string, unknown> = {}) => registrarEnHistorial({ remesaId, actor: 'agencia', userId, accion: 'envio_amazon', hasta, detalle }, service)

  try {
    await hacer(ctx, accion, p, paso, apuntar)
  } catch (e) {
    // Si el paso quedó «en curso» sin operación (falló algo nuestro antes de llamar a Amazon), se deja el
    // error a la vista para que se pueda reintentar o cancelar en vez de esperar para siempre
    if (pasoEnCurso(pasoDe(ctx.fila)) && !ctx.fila.envio_error) await guardar(ctx, { envio_error: textoDeFallo(e) }).catch(() => undefined)
    throw e
  }
}

async function hacer(ctx: Ctx, accion: AccionEnvio, p: ParametrosDeAccion, paso: PasoEnvio, apuntar: (hasta: string, detalle?: Record<string, unknown>) => Promise<void>): Promise<void> {
  const { service, fila: f, creds, userId } = ctx
  const remesaId = f.id
  switch (accion) {
    case 'iniciar': {
      if (!(await moverPaso(ctx, ['sin_empezar', 'cancelado'], { envio_paso: 'plan', envio_error: null }))) throw new FalloDelEnvio('Alguien acaba de empezar el envío. Recarga.')
      try {
        await lanzarPlan(ctx)
      } catch (e) {
        // Las validaciones fallan ANTES de llamar a Amazon: se devuelve el paso como estaba
        await guardar(ctx, { envio_paso: paso, envio_cajas_bloqueadas_at: null })
        throw e
      }
      await apuntar('plan', { remesa: f.nombre })
      return
    }
    case 'elegir_embalaje': {
      const o = (f.envio_datos?.opcionesEmbalaje ?? []).find((x) => x.packingOptionId === p.packingOptionId)
      if (!o) throw new FalloDelEnvio('Esa opción de embalaje ya no existe')
      if (!(await moverPaso(ctx, 'embalaje_elegir', { envio_paso: 'embalaje_confirmar', packing_option_id: o.packingOptionId }))) throw new FalloDelEnvio('Alguien acaba de cambiar el envío. Recarga.')
      return lanzar(ctx, 'embalaje_confirmar', () => api.confirmarEmbalaje(creds, plan(ctx), o.packingOptionId), { packingOptionId: o.packingOptionId })
    }
    case 'reenviar_cajas': {
      if (f.estado !== 'lista') throw new FalloDelEnvio('Termina de encajar (remesa «Lista para enviar») antes de mandar las cajas otra vez')
      // Se reclama el paso ANTES de llamar a Amazon: un doble clic o dos pantallas lanzaban dos
      // setPackingInformation y la operación sobrante, al acabar, movía el envío hacia atrás.
      // Las opciones de reparto viejas dejan de valer: se regeneran tras mandar las cajas
      if (!(await moverPaso(ctx, ['cajas_reabiertas', 'cajas_conflicto'], { envio_paso: 'cajas', envio_error: null, placement_option_id: null, envio_datos: { ...(f.envio_datos ?? {}), opcionesReparto: [] } })))
        throw new FalloDelEnvio('Alguien acaba de cambiar el envío. Recarga.')
      try {
        await lanzarCajas(ctx)
      } catch (e) {
        // Una validación nuestra falla ANTES de llamar a Amazon: el paso vuelve a donde estaba
        await guardar(ctx, { envio_paso: paso })
        throw e
      }
      await apuntar('cajas_reenviadas')
      return
    }
    case 'reabrir_cajas': {
      if (!(await moverPaso(ctx, ['cajas_conflicto', 'reparto_elegir', 'cajas'], { envio_paso: 'cajas_reabiertas', envio_error: null, envio_cajas_bloqueadas_at: null, placement_option_id: null }))) throw new FalloDelEnvio('Alguien acaba de cambiar el envío. Recarga.')
      // Y la remesa vuelve a «Encajando» para que se puedan tocar (en el ERP y en el enlace)
      if (f.estado === 'lista') await service.from('fba_remesas').update({ estado: 'encajando', encajado_at: new Date().toISOString() }).eq('id', remesaId).eq('estado', 'lista')
      await apuntar('cajas_reabiertas')
      return
    }
    case 'confirmar_reparto': {
      const o = resumirReparto(f.envio_datos?.opcionesReparto ?? []).find((x) => x.placementOptionId === p.placementOptionId)
      if (!o) throw new FalloDelEnvio('Esa opción de reparto ya no existe')
      if (o.caducada) throw new FalloDelEnvio('Esa opción de reparto ha caducado: vuelve a mandar las cajas para que Amazon la recalcule')
      if (!(await moverPaso(ctx, 'reparto_elegir', { envio_paso: 'reparto_confirmar', placement_option_id: o.placementOptionId, coste_reparto: o.neto, moneda_envio: o.moneda }))) throw new FalloDelEnvio('Alguien acaba de cambiar el envío. Recarga.')
      await apuntar('reparto_confirmando', { placementOptionId: o.placementOptionId, centros: o.centros, coste: o.neto, moneda: o.moneda })
      return lanzar(ctx, 'reparto_confirmar', () => api.confirmarReparto(creds, plan(ctx), o.placementOptionId), { placementOptionId: o.placementOptionId, coste: o.neto, centros: o.centros })
    }
    case 'generar_transporte': {
      const fecha = fechaDeRecogida(p.dia ?? '')
      if (!fecha.ok) throw new FalloDelEnvio(fecha.error, 400)
      const dir = await direccionDe(f.client_id, service)
      const nombre = (p.contacto?.nombre ?? dir?.nombre ?? '').trim()
      const telefono = (p.contacto?.telefono ?? dir?.telefono ?? '').trim()
      const email = (p.contacto?.email ?? dir?.email ?? '').trim()
      if (!nombre || !telefono) throw new FalloDelEnvio('Falta el contacto de la recogida (nombre y teléfono)', 400)
      const recogida = { dia: p.dia as string, iso: fecha.iso, contacto: { nombre: nombre.slice(0, 80), telefono: telefono.slice(0, 30), email: email.slice(0, 120) || null } }
      // Palés (LTL) o paquetería: lo que se escribió ahora manda sobre lo de antes
      let palets: DatosPalets | null = null
      if (p.palets) {
        const v = validarPalets(p.palets)
        if (!v.ok) throw new FalloDelEnvio(v.error, 400)
        if ((f.envio_datos?.envios ?? []).length > 1) throw new FalloDelEnvio('El reparto de Amazon tiene más de un envío: los palés con varios destinos se hacen en Seller Central', 400)
        // A4.7: el peso de los palés tiene que cuadrar con el de las cajas (un error aquí encarece o bloquea la recogida), salvo que se confirme a mano
        if (p.palets.confirmarPeso !== true) {
          const pesoCajas = (await cajasDeRemesa(f.id, service)).pesoTotalKg
          const c = cuadraPesoPalets(v.palets, pesoCajas)
          if (!c.ok) throw new FalloDelEnvio(c.texto, 400)
        }
        palets = v.palets
      }
      if (!(await moverPaso(ctx, ['transporte_datos', 'transporte_elegir', 'transporte_cliente', 'transporte_listo'], { envio_paso: 'transporte_generar', envio_datos: { ...(f.envio_datos ?? {}), recogida, palets } }))) throw new FalloDelEnvio('Alguien acaba de cambiar el envío. Recarga.')
      await lanzarTransporte(ctx)
      await apuntar('transporte_cotizando', { recogida: p.dia, palets: palets?.cantidad ?? 0 })
      return
    }
    case 'elegir_transporte': {
      const nuevas = cambiarSeleccion(f.transporte_seleccion ?? [], f.envio_datos?.opcionesTransporte ?? [], p.transportationOptionId ?? '')
      if (typeof nuevas === 'string') throw new FalloDelEnvio(nuevas)
      const envios = (f.envio_datos?.envios ?? []).map((e) => e.shipmentId)
      const sin = envios.filter((sid) => !nuevas.some((s) => s.shipmentId === sid))
      const res = resumirSelecciones(nuevas, sin)
      if (!(await moverPaso(ctx, ['transporte_elegir', 'transporte_cliente', 'transporte_listo'], {
        envio_paso: res.ok ? 'transporte_listo' : 'transporte_elegir',
        transporte_seleccion: nuevas,
        coste_transporte: res.total,
        moneda_envio: res.moneda,
        transporte_caduca_at: res.caduca,
        transporte_aceptado_por_cliente_at: null,
        transporte_aceptado_ip: null,
        transporte_aceptado_nombre: null,
        transporte_aceptado_coste: null,
      })))
        throw new FalloDelEnvio('Alguien acaba de cambiar el envío. Recarga.')
      await apuntar('transporte_elegido', { coste: res.total, moneda: res.moneda })
      return
    }
    case 'confirmar_transporte': {
      const coste = num(f.coste_transporte)
      const sel = f.transporte_seleccion ?? []
      const sinCobro = sinCobroDeAmazon(sel)
      // El transporte lo confirma siempre la agencia (Raúl, 27 nov 2026): el cliente ya no tiene que aceptar el coste en su enlace
      if (!sinCobro && !cotizacionVigente(f.transporte_caduca_at)) throw new FalloDelEnvio('La cotización de Amazon ha caducado: vuelve a pedirla')
      const conVentana = sel.filter((s) => s.necesitaVentana).map((s) => s.shipmentId)
      if (!(await moverPaso(ctx, ['transporte_cliente', 'transporte_listo'], { envio_paso: conVentana.length ? 'ventana_generar' : 'transporte_confirmar', transporte_confirmado_por: userId, envio_datos: { ...(f.envio_datos ?? {}), ventanasPendientes: conVentana, ventanaElegida: null } }))) throw new FalloDelEnvio('Alguien acaba de cambiar el envío. Recarga.')
      await apuntar('transporte_confirmando', { coste, moneda: f.moneda_envio })
      return conVentana.length ? lanzarVentana(ctx) : lanzarConfirmarTransporte(ctx)
    }
    case 'guardar_seguimiento': {
      const d = f.envio_datos ?? {}
      const envio = (d.envios ?? [])[0]
      if (!envio || !f.inbound_plan_id) throw new FalloDelEnvio('No hay envío en Amazon')
      const bol = (p.bol ?? '').trim() || envio.confirmacion || ''
      if (!bol) throw new FalloDelEnvio('Falta el número de conocimiento de embarque (BOL)', 400)
      if (!/^[A-Za-z0-9._/ -]{3,60}$/.test(bol)) throw new FalloDelEnvio('El BOL solo puede llevar letras, números y - . / (de 3 a 60 caracteres)', 400)
      const fletes = (p.fletes ?? []).map((x) => x.trim()).filter(Boolean).slice(0, 10)
      const op = await api.guardarSeguimientoLtl(creds, f.inbound_plan_id, envio.shipmentId, bol, fletes)
      // A4.5: solo cuenta como guardado si Amazon lo ACEPTA. Se pregunta por la operación unas pocas veces; si la rechaza, no se guarda y se dice por qué;
      // si sigue procesándose, queda «pendiente» (la pantalla lo dice) y se puede volver a guardar
      let estadoBol: 'ok' | 'pendiente' = 'pendiente'
      const operationId = op?.operationId ?? null
      if (operationId) {
        for (let i = 0; i < 5; i++) {
          await new Promise((r) => setTimeout(r, 1500))
          const res = await api.estadoDeOperacion(creds, operationId).catch(() => null)
          if (!res || res.estado === 'en_curso') continue
          if (res.estado === 'fallo') throw new FalloDelEnvio(`Amazon ha rechazado el seguimiento: ${res.texto}`, 400)
          estadoBol = 'ok'
          break
        }
      } else estadoBol = 'ok'
      await guardar(ctx, { envio_datos: { ...d, seguimientoLtl: { bol, fletes, at: new Date().toISOString(), estado: estadoBol, operationId } } })
      await apuntar('seguimiento_palets', { bol, envio: envio.confirmacion })
      return
    }
    case 'reintentar': {
      // Solo uno reintenta: se quita el error si sigue puesto
      const { data: suelto, error: errSuelto } = await service.from('fba_remesas').update({ envio_error: null }).eq('id', remesaId).eq('envio_paso', paso).not('envio_error', 'is', null).select('id')
      if (errSuelto) throw errSuelto
      if (!((suelto as unknown[] | null) ?? []).length) throw new FalloDelEnvio('Alguien ya lo está reintentando. Recarga.')
      ctx.fila.envio_error = null
      // A4.4: las ventanas de entrega caducan. Reintentar en sus pasos las vuelve a GENERAR (generar no confirma nada) y olvida la elegida, que puede
      // estar caducada; salvo que la confirmación ya esté hecha en Amazon, que entonces se sigue
      if (paso === 'ventana_generar' || paso === 'ventana_confirmar') {
        if (paso === 'ventana_confirmar' && (await yaAplicadoEnAmazon(ctx, paso))) {
          await service.from('fba_inbound_operaciones').insert({ remesa_id: remesaId, paso, operacion: OPERACION_DEL_PASO[paso] ?? paso, estado: 'ok', peticion: { comprobado: true }, actor: ctx.actor, user_id: ctx.userId, terminada_at: new Date().toISOString() })
          return trasExito(ctx, paso)
        }
        await guardar(ctx, { envio_datos: { ...(ctx.fila.envio_datos ?? {}), ventanaElegida: null } })
        return lanzarVentana(ctx)
      }
      /**
       * Si la operación de Amazon de este paso acabó BIEN y lo que falló fue lo de después (leer opciones, leer
       * los envíos…), se repite solo lo de después. Relanzar un confirmPlacementOption ya hecho daría error o,
       * peor, un segundo intento sobre algo confirmado.
       */
      const { data: ultima } = await service.from('fba_inbound_operaciones').select('paso, estado').eq('remesa_id', remesaId).order('created_at', { ascending: false }).limit(1).maybeSingle()
      const u = ultima as { paso: string; estado: string } | null
      if (u && u.paso === paso && u.estado === 'ok') {
        try {
          await trasExito(ctx, paso)
        } catch (e) {
          await guardar(ctx, { envio_error: textoDeFallo(e) })
          throw e
        }
        return
      }
      // A4.3: un CONFIRMAR que llegó a Amazon pero cuya respuesta se perdió no se repite a ciegas (Amazon lo rechaza siempre y la única salida era
      // cancelar, que borra envíos FBA reales): se mira en Amazon, solo leyendo, si ya está hecho. Si lo está, se sigue como si la operación hubiera acabado bien
      if (await yaAplicadoEnAmazon(ctx, paso)) {
        await service.from('fba_inbound_operaciones').insert({ remesa_id: remesaId, paso, operacion: OPERACION_DEL_PASO[paso] ?? paso, estado: 'ok', peticion: { comprobado: true }, actor: ctx.actor, user_id: ctx.userId, terminada_at: new Date().toISOString() })
        try {
          await trasExito(ctx, paso)
        } catch (e) {
          await guardar(ctx, { envio_error: textoDeFallo(e) })
          throw e
        }
        return
      }
      return relanzar(ctx, paso)
    }
    case 'cancelar': {
      // Si cancelar deshace envíos FBA reales, la palabra se exige AQUÍ, con el paso leído de la base: no vale
      // fiarse de lo que diga la pantalla (que podía mandar grave: false y saltarse la confirmación)
      if (cancelabilidad(paso, f.anulable_hasta).grave && (p.palabra ?? '').trim().toUpperCase() !== 'CANCELAR') throw new FalloDelEnvio('Para cancelar envíos FBA ya creados hay que escribir «CANCELAR»', 400)
      if (!f.inbound_plan_id) {
        await guardar(ctx, { envio_paso: 'cancelado', envio_error: null, envio_cajas_bloqueadas_at: null })
        await apuntar('cancelado', { sinPlan: true })
        return
      }
      if (!(await moverPaso(ctx, paso, { envio_paso: 'cancelando' }))) throw new FalloDelEnvio('Alguien acaba de cambiar el envío. Recarga.')
      await apuntar('cancelando', { plan: f.inbound_plan_id, desde: paso })
      return lanzar(ctx, 'cancelando', () => api.cancelarPlan(creds, plan(ctx)), { plan: f.inbound_plan_id, desde: paso })
    }
  }
}

/* ------------------------------------------------------------------ */
/* Seguimiento y etiquetas                                              */
/* ------------------------------------------------------------------ */

/** Lee de Amazon el estado del plan y de cada envío (solo lectura). Se pide con un botón, no en bucle */
export async function refrescarSeguimiento(remesaId: string, service: ClienteDeBase = createServiceClient()): Promise<void> {
  const r = await leerRemesa(remesaId, service)
  if (!r || r.sinMigrar) throw new FalloDelEnvio('Esa remesa ya no existe', 404)
  const f = r.fila
  if (!f.inbound_plan_id) throw new FalloDelEnvio('No hay plan en Amazon')
  const creds = await credencialesDe(f)
  const p = await api.verPlan(creds, f.inbound_plan_id)
  const envios = []
  for (const e of (f.envio_datos?.envios ?? []).slice(0, 20)) {
    const v = await api.verEnvio(creds, f.inbound_plan_id, e.shipmentId)
    envios.push({ shipmentId: e.shipmentId, confirmacion: v.confirmacion, estado: v.estado, destino: v.destino, seguimientos: v.seguimientos.length, invalidos: v.seguimientos.filter((s) => (s.valido ?? '').toUpperCase() === 'INVALID').length, numeros: [...new Set(v.seguimientos.map((x) => x.numero).filter((x): x is string => !!x))] })
  }
  const seguimiento = { at: new Date().toISOString(), estadoPlan: p.estado, envios }
  await service.from('fba_remesas').update({ envio_datos: { ...(f.envio_datos ?? {}), seguimiento } }).eq('id', remesaId)
}

/**
 * Los enlaces de descarga de las etiquetas de caja (con la de UPS) de cada envío. Caducan: se piden al
 * pulsar, no se guardan. Solo con el transporte confirmado.
 */
export async function enlacesDeEtiquetas(remesaId: string, hoja: api.HojaDeCaja, service: ClienteDeBase = createServiceClient()): Promise<Array<{ shipmentId: string; confirmacion: string | null; destino: string | null; cajas: number; url: string | null; error: string | null }>> {
  const r = await leerRemesa(remesaId, service)
  if (!r || r.sinMigrar) throw new FalloDelEnvio('Esa remesa ya no existe', 404)
  const f = r.fila
  if (pasoDe(f) !== 'etiquetas' || !f.transporte_confirmado_at) throw new FalloDelEnvio('Las etiquetas salen cuando el transporte está confirmado')
  const creds = await credencialesDe(f)
  const out = []
  for (const e of f.envio_datos?.envios ?? []) {
    let boxIds = (f.envio_datos?.cajasAmazon?.[e.shipmentId] ?? []).map((b) => b.boxId)
    try {
      if (!boxIds.length && f.inbound_plan_id) boxIds = (await api.cajasDelEnvio(creds, f.inbound_plan_id, e.shipmentId)).map((b) => b.boxId)
      if (!e.confirmacion) throw new FalloDelEnvio('Este envío no tiene número FBA todavía')
      const url = await api.etiquetasDeCaja(creds, e.confirmacion, boxIds, hoja)
      out.push({ shipmentId: e.shipmentId, confirmacion: e.confirmacion, destino: e.destino, cajas: boxIds.length, url, error: null })
      await service.from('fba_envios').update({ etiquetas_descargadas_at: new Date().toISOString() }).eq('remesa_id', remesaId).eq('shipment_id', e.shipmentId)
    } catch (err) {
      out.push({ shipmentId: e.shipmentId, confirmacion: e.confirmacion, destino: e.destino, cajas: boxIds.length, url: null, error: textoDeFallo(err) })
    }
  }
  return out
}

/** Las etiquetas de PALÉ (una por palé; se pegan en los 4 lados) de cada envío. Enlaces que caducan */
export async function enlacesDeEtiquetasDePalet(remesaId: string, hoja: api.HojaDeCaja, service: ClienteDeBase = createServiceClient()): Promise<Array<{ shipmentId: string; confirmacion: string | null; destino: string | null; palets: number; url: string | null; error: string | null }>> {
  const r = await leerRemesa(remesaId, service)
  if (!r || r.sinMigrar) throw new FalloDelEnvio('Esa remesa ya no existe', 404)
  const f = r.fila
  const palets = f.envio_datos?.palets
  if (!palets) throw new FalloDelEnvio('Este envío no es de palés')
  if (pasoDe(f) !== 'etiquetas' || !f.transporte_confirmado_at) throw new FalloDelEnvio('Las etiquetas salen cuando el transporte está confirmado')
  const creds = await credencialesDe(f)
  const out = []
  for (const e of f.envio_datos?.envios ?? []) {
    try {
      if (!e.confirmacion) throw new FalloDelEnvio('Este envío no tiene número FBA todavía')
      const url = await api.etiquetasDePalet(creds, e.confirmacion, palets.cantidad, hoja)
      out.push({ shipmentId: e.shipmentId, confirmacion: e.confirmacion, destino: e.destino, palets: palets.cantidad, url, error: null })
    } catch (err) {
      out.push({ shipmentId: e.shipmentId, confirmacion: e.confirmacion, destino: e.destino, palets: palets.cantidad, url: null, error: textoDeFallo(err) })
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* El cliente, desde su enlace                                          */
/* ------------------------------------------------------------------ */

export interface TransporteParaElCliente {
  visible: boolean
  paso: PasoEnvio
  coste: number | null
  moneda: string | null
  caduca: string | null
  vigente: boolean
  transportistas: string[]
  envios: Array<{ confirmacion: string | null; destino: string | null; ciudad: string | null }>
  recogida: string | null
  aceptacion: { at: string; nombre: string | null; coste: number | null } | null
  puedeAceptar: boolean
  confirmadoAt: string | null
  anulableHasta: string | null
  etiquetasDisponibles: boolean
}

export async function transporteParaElCliente(remesaId: string, service: ClienteDeBase = createServiceClient(), ahora = new Date()): Promise<TransporteParaElCliente | null> {
  const r = await leerRemesa(remesaId, service)
  if (!r || r.sinMigrar) return null
  const f = r.fila
  const paso = pasoDe(f)
  if (f.envio_modo !== 'api') return null
  const visible = ['transporte_cliente', 'transporte_listo', 'ventana_generar', 'ventana_confirmar', 'transporte_confirmar', 'etiquetas'].includes(paso)
  if (!visible) return { ...ocultoParaElCliente(paso) }
  const sel = f.transporte_seleccion ?? []
  const vigente = cotizacionVigente(f.transporte_caduca_at, ahora)
  return {
    visible: true,
    paso,
    coste: num(f.coste_transporte),
    moneda: f.moneda_envio,
    caduca: f.transporte_caduca_at,
    vigente,
    transportistas: [...new Set(sel.map((s) => s.transportista ?? 'Transportista de Amazon'))],
    envios: (f.envio_datos?.envios ?? []).map((e) => ({ confirmacion: e.confirmacion, destino: e.destino, ciudad: e.ciudad })),
    recogida: f.envio_datos?.recogida?.dia ?? null,
    aceptacion: f.transporte_aceptado_por_cliente_at ? { at: f.transporte_aceptado_por_cliente_at, nombre: f.transporte_aceptado_nombre, coste: num(f.transporte_aceptado_coste) } : null,
    // El cliente ya no acepta el transporte: lo confirma la agencia (27 nov 2026). En su enlace solo ve el coste
    puedeAceptar: false,
    confirmadoAt: f.transporte_confirmado_at,
    anulableHasta: f.anulable_hasta,
    etiquetasDisponibles: paso === 'etiquetas',
  }
}

function ocultoParaElCliente(paso: PasoEnvio): TransporteParaElCliente {
  return { visible: false, paso, coste: null, moneda: null, caduca: null, vigente: false, transportistas: [], envios: [], recogida: null, aceptacion: null, puedeAceptar: false, confirmadoAt: null, anulableHasta: null, etiquetasDisponibles: false }
}

/**
 * «ACEPTO EL COSTE DEL TRANSPORTE», desde el enlace. Guarda fecha, IP, nombre y el coste que vio. Si el
 * coste ha cambiado mientras miraba, no vale: 409 y que recargue.
 */
export async function aceptarTransporte(remesaId: string, p: { nombre: string; costeVisto: number; ip: string | null; enlaceId: string }, service: ClienteDeBase = createServiceClient()): Promise<{ ok: true } | { ok: false; estado: number; error: string }> {
  const r = await leerRemesa(remesaId, service)
  if (!r || r.sinMigrar) return { ok: false, estado: 404, error: 'Este envío no tiene transporte que aceptar' }
  const f = r.fila
  if (f.envio_modo !== 'api' || pasoDe(f) !== 'transporte_cliente') return { ok: false, estado: 409, error: 'Ahora no hay ningún coste de transporte pendiente de aceptar. Recarga la página.' }
  const coste = num(f.coste_transporte)
  if (coste === null) return { ok: false, estado: 409, error: 'Todavía no hay coste de transporte' }
  if (Math.abs(coste - p.costeVisto) > 0.005) return { ok: false, estado: 409, error: 'El coste ha cambiado mientras lo mirabas. Recarga para ver el nuevo.' }
  if (!cotizacionVigente(f.transporte_caduca_at)) return { ok: false, estado: 409, error: 'La cotización ha caducado. Liberty Seller pedirá una nueva.' }
  const nombre = p.nombre.trim().slice(0, 80)
  if (nombre.length < 2) return { ok: false, estado: 400, error: 'Escribe tu nombre para aceptar' }
  const ahora = new Date().toISOString()
  const { data, error } = await service
    .from('fba_remesas')
    .update({ envio_paso: 'transporte_listo', transporte_aceptado_por_cliente_at: ahora, transporte_aceptado_ip: p.ip, transporte_aceptado_nombre: nombre, transporte_aceptado_coste: coste, envio_actualizado_at: ahora })
    .eq('id', remesaId)
    .eq('envio_paso', 'transporte_cliente')
    .eq('coste_transporte', coste)
    .select('id')
  if (error) throw error
  if (!((data as unknown[] | null) ?? []).length) return { ok: false, estado: 409, error: 'El envío ha cambiado mientras lo mirabas. Recarga la página.' }
  await registrarEnHistorial({ remesaId, actor: 'enlace', enlaceId: p.enlaceId, accion: 'transporte_aceptado', ip: p.ip, detalle: { nombre, coste, moneda: f.moneda_envio } }, service)
  return { ok: true }
}

export { OPERACION_DEL_PASO }

/**
 * ¿Este paso de CONFIRMAR ya está hecho en Amazon? Solo lee (A4.3). Ante cualquier duda o error de lectura, false: se relanza como siempre.
 *   reparto_confirmar     → alguna opción de reparto ACCEPTED
 *   embalaje_confirmar    → alguna opción de embalaje ACCEPTED
 *   transporte_confirmar  → todos los envíos con transporte elegido
 *   ventana_confirmar     → el envío de la ventana con la ventana de entrega puesta
 */
async function yaAplicadoEnAmazon(ctx: Ctx, paso: PasoEnvio): Promise<boolean> {
  if (!ctx.fila.inbound_plan_id) return false
  try {
    if (paso === 'reparto_confirmar') return (await api.listarOpcionesReparto(ctx.creds, plan(ctx))).some((o) => o.estado === 'ACCEPTED')
    if (paso === 'embalaje_confirmar') return (await api.listarOpcionesEmbalaje(ctx.creds, plan(ctx))).some((o) => o.estado === 'ACCEPTED')
    const d = datosDe(ctx)
    if (paso === 'transporte_confirmar') {
      const sids = (ctx.fila.transporte_seleccion ?? []).map((x) => x.shipmentId)
      if (sids.length === 0) return false
      for (const sid of sids) if (!(await api.verEnvio(ctx.creds, plan(ctx), sid)).transporteElegido) return false
      return true
    }
    if (paso === 'ventana_confirmar') {
      const sid = d.ventanaElegida?.shipmentId ?? (d.ventanasPendientes ?? [])[0]
      if (!sid) return false
      return Boolean((await api.verEnvio(ctx.creds, plan(ctx), sid)).entregaDesde)
    }
  } catch (e) {
    console.error('[envío] comprobar si ya está hecho en Amazon:', textoDeFallo(e))
  }
  return false
}
