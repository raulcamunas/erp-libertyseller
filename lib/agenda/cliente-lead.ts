/**
 * DE UN LEAD DE COLD CALLING A LOS DATOS DE UNA CITA.
 * ====================================================
 * Un comercial llama a un lead, el lead acepta una sesión y la cita se agendaba retecleando todo: el nombre, la empresa, el teléfono, el correo, si vende en Amazon, su
 * web, el CIF, la facturación… datos que YA estaban en la ficha del lead. Ahora la cita busca al lead, lo enlaza (`lead_source = 'cold_calling'` y `lead_ref_id` = el id del
 * lead, las dos columnas que la tabla de citas llevaba desde la 071 sin que nadie las rellenara) y se trae de un golpe todo lo que el lead sabe.
 *
 * La cita y el lead usan los MISMOS nombres de campo para los datos de la tienda (migración 214: «mismos nombres también en la base… para que el dato pueda copiarse sin
 * traducir»), así que lo único que hay que decidir aquí es qué lead-campo va a qué cita-campo cuando los nombres no coinciden, y qué hacer con lo que falta.
 *
 * REGLA DE ORO: SOLO SE TRAE LO QUE EL LEAD SABE. Un campo vacío del lead no aparece en el resultado, así que traerlo nunca borra lo que el comercial ya había escrito
 * en la cita. El resultado es un parche, no una ficha entera.
 *
 * Es puro: no toca la base ni la red.
 */

import { nombreLegible, parsearDirectivos } from '@/lib/cold-calling/directivos'
import { esTiendaOnline, type ColdLead } from '@/lib/types/cold-leads'
import type { VendeEnAmazon } from '@/lib/types/appointments'

/** Lo que se pide del lead al elegirlo: todo lo que puede rellenar la cita, más lo que hace falta para reconocerlo en la lista */
export const CAMPOS_DE_LEAD_PARA_LA_CITA =
  'id, store_name, company, phone, email, decisor, directors, web, seller_url, ciudad, province, category, plataforma, ' +
  'n_productos, anos_tienda, cif, revenue_monthly, tipo_lead, vende_en_amazon, status, source_list, assigned_to, nivel, telefonos_extra, emails_extra'

export type LeadParaLaCita = Pick<
  ColdLead,
  | 'id'
  | 'store_name'
  | 'company'
  | 'phone'
  | 'email'
  | 'decisor'
  | 'directors'
  | 'web'
  | 'seller_url'
  | 'ciudad'
  | 'province'
  | 'category'
  | 'plataforma'
  | 'n_productos'
  | 'anos_tienda'
  | 'cif'
  | 'revenue_monthly'
  | 'tipo_lead'
  | 'vende_en_amazon'
  | 'status'
  | 'source_list'
  | 'assigned_to'
  | 'nivel'
  | 'telefonos_extra'
  | 'emails_extra'
>

/** Lo que el lead aporta a la cita. Cada clave es opcional: si el lead no lo sabe, no está */
export interface DatosDeLaCita {
  lead_name?: string
  lead_company?: string
  lead_email?: string
  lead_phone?: string
  vende_en_amazon?: VendeEnAmazon
  revenue_amount?: number
  amazon_link?: string
  web?: string
  plataforma?: string
  n_productos?: number
  anos_tienda?: number
  sector?: string
  ciudad?: string
  razon_social?: string
  cif?: string
}

const limpio = (v: string | null | undefined): string | undefined => {
  const t = (v ?? '').trim()
  return t ? t : undefined
}

const numero = (v: number | string | null | undefined): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** El primero de una lista pegada en un texto («600 11 22 33; 91 234 56 78», «a@x.es, b@x.es») */
const primero = (lista: string | null | undefined): string | undefined => limpio((lista ?? '').split(/[;,\n]/)[0])

/** «Narro Garcia SL», «Julián Rey y Cía CB»: la persona que figura como administradora a veces es otra empresa, y eso no es el nombre de nadie con quien hablar */
const FORMAS_SOCIETARIAS = new Set(['SL', 'SLU', 'SA', 'SAU', 'SLP', 'SLL', 'SLNE', 'SC', 'SCP', 'CB', 'SCOOP', 'AIE', 'UTE', 'SRL', 'LTD', 'LLC', 'GMBH', 'BV'])
export function pareceEmpresa(nombre: string): boolean {
  const palabras = nombre.trim().split(/\s+/)
  const ultima = (palabras[palabras.length - 1] ?? '').toUpperCase().replace(/[.,]/g, '')
  return palabras.length > 1 && FORMAS_SOCIETARIAS.has(ultima)
}

/**
 * La persona con quien se habla. En una tienda online es el decisor del BORME; en un vendedor de Amazon, el primer directivo. Si no hay nadie, o quien figura es otra
 * empresa, se pone el nombre de la tienda: el nombre de la cita es obligatorio y una tienda es mejor que un hueco.
 */
