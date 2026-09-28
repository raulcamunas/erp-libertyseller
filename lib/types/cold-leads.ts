import { CalendarPerson } from './appointments'

export type ColdLeadStatus =
  | 'pendiente'
  | 'no_contesta'
  | 'programado'
  | 'email_enviado'
  | 'seguimiento'
  | 'cita_cualificada'
  | 'no_interesa'

export type ColdNoteKind = 'llamada' | 'email' | 'whatsapp' | 'linkedin' | 'nota'

/**
 * QUÉ CLASE DE LEAD ES. No se deduce de `source_list`.
 *
 * `source_list` es texto libre y el board agrupa las listas por igualdad
 * exacta, así que «Jose V2» en vez de «José V2» crea una lista nueva sin
 * avisar. Si la ficha decidiera sus bloques a partir de ese texto, un acento
 * de más le pintaría a una tienda online «Perfil seller → Ver en Amazon» y le
 * esconderría el bloque de «¿Vende ya en Amazon?», que es el que decide si se
 * la llama. No daría error: solo pintaría mal.
 */
export type ColdLeadTipo = 'seller_amazon' | 'tienda_online'

/**
 * Lo primero que se comprueba en un lead de la lista nueva, en 30 segundos.
 *
 * Tres valores nombrados y no un booleano que admita nulo: con el booleano hay
 * que escribir `IS NOT FALSE` por toda la pantalla y cada lector adivina qué
 * significa el nulo.
 */
export type ColdVendeAmazon = 'sin_comprobar' | 'no_vende' | 'vende'

/** Si es autónomo NO se llama en frío, va por email. Lo dice la Leyenda. */
export type ColdTipoEmpresa = 'sociedad' | 'autonomo'

export interface ColdLead {
  id: string
  store_name: string
  company: string | null
  revenue_monthly: number | null
  amazon_start: string | null
  phone: string | null
  directors: string | null
  email: string | null
  province: string | null
  category: string | null
  subcategory: string | null
  seller_url: string | null
  mercantile_registry: string | null
  business_address: string | null

  /** Vendedor de Amazon o tienda que todavía no vende ahí (migración 204) */
  tipo_lead: ColdLeadTipo
  vende_en_amazon: ColdVendeAmazon
  vende_en_amazon_comprobado_en: string | null

  /** Administrador activo del BORME, y su cargo aparte. Aquí el nulo es un dato:
      vacío en 607 de cada 1.000, y es lo que dispara «pregunta por el
      responsable» en vez de un guion. */
  decisor: string | null
  cargo_decisor: string | null

  /** La geografía real de estas tiendas. `province` no vale: la columna del
      Excel dice «Europe» en las 1.000 y no se importa. */
  ciudad: string | null
  /** 1, 2 o 3. El número, no la etiqueta: con «1 - Potencial alto» no se ordena */
  nivel: number | null
  /** DÓLARES estimados por el modelo de tráfico de Store Leads. Nunca
      revenue_monthly: formatRevenue() les pondría « €» encima. */
  ventas_estimadas_usd: number | null
  n_productos: number | null
  /** Antigüedad de la TIENDA, con decimal. No es `amazon_start` («Vende desde») */
  anos_tienda: number | null
  plataforma: string | null
  web: string | null
  instagram: string | null
  telefonos_extra: string | null
  emails_extra: string | null
  cif: string | null
  tipo_empresa: ColdTipoEmpresa | null
  /** Viene 0 y no nulo cuando el BORME no da ninguno: el 0 explica por qué
      `decisor` está vacío, así que los dos valores significan cosas distintas */
  n_administradores: number | null

  assigned_to: string | null
  status: ColdLeadStatus
  follow_up: string | null
  action_label: string | null
  /** Pestaña del Excel de la que salió: «1a lista», «Alejandro V2»... */
  source_list: string | null
  next_call_date: string | null
  last_contacted_at: string | null
  call_attempts: number

  created_at: string
  updated_at: string
}

export interface ColdLeadNote {
  id: string
  lead_id: string
  author_id: string | null
  kind: ColdNoteKind
  body: string
  occurred_at: string
  created_at: string
  author?: CalendarPerson | null
}

/** Orden del embudo: de lo que no se ha tocado a lo cerrado o descartado */
export const COLD_STATUSES: ColdLeadStatus[] = [
  'pendiente',
  'no_contesta',
  'programado',
  'email_enviado',
  'seguimiento',
  'cita_cualificada',
  'no_interesa',
]

