import { NextResponse, type NextRequest } from 'next/server'
import { fail, requireAppAccess } from '@/lib/amazon/api'
import { diagnosticoDeVinculos, repasarVinculos } from '@/lib/cold-calling/vinculos-servidor'
import { puedeVerEquipoComercial } from '@/lib/equipo-comercial/acceso'
import { leerCuerpoConTope } from '@/lib/subidas-limite'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * COMPROBAR Y REPASAR EL ENLACE ENTRE LAS LLAMADAS DE RINKEL Y LOS LEADS DE COLD CALLING.
 *
 * GET                          · el diagnóstico: cuántas llamadas están enlazadas con su lead, cuáles no y por qué, y
 *                                qué leads tienen un teléfono que no se reconoce (a esos no les llegará nunca una llamada)
 * POST { accion: 'repasar' }   · enlaza TODAS las llamadas guardadas que no tienen lead y devuelve el diagnóstico nuevo
 *
 * QUIÉN. El diagnóstico lo ve quien supervisa al equipo comercial (admin, partner o el permiso 'equipo-comercial'): lee
 * llamadas y leads de todos. Repasar lo hace solo un ADMINISTRADOR, porque toca llamadas de todo el equipo. Esto no es el
 * filtro de datos —la clave de servicio lo lee todo—: es la puerta, y por eso se comprueba aquí y no en la pantalla.
 *
 * El repaso enlaza las llamadas de los últimos días Y las cuenta en su lead; las más antiguas solo las enlaza, sin contarlas
 * (ver lib/cold-calling/vinculos-servidor.ts). Es idempotente: repetirlo no cambia nada.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const MAX_BYTES_CUERPO = 1024
const SIN_CACHE = { 'Cache-Control': 'no-store' }
const FALLO_GENERICO = 'No se ha podido completar la operación. Vuelve a intentarlo en un momento.'

function registrar(contexto: string, error: unknown) {
  const e = error as { message?: unknown; code?: unknown; cause?: { code?: unknown } } | null
  console.error(contexto, { mensaje: typeof e?.message === 'string' ? e.message : 'sin mensaje', codigo: e?.code ?? e?.cause?.code ?? null })
}

export async function GET() {
  const sesion = await requireAppAccess('cold-calling')
  if (sesion instanceof NextResponse) return sesion
  if (!(await puedeVerEquipoComercial(sesion.role, sesion.userId))) return fail(403, 'Solo quien supervisa al equipo comercial puede ver esto.')

  try {
    const respuesta = await diagnosticoDeVinculos(createServiceClient())
    return NextResponse.json(respuesta, { headers: SIN_CACHE })
  } catch (error) {
    registrar('Cold Calling · diagnóstico de vínculos: fallo', error)
    return fail(500, FALLO_GENERICO)
  }
}

export async function POST(request: NextRequest) {
  const sesion = await requireAppAccess('cold-calling')
  if (sesion instanceof NextResponse) return sesion
  if (sesion.role !== 'admin') return fail(403, 'Solo un administrador puede repasar los vínculos.')

  const cuerpo = await leerCuerpoConTope(request, MAX_BYTES_CUERPO)
  if (cuerpo instanceof NextResponse) return cuerpo
  let json: { accion?: unknown }
  try {
    json = JSON.parse(cuerpo.texto) as typeof json
  } catch {
    return fail(400, 'No se ha entendido lo que se ha mandado')
  }
  if (json?.accion !== 'repasar') return fail(400, 'No se ha entendido lo que se ha mandado')

  try {
    const service = createServiceClient()
    const resultado = await repasarVinculos(service, { dias: null })
    console.info('Cold Calling · un administrador ha repasado los vínculos', { administrador: sesion.userId, enlazadas: resultado.enlazadas, contadas: resultado.contadas, historicas: resultado.historicas })
    const respuesta = await diagnosticoDeVinculos(service)
    return NextResponse.json({ resultado, ...respuesta }, { headers: SIN_CACHE })
  } catch (error) {
    registrar('Cold Calling · repaso de vínculos: fallo', error)
    return fail(500, FALLO_GENERICO)
  }
}
