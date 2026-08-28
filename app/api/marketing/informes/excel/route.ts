import { NextResponse, type NextRequest } from 'next/server'
import * as XLSX from 'xlsx'
import { requireAppAccess, UUID } from '@/lib/amazon/api'
import { createServiceClient } from '@/lib/supabase/service'
import { filasDe } from '@/lib/ads/generador'

/**
 * EL EXCEL DE UN ENCARGO, CON UNA PESTAÑA POR INFORME.
 *
 * Se arma AQUÍ, al descargarlo, y no cuando el encargo queda listo. Tres motivos
 * y los tres cuentan:
 *
 *   · No hay que guardar el fichero en ningún sitio. Un Excel de quince
 *     pestañas con cien mil filas son decenas de megas por encargo, y esa base
 *     ya se pasó de cuota una vez guardando cosas que nadie leía.
 *
 *   · Los datos salen FRESCOS. Amazon corrige la atribución hacia atrás durante
 *     días: un informe pedido el lunes tiene mejores números el jueves. Armar el
 *     Excel al descargarlo aprovecha esas correcciones; congelarlo al terminar
 *     habría guardado la versión peor.
 *
 *   · La URL de descarga de Amazon caduca a los pocos minutos, pero el informe
 *     no: preguntando por su identificador se obtiene una URL nueva cada vez. Lo
 *     que se guarda es el identificador, y con eso basta.
 *
 * A cambio, esta ruta tarda: son quince descargas y quince gunzips. Por eso
 * `maxDuration` está al máximo y por eso la pantalla avisa antes de pulsar.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Tope de filas por pestaña.
 *
 * Excel no admite más de 1.048.576, así que pasarse no da un fichero grande: da
 * un fichero ROTO. Se corta antes y se dice en la pestaña de portada — un Excel
 * al que le faltan filas sin avisar es peor que uno que no se puede abrir,
 * porque el segundo se nota.
 */
const MAX_FILAS = 1_000_000

export async function GET(request: NextRequest) {
  // Los informes solo LEEN, así que se reparten con el permiso de la app y no
    // con el rol: quien lleva las campañas no es el admin.
    const session = await requireAppAccess('marketing-ads')
  if (session instanceof NextResponse) return session

  const id = (request.nextUrl.searchParams.get('id') ?? '').trim()
  if (!UUID.test(id)) {
    return NextResponse.json({ ok: false, error: 'Falta el encargo.' }, { status: 400 })
  }

  const service = createServiceClient()

  const { data: informe, error } = await service
    .from('marketing_informes')
    .select('id, perfil_id, desde, hasta, estado, plantillas')
    .eq('id', id)
    .single()
  if (error || !informe) {
    return NextResponse.json({ ok: false, error: 'Ese encargo ya no existe.' }, { status: 404 })
  }

  const inf = informe as unknown as {
    id: string
    perfil_id: string
    desde: string
    hasta: string
    estado: string
  }

  const { data: perfil } = await service
    .from('ads_profiles')
    .select('nombre, pais, moneda')
    .eq('id', inf.perfil_id)
    .single()
  const p = (perfil ?? {}) as { nombre?: string; pais?: string; moneda?: string }

  const { data: partes } = await service
    .from('marketing_informe_partes')
    .select('plantilla, hoja, estado, error, report_id')
    .eq('informe_id', id)
    .order('hoja')

  const libro = XLSX.utils.book_new()
  const portada: Record<string, unknown>[] = []
  let conDatos = 0

  for (const parte of (partes ?? []) as unknown as {
    plantilla: string
    hoja: string
    estado: string
    error: string | null
    report_id: string | null
  }[]) {
    if (parte.estado !== 'listo' || !parte.report_id) {
      portada.push({
        Pestaña: parte.hoja,
        Estado: parte.estado === 'sin_datos' ? 'Sin datos en ese rango' : 'NO DISPONIBLE',
        Filas: 0,
        Detalle: parte.error ?? '',
      })
      continue
    }

    try {
      const filas = await filasDe(inf.perfil_id, parte.report_id)
      const cortadas = filas.length > MAX_FILAS ? filas.slice(0, MAX_FILAS) : filas

      // Una pestaña vacía con solo la cabecera se lee mejor que una pestaña que
      // no está: dice «se pidió y no había nada», que es información.
      XLSX.utils.book_append_sheet(
        libro,
        XLSX.utils.json_to_sheet(cortadas.length > 0 ? cortadas : [{ '(sin datos)': '' }]),
        parte.hoja.slice(0, 31)
      )
      conDatos += 1
      portada.push({
        Pestaña: parte.hoja,
        Estado: filas.length > MAX_FILAS ? `CORTADO en ${MAX_FILAS}` : 'OK',
        Filas: filas.length,
        // En una parte que salió bien, `error` no es un error: es la nota de qué
        // columnas podó Amazon. Va aquí porque una pestaña a la que le faltan dos
        // columnas y no lo dice se lee como completa.
        Detalle:
          filas.length > MAX_FILAS
            ? 'Excel no admite más filas por hoja'
            : (parte.error ?? ''),
      })
    } catch (e) {
      portada.push({
        Pestaña: parte.hoja,
        Estado: 'ERROR AL DESCARGAR',
        Filas: 0,
        Detalle: e instanceof Error ? e.message.slice(0, 300) : 'Error desconocido',
      })
    }
  }

  if (conDatos === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Ninguna de las peticiones de este encargo ha traído datos. Mira el detalle de cada una ' +
          'en la pantalla.',
      },
      { status: 409 }
    )
  }

  /**
   * LA PORTADA VA LA PRIMERA Y NO ES ADORNO.
   *
   * Dice qué pestañas hay, cuántas filas trae cada una y cuáles han fallado.
   * Sin ella, un Excel al que le falta la pestaña de términos de búsqueda parece
   * un Excel completo — y quien lo abra dentro de un mes no tiene forma de saber
   * si es que no había datos o es que algo falló.
   */
  XLSX.utils.book_append_sheet(
    libro,
    XLSX.utils.json_to_sheet([
      { Pestaña: 'CUENTA', Estado: p.nombre ?? '', Filas: '', Detalle: p.pais ?? '' },
      { Pestaña: 'PERIODO', Estado: `${inf.desde} a ${inf.hasta}`, Filas: '', Detalle: '' },
      { Pestaña: 'MONEDA', Estado: p.moneda ?? '', Filas: '', Detalle: '' },
      { Pestaña: '', Estado: '', Filas: '', Detalle: '' },
      ...portada,
    ]),
    'Portada'
  )
  // La portada se añade al final y se mueve al principio: `book_append_sheet` no
  // sabe insertar, y el orden de `SheetNames` es el orden de las pestañas.
  libro.SheetNames = ['Portada', ...libro.SheetNames.filter((n) => n !== 'Portada')]

  const bytes = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  // Cuántas veces se ha bajado. Leer y sumar en vez de un incremento atómico
  // porque aquí no hay concurrencia que temer —lo pulsa una persona— y una
  // función en la base para sumar uno sería más máquina que problema.
  const { data: antes } = await service
    .from('marketing_informes')
    .select('descargado_veces')
    .eq('id', id)
    .single()
  await service
    .from('marketing_informes')
    .update({
      descargado_veces: Number((antes as { descargado_veces?: number })?.descargado_veces ?? 0) + 1,
    })
    .eq('id', id)

  const nombre = `${(p.nombre ?? 'cuenta').replace(/[^\w-]+/g, '_')}_${inf.desde}_${inf.hasta}.xlsx`

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'Cache-Control': 'no-store',
    },
  })
}
