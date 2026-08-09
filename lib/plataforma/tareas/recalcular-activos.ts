/**
 * TAREA · RECALCULAR QUÉ SKU ESTÁN EN SEGUIMIENTO
 * ===============================================
 * SOLO SERVIDOR.
 *
 * Aplica la regla de amazon_tracking_rules sobre el catálogo de un cliente y
 * escribe el resultado en amazon_listings.activo_calculado. No habla con Amazon:
 * solo lee y escribe la base nuestra.
 *
 * Es la primera tarea del motor a propósito. Ejercita el camino entero —cursor,
 * lotes, progreso guardado, cancelación, eventos— sin gastar una sola ficha del
 * cupo de Amazon, así que se puede probar contra el catálogo real las veces que
 * haga falta. Y además es la que decide el conjunto sobre el que trabajarán
 * todas las demás: sin ella, el refresco diario no sabe a quién refrescar.
 *
 *
 * POR QUÉ EL LOTE ES UNA UNIDAD (CONEXIÓN × MARKETPLACE) Y NO UN PUÑADO DE SKU
 * ---------------------------------------------------------------------------
 * Porque EL TOPE NO SE PUEDE APLICAR POR TROZOS. Si el criterio selecciona 3.000
 * SKU y el tope del cliente son 2.000, hay que ordenar los 3.000 y cortar; con
 * lotes de veinte, cada lote creería que cabe entero y el tope no serviría de
 * nada.
 *
 * Una unidad de 13.700 referencias tarda menos de un minuto porque SOLO SE
 * ESCRIBEN LAS FILAS QUE CAMBIAN (ver escribirActivos), y el presupuesto del
 * motor se comprueba ANTES de empezar un lote, no durante: un lote largo no se
 * corta a la mitad. Con el cerrojo caducando a la media hora, hay margen de
 * sobra.
 *
 * El cursor es, por tanto, la última unidad terminada. Un cliente tiene unas
 * pocas unidades, así que reanudar cuesta como mucho repetir una — y repetirla
 * es inofensivo, porque el cálculo es determinista y la escritura idempotente.
 */

import { resolverActivos, type CandidatoActivo } from '../activos'
import {
  claveUnidad,
  conexionesDeCliente,
  escribirActivos,
  listingsDeUnidad,
  reglaActivaDe,
  unidadesDe,
  ventasDesde,
  type ListingParaActivos,
  type UnidadDeTrabajo,
} from '../datos'
import type { ContextoTarea, CuentasJob, Lote, ResultadoLote, Tarea } from '../motor'
import { inicioDeVentana } from '../refresco'
import type { ReglaActivos } from '../tipos'
import { unidadesPorSku } from '../ventas'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Las unidades que le tocan a este trabajo, en orden estable.
 *
 * El orden tiene que ser el mismo en todas las pasadas: el cursor es una
 * posición dentro de esta lista, y si la lista se reordenara, reanudar se
 * saltaría unidades sin dar ningún error.
 */
async function unidadesDelJob(
  ctx: ContextoTarea,
  regla: ReglaActivos
): Promise<UnidadDeTrabajo[]> {
  const conexiones = await conexionesDeCliente(ctx.job.client_id)
  const filtradas = ctx.job.connection_id
    ? conexiones.filter((c) => c.id === ctx.job.connection_id)
    : conexiones
  const unidades = unidadesDe(filtradas, regla.marketplace_ids)
  return ctx.job.marketplace_id
    ? unidades.filter((u) => u.marketplaceId === ctx.job.marketplace_id)
    : unidades
}

/**
 * La regla del cliente, o un error ruidoso.
 *
 * Que un cliente no tenga regla NO es un caso normal —la migración 123 siembra
 * una para cada uno—, así que aquí se lanza en vez de saltarse ese cliente en
 * silencio. Un cliente que se queda sin criterio deja de refrescarse a diario y
 * no da ningún error: es el fallo silencioso más caro de esta parte.
 */
async function reglaDelJob(ctx: ContextoTarea): Promise<ReglaActivos> {
  const regla = await reglaActivaDe(ctx.job.client_id)
  if (!regla) {
    throw new Error(
      'Este cliente no tiene ningún criterio de SKU activo en vigor. Sin criterio no se puede ' +
        'decidir qué se refresca a diario, así que el trabajo para aquí: crea una regla en ' +
        'amazon_tracking_rules o vuelve a activar la que había.'
    )
  }
  return regla
}

