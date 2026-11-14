import { createServiceClient } from '@/lib/supabase/service'
import { cajasDeRemesa, faltaLaFuncion, type ClienteDeBase } from './cajas'
import type { ResolucionDeEnlace } from './encaje-enlace'
import type { Actor, EstadoRemesa } from './flujo'
import { registrarEnHistorial, type ActorDeHistorial } from './historial'
import {
  MAX_COMENTARIO,
  etiquetasDisponibles,
  faseDelPortal,
  leerLineasDeseadas,
  limpiarNombreDeFirma,
  planVacio,
  planificarCambiosDelCliente,
  puntoDePropuesta,
  resumirDiferencias,
  type FaseDelPortal,
  type LineaDePropuesta,
  type ProductoDeCatalogo,
  type PuntoDePropuesta,
} from './propuesta-cliente'

/**
 * EL PORTAL DEL CLIENTE: UN ENLACE POR ENVÍO PARA TODAS LAS FASES.
 * ================================================================
 * SOLO SERVIDOR.
 *
 * /envio/<token> con las fases Propuesta → Etiquetas → Cajas → Envío. El token es el MISMO de
 * fba_enlaces_encaje (lib/fba/encaje-enlace.ts): mismas reglas (256 bits, caduca, se revoca, uno vivo por
 * envío) y el enlace de encaje de siempre (/encajar/<token>) sigue funcionando.
 *
 * Lo que puede hacer quien tiene el enlace, y nada más:
 *   · Ver la propuesta de ESE envío: qué le proponemos y cuánto.
 *   · Mientras está «con el cliente»: cambiar cantidades, comentar y añadir productos de SU catálogo de
 *     Amazon (FBA de la conexión del envío), y decir «Acepto» con su nombre. Eso NO aprueba: queda pendiente
 *     de revisión por la agencia.
 *   · Con el envío aprobado: descargar las etiquetas FNSKU.
 *   · Encajar (lo de siempre).
 *
 * Todo lo que escribe va por funciones de la base con FOR UPDATE y la versión comprobada (migración 309): si
 * la agencia ha tocado la propuesta mientras él la miraba, 409 y se le pide recargar.
 */

export const rutaDelPortal = (token: string): string => `/envio/${token}`

type Comprobado = Extract<ResolucionDeEnlace, { ok: true }>

export interface Fallo {
  ok: false
  estado: number
  error: string
  conflicto?: boolean
}

const faltaColumna = (e: { code?: string } | null): boolean => e?.code === '42703' || e?.code === 'PGRST204'

/* ------------------------------------------------------------------ */
/* Lo que pinta el portal                                              */
/* ------------------------------------------------------------------ */

export interface DatosDelPortal {
  /** La 309 no está lanzada: la propuesta interactiva no está disponible (el encaje sí) */
  sinMigrar: boolean
  titulo: string
  cliente: string
  fechaEnvio: string
  estado: EstadoRemesa
  fase: FaseDelPortal
  punto: PuntoDePropuesta
  /** ¿Puede tocar la propuesta ahora? */
  editable: boolean
  version: number | null
  propuestaEnviadaAt: string | null
  aceptada: { at: string; nombre: string | null } | null
  comentarioCliente: string | null
  lineas: LineaDePropuesta[]
  /** ¿Tiene catálogo de Amazon en el que buscar para añadir? */
  conCatalogo: boolean
  etiquetas: { disponibles: boolean; ultima: { at: string; etiquetas: number } | null }
  cajas: { cajas: number; unidades: number; pesoKg: number } | null
  /** El nº de envío FBA, cuando lo hay. La fase «Envío» lo enseña */
  referenciaEnvio: string | null
  caducaAt: string
}

const fechaCorta = (f: string) => (/^\d{4}-\d{2}-\d{2}/.test(f) ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : f)

interface FilaRemesaPortal {
  id: string
  connection_id: string | null
  marketplace_id: string
  referencia_envio: string | null
  lineas_version?: number | null
  propuesta_enviada_at?: string | null
  cliente_acepto_at?: string | null
  cliente_acepto_nombre?: string | null
  cliente_comentario?: string | null
}

