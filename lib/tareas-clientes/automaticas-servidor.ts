import { createServiceClient } from '@/lib/supabase/service'
import { cruzarClientes, FUENTES, propuestaDeCumplimiento, propuestasDeAlertasFba, type AlertaFba, type FuenteAutomatica, type ListingSuprimido, type PropuestaDeTarea } from './automaticas'
import { crearTarea, ErrorDeTareas, esUuid, personasConAcceso } from './servidor'
import { estadosDe, type ClienteTC } from './tipos'

/**
 * LAS TAREAS QUE CREA EL ERP (tablas `tc_auto_config`, columna `tc_tareas.origen_ref`, migración 278). SOLO SERVIDOR.
 *
 * `generarAutomaticas` la llama la pasada del cron de Notion (como mucho una vez cada 50 minutos) y el botón «Ejecutar ahora» de la pantalla. Cada fuente nace APAGADA. Lo que se
 * lee (alertas de FBA, listings suprimidos) está en tablas del ERP: no llama a Amazon. Qué se propone y cómo se evita duplicar, en automaticas.ts.
 */

const MINUTOS_ENTRE_PASADAS = 50
const SISTEMA = { userId: '', nombre: 'ERP' }

export interface ConfigDeFuente {
  fuente: FuenteAutomatica
  activa: boolean
  estado: string | null
  responsables: string[]
  ultima_pasada: string | null
  ultimo_resumen: string | null
}

export interface PanelDeAutomaticas {
  disponible: boolean
  fuentes: Array<ConfigDeFuente & { nombre: string; que: string; donde: string }>
  clientes: Array<{ id: string; nombre: string; icono: string | null; amazonClientId: string | null; amazonNombre: string | null }>
  sinPareja: Array<{ id: string; nombre: string }>
  amazon: Array<{ id: string; nombre: string }>
}

const faltaLaMigracion = (e: { message?: string; code?: string } | null | undefined): boolean => Boolean(e && (e.code === '42P01' || e.code === '42703' || /tc_auto_config|origen_ref/.test(e.message ?? '')))
const vacia = (fuente: FuenteAutomatica): ConfigDeFuente => ({ fuente, activa: false, estado: null, responsables: [], ultima_pasada: null, ultimo_resumen: null })

async function leerConfig(): Promise<{ disponible: boolean; porFuente: Map<FuenteAutomatica, ConfigDeFuente> }> {
  const { data, error } = await createServiceClient().from('tc_auto_config').select('fuente, activa, estado, responsables, ultima_pasada, ultimo_resumen')
  const porFuente = new Map<FuenteAutomatica, ConfigDeFuente>(FUENTES.map((f) => [f.id, vacia(f.id)]))
  if (error) return { disponible: !faltaLaMigracion(error), porFuente }
  for (const f of (data ?? []) as ConfigDeFuente[]) if (porFuente.has(f.fuente)) porFuente.set(f.fuente, { ...f, responsables: f.responsables ?? [] })
  return { disponible: true, porFuente }
}

async function clientesYPareja() {
  const service = createServiceClient()
  const [tc, amazon] = await Promise.all([service.from('tc_clientes').select('id, nombre, icono, vinculos').eq('activo', true).order('nombre'), service.from('amazon_clients').select('id, name').order('name')])
  const clientes = ((tc.data ?? []) as Array<{ id: string; nombre: string; icono: string | null; vinculos: Record<string, string> | null }>).map((c) => ({ ...c, amazonClientId: c.vinculos?.amazon_client_id ?? null }))
  const amazonLista = ((amazon.data ?? []) as Array<{ id: string; name: string }>).map((a) => ({ id: a.id, nombre: a.name }))
  return { clientes, amazon: amazonLista, ...cruzarClientes(clientes, amazonLista) }
}

export async function panelDeAutomaticas(): Promise<PanelDeAutomaticas> {
  const [{ disponible, porFuente }, { clientes, amazon, porAmazon, sinPareja }] = await Promise.all([leerConfig(), clientesYPareja()])
  const amazonDe = new Map<string, string>()
  for (const [a, t] of porAmazon) amazonDe.set(t, a)
  return {
    disponible,
    fuentes: FUENTES.map((f) => ({ ...(porFuente.get(f.id) as ConfigDeFuente), nombre: f.nombre, que: f.que, donde: f.donde })),
    clientes: clientes.map((c) => ({ id: c.id, nombre: c.nombre, icono: c.icono, amazonClientId: amazonDe.get(c.id) ?? null, amazonNombre: amazon.find((a) => a.id === amazonDe.get(c.id))?.nombre ?? null })),
    sinPareja,
    amazon,
  }
}

