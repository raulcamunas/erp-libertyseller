import type { EstadoFila, InformeDeComision, LineaFactura, PlantillaResumen } from './tipos'

/**
 * LAS REGLAS DE FACTURACIÓN, SIN BASE DE DATOS NI RED, PARA PODER PROBARLAS.
 */

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

const quitarAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Solo letras y números, sin espacios: «Poker Shop» y «Pokershop» son lo mismo */
export const compacto = (s: string) => quitarAcentos(s).toLowerCase().replace(/[^a-z0-9]/g, '')

export function mesDelPeriodo(period: string): string {
  const [a, m] = period.split('-').map(Number)
  const nombre = MESES[(m || 1) - 1]
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${a}`
}

const MES_EN_TEXTO = new RegExp(`\\b(${MESES.join('|')})\\s+(\\d{4})\\b`, 'i')

/**
 * ¿DE QUÉ MES ES UNA FACTURA?
 *
 * Primero el que dice el número y no su fecha: «Yo By Yolanda | Septiembre 2026»
 * se emitió el 6 de octubre y es de septiembre. Si el número no dice mes, la fecha.
 */
export function periodoDeFactura(numero: string, fecha: string): string {
  const hallado = quitarAcentos(numero).match(MES_EN_TEXTO)
  if (hallado) {
    const mes = MESES.indexOf(hallado[1].toLowerCase()) + 1
    return `${hallado[2]}-${String(mes).padStart(2, '0')}-01`
  }
  return `${fecha.slice(0, 7)}-01`
}

/** «Lenobotics | Octubre 2026» → «Lenobotics». Vacío si el número solo dice el mes */
export function etiquetaDeNumero(numero: string): string {
  return numero
    .replace(MES_EN_TEXTO, '')
    .split('|')
    .map((t) => t.trim())
    .filter(Boolean)
    .join(' | ')
}

export function numeroPropuesto(etiqueta: string, period: string): string {
  return `${etiqueta.trim()} | ${mesDelPeriodo(period)}`
}

const FORMAS_LEGALES = /\b(s\.?\s?l\.?\s?u\.?|s\.?\s?l\.?|s\.?\s?a\.?|llc|ltd|inc|fzco)\b\.?/gi

/** La clave para cruzar un cliente de Tesorería con un contacto de Zoho */
export function claveDeContacto(nombre: string): string {
  return compacto(quitarAcentos(nombre).replace(FORMAS_LEGALES, ' '))
}

/**
 * LA PAREJA POR NOMBRE.
 *
 * Solo si hay UN candidato. Con dos, se deja sin pareja para que la elija una
 * persona: la factura de un cliente en la ficha de otro no se ve hasta que
 * alguien la lee.
 */
export function emparejarContacto<T extends { contact_name?: string; company_name?: string }>(
  nombre: string,
  contactos: T[]
): T | null {
  const clave = claveDeContacto(nombre)
  if (!clave) return null
  const hallados = contactos.filter(
    (c) => claveDeContacto(c.contact_name ?? '') === clave || claveDeContacto(c.company_name ?? '') === clave
  )
  return hallados.length === 1 ? hallados[0] : null
}

export function estadoDesdeZoho(estadoZoho: string): Exclude<EstadoFila, 'sin_importes' | 'por_crear'> {
  switch (estadoZoho) {
    case 'draft':
      return 'borrador'
    case 'overdue':
      return 'vencida'
    case 'partially_paid':
      return 'parcial'
    case 'paid':
      return 'cobrada'
    default:
      return 'enviada'
  }
}

/** Lo que admite la columna `status` de `invoices` (migración 069) */
export function estadoParaElReflejo(estadoZoho: string): 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled' {
  if (estadoZoho === 'draft') return 'draft'
  if (estadoZoho === 'paid') return 'paid'
  if (estadoZoho === 'overdue') return 'overdue'
  if (estadoZoho === 'void') return 'cancelled'
  return 'sent'
}

/** Las dos líneas de siempre. Un importe a cero no se factura */
export function lineasDelMes(fee: number | null, comision: number | null, informes: InformeDeComision[] = []): LineaFactura[] {
  const lineas: LineaFactura[] = []
  if (fee && fee > 0) lineas.push({ descripcion: 'Fee Mensual de Gestión', importe: fee })
  if (comision && comision > 0) lineas.push(...(lineasPorCuenta(comision, informes) ?? [{ descripcion: 'Comisiones Amazon', importe: comision }]))
  return lineas
}

const aCentimos = (n: number) => Math.round(n * 100) / 100

/**
 * UNA LÍNEA POR CUENTA, EN EL CLIENTE QUE SE FACTURA JUNTO.
 *
 * Tesorería solo guarda la suma; lo de cada cuenta sale de su informe. La última línea se lleva el céntimo del redondeo, para
 * que la factura dé exactamente lo que dice Tesorería. Si falta un informe o no cuadran, no se reparte: `avisosDeFila` lo dice.
 */
function lineasPorCuenta(comision: number, informes: InformeDeComision[]): LineaFactura[] | null {
  const cuentas = informes.filter((i) => i.cuenta && (i.importe ?? 0) > 0)
  if (cuentas.length === 0) return null
  const suma = cuentas.reduce((s, i) => s + aCentimos(i.importe ?? 0), 0)
  if (Math.abs(suma - comision) >= MARGEN_DE_INFORME) return null
  return cuentas.map((i, n) => ({
    descripcion: `Comisiones ${i.nombre}`,
    importe: n < cuentas.length - 1 ? aCentimos(i.importe ?? 0) : aCentimos(comision - (suma - aCentimos(i.importe ?? 0))),
  }))
}

/** Lo que puede separar un informe de Tesorería sin que sea un error: los céntimos del redondeo */
const MARGEN_DE_INFORME = 0.05

/** Lo que dicen los informes en total. null si alguno no lo dice: entonces no se puede comparar */
export function importeDeInformes(informes: InformeDeComision[]): number | null {
  if (informes.length === 0 || informes.some((i) => i.importe == null)) return null
  return aCentimos(informes.reduce((s, i) => s + (i.importe ?? 0), 0))
}

export function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export const AVISO_SIN_INFORME = 'Sin informe de comisión'

/* ---------- Los grupos del tablero: lo que toca hacer con cada cliente ---------- */

export type IdGrupo = 'vencida' | 'por_crear' | 'borrador' | 'por_cobrar' | 'cobrada' | 'sin_importes'

export interface GrupoFacturacion {
  id: IdGrupo
  nombre: string
  ayuda: string
  estados: EstadoFila[]
  /** Lo que ya no pide nada empieza plegado */
  plegado: boolean
}

/** El vencido arriba porque corre prisa; el resto, en el orden en que se trabaja el mes */
export const GRUPOS_FACTURACION: GrupoFacturacion[] = [
  { id: 'vencida', nombre: 'Vencidas', ayuda: 'Ya pasó la fecha de pago. Si el dinero ha llegado, registra el cobro.', estados: ['vencida'], plegado: false },
  { id: 'por_crear', nombre: 'Por crear', ayuda: 'Aún no están en Zoho. Crearlas no envía nada al cliente.', estados: ['por_crear'], plegado: false },
  { id: 'borrador', nombre: 'Por enviar', ayuda: 'En Zoho como borrador. Revisa cada una y envíala.', estados: ['borrador'], plegado: false },
  { id: 'por_cobrar', nombre: 'Por cobrar', ayuda: 'Enviadas y dentro de plazo.', estados: ['enviada', 'parcial'], plegado: false },
  { id: 'cobrada', nombre: 'Cobradas', ayuda: 'Cerradas en Zoho.', estados: ['cobrada'], plegado: true },
  { id: 'sin_importes', nombre: 'Sin importes este mes', ayuda: 'Tesorería no tiene nada que facturarles.', estados: ['sin_importes'], plegado: true },
]

/**
 * LAS FILAS DE CADA GRUPO, SOLO LOS GRUPOS QUE TIENEN ALGUNA.
 *
 * Dentro de cada uno, primero lo que se puede hacer ya; lo que tiene algo pendiente (un aviso, o que falta enlazar el cliente
 * con Zoho) va al final, sin desordenar el resto.
 */
export function agruparFilas<F extends { estado: EstadoFila; avisos: string[]; contactoId: string | null }>(filas: F[]): { grupo: GrupoFacturacion; filas: F[] }[] {
  const pendiente = (f: F) => (f.avisos.length > 0 || !f.contactoId ? 1 : 0)
  return GRUPOS_FACTURACION.map((grupo) => ({
    grupo,
    filas: filas.filter((f) => grupo.estados.includes(f.estado)).sort((a, b) => pendiente(a) - pendiente(b)),
  })).filter((g) => g.filas.length > 0)
}

/** Días enteros que han pasado desde una fecha ISO; negativo si aún no ha llegado */
export function diasDesde(fecha: string, hoy: string): number {
  return Math.round((Date.parse(hoy.slice(0, 10)) - Date.parse(fecha.slice(0, 10))) / 86_400_000)
}

/**
 * CÓMO SE REPARTE EL DINERO DEL MES ENTRE LOS PASOS.
 *
 * Las cuatro partes suman el total del mes. De lo que ya ha salido, lo que falta por entrar cuenta como por cobrar y el resto
 * como cobrado, así que un cobro parcial queda partido entre los dos.
 */
export function repartoDelMes(filas: { estado: EstadoFila; totalTesoreria: number; factura: { total: number; saldo: number } | null }[]) {
  const reparto = { porCrear: 0, porEnviar: 0, porCobrar: 0, cobrado: 0 }
  for (const f of filas) {
    if (!f.factura) reparto.porCrear += f.totalTesoreria
    else if (f.estado === 'borrador') reparto.porEnviar += f.factura.total
    else {
      reparto.porCobrar += f.factura.saldo
      reparto.cobrado += f.factura.total - f.factura.saldo
    }
  }
  return reparto
}

/** Cuánto lleva vencida una factura por cobrar. Lo primero que se reclama es lo que lleva más tiempo */
export const TRAMOS_VENCIMIENTO = [
  { id: 'en_plazo', nombre: 'En plazo' },
  { id: 'hasta_15', nombre: 'Hasta 15 días' },
  { id: 'hasta_30', nombre: 'De 16 a 30 días' },
  { id: 'mas_de_30', nombre: 'Más de 30 días' },
] as const
export type IdVencimiento = (typeof TRAMOS_VENCIMIENTO)[number]['id']

export function tramoDeVencimiento(diasVencida: number): IdVencimiento {
  if (diasVencida <= 0) return 'en_plazo'
  if (diasVencida <= 15) return 'hasta_15'
  if (diasVencida <= 30) return 'hasta_30'
  return 'mas_de_30'
}

/* ---------- Recordar un pago ---------- */

/** A partir de cuántos días laborables sin pagar, contados desde el vencimiento, se avisa y se propone mandar un recordatorio */
export const DIAS_LABORABLES_PARA_RECORDAR = 3

const diaSemanaUTC = (dia: string) => new Date(`${dia}T12:00:00Z`).getUTCDay()

/**
 * CUÁNTOS DÍAS LABORABLES LLEVA UNA FACTURA SIN PAGAR.
 *
 * Los que van del día siguiente al vencimiento hasta hoy, los dos incluidos: vence el viernes y hoy es lunes → 1. Sin sábados, domingos ni
 * las fiestas que se pasen (las nacionales: el cliente puede estar en cualquier comunidad). 0 si aún no ha vencido o no tiene vencimiento.
 */
export function diasLaborablesDeRetraso(vence: string | null, hoy: string, festivos: ReadonlySet<string> = new Set()): number {
  if (!vence) return 0
  let n = 0
  for (let d = sumarDias(vence.slice(0, 10), 1), i = 0; d <= hoy.slice(0, 10) && i < 3000; d = sumarDias(d, 1), i++) {
    const s = diaSemanaUTC(d)
    if (s !== 0 && s !== 6 && !festivos.has(d)) n++
  }
  return n
}

/**
 * ¿TOCA MANDARLE UN RECORDATORIO?
 *
 * Cuando lleva los días laborables de `DIAS_LABORABLES_PARA_RECORDAR` sin pagar y, si ya se le mandó uno, han pasado otros tantos desde
 * entonces: dos recordatorios seguidos el mismo día o al siguiente molestan más de lo que ayudan.
 */
export function tocaRecordar(args: { diasLaborables: number; ultimoRecordatorio: string | null; hoy: string; festivos?: ReadonlySet<string> }): boolean {
  if (args.diasLaborables < DIAS_LABORABLES_PARA_RECORDAR) return false
  if (!args.ultimoRecordatorio) return true
  return diasLaborablesDeRetraso(args.ultimoRecordatorio.slice(0, 10), args.hoy, args.festivos) >= DIAS_LABORABLES_PARA_RECORDAR
}

/** La plantilla de correo que es un recordatorio de pago: se reconoce por el nombre. Nunca se propone para mandar una factura nueva */
export const esPlantillaDeRecordatorio = (p: { nombre: string }) => compacto(p.nombre).includes('recordatorio')

/**
 * LA PLANTILLA DE RECORDATORIO QUE SE CREA EN ZOHO SI AÚN NO HAY NINGUNA.
 *
 * Con el mismo diseño que las de factura y solo con marcadores de Zoho, para que se pueda retocar en «Plantillas» como cualquier otra. No
 * dice cuántos días lleva: el cliente lee mejor la fecha en que venció que una cuenta.
 */
export const PLANTILLA_RECORDATORIO = {
  nombre: 'Recordatorio de pago',
  asunto: 'Recordatorio de pago | Factura %InvoiceNumber%',
  cuerpo:
    '<div style="background:#F7F5F2; padding:24px 0; font-family:\'Inter\', Arial, Helvetica, sans-serif;"><table style="max-width: 600px; margin: 0px auto; background: rgb(255, 255, 255); border: 1px solid rgb(229, 225, 219); border-collapse: separate; border-spacing: 0px; border-radius: 14px; overflow: hidden;" border="0" cellspacing="0" cellpadding="0" width="100%" role="presentation"><tbody>' +
    '<tr><td style="background:#F26212; height:5px; line-height:5px; font-size:0; border-radius:14px 14px 0 0;">&nbsp;</td></tr>' +
    '<tr><td style="background:#FFFFFF; padding:24px 32px 0;"><div style="max-width:170px; max-height:40px;">%OrgLogo%</div><div style="margin-top:18px; color:#5E5852; font-size:11px; letter-spacing:2px; text-transform:uppercase;">Recordatorio de pago</div><div style="margin-top:4px; color:#141414; font-family:\'Sora\', Arial, Helvetica, sans-serif; font-size:22px; font-weight:700;">Factura <span style="color:rgb(242, 98, 18)">%InvoiceNumber%</span></div><div style="margin-top:14px; width:44px; height:3px; background:#F26212; border-radius:2px; font-size:0; line-height:3px;">&nbsp;</div></td></tr>' +
    '<tr><td style="padding:20px 32px 4px; color:#141414; font-size:15px; line-height:1.7;">Hola, %CustomerName%:<br><br>Te escribimos porque la factura <b>%InvoiceNumber%</b> venció el <b>%DueDate%</b> y todavía no nos consta el pago. Te la volvemos a adjuntar en PDF.<br><br>Si ya la has pagado, no hagas caso de este correo y gracias. Si hay algún problema con ella, contéstanos y lo vemos.</td></tr>' +
    '<tr><td style="padding:20px 32px;"><table style="border-collapse:separate; border-spacing:0;" border="0" cellspacing="0" cellpadding="0" width="100%" role="presentation"><tbody><tr><td style="background:#0E0E0E; padding:22px 24px; text-align:center; border-radius:12px 12px 0 0;"><div style="color:#B8AE9F; font-size:11px; letter-spacing:2px; text-transform:uppercase;">Pendiente de pago</div><div style="margin-top:6px; color:#F26212; font-family:\'Sora\', Arial, Helvetica, sans-serif; font-size:30px; font-weight:700;">%Balance%</div></td></tr><tr><td style="background:#F7F5F2; padding:14px 24px; border-radius:0 0 12px 12px;"><table style="border-collapse:collapse; font-size:14px;" border="0" cellspacing="0" cellpadding="0" width="100%" role="presentation"><tbody>' +
    '<tr><td style="padding:8px 0; color:#5E5852; border-bottom:1px solid #E5E1DB;">N.º de factura</td><td style="padding:8px 0; color:#141414; font-weight:600; text-align:right; border-bottom:1px solid #E5E1DB;">%InvoiceNumber%</td></tr>' +
    '<tr><td style="padding:8px 0; color:#5E5852; border-bottom:1px solid #E5E1DB;">Fecha de emisión</td><td style="padding:8px 0; color:#141414; font-weight:600; text-align:right; border-bottom:1px solid #E5E1DB;">%InvoiceDate%</td></tr>' +
    '<tr><td style="padding:8px 0; color:#5E5852;">Venció el</td><td style="padding:8px 0; color:#141414; font-weight:600; text-align:right;">%DueDate%</td></tr>' +
    '</tbody></table></td></tr></tbody></table></td></tr>' +
    '<tr><td style="padding:4px 32px 24px; text-align:center;"><a style="display:inline-block; background:#F26212; color:#FFFFFF; font-family:\'Sora\', Arial, Helvetica, sans-serif; font-size:14px; font-weight:700; letter-spacing:1px; text-decoration:none; padding:13px 34px; border-radius:10px;" href="%InvoiceURL%">VER FACTURA</a></td></tr>' +
    '<tr><td style="padding:0 32px 24px;"><table style="border-collapse:separate; border-spacing:0;" border="0" cellspacing="0" cellpadding="0" width="100%" role="presentation"><tbody><tr><td style="width:4px; background:#F26212; font-size:0; border-radius:10px 0 0 10px;">&nbsp;</td><td style="background:#FEF3EC; padding:14px 18px; color:#141414; font-size:13px; line-height:1.6; border-radius:0 10px 10px 0;">El pago se realiza por transferencia bancaria. Los datos de la cuenta están en la factura; indica <b>%InvoiceNumber%</b> como referencia.</td></tr></tbody></table></td></tr>' +
    '<tr><td style="padding:4px 32px 28px; color:#141414; font-size:14px; line-height:1.6;">Un saludo,<br><b><span style="font-family:Sora, Arial, Helvetica, sans-serif">Equipo Liberty Seller</span></b></td></tr>' +
    '<tr><td style="background:#0E0E0E; padding:16px 32px; color:#B8AE9F; font-size:11px; line-height:1.6; border-radius:0 0 14px 14px;"><a style="color:#F26212; text-decoration:none;" href="https://libertyseller.com">libertyseller.com</a></td></tr>' +
    '</tbody></table></div>',
}

export function avisosDeFila(args: {
  totalTesoreria: number
  cobradoEnTesoreria: boolean
  estadoZoho: string | null
  totalZoho: number | null
  moneda: string | null
  comision: number | null
  hayInformes: boolean
  /** Lo que dicen los informes del mes, si se sabe */
  importeInformes?: number | null
  /** Las cuentas de un cliente que se factura junto que aún no tienen informe */
  cuentasSinInforme?: string[]
  contactoTieneCorreo: boolean
  hayContacto: boolean
}): string[] {
  const avisos: string[] = []
  if (args.totalZoho != null && args.totalTesoreria > 0 && Math.abs(args.totalZoho - args.totalTesoreria) >= 0.005) {
    avisos.push(`Tesorería dice ${args.totalTesoreria.toFixed(2)}, Zoho ${args.totalZoho.toFixed(2)}`)
  }
  if (args.cobradoEnTesoreria && args.estadoZoho && !['draft', 'paid', 'void'].includes(args.estadoZoho)) {
    avisos.push('Cobrada en Tesorería, sin cobro en Zoho')
  }
  // Solo mientras se puede hacer algo: una factura ya enviada salió con lo que salió
  const antesDeEnviar = !args.estadoZoho || args.estadoZoho === 'draft'
  if ((args.comision ?? 0) > 0 && antesDeEnviar) {
    if (!args.hayInformes) avisos.push(AVISO_SIN_INFORME)
    else for (const cuenta of args.cuentasSinInforme ?? []) avisos.push(`${AVISO_SIN_INFORME}: ${cuenta}`)
    // El cliente vería una cifra en la factura y otra en el enlace
    if (args.importeInformes != null && Math.abs(args.importeInformes - (args.comision ?? 0)) >= MARGEN_DE_INFORME) {
      avisos.push(`El informe dice ${args.importeInformes.toFixed(2)}, Tesorería ${(args.comision ?? 0).toFixed(2)}`)
    }
  }
  if (args.hayContacto && !args.contactoTieneCorreo) avisos.push('Sin correo en Zoho')
  return avisos
}

/* ---------- El correo, tal como lo devuelve Zoho ---------- */

/**
 * EL ASUNTO DE LAS PLANTILLAS DE FACTURACIÓN: «Facturación de Servicios | Noviembre 2026 | Creative Toys».
 *
 * Zoho no tiene un marcador con el mes facturado ni con el nombre corto del cliente: su asunto sale con la fecha de emisión y
 * la razón social. El mes y el nombre salen del número de la factura, que los trae en cualquier orden. Una plantilla con otro
 * asunto se respeta tal cual.
 */
export function asuntoDeFactura(asunto: string, numero: string, fecha: string): string {
  const PREFIJO = 'Facturación de Servicios'
  if (!asunto.startsWith(PREFIJO)) return asunto
  return [PREFIJO, mesDelPeriodo(periodoDeFactura(numero, fecha)), etiquetaDeNumero(numero)].filter(Boolean).join(' | ')
}

/**
 * LOS MARCADORES QUE ZOHO DEJA SIN RELLENAR.
 *
 * Una factura sin nota devuelve «%Notes%» tal cual, y el cliente lo leería así. Se quita también el salto de línea que lleva
 * delante, para que no quede un hueco. Con nota, Zoho ya la ha puesto y aquí no queda nada que quitar.
 */
export function quitarMarcadoresSinRellenar(html: string): string {
  // La minúscula en segundo lugar es lo que lo separa de un enlace codificado: «%C3%ABC%20» también va entre dos %
  return html.replace(/(?:<br\s*\/?>\s*)?%[A-Z][a-z][A-Za-z]*%/g, '')
}

/* ---------- Los huecos de enlace de las plantillas ---------- */

const HUECO = /ENLACE_[A-Z0-9_]+/g

/** Los huecos que aún no tienen enlace: `href="ENLACE_ERP"` */
export function huecosDeEnlace(html: string): string[] {
  return [...new Set(html.match(HUECO) ?? [])]
}

/** ENLACE_ERP es el de comisiones; el resto dice de qué tienda es */
export function rotuloDeHueco(hueco: string): string {
  if (hueco === 'ENLACE_ERP') return 'Enlace de comisiones'
  const nombre = hueco.replace(/^ENLACE_/, '').toLowerCase().split('_')
  return `Enlace de ${nombre.map((p) => `${p.charAt(0).toUpperCase()}${p.slice(1)}`).join(' ')}`
}

export function rellenarEnlaces(html: string, enlaces: Record<string, string>): string {
  return html.replace(HUECO, (hueco) => {
    const url = enlaces[hueco]?.trim()
    return url ? url.replace(/&(?!amp;)/g, '&amp;').replace(/"/g, '%22') : hueco
  })
}

/**
 * QUÉ INFORME VA EN CADA HUECO.
 *
 * Un hueco con nombre solo se rellena con el informe que se llama igual. El
 * genérico, solo si no hay duda: un enlace de otra tienda en el correo es peor
 * que uno vacío, y uno vacío no deja enviar.
 */
export function proponerEnlaces(huecos: string[], informes: InformeDeComision[]): Record<string, string> {
  const propuesta: Record<string, string> = {}
  for (const hueco of huecos) {
    if (hueco === 'ENLACE_ERP') {
      propuesta[hueco] = informes.length === 1 ? informes[0].url : ''
      continue
    }
    const clave = compacto(hueco.replace(/^ENLACE_/, ''))
    propuesta[hueco] = informes.find((i) => compacto(i.nombre).includes(clave))?.url ?? ''
  }
  return propuesta
}

/* ---------- Qué plantilla se propone ---------- */

/**
 * LA ÚLTIMA QUE SE USÓ CON ESE CLIENTE; SI NO, LA QUE LE PEGA.
 *
 * Una plantilla con el nombre del cliente («… Tapas Party») va primero; después,
 * con comisión la normal y sin comisión la de «Sin Comisiones».
 */
export function plantillaPropuesta(
  plantillas: PlantillaResumen[],
  args: { cliente: string; tieneComision: boolean; ultimaUsadaId?: string | null }
): PlantillaResumen | null {
  // Un recordatorio de pago no es una factura: no se propone nunca para mandar una, aunque fuera lo último que se le mandó
  plantillas = plantillas.filter((p) => !esPlantillaDeRecordatorio(p))
  const ultima = plantillas.find((p) => p.id === args.ultimaUsadaId)
  if (ultima) return ultima

  const utiles = plantillas.filter((p) => compacto(p.nombre) !== 'predeterminado')
  const lista = utiles.length > 0 ? utiles : plantillas
  const esSinComision = (p: PlantillaResumen) => compacto(p.nombre).includes('sincomision')
  const nombres = lista.map((p) => compacto(p.nombre))
  // Lo común a todas («facturaciondeservicios») no cuenta para reconocer al cliente
  const base = nombres.length > 1 ? prefijoComun(nombres) : ''
  const cliente = compacto(args.cliente)
  const delCliente = lista.find((p) => {
    const resto = compacto(p.nombre).slice(base.length)
    return resto.length >= 4 && !esSinComision(p) && cliente.includes(resto)
  })
  if (delCliente) return delCliente

  if (!args.tieneComision) {
    const sin = lista.find(esSinComision)
    if (sin) return sin
  }
  return lista.find((p) => compacto(p.nombre) === base) ?? lista.find((p) => !esSinComision(p)) ?? lista[0] ?? null
}

function prefijoComun(textos: string[]): string {
  let prefijo = textos[0] ?? ''
  for (const t of textos) {
    while (prefijo && !t.startsWith(prefijo)) prefijo = prefijo.slice(0, -1)
  }
  return prefijo
}

/* ---------- Direcciones de correo ---------- */

const CORREO = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/

export function correosValidos(lista: unknown): string[] | null {
  if (!Array.isArray(lista)) return null
  const limpios = [...new Set(lista.map((c) => String(c).trim()).filter(Boolean))]
  return limpios.every((c) => CORREO.test(c)) ? limpios : null
}

/* ---------- Qué factura paga un ingreso ---------- */

/**
 * LAS FACTURAS QUE PUEDE PAGAR UN INGRESO, LA MÁS PROBABLE PRIMERO.
 *
 * Solo se ordena; nada se registra sin que se confirme. El importe exacto cuenta
 * más que el nombre, porque el banco escribe el nombre como quiere («From
 * ZAPATERIAS BASOCO, SOCIEDAD LIMITAD»).
 */
export function candidatasDeCobro<T extends { saldo: number; cliente: string; moneda: string }>(
  movimiento: { importe: number; moneda: string; concepto: string },
  pendientes: T[]
): T[] {
  const concepto = claveDeContacto(movimiento.concepto)
  const puntos = (f: T) => {
    let p = 0
    if (Math.abs(f.saldo - movimiento.importe) < 0.005) p += 2
    const cliente = claveDeContacto(f.cliente)
    if (cliente.length >= 4 && concepto.includes(cliente)) p += 1
    return p
  }
  return pendientes
    .filter((f) => f.moneda === movimiento.moneda)
    .map((f) => ({ f, p: puntos(f) }))
    .sort((a, b) => b.p - a.p)
    .map(({ f }) => f)
}