export const tareaRecalcularActivos: Tarea = {
  tipo: 'recalcular_activos',
  etiqueta: 'Recalcular SKU en seguimiento',
  /** Una unidad por lote. Ver la cabecera */
  tamanoLote: 1,

  async preparar(ctx) {
    const regla = await reglaDelJob(ctx)
    const unidades = await unidadesDelJob(ctx, regla)
    if (unidades.length === 0) {
      await ctx.evento({
        tipo: 'sin_unidades',
        severidad: 'aviso',
        mensaje:
          'Este cliente no tiene ninguna conexión activa con marketplaces que encajen con su ' +
          'criterio, así que no hay catálogo que evaluar.',
      })
      return { totalEstimado: 0 }
    }

    // Se cuenta EN LA BASE, con head:true, para no traerse trece mil filas solo
    // para saber cuántas son. Es lo que da la barra de progreso.
    const service = createServiceClient()
    let total = 0
    for (const unidad of unidades) {
      let consulta = service
        .from('amazon_listings')
        .select('id', { count: 'exact', head: true })
        .eq('connection_id', unidad.connectionId)
        .eq('marketplace_id', unidad.marketplaceId)
      if (ctx.job.skus_filtro) consulta = consulta.in('sku', ctx.job.skus_filtro)
      const { count, error } = await consulta
      if (error) throw error
      total += count ?? 0
    }
    return { totalEstimado: total }
  },

  async siguienteLote(ctx, cursor): Promise<Lote> {
    const regla = await reglaDelJob(ctx)
    const unidades = await unidadesDelJob(ctx, regla)

    const posicion = cursor === null ? 0 : unidades.findIndex((u) => claveUnidad(u) === cursor) + 1
    // findIndex devuelve -1 si la unidad del cursor ya no existe (una conexión
    // que se desconectó a mitad de trabajo). +1 lo deja en 0, o sea: se empieza
    // otra vez desde el principio. Es inofensivo —el cálculo es idempotente— y
    // preferible a saltarse el resto en silencio.
    const siguiente = unidades[posicion]

    if (!siguiente) return { claves: [], cursorSiguiente: cursor, hayMas: false }

    return {
      claves: [claveUnidad(siguiente)],
      cursorSiguiente: claveUnidad(siguiente),
      hayMas: posicion + 1 < unidades.length,
    }
  },

  async procesarLote(ctx, lote): Promise<ResultadoLote> {
    const regla = await reglaDelJob(ctx)
    const unidades = await unidadesDelJob(ctx, regla)
    const clave = lote.claves[0]
    const unidad = unidades.find((u) => claveUnidad(u) === clave)
    if (!unidad) return { procesados: 0 }

    const listings = await listingsDeUnidad(unidad, ctx.job.skus_filtro)
    if (listings.length === 0) return { procesados: 0 }

    // ---------- Ventas, solo si el criterio las usa ----------
    // Si `min_unidades` es null la vía de rotación está apagada y traerse el
    // histórico de ventas serían miles de filas para nada.
    let unidadesVendidas = new Map<string, number>()
    if (regla.min_unidades !== null) {
      const desde = inicioDeVentana(ctx.ahora, regla.ventana_dias)
      const filas = await ventasDesde(ctx.job.client_id, unidad.marketplaceId, desde)
      unidadesVendidas = unidadesPorSku(filas, unidad.marketplaceId)
    }

    const candidatos: CandidatoActivo[] = listings.map((l) => aCandidato(l, unidadesVendidas))
    const resultado = resolverActivos(regla, candidatos)
    const escritura = await escribirActivos(listings, resultado.decisiones, ctx.ahora)

    // ---------- Lo que hay que contar en voz alta ----------
    if (resultado.topeAlcanzado) {
      await ctx.evento({
        tipo: 'tope_activos_alcanzado',
        severidad: 'aviso',
        mensaje:
          `El criterio «${regla.name}» selecciona más SKU de los que permite el tope del ` +
          `cliente (${regla.tope_skus}) en ${unidad.marketplaceId}: se han dejado fuera del ` +
          `seguimiento diario ${resultado.recortados}. Sube el tope o estrecha el criterio.`,
        detalle: { tope: regla.tope_skus, recortados: resultado.recortados },
      })
    }

    if (resultado.activos === 0) {
      await ctx.evento({
        tipo: 'sin_activos',
        severidad: 'error',
        mensaje:
          `El criterio «${regla.name}» no deja NINGÚN SKU en seguimiento en ` +
          `${unidad.marketplaceId}, de ${listings.length} evaluados. Con el conjunto activo ` +
          'vacío, el refresco diario de este cliente no va a traer nada y todo va a parecer ' +
          'que funciona.',
        detalle: { evaluados: listings.length },
      })
    }

    for (const aviso of resultado.avisos) {
      // El del tope y el del conjunto vacío ya se han contado arriba con su
      // severidad propia; los demás avisos van como informativos.
      if (aviso.startsWith('El criterio selecciona') || aviso.startsWith('El criterio de este')) {
        continue
      }
      await ctx.evento({ tipo: 'aviso_activos', severidad: 'aviso', mensaje: aviso })
    }

    console.log(
      `[plataforma] activos ${unidad.marketplaceId}: ${resultado.activos} de ` +
        `${resultado.evaluados} · ${escritura.cambiadas} filas cambiadas en ` +
        `${escritura.consultas} consultas`
    )

    return { procesados: listings.length }
  },

  resumir(_ctx, cuentas: CuentasJob): string {
    return (
      `${cuentas.procesados} SKU evaluados en ${cuentas.lotes} ` +
      `${cuentas.lotes === 1 ? 'unidad' : 'unidades'} (conexión × marketplace).`
    )
  },
}

/**
 * De una fila del catálogo al candidato que entiende el dominio puro.
 *
 * `unidadesVentana` va a null —y NO a cero— cuando no hay dato: un SKU sin
 * ventas registradas no es un SKU que no vende, es un SKU del que no sabemos
 * nada, y descartarlo por rotación sería castigarlo por un agujero nuestro.
 */
function aCandidato(
  listing: ListingParaActivos,
  unidadesVendidas: Map<string, number>
): CandidatoActivo {
  const vendidas = unidadesVendidas.get(listing.sku)
  return {
    sku: listing.sku,
    marketplaceId: listing.marketplace_id,
    esFba: listing.is_fba,
    esMarcaPropia: listing.es_marca_propia,
    listingStatus: listing.listing_status ?? [],
    precio: listing.price,
    marca: listing.marca,
    clasificacionItem: listing.clasificacion_item,
    unidadesVentana: vendidas === undefined ? null : vendidas,
    // El BSR vive en la serie temporal, no en el listing. Se deja a null: solo
    // se usa para ordenar al recortar por el tope, y con null esos SKU van al
    // final del orden, que es lo correcto (no se cuela nadie por falta de dato).
    bsr: null,
    activoManual: listing.activo_manual,
    motivoManual: listing.activo_motivo,
  }
}
