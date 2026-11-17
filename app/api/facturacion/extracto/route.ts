import { NextResponse, type NextRequest } from 'next/server'
import { exigirAdmin } from '@/lib/facturacion/acceso'
import { leerExtractoPayset } from '@/lib/facturacion/extracto'
import { bancos, crearCuentaPayset, cuentasQueFaltan, importarPayset, repasar, ultimoExtracto } from '@/lib/facturacion/extracto-servidor'
import { registrar } from '@/lib/facturacion/registro'
import { errorComoRespuesta } from '@/lib/zoho/books'

/**
 * EL EXTRACTO DE PAYSET Y EL REPASO DEL BANCO. Solo admin y socios. ESCRIBE EN ZOHO.
 *
 *   GET                                          las cuentas de banco de Zoho con su saldo, lo que tienen sin casar y cuándo se subió el último extracto
 *   POST {accion:'subir', csv, crear?}           importa el extracto (lo que no esté ya) y repasa. Si trae una cuenta de Payset que Zoho no tiene, devuelve
 *                                                `faltan` sin tocar nada; se repite con `crear: {cuenta: 'AED'}` para darla de alta
 *   POST {accion:'repasar'}                      solo el repaso: casa lo que ya está en Zoho sin casar (lo de Wio llega solo)
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const MONEDAS = new Set(['EUR', 'AED', 'USD', 'GBP'])

export async function GET() {
  const permiso = await exigirAdmin()
  if (!permiso.ok) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })
  try {
    const { cuentas } = await bancos()
    const conFecha = await Promise.all(cuentas.map(async (c) => ({ ...c, ultimoExtracto: c.esPayset ? await ultimoExtracto(c.id) : null })))
    return NextResponse.json({ cuentas: conFecha })
  } catch (error) {
    const { mensaje, estado } = errorComoRespuesta(error)
    return NextResponse.json({ error: mensaje }, { status: estado })
  }
}

export async function POST(request: NextRequest) {
  const permiso = await exigirAdmin()
  if (!permiso.ok) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })
  const c = (await request.json().catch(() => ({}))) as { accion?: string; csv?: string; crear?: Record<string, string> }

  try {
    let importadas: Awaited<ReturnType<typeof importarPayset>> = []
    if (c.accion === 'subir') {
      if (typeof c.csv !== 'string' || !c.csv.trim()) return NextResponse.json({ error: 'Falta el fichero.' }, { status: 400 })
      if (c.csv.length > 5_000_000) return NextResponse.json({ error: 'El fichero es demasiado grande.' }, { status: 400 })
      const leido = leerExtractoPayset(c.csv)
      if (!leido.ok) return NextResponse.json({ error: leido.error }, { status: 400 })

      let { cuentas } = await bancos()
      const faltan = cuentasQueFaltan(leido.filas, cuentas)
      const sinDecidir = faltan.filter((f) => !MONEDAS.has(c.crear?.[f.cuenta] ?? ''))
      if (sinDecidir.length > 0) return NextResponse.json({ faltan: sinDecidir })
      for (const f of faltan) await crearCuentaPayset(f.cuenta, c.crear![f.cuenta])
      if (faltan.length > 0) cuentas = (await bancos()).cuentas

      importadas = await importarPayset(leido.filas, cuentas)
    } else if (c.accion !== 'repasar') {
      return NextResponse.json({ error: 'Acción desconocida.' }, { status: 400 })
    }

    const { hechos, pendientes } = await repasar()
    for (const h of hechos.filter((x) => x.ok && (x.tipo === 'cobro' || x.tipo === 'gasto'))) {
      await registrar(permiso, { tipo: h.tipo === 'cobro' ? 'cobro' : 'gasto', importe: h.importe, moneda: h.moneda, cliente: h.tipo === 'cobro' ? h.texto.slice(0, 120) : null, detalle: { origen: 'extracto', cuenta: h.cuenta, fecha: h.fecha, tipo: h.porque, referencia: h.texto.slice(0, 120) } })
    }
    const { cuentas } = await bancos()
    return NextResponse.json({ importadas, hechos, pendientes, cuentas })
  } catch (error) {
    const { mensaje, estado } = errorComoRespuesta(error)
    return NextResponse.json({ error: mensaje }, { status: estado })
  }
}
