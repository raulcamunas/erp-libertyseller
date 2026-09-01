import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, fail, requireAppAccess, UUID } from '@/lib/amazon/api'
import { createServiceClient } from '@/lib/supabase/service'
import { cuentasDeTrabajo } from '@/lib/ads/datos'
import { empujar, encargar } from '@/lib/ads/generador'
import { PLANTILLAS, PLANTILLAS_POR_ID } from '@/lib/ads/plantillas'
import { PERIODOS, rangoDe, type PeriodoInforme } from '@/lib/ads/programador'

/**
 * INFORMES DE MARKETING · ENCARGAR Y CONSULTAR
 *
 *   leer      las cuentas, el catálogo de plantillas y los encargos que hay
 *   encargar  apunta uno nuevo. NO espera a que esté: no puede
 *   empujar    da un paso a los que están a medias, para el botón de «actualizar»
 *   borrar    quita un encargo
 *
 * El Excel se descarga por otra ruta (`/api/marketing/informes/excel`) porque es
 * una respuesta binaria y mezclarla aquí obligaría a que todo lo demás fuera
 * también un `Response` a pelo.
 *
 *
 * ============ ENCARGAR NO ESPERA, Y NO ES UNA LIMITACIÓN ============
 *
 * Los informes de la v3 de Ads tardan de diez segundos a varios minutos CADA
 * UNO, y una selección normal son diez o quince. No hay petición HTTP que
 * aguante eso, así que el encargo se apunta y un proceso lo empuja. Es lo que
 * permite además cerrar la pestaña y volver mañana.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

/** Tope de días por encargo. Ver la nota del cuerpo */
const MAX_DIAS = 400

