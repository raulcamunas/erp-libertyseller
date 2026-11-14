import { connectionCredentials } from '@/lib/amazon/data'
import { createServiceClient } from '@/lib/supabase/service'
import { marketplaceById, marketplaceLabel, mercadosDeConexion } from '@/lib/types/amazon'
import { estadoDeEnvios, listarEnviosDeCuenta } from './inbound'
import { lineasConNombre, crearRemesaDeEnvio } from './importar-envio'
import { ordenarNuevos, soloNuevos, type EnvioNuevo } from './envios-nuevos'
import { diaDeCreacionDeEnvio } from './mercados'

/**
 * LOS ENVÍOS QUE AMAZON TIENE EN LA CUENTA DE UN CLIENTE Y EL ERP TODAVÍA NO — y cómo se importan, de uno en uno o varios a la vez.
 * SOLO SERVIDOR. Lo de listar solo LEE de Amazon; lo de importar escribe en fba_remesas (con el mismo alta que «Traer envío de Amazon»).
 *
 * LA CACHÉ: preguntar a Amazon por todos los clientes cada vez que alguien abre Remesas gastaría el cupo de la API y tardaría. El resultado de cada cliente vive 10 minutos en la memoria del servidor
 * (se pierde al reiniciar, y no pasa nada: se vuelve a preguntar) y se tira en cuanto se importa algo de ese cliente. Un `refrescar` fuerza la pregunta.
 */

const VIDA_MS = 10 * 60_000
/** Hasta cuándo se mira hacia atrás en la cuenta de Amazon: un año */
const DIAS_HACIA_ATRAS = 365

export interface ResultadoNuevos {
  clienteId: string
  comprobadoAt: string
  nuevos: EnvioNuevo[]
  /** Lo que ha fallado al preguntar (un mercado caído, un token que ya no sirve…). Aun así `nuevos` trae lo que sí se ha podido leer */
  error: string | null
  /** El cliente no tiene la cuenta de Amazon conectada: no hay nada que preguntar */
  sinConexion: boolean
}

const cache = new Map<string, { en: number; r: ResultadoNuevos }>()
/** Una sola pregunta a la vez por cliente: dos pestañas abriendo Remesas no se duplican */
const enCurso = new Map<string, Promise<ResultadoNuevos>>()

export function olvidarNuevos(clienteId: string): void {
  cache.delete(clienteId)
}