export const COLD_STATUS_LABELS: Record<ColdLeadStatus, string> = {
  pendiente: 'Sin contactar',
  no_contesta: 'No contesta',
  programado: 'Rellamada programada',
  email_enviado: 'Info enviada',
  seguimiento: 'En seguimiento',
  cita_cualificada: 'Cita cualificada',
  no_interesa: 'No le interesa',
}

/** Qué significa cada estado, para que nadie dude al elegir */
export const COLD_STATUS_HINTS: Record<ColdLeadStatus, string> = {
  pendiente: 'Todavía no se ha llamado',
  no_contesta: 'No coge, buzón o cuelga: hay que reintentar',
  programado: 'Nos ha dado día y hora para volver a llamar',
  email_enviado: 'Pidió la información por correo y se la mandamos',
  seguimiento: 'Muestra interés, hay que insistir',
  cita_cualificada: 'Sesión de consultoría agendada',
  no_interesa: 'Descartado: no quiere, ya tiene agencia o no encaja',
}

/**
 * Los mismos colores que usaban en el Excel, para que el equipo no tenga
 * que reaprender nada: amarillo = no contesta, cian = programado,
 * magenta = info enviada, naranja = seguimiento, verde = cualificada,
 * rojo = descartado.
 */
export const COLD_STATUS_DOTS: Record<ColdLeadStatus, string> = {
  pendiente: '#6B7280',
  no_contesta: '#EAB308',
  programado: '#06B6D4',
  email_enviado: '#D946EF',
  seguimiento: '#F97316',
  cita_cualificada: '#22C55E',
  no_interesa: '#EF4444',
}

export const COLD_STATUS_CLASSES: Record<ColdLeadStatus, string> = {
  pendiente: 'bg-gray-500/15 text-gray-300 border-gray-500/30',
  no_contesta: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/35',
  programado: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/35',
  email_enviado: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/35',
  seguimiento: 'bg-orange-500/20 text-orange-300 border-orange-500/35',
  cita_cualificada: 'bg-green-500/20 text-green-300 border-green-500/35',
  no_interesa: 'bg-red-500/20 text-red-300 border-red-500/35',
}

export const COLD_NOTE_LABELS: Record<ColdNoteKind, string> = {
  llamada: 'Llamada',
  email: 'Email',
  whatsapp: 'WhatsApp',
  linkedin: 'LinkedIn',
  nota: 'Nota',
}

export const COLD_NOTE_COLORS: Record<ColdNoteKind, string> = {
  llamada: '#3B82F6',
  email: '#D946EF',
  whatsapp: '#22C55E',
  linkedin: '#0A66C2',
  nota: '#94A3B8',
}

