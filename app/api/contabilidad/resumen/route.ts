import { NextResponse } from 'next/server'
import { exigirAdmin } from '@/lib/facturacion/acceso'
import { bancos, ultimoExtracto } from '@/lib/facturacion/extracto-servidor'
import { errorComoRespuesta, zohoTodo } from '@/lib/zoho/books'

/**
 * CONTABILIDAD · EL RESUMEN DE UN VISTAZO. Solo admin y socios. SOLO LEE ZOHO.
 *
 * Saldo de cada banco y lo que tiene sin casar, lo que falta por cobrar (y lo vencido), lo cobrado y lo gastado este mes. El coste del equipo no sale de
 * aquí: lo pide la pantalla a /api/employees/monthly-cost, que ya separa lo que ve un socio de lo que ve un administrador.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

interface Factura {
  invoice_id: string
  invoice_number: string
  customer_name: string
  currency_code: string
  balance: number
  due_date?: string
}

export async function GET() {
  const permiso = await exigirAdmin()
  if (!permiso.ok) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })
  try {
    const hoy = new Date().toISOString().slice(0, 10)
    const mes = `${hoy.slice(0, 7)}-01`
    const [{ cuentas }, impagadas, parciales, cobros, gastos] = await Promise.all([
      bancos(),
      zohoTodo<Factura>('invoices', 'invoices', { status: 'unpaid' }),
      zohoTodo<Factura>('invoices', 'invoices', { status: 'partially_paid' }),
      zohoTodo<{ amount: number; currency_code?: string; date: string }>('customerpayments', 'customerpayments', { date_start: mes }),
      zohoTodo<{ total: number; bcy_total?: number; account_name: string; date: string }>('expenses', 'expenses', { date_start: mes }),
    ])
    const conFecha = await Promise.all(cuentas.map(async (c) => ({ ...c, ultimoExtracto: c.esPayset ? await ultimoExtracto(c.id) : null })))

    const vistas = new Set<string>()
    const pendientes = [...impagadas, ...parciales].filter((f) => !vistas.has(f.invoice_id) && Boolean(vistas.add(f.invoice_id)))
    const porMoneda = <T,>(filas: T[], moneda: (x: T) => string, importe: (x: T) => number) => {
      const m: Record<string, number> = {}
      for (const f of filas) m[moneda(f)] = Math.round(((m[moneda(f)] ?? 0) + importe(f)) * 100) / 100
      return m
    }
    const vencidas = pendientes.filter((f) => f.due_date && f.due_date < hoy)
    const gastoPorCuenta: Record<string, number> = {}
    for (const g of gastos) gastoPorCuenta[g.account_name] = Math.round(((gastoPorCuenta[g.account_name] ?? 0) + Number(g.bcy_total ?? g.total)) * 100) / 100

    return NextResponse.json({
      hoy,
      cuentas: conFecha,
      porCobrar: { facturas: pendientes.length, total: porMoneda(pendientes, (f) => f.currency_code, (f) => Number(f.balance)) },
      vencidas: {
        facturas: vencidas.length,
        total: porMoneda(vencidas, (f) => f.currency_code, (f) => Number(f.balance)),
        lista: vencidas
          .map((f) => ({ numero: f.invoice_number, cliente: f.customer_name, saldo: Number(f.balance), moneda: f.currency_code, dias: Math.round((Date.parse(hoy) - Date.parse(f.due_date!)) / 86_400_000) }))
          .sort((a, b) => b.dias - a.dias)
          .slice(0, 8),
      },
      cobradoMes: { cobros: cobros.length, total: porMoneda(cobros, (c) => c.currency_code ?? 'EUR', (c) => Number(c.amount)) },
      // En la moneda de la empresa (AED): cada gasto lleva su `bcy_total`
      gastadoMes: {
        total: Math.round(Object.values(gastoPorCuenta).reduce((a, b) => a + b, 0) * 100) / 100,
        porCuenta: Object.entries(gastoPorCuenta).map(([cuenta, total]) => ({ cuenta, total })).sort((a, b) => b.total - a.total),
      },
    })
  } catch (error) {
    const { mensaje, estado } = errorComoRespuesta(error)
    return NextResponse.json({ error: mensaje }, { status: estado })
  }
}