export function contactoDelLead(lead: Pick<LeadParaLaCita, 'tipo_lead' | 'decisor' | 'directors' | 'store_name' | 'company'>): string | undefined {
  const persona = esTiendaOnline(lead) ? limpio(lead.decisor) : parsearDirectivos(lead.directors)[0]?.nombre
  const legible = persona ? nombreLegible(persona) : undefined
  if (legible && !pareceEmpresa(legible)) return legible
  return limpio(lead.store_name) ?? limpio(lead.company)
}

export function datosDeLaCitaDesdeLead(lead: LeadParaLaCita): DatosDeLaCita {
  const datos: DatosDeLaCita = {}
  const poner = <K extends keyof DatosDeLaCita>(clave: K, valor: DatosDeLaCita[K] | undefined) => {
    if (valor !== undefined) datos[clave] = valor
  }

  poner('lead_name', contactoDelLead(lead))
  poner('lead_company', limpio(lead.store_name) ?? limpio(lead.company))
  poner('lead_email', limpio(lead.email) ?? primero(lead.emails_extra))
  poner('lead_phone', limpio(lead.phone) ?? primero(lead.telefonos_extra))
  // Un vendedor de Amazon vende en Amazon por definición; una tienda online trae la respuesta que se comprobó (o «sin comprobar»)
  poner('vende_en_amazon', esTiendaOnline(lead) ? lead.vende_en_amazon : 'vende')
  const facturacion = numero(lead.revenue_monthly)
  poner('revenue_amount', facturacion !== undefined && facturacion > 0 ? facturacion : undefined)
  poner('amazon_link', limpio(lead.seller_url))
  poner('web', limpio(lead.web))
  poner('plataforma', limpio(lead.plataforma))
  const productos = numero(lead.n_productos)
  poner('n_productos', productos !== undefined ? Math.round(productos) : undefined)
  poner('anos_tienda', numero(lead.anos_tienda))
  poner('sector', limpio(lead.category))
  // `province` en la lista nueva viene como «Europe» en las 1.000: no es una provincia y no se trae
  const provincia = limpio(lead.province)
  poner('ciudad', limpio(lead.ciudad) ?? (provincia && provincia.toLowerCase() !== 'europe' ? provincia : undefined))
  poner('razon_social', limpio(lead.company))
  poner('cif', limpio(lead.cif))
  return datos
}

/** El enlace tal como lo guarda y lo enseña la ficha de la cita */
export interface EnlaceDeLead {
  id: string
  /** Cómo se llama el lead en Cold Calling (su tienda) */
  nombre: string
  estado: ColdLead['status'] | null
  lista: string | null
  /** De quién es el lead (puede no ser de quien agenda: un administrador agenda por otro) */
  responsable: string | null
}

export function enlaceDesdeLead(lead: Pick<LeadParaLaCita, 'id' | 'store_name' | 'company' | 'status' | 'source_list' | 'assigned_to'>): EnlaceDeLead {
  return {
    id: lead.id,
    nombre: limpio(lead.store_name) ?? limpio(lead.company) ?? 'Lead sin nombre',
    estado: lead.status ?? null,
    lista: limpio(lead.source_list) ?? null,
    responsable: lead.assigned_to ?? null,
  }
}

export const ORIGEN_COLD_CALLING = 'cold_calling'

/** El id del lead al que está enlazada una cita, si lo está. Otros orígenes (web, LinkedIn…) no cuentan: su `lead_ref_id` apunta a otra tabla */
export function idDelLeadEnlazado(cita: { lead_source?: string | null; lead_ref_id?: string | null }): string | null {
  return cita.lead_source === ORIGEN_COLD_CALLING && cita.lead_ref_id ? cita.lead_ref_id : null
}

/**
 * Qué mandar al guardar para que el enlace quede como lo dejó quien editaba, sin pisar lo que no se tocó.
 *
 *   · Cita nueva con lead: lo marca. Sin lead: nada (la ruta pone «manual»).
 *   · Cita que ya estaba enlazada al mismo lead: nada, tal cual.
 *   · Enlazada a otro lead: el nuevo.
 *   · Se le quitó el lead: vuelve a «manual» y sin id.
 *   · Sin lead antes y sin lead ahora: NADA. Una cita que viene de la web o de LinkedIn conserva su origen aunque se edite aquí.
 */
export function camposDelEnlace(
  inicial: string | null,
  actual: string | null
): { lead_source?: string; lead_ref_id?: string | null } {
  if (actual === inicial) return {}
  if (actual) return { lead_source: ORIGEN_COLD_CALLING, lead_ref_id: actual }
  return { lead_source: 'manual', lead_ref_id: null }
}
