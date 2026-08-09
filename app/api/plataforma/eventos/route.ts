import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { cargarEventos, isMissingSchema } from '@/lib/plataforma/eventos'
import { EVENTO_SEVERIDAD_LABELS, type EventoSeveridad } from '@/lib/plataforma/tipos'

/**
 * LA COLA DE INCIDENCIAS DE LA INGESTA.
 *
 * Solo admin. Es la otra mitad de «fallos ruidosos, nunca silenciosos»: la
 * primera es que los trabajos registren lo que pasa, y esta es que se pueda
 * mirar sin abrir la consola del contenedor.
 *
 * SE FILTRA EN LA BASE Y CON UN LÍMITE, nunca trayéndoselo todo para filtrarlo
 * en el navegador. Esta tabla crece para siempre, así que la vía fácil funciona
 * el primer mes y deja de funcionar justo cuando el histórico empieza a servir
 * para algo. Es la misma lección que ya está escrita en loadSubmissions().
 *
 * DE UN SOLO CLIENTE, SIEMPRE. `clientId` es OBLIGATORIO, igual que en
 * /api/plataforma/ingesta y /api/plataforma/cobertura, y no por comodidad: la
 * fila de amazon_eventos lleva `sku` y el mensaje libre, así que sin ese filtro
 * una sola respuesta mezclaría referencias de ShoesF con las de Creative Toys.
 * Los datos de un vendedor se usan EXCLUSIVAMENTE para operar su cuenta, y eso
 * incluye las vistas internas: no hay ninguna pantalla del ERP que pueda
 * enseñar la ingesta de dos clientes a la vez.
 */
export const dynamic = 'force-dynamic'

const SEVERIDADES = Object.keys(EVENTO_SEVERIDAD_LABELS) as EventoSeveridad[]

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const q = request.nextUrl.searchParams

    const clientId = q.get('clientId') ?? ''
    if (!UUID.test(clientId)) {
      return fail(400, 'Elige el cliente cuyas incidencias quieres ver')
    }

    const connectionId = q.get('connectionId')
    if (connectionId && !UUID.test(connectionId)) return fail(400, 'Esa cuenta no es válida')

    const jobId = q.get('jobId')
    if (jobId && !UUID.test(jobId)) return fail(400, 'Ese trabajo no es válido')

    const severidadesPedidas = (q.get('severidades') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is EventoSeveridad => SEVERIDADES.includes(s as EventoSeveridad))

    const limiteCrudo = Number(q.get('limite') ?? '200')
    const limite = Number.isFinite(limiteCrudo) ? Math.min(500, Math.max(1, limiteCrudo)) : 200

    const eventos = await cargarEventos({
      clientId,
      connectionId: connectionId ?? undefined,
      jobId: jobId ?? undefined,
      sku: q.get('sku') ?? undefined,
      severidades: severidadesPedidas.length > 0 ? severidadesPedidas : undefined,
      // Por defecto SOLO LO ABIERTO. Una cola que arrastra lo ya resuelto deja
      // de leerse, y entonces da igual lo bien que se registre.
      soloAbiertos: q.get('todos') !== '1',
      limite,
    })

    return NextResponse.json({
      eventos,
      etiquetas: EVENTO_SEVERIDAD_LABELS,
      leidoAt: new Date().toISOString(),
    })
  } catch (error) {
    if (isMissingSchema(error)) {
      return fail(
        503,
        'Faltan las tablas de la plataforma: lanza 123_plataforma_a1.sql en el editor SQL de Supabase'
      )
    }
    return errorResponse(error, 'Error leyendo los eventos de la plataforma')
  }
}
