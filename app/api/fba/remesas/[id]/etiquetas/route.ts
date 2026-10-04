import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { FORMATOS, hojaDeEtiquetas, type EtiquetaProducto } from '@/lib/fba/etiquetas'
import { puedeImprimirEtiquetas, type EstadoRemesa } from '@/lib/fba/flujo'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL PDF DE ETIQUETAS DE PRODUCTO DE UNA REMESA.
 *
 * Una etiqueta por unidad: si van ocho pares de la talla 43, salen ocho
 * pegatinas iguales. Es lo que se pega, una por caja de producto.
 *
 *
 * ============ NO ANTES DE QUE EL CLIENTE APRUEBE ============
 *
 * En borrador todavía puede cambiar qué se manda, y una etiqueta pegada en un
 * producto que al final no va cuesta más de despegar que de imprimir. El estado
 * se comprueba aquí y no solo en pantalla.
 *
 *
 * ============ DE DÓNDE SALE EL FNSKU ============
 *
 * Primero de la línea de la remesa —las que vinieron del Excel lo traen— y si
 * no, del espejo del catálogo, que lo rellena la pasada nocturna desde el libro
 * mayor. Si no está en ninguno de los dos, esa referencia NO se imprime y se
 * dice cuál: una etiqueta a medias es peor que ninguna.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!UUID.test(params.id)) return fail(400, 'Esa remesa no existe')

    const sesion = await requireFbaAccess('ver')
    if (sesion instanceof NextResponse) return sesion

    const service = createServiceClient()
    const { data: cabecera } = await service
      .from('fba_remesas')
      // `version` NO va en este select, y es a propósito: la migración 215 se
      // lanza a mano y el código llega antes. Un select que la nombra devuelve
      // 42703 y deja SIN ETIQUETAS a quien tiene la mercancía delante, por un
      // contador que solo sirve para un aviso. Se pide aparte, más abajo.
      .select('id, nombre, client_id, connection_id, marketplace_id, estado')
      .eq('id', params.id)
      .maybeSingle()
    if (!cabecera) return fail(404, 'Esa remesa ya no existe')

    const remesa = cabecera as {
      id: string
      nombre: string | null
      client_id: string
      connection_id: string | null
      marketplace_id: string
      estado: EstadoRemesa
    }
    if (sesion.clientesPermitidos && !sesion.clientesPermitidos.includes(remesa.client_id)) {
      return fail(404, 'Esa remesa ya no existe')
    }

    if (!puedeImprimirEtiquetas(remesa.estado)) {
      return fail(
        409,
        'Todavía no. Las etiquetas se imprimen cuando el cliente ha aprobado el envío: en borrador ' +
          'aún puede cambiar qué se manda.'
      )
    }

    const formato = request.nextUrl.searchParams.get('formato') ?? 'a4-21'
    if (!FORMATOS.some((f) => f.id === formato)) return fail(400, 'Ese formato de hoja no existe')

    const { data: lineas } = await service
      .from('fba_remesa_lineas')
      .select('sku, unidades, fnsku, nombre, variante')
      .eq('remesa_id', params.id)
      .order('sku', { ascending: true })

    const filas = (lineas ?? []) as Array<{
      sku: string
      unidades: number
      fnsku: string | null
      nombre: string | null
      variante: string | null
    }>
    if (filas.length === 0) return fail(400, 'Esta remesa no tiene ninguna referencia')

    // El espejo completa lo que falte: FNSKU de las referencias que no lo
    // traían, y el título real de Amazon, que es el que reconoce el almacén.
    const catalogo = new Map<string, { fnsku: string | null; title: string | null }>()
    if (remesa.connection_id) {
      const { data: espejo } = await service
        .from('amazon_listings')
        .select('sku, fnsku, title')
        .eq('connection_id', remesa.connection_id)
        .eq('marketplace_id', remesa.marketplace_id)
        .in('sku', filas.map((l) => l.sku))
      for (const l of (espejo ?? []) as Array<{ sku: string; fnsku: string | null; title: string | null }>) {
        catalogo.set(l.sku, { fnsku: l.fnsku, title: l.title })
      }
    }

    const etiquetas: EtiquetaProducto[] = filas.map((l) => {
      const delEspejo = catalogo.get(l.sku)
      // El título de Amazon manda sobre el nuestro: quien pega la etiqueta y
      // quien la recibe en el almacén ven el mismo texto que en Seller Central.
      const titulo =
        delEspejo?.title ??
        [l.nombre, l.variante].filter(Boolean).join(' · ') ??
        l.sku
      return {
        fnsku: l.fnsku ?? delEspejo?.fnsku ?? '',
        titulo: titulo || l.sku,
        // Nuestro SKU, tal cual está en la remesa. NO el del espejo: si algún día
        // no coincidieran, el que manda es el de la línea que se va a enviar, que
        // es lo que el almacén tiene delante.
        sku: l.sku,
        unidades: l.unidades,
      }
    })

    const { pdf, etiquetas: impresas, paginas, descartadas } = hojaDeEtiquetas(etiquetas, formato)

    /**
     * QUEDA REGISTRADO QUE SE HA IMPRIMIDO, Y CON QUÉ VERSIÓN DEL BOCETO.
     *
     * Es lo que convierte reabrir un envío cerrado en una decisión informada en
     * vez de a ciegas: estas pegatinas se pegan en mercancía de verdad, y si
     * luego se quita una referencia hay que saber que había cuatrocientas
     * puestas de una versión anterior.
     *
     * NO SE ESPERA NI SE DEJA FALLAR LA DESCARGA POR ESTO. Si el registro no se
     * puede escribir, el PDF sale igual: quedarse sin etiquetas con la mercancía
     * delante es peor que quedarse sin el apunte. Se avisa en el log.
     */
    void service
      .from('fba_remesas')
      .select('version')
      .eq('id', remesa.id)
      .maybeSingle()
      .then(({ data: v }) => service.from('fba_impresiones').insert({
        remesa_id: remesa.id,
        version: (v as { version?: number } | null)?.version ?? 1,
        etiquetas: impresas,
        formato,
        descartadas: descartadas.length,
        impreso_por: sesion.userId,
      }))
      .then(({ error }) => {
        if (error) {
          console.error('[fba] no se ha podido registrar la impresión de etiquetas:', error.message)
        }
      })

    /**
     * EL NOMBRE DEL FICHERO, EN ASCII Y A LA FUERZA.
     *
     * Una cabecera HTTP solo admite bytes 0-255, y esta limpieza conservaba las
     * letras de CUALQUIER alfabeto: una remesa llamada «Envío 日本» —o «Łódź», o un
     * nombre pegado desde un documento con letras estilizadas— hacía reventar la
     * construcción de la respuesta con «Cannot convert argument to a ByteString»
     * y devolvía 500. Sin PDF, y con un error que no dice nada de un nombre.
     *
     * Se quitan los acentos primero (NFD + fuera los diacríticos, así «Envío»
     * queda «envio» y no «env o») y después se tira todo lo que no sea ASCII.
     * Si no queda nada —un nombre entero en japonés—, se usa el id.
     */
    const nombre =
      (remesa.nombre ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .toLowerCase() || `remesa-${params.id.slice(0, 8)}`

    return new NextResponse(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="etiquetas-${nombre}.pdf"`,
        // Para que la pantalla pueda avisar sin abrir el PDF
        'X-Etiquetas': String(impresas),
        'X-Paginas': String(paginas),
        'X-Descartadas': String(descartadas.length),
        'X-Motivos': encodeURIComponent(descartadas.map((d) => d.motivo).join(' | ').slice(0, 900)),
      },
    })
  } catch (error) {
    return errorResponse(error, 'No se han podido generar las etiquetas')
  }
}
