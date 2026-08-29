/**
 * ENTRAIS · RECALCULAR Y PUBLICAR SIN QUE NADIE PULSE
 * ===================================================
 * SOLO SERVIDOR.
 *
 * Lo llama el cron en cada pasada. Casi siempre no hace nada: mira el reloj, ve
 * que no le toca, y se va. Cuando le toca, recalcula el catálogo entero y manda
 * a Amazon los precios que hayan cambiado.
 *
 *
 * ============ POR QUÉ NO VA DENTRO DEL CICLO DE STOCK ============
 *
 * Porque no es el mismo dato ni el mismo ritmo. El stock del proveedor se mueve
 * todo el día y por eso aquel entra cada media hora. El precio de compra cambia
 * cuando el proveedor manda tarifa nueva: una vez al día como mucho.
 *
 * Y meterlo en la misma pasada costaría dos cosas inútiles: recalcular son 6.931
 * filas escritas cada vez —a 48 pasadas al día, 332.688 escrituras, que es el
 * patrón exacto que llenó la base— y no cambiaría ni un precio, porque entre una
 * pasada y la siguiente el coste del proveedor es el mismo.
 *
 *
 * ============ LO QUE NO SE MANDA ============
 *
 * Se hereda entero del botón manual, que ya lo tenía pensado:
 *
 *   · Los que no están listados en Amazon. Un PATCH contra un listing que no
 *     existe es una llamada para un error.
 *   · Los bloqueados por envío directo.
 *   · Los que ya están al precio propuesto.
 *
 * Y uno más que el botón no tiene: los que se pasan del tope de salto. Ahí la
 * diferencia es que en el botón hay una persona mirando el simulacro antes de
 * pulsar, y aquí no hay nadie. Ver la migración 164.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { fetchAll } from '@/lib/supabase/paginacion'
import { sendChanges, type ChangeToSend } from '@/lib/amazon/data'
import { calcularTodo, leerConfig } from './motor'

export interface ResultadoAutomatico {
  /** false = no le tocaba, o está apagado. No es un fallo */
  hecho: boolean
  motivo: string
  calculados?: number
  candidatos?: number
  frenados?: number
  enviados?: number
  fallidos?: number
}

export async function publicarSiToca(): Promise<ResultadoAutomatico> {
  const config = await leerConfig()

  if (!config.publicar_automatico) {
    return { hecho: false, motivo: 'La publicación automática está apagada.' }
  }
  if (!config.connection_id || !config.marketplace_id) {
    return { hecho: false, motivo: 'El motor no tiene cuenta de Amazon ni país configurados.' }
  }

  /**
   * EL RELOJ, ANTES DE HACER NADA CARO.
   *
   * `publicado_at` se sella cuando termina, no cuando empieza. Si una pasada se
   * cae a la mitad, la siguiente lo vuelve a intentar en vez de esperarse las
   * veinticuatro horas — que es lo que hay que querer: un fallo no puede dejar
   * los precios sin publicar un día entero.
   */
  const cadaMs = Math.max(1, config.publicar_cada_horas) * 3600_000
  if (config.publicado_at && Date.now() - Date.parse(config.publicado_at) < cadaMs) {
    return { hecho: false, motivo: 'Todavía no le toca.' }
  }

  const service = createServiceClient()

  // ---------- 1. Recalcular ----------
  // Trae el catálogo del proveedor —de la caché si es reciente, así que no gasta
  // cuota— y lo cruza con lo que Amazon acaba de decir en el ciclo de stock.
  const { resumen } = await calcularTodo({ lanzadoPor: null })

  // ---------- 2. Qué se puede mandar ----------
  const filas = await fetchAll<{
    sku: string
    precio: number | null
    pvp_actual: number | null
    dif_euros: number | null
    dif_porcentaje: number | null
    origen: string | null
  }>((a, b) =>
    service
      .from('entrais_precios')
      .select('sku, precio, pvp_actual, dif_euros, dif_porcentaje, origen')
      .order('sku', { ascending: true })
      .range(a, b)
  )

  const tope = config.publicar_max_salto_pct
  const candidatos: { sku: string; precio: number; salto: number }[] = []
  const frenados: { sku: string; de: number; a: number; pct: number }[] = []

  for (const f of filas) {
    if (f.origen === 'bloqueado') continue
    if (f.precio === null || f.pvp_actual === null) continue
    const dif = f.dif_euros === null ? 0 : Number(f.dif_euros)
    if (Math.abs(dif) < 0.005) continue

    const pct = f.dif_porcentaje === null ? 0 : Math.abs(Number(f.dif_porcentaje))
    if (tope !== null && pct > Number(tope)) {
      frenados.push({
        sku: f.sku,
        de: Number(f.pvp_actual),
        a: Number(f.precio),
        pct: Number(f.dif_porcentaje ?? 0),
      })
      continue
    }
    candidatos.push({ sku: f.sku, precio: Number(f.precio), salto: Math.abs(dif) })
  }

  /**
   * LOS MAYORES SALTOS PRIMERO.
   *
   * Con el tope por pasada, lo que no entra se queda para la siguiente. Y si hay
   * que elegir, lo que más urge publicar es lo que más se aleja del precio
   * correcto — ahí es donde se está perdiendo dinero o vendiendo caro.
   */
  candidatos.sort((a, b) => b.salto - a.salto)

  const tanda = candidatos.slice(0, config.publicar_max_por_pasada)

  if (frenados.length > 0) {
    // Se guardan como evento para que salgan en la cola de incidencias: un
    // precio que no se manda y que nadie ve es un precio mal puesto para siempre.
    await service.from('amazon_eventos').insert({
      connection_id: config.connection_id,
      marketplace_id: config.marketplace_id,
      tipo: 'entrais_precio_frenado',
      severidad: 'aviso',
      mensaje:
        `${frenados.length} precios no se han publicado porque cambiaban más de un ` +
        `${Math.round(Number(tope) * 100)} %. Míralos en el motor de precios antes de subir el tope. ` +
        `Los mayores: ${frenados
          .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
          .slice(0, 5)
          .map((f) => `${f.sku} ${f.de.toFixed(2)}→${f.a.toFixed(2)} (${Math.round(f.pct * 100)} %)`)
          .join(', ')}`,
    })
  }

  if (tanda.length === 0) {
    await service
      .from('entrais_config')
      .update({ publicado_at: new Date().toISOString() })
      .eq('id', config.id)
    return {
      hecho: true,
      motivo: 'No había ningún precio que cambiar.',
      calculados: resumen.productos,
      candidatos: 0,
      frenados: frenados.length,
      enviados: 0,
      fallidos: 0,
    }
  }

  // ---------- 3. Mandar ----------
  const cambios: ChangeToSend[] = tanda.map((c) => ({
    sku: c.sku,
    marketplaceId: config.marketplace_id as string,
    field: 'precio',
    newValue: c.precio,
  }))

  const enviado = await sendChanges({
    connectionId: config.connection_id,
    changes: cambios,
    // `fichero` y no `manual`: lo decidió el motor, no una persona. Es lo primero
    // que hay que saber el día que un precio salga raro.
    source: 'fichero',
    sourceRef: `entrais-automatico:${new Date().toISOString().slice(0, 16)}`,
    userId: null,
  })

  await service
    .from('entrais_config')
    .update({ publicado_at: new Date().toISOString() })
    .eq('id', config.id)

  return {
    hecho: true,
    motivo: 'Publicado.',
    calculados: resumen.productos,
    candidatos: candidatos.length,
    frenados: frenados.length,
    enviados: enviado.accepted,
    fallidos: enviado.failed,
  }
}
