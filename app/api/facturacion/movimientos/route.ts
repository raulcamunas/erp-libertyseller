import { NextResponse, type NextRequest } from 'next/server'
import { exigirAdmin } from '@/lib/facturacion/acceso'
import { registrar } from '@/lib/facturacion/registro'
import { errorComoRespuesta, tipoDeCambio, zoho } from '@/lib/zoho/books'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * REGISTRAR UN GASTO EN ZOHO.
 *
 * O desde una línea de extracto ya subida (`movimientoId`), que queda
 * categorizada, o a mano. Zoho limita la descripción y la referencia, así que se
 * recortan antes: mejor un concepto corto que un rechazo por longitud.
 */

const FECHA = /^\d{4}-\d{2}-\d{2}$/

export async function POST(request: NextRequest) {
  const permiso = await exigirAdmin()
  if (!permiso.ok) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })

  const c = (await request.json().catch(() => ({}))) as {
    cuentaGastoId?: string
    cuentaGastoNombre?: string
    cuentaPagoId?: string
    importe?: number
    fecha?: string
    referencia?: string
    concepto?: string
    movimientoId?: string | null
  }

  const importe = Math.round(Number(c.importe) * 100) / 100
  if (!c.cuentaGastoId) return NextResponse.json({ error: 'Falta elegir de qué es el gasto' }, { status: 400 })
  if (!c.cuentaPagoId) return NextResponse.json({ error: 'Falta la cuenta desde la que se ha pagado' }, { status: 400 })
  if (!(importe > 0)) return NextResponse.json({ error: 'El importe tiene que ser mayor que cero' }, { status: 400 })
  if (!c.fecha || !FECHA.test(c.fecha)) return NextResponse.json({ error: 'Falta la fecha' }, { status: 400 })

  try {
    const [{ bankaccount: banco }, { currencies }] = await Promise.all([
      zoho<{ bankaccount: { currency_id: string; currency_code: string; account_name: string } }>(`bankaccounts/${encodeURIComponent(c.cuentaPagoId)}`),
      zoho<{ currencies?: { currency_code: string; is_base_currency?: boolean }[] }>('settings/currencies'),
    ])
    const base = currencies?.find((m) => m.is_base_currency)?.currency_code
    const cuerpo = {
      account_id: c.cuentaGastoId,
      paid_through_account_id: c.cuentaPagoId,
      date: c.fecha,
      amount: importe,
      reference_number: c.referencia?.trim().slice(0, 100) || undefined,
      description: c.concepto?.trim().slice(0, 100) || undefined,
      currency_id: banco.currency_id,
      ...(banco.currency_code !== base ? { exchange_rate: await tipoDeCambio(banco.currency_id, c.fecha) } : {}),
    }

    const r = c.movimientoId
      ? await zoho<{ expense?: { expense_id?: string } }>(`banktransactions/uncategorized/${encodeURIComponent(c.movimientoId)}/categorize/expenses`, { metodo: 'POST', cuerpo })
      : await zoho<{ expense?: { expense_id?: string } }>('expenses', { metodo: 'POST', cuerpo })

    await registrar(permiso, {
      tipo: 'gasto',
      zohoId: r.expense?.expense_id ?? null,
      numero: c.referencia?.trim() || null,
      cliente: c.concepto?.trim() || null,
      importe,
      moneda: banco.currency_code,
      detalle: { fecha: c.fecha, cuenta: banco.account_name, tipo: c.cuentaGastoNombre ?? null, movimientoId: c.movimientoId ?? null },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const { mensaje, estado } = errorComoRespuesta(error)
    return NextResponse.json({ error: mensaje }, { status: estado })
  }
}
