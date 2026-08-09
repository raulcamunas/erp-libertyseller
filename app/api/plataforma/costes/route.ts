import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, readText, requireAmazonAdmin } from '@/lib/amazon/api'
import { FALTAN_MIGRACIONES, faltaEsquema } from '@/lib/plataforma/pantallas'
import { aplicarPlan, costesEnFechas } from '@/lib/plataforma/costes/datos'
import { planificarEscritura, type CosteAEscribir } from '@/lib/plataforma/costes/plan'
import { tablaDeCostes, type FiltroEstado } from '@/lib/plataforma/costes/pantalla'
import { esFechaIso } from '@/lib/plataforma/costes/vigencia'

/**
 * LA TABLA DE COSTES DE UN CLIENTE, Y LA EDICIÓN A MANO DE UNO SUELTO.
 *
 * Solo admin. UN cliente por petición, sin excepción: los costes de compra de un
 * vendedor son de lo más sensible que hay en esta base, y el compromiso firmado
 * ante Amazon obliga a mantenerlos separados por cuenta. No hay ningún parámetro
 * que devuelva los costes de varios clientes ni que los compare.
 */
export const dynamic = 'force-dynamic'

const ESTADOS: FiltroEstado[] = ['todos', 'sin_coste', 'incompleto', 'completo', 'caducado']

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const params = request.nextUrl.searchParams
    const clientId = params.get('clientId') ?? ''
    if (!UUID.test(clientId)) return fail(400, 'Elige el cliente cuyos costes quieres ver')

    const estado = (params.get('estado') ?? 'todos') as FiltroEstado
    const fecha = params.get('fecha')
    if (fecha && !esFechaIso(fecha)) return fail(400, 'La fecha tiene que ser AAAA-MM-DD')

    const vista = await tablaDeCostes({
      clientId,
      texto: params.get('texto') ?? undefined,
      estado: ESTADOS.includes(estado) ? estado : 'todos',
      marketplaceId: params.get('marketplaceId') ?? undefined,
      soloSeguimiento: params.get('soloSeguimiento') === '1',
      fecha: fecha ?? undefined,
      pagina: Number(params.get('pagina') ?? 0) || 0,
    })

    return NextResponse.json({ ...vista, leidoAt: new Date().toISOString() })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES)
    return errorResponse(error, 'Error cargando los costes')
  }
}

/**
 * Alta o corrección A MANO de un coste suelto.
 *
 * DOS COSAS OBLIGATORIAS Y LAS DOS A PROPÓSITO:
 *
 *   · El MOTIVO. Lo exige también el CHECK de la migración 126 para todo lo que
 *     entra con origen 'manual'. Un coste cambiado a mano sin explicación es
 *     imposible de auditar tres meses después, que es justo cuando alguien
 *     pregunta por qué el margen de ese SKU no cuadra.
 *   · La FECHA DE ENTRADA EN VIGOR. No se pone hoy por defecto y no es una
 *     molestia: escribir un coste con la fecha de hoy cuando en realidad rige
 *     desde marzo deja los márgenes de marzo, abril y mayo calculados con el
 *     coste viejo, y nadie se entera.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const clientId = typeof body.clientId === 'string' ? body.clientId : ''
    if (!UUID.test(clientId)) return fail(400, 'Falta el cliente')

    const sku = readText(body.sku, 200)
    if (!sku) return fail(400, 'Falta el SKU')

    const validoDesde = typeof body.valido_desde === 'string' ? body.valido_desde : ''
    if (!esFechaIso(validoDesde)) {
      return fail(400, 'Hay que decir desde cuándo rige este coste, en formato AAAA-MM-DD')
    }

    const motivo = readText(body.motivo, 500)
    if (!motivo) {
      return fail(
        400,
        'Hay que decir por qué se mete o se cambia este coste: es lo único que permite auditarlo después'
      )
    }

    const coste = numero(body.coste)
    if (coste === null || coste < 0) {
      return fail(400, 'El precio de compra tiene que ser un número mayor o igual que cero')
    }

    const moneda = readText(body.moneda, 8)
    if (!moneda) {
      return fail(
        400,
        'Falta la divisa. Un coste sin divisa no se puede comparar con un precio de Amazon en cuanto el cliente compre en dólares y venda en euros'
      )
    }

    const ivaIncluido = body.iva_incluido === true
    const ivaPorcentaje = numero(body.iva_porcentaje)
    if (ivaIncluido && (ivaPorcentaje === null || ivaPorcentaje < 0 || ivaPorcentaje >= 100)) {
      return fail(
        400,
        'Si el coste lleva IVA incluido hace falta el tipo: sin él no se puede llevar a base imponible'
      )
    }

    const nuevo: CosteAEscribir = {
      sku,
      valido_desde: validoDesde,
      coste,
      moneda: moneda.toUpperCase(),
      coste_envio: numero(body.coste_envio),
      coste_almacen_fba: numero(body.coste_almacen_fba),
      coste_flete_fba: numero(body.coste_flete_fba),
      iva_incluido: ivaIncluido,
      iva_porcentaje: ivaIncluido ? ivaPorcentaje : null,
      origen: 'manual',
      fuente_ref: null,
      notes: readText(body.notes, 1000),
    }

    // Se planifica igual que una importación: así una corrección a mano deja
    // exactamente el mismo rastro que una que venga de un fichero, y la
    // auditoría de un SKU se lee de arriba abajo sin tener que saber por dónde
    // entró cada cambio.
    const existentes = await costesEnFechas(clientId, [validoDesde])
    const plan = planificarEscritura([nuevo], existentes)

    if (plan.sinCambio > 0) {
      return NextResponse.json({
        cambiado: false,
        mensaje: 'Ese coste ya estaba exactamente así: no se ha tocado nada.',
      })
    }

    const resultado = await aplicarPlan(clientId, plan, {
      userId: session.userId,
      importId: null,
      motivo,
    })

    return NextResponse.json({
      cambiado: true,
      alta: resultado.altas > 0,
      correccion: resultado.correcciones > 0,
      cambios: plan.correcciones[0]?.campos ?? [],
    })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES)
    return errorResponse(error, 'Error guardando el coste')
  }
}

/** Un número del cuerpo de la petición, o null. Nunca 0 por descuido */
function numero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null
  const n = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
