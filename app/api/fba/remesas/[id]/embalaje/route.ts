import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { rellenarEmbalaje, type CajaParaPlantilla } from '@/lib/fba/embalaje'
import { LibroError } from '@/lib/fba/libro'
import { type EstadoRemesa } from '@/lib/fba/flujo'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL EXCEL DE EMBALAJE DE UNA REMESA.
 *
 * Entra la plantilla que Seller Central acaba de dar para ESTE envío, sale
 * rellena con lo que ya está encajado en el ERP. Igual que el manifiesto: la
 * plantilla no vive aquí —lleva dentro el identificador del grupo de paquetes de
 * ese envío concreto— así que se sube con la petición y no se guarda.
 *
 *
 * ============ EL LISTÓN ES «SE PUEDEN EDITAR LAS CAJAS» ============
 *
 * Y no el de las etiquetas. Este fichero se genera CUANDO YA SE HA ENCAJADO, que
 * es más tarde: pedirlo en «aprobada» daría un Excel con cero cajas, y lo
 * correcto es decir que todavía no toca.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!UUID.test(params.id)) return fail(400, 'Esa remesa no existe')

    const sesion = await requireFbaAccess('ver')
    if (sesion instanceof NextResponse) return sesion

    const service = createServiceClient()
    const { data: cabecera } = await service
      .from('fba_remesas')
      .select('id, nombre, client_id, estado')
      .eq('id', params.id)
      .maybeSingle()
    if (!cabecera) return fail(404, 'Esa remesa ya no existe')

    const remesa = cabecera as { id: string; nombre: string | null; client_id: string; estado: EstadoRemesa }
    if (sesion.clientesPermitidos && !sesion.clientesPermitidos.includes(remesa.client_id)) {
      return fail(404, 'Esa remesa ya no existe')
    }

    // En 'lista' y más adelante las cajas ya no se tocan, pero el fichero se
    // sigue pudiendo generar: se sube a Seller Central DESPUÉS de encajar.
    if (remesa.estado === 'borrador' || remesa.estado === 'aprobada') {
      return fail(
        409,
        'Todavía no hay nada encajado. Este fichero dice en qué caja va cada unidad, así que se ' +
          'genera cuando se han montado las cajas y se les han puesto peso y medidas.'
      )
    }

    const form = await request.formData()
    const subida = form.get('plantilla')
    if (!subida || typeof subida === 'string' || typeof subida.arrayBuffer !== 'function') {
      return fail(
        400,
        'Falta la plantilla de embalaje. Es la que descarga Seller Central en el paso de las cajas, ' +
          'y lleva dentro el identificador de ESTE envío: no puede estar guardada en el ERP.'
      )
    }
    const fichero = subida as File
    if (!fichero.name.toLowerCase().endsWith('.xlsx')) {
      return fail(400, `«${fichero.name}» no es un .xlsx.`)
    }
    if (fichero.size > 10 * 1024 * 1024) {
      return fail(400, `«${fichero.name}» ocupa demasiado para ser la plantilla de embalaje.`)
    }

    // ---------- Las cajas, con su contenido ----------
    const { data: filas } = await service
      .from('fba_cajas')
      .select('id, numero, largo_cm, ancho_cm, alto_cm, peso_kg, fba_caja_contenido(sku, unidades)')
      .eq('remesa_id', params.id)
      .order('numero', { ascending: true })

    const cajas = (filas ?? []) as Array<{
      id: string
      numero: number
      largo_cm: number | null
      ancho_cm: number | null
      alto_cm: number | null
      peso_kg: number | null
      fba_caja_contenido: Array<{ sku: string; unidades: number }> | null
    }>

    if (cajas.length === 0) {
      return fail(400, 'Esta remesa no tiene ninguna caja montada todavía.')
    }

    // SIN MEDIDAS NO SE GENERA, y se dice cuáles faltan. Amazon acepta el
    // fichero con esas celdas vacías y lo que pasa después es que el envío se
    // queda sin poder cotizar el transporte, con la mercancía ya etiquetada.
    const sinMedidas = cajas
      .filter((c) => c.peso_kg == null || c.largo_cm == null || c.ancho_cm == null || c.alto_cm == null)
      .map((c) => c.numero)
    if (sinMedidas.length > 0) {
      return fail(
        400,
        `A ${sinMedidas.length === 1 ? 'la caja' : 'las cajas'} ${sinMedidas.join(', ')} ` +
          `le${sinMedidas.length === 1 ? '' : 's'} falta el peso o alguna medida. Amazon acepta el ` +
          'fichero igual y el envío se queda sin poder cotizar el transporte.'
      )
    }

    const paraPlantilla: CajaParaPlantilla[] = cajas.map((c) => ({
      numero: c.numero,
      pesoKg: Number(c.peso_kg),
      anchoCm: Number(c.ancho_cm),
      largoCm: Number(c.largo_cm),
      altoCm: Number(c.alto_cm),
      contenido: (c.fba_caja_contenido ?? []).map((l) => ({ sku: l.sku, unidades: l.unidades })),
    }))

    const r = rellenarEmbalaje(await fichero.arrayBuffer(), paraPlantilla)

    const nombre = (remesa.nombre ?? `remesa-${params.id.slice(0, 8)}`)
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase()

    return new NextResponse(Buffer.from(r.xlsx), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="embalaje-${nombre}.xlsx"`,
        'X-Cajas': String(r.cajas),
        'X-Unidades': String(r.unidades),
        'X-Unidades-Plantilla': `${r.unidadPeso}/${r.unidadMedida}`,
        // El descuadre NO impide generar: puede ser que Amazon espere menos
        // porque se quitó una referencia después. Pero se dice, porque aparece
        // en recepción días después y con la mercancía allí.
        'X-Descuadres': String(r.descuadres.length),
        'X-Descuadre-Detalle': encodeURIComponent(
          r.descuadres
            .map((d) => `${d.sku}: Amazon espera ${d.previstas}, encajadas ${d.encajadas}`)
            .join(' | ')
            .slice(0, 900)
        ),
        'X-Pesadas': encodeURIComponent(
          r.pesadas.map((p) => `caja ${p.numero}: ${p.pesoKg} kg`).join(' | ').slice(0, 300)
        ),
      },
    })
  } catch (error) {
    if (error instanceof LibroError) return fail(400, error.message)
    return errorResponse(error, 'No se ha podido generar el fichero de embalaje')
  }
}
