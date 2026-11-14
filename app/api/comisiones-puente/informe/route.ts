import { NextResponse, type NextRequest } from 'next/server'
import { exigirSoloAdmin } from '@/lib/comisiones-puente/acceso'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { mesEnLetra, periodoDe } from '@/lib/comisiones-puente/tipos'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * GUARDA EL INFORME DE COMISIÓN QUE VE EL CLIENTE Y DEVUELVE SU ENLACE.
 *
 * Hasta ahora ese informe (`commission_reports`, con su página pública /report/commissions/{slug}) solo salía de la
 * calculadora antigua, la de «Subir CSV a mano». La liquidación nueva escribía el importe en Tesorería y no dejaba nada que
 * enseñarle al cliente. Esta ruta cierra ese hueco con lo MISMO que ya existía: la misma tabla y el mismo enlace.
 *
 *
 * ============ UN INFORME POR CLIENTE Y MES, Y EL ENLACE NO CAMBIA ============
 *
 * Si ya hay un informe de ese cliente para ese mes (el de la calculadora antigua, o uno que se guardó al validar y ahora se
 * vuelve a validar), se ACTUALIZA en vez de crear otro: el enlace que ya se le haya mandado al cliente sigue abriendo, y con
 * los números buenos. Crear uno nuevo cada vez dejaría enlaces viejos con cifras viejas circulando.
 *
 * El `period` es el MES DE COBRO en letra («Noviembre 2026»), que es como el resto del módulo busca el informe guardado.
 *
 *
 * ============ SOLO ADMINISTRADORES ============
 *
 * La ruta escribe una página que luego es pública y sin sesión. Lo que viaja en `data` es lo que devolvió la calculadora al
 * administrador que tiene la pantalla delante: se comprueba la forma y no se cree nada más.
 */

const TOPE_BYTES = 8_000_000

const quitarAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