async function leerRemesa(id: string, service: ClienteDeBase): Promise<{ fila: FilaRemesaPortal; sinMigrar: boolean }> {
  const base = 'id, connection_id, marketplace_id, referencia_envio'
  const con = await service
    .from('fba_remesas')
    .select(`${base}, lineas_version, propuesta_enviada_at, cliente_acepto_at, cliente_acepto_nombre, cliente_comentario`)
    .eq('id', id)
    .maybeSingle()
  if (!con.error && con.data) return { fila: con.data as FilaRemesaPortal, sinMigrar: false }
  if (con.error && !faltaColumna(con.error)) throw con.error
  const sin = await service.from('fba_remesas').select(base).eq('id', id).maybeSingle()
  if (sin.error) throw sin.error
  return { fila: sin.data as FilaRemesaPortal, sinMigrar: true }
}

export async function lineasDePropuesta(remesaId: string, service: ClienteDeBase, sinMigrar = false): Promise<LineaDePropuesta[]> {
  const base = 'sku, unidades, nombre, variante, referencia, asin'
  const r = sinMigrar
    ? await service.from('fba_remesa_lineas').select(base).eq('remesa_id', remesaId)
    : await service.from('fba_remesa_lineas').select(`${base}, unidades_propuestas, anadida_por_cliente, comentario`).eq('remesa_id', remesaId)
  if (r.error) throw r.error
  return ((r.data ?? []) as Array<Record<string, unknown>>)
    .map((l) => ({
      sku: l.sku as string,
      nombre: (l.nombre as string | null) ?? null,
      variante: (l.variante as string | null) ?? null,
      referencia: (l.referencia as string | null) ?? null,
      asin: (l.asin as string | null) ?? null,
      unidades: l.unidades as number,
      propuestas: sinMigrar ? (l.unidades as number) : ((l.unidades_propuestas as number | null) ?? null),
      nueva: sinMigrar ? false : Boolean(l.anadida_por_cliente),
      comentario: sinMigrar ? null : ((l.comentario as string | null) ?? null),
    }))
    .sort((a, b) => Number(a.nueva) - Number(b.nueva) || a.sku.localeCompare(b.sku, 'es', { numeric: true, sensitivity: 'base' }))
}

export async function datosDelPortal(r: Comprobado, service: ClienteDeBase = createServiceClient()): Promise<DatosDelPortal> {
  const { fila, sinMigrar } = await leerRemesa(r.remesa.id, service)
  const lineas = await lineasDePropuesta(r.remesa.id, service, sinMigrar)
  const estado = r.remesa.estado
  const punto = sinMigrar ? (estado === 'borrador' ? 'montando' : 'cerrada') : puntoDePropuesta({ estado, propuestaEnviadaAt: fila.propuesta_enviada_at ?? null, clienteAceptoAt: fila.cliente_acepto_at ?? null })

  // La última tirada de etiquetas, para decirle «ya las descargaste el…»
  let ultima: { at: string; etiquetas: number } | null = null
  {
    const { data } = await service.from('fba_impresiones').select('impreso_at, etiquetas').eq('remesa_id', r.remesa.id).order('impreso_at', { ascending: false }).limit(1).maybeSingle()
    if (data) ultima = { at: (data as { impreso_at: string }).impreso_at, etiquetas: (data as { etiquetas: number }).etiquetas }
  }

  let cajas: DatosDelPortal['cajas'] = null
  if (estado !== 'borrador' && estado !== 'aprobada') {
    const c = await cajasDeRemesa(r.remesa.id, service)
    cajas = { cajas: c.cajas.length, unidades: c.unidadesEncajadas, pesoKg: c.pesoTotalKg }
  }

  return {
    sinMigrar,
    titulo: r.remesa.nombre?.trim() || `Envío del ${fechaCorta(r.remesa.fechaEnvio)}`,
    cliente: r.remesa.clienteNombre,
    fechaEnvio: r.remesa.fechaEnvio,
    estado,
    fase: faseDelPortal(estado),
    punto,
    editable: !sinMigrar && punto === 'con_el_cliente',
    version: fila.lineas_version ?? null,
    propuestaEnviadaAt: fila.propuesta_enviada_at ?? null,
    aceptada: fila.cliente_acepto_at ? { at: fila.cliente_acepto_at, nombre: fila.cliente_acepto_nombre ?? null } : null,
    comentarioCliente: fila.cliente_comentario ?? null,
    lineas,
    conCatalogo: Boolean(fila.connection_id),
    etiquetas: { disponibles: etiquetasDisponibles(estado), ultima },
    cajas,
    referenciaEnvio: fila.referencia_envio,
    caducaAt: r.enlace.caducaAt,
  }
}