export async function guardarFuente(quien: string, fuente: unknown, entrada: Record<string, unknown>): Promise<void> {
  if (!FUENTES.some((f) => f.id === fuente)) throw new ErrorDeTareas('Esa fuente no existe.', 404)
  const fila: Record<string, unknown> = { fuente, actualizado_por: quien || null, actualizado_en: new Date().toISOString() }
  if ('activa' in entrada) fila.activa = entrada.activa === true
  if ('estado' in entrada) fila.estado = typeof entrada.estado === 'string' && entrada.estado.trim() ? entrada.estado.trim().slice(0, 80) : null
  if ('responsables' in entrada) fila.responsables = Array.isArray(entrada.responsables) ? [...new Set(entrada.responsables.filter(esUuid))].slice(0, 10) : []
  const { error } = await createServiceClient().from('tc_auto_config').upsert(fila, { onConflict: 'fuente' })
  if (error) throw new ErrorDeTareas(faltaLaMigracion(error) ? 'Falta lanzar la migración 278 en Supabase para las tareas automáticas.' : `No se ha podido guardar: ${error.message}`, faltaLaMigracion(error) ? 503 : 500)
}

/** Enlaza a mano un cliente de tareas con uno de Amazon (o lo desenlaza con `null`), para cuando no se llaman igual */
export async function vincularConAmazon(tcClienteId: string, amazonClientId: string | null): Promise<void> {
  if (!esUuid(tcClienteId) || (amazonClientId !== null && !esUuid(amazonClientId))) throw new ErrorDeTareas('Cliente no válido.')
  const service = createServiceClient()
  const { data } = await service.from('tc_clientes').select('vinculos').eq('id', tcClienteId).maybeSingle()
  if (!data) throw new ErrorDeTareas('Ese cliente no existe.', 404)
  const vinculos = { ...((data as { vinculos: Record<string, string> | null }).vinculos ?? {}) }
  if (amazonClientId) vinculos.amazon_client_id = amazonClientId
  else delete vinculos.amazon_client_id
  const { error } = await service.from('tc_clientes').update({ vinculos }).eq('id', tcClienteId)
  if (error) throw new ErrorDeTareas(`No se ha podido guardar: ${error.message}`, 500)
}

/** Las propuestas de cada cliente de Amazon con algo que proponer */
async function propuestasPorCliente(fuente: FuenteAutomatica, hoy: string): Promise<Map<string, PropuestaDeTarea[]>> {
  const service = createServiceClient()
  const sal = new Map<string, PropuestaDeTarea[]>()
  const poner = (cliente: string, ps: PropuestaDeTarea[]) => ps.length > 0 && sal.set(cliente, [...(sal.get(cliente) ?? []), ...ps])
  if (fuente === 'fba') {
    const { data, error } = await service.from('fba_alertas').select('client_id, clave, tipo, severidad, titulo, detalle, sku, estado').eq('estado', 'abierta').in('severidad', ['critica', 'alta']).limit(2000)
    if (error) return sal
    const porCliente = new Map<string, AlertaFba[]>()
    for (const a of (data ?? []) as Array<AlertaFba & { client_id: string }>) porCliente.set(a.client_id, [...(porCliente.get(a.client_id) ?? []), a])
    for (const [c, alertas] of porCliente) poner(c, propuestasDeAlertasFba(alertas))
  } else {
    const { data: conexiones } = await service.from('amazon_connections').select('id, client_id').eq('is_active', true).not('client_id', 'is', null)
    const clienteDe = new Map(((conexiones ?? []) as Array<{ id: string; client_id: string }>).map((c) => [c.id, c.client_id]))
    if (clienteDe.size === 0) return sal
    const { data } = await service.from('listing_cumplimiento').select('connection_id, sku, titulo, tema, errores').in('connection_id', [...clienteDe.keys()]).eq('suprimido', true).eq('con_stock', true).eq('en_amazon', true).limit(5000)
    const porCliente = new Map<string, ListingSuprimido[]>()
    for (const l of (data ?? []) as Array<ListingSuprimido & { connection_id: string }>) {
      const c = clienteDe.get(l.connection_id)
      if (c) porCliente.set(c, [...(porCliente.get(c) ?? []), l])
    }
    for (const [c, ls] of porCliente) {
      const p = propuestaDeCumplimiento(ls, hoy)
      if (p) poner(c, [p])
    }
  }
  return sal
}

