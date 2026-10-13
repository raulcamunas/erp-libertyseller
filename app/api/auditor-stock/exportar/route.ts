import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { cuentaAuditada, MERCADO_AUDITADO } from '@/lib/auditor-stock/auditar'
import { ZONA } from '@/lib/auditor-stock/horas'
import type { FilaDetalle } from '@/lib/auditor-stock/clasificar'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * AUDITOR DE STOCK · EL HISTORIAL EN UN CSV.
 *
 * Una fila por SKU y UNA COLUMNA POR AUDITORÍA (cada diez minutos): la cantidad
 * que Amazon tenía en ese momento. Es la forma de ver de un vistazo qué productos
 * se ponen a 0 y vuelven, y a qué hora.
 *
 * Solo salen las auditorías COMPLETAS: en una parcial faltan listings y su «0»
 * no querría decir nada. Un SKU que no figura en el detalle de una auditoría
 * completa es un SKU sin stock en ese momento: se escribe 0.
 *
 * Solo lee lo que el auditor ya guardó; no llama a Amazon.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const MAX_HORAS = 72
const POR_TANDA = 12

const hora = new Intl.DateTimeFormat('es-ES', {
  timeZone: ZONA,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

const celda = (v: string | number | null) => {
  const t = v === null ? '' : String(v)
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const pedidas = Number(request.nextUrl.searchParams.get('horas'))
    const horas = Number.isFinite(pedidas) && pedidas > 0 ? Math.min(Math.floor(pedidas), MAX_HORAS) : 24

    const cuenta = await cuentaAuditada()
    if ('error' in cuenta) return fail(404, cuenta.error)

    const service = createServiceClient()
    const desde = new Date(Date.now() - horas * 3_600_000).toISOString()

    // Primero solo los ids y las horas: el detalle pesa y se pide por tandas.
    const { data: lista, error } = await service
      .from('stock_auditorias')
      .select('id, creada_at')
      .eq('connection_id', cuenta.connectionId)
      .eq('marketplace_id', MERCADO_AUDITADO)
      .eq('estado', 'completa')
      .gte('creada_at', desde)
      .order('creada_at', { ascending: true })
      .limit(1000)
    if (error) return fail(500, `No se han podido leer las auditorías: ${error.message}`)

    const auditorias = (lista ?? []) as Array<{ id: string; creada_at: string }>
    if (auditorias.length === 0) return fail(404, 'No hay auditorías completas en ese periodo.')

    const filas = new Map<string, { asin: string | null; canal: string; v: number[] }>()
    const n = auditorias.length

    for (let i = 0; i < n; i += POR_TANDA) {
      const ids = auditorias.slice(i, i + POR_TANDA).map((a) => a.id)
      const { data, error: e2 } = await service
        .from('stock_auditorias')
        .select('id, detalle')
        .eq('connection_id', cuenta.connectionId)
        .in('id', ids)
      if (e2) return fail(500, `No se ha podido leer el detalle: ${e2.message}`)
      const porId = new Map(
        ((data ?? []) as Array<{ id: string; detalle: FilaDetalle[] | null }>).map((d) => [d.id, d.detalle ?? []])
      )
      ids.forEach((id, k) => {
        const col = i + k
        for (const [sku, asin, cantidad, canal] of porId.get(id) ?? []) {
          let f = filas.get(sku)
          if (!f) {
            f = { asin, canal: canal === 'A' ? 'FBA' : 'FBM', v: new Array<number>(n).fill(0) }
            filas.set(sku, f)
          }
          f.v[col] = cantidad
        }
      })
    }

    const cabecera = [
      'SKU',
      'ASIN',
      'Canal',
      'Pasadas con stock',
      'Veces que baja a 0',
      ...auditorias.map((a) => `Stock en Amazon ${hora.format(new Date(a.creada_at))}`),
    ]
    const lineas = [cabecera.join(';')]
    for (const [sku, f] of [...filas.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      let conStock = 0
      let bajadas = 0
      f.v.forEach((q, k) => {
        if (q > 0) conStock += 1
        if (k > 0 && f.v[k - 1] > 0 && q === 0) bajadas += 1
      })
      lineas.push([sku, f.asin, f.canal, conStock, bajadas, ...f.v].map(celda).join(';'))
    }

    const nombre = `auditor-stock-amazon-${horas}h-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`
    return new NextResponse('﻿' + lineas.join('\r\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${nombre}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return errorResponse(error, 'Error al exportar el historial del auditor')
  }
}