/* ------------------------------------------------------------------ */
/* El catálogo del cliente: buscar para añadir                         */
/* ------------------------------------------------------------------ */

export interface ProductoParaAnadir extends ProductoDeCatalogo {
  /** Lo vendible en Amazon ahora mismo, para que decida cuánto mandar */
  vendible: number | null
}

const MAX_RESULTADOS = 30

export async function buscarEnCatalogo(r: Comprobado, q: string, service: ClienteDeBase = createServiceClient()): Promise<{ productos: ProductoParaAnadir[]; hayMas: boolean }> {
  const { fila } = await leerRemesa(r.remesa.id, service)
  if (!fila.connection_id) return { productos: [], hayMas: false }
  const limpia = q.trim().slice(0, 60).replace(/[%_,()\\]/g, ' ').trim()
  let consulta = service
    .from('amazon_listings')
    .select('sku, title, asin, fnsku, fba_fulfillable_quantity')
    .eq('connection_id', fila.connection_id)
    .eq('marketplace_id', fila.marketplace_id)
    .eq('is_fba', true)
  if (limpia) consulta = consulta.or(`sku.ilike.%${limpia}%,title.ilike.%${limpia}%,asin.ilike.%${limpia}%`)
  const { data, error } = await consulta.order('title', { ascending: true, nullsFirst: false }).limit(MAX_RESULTADOS + 1)
  if (error) throw error
  const filas = (data ?? []) as Array<{ sku: string; title: string | null; asin: string | null; fnsku: string | null; fba_fulfillable_quantity: number | null }>
  return {
    hayMas: filas.length > MAX_RESULTADOS,
    productos: filas.slice(0, MAX_RESULTADOS).map((f) => ({ sku: f.sku, titulo: f.title, asin: f.asin, fnsku: f.fnsku, vendible: f.fba_fulfillable_quantity })),
  }
}

/** Los productos del catálogo FBA del envío con estos SKU. Es la comprobación de «solo de su catálogo» */
async function catalogoDe(connectionId: string, marketplaceId: string, skus: string[], service: ClienteDeBase): Promise<Map<string, ProductoDeCatalogo>> {
  const m = new Map<string, ProductoDeCatalogo>()
  for (let i = 0; i < skus.length; i += 200) {
    const { data, error } = await service
      .from('amazon_listings')
      .select('sku, title, asin, fnsku')
      .eq('connection_id', connectionId)
      .eq('marketplace_id', marketplaceId)
      .eq('is_fba', true)
      .in('sku', skus.slice(i, i + 200))
    if (error) throw error
    for (const f of (data ?? []) as Array<{ sku: string; title: string | null; asin: string | null; fnsku: string | null }>) m.set(f.sku, { sku: f.sku, titulo: f.title, asin: f.asin, fnsku: f.fnsku })
  }
  return m
}

/* ------------------------------------------------------------------ */
/* Lo que hace el cliente con la propuesta                             */
/* ------------------------------------------------------------------ */

export type ResultadoDePropuesta = { ok: true; version: number | null; lineas: LineaDePropuesta[] } | Fallo

