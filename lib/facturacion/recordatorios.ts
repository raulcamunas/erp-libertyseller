/**
 * LOS RECORDATORIOS DE PAGO: CUÁLES SE HAN MANDADO Y EL AVISO DE LAS FACTURAS QUE LLEVAN DÍAS SIN PAGAR. SOLO SERVIDOR.
 *
 * Un recordatorio es un envío del registro de facturación con `detalle.recordatorio` (app/api/facturacion/enviar). El aviso va a la campana
 * de cada administrador UNA vez por factura (la clave lleva su id), cuando cumple `DIAS_LABORABLES_PARA_RECORDAR` días laborables sin pagar
 * y todavía no se le ha mandado ningún recordatorio. Nunca manda nada al cliente: eso se hace a mano, mirándolo, desde Cobros.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { festivosNacionales } from '@/lib/festivos/festivos'
import { zohoTodo } from '@/lib/zoho/books'
import { DIAS_LABORABLES_PARA_RECORDAR, diasLaborablesDeRetraso } from './logica'

/** Los recordatorios ya mandados, por factura de Zoho: el último y cuántos. Si el registro no se puede leer, como si no hubiera ninguno */
export async function recordatoriosDe(ids: readonly string[]): Promise<Map<string, { ultimo: string; cuantos: number }>> {
  const salida = new Map<string, { ultimo: string; cuantos: number }>()
  if (ids.length === 0) return salida
  const { data, error } = await createServiceClient()
    .from('facturacion_registro')
    .select('zoho_id, creado_en')
    .eq('tipo', 'envio')
    .eq('detalle->>recordatorio', 'true')
    .in('zoho_id', [...ids])
    .order('creado_en', { ascending: false })
  if (error) {
    console.error('No se han podido leer los recordatorios mandados:', error.message)
    return salida
  }
  for (const r of (data ?? []) as Array<{ zoho_id: string; creado_en: string }>) {
    const x = salida.get(r.zoho_id)
    if (x) x.cuantos += 1
    else salida.set(r.zoho_id, { ultimo: r.creado_en, cuantos: 1 })
  }
  return salida
}

const fechaCorta = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a.slice(2)}`
}

const dinero = (n: number, moneda: string) =>
  n.toLocaleString('es-ES', { style: 'currency', currency: moneda || 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })

type FacturaZohoCruda = { invoice_id: string; invoice_number: string; customer_name: string; due_date?: string; balance: number; currency_code: string; status: string }

/** El aviso de las facturas sin pagar a la campana de los administradores. Devuelve cuántas facturas se han avisado (las ya avisadas no cuentan) */
export async function avisarDeImpagadas(hoy: string): Promise<{ revisadas: number; avisadas: number; faltaMigracion: boolean }> {
  const [impagadas, parciales] = await Promise.all([
    zohoTodo<FacturaZohoCruda>('invoices', 'invoices', { status: 'unpaid' }),
    zohoTodo<FacturaZohoCruda>('invoices', 'invoices', { status: 'partially_paid' }),
  ])
  const vistas = new Set<string>()
  const facturas = [...impagadas, ...parciales].filter((f) => f.status !== 'draft' && !vistas.has(f.invoice_id) && Boolean(vistas.add(f.invoice_id)))
  const festivos = festivosNacionales()
  const atrasadas = facturas
    .map((f) => ({ f, dias: diasLaborablesDeRetraso(f.due_date ?? null, hoy, festivos) }))
    .filter((x) => x.dias >= DIAS_LABORABLES_PARA_RECORDAR)
  if (atrasadas.length === 0) return { revisadas: facturas.length, avisadas: 0, faltaMigracion: false }

  // A la que ya se le ha mandado un recordatorio no hace falta avisar: alguien se está ocupando
  const recordadas = await recordatoriosDe(atrasadas.map((x) => x.f.invoice_id))
  const porAvisar = atrasadas.filter((x) => !recordadas.has(x.f.invoice_id))
  if (porAvisar.length === 0) return { revisadas: facturas.length, avisadas: 0, faltaMigracion: false }

  const service = createServiceClient()
  const { data: admins, error: eAdmins } = await service.from('profiles').select('id').eq('role', 'admin')
  if (eAdmins) throw eAdmins
  const ids = ((admins ?? []) as Array<{ id: string }>).map((a) => a.id)
  if (ids.length === 0) return { revisadas: facturas.length, avisadas: 0, faltaMigracion: false }

  const filas = ids.flatMap((userId) =>
    porAvisar.map(({ f, dias }) => ({
      user_id: userId,
      type: 'factura_impagada',
      title: `Factura sin pagar · ${f.customer_name}`,
      message: `${f.invoice_number}: ${dinero(Number(f.balance), f.currency_code)} sin pagar desde el ${f.due_date ? fechaCorta(f.due_date) : '—'} (${dias} días laborables). Pulsa para mandarle un recordatorio.`,
      clave: `factura-impagada:${f.invoice_id}`,
      datos: { app: 'facturacion', facturaId: f.invoice_id, diasLaborables: dias },
    }))
  )
  const { error } = await service.from('notifications').upsert(filas, { onConflict: 'user_id,clave', ignoreDuplicates: true })
  if (error) {
    // 23514: el tipo aún no está en la restricción (falta la migración 301)
    if (['23514', '42703', 'PGRST204', '42P10'].includes(error.code ?? '')) return { revisadas: facturas.length, avisadas: 0, faltaMigracion: true }
    throw error
  }
  return { revisadas: facturas.length, avisadas: porAvisar.length, faltaMigracion: false }
}
