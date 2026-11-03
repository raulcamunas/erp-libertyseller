import { createServiceClient } from '@/lib/supabase/service'
import type { SesionFba } from './acceso'
import { CONFIG_ALERTAS_POR_DEFECTO, type Severidad, type TipoAlerta } from './alertas'
import { leerTodo } from './paginar'
import { faltaLaTabla } from './planificacion'

/**
 * LO QUE ENSEÑA LA PANTALLA «ALERTAS FBA» — SOLO SERVIDOR.
 * ========================================================
 * Lee las alertas ya guardadas por la pasada diaria (o por el botón «Recalcular»), junto con la configuración de cada cliente y cuándo se
 * calcularon. No calcula nada: es una lectura rápida de cuatro tablas pequeñas. La pantalla se abre al instante aunque el cálculo, que lee
 * el libro mayor entero de cada cliente, tarde minutos.
 *
 * Solo ve los clientes que la sesión puede ver (lib/fba/acceso.ts). Un administrador ve todos los que tienen Amazon conectado.
 */

type Servicio = ReturnType<typeof createServiceClient>

export interface ClienteDeAlertas {
  id: string
  nombre: string
  /** null = nadie ha puesto el plazo de este cliente: se calcula con uno de partida y la pantalla lo dice */
  plazoDias: number | null
  antelacionDias: number
  avisar: boolean
  plazosSku: Record<string, number>
  /** Cuándo se calcularon sus alertas por última vez. null = nunca */
  calculadoAt: string | null
  errorCalculo: string | null
  abiertas: number
}

export interface AlertaGuardada {
  id: string
  clienteId: string
  clave: string
  tipo: TipoAlerta
  severidad: Severidad
  sku: string | null
  remesaId: string | null
  titulo: string
  detalle: string
  impacto: number
  datos: Record<string, unknown>
  estado: 'abierta' | 'silenciada'
  primeraVezAt: string
  ultimaVezAt: string
  silenciadaHasta: string | null
}

export interface PanelDeAlertas {
  hoy: string
  /** Falta lanzar la migración 267: no hay dónde guardar ni leer nada */
  faltaMigracion: boolean
  clientes: ClienteDeAlertas[]
  alertas: AlertaGuardada[]
}

/** Los clientes de Amazon con una conexión activa que esta sesión puede ver */
export async function clientesConAlertas(service: Servicio, sesion: SesionFba): Promise<Array<{ id: string; nombre: string }>> {
  const { data: conexiones } = await service.from('amazon_connections').select('client_id').eq('is_active', true).not('client_id', 'is', null)
  let ids = [...new Set(((conexiones ?? []) as Array<{ client_id: string }>).map((c) => c.client_id))]
  if (sesion.clientesPermitidos !== null) {
    const permitidos = new Set(sesion.clientesPermitidos)
    ids = ids.filter((id) => permitidos.has(id))
  }
  if (ids.length === 0) return []
  const { data } = await service.from('amazon_clients').select('id, name').in('id', ids).order('name', { ascending: true })
  return ((data ?? []) as Array<{ id: string; name: string }>).map((c) => ({ id: c.id, nombre: c.name }))
}

