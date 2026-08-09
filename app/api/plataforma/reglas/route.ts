import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { CRITERIO_DE_FABRICA, describirCriterio } from '@/lib/plataforma/activos'
import { reglaActivaDe } from '@/lib/plataforma/datos'
import { registrarEvento } from '@/lib/plataforma/eventos'
import { FALTAN_MIGRACIONES, faltaEsquema, guardarRegla } from '@/lib/plataforma/pantallas'
import type { OrdenTope, ReglaActivos } from '@/lib/plataforma/tipos'

/**
 * EL CRITERIO DE «SKU ACTIVO», QUE ES UNA TABLA Y NO UNA REGLA EN EL CÓDIGO.
 *
 * Solo admin. La especificación lo pide literal: «El criterio de "SKU activo" es
 * una tabla configurable, no una regla en el código. Va a cambiar por cliente y
 * con el tiempo.» Esta ruta es la que lo hace verdad: sin ella, la tabla existe
 * pero solo se puede tocar desde el editor SQL de Supabase, que es tanto como
 * decir que no se puede tocar.
 *
 *
 * ============ LO QUE ESTA PANTALLA DECIDE DE VERDAD ============
 *
 * De qué SKU nos ocupamos CADA NOCHE. Es la decisión más cara del módulo, en los
 * dos sentidos:
 *
 *   · Un criterio demasiado ancho —encender `incluir_fbm` en ShoesF— mete 13.700
 *     referencias en la ventana nocturna y revienta el cupo de Amazon de esa
 *     cuenta, que es por vendedor.
 *   · Un criterio demasiado estrecho deja SKU sin histórico, y el histórico NO
 *     SE RECUPERA HACIA ATRÁS: el BSR de un día que no se guardó se perdió para
 *     siempre.
 *
 * Por eso se devuelve `describirCriterio()` con la regla: quien la configura
 * tiene que poder comprobar de un vistazo que dice lo que cree que dice, y nueve
 * interruptores no se leen de un vistazo.
 *
 * GUARDAR NO RECALCULA NADA. Cambia el criterio, y el conjunto activo se mueve
 * en el próximo «recalcular_activos» —el de la noche, o el que se lance a mano
 * desde la pantalla de ingesta—. Es a propósito: recalcular trece mil filas
 * dentro de un PUT deja la petición colgada dos minutos y la pantalla sin saber
 * si guardó.
 */
export const dynamic = 'force-dynamic'

const ORDENES: OrdenTope[] = ['ventas', 'bsr', 'precio', 'sku']

/* ------------------------------------------------------------------ */
/* Ver                                                                 */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const clientId = request.nextUrl.searchParams.get('clientId') ?? ''
    if (!UUID.test(clientId)) return fail(400, 'Elige el cliente cuyo criterio quieres ver')

    const regla = await reglaActivaDe(clientId)

    return NextResponse.json({
      regla,
      // La frase que resume la regla. Cuando no hay ninguna se describe la de
      // fábrica, porque es lo que va a ver quien pulse «crear»: enseñar un
      // formulario vacío haría que el primer guardado fuera a ciegas.
      descripcion: describirCriterio(regla ?? CRITERIO_DE_FABRICA),
      deFabrica: CRITERIO_DE_FABRICA,
      leidoAt: new Date().toISOString(),
    })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES)
    return errorResponse(error, 'Error leyendo el criterio de SKU activos')
  }
}

/* ------------------------------------------------------------------ */
/* Guardar                                                             */
/* ------------------------------------------------------------------ */

/** Tope de entradas en una lista de marcas o de SKU. Más que esto no es una
    excepción configurada a mano: es un fichero pegado, y eso es otra pantalla */
const MAX_LISTA = 500