async function preguntar(clienteId: string): Promise<ResultadoNuevos> {
  const service = createServiceClient()
  const ahora = new Date().toISOString()
  const { data: conexion } = await service
    .from('amazon_connections')
    .select('id, marketplace_ids, marketplaces_activos')
    .eq('client_id', clienteId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  const c = conexion as { id: string; marketplace_ids: string[] | null; marketplaces_activos: string[] | null } | null
  if (!c) return { clienteId, comprobadoAt: ahora, nuevos: [], error: null, sinConexion: true }

  const resuelta = await connectionCredentials(c.id)
  if (!resuelta) return { clienteId, comprobadoAt: ahora, nuevos: [], error: 'La conexión de Amazon de este cliente ya no sirve: hay que volver a autorizarla.', sinConexion: false }

  const { data: yaEstan } = await service.from('fba_remesas').select('referencia_envio').eq('client_id', clienteId).not('referencia_envio', 'is', null)
  const importados = new Set(((yaEstan ?? []) as Array<{ referencia_envio: string | null }>).map((r) => (r.referencia_envio ?? '').trim().toUpperCase()).filter(Boolean))

  const mercados = mercadosDeConexion({ marketplace_ids: c.marketplace_ids ?? [], marketplaces_activos: c.marketplaces_activos })
  const encontrados: EnvioNuevo[] = []
  const fallos: string[] = []
  for (const mercado of mercados) {
    try {
      const enAmazon = await listarEnviosDeCuenta(resuelta.credentials, mercado, DIAS_HACIA_ATRAS)
      const region = marketplaceById(mercado)?.region ?? null
      for (const e of soloNuevos(enAmazon, importados)) {
        encontrados.push({ shipmentId: e.shipmentId.toUpperCase(), nombre: e.nombre, estado: e.estado, centro: e.centro, mercadoId: mercado, mercadoNombre: marketplaceLabel(mercado), diaCreacion: diaDeCreacionDeEnvio(e.nombre, region) })
      }
    } catch (e) {
      fallos.push(`${marketplaceLabel(mercado)}: ${e instanceof Error ? e.message.slice(0, 120) : 'no se ha podido consultar'}`)
    }
  }
  // Un envío no se repite entre mercados (un mismo número solo existe en uno)
  const unicos = [...new Map(encontrados.map((e) => [e.shipmentId, e])).values()]
  return { clienteId, comprobadoAt: ahora, nuevos: ordenarNuevos(unicos), error: fallos.length > 0 ? fallos.join(' · ') : null, sinConexion: false }
}

export async function enviosNuevosDeCliente(clienteId: string, opciones: { refrescar?: boolean } = {}): Promise<ResultadoNuevos> {
  const guardado = cache.get(clienteId)
  if (!opciones.refrescar && guardado && Date.now() - guardado.en < VIDA_MS) return guardado.r
  const pendiente = enCurso.get(clienteId)
  if (pendiente) return pendiente
  const p = preguntar(clienteId)
    .then((r) => {
      // Un resultado con error no se guarda tanto tiempo: que se reintente pronto
      cache.set(clienteId, { en: r.error ? Date.now() - VIDA_MS + 60_000 : Date.now(), r })
      return r
    })
    .finally(() => enCurso.delete(clienteId))
  enCurso.set(clienteId, p)
  return p
}

/** Varios clientes con como mucho `paralelo` preguntas a la vez (el cupo de Amazon es compartido) */
export async function enviosNuevosDeClientes(ids: readonly string[], paralelo = 2): Promise<ResultadoNuevos[]> {
  const salida: ResultadoNuevos[] = new Array(ids.length)
  let siguiente = 0
  async function trabajador() {
    while (siguiente < ids.length) {
      const i = siguiente++
      salida[i] = await enviosNuevosDeCliente(ids[i]).catch((e) => ({ clienteId: ids[i], comprobadoAt: new Date().toISOString(), nuevos: [], error: e instanceof Error ? e.message.slice(0, 160) : 'No se ha podido consultar', sinConexion: false }))
    }
  }
  await Promise.all(Array.from({ length: Math.min(paralelo, ids.length) }, trabajador))
  return salida
}

export interface ResultadoImportacion {
  importados: Array<{ shipmentId: string; id: string; referencias: number; fecha: string }>
  fallidos: Array<{ shipmentId: string; error: string }>
}

/**
 * Importa los envíos elegidos de un cliente, uno a uno. La fecha de envío es el día que lleva el nombre del envío en Amazon («FBA STA (06/10/2026 10:17)») y, si no lo lleva, hoy.
 * Cada envío se vuelve a comprobar contra Amazon y contra el ERP (que no se haya importado entretanto): lo que llega del navegador no se da por bueno.
 */
export async function importarEnvios(opciones: { clienteId: string; userId: string; envios: Array<{ shipmentId: string; mercadoId: string }>; hoy: string }): Promise<ResultadoImportacion> {
  const service = createServiceClient()
  const salida: ResultadoImportacion = { importados: [], fallidos: [] }
  const { data: conexion } = await service.from('amazon_connections').select('id, marketplace_ids, marketplaces_activos').eq('client_id', opciones.clienteId).eq('is_active', true).limit(1).maybeSingle()
  const c = conexion as { id: string; marketplace_ids: string[] | null; marketplaces_activos: string[] | null } | null
  const resuelta = c ? await connectionCredentials(c.id) : null
  if (!c || !resuelta) {
    for (const e of opciones.envios) salida.fallidos.push({ shipmentId: e.shipmentId, error: 'La cuenta de Amazon de este cliente no está conectada' })
    return salida
  }
  const permitidos = mercadosDeConexion({ marketplace_ids: c.marketplace_ids ?? [], marketplaces_activos: c.marketplaces_activos })

  for (const e of opciones.envios) {
    try {
      if (!permitidos.includes(e.mercadoId)) throw new Error('Esa cuenta no vende en ese mercado')
      const { data: yaEsta } = await service.from('fba_remesas').select('id').eq('client_id', opciones.clienteId).eq('referencia_envio', e.shipmentId).limit(1).maybeSingle()
      if (yaEsta) throw new Error('Ya estaba en el ERP')
      const info = (await estadoDeEnvios(resuelta.credentials, e.mercadoId, [e.shipmentId])).get(e.shipmentId)
      if (!info) throw new Error('Amazon ya no lo reconoce')
      const { crudas, lineas } = await lineasConNombre(service, resuelta.credentials, c.id, e.mercadoId, e.shipmentId)
      if (crudas === 0 || lineas.length === 0) throw new Error('Amazon no devuelve ninguna referencia con unidades')
      const fecha = diaDeCreacionDeEnvio(info.nombre, marketplaceById(e.mercadoId)?.region ?? null) ?? opciones.hoy
      const id = await crearRemesaDeEnvio(service, { clienteId: opciones.clienteId, connectionId: c.id, mercado: e.mercadoId, shipmentId: e.shipmentId, nombre: info.nombre, fecha, estadoAmazon: info.estado, lineas, userId: opciones.userId })
      salida.importados.push({ shipmentId: e.shipmentId, id, referencias: lineas.length, fecha })
    } catch (err) {
      salida.fallidos.push({ shipmentId: e.shipmentId, error: err instanceof Error ? err.message.slice(0, 160) : 'No se ha podido importar' })
    }
  }
  if (salida.importados.length > 0) olvidarNuevos(opciones.clienteId)
  return salida
}
