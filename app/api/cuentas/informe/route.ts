import { NextResponse, type NextRequest } from 'next/server'
import { fail, UUID } from '@/lib/amazon/api'
import { requireAppDeCuentas } from '@/lib/cuentas/acceso'
import { clientesGrowth } from '@/lib/growth/clientes'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { createServiceClient } from '@/lib/supabase/service'
import { FALTA_307, guardarGestion, leerGestion, marcarPaso } from '@/lib/cuentas/datos'
import { semanaDelCiclo, ventanaDelInforme } from '@/lib/cuentas/ciclo'
import { tipoDeSemana, type LineaEjecutada, type TipoDeInforme } from '@/lib/cuentas/informe'
import { datosDelInforme } from '@/lib/cuentas/informe-datos'
import { lecturaConIa } from '@/lib/cuentas/informe-ia'
import { asuntoPorDefecto, borrarBorrador, crearInforme, enviarInforme, guardarBorrador, informePorId, informesDeCliente, urlDelInforme } from '@/lib/cuentas/informes'

/**
 * EL INFORME AL CLIENTE. Quien lleva cuentas (lib/cuentas/acceso.ts).
 *
 *   GET  ?cliente=slug                      → los informes del cliente (los últimos 12)
 *   GET  ?id=…                              → uno: cifras, lectura, lo añadido, a quién se manda, asunto y firma propuestos
 *   POST {cliente, accion:'crear', tipo?, hasta?}  → prepara el borrador (por defecto, el de la semana del ciclo; termina el domingo pasado)
 *   POST {id, accion:'guardar', lectura?, extra?}  → guarda lo editado (solo en borrador)
 *   POST {id, accion:'recalcular'}                 → vuelve a sacar las cifras (la lectura se conserva)
 *   POST {id, accion:'lectura-ia'}                 → vuelve a pedir la lectura a la IA
 *   POST {id, accion:'enviar', para, asunto, saludo, firma} → lo manda desde tu buzón con el enlace y marca el paso del ciclo
 *   DELETE ?id=…                            → borra un borrador
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 90

const TIPOS: readonly TipoDeInforme[] = ['semanal', 'quincenal', 'mensual']
const hoyIso = () => new Date().toISOString().slice(0, 10)

function errorDe(error: unknown, contexto: string): NextResponse {
  if (isMissingSchema(error)) return fail(409, FALTA_307)
  console.error(`Informe: ${contexto}:`, error)
  return fail(500, 'No se ha podido completar. Vuelve a intentarlo y avisa si sigue fallando.')
}

async function clienteDe(amazonClientId: string) {
  return (await clientesGrowth()).find((c) => c.amazonClientId === amazonClientId) ?? null
}

export async function GET(request: NextRequest) {
  try {
    const sesion = await requireAppDeCuentas('cuentas')
    if (sesion instanceof NextResponse) return sesion
    const q = request.nextUrl.searchParams
    const slug = q.get('cliente')
    if (slug) {
      const c = (await clientesGrowth()).find((x) => x.slug === slug && x.amazonClientId)
      if (!c) return fail(404, 'Ese cliente no existe.')
      return NextResponse.json({ informes: await informesDeCliente(c.amazonClientId as string) })
    }
    const id = q.get('id')
    if (!id || !UUID.test(id)) return fail(400, 'Falta el informe.')
    const inf = await informePorId(id)
    if (!inf) return fail(404, 'Ese informe no existe.')
    const [c, { porCliente }, { data: perfil }] = await Promise.all([
      clienteDe(inf.amazonClientId),
      leerGestion(),
      createServiceClient().from('profiles').select('full_name').eq('id', sesion.userId).maybeSingle(),
    ])
    const nombre = ((perfil as { full_name: string | null } | null)?.full_name ?? '').trim()
    return NextResponse.json({
      informe: inf,
      slug: c?.slug ?? null,
      url: urlDelInforme(inf.token),
      para: porCliente.get(inf.amazonClientId)?.correoInformes ?? '',
      asunto: asuntoPorDefecto({ ...inf, cliente: inf.datos.cliente }),
      firma: nombre ? `Un saludo,\n${nombre}\nLiberty Seller` : 'Un saludo,\nLiberty Seller',
    })
  } catch (error) {
    return errorDe(error, 'leer')
  }
}

export async function POST(request: NextRequest) {
  try {
    const sesion = await requireAppDeCuentas('cuentas')
    if (sesion instanceof NextResponse) return sesion
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>

    if (b.accion === 'crear') {
      const c = (await clientesGrowth()).find((x) => x.slug === b.cliente && x.amazonClientId)
      if (!c) return fail(404, 'Ese cliente no existe.')
      const { porCliente } = await leerGestion()
      const semana = semanaDelCiclo(porCliente.get(c.amazonClientId as string)?.cicloInicio, hoyIso())
      const tipo = TIPOS.includes(b.tipo as TipoDeInforme) ? (b.tipo as TipoDeInforme) : semana ? tipoDeSemana(semana.semana) : 'semanal'
      // Por defecto acaba el domingo pasado: es lo que Amazon ya ha cerrado y lo que cuenta la semana del ciclo
      const hasta = typeof b.hasta === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.hasta) ? b.hasta : semana ? ventanaDelInforme(semana).hasta : new Date(Date.now() - ((new Date().getUTCDay() || 7) * 86_400_000)).toISOString().slice(0, 10)
      const datos = await datosDelInforme({ amazonClientId: c.amazonClientId as string, nombre: c.nombre }, tipo, hasta)
      const lectura = await lecturaConIa(datos)
      const inf = await crearInforme({ amazonClientId: c.amazonClientId as string, datos, lectura: lectura.texto, lecturaIa: lectura.deIa, userId: sesion.userId })
      return NextResponse.json({ ok: true, id: inf.id })
    }

    const id = typeof b.id === 'string' && UUID.test(b.id) ? b.id : null
    if (!id) return fail(400, 'Falta el informe.')
    const inf = await informePorId(id)
    if (!inf) return fail(404, 'Ese informe no existe.')
    if (inf.estado === 'enviado' && b.accion !== 'enviar') return fail(409, 'Este informe ya se ha enviado: no se cambia. Prepara uno nuevo si hace falta.')

    if (b.accion === 'guardar') {
      await guardarBorrador(id, {
        lectura: typeof b.lectura === 'string' ? b.lectura : undefined,
        extra: Array.isArray(b.extra) ? (b.extra as LineaEjecutada[]) : undefined,
      })
      return NextResponse.json({ ok: true })
    }
    if (b.accion === 'recalcular') {
      const c = await clienteDe(inf.amazonClientId)
      if (!c) return fail(404, 'El cliente ya no existe.')
      await guardarBorrador(id, { datos: await datosDelInforme({ amazonClientId: inf.amazonClientId, nombre: c.nombre }, inf.tipo, inf.hasta) })
      return NextResponse.json({ ok: true })
    }
    if (b.accion === 'lectura-ia') {
      const l = await lecturaConIa(inf.datos)
      await guardarBorrador(id, { lectura: l.texto })
      return NextResponse.json({ ok: true, deIa: l.deIa })
    }
    if (b.accion === 'enviar') {
      if (inf.estado === 'enviado') return fail(409, 'Este informe ya se ha enviado.')
      const r = await enviarInforme(sesion, inf, { para: String(b.para ?? ''), asunto: String(b.asunto ?? ''), saludo: String(b.saludo ?? ''), firma: String(b.firma ?? '') })
      if (!r.ok) return fail(r.estado, r.error)
      // Lo que ya ha salido no se devuelve como error: recordar a quién se manda y marcar el paso del ciclo
      await guardarGestion(inf.amazonClientId, { correoInformes: r.para }, sesion.userId).catch((e) => console.error('[informe] sin guardar el destinatario', e))
      const { porCliente } = await leerGestion().catch(() => ({ porCliente: new Map() }))
      const semana = semanaDelCiclo(porCliente.get(inf.amazonClientId)?.cicloInicio, hoyIso())
      if (semana && tipoDeSemana(semana.semana) === inf.tipo) {
        await marcarPaso(inf.amazonClientId, semana.lunes, `informe-${inf.tipo}`, true, sesion.userId).catch((e) => console.error('[informe] sin marcar el paso', e))
      }
      return NextResponse.json({ ok: true, para: r.para })
    }
    return fail(400, 'Acción desconocida.')
  } catch (error) {
    return errorDe(error, 'guardar')
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const sesion = await requireAppDeCuentas('cuentas')
    if (sesion instanceof NextResponse) return sesion
    const id = request.nextUrl.searchParams.get('id')
    if (!id || !UUID.test(id)) return fail(400, 'Falta el informe.')
    await borrarBorrador(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorDe(error, 'borrar')
  }
}