export async function leerPanelDeAlertas(sesion: SesionFba, hoy: string): Promise<PanelDeAlertas> {
  const service = createServiceClient()
  const clientes = await clientesConAlertas(service, sesion)
  const vacio: PanelDeAlertas = { hoy, faltaMigracion: false, clientes: [], alertas: [] }
  if (clientes.length === 0) return vacio
  const ids = clientes.map((c) => c.id)

  const { data: configs, error: errorConfig } = await service.from('fba_alertas_config').select('client_id, plazo_reposicion_dias, antelacion_dias, avisar').in('client_id', ids)
  if (errorConfig && faltaLaTabla(errorConfig)) {
    return { ...vacio, faltaMigracion: true, clientes: clientes.map((c) => ({ id: c.id, nombre: c.nombre, plazoDias: null, antelacionDias: CONFIG_ALERTAS_POR_DEFECTO.antelacionDias, avisar: true, plazosSku: {}, calculadoAt: null, errorCalculo: null, abiertas: 0 })) }
  }
  if (errorConfig) throw errorConfig

  const { data: plazos } = await service.from('fba_alertas_plazo_sku').select('client_id, sku, plazo_reposicion_dias').in('client_id', ids)
  const { data: estados } = await service.from('fba_alertas_estado').select('client_id, calculado_at, error').in('client_id', ids)

  const filas = await leerTodo<{
    id: string
    client_id: string
    clave: string
    tipo: TipoAlerta
    severidad: Severidad
    sku: string | null
    remesa_id: string | null
    titulo: string
    detalle: string | null
    impacto: number | string
    datos: Record<string, unknown> | null
    estado: 'abierta' | 'silenciada'
    primera_vez_at: string
    ultima_vez_at: string
    silenciada_hasta: string | null
  }>((a, b) =>
    service
      .from('fba_alertas')
      .select('id, client_id, clave, tipo, severidad, sku, remesa_id, titulo, detalle, impacto, datos, estado, primera_vez_at, ultima_vez_at, silenciada_hasta')
      .in('client_id', ids)
      .neq('estado', 'resuelta')
      .order('id', { ascending: true })
      .range(a, b)
  )

  const configDe = new Map(((configs ?? []) as Array<{ client_id: string; plazo_reposicion_dias: number; antelacion_dias: number; avisar: boolean }>).map((c) => [c.client_id, c]))
  const plazosDe = new Map<string, Record<string, number>>()
  for (const p of (plazos ?? []) as Array<{ client_id: string; sku: string; plazo_reposicion_dias: number }>) {
    const m = plazosDe.get(p.client_id) ?? {}
    m[p.sku] = p.plazo_reposicion_dias
    plazosDe.set(p.client_id, m)
  }
  const estadoDe = new Map(((estados ?? []) as Array<{ client_id: string; calculado_at: string | null; error: string | null }>).map((e) => [e.client_id, e]))

  const alertas: AlertaGuardada[] = filas.map((f) => ({
    id: f.id,
    clienteId: f.client_id,
    clave: f.clave,
    tipo: f.tipo,
    severidad: f.severidad,
    sku: f.sku,
    remesaId: f.remesa_id,
    titulo: f.titulo,
    detalle: f.detalle ?? '',
    impacto: Number(f.impacto) || 0,
    datos: f.datos ?? {},
    estado: f.estado,
    primeraVezAt: f.primera_vez_at,
    ultimaVezAt: f.ultima_vez_at,
    silenciadaHasta: f.silenciada_hasta,
  }))
  const abiertasDe = new Map<string, number>()
  for (const a of alertas) if (a.estado === 'abierta') abiertasDe.set(a.clienteId, (abiertasDe.get(a.clienteId) ?? 0) + 1)

  return {
    hoy,
    faltaMigracion: false,
    clientes: clientes.map((c) => {
      const cfg = configDe.get(c.id)
      const est = estadoDe.get(c.id)
      return {
        id: c.id,
        nombre: c.nombre,
        plazoDias: cfg ? cfg.plazo_reposicion_dias : null,
        antelacionDias: cfg ? cfg.antelacion_dias : CONFIG_ALERTAS_POR_DEFECTO.antelacionDias,
        avisar: cfg ? cfg.avisar !== false : true,
        plazosSku: plazosDe.get(c.id) ?? {},
        calculadoAt: est?.calculado_at ?? null,
        errorCalculo: est?.error ?? null,
        abiertas: abiertasDe.get(c.id) ?? 0,
      }
    }),
    alertas,
  }
}

/** Cuántas alertas graves hay abiertas entre los clientes que esta sesión ve: el número de la insignia de Remesas */
export async function contarAlertasGraves(sesion: SesionFba): Promise<{ criticas: number; altas: number }> {
  const service = createServiceClient()
  const clientes = await clientesConAlertas(service, sesion)
  if (clientes.length === 0) return { criticas: 0, altas: 0 }
  const ids = clientes.map((c) => c.id)
  const cuenta = async (severidad: Severidad): Promise<number> => {
    const { count, error } = await service.from('fba_alertas').select('id', { count: 'exact', head: true }).in('client_id', ids).eq('estado', 'abierta').eq('severidad', severidad)
    // Sin la tabla (migración sin lanzar) no hay nada que contar: la insignia no sale
    if (error) return 0
    return count ?? 0
  }
  return { criticas: await cuenta('critica'), altas: await cuenta('alta') }
}