export async function POST(request: NextRequest) {
  try {
    // Los informes solo LEEN, así que se reparten con el permiso de la app y no
    // con el rol: quien lleva las campañas no es el admin.
    const session = await requireAppAccess('marketing-ads')
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      accion?: string
      perfilId?: string
      desde?: string
      hasta?: string
      plantillas?: unknown
      informeId?: string
      fecha?: string
      periodo?: string
      programacionId?: string
    }
    const service = createServiceClient()

    /* ---------------- Encargar ---------------- */
    if (body.accion === 'encargar') {
      const perfilId = (body.perfilId ?? '').trim()
      if (!UUID.test(perfilId)) return fail(400, 'Elige una cuenta de anunciante.')

      const desde = (body.desde ?? '').trim()
      const hasta = (body.hasta ?? '').trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
        return fail(400, 'Las fechas tienen que venir como AAAA-MM-DD.')
      }
      if (hasta < desde) return fail(400, 'La fecha de fin es anterior a la de inicio.')

      const dias = Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000) + 1
      if (dias > MAX_DIAS) {
        return fail(
          400,
          `El rango son ${dias} días y el tope está en ${MAX_DIAS}. No es una manía del ERP: ` +
            'Amazon guarda los datos de publicidad algo más de un año y los informes muy largos ' +
            'fallan por tiempo en su lado. Pide varios trozos.'
        )
      }

      const ids = Array.isArray(body.plantillas) ? (body.plantillas as unknown[]).map(String) : []
      const buenas = ids.filter((id) => {
        const p = PLANTILLAS_POR_ID.get(id)
        return p !== undefined && !p.imposible
      })
      if (buenas.length === 0) {
        return fail(400, 'No has elegido ninguna plantilla que se pueda pedir.')
      }

      const informeId = await encargar({
        perfilId,
        desde,
        hasta,
        plantillas: buenas,
        usuario: session.userId,
      })

      // Un primer empujón AQUÍ mismo: así se piden ya las primeras y quien acaba
      // de pulsar ve movimiento en vez de una fila quieta esperando al cron.
      const paso = await empujar(4)
      return NextResponse.json({ ok: true, informeId, paso })
    }

    /* ---------------- Programar un día del calendario ---------------- */
    if (body.accion === 'programar') {
      const perfilId = (body.perfilId ?? '').trim()
      if (!UUID.test(perfilId)) return fail(400, 'Elige una cuenta de anunciante.')

      const fecha = (body.fecha ?? '').trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return fail(400, 'La fecha tiene que venir como AAAA-MM-DD.')
      }

      const periodo = (body.periodo ?? '') as PeriodoInforme
      if (!PERIODOS.some((p) => p.id === periodo)) {
        return fail(400, 'El periodo tiene que ser 1, 2 o 4 semanas.')
      }

      const ids = Array.isArray(body.plantillas) ? (body.plantillas as unknown[]).map(String) : []
      const buenas = ids.filter((id) => {
        const t = PLANTILLAS_POR_ID.get(id)
        return t !== undefined && !t.imposible
      })

      /**
       * SE GUARDA LA FECHA Y EL PERIODO, NO EL RANGO YA CALCULADO.
       *
       * El rango se resuelve el día que se lanza. Guardarlo aquí congelaría un
       * cálculo hecho con semanas de antelación, y bastaría con corregir un día
       * el calendario para que el informe saliera de un periodo que ya no es el
       * que dice la ficha.
       */
      const { error } = await service.from('marketing_programaciones').upsert(
        {
          perfil_id: perfilId,
          fecha,
          periodo,
          plantillas: buenas,
          estado: 'pendiente',
          error: null,
          informe_id: null,
          creado_por: session.userId,
        },
        { onConflict: 'perfil_id,fecha,periodo' }
      )
      if (error) return fail(400, error.message)
      return NextResponse.json({ ok: true, rango: rangoDe(fecha, periodo) })
    }

    /* ---------------- Quitar una programación ---------------- */
    if (body.accion === 'desprogramar') {
      const id = (body.programacionId ?? '').trim()
      if (!UUID.test(id)) return fail(400, 'Falta la programación.')
      const { error } = await service.from('marketing_programaciones').delete().eq('id', id)
      if (error) return fail(400, error.message)
      return NextResponse.json({ ok: true })
    }

    /* ---------------- Empujar ---------------- */
    if (body.accion === 'empujar') {
      const paso = await empujar(6)
      return NextResponse.json({ ok: true, paso })
    }

    /* ---------------- Borrar ---------------- */
    if (body.accion === 'borrar') {
      const id = (body.informeId ?? '').trim()
      if (!UUID.test(id)) return fail(400, 'Falta el encargo.')
      // Las partes se van solas: la clave foránea es ON DELETE CASCADE.
      const { error } = await service.from('marketing_informes').delete().eq('id', id)
      if (error) return fail(400, error.message)
      return NextResponse.json({ ok: true })
    }

    /* ---------------- Leer ---------------- */
    const cuentas = await cuentasDeTrabajo()

    const { data: informes, error } = await service
      .from('marketing_informes')
      .select('*')
      .order('pedido_at', { ascending: false })
      .limit(50)
    if (error) return fail(400, error.message)

    const ids = (informes ?? []).map((i) => (i as { id: string }).id)
    const { data: partes } = ids.length
      ? await service
          .from('marketing_informe_partes')
          .select('id, informe_id, plantilla, hoja, estado, error, report_id, filas, intentos')
          .in('informe_id', ids)
      : { data: [] }

    /**
     * Las programaciones del calendario. Se traen las de los últimos tres meses
     * y todas las futuras: el calendario se mueve por meses y con eso hay de
     * sobra sin pedirlas otra vez a cada flecha.
     */
    const desdeCalendario = new Date(Date.now() - 92 * 86_400_000).toISOString().slice(0, 10)
    const { data: programaciones } = await service
      .from('marketing_programaciones')
      .select('id, perfil_id, fecha, periodo, estado, informe_id, error, lanzado_at')
      .gte('fecha', desdeCalendario)
      .order('fecha', { ascending: true })

    return NextResponse.json({
      ok: true,
      cuentas,
      programaciones: programaciones ?? [],
      periodos: PERIODOS,
      // El catálogo viaja entero, incluidas las que no se pueden pedir: la
      // pantalla las enseña apagadas con el motivo. Filtrarlas aquí haría que la
      // pregunta «¿y la de geografía?» volviera cada dos meses.
      plantillas: PLANTILLAS,
      informes: informes ?? [],
      partes: partes ?? [],
    })
  } catch (error) {
    return errorResponse(error, 'Error con los informes de marketing')
  }
}