export async function guardarPropuestaDelCliente(
  r: Comprobado,
  cuerpo: { lineas?: unknown; version?: unknown },
  ip: string | null,
  service: ClienteDeBase = createServiceClient()
): Promise<ResultadoDePropuesta> {
  const { fila, sinMigrar } = await leerRemesa(r.remesa.id, service)
  if (sinMigrar) return { ok: false, estado: 503, error: 'Todavía no se puede cambiar la propuesta desde aquí. Díselo a Liberty Seller.' }
  const punto = puntoDePropuesta({ estado: r.remesa.estado, propuestaEnviadaAt: fila.propuesta_enviada_at ?? null, clienteAceptoAt: fila.cliente_acepto_at ?? null })
  if (punto === 'pendiente_revision') return { ok: false, estado: 409, error: 'Ya has aceptado la propuesta: Liberty Seller la está revisando.' }
  if (punto !== 'con_el_cliente') return { ok: false, estado: 409, error: 'La propuesta ya no se puede cambiar.' }

  const leidas = leerLineasDeseadas(cuerpo.lineas)
  if (!leidas.ok) return { ok: false, estado: 400, error: leidas.error }

  const actuales = await lineasDePropuesta(r.remesa.id, service)
  const existentes = new Set(actuales.map((l) => l.sku))
  const nuevosSkus = leidas.lineas.filter((l) => !existentes.has(l.sku) && l.unidades > 0).map((l) => l.sku)
  const catalogo = nuevosSkus.length > 0 && fila.connection_id ? await catalogoDe(fila.connection_id, fila.marketplace_id, nuevosSkus, service) : new Map<string, ProductoDeCatalogo>()

  const plan = planificarCambiosDelCliente(actuales, leidas.lineas, catalogo)
  if (!plan.ok) return { ok: false, estado: 400, error: plan.error }
  if (planVacio(plan.plan)) return { ok: true, version: fila.lineas_version ?? null, lineas: actuales }

  const version = typeof cuerpo.version === 'number' && Number.isInteger(cuerpo.version) ? cuerpo.version : null
  const { data, error } = await service.rpc('fba_cliente_guardar_propuesta', {
    p_remesa: r.remesa.id,
    p_actualizar: plan.plan.actualizar,
    p_anadir: plan.plan.anadir,
    p_quitar: plan.plan.quitar,
    p_version: version,
  })
  if (error) {
    if (error.code === '40001') return { ok: false, estado: 409, error: 'Liberty Seller ha cambiado la propuesta mientras la mirabas. Recarga la página para ver lo último.', conflicto: true }
    if (error.code === '23514') return { ok: false, estado: 409, error: error.message, conflicto: true }
    if (faltaLaFuncion(error)) return { ok: false, estado: 503, error: 'Todavía no se puede cambiar la propuesta desde aquí. Díselo a Liberty Seller.' }
    throw error
  }

  const lineas = await lineasDePropuesta(r.remesa.id, service)
  const resumen = resumirDiferencias(lineas)
  await registrarEnHistorial(
    {
      remesaId: r.remesa.id,
      actor: 'enlace',
      enlaceId: r.enlace.id,
      accion: 'propuesta_cliente',
      ip,
      detalle: { cambiadas: resumen.mas + resumen.menos + resumen.quitadas, nuevas: resumen.nuevas, unidades: resumen.unidadesCliente },
      agruparMinutos: 20,
    },
    service
  )
  await service.from('fba_enlaces_encaje').update({ ultima_edicion_at: new Date().toISOString() }).eq('id', r.enlace.id)
  return { ok: true, version: typeof data === 'number' ? data : Number(data), lineas }
}

export type ResultadoDeAceptar = { ok: true } | Fallo

