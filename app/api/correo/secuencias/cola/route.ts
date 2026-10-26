import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail } from '@/lib/amazon/api'
import { SIN_CACHE, requerirCorreo } from '@/lib/correo/rutas'
import { almacenDeSecuencias } from '@/lib/correo/secuencias/almacen'
import { DIAS_MAXIMOS_DE_LA_DEMO, demostracion } from '@/lib/correo/secuencias/demo'
import { enteroDeUrl, respuestaDeFalloDeSecuencias } from '@/lib/correo/secuencias/rutas'
import { colaDeSecuencias, type GrupoDeCola } from '@/lib/correo/secuencias/servidor'
import { quienPide } from '@/lib/correo/servidor'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LA COLA: los leads que están en una secuencia, cada uno con su línea de tiempo.
 *
 * GET ?grupo=vivas|terminadas|todas  &buzonId=…  &q=texto (nombre del lead o dirección)  &pagina=0  &limite=40
 * Con &demo=1&dias=N la cola de la DEMOSTRACIÓN (solo administradores; lib/correo/secuencias/demo.ts).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const GRUPOS: readonly GrupoDeCola[] = ['vivas', 'terminadas', 'todas']

export async function GET(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion
  const p = request.nextUrl.searchParams
  const grupo = GRUPOS.find((g) => g === p.get('grupo')) ?? 'vivas'
  const buzon = p.get('buzonId')
  const filtro = {
    grupo,
    buzonId: buzon && UUID.test(buzon) ? buzon.toLowerCase() : null,
    q: (p.get('q') ?? '').slice(0, 80),
    pagina: enteroDeUrl(p.get('pagina'), 0, 0, 1000),
    limite: enteroDeUrl(p.get('limite'), 40, 1, 100),
  }
  if (p.get('demo') === '1') {
    if (sesion.role !== 'admin') return fail(403, 'La demostración es solo para administradores.')
    try {
      const d = await demostracion({ dias: enteroDeUrl(p.get('dias'), 0, 0, DIAS_MAXIMOS_DE_LA_DEMO) })
      return NextResponse.json({ ok: true, ...(await colaDeSecuencias(d.almacen, d.quien, filtro)) }, { headers: SIN_CACHE })
    } catch (error) {
      return respuestaDeFalloDeSecuencias('Correo · secuencias: cola de la demostración', error)
    }
  }
  try {
    const service = createServiceClient()
    const quien = await quienPide(service, sesion)
    const r = await colaDeSecuencias(almacenDeSecuencias(service), quien, filtro)
    return NextResponse.json({ ok: true, ...r }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloDeSecuencias('Correo · secuencias: cola', error)
  }
}