/**
 * PATCH y no PUT aunque el cuerpo venga entero: es el verbo para el que el ERP
 * ya tiene cliente con contrato de error (`patchAmazon` en lib/amazon/client.ts,
 * que nunca lanza y devuelve un resultado discriminado). Añadir un `putAmazon`
 * solo para esta ruta serían dos formas de llamar donde hoy hay una.
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : ''
    if (!UUID.test(clientId)) return fail(400, 'Ese cliente no es válido')

    const incluirFba = booleano(body.incluir_fba, true)
    const incluirFbm = booleano(body.incluir_fbm, false)
    const incluirMarcaPropia = booleano(body.incluir_marca_propia, true)
    const minUnidades = enteroOpcional(body.min_unidades)
    const skusIncluidos = lista(body.skus_incluidos)

    // El mismo CHECK que la migración 123 (amazon_tracking_rules_algo_entra),
    // comprobado aquí para poder explicarlo en español. Una regla que no incluye
    // nada no selecciona nada EN SILENCIO: el refresco diario deja de traer
    // datos y todo el mundo cree que sigue funcionando.
    if (!incluirFba && !incluirFbm && !incluirMarcaPropia && minUnidades === null && skusIncluidos.length === 0) {
      return fail(
        400,
        'Este criterio no deja entrar nada, así que ningún SKU se refrescaría a diario y no daría ningún error. Enciende al menos una vía: FBA, FBM, marca propia, un mínimo de ventas o una lista de SKU.'
      )
    }

    const ventanaDias = entero(body.ventana_dias, 30, 1, 365)
    const topeSkus = entero(body.tope_skus, 2000, 1, 200000)

    const ordenPedido = typeof body.orden_tope === 'string' ? (body.orden_tope as OrdenTope) : null
    const ordenTope: OrdenTope = ordenPedido && ORDENES.includes(ordenPedido) ? ordenPedido : 'ventas'

    const anterior = await reglaActivaDe(clientId)

    const regla = await guardarRegla(
      clientId,
      {
        name: typeof body.name === 'string' ? body.name : 'Criterio del cliente',
        marketplace_ids: lista(body.marketplace_ids),
        incluir_fba: incluirFba,
        incluir_fbm: incluirFbm,
        incluir_marca_propia: incluirMarcaPropia,
        min_unidades: minUnidades,
        ventana_dias: ventanaDias,
        solo_listados_activos: booleano(body.solo_listados_activos, true),
        excluir_sin_precio: booleano(body.excluir_sin_precio, true),
        excluir_variacion_padre: booleano(body.excluir_variacion_padre, true),
        marcas_excluidas: lista(body.marcas_excluidas),
        skus_excluidos: lista(body.skus_excluidos),
        skus_incluidos: skusIncluidos,
        tope_skus: topeSkus,
        orden_tope: ordenTope,
        notes: typeof body.notes === 'string' && body.notes.trim() !== '' ? body.notes.trim().slice(0, 2000) : null,
      },
      session.userId
    )

    await registrarEvento({
      tipo: 'criterio_cambiado',
      severidad: 'info',
      clientId,
      mensaje: `Criterio de SKU activos cambiado. Ahora: ${describirCriterio(regla)}`,
      detalle: { antes: resumenDeRegla(anterior), ahora: resumenDeRegla(regla) },
      createdBy: session.userId,
      huella: `criterio_cambiado·${Date.now()}`,
    })

    return NextResponse.json({
      regla,
      descripcion: describirCriterio(regla),
      mensaje:
        'Criterio guardado. El conjunto de SKU en seguimiento NO cambia hasta el próximo recálculo: ' +
        'lánzalo desde la pantalla de ingesta si quieres verlo aplicado ahora.',
    })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES)
    // Los CHECK de la migración hablan en español, así que su mensaje sirve tal
    // cual para quien está delante de la pantalla.
    if ((error as { code?: string })?.code === '23514') {
      return fail(400, (error as { message?: string }).message ?? 'Ese criterio no es válido')
    }
    return errorResponse(error, 'Error guardando el criterio de SKU activos')
  }
}

/* ------------------------------------------------------------------ */
/* Lectura del cuerpo                                                  */
/* ------------------------------------------------------------------ */

function booleano(valor: unknown, porOmision: boolean): boolean {
  return typeof valor === 'boolean' ? valor : porOmision
}

function entero(valor: unknown, porOmision: number, min: number, max: number): number {
  const n = Number(valor)
  if (!Number.isFinite(n)) return porOmision
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * Un entero que puede no estar.
 *
 * null y 0 NO son lo mismo aquí y confundirlos cambia el resultado: null apaga
 * la vía de la rotación, y 0 la deja encendida dejando entrar todo lo que tenga
 * datos de ventas.
 */
function enteroOpcional(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null
  const n = Number(valor)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n)
}

/** Una lista de texto, limpia, sin repetidos y con tope */
function lista(valor: unknown): string[] {
  if (!Array.isArray(valor)) return []
  return [
    ...new Set(
      valor
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter((v) => v !== '')
    ),
  ].slice(0, MAX_LISTA)
}

/** Lo que se guarda en el evento: los interruptores, no las listas enteras */
function resumenDeRegla(regla: ReglaActivos | null): Record<string, unknown> | null {
  if (!regla) return null
  return {
    incluir_fba: regla.incluir_fba,
    incluir_fbm: regla.incluir_fbm,
    incluir_marca_propia: regla.incluir_marca_propia,
    min_unidades: regla.min_unidades,
    ventana_dias: regla.ventana_dias,
    tope_skus: regla.tope_skus,
    orden_tope: regla.orden_tope,
    marcas_excluidas: regla.marcas_excluidas.length,
    skus_excluidos: regla.skus_excluidos.length,
    skus_incluidos: regla.skus_incluidos.length,
  }
}