/** «Acepto»: queda PENDIENTE DE REVISIÓN, no aprobada. Solo si nadie ha tocado nada desde la versión que vio */
export async function aceptarPropuesta(
  r: Comprobado,
  cuerpo: { nombre?: unknown; comentario?: unknown; version?: unknown },
  ip: string | null,
  service: ClienteDeBase = createServiceClient(),
  ahora = new Date()
): Promise<ResultadoDeAceptar> {
  const nombre = limpiarNombreDeFirma(cuerpo.nombre)
  if (!nombre) return { ok: false, estado: 400, error: 'Escribe tu nombre para aceptar la propuesta.' }
  const comentario = typeof cuerpo.comentario === 'string' ? cuerpo.comentario.trim().slice(0, MAX_COMENTARIO * 3) || null : null

  const { fila, sinMigrar } = await leerRemesa(r.remesa.id, service)
  if (sinMigrar) return { ok: false, estado: 503, error: 'Todavía no se puede aceptar desde aquí. Díselo a Liberty Seller.' }
  const punto = puntoDePropuesta({ estado: r.remesa.estado, propuestaEnviadaAt: fila.propuesta_enviada_at ?? null, clienteAceptoAt: fila.cliente_acepto_at ?? null })
  if (punto === 'pendiente_revision') return { ok: true }
  if (punto !== 'con_el_cliente') return { ok: false, estado: 409, error: 'La propuesta ya no se puede aceptar desde aquí.' }

  const lineas = await lineasDePropuesta(r.remesa.id, service)
  if (!lineas.some((l) => l.unidades > 0)) return { ok: false, estado: 400, error: 'No hay nada que mandar: todos los productos están a 0.' }

  const version = typeof cuerpo.version === 'number' && Number.isInteger(cuerpo.version) ? cuerpo.version : null
  let q = service
    .from('fba_remesas')
    .update({ cliente_acepto_at: ahora.toISOString(), cliente_acepto_nombre: nombre, cliente_acepto_ip: ip, cliente_comentario: comentario })
    .eq('id', r.remesa.id)
    .eq('estado', 'borrador')
    .is('cliente_acepto_at', null)
  if (version !== null) q = q.eq('lineas_version', version)
  const { data, error } = await q.select('id')
  if (error) throw error
  if (((data as unknown[] | null) ?? []).length === 0) {
    return { ok: false, estado: 409, error: 'La propuesta ha cambiado mientras la mirabas. Recarga la página, revísala y vuelve a aceptar.', conflicto: true }
  }

  const resumen = resumirDiferencias(lineas)
  await registrarEnHistorial(
    {
      remesaId: r.remesa.id,
      actor: 'enlace',
      enlaceId: r.enlace.id,
      accion: 'propuesta_aceptada',
      ip,
      detalle: { nombre, comentario, cambios: resumen.cambios, nuevas: resumen.nuevas, unidades: resumen.unidadesCliente, unidadesPropuestas: resumen.unidadesPropuestas },
    },
    service,
    ahora
  )
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* Lo que hace la agencia con la propuesta                             */
/* ------------------------------------------------------------------ */

export type ResultadoDeEnviar = { ok: true; version: number | null; yaEnviada: boolean } | Fallo

/**
 * Manda la propuesta al cliente: la FOTO de lo propuesto. Con `soloSiNoSeEnvio`, no hace nada si ya estaba
 * mandada (copiar el enlace dos veces no debe borrar los cambios del cliente).
 */
export async function enviarPropuesta(
  remesaId: string,
  userId: string,
  actor: Actor,
  opciones: { soloSiNoSeEnvio?: boolean } = {},
  service: ClienteDeBase = createServiceClient()
): Promise<ResultadoDeEnviar> {
  const { fila, sinMigrar } = await leerRemesa(remesaId, service)
  if (sinMigrar) return { ok: false, estado: 503, error: 'Falta lanzar la migración 309 en Supabase para mandar la propuesta por enlace.' }
  if (opciones.soloSiNoSeEnvio && fila.propuesta_enviada_at) return { ok: true, version: fila.lineas_version ?? null, yaEnviada: true }
  const { data, error } = await service.rpc('fba_enviar_propuesta', { p_remesa: remesaId, p_usuario: userId })
  if (error) {
    if (error.code === '23514') return { ok: false, estado: 409, error: error.message }
    if (faltaLaFuncion(error)) return { ok: false, estado: 503, error: 'Falta lanzar la migración 309 en Supabase para mandar la propuesta por enlace.' }
    throw error
  }
  await registrarEnHistorial({ remesaId, actor: actor as ActorDeHistorial, userId, accion: 'propuesta_enviada' }, service)
  return { ok: true, version: typeof data === 'number' ? data : Number(data), yaEnviada: false }
}

/** Devuelve la propuesta al cliente: quita su «Acepto» para que pueda seguir tocándola */
export async function devolverPropuesta(remesaId: string, userId: string, actor: Actor, service: ClienteDeBase = createServiceClient()): Promise<{ ok: true } | Fallo> {
  const { data, error } = await service
    .from('fba_remesas')
    .update({ cliente_acepto_at: null, cliente_acepto_nombre: null, cliente_acepto_ip: null })
    .eq('id', remesaId)
    .eq('estado', 'borrador')
    .not('cliente_acepto_at', 'is', null)
    .select('id')
  if (error) {
    if (faltaColumna(error)) return { ok: false, estado: 503, error: 'Falta lanzar la migración 309 en Supabase.' }
    throw error
  }
  if (((data as unknown[] | null) ?? []).length === 0) return { ok: false, estado: 409, error: 'La propuesta ya no está pendiente de revisión. Recarga.', conflicto: true }
  await registrarEnHistorial({ remesaId, actor: actor as ActorDeHistorial, userId, accion: 'propuesta_devuelta' }, service)
  return { ok: true }
}
