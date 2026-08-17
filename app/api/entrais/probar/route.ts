import { NextResponse, type NextRequest } from 'next/server'
import { fail, requireAmazonAdmin } from '@/lib/amazon/api'
import {
  EntraisError,
  faltaConfigurar,
  llamarEntraisDetalle,
  type EntornoEntrais,
} from '@/lib/entrais/api'

/**
 * ENTRAIS · BANCO DE PRUEBAS.
 *
 * Una llamada a la API del proveedor y su respuesta en crudo. No guarda nada:
 * está para ver QUÉ datos hay antes de decidir qué se guarda y con qué forma.
 *
 *
 * ============ SOLO GET, Y ESO NO ES UNA LIMITACIÓN TEMPORAL ============
 *
 * Su API tiene un `POST /api/v1/CreatePreOrder` que CREA UNA RESERVA DE PEDIDO
 * en el proveedor. Eso mueve mercancía y dinero de un cliente, y no puede estar
 * a un carácter de distancia en una pantalla que existe para explorar.
 *
 * Así que esta ruta solo deja leer. El día que haya que crear reservas de
 * verdad, será su propia pantalla, con su confirmación, su registro de quién
 * pidió qué y su simulacro delante. No un método más en un desplegable.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/** Los prefijos que se pueden llamar. Todo lo que no esté aquí se rechaza */
const PERMITIDAS = [
  '/api/v1/Products',
  '/api/v1/Product/',
  '/api/v1/Orders',
  '/api/v1/Order/',
  '/api/v1/OrderBy/',
  '/api/v1/Invoices',
  '/api/v1/Invoice/',
  '/api/v1/InvoiceSerialNumbers/',
  '/api/v1/SerialNumbersByReference/',
  '/api/v1/Rmas',
  '/api/v1/ShippingAgencys',
  '/api/v1/GetAllCodes/',
  '/api/v1/GetCode/',
]

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      entorno?: string
      ruta?: string
      /** true = ignora la caché y gasta una llamada de la cuota a propósito */
      forzar?: boolean
    }

    // Por omisión, PRUEBAS. Si alguien no dice contra cuál va, va contra el que
    // no tiene consecuencias.
    const entorno: EntornoEntrais = body.entorno === 'real' ? 'real' : 'pruebas'

    const falta = faltaConfigurar(entorno)
    if (falta) return fail(400, falta)

    const ruta = (body.ruta ?? '').trim()
    if (!ruta.startsWith('/') || ruta.includes('..')) {
      return fail(400, 'La ruta tiene que empezar por «/» y no puede llevar «..».')
    }
    if (!PERMITIDAS.some((p) => ruta.startsWith(p))) {
      return fail(
        400,
        `«${ruta}» no está entre las llamadas de lectura de este banco de pruebas. ` +
          'Crear reservas no se hace desde aquí: eso mueve mercancía de un cliente y tendrá su ' +
          'propia pantalla con confirmación y registro.'
      )
    }

    const t0 = Date.now()
    /**
     * ESTE BANCO DE PRUEBAS TAMBIÉN GASTA CUOTA, y ese era el problema.
     *
     * Entrais admite CUATRO llamadas por hora a `/api/v1/Products`. Cuatro
     * clics aquí mirando el JSON dejan sin llamadas al ciclo de stock durante
     * el resto de la hora, y el ciclo se entera con un 429 en una ejecución
     * automática que no tiene a nadie delante.
     *
     * Así que se llama por la misma puerta que todo lo demás, con su caché y su
     * contador, y la respuesta dice de dónde ha salido el dato y cuántas
     * llamadas quedan. Quien quiera una lectura fresca de verdad tiene el
     * interruptor; lo que no puede pasar es gastarla sin saberlo.
     */
    const lectura = await llamarEntraisDetalle<unknown>(entorno, ruta, {
      frescuraMs: body.forzar === true ? 0 : undefined,
    })
    const datos = lectura.datos

    return NextResponse.json({
      ok: true,
      entorno,
      ms: Date.now() - t0,
      // Cuántos vienen, para no tener que contarlos a ojo en un JSON de miles
      // de líneas: es el primer dato que se busca al pedir «todos los productos».
      cuantos: Array.isArray(datos) ? datos.length : null,
      deCache: lectura.deCache,
      edadMs: lectura.edadMs,
      cuota: lectura.cuota,
      datos,
    })
  } catch (error) {
    if (error instanceof EntraisError) return fail(400, error.message)
    console.error('Error llamando a la API de Entrais:', error)
    return fail(500, error instanceof Error ? error.message : 'Ha fallado la llamada')
  }
}
