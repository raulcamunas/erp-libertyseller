import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { ejecutarCicloStock } from '@/lib/stock-sync/ciclo'
import { publicarSiToca } from '@/lib/entrais/automatico'
import { cuotaRestante } from '@/lib/entrais/api'

/**
 * FORZAR LA PASADA DE UN CLIENTE, AHORA.
 *
 * Hace lo mismo que el reloj pero saltándose los dos frenos que ese tiene para
 * no repetir trabajo: la cadencia y la huella del fichero. Los dos existen
 * porque el cron entra cada minuto y no puede reprocesar lo mismo sin parar; con
 * una persona pulsando un botón ninguno de los dos tiene sentido.
 *
 *
 * ============ QUÉ SE SALTA Y QUÉ NO ============
 *
 * SE SALTA la cadencia, la huella del fichero y el reloj de los precios.
 *
 * NO SE SALTA:
 *
 *   · El perfil apagado. Si `is_active` está en false, ese cliente no se toca —
 *     apagarlo es una decisión, no un despiste.
 *   · `envio_automatico`. Un perfil en simulacro calcula y no manda, forzado
 *     también: si no, este botón sería una puerta trasera para mandar a Amazon
 *     desde un perfil que alguien puso en simulacro a propósito.
 *   · El interruptor de publicar precios. Forzar salta el reloj, no el permiso.
 *   · Los frenos del simulacro (caída a cero, variación, máximo de cambios).
 *     Son de seguridad, no de eficiencia.
 *
 * O sea: esto adelanta el reloj, no abre ninguna puerta.
 *
 *
 * ============ POR QUÉ TAMBIÉN LOS PRECIOS ============
 *
 * Porque «forzar la pasada» significa lo que hace la pasada, y desde la
 * migración 166 eso incluye publicar los precios que hayan cambiado. Dejarlos
 * fuera obligaría a un segundo botón para la mitad del trabajo.
 *
 * Y devuelve el MOTIVO aunque no haya publicado: «está apagado», «no hay perfil
 * activo del que seguir el ritmo», «no había ningún precio que cambiar». Sin eso
 * la única forma de saber por qué no salieron los precios era adivinar, que es
 * exactamente lo que pasó el primer día.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * CUÁNTA CUOTA DEL PROVEEDOR QUEDA ESTA HORA.
 *
 * Entrais admite CUATRO llamadas por hora a su catálogo. El ciclo se lleva dos
 * —una cada media hora, con la caché de veinte minutos vencida— y las otras dos
 * son para las personas. Cuando se acaban, la pasada no falla a medias: falla
 * entera y deja una fila roja en el historial.
 *
 * Por eso esto se pregunta ANTES de enseñar el botón. Un botón que solo te dice
 * que no había cuota DESPUÉS de gastarla no es un aviso, es un recibo.
 *
 * OJO CON UNA COSA: la cuenta vive en la memoria del proceso, así que un
 * despliegue la pone a cero mientras Entrais sigue contando. Justo después de
 * desplegar puede decir que quedan cuatro y que Entrais rechace igualmente. Se
 * dice en la pantalla en vez de fingir una precisión que no hay.
 */
export async function GET() {
  const session = await requireAmazonAdmin()
  if (session instanceof NextResponse) return session

  const real = cuotaRestante('real', '/api/v1/Products')
  const pruebas = cuotaRestante('pruebas', '/api/v1/Products')
  return NextResponse.json({ ok: true, cuota: real ?? pruebas ?? null })
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as { cliente?: string }
    const clienteId = (body.cliente ?? '').trim()
    if (!UUID.test(clienteId)) return fail(400, 'Falta el cliente.')

    /**
     * El presupuesto es más corto que el del cron: 4 minutos.
     *
     * Aquí hay alguien mirando una pantalla, y una petición que tarda nueve
     * minutos se la come el navegador o el proxy antes de contestar. Con un solo
     * cliente sobra: la pasada de Entrais, que es la más gorda, tarda 2 min 13 s.
     */
    const ciclo = await ejecutarCicloStock({
      forzar: true,
      soloCliente: clienteId,
      presupuestoMs: 4 * 60 * 1000,
    })

    /**
     * Los precios van DESPUÉS y en su propio try.
     *
     * Después porque necesitan que Amazon esté recién leído, y de eso se acaba
     * de encargar la pasada de stock. Y aparte porque si publicar precios
     * revienta, el stock ya se ha mandado y esa parte no se pierde: quien mire
     * la respuesta verá el stock hecho y el precio con su error al lado.
     */
    let precios: Awaited<ReturnType<typeof publicarSiToca>> | null = null
    let errorPrecios: string | null = null
    try {
      precios = await publicarSiToca({ forzar: true })
    } catch (error) {
      errorPrecios = error instanceof Error ? error.message : 'Error desconocido'
    }

    return NextResponse.json({
      ok: true,
      cuota: cuotaRestante('real', '/api/v1/Products'),
      ciclo: {
        // `mirados` es cuántos perfiles se han tocado; si sale 0 es que este
        // cliente no tiene ninguno activo, y eso hay que poder verlo.
        mirados: ciclo.perfiles.length,
        detalle: ciclo.perfiles.map((p) => ({
          perfil: p.perfil,
          desenlace: p.desenlace,
          detalle: p.detalle,
          cambios: p.cambios,
          enviados: p.enviados,
        })),
      },
      precios: errorPrecios ? { hecho: false, motivo: errorPrecios } : precios,
    })
  } catch (error) {
    console.error('Error forzando la pasada:', error)
    return fail(500, error instanceof Error ? error.message : 'No se ha podido forzar la pasada')
  }
}
