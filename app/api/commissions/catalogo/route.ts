import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL CATÁLOGO DE UN CLIENTE, ALIMENTADO CON SU INFORME DE LISTADOS.
 *
 * Se sube el «Informe de todos los listados» de su Seller Central y esto guarda,
 * por cada ASIN, su nombre y si es de marca propia. A partir de ahí los cálculos
 * mensuales solo necesitan el informe de impuestos.
 *
 *
 * ============ POR QUÉ HACE FALTA ESTO ============
 *
 * El informe de impuestos de Amazon —el que se sube para calcular la comisión—
 * trae ASIN, SKU e importes, pero NO trae ni título ni marca. Con ese fichero
 * solo es imposible saber qué venta es de marca propia y cuál de arbitraje, que
 * es justo lo que decide si la comisión es del 4 % o del 2 %.
 *
 *
 * ============ SE ACUMULA, NO SE REEMPLAZA ============
 *
 * Cada subida hace upsert: las referencias nuevas entran y las que ya estaban se
 * actualizan. Las que desaparecen del informe NO se borran, y es a propósito: un
 * producto retirado hoy pudo venderse el mes pasado, y si se borrara, el cálculo
 * de ese mes se quedaría sin saber de qué marca era. Un catálogo que olvida es
 * peor que uno con sobras.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

/** Los títulos enteros son de 250 caracteres y son 26.000: se recorta a lo que se lee */
const MAX_NOMBRE = 140

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const clientId = (formData.get('clientId') as string | null)?.trim()

    if (!file) return NextResponse.json({ error: 'Falta el fichero' }, { status: 400 })
    if (!clientId) return NextResponse.json({ error: 'Falta el cliente' }, { status: 400 })

    const service = createServiceClient()

    const { data: cliente, error: errorCliente } = await service
      .from('clients')
      .select('id, name, marca_propia')
      .eq('id', clientId)
      .single()
    if (errorCliente || !cliente) {
      return NextResponse.json({ error: 'Ese cliente no existe' }, { status: 404 })
    }

    const marca = ((cliente as { marca_propia: string | null }).marca_propia ?? '')
      .trim()
      .toUpperCase()

    /**
     * EL INFORME VIENE SEPARADO POR TABULADORES, NO POR COMAS.
     *
     * Y menos mal: los títulos de Amazon llevan comas a puñados («Botas de
     * mujer, negras, talla 39»). Con un separador de comas habría que respetar
     * comillas y escapes; con tabuladores basta con partir, porque un tabulador
     * dentro de un título no existe.
     */
    const texto = await file.text()
    const lineas = texto.split(/\r?\n/)
    if (lineas.length < 2) {
      return NextResponse.json({ error: 'El fichero está vacío' }, { status: 400 })
    }

    const cabecera = lineas[0].replace(/^﻿/, '').split('\t').map((c) => c.trim())
    const iAsin = cabecera.indexOf('asin1')
    const iSku = cabecera.indexOf('seller-sku')
    const iNombre = cabecera.indexOf('item-name')

    if (iAsin < 0 || iNombre < 0) {
      return NextResponse.json(
        {
          error:
            'Este fichero no parece el «Informe de todos los listados»: le faltan las columnas ' +
            'asin1 e item-name. Se baja en Seller Central, en Inventario · Informes de inventario.',
        },
        { status: 400 }
      )
    }

    // Un ASIN aparece en varias filas (una por talla o por listado). Se queda la
    // primera: el nombre y la marca son los mismos.
    const porAsin = new Map<string, { sku: string | null; nombre: string; propia: boolean }>()
    for (let i = 1; i < lineas.length; i += 1) {
      if (!lineas[i]) continue
      const c = lineas[i].split('\t')
      const asin = (c[iAsin] ?? '').trim()
      if (!asin || porAsin.has(asin)) continue
      const nombre = (c[iNombre] ?? '').trim()
      porAsin.set(asin, {
        sku: iSku >= 0 ? ((c[iSku] ?? '').trim() || null) : null,
        nombre: nombre.slice(0, MAX_NOMBRE),
        propia: marca !== '' && nombre.toUpperCase().includes(marca),
      })
    }

    if (porAsin.size === 0) {
      return NextResponse.json(
        { error: 'No se ha encontrado ningún ASIN en el fichero' },
        { status: 400 }
      )
    }

    const filas = [...porAsin].map(([asin, v]) => ({
      client_id: clientId,
      asin,
      sku: v.sku,
      item_name: v.nombre,
      es_marca_propia: v.propia,
      actualizado_at: new Date().toISOString(),
    }))

    // De 500 en 500: 26.000 filas de una sentada se pasan del tamaño que aguanta
    // la petición.
    for (let i = 0; i < filas.length; i += 500) {
      const { error } = await service
        .from('commission_catalog')
        .upsert(filas.slice(i, i + 500), { onConflict: 'client_id,asin' })
      if (error) {
        console.error('Error guardando el catálogo:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }

    const propias = filas.filter((f) => f.es_marca_propia).length

    const { count } = await service
      .from('commission_catalog')
      .select('asin', { count: 'exact', head: true })
      .eq('client_id', clientId)

    return NextResponse.json({
      ok: true,
      leidas: filas.length,
      marcaPropia: propias,
      terceros: filas.length - propias,
      totalCatalogo: count ?? filas.length,
      marca: marca || null,
    })
  } catch (error) {
    console.error('Error subiendo el catálogo:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error desconocido' },
      { status: 500 }
    )
  }
}

/** Cuántas referencias conoce el ERP de este cliente, para poder decirlo antes de calcular */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const clientId = request.nextUrl.searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'Falta el cliente' }, { status: 400 })

  const service = createServiceClient()
  const [total, propias, ultima] = await Promise.all([
    service
      .from('commission_catalog')
      .select('asin', { count: 'exact', head: true })
      .eq('client_id', clientId),
    service
      .from('commission_catalog')
      .select('asin', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('es_marca_propia', true),
    service
      .from('commission_catalog')
      .select('actualizado_at')
      .eq('client_id', clientId)
      .order('actualizado_at', { ascending: false })
      .limit(1),
  ])

  return NextResponse.json({
    ok: true,
    total: total.count ?? 0,
    marcaPropia: propias.count ?? 0,
    actualizado: (ultima.data?.[0] as { actualizado_at?: string } | undefined)?.actualizado_at ?? null,
  })
}
