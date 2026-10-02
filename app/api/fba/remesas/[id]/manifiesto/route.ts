import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { LibroError } from '@/lib/fba/libro'
import { rellenarManifiesto, type LineaManifiesto } from '@/lib/fba/manifiesto'
import { puedeImprimirEtiquetas, type EstadoRemesa } from '@/lib/fba/flujo'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL MANIFIESTO DE UNA REMESA, SOBRE LA PLANTILLA QUE SUBE EL CLIENTE.
 *
 * Es POST y no GET porque hace falta un fichero de entrada: la plantilla que el
 * cliente acaba de descargar de SU Seller Central. No puede vivir en el
 * repositorio —lleva grabada la cuenta y la versión, y Amazon publica versiones
 * nuevas—, así que entra con la petición, se rellena en memoria y sale.
 *
 * NO SE GUARDA EN NINGÚN SITIO. Entra, se rellena y se devuelve: es un paso de
 * una gestión, no un documento del cliente. Guardarla obligaría a decidir cuándo
 * se borra y a cargar con la plantilla de cada envío de cada cliente para
 * siempre.
 *
 *
 * ============ EL MISMO LISTÓN QUE LAS ETIQUETAS ============
 *
 * `puedeImprimirEtiquetas`: cuando el cliente ha aprobado el envío. En borrador
 * todavía puede cambiar qué se manda, y un manifiesto subido a Seller Central
 * con las cantidades viejas crea un envío que luego no cuadra con la mercancía.
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

    if (!puedeImprimirEtiquetas(remesa.estado)) {
      return fail(
        409,
        'Todavía no. El manifiesto se genera cuando el cliente ha aprobado el envío: en borrador ' +
          'aún puede cambiar qué se manda, y Amazon se quedaría con las cantidades viejas.'
      )
    }

    const form = await request.formData()
    const subida = form.get('plantilla')
    if (!subida || typeof subida === 'string' || typeof subida.arrayBuffer !== 'function') {
      return fail(
        400,
        'Falta la plantilla. Descárgala en Seller Central, en «Enviar a Amazon», y súbela aquí: ' +
          'lleva grabada la cuenta del cliente, así que no puede estar guardada en el ERP.'
      )
    }
    const fichero = subida as File
    if (!fichero.name.toLowerCase().endsWith('.xlsx')) {
      return fail(400, `«${fichero.name}» no es un .xlsx. La plantilla de Amazon se descarga ya en ese formato.`)
    }
    // Las plantillas que hay descargadas pesan entre 10 y 60 KB. Un tope de 10 MB
    // es holgadísimo y a la vez impide que un fichero enorme se coma la memoria
    // del contenedor antes de que nadie mire si siquiera es un Excel.
    if (fichero.size > 10 * 1024 * 1024) {
      return fail(400, `«${fichero.name}» ocupa demasiado para ser la plantilla del manifiesto.`)
    }

    const { data: lineas } = await service
      .from('fba_remesa_lineas')
      .select('sku, unidades')
      .eq('remesa_id', params.id)
      .order('sku', { ascending: true })

    const filas = (lineas ?? []) as LineaManifiesto[]
    if (filas.length === 0) return fail(400, 'Esta remesa no tiene ninguna referencia')

    const r = rellenarManifiesto(await fichero.arrayBuffer(), filas)

    const nombre = (remesa.nombre ?? `remesa-${params.id.slice(0, 8)}`)
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase()

    return new NextResponse(Buffer.from(r.xlsx), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="manifiesto-${nombre}.xlsx"`,
        // Para que la pantalla pueda avisar sin abrir el fichero, igual que hace
        // la ruta de etiquetas.
        'X-Lineas': String(r.lineas),
        'X-Unidades': String(r.unidades),
        'X-Descartadas': String(r.descartadas.length),
        'X-Motivos': encodeURIComponent(
          r.descartadas.map((d) => `${d.sku}: ${d.motivo}`).join(' | ').slice(0, 900)
        ),
      },
    })
  } catch (error) {
    // Lo que dice LibroError ya está escrito para que lo lea una persona: qué
    // fichero falta, de dónde se baja o por qué no se ha escrito nada. Pasarlo
    // por errorResponse lo convertiría en «no se ha podido generar».
    if (error instanceof LibroError) return fail(400, error.message)
    return errorResponse(error, 'No se ha podido generar el manifiesto')
  }
}
