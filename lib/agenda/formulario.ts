/**
 * LOS CAMPOS DE TEXTO DE LA FICHA DE UNA CITA, Y QUÉ SE MANDA AL GUARDAR.
 * ========================================================================
 * La ficha de la cita tenía veintitantos `useState` sueltos y la conversión a lo que espera la ruta (números con coma, vacíos a null) escrita dentro del manejador del
 * botón. Con el enlace al lead hace falta una tercera cosa —rellenar ESOS campos de golpe desde un lead— y esa no se puede escribir bien repartida en veintidós
 * setters. Todo junto, en un objeto y en funciones puras que se comprueban sin abrir un navegador.
 *
 * LO QUE SE MANDA ES LO MISMO QUE ANTES, letra por letra (las conversiones salen del manejador de AppointmentSheet): un campo vacío es null, la coma decimal de
 * «12,5» se convierte en punto, y los datos de la tienda se mandan SIEMPRE, también cuando la ficha los esconde porque vende en Amazon — esconder un campo no es borrarlo.
 */

import type { AppointmentStatus, AppointmentWithPeople, VendeEnAmazon } from '@/lib/types/appointments'
import type { DatosDeLaCita } from './cliente-lead'

export interface CamposDelFormulario {
  leadName: string
  leadEmail: string
  leadPhone: string
  leadCompany: string
  vendeEnAmazon: VendeEnAmazon
  status: AppointmentStatus
  notes: string
  revenueAmount: string
  callDate: string
  amazonLink: string
  razonSocial: string
  cif: string
  sector: string
  ciudad: string
  plataforma: string
  nProductos: string
  anosTienda: string
  web: string
}

/** Los campos de una cita que ya existe (o vacíos, si es nueva) */
export function camposDeUnaCita(a: AppointmentWithPeople | null): CamposDelFormulario {
  return {
    leadName: a?.lead_name ?? '',
    leadEmail: a?.lead_email ?? '',
    leadPhone: a?.lead_phone ?? '',
    leadCompany: a?.lead_company ?? '',
    vendeEnAmazon: a?.vende_en_amazon ?? 'sin_comprobar',
    status: a?.status ?? 'scheduled',
    notes: a?.notes ?? '',
    revenueAmount: a?.revenue_amount != null ? String(a.revenue_amount) : '',
    callDate: a?.call_date ?? '',
    amazonLink: a?.amazon_link ?? '',
    razonSocial: a?.razon_social ?? '',
    cif: a?.cif ?? '',
    sector: a?.sector ?? '',
    ciudad: a?.ciudad ?? '',
    plataforma: a?.plataforma ?? '',
    nProductos: a?.n_productos != null ? String(a.n_productos) : '',
    anosTienda: a?.anos_tienda != null ? String(a.anos_tienda) : '',
    web: a?.web ?? '',
  }
}

/** Lo que va al cuerpo del POST/PUT, además de las horas, el closer y el enlace (que decide quien guarda) */
export function cuerpoDeLosCampos(f: CamposDelFormulario) {
  return {
    lead_name: f.leadName.trim(),
    lead_email: f.leadEmail.trim() || null,
    lead_phone: f.leadPhone.trim() || null,
    lead_company: f.leadCompany.trim() || null,
    status: f.status,
    notes: f.notes.trim() || null,
    vende_en_amazon: f.vendeEnAmazon,
    revenue_amount: f.revenueAmount.trim() ? Number(f.revenueAmount.replace(',', '.')) : null,
    call_date: f.callDate || null,
    amazon_link: f.amazonLink.trim() || null,
    razon_social: f.razonSocial.trim() || null,
    cif: f.cif.trim() || null,
    sector: f.sector.trim() || null,
    ciudad: f.ciudad.trim() || null,
    plataforma: f.plataforma.trim() || null,
    n_productos: f.nProductos.trim() ? Number(f.nProductos) : null,
    anos_tienda: f.anosTienda.trim() ? Number(f.anosTienda.replace(',', '.')) : null,
    web: f.web.trim() || null,
  }
}

/** Cada dato del lead, a qué campo de la ficha va y cómo se llama en pantalla (para decir cuáles se han traído) */
const DESTINOS: ReadonlyArray<{ de: keyof DatosDeLaCita; a: keyof CamposDelFormulario; etiqueta: string }> = [
  { de: 'lead_name', a: 'leadName', etiqueta: 'Nombre' },
  { de: 'lead_company', a: 'leadCompany', etiqueta: 'Empresa' },
  { de: 'lead_email', a: 'leadEmail', etiqueta: 'Email' },
  { de: 'lead_phone', a: 'leadPhone', etiqueta: 'Teléfono' },
  { de: 'vende_en_amazon', a: 'vendeEnAmazon', etiqueta: '¿Vende en Amazon?' },
  { de: 'revenue_amount', a: 'revenueAmount', etiqueta: 'Facturación' },
  { de: 'amazon_link', a: 'amazonLink', etiqueta: 'Link Amazon' },
  { de: 'web', a: 'web', etiqueta: 'Web' },
  { de: 'plataforma', a: 'plataforma', etiqueta: 'Plataforma' },
  { de: 'n_productos', a: 'nProductos', etiqueta: 'Productos' },
  { de: 'anos_tienda', a: 'anosTienda', etiqueta: 'Antigüedad' },
  { de: 'sector', a: 'sector', etiqueta: 'Sector' },
  { de: 'ciudad', a: 'ciudad', etiqueta: 'Ciudad' },
  { de: 'razon_social', a: 'razonSocial', etiqueta: 'Razón social' },
  { de: 'cif', a: 'cif', etiqueta: 'CIF' },
]

export interface Traido {
  campos: CamposDelFormulario
  /** Las etiquetas de lo que ha cambiado de verdad: lo que ya valía lo mismo no cuenta */
  cambiados: string[]
}

/**
 * Pone en la ficha lo que sabe el lead. Lo que el lead no sabe no está en `datos` y no se toca; lo que sí sabe PISA lo que hubiera: quien elige un lead lo hace para
 * que la cita sea la de ESE lead. «Sin comprobar» no pisa una respuesta ya dada: es la ausencia de dato, no un dato.
 */
export function traerDatosDelLead(campos: CamposDelFormulario, datos: DatosDeLaCita): Traido {
  const nuevos: CamposDelFormulario = { ...campos }
  const cambiados: string[] = []
  for (const { de, a, etiqueta } of DESTINOS) {
    const valor = datos[de]
    if (valor === undefined) continue
    if (de === 'vende_en_amazon' && valor === 'sin_comprobar' && campos.vendeEnAmazon !== 'sin_comprobar') continue
    const texto = String(valor)
    if (nuevos[a] === texto) continue
    ;(nuevos as unknown as Record<string, string>)[a] = texto
    cambiados.push(etiqueta)
  }
  return { campos: nuevos, cambiados }
}
