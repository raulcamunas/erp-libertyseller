import { createServiceClient } from '@/lib/supabase/service'
import {
  normalizarNombre,
  type Emisor,
  type EstadoFacturacion,
  type FilaFacturacion,
} from './tipos'

/**
 * LO QUE HAY QUE FACTURAR ESTE MES, DE UNA SOLA VEZ.
 *
 * Junta tres sitios que hasta ahora había que mirar por separado y en este
 * orden: Tesorería (cuánto se le cobra a cada cliente este mes), las facturas
 * ya emitidas (para no emitir dos veces) y los desgloses de comisiones (el
 * enlace que se le manda al cliente para que vea de dónde sale su comisión).
 */

/** El emisor, con valores vacíos si todavía no se ha rellenado la ficha */
export const EMISOR_VACIO: Emisor = {
  legal_name: '',
  tax_id: '',
  address: '',
  email: '',
  phone: null,
  bank_name: null,
  iban: null,
  bic: null,
  invoice_prefix: 'LS',
  footer_note: null,
}

export async function cargarEmisor(): Promise<Emisor> {
  const service = createServiceClient()
  const { data, error } = await service.from('billing_issuer').select('*').limit(1).maybeSingle()
  // Sin la migración 176 la tabla no existe. La pantalla tiene que abrirse
  // igual y decir qué falta, no reventar.
  if (error || !data) return EMISOR_VACIO
  return { ...EMISOR_VACIO, ...(data as Partial<Emisor>) }
}

/** La dirección pública del ERP, para construir el enlace del desglose */
export function baseDelSitio(): string {
  const url =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
  return url.replace(/\/+$/, '')
}

export function urlDelDesglose(slug: string): string {
  return `${baseDelSitio()}/report/commissions/${slug}`
}

function decidirEstado(args: {
  fee: number | null
  comision: number | null
  cobrado: boolean
  facturaEstado: string | null
  emailEnviadoEl: string | null
}): EstadoFacturacion {
  if (args.cobrado) return 'cobrada'
  if (args.emailEnviadoEl) return 'enviada'
  if (args.facturaEstado) return 'emitida'
  // «Sin importes» es 0 o nada: un cliente que este mes no factura no tiene que
  // aparecer como pendiente de nada, o la lista de pendientes deja de servir.
  const total = (args.fee ?? 0) + (args.comision ?? 0)
  if (total <= 0) return 'sin_importes'
  return 'por_emitir'
}

export async function cargarTablero(period: string): Promise<{
  filas: FilaFacturacion[]
  emisor: Emisor
  faltaMigracion: boolean
}> {
  const service = createServiceClient()

  // Las cuatro consultas son independientes: ninguna necesita el resultado de
  // otra para lanzarse, así que van juntas.
  const [clientesRes, mesesRes, facturasRes, reportesRes, emisor] = await Promise.all([
    service
      .from('treasury_clients')
      .select('id, name, email, email_alt, tax_address, tax_id, vat_rate, fee_concept, is_active, position')
      .eq('is_active', true)
      .order('position', { ascending: true, nullsFirst: false }),
    service.from('treasury_client_months').select('*').eq('period', period),
    service
      .from('invoices')
      .select('id, invoice_number, total, status, email_sent_at, treasury_client_id, period, report_url')
      .eq('period', period),
    service
      .from('commission_reports')
      .select('slug, period, created_at, clients:clients(name)')
      .order('created_at', { ascending: false })
      .limit(200),
    cargarEmisor(),
  ])

  // Si falta la 176, `tax_id`/`vat_rate` no existen y la consulta de clientes
  // falla entera. Se reintenta sin esas columnas para que la pantalla abra y
  // pueda decir qué hay que lanzar.
  let clientes = clientesRes.data as Record<string, unknown>[] | null
  const faltaMigracion = Boolean(clientesRes.error) || Boolean(facturasRes.error)
  if (!clientes) {
    const { data } = await service
      .from('treasury_clients')
      .select('id, name, email, email_alt, tax_address, is_active, position')
      .eq('is_active', true)
      .order('position', { ascending: true, nullsFirst: false })
    clientes = (data as Record<string, unknown>[] | null) ?? []
  }

  const meses = new Map<string, Record<string, unknown>>()
  for (const m of (mesesRes.data ?? []) as Record<string, unknown>[]) {
    meses.set(String(m.client_id), m)
  }

  const facturas = new Map<string, Record<string, unknown>>()
  for (const f of (facturasRes.data ?? []) as Record<string, unknown>[]) {
    if (f.treasury_client_id) facturas.set(String(f.treasury_client_id), f)
  }

  /**
   * EL DESGLOSE SE BUSCA POR NOMBRE, PORQUE NO HAY OTRA COSA POR LA QUE BUSCARLO.
   *
   * Tesorería y la calculadora de comisiones son dos listas de clientes
   * distintas y sin enlace entre ellas. Se cruza por el nombre normalizado, y
   * de los que coinciden se coge el más reciente, que es el del mes que se
   * está facturando.
   */
  const desglosePorNombre = new Map<string, { slug: string; periodo: string | null }>()
  for (const r of (reportesRes.data ?? []) as Record<string, unknown>[]) {
    const nombre = (r.clients as { name?: string } | null)?.name
    if (!nombre || !r.slug) continue
    const clave = normalizarNombre(nombre)
    // El primero que llega es el más reciente: la consulta viene ordenada.
    if (!desglosePorNombre.has(clave)) {
      desglosePorNombre.set(clave, { slug: String(r.slug), periodo: (r.period as string) ?? null })
    }
  }

  const filas: FilaFacturacion[] = (clientes ?? []).map((c) => {
    const id = String(c.id)
    const mes = meses.get(id)
    const factura = facturas.get(id)
    const desglose = desglosePorNombre.get(normalizarNombre(String(c.name ?? '')))

    const fee = mes?.fee != null ? Number(mes.fee) : null
    const comision = mes?.commission != null ? Number(mes.commission) : null
    const cobrado = Boolean(mes?.paid)

    return {
      treasuryClientId: id,
      nombre: String(c.name ?? ''),
      email: (c.email as string) ?? null,
      emailAlt: (c.email_alt as string) ?? null,
      taxId: (c.tax_id as string) ?? null,
      taxAddress: (c.tax_address as string) ?? null,
      vatRate: c.vat_rate != null ? Number(c.vat_rate) : 0.21,
      feeConcept: (c.fee_concept as string) ?? null,
      fee,
      comision,
      cobrado,
      marcadoEnviadoAMano: Boolean(mes?.invoice_sent) && !factura,
      estado: decidirEstado({
        fee,
        comision,
        cobrado,
        facturaEstado: factura ? String(factura.status) : null,
        emailEnviadoEl: (factura?.email_sent_at as string) ?? null,
      }),
      factura: factura
        ? {
            id: String(factura.id),
            numero: String(factura.invoice_number),
            total: Number(factura.total ?? 0),
            estado: String(factura.status),
            emailEnviadoEl: (factura.email_sent_at as string) ?? null,
            reportUrl: (factura.report_url as string) ?? null,
          }
        : null,
      desglose: desglose
        ? { slug: desglose.slug, periodo: desglose.periodo, url: urlDelDesglose(desglose.slug) }
        : null,
    }
  })

  return { filas, emisor, faltaMigracion }
}
