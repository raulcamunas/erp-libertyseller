import { createServiceClient } from '@/lib/supabase/service'
import { errorComoRespuesta, zohoConfigurado, zohoTodo } from '@/lib/zoho/books'
import {
  avisosDeFila,
  claveDeContacto,
  emparejarContacto,
  estadoDesdeZoho,
  estadoParaElReflejo,
  etiquetaDeNumero,
  mesDelPeriodo,
  numeroPropuesto,
  periodoDeFactura,
} from './logica'
import type { ContactoZoho, FacturaZoho, FilaFacturacion, InformeDeComision, Tablero } from './tipos'

export interface ContactoCrudo {
  contact_id: string
  contact_name?: string
  company_name?: string
  email?: string
}

export interface FacturaCruda {
  invoice_id: string
  invoice_number: string
  customer_id: string
  customer_name: string
  date: string
  due_date?: string
  total: number
  balance: number
  currency_code: string
  status: string
}

export function facturaDesdeZoho(f: FacturaCruda): FacturaZoho {
  return {
    id: f.invoice_id,
    numero: f.invoice_number,
    fecha: f.date,
    vence: f.due_date || null,
    total: Number(f.total ?? 0),
    saldo: Number(f.balance ?? 0),
    moneda: f.currency_code,
    estadoZoho: f.status,
  }
}

type FilaCliente = { id: string; name: string; email?: string | null; email_alt?: string | null; zoho_contact_id?: string | null }

function sumarMeses(period: string, salto: number): string {
  const [a, m] = period.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1 + salto, 1))
  return d.toISOString().slice(0, 10)
}

/** La dirección pública del ERP, para el enlace del informe que ve el cliente */
export function baseDelSitio(): string {
  const url = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://app.libertyseller.com'
  return url.replace(/\/+$/, '')
}

/**
 * EL MES ENTERO: TESORERÍA + ZOHO + LOS INFORMES DE COMISIÓN.
 *
 * Zoho se lee en directo y no se copia: la factura puede cambiar allí, y una
 * copia que no se entera enseñaría una factura que ya no existe. Lo único que se
 * escribe aquí es el reflejo que necesitan Comisiones y Tesorería.
 */