export interface ResumenDeAutomaticas {
  creadas: number
  yaExistian: number
  fuentes: string
}

/**
 * La pasada. `forzar` ignora el reloj de los 50 minutos (el botón «Ejecutar ahora»). Una fuente apagada no hace nada; un cliente sin pareja en Amazon se salta.
 */
export async function generarAutomaticas(opciones: { forzar?: boolean } = {}): Promise<ResumenDeAutomaticas> {
  const { disponible, porFuente } = await leerConfig()
  const resumen: ResumenDeAutomaticas = { creadas: 0, yaExistian: 0, fuentes: '' }
  if (!disponible) return { ...resumen, fuentes: 'falta la migración 278' }
  const activas = [...porFuente.values()].filter((f) => f.activa)
  if (activas.length === 0) return { ...resumen, fuentes: 'ninguna encendida' }

  const service = createServiceClient()
  const ahora = Date.now()
  const hoy = new Date(ahora).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
  const { clientes, porAmazon } = await clientesYPareja()
  const { data: clientesCompletos } = await service.from('tc_clientes').select('*').in('id', clientes.map((c) => c.id))
  const completoDe = new Map(((clientesCompletos ?? []) as ClienteTC[]).map((c) => [c.id, c]))
  const notas: string[] = []

  for (const cfg of activas) {
    if (!opciones.forzar && cfg.ultima_pasada && ahora - Date.parse(cfg.ultima_pasada) < MINUTOS_ENTRE_PASADAS * 60_000) {
      notas.push(`${cfg.fuente}: reciente`)
      continue
    }
    let creadas = 0
    let existian = 0
    const propuestas = await propuestasPorCliente(cfg.fuente, hoy)
    for (const [amazonId, lista] of propuestas) {
      const tcId = porAmazon.get(amazonId)
      const cliente = tcId ? completoDe.get(tcId) : undefined
      if (!tcId || !cliente) continue
      const claves = lista.map((p) => p.clave)
      const { data: previas, error } = await service.from('tc_tareas').select('origen_ref').eq('cliente_id', tcId).in('origen_ref', claves)
      if (error) {
        if (faltaLaMigracion(error)) return { ...resumen, fuentes: 'falta la migración 278' }
        continue
      }
      const ya = new Set(((previas ?? []) as Array<{ origen_ref: string }>).map((p) => p.origen_ref))
      const estados = estadosDe(cliente)
      const hecho = new Set(estados.filter((e) => e.grupo === 'hecho').map((e) => e.nombre))
      const estado = (cfg.estado && estados.some((e) => e.nombre === cfg.estado) ? cfg.estado : estados.find((e) => e.grupo === 'pendiente')?.nombre ?? estados[0]?.nombre) ?? 'Backlog'
      const gente = new Set((await personasConAcceso(tcId)).map((p) => p.id))
      const responsables = cfg.responsables.filter((r) => gente.has(r))
      for (const p of lista) {
        if (ya.has(p.clave)) {
          existian += 1
          continue
        }
        // Lo semanal no se amontona: si la de la semana pasada sigue sin hacerse, no se abre otra
        if (p.fuente === 'cumplimiento') {
          const { data: abiertas } = await service.from('tc_tareas').select('estado').eq('cliente_id', tcId).like('origen_ref', 'cumpl:%').eq('archivada', false)
          if (((abiertas ?? []) as Array<{ estado: string }>).some((t) => !hecho.has(t.estado))) {
            existian += 1
            continue
          }
        }
        try {
          await crearTarea(SISTEMA, { clienteId: tcId, origenRef: p.clave, titulo: `${p.icono} ${p.titulo}`, departamento: p.departamento, estado, contenido: p.contenido, ...(responsables.length > 0 ? { responsables } : {}) })
          creadas += 1
        } catch (e) {
          // La restricción única de la base (dos pasadas a la vez) cuenta como «ya existía»
          if (/duplicate|unique|23505/i.test(e instanceof Error ? e.message : '')) existian += 1
          else console.error('Tarea automática:', e)
        }
      }
    }
    resumen.creadas += creadas
    resumen.yaExistian += existian
    notas.push(`${cfg.fuente}: ${creadas} nuevas`)
    await service.from('tc_auto_config').update({ ultima_pasada: new Date().toISOString(), ultimo_resumen: `${creadas} nuevas, ${existian} que ya estaban` }).eq('fuente', cfg.fuente)
  }
  return { ...resumen, fuentes: notas.join(' · ') }
}