function slugDe(nombre: string, anio: number, mes: number): string {
  const base = quitarAcentos(nombre)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${base || 'cliente'}-${anio}-${String(mes).padStart(2, '0')}`
}

/** Un cálculo normal (`summary` + `rows`) o uno por marca (`bloques`). Todo lo demás no es un cálculo */
function esCalculo(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false
  const d = data as { summary?: unknown; rows?: unknown; modo?: unknown; bloques?: unknown }
  if (d.modo === 'por_marca') return Array.isArray(d.bloques)
  return typeof d.summary === 'object' && d.summary !== null && Array.isArray(d.rows)
}

/**
 * ¿YA HAY INFORME DE ESTE CLIENTE Y MES? Devuelve su enlace o `ruta: null`.
 *
 * Sirve para que la pantalla enseñe el enlace que ya existe al abrir el cliente, sin obligar a validar o crear otra vez.
 */
export async function GET(request: NextRequest) {
  const permiso = await exigirSoloAdmin()
  if (!permiso.ok) return fail(permiso.estado, permiso.mensaje)

  try {
    const url = new URL(request.url)
    const clienteId = url.searchParams.get('clienteId') ?? ''
    const anio = Number(url.searchParams.get('anio'))
    const mes = Number(url.searchParams.get('mes'))
    if (!UUID.test(clienteId)) return fail(400, 'Falta el cliente')
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) return fail(400, 'Ese año no vale')
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) return fail(400, 'Ese mes no vale')

    const service = createServiceClient()
    const { data, error } = await service
      .from('commission_reports')
      .select('slug')
      .eq('client_id', clienteId)
      .eq('period', mesEnLetra(anio, mes))
      .not('slug', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) throw error
    const slug = ((data ?? [])[0] as { slug: string | null } | undefined)?.slug ?? null
    return NextResponse.json({ ruta: slug ? `/report/commissions/${slug}` : null })
  } catch (error) {
    return errorResponse(error, 'No se ha podido leer el informe del cliente')
  }
}

export async function POST(request: NextRequest) {
  const permiso = await exigirSoloAdmin()
  if (!permiso.ok) return fail(permiso.estado, permiso.mensaje)

  try {
    const cuerpo = (await request.json().catch(() => null)) as {
      clienteId?: string
      anio?: number
      mes?: number
      data?: unknown
      /** Lo manda la pantalla justo después de «Corregir la comisión facturada»: Tesorería ya tiene la cifra nueva */
      corregir?: boolean
    } | null
    if (!cuerpo) return fail(400, 'No ha llegado ningún informe')

    const clienteId = cuerpo.clienteId ?? ''
    const anio = Number(cuerpo.anio)
    const mes = Number(cuerpo.mes)
    if (!UUID.test(clienteId)) return fail(400, 'Falta el cliente')
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) return fail(400, 'Ese año no vale')
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) return fail(400, 'Ese mes no vale')
    if (!esCalculo(cuerpo.data)) return fail(400, 'Eso no es el resultado de un cálculo de comisión')
    if (JSON.stringify(cuerpo.data).length > TOPE_BYTES) return fail(413, 'El informe es demasiado grande para guardarlo')

    const service = createServiceClient()
    // `*`: si la 201 no está lanzada no hay `treasury_client_id`, y nombrarla haría fallar la consulta entera
    const { data: cliente } = await service.from('clients').select('*').eq('id', clienteId).maybeSingle()
    if (!cliente) return fail(404, 'Ese cliente ya no existe')

    /**
     * UN MES CON LA FACTURA YA ENVIADA NO SE TOCA (11 nov 2026, lo pidió Raúl).
     *
     * El informe es la cuenta de la comisión que el cliente tiene en la factura: si se reescribe con otro cálculo, el cliente ve
     * una cifra en el enlace y otra en el PDF (pasó con Shoplamp: el informe decía 203,50 € y la factura 300,55 €). Un borrador
     * no frena, porque el cliente aún no tiene nada y el borrador se corrige. La única puerta es la corrección explícita
     * (`corregir`), que la pantalla manda justo después de escribir la cifra nueva en Tesorería.
     */
    const treasuryClientId = (cliente as { treasury_client_id?: string | null }).treasury_client_id ?? null
    if (treasuryClientId && cuerpo.corregir !== true) {
      const { data: facturas, error: errorFactura } = await service
        .from('invoices')
        .select('invoice_number')
        .eq('treasury_client_id', treasuryClientId)
        .eq('period', periodoDe(anio, mes))
        .not('status', 'in', '(cancelled,draft)')
        .limit(1)
      // Falla cerrado: sin saber si está facturado, no se reescribe lo que el cliente puede estar mirando
      if (errorFactura) throw errorFactura
      const factura = (facturas ?? [])[0] as { invoice_number: string } | undefined
      if (factura) {
        return fail(
          409,
          `${mesEnLetra(anio, mes)} ya está facturado (${factura.invoice_number}) y el cliente tiene la factura: el informe tiene ` +
            'que decir lo mismo. Si la comisión estaba mal, usa «Corregir la comisión facturada».'
        )
      }
    }

    const period = mesEnLetra(anio, mes)

    // ¿Ya hay uno de ese cliente y mes? Se actualiza el más reciente y conserva su enlace
    const { data: previos, error: errorPrevios } = await service
      .from('commission_reports')
      .select('id, slug')
      .eq('client_id', clienteId)
      .eq('period', period)
      .order('created_at', { ascending: false })
      .limit(1)
    if (errorPrevios) throw errorPrevios
    const previo = (previos ?? [])[0] as { id: string; slug: string | null } | undefined

    if (previo) {
      const slug = previo.slug ?? slugDe((cliente as { name: string }).name, anio, mes)
      const { error } = await service
        .from('commission_reports')
        .update({ data: cuerpo.data, slug, status: 'final', updated_at: new Date().toISOString() })
        .eq('id', previo.id)
      if (error) throw error
      return NextResponse.json({ slug, ruta: `/report/commissions/${slug}`, actualizado: true })
    }

    // Nuevo: el enlace legible, y si ya existe (otro cliente con el mismo nombre normalizado) se le añade un sufijo
    const base = slugDe((cliente as { name: string }).name, anio, mes)
    for (let intento = 0; intento < 4; intento++) {
      const slug = intento === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`
      const { error } = await service
        .from('commission_reports')
        .insert({ slug, client_id: clienteId, period, data: cuerpo.data, status: 'final' })
      if (!error) return NextResponse.json({ slug, ruta: `/report/commissions/${slug}`, actualizado: false })
      if (error.code !== '23505') throw error
    }
    return fail(409, 'No se ha podido crear un enlace único para este informe. Inténtalo otra vez.')
  } catch (error) {
    return errorResponse(error, 'No se ha podido guardar el informe del cliente')
  }
}
