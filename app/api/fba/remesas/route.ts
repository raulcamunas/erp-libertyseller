import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * DAR DE ALTA UNA REMESA: LO QUE MANDAMOS A LOS ALMACENES DE AMAZON.
 *
 * La cabecera y sus líneas se escriben JUNTAS. Si las líneas fallan, la remesa
 * se borra: media remesa —una cabecera sin referencias— aparece en el panel como
 * un envío de cero unidades y se lee como un envío que no vendió nada, que es
 * justo lo contrario de lo que pasa.
 *
 * Supabase no da transacciones desde el cliente REST, así que el rescate es
 * manual y explícito. Es feo y es correcto.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_LINEAS = 3000

interface LineaEntrante {
  sku?: unknown
  unidades?: unknown
  referencia?: unknown
  nombre?: unknown
  variante?: unknown
  ean?: unknown
  fnsku?: unknown
  asin?: unknown
}

const texto = (v: unknown, max = 200): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim().slice(0, max)
  return t.length > 0 ? t : null
}

export async function GET(request: NextRequest) {
  try {
    const clienteId = request.nextUrl.searchParams.get('cliente') ?? ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const session = await requireFbaAccess('ver', clienteId)
    if (session instanceof NextResponse) return session

    const service = createServiceClient()
    const { data, error } = await service
      .from('fba_remesas')
      .select('id, nombre, fecha_envio, llegada_at, referencia_envio, nota, created_at')
      .eq('client_id', clienteId)
      .order('fecha_envio', { ascending: false })
    if (error) throw error

    return NextResponse.json({ remesas: data ?? [] })
  } catch (error) {
    return errorResponse(error, 'No se han podido leer las remesas')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      clienteId?: unknown
      marketplaceId?: unknown
      nombre?: unknown
      fechaEnvio?: unknown
      referenciaEnvio?: unknown
      nota?: unknown
      lineas?: unknown
    }

    const clienteId = texto(body.clienteId, 40) ?? ''
    if (!UUID.test(clienteId)) return fail(400, 'Elige el cliente de la remesa')

    // Crear exige poder EDITAR ese cliente. Un acceso de solo lectura se para aquí.
    const session = await requireFbaAccess('editar', clienteId)
    if (session instanceof NextResponse) return session

    const marketplaceId = texto(body.marketplaceId, 20)
    if (!marketplaceId) return fail(400, 'Falta el mercado de la remesa')

    const fechaEnvio = texto(body.fechaEnvio, 10)
    if (!fechaEnvio || !/^\d{4}-\d{2}-\d{2}$/.test(fechaEnvio)) {
      return fail(400, 'La fecha de envío tiene que ser un día, con el formato 2026-09-18')
    }

    if (!Array.isArray(body.lineas) || body.lineas.length === 0) {
      return fail(400, 'Una remesa sin referencias no es una remesa. Añade al menos una')
    }
    if (body.lineas.length > MAX_LINEAS) {
      return fail(400, `Son demasiadas referencias de golpe (máximo ${MAX_LINEAS})`)
    }

    // Se valida TODO antes de escribir nada: media remesa es peor que ninguna.
    const vistos = new Set<string>()
    const lineas: Array<Record<string, unknown>> = []
    for (const [i, cruda] of (body.lineas as LineaEntrante[]).entries()) {
      const sku = texto(cruda.sku, 120)
      if (!sku) return fail(400, `La línea ${i + 1} no tiene SKU`)
      if (vistos.has(sku)) {
        return fail(
          400,
          `El SKU ${sku} está dos veces. En una misma remesa cada referencia va una sola vez: ` +
            'si mandaste dos cajas del mismo, suma las unidades en una línea'
        )
      }
      vistos.add(sku)

      const unidades = Number(cruda.unidades)
      if (!Number.isInteger(unidades) || unidades <= 0) {
        return fail(400, `Las unidades de ${sku} tienen que ser un número entero mayor que cero`)
      }

      lineas.push({
        sku,
        unidades,
        referencia: texto(cruda.referencia, 120),
        nombre: texto(cruda.nombre, 400),
        variante: texto(cruda.variante, 80),
        ean: texto(cruda.ean, 40),
        fnsku: texto(cruda.fnsku, 40),
        asin: texto(cruda.asin, 20),
      })
    }

    const service = createServiceClient()

    // La conexión del cliente, si la tiene. ShoesF no la tiene y es un caso
    // normal: sus remesas se llevan igual, solo que sin ventas automáticas.
    const { data: conexion } = await service
      .from('amazon_connections')
      .select('id')
      .eq('client_id', clienteId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    const { data: creada, error: errorAlta } = await service
      .from('fba_remesas')
      .insert({
        client_id: clienteId,
        connection_id: (conexion as { id: string } | null)?.id ?? null,
        marketplace_id: marketplaceId,
        nombre: texto(body.nombre, 120),
        fecha_envio: fechaEnvio,
        referencia_envio: texto(body.referenciaEnvio, 120),
        nota: texto(body.nota, 1000),
        created_by: session.userId,
      })
      .select('id')
      .single()
    if (errorAlta) throw errorAlta

    const remesaId = (creada as { id: string }).id

    const { error: errorLineas } = await service
      .from('fba_remesa_lineas')
      .insert(lineas.map((l) => ({ ...l, remesa_id: remesaId })))

    if (errorLineas) {
      // El rescate. Sin esto queda una cabecera sin líneas que el panel pinta
      // como un envío de cero unidades, o sea como un envío que no vendió nada.
      await service.from('fba_remesas').delete().eq('id', remesaId)
      throw errorLineas
    }

    return NextResponse.json({ id: remesaId, lineas: lineas.length })
  } catch (error) {
    return errorResponse(error, 'No se ha podido crear la remesa')
  }
}