/** Teléfono listo para un enlace tel: — el Excel trae formatos variados */
export function telHref(phone: string | null): string | null {
  if (!phone) return null
  const first = phone.split(/[/;]|\s-\s|\/\//)[0]
  const cleaned = first.replace(/[^\d+]/g, '')
  if (cleaned.replace(/\D/g, '').length < 7) return null
  return cleaned.startsWith('+') ? cleaned : `+34${cleaned}`
}

/** Criterios de orden de la lista de trabajo */
export type ColdSort = 'revenue_desc' | 'revenue_asc' | 'due_first' | 'name' | 'prioridad'

export const COLD_SORT_LABELS: Record<ColdSort, string> = {
  revenue_desc: 'Más facturación',
  revenue_asc: 'Menos facturación',
  due_first: 'Rellamadas primero',
  name: 'Nombre A-Z',
  prioridad: 'Nivel y ventas est.',
}

/**
 * Color estable por lista de origen, para distinguirlas de un vistazo sin
 * tener que leer la etiqueta.
 */
const LIST_PALETTE = ['#8B5CF6', '#0EA5E9', '#F59E0B', '#EC4899', '#14B8A6', '#64748B']

export function colorForList(name: string | null): string {
  if (!name) return '#64748B'
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return LIST_PALETTE[Math.abs(hash) % LIST_PALETTE.length]
}

export function formatRevenue(n: number | null): string {
  if (n == null) return '—'
  return `${Math.round(n).toLocaleString('es-ES')} €`
}

/* ==========================================================================
 * LA LISTA NUEVA: TIENDAS QUE TODAVÍA NO VENDEN EN AMAZON (migración 204)
 * ========================================================================== */

export const COLD_TIPO_LABELS: Record<ColdLeadTipo, string> = {
  seller_amazon: 'Vendedores de Amazon',
  tienda_online: 'Tiendas online',
}

export function esTiendaOnline(lead: Pick<ColdLead, 'tipo_lead'>): boolean {
  return lead.tipo_lead === 'tienda_online'
}

export const COLD_VENDE_ORDEN: ColdVendeAmazon[] = ['sin_comprobar', 'no_vende', 'vende']

export const COLD_VENDE_LABELS: Record<ColdVendeAmazon, string> = {
  sin_comprobar: 'Sin comprobar',
  no_vende: 'No vende en Amazon',
  vende: 'Ya vende en Amazon',
}

/**
 * Qué hacer con cada respuesta. Va en el `title` de los tres botones porque de
 * esto depende el discurso entero de la llamada, no el color de un chip.
 */
export const COLD_VENDE_HINTS: Record<ColdVendeAmazon, string> = {
  sin_comprobar: 'Todavía nadie lo ha mirado. Son 30 segundos y cambia la llamada entera',
  no_vende: 'Comprobado: no está en Amazon. Es el lead bueno de esta lista',
  vende: 'Ya está en Amazon: descarta el lead, pero apúntalo (la tienda migró)',
}

export const COLD_VENDE_DOTS: Record<ColdVendeAmazon, string> = {
  sin_comprobar: '#6B7280',
  no_vende: '#22C55E',
  vende: '#EF4444',
}

/** El rótulo se pinta desde aquí; en la base solo vive el número */
export const COLD_NIVEL_LABELS: Record<number, string> = {
  1: 'Potencial alto',
  2: 'Muy buenos números',
  3: 'Lead correcto',
}

export const COLD_NIVEL_DOTS: Record<number, string> = {
  1: '#22C55E',
  2: '#EAB308',
  3: '#64748B',
}

export const COLD_TIPO_EMPRESA_LABELS: Record<ColdTipoEmpresa, string> = {
  sociedad: 'Sociedad',
  autonomo: 'Autónomo',
}

/**
 * VENTAS ESTIMADAS, Y NUNCA CON EL SÍMBOLO DEL EURO.
 *
 * Son dólares de un modelo de tráfico de Store Leads, no facturación que nadie
 * haya visto. formatRevenue() concatena « €» sin preguntar, así que reutilizarla
 * aquí le pondría al comercial «793.590 €/mes» delante mientras habla por
 * teléfono, afirmado. La moneda va en el texto justo por eso.
 */
export function formatVentasEstimadas(n: number | null): string {
  if (n == null) return '—'
  return `${Math.round(Number(n)).toLocaleString('es-ES')} $`
}

/** La frase que acompaña a la cifra. Pegada al número y no en un tooltip: la
    Leyenda dice que estas cifras sirven para ORDENAR y que no se dicen en la
    llamada, y la ficha es lo que el comercial tiene abierto mientras habla. */
export const AVISO_VENTAS_ESTIMADAS =
  'Estimación del modelo de tráfico de Store Leads. Sirve para priorizar: NO se dice en la llamada.'

/**
 * EL NÚMERO POR EL QUE SE ORDENA CADA LEAD, SEGÚN SU TIPO.
 *
 * Un vendedor de Amazon trae euros observados en `revenue_monthly`; una tienda
 * online trae dólares estimados en `ventas_estimadas_usd` y su `revenue_monthly`
 * es nulo. Sin esto, las 2.000 tiendas valen 0 al ordenar y caen todas al final
 * de una lista de casi 6.000 con 400 filas pintadas: el comercial abre la
 * pantalla y no ve ni una.
 *
 * Ordena, y solo ordena: las dos cifras NO se suman, NO se comparan en un
 * filtro de rango ni se imprimen juntas. Para eso está el filtro de tipo.
 */
export function pesoOrden(lead: Pick<ColdLead, 'tipo_lead' | 'revenue_monthly' | 'ventas_estimadas_usd'>): number {
  const bruto = esTiendaOnline(lead) ? lead.ventas_estimadas_usd : lead.revenue_monthly
  return Number(bruto) || 0
}
