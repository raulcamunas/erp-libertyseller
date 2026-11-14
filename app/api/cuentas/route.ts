import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { requireAppDeCuentas } from '@/lib/cuentas/acceso'
import { clientesGrowth } from '@/lib/growth/clientes'
import { FALTA_307, guardarGestion, leerGestion, leerHechos, marcarPaso, personasQueLlevanCuentas } from '@/lib/cuentas/datos'
import { lunesDe, pasosDeSemana, semanaDelCiclo, type SemanaDelCiclo } from '@/lib/cuentas/ciclo'
import { cifrasDeCumplimiento, ppcDeCliente, seoDeCliente, tareasDeCumplimiento } from '@/lib/cuentas/resumen'
import { isMissingSchema } from '@/lib/plataforma/eventos'

/**
 * CUENTAS DE CLIENTES. Administradores y quien lleve cuentas con la casilla (lib/cuentas/acceso.ts).
 *
 *   GET                  → todos los clientes con cuenta de Amazon: responsable, semana del ciclo con lo hecho, cifras de PPC y de cumplimiento
 *   GET ?cliente=slug    → uno, con además las tareas de SEO y de cumplimiento
 *   POST {cliente, accion: 'responsable', responsableId}     → quién lleva el cliente (null = nadie)
 *   POST {cliente, accion: 'ciclo', inicio: 'AAAA-MM-DD'}    → el lunes en que empezó su S1 (null = sin ciclo)
 *   POST {cliente, accion: 'paso', paso, hecho}              → marca o desmarca un paso de la semana de hoy
 *   POST {cliente, accion: 'notas', notas}
 *
 * Solo lee lo que el ERP ya tiene guardado: no llama a Amazon.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const hoyIso = () => new Date().toISOString().slice(0, 10)

async function enTandas<T, R>(xs: readonly T[], tam: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const salida: R[] = []
  for (let i = 0; i < xs.length; i += tam) salida.push(...(await Promise.all(xs.slice(i, i + tam).map(f))))
  return salida
}

export async function GET(request: NextRequest) {
  try {
    const sesion = await requireAppDeCuentas('cuentas')
    if (sesion instanceof NextResponse) return sesion
    const slug = request.nextUrl.searchParams.get('cliente')
    const hoy = hoyIso()

    const [todos, { porCliente, falta307 }, personas] = await Promise.all([clientesGrowth(), leerGestion(), personasQueLlevanCuentas()])
    const clientes = todos.filter((c) => c.amazonClientId && c.activo && (!slug || c.slug === slug))
    if (slug && clientes.length === 0) return fail(404, 'Ese cliente no existe o no tiene una cuenta de Amazon conectada.')

    const semanas = new Map<string, SemanaDelCiclo | null>(clientes.map((c) => [c.amazonClientId as string, semanaDelCiclo(porCliente.get(c.amazonClientId as string)?.cicloInicio, hoy)]))
    const hechos = falta307
      ? new Map<string, Set<string>>()
      : await leerHechos(clientes.flatMap((c) => {
          const s = semanas.get(c.amazonClientId as string)
          return s ? [{ amazonClientId: c.amazonClientId as string, lunes: s.lunes }] : []
        }))
    const nombreDe = new Map(personas.map((p) => [p.id, p.nombre]))

    const filas = await enTandas(clientes, 3, async (c) => {
      const id = c.amazonClientId as string
      const g = porCliente.get(id)
      const semana = semanas.get(id) ?? null
      const [ppc, cumplimiento, detalle] = await Promise.all([
        ppcDeCliente(id),
        cifrasDeCumplimiento(id),
        slug ? Promise.all([seoDeCliente(id), tareasDeCumplimiento(id)]) : Promise.resolve(null),
      ])
      return {
        slug: c.slug,
        nombre: c.nombre,
        responsable: g?.responsableId ? { id: g.responsableId, nombre: nombreDe.get(g.responsableId) ?? 'Sin nombre' } : null,
        cicloInicio: g?.cicloInicio ?? null,
        notas: g?.notas ?? null,
        semana,
        pasos: semana ? pasosDeSemana(semana.semana) : [],
        hechos: [...(hechos.get(id) ?? [])],
        ppc,
        cumplimiento,
        ...(detalle ? { seo: detalle[0], tareasCumplimiento: detalle[1] } : {}),
      }
    })

    return NextResponse.json({ hoy, yo: sesion.userId, falta307, aviso307: falta307 ? FALTA_307 : null, personas, clientes: filas })
  } catch (error) {
    console.error('Cuentas: leer:', error)
    return fail(500, 'No se han podido leer las cuentas. Vuelve a intentarlo y avisa si sigue fallando.')
  }
}

export async function POST(request: NextRequest) {
  try {
    const sesion = await requireAppDeCuentas('cuentas')
    if (sesion instanceof NextResponse) return sesion
    const body = (await request.json().catch(() => ({}))) as { cliente?: unknown; accion?: unknown; responsableId?: unknown; inicio?: unknown; paso?: unknown; hecho?: unknown; notas?: unknown }
    const cliente = (await clientesGrowth()).find((c) => c.slug === body.cliente && c.amazonClientId)
    if (!cliente) return fail(404, 'Ese cliente no existe o no tiene una cuenta de Amazon conectada.')
    const id = cliente.amazonClientId as string

    if (body.accion === 'responsable') {
      const r = body.responsableId
      if (r !== null && typeof r !== 'string') return fail(400, 'Falta el responsable.')
      if (r && !(await personasQueLlevanCuentas()).some((p) => p.id === r)) return fail(400, 'Esa persona no tiene acceso a «Cuentas de clientes». Dale la casilla en Gestión de Usuarios.')
      await guardarGestion(id, { responsableId: r ?? null }, sesion.userId)
      return NextResponse.json({ ok: true })
    }
    if (body.accion === 'ciclo') {
      const i = body.inicio
      if (i !== null && (typeof i !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(i))) return fail(400, 'La fecha no es válida.')
      await guardarGestion(id, { cicloInicio: i ? lunesDe(i) : null }, sesion.userId)
      return NextResponse.json({ ok: true })
    }
    if (body.accion === 'paso') {
      const { porCliente } = await leerGestion()
      const semana = semanaDelCiclo(porCliente.get(id)?.cicloInicio, hoyIso())
      if (!semana) return fail(400, 'Este cliente todavía no tiene ciclo: elige primero en qué semana empezó.')
      if (typeof body.paso !== 'string' || !pasosDeSemana(semana.semana).some((p) => p.id === body.paso)) return fail(400, 'Ese paso no es de esta semana.')
      await marcarPaso(id, semana.lunes, body.paso, body.hecho !== false, sesion.userId)
      return NextResponse.json({ ok: true })
    }
    if (body.accion === 'notas') {
      if (body.notas !== null && typeof body.notas !== 'string') return fail(400, 'Las notas no son válidas.')
      await guardarGestion(id, { notas: typeof body.notas === 'string' ? body.notas.slice(0, 4000) : null }, sesion.userId)
      return NextResponse.json({ ok: true })
    }
    return fail(400, 'Acción desconocida.')
  } catch (error) {
    if (isMissingSchema(error)) return fail(409, FALTA_307)
    console.error('Cuentas: guardar:', error)
    return fail(500, 'No se ha podido guardar. Vuelve a intentarlo y avisa si sigue fallando.')
  }
}
