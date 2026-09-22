import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { puedeEditar, requireFbaAccess } from '@/lib/fba/acceso'
import { cajasDeRemesa, guardarCajas, type CajaEntrante } from '@/lib/fba/cajas'
import { puedeEditarCajas, type EstadoRemesa } from '@/lib/fba/flujo'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LAS CAJAS DE UNA REMESA: LEERLAS Y GUARDARLAS.
 *
 * Las rellena el CLIENTE, que es quien tiene la báscula y el metro, así que
 * esta ruta acepta a quien tenga la cuenta con permiso de edición. Lo que no
 * acepta es tocarlas fuera del paso de encajar: una vez el envío está en Amazon
 * las medidas ya se han mandado, y cambiarlas aquí solo serviría para que la
 * pantalla mienta respecto a lo que Amazon tiene.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_CAJAS = 500

async function remesaYAcceso(id: string, nivel: 'ver' | 'editar') {
  if (!UUID.test(id)) return { error: fail(400, 'Esa remesa no existe') as NextResponse }

  const sesion = await requireFbaAccess(nivel)
  if (sesion instanceof NextResponse) return { error: sesion }

  const service = createServiceClient()
  const { data } = await service
    .from('fba_remesas')
    .select('id, client_id, estado')
    .eq('id', id)
    .maybeSingle()
  if (!data) return { error: fail(404, 'Esa remesa ya no existe') as NextResponse }

  const remesa = data as { id: string; client_id: string; estado: EstadoRemesa }
  // El mismo 404 que si no existiera: a quien no tiene acceso no se le confirma
  // ni que exista.
  if (nivel === 'editar' && !puedeEditar(sesion, remesa.client_id)) {
    return { error: fail(404, 'Esa remesa ya no existe') as NextResponse }
  }
  if (nivel === 'ver' && sesion.clientesPermitidos && !sesion.clientesPermitidos.includes(remesa.client_id)) {
    return { error: fail(404, 'Esa remesa ya no existe') as NextResponse }
  }

  return { remesa, sesion }
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const r = await remesaYAcceso(params.id, 'ver')
    if (r.error) return r.error
    return NextResponse.json(await cajasDeRemesa(params.id))
  } catch (error) {
    return errorResponse(error, 'No se han podido leer las cajas')
  }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const r = await remesaYAcceso(params.id, 'editar')
    if (r.error) return r.error

    if (!puedeEditarCajas(r.remesa!.estado)) {
      return fail(
        409,
        'Las cajas solo se pueden tocar mientras se está encajando. Si hay que corregirlas, ' +
          'primero vuelve a ese paso.'
      )
    }

    const body = (await request.json().catch(() => ({}))) as { cajas?: unknown }
    if (!Array.isArray(body.cajas)) return fail(400, 'Falta la lista de cajas')
    if (body.cajas.length > MAX_CAJAS) return fail(400, `Son demasiadas cajas (máximo ${MAX_CAJAS})`)

    // Se valida TODO antes de tocar nada: se borra el conjunto entero para
    // reescribirlo, así que un fallo a mitad dejaría a la remesa sin cajas.
    const numeros = new Set<number>()
    const limpias: CajaEntrante[] = []

    for (const [i, cruda] of (body.cajas as Array<Record<string, unknown>>).entries()) {
      const numero = Number(cruda.numero)
      if (!Number.isInteger(numero) || numero <= 0) {
        return fail(400, `La caja ${i + 1} no tiene un número válido`)
      }
      if (numeros.has(numero)) return fail(400, `Hay dos cajas con el número ${numero}`)
      numeros.add(numero)

      const medida = (v: unknown, nombre: string): number | null | NextResponse => {
        if (v === null || v === undefined || v === '') return null
        const n = Number(v)
        if (!Number.isFinite(n) || n <= 0) {
          return fail(400, `La caja ${numero}: «${nombre}» tiene que ser un número mayor que cero`)
        }
        // Un tope que no molesta a nadie y frena el dedo gordo: 500 cm de lado
        // o 1.000 kg no es una caja, es un error de tecleo.
        if (n > 1000) return fail(400, `La caja ${numero}: «${nombre}» es imposible`)
        return n
      }

      const largoCm = medida(cruda.largoCm, 'largo')
      if (largoCm instanceof NextResponse) return largoCm
      const anchoCm = medida(cruda.anchoCm, 'ancho')
      if (anchoCm instanceof NextResponse) return anchoCm
      const altoCm = medida(cruda.altoCm, 'alto')
      if (altoCm instanceof NextResponse) return altoCm
      const pesoKg = medida(cruda.pesoKg, 'peso')
      if (pesoKg instanceof NextResponse) return pesoKg

      const vistos = new Set<string>()
      const contenido: Array<{ sku: string; unidades: number }> = []
      for (const x of (Array.isArray(cruda.contenido) ? cruda.contenido : []) as Array<
        Record<string, unknown>
      >) {
        const sku = typeof x.sku === 'string' ? x.sku.trim() : ''
        if (!sku) continue
        const unidades = Number(x.unidades)
        if (!Number.isInteger(unidades) || unidades < 0) {
          return fail(400, `La caja ${numero}: las unidades de ${sku} no son válidas`)
        }
        if (unidades === 0) continue
        if (vistos.has(sku)) {
          return fail(400, `La caja ${numero} tiene ${sku} dos veces. Súmalo en una sola línea`)
        }
        vistos.add(sku)
        contenido.push({ sku, unidades })
      }

      limpias.push({ numero, largoCm, anchoCm, altoCm, pesoKg, contenido })
    }

    await guardarCajas(params.id, limpias)

    // Se devuelve el cuadre recalculado: la pantalla necesita saber si ya cuadra
    // sin tener que pedirlo aparte.
    return NextResponse.json(await cajasDeRemesa(params.id))
  } catch (error) {
    return errorResponse(error, 'No se han podido guardar las cajas')
  }
}
