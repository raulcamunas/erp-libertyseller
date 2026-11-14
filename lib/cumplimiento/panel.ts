import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { AMAZON_MARKETPLACES, marketplaceLabel } from '@/lib/types/amazon'
import { conexionesDeCliente } from './conexiones'
import { TEMAS, type Gravedad, type Tema } from './tipos'
import { CIFRAS_VACIAS, sumarCifras, sumarPorDia, type CifrasDePais, type CodigoDelPanel, type PanelDeCumplimiento } from './panel-calculo'
import { agruparEnTareas, mapaDeTareas, tareasConRecuentos } from './acciones'

export * from './panel-calculo'

/**
 * EL PANEL DE LA APP «CUMPLIMIENTO»: cómo va UN cliente, en todos sus países o en uno.
 * SOLO SERVIDOR.
 *
 * Todo sale de las funciones de la migración 297, que leen `listing_cumplimiento` de una vez agrupando por país. El cliente se traduce a SUS conexiones aquí (conexionesDeCliente): nada de esto
 * junta ni compara clientes.
 */

const n = (v: unknown) => Number(v ?? 0) || 0
const paisDe = (marketplaceId: string) => AMAZON_MARKETPLACES.find((m) => m.id === marketplaceId)?.countryCode ?? marketplaceId

/** Los países de un cliente con listings, para la barra lateral (sin cifras: la barra se pinta para todos los clientes y aquí no se cruzan) */
export async function paisesDeCliente(amazonClientId: string): Promise<Array<{ id: string; pais: string; nombre: string }>> {
  const conexiones = await conexionesDeCliente(amazonClientId)
  const ids = [...new Set(conexiones.flatMap((c) => (c.marketplaces_activos?.length ? c.marketplaces_activos : c.marketplace_ids)))]
  return ids
    .map((id) => ({ id, pais: paisDe(id), nombre: marketplaceLabel(id) }))
    .sort((a, b) => (a.pais === 'ES' ? -1 : b.pais === 'ES' ? 1 : a.nombre.localeCompare(b.nombre, 'es')))
}

/** ¿El error es que la función no existe (migración sin lanzar)? */
const faltaFuncion = (e: { message?: string } & Parameters<typeof isMissingSchema>[0]) =>
  isMissingSchema(e) || /function .* does not exist|Could not find the function/i.test(e.message ?? '')

/** Hasta cuántos códigos distintos se leen. Con 60 se perdían: el 14 nov 2026 cuatro clientes tenían entre 64 y 81 */
const LIMITE_CODIGOS = 200