export async function cargarTablero(period: string): Promise<Tablero> {
  const service = createServiceClient()

  let contactos: ContactoCrudo[] = []
  let facturas: FacturaCruda[] = []
  let errorZoho: string | null = null

  if (!zohoConfigurado()) {
    errorZoho = 'Faltan las claves de Zoho en el servidor (ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN y ZOHO_ORGANIZATION_ID).'
  } else {
    try {
      // Dos meses atrás por la etiqueta del número; dos adelante porque una factura se puede emitir más tarde del mes que cobra
      ;[contactos, facturas] = await Promise.all([
        zohoTodo<ContactoCrudo>('contacts', 'contacts', { contact_type: 'customer' }),
        zohoTodo<FacturaCruda>('invoices', 'invoices', {
          date_start: sumarMeses(period, -2),
          date_end: sumarMeses(period, 3),
          sort_column: 'date',
          sort_order: 'D',
        }),
      ])
    } catch (e) {
      errorZoho = errorComoRespuesta(e).mensaje
    }
  }
  const zohoOk = errorZoho === null

  const [conPareja, mesesRes, informesRes] = await Promise.all([
    service
      .from('treasury_clients')
      .select('id, name, email, email_alt, position, zoho_contact_id')
      .eq('is_active', true)
      .order('position', { ascending: true, nullsFirst: false }),
    service.from('treasury_client_months').select('client_id, fee, commission, paid, invoice_sent').eq('period', period),
    service
      .from('commission_reports')
      .select('slug, clients:clients(name, treasury_client_id)')
      .eq('period', mesDelPeriodo(period))
      .not('slug', 'is', null),
  ])

  let clientes = conPareja.data as FilaCliente[] | null
  const faltaMigracion = Boolean(conPareja.error)
  if (!clientes) {
    const { data } = await service
      .from('treasury_clients')
      .select('id, name, email, email_alt, position')
      .eq('is_active', true)
      .order('position', { ascending: true, nullsFirst: false })
    clientes = (data as FilaCliente[] | null) ?? []
  }

  const meses = new Map(
    ((mesesRes.data ?? []) as { client_id: string; fee: number | null; commission: number | null; paid: boolean; invoice_sent: boolean }[]).map(
      (m) => [m.client_id, m]
    )
  )

  const informes = (informesRes.data ?? []) as unknown as {
    slug: string
    clients: { name?: string; treasury_client_id?: string | null } | null
  }[]
  const informesDe = (id: string, nombre: string): InformeDeComision[] =>
    informes
      .filter(
        (r) =>
          r.clients?.treasury_client_id === id ||
          (!r.clients?.treasury_client_id && claveDeContacto(r.clients?.name ?? '') === claveDeContacto(nombre))
      )
      .map((r) => ({ nombre: r.clients?.name ?? r.slug, url: `${baseDelSitio()}/report/commissions/${r.slug}` }))

  const delMes = facturas.filter((f) => f.status !== 'void' && periodoDeFactura(f.invoice_number, f.date) === period)

  const contactoPorId = new Map(contactos.map((c) => [c.contact_id, c]))
  const yaGuardados = new Set(clientes.map((c) => c.zoho_contact_id).filter(Boolean))
  const libres = contactos.filter((c) => !yaGuardados.has(c.contact_id))
  const usados = new Set<string>()

  const montarFila = (args: {
    treasuryClientId: string | null
    nombre: string
    contacto: ContactoCrudo | null
    parejaDeducida: boolean
    correosTesoreria: string[]
  }): FilaFacturacion => {
    const { contacto } = args
    const mes = args.treasuryClientId ? meses.get(args.treasuryClientId) : undefined
    const fee = mes?.fee != null ? Number(mes.fee) : null
    const comision = mes?.commission != null ? Number(mes.commission) : null
    const totalTesoreria = Math.round(((fee ?? 0) + (comision ?? 0)) * 100) / 100
    const cobradoEnTesoreria = Boolean(mes?.paid)

    const suyas = contacto ? delMes.filter((f) => f.customer_id === contacto.contact_id) : []
    const crudo = suyas[0] ?? null
    const factura = crudo ? facturaDesdeZoho(crudo) : null
    const estado = factura ? estadoDesdeZoho(factura.estadoZoho) : totalTesoreria > 0 ? 'por_crear' : 'sin_importes'

    const etiqueta =
      facturas
        .filter((f) => contacto && f.customer_id === contacto.contact_id)
        .map((f) => etiquetaDeNumero(f.invoice_number))
        .find(Boolean) || args.nombre
    const informesDeFila = args.treasuryClientId ? informesDe(args.treasuryClientId, args.nombre) : []
    const contactoTieneCorreo = Boolean(contacto?.email)

    return {
      treasuryClientId: args.treasuryClientId,
      nombre: args.nombre,
      contactoId: contacto?.contact_id ?? null,
      contactoNombre: contacto?.contact_name ?? null,
      contactoTieneCorreo,
      correosTesoreria: args.correosTesoreria,
      parejaDeducida: args.parejaDeducida,
      fee,
      comision,
      totalTesoreria,
      cobradoEnTesoreria,
      estado,
      factura,
      otrasFacturas: Math.max(0, suyas.length - 1),
      numeroPropuesto: numeroPropuesto(etiqueta, period),
      informes: informesDeFila,
      avisos: zohoOk
        ? avisosDeFila({
            totalTesoreria,
            cobradoEnTesoreria,
            estadoZoho: factura?.estadoZoho ?? null,
            totalZoho: factura?.total ?? null,
            moneda: factura?.moneda ?? null,
            comision,
            hayInformes: informesDeFila.length > 0,
            contactoTieneCorreo: contactoTieneCorreo || args.correosTesoreria.length > 0,
            hayContacto: Boolean(contacto) && estado !== 'sin_importes',
          })
        : [],
    }
  }

  const filas: FilaFacturacion[] = clientes.map((c) => {
    const guardado = c.zoho_contact_id ? (contactoPorId.get(c.zoho_contact_id) ?? null) : null
    const deducido = guardado ? null : emparejarContacto(c.name, libres.filter((l) => !usados.has(l.contact_id)))
    const contacto = guardado ?? deducido
    if (contacto) usados.add(contacto.contact_id)
    return montarFila({
      treasuryClientId: c.id,
      nombre: c.name,
      contacto,
      parejaDeducida: Boolean(deducido),
      correosTesoreria: [c.email, c.email_alt].map((x) => x?.trim() ?? '').filter(Boolean),
    })
  })

  // Facturas de este mes de contactos que no están en Tesorería: existen, y se pueden enviar y cobrar igual
  for (const f of delMes) {
    if (usados.has(f.customer_id)) continue
    usados.add(f.customer_id)
    filas.push(
      montarFila({
        treasuryClientId: null,
        nombre: f.customer_name,
        contacto: contactoPorId.get(f.customer_id) ?? { contact_id: f.customer_id, contact_name: f.customer_name },
        parejaDeducida: false,
        correosTesoreria: [],
      })
    )
  }

  if (zohoOk && !faltaMigracion) await actualizarReflejo(period, filas, delMes, meses)

  const contactosLista: ContactoZoho[] = contactos
    .map((c) => ({ id: c.contact_id, nombre: c.contact_name ?? c.company_name ?? c.contact_id }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

  return {
    filas,
    contactos: contactosLista,
    zohoOk,
    errorZoho,
    faltaMigracion,
  }
}

/**
 * LO QUE ZOHO DICE, PASADO A LO QUE MIRAN LOS DEMÁS MÓDULOS.
 *
 * `invoices` es lo que frena a Comisiones para no tocar un mes facturado, y la
 * casilla de Tesorería es lo que se mira a diario. Solo se escribe lo que ha
 * cambiado, y en Tesorería solo hacia delante: si allí dice «cobrado» y en Zoho
 * no, eso es un aviso para una persona, no algo que se borre solo.
 *
 * Un fallo aquí no tumba la pantalla: el tablero sale igual de lo leído en directo.
 */
async function actualizarReflejo(
  period: string,
  filas: FilaFacturacion[],
  delMes: FacturaCruda[],
  meses: Map<string, { paid: boolean; invoice_sent: boolean }>
): Promise<void> {
  try {
    const service = createServiceClient()
    const { data: previos } = await service
      .from('invoices')
      .select('id, zoho_invoice_id, status, total, invoice_number')
      .eq('period', period)
      .not('zoho_invoice_id', 'is', null)
    const porZoho = new Map(((previos ?? []) as { id: string; zoho_invoice_id: string; status: string; total: number; invoice_number: string }[]).map((p) => [p.zoho_invoice_id, p]))

    for (const fila of filas) {
      const f = fila.factura
      if (!f || !fila.treasuryClientId) continue
      const status = estadoParaElReflejo(f.estadoZoho)
      const previo = porZoho.get(f.id)
      if (!previo || previo.status !== status || Number(previo.total) !== f.total || previo.invoice_number !== f.numero) {
        const { error } = await service.from('invoices').upsert(
          {
            zoho_invoice_id: f.id,
            treasury_client_id: fila.treasuryClientId,
            client_name: fila.nombre,
            invoice_number: f.numero,
            issue_date: f.fecha,
            due_date: f.vence ?? f.fecha,
            status,
            period,
            subtotal: f.total,
            vat_rate: 0,
            vat_amount: 0,
            total: f.total,
            currency: f.moneda,
          },
          { onConflict: 'zoho_invoice_id' }
        )
        if (error) console.error(`Reflejo de ${f.numero}:`, error.message)
      }

      const mes = meses.get(fila.treasuryClientId)
      if (mes) {
        const cambios: { invoice_sent?: boolean; paid?: boolean } = {}
        if (f.estadoZoho !== 'draft' && !mes.invoice_sent) cambios.invoice_sent = true
        if (f.estadoZoho === 'paid' && !mes.paid) cambios.paid = true
        if (Object.keys(cambios).length > 0) {
          await service.from('treasury_client_months').update(cambios).eq('client_id', fila.treasuryClientId).eq('period', period)
        }
      }
    }

    // Lo que se ha borrado o anulado en Zoho deja de frenar a Comisiones
    const vivas = new Set(delMes.map((f) => f.invoice_id))
    const muertas = [...porZoho.values()].filter((p) => !vivas.has(p.zoho_invoice_id)).map((p) => p.id)
    if (muertas.length > 0) await service.from('invoices').delete().in('id', muertas)
  } catch (e) {
    console.error('No se ha podido actualizar el reflejo de Zoho:', e)
  }
}