export async function panelDeCliente(amazonClientId: string, mercado: string | null): Promise<PanelDeCumplimiento> {
  try {
    const conexiones = await conexionesDeCliente(amazonClientId)
    if (conexiones.length === 0) return { ok: false, error: 'Este cliente no tiene ninguna cuenta de Amazon activa.' }
    const ids = conexiones.map((c) => c.id)
    const service = createServiceClient()

    const [cif, cat, tem, cod, dia] = await Promise.all([
      service.rpc('cumplimiento_cifras', { p_conexiones: ids }),
      service.rpc('cumplimiento_catalogo', { p_conexiones: ids }),
      service.rpc('cumplimiento_temas', { p_conexiones: ids, p_mercado: mercado }),
      // La de la 306 (todas las filas con incidencias, y los ocultos con stock); si no está, la de la 297 (ver más abajo)
      service.rpc('cumplimiento_codigos_todos', { p_conexiones: ids, p_mercado: mercado, p_limite: LIMITE_CODIGOS }),
      (() => {
        let q = service
          .from('cumplimiento_diario')
          .select('dia, revisados, limpios, atencion, ocultos, solo_avisos, atencion_con_stock')
          .in('connection_id', ids)
          .gte('dia', new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10))
          .order('dia', { ascending: true })
          .limit(5000)
        if (mercado) q = q.eq('marketplace_id', mercado)
        return q
      })(),
    ])
    for (const r of [cif, cat, tem, dia]) {
      if (r.error) {
        if (faltaFuncion(r.error)) return { ok: false, faltaMigracion: true }
        throw r.error
      }
    }
    // Sin la 306, la función de la 297: no ve los listings que solo tienen avisos menores y no sabe cuántos ocultos tienen stock
    let exacto = true
    let filasCodigos = cod.data as unknown
    if (cod.error) {
      if (!faltaFuncion(cod.error)) throw cod.error
      exacto = false
      const v1 = await service.rpc('cumplimiento_codigos', { p_conexiones: ids, p_mercado: mercado, p_limite: LIMITE_CODIGOS })
      if (v1.error) {
        if (faltaFuncion(v1.error)) return { ok: false, faltaMigracion: true }
        throw v1.error
      }
      filasCodigos = v1.data
    }

    const totales = new Map(((cat.data ?? []) as Array<{ marketplace_id: string; total: number }>).map((t) => [t.marketplace_id, n(t.total)]))
    const paises: CifrasDePais[] = ((cif.data ?? []) as Array<Record<string, unknown>>).map((f) => {
      const id = String(f.marketplace_id)
      return {
        id,
        nombre: marketplaceLabel(id),
        pais: paisDe(id),
        total: Math.max(totales.get(id) ?? 0, n(f.revisados)),
        revisados: n(f.revisados),
        limpios: n(f.limpios),
        atencion: n(f.atencion),
        conErrores: n(f.con_errores),
        ocultos: n(f.ocultos),
        soloAvisos: n(f.solo_avisos),
        atencionConStock: n(f.atencion_con_stock),
        normativa: n(f.normativa),
        antiguedad: { d7: n(f.antig_7), d30: n(f.antig_30), d90: n(f.antig_90), mas: n(f.antig_mas) },
        ultimaRevision: (f.ultima_revision as string | null) ?? null,
      }
    })
    // Los países con catálogo pero sin nada revisado todavía también salen (con cero revisados)
    for (const [id, total] of totales) {
      if (total > 0 && !paises.some((p) => p.id === id)) paises.push({ ...CIFRAS_VACIAS, id, nombre: marketplaceLabel(id), pais: paisDe(id), total })
    }
    paises.sort((a, b) => b.total - a.total)

    const elegidos = mercado ? paises.filter((p) => p.id === mercado) : paises
    const temas = ((tem.data ?? []) as Array<Record<string, unknown>>)
      .filter((t) => (TEMAS as readonly string[]).includes(String(t.tema)))
      .map((t) => ({ tema: t.tema as Tema, atencion: n(t.atencion), todos: n(t.todos), atencionConStock: n(t.atencion_con_stock) }))
      .sort((a, b) => b.atencion - a.atencion || b.todos - a.todos)
    const codigos: CodigoDelPanel[] = ((filasCodigos ?? []) as Array<Record<string, unknown>>).map((c) => ({
      codigo: String(c.codigo),
      gravedad: (['error', 'aviso', 'info'].includes(String(c.gravedad)) ? c.gravedad : 'info') as Gravedad,
      tema: ((TEMAS as readonly string[]).includes(String(c.tema)) ? c.tema : 'otros') as Tema,
      mensaje: String(c.mensaje ?? ''),
      listings: n(c.listings),
      conStock: n(c.con_stock),
      ocultan: n(c.ocultan),
      ocultanConStock: c.ocultan_con_stock == null ? null : n(c.ocultan_con_stock),
      desde: (c.desde as string | null) ?? null,
    }))

    // ---- la pestaña «Hoy»: lo mismo, agrupado por lo que hay que hacer ----
    const ahora = new Date()
    let tareas = agruparEnTareas(codigos, ahora)
    if (exacto && codigos.length > 0) {
      const r = await service.rpc('cumplimiento_tareas', { p_conexiones: ids, p_mercado: mercado, p_mapa: mapaDeTareas(codigos, ahora) })
      if (r.error) {
        // No tumba el panel: se queda la suma por código y se dice que es aproximada
        console.error('[cumplimiento] tareas exactas:', r.error.message)
        exacto = false
      } else {
        tareas = tareasConRecuentos(
          codigos,
          ((r.data ?? []) as Array<Record<string, unknown>>).map((f) => ({ tarea: String(f.tarea), listings: n(f.listings), conStock: n(f.con_stock) })),
          ahora
        )
      }
    }

    return {
      ok: true,
      paises,
      cifras: sumarCifras(elegidos),
      temas,
      codigos,
      tareas,
      exacto,
      diario: sumarPorDia((dia.data ?? []) as Array<{ dia: string; revisados: number; limpios: number; atencion: number; ocultos: number; solo_avisos: number; atencion_con_stock: number }>),
    }
  } catch (e) {
    console.error('[cumplimiento] no se ha podido leer el panel:', e)
    return { ok: false, error: 'No se ha podido leer el panel.' }
  }
}

/**
 * LA FOTO DEL DÍA para la gráfica de evolución. La llama la tarea «cumplimiento» en cada pasada y solo hace algo la primera vez del día (hora de Madrid). Si falta la migración 297, no hace nada.
 */
export async function fotoDelDiaSiFalta(): Promise<'hecha' | 'ya-estaba' | 'sin-migracion'> {
  const service = createServiceClient()
  const hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date())
  const { data, error } = await service.from('cumplimiento_diario').select('dia').eq('dia', hoy).limit(1)
  if (error) {
    if (isMissingSchema(error)) return 'sin-migracion'
    throw error
  }
  if ((data ?? []).length > 0) return 'ya-estaba'
  const r = await service.rpc('cumplimiento_foto_del_dia')
  if (r.error) {
    if (isMissingSchema(r.error)) return 'sin-migracion'
    throw r.error
  }
  return 'hecha'
}
