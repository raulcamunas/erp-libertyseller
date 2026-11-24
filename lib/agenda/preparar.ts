/**
 * EL PREPARADOR DE REUNIONES — PURO (24 nov 2026, Raúl). Se comprueba con preparar.prueba.ts.
 * ===========================================================================================
 * Antes de una cita, el comercial se prepara un guion: el objetivo, los puntos a tratar y las preguntas, con la ficha del cliente delante. Aquí:
 *   · `fichaDeCita`      junta lo que el ERP ya sabe del cliente (la cita, su lead de Cold Calling, sus llamadas transcritas, sus notas, las
 *                        reuniones anteriores y el análisis de su cuenta de Amazon) en una ficha corta para la pantalla y el PDF.
 *   · `guionDeArranque`  un primer guion SIN IA (gratis) a partir de la ficha, para no empezar en blanco. La IA es opcional.
 *   · `limpiarPreparacion` lo que llega del navegador, recortado y validado antes de guardarlo.
 * No toca la base ni la red.
 */

/** Una cita de la lista de la izquierda */
export interface CitaDeLaLista {
  id: string
  nombre: string
  empresa: string | null
  inicio: string
  fin: string
  comercial: string | null
  vendeEnAmazon: string | null
  preparada: boolean
}

export interface PreparacionGuardada {
  objetivo: string
  puntos: string[]
  preguntas: string[]
  notas: string
  iaAt: string | null
  actualizadoAt: string | null
}

export interface DatoFicha {
  etiqueta: string
  valor: string
}

export interface HitoFicha {
  /** 'YYYY-MM-DD' */
  fecha: string
  tipo: 'llamada' | 'nota' | 'reunion' | 'cita'
  texto: string
}

export interface FichaCliente {
  nombre: string
  empresa: string | null
  /** ISO de la cita */
  inicio: string
  fin: string
  comercial: string | null
  meet: string | null
  vendeEnAmazon: 'si' | 'no' | 'sin_comprobar' | string
  datos: DatoFicha[]
  /** Lo último que ha pasado con el cliente, del más reciente al más antiguo */
  historial: HitoFicha[]
  amazon: {
    resumen: string | null
    cifras: DatoFicha[]
    oportunidades: string[]
    fortalezas: string[]
    /** La chuleta del análisis («Su marca no está en Amazon…») */
    guion: string[]
    url: string | null
  } | null
  notasDeLaCita: string | null
}

/* ------------------------------------------------------------------ */
/* Entrada (filas de la base, ya leídas)                               */
/* ------------------------------------------------------------------ */

export interface CitaParaFicha {
  lead_name: string
  lead_company: string | null
  lead_email: string | null
  lead_phone: string | null
  start_time: string
  end_time: string
  notes: string | null
  google_meet_link: string | null
  vende_en_amazon: string | null
  revenue_amount: number | null
  amazon_link: string | null
  razon_social: string | null
  cif: string | null
  sector: string | null
  ciudad: string | null
  plataforma: string | null
  n_productos: number | null
  anos_tienda: number | null
  web: string | null
  transcription_summary: string | null
  comercial?: { full_name: string | null } | null
}

export interface LeadParaFicha {
  store_name?: string | null
  company?: string | null
  decisor?: string | null
  cargo_decisor?: string | null
  category?: string | null
  subcategory?: string | null
  revenue_monthly?: number | string | null
  ventas_estimadas_usd?: number | string | null
  amazon_start?: string | null
  seller_url?: string | null
  web?: string | null
  instagram?: string | null
  province?: string | null
  ciudad?: string | null
  rating?: number | string | null
  resenas?: number | string | null
  n_productos?: number | null
  anos_tienda?: number | null
  plataforma?: string | null
  tipo_lead?: string | null
}

export interface LlamadaParaFicha {
  fecha: string
  resumen: string | null
  siguiente_paso: string | null
  interes: string | null
}

export interface NotaParaFicha {
  occurred_at: string
  kind: string
  body: string
}

export interface ReunionParaFicha {
  fecha: string
  resumen: string | null
  proximos_pasos: unknown
}

/** El informe de lib/analisis-amazon/construir.ts (solo lo que se usa, todo opcional: hay informes viejos) */
export interface AnalisisParaFicha {
  fecha?: string
  token?: string | null
  informe: {
    resumen?: string
    tipoTexto?: string
    cifras?: { productos?: number; buyBox?: number | null; positivas12m?: number | null; valoracionesTotal?: number | null; fba?: string; mercadosActivos?: number }
    ventas?: { compras?: number; importe?: number }
    oportunidades?: Array<{ titulo?: string; cifra?: string }>
    fortalezas?: Array<{ titulo?: string; cifra?: string }>
    guion?: { frases?: string[] }
    moneda?: string
  } | null
}

/* ------------------------------------------------------------------ */
/* La ficha                                                            */
/* ------------------------------------------------------------------ */

const limpio = (v: unknown, max = 300): string | null => {
  if (v === null || v === undefined) return null
  const t = String(v).replace(/\s+/g, ' ').trim()
  return t ? (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t) : null
}
const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.,-]/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
// «9.789» y no «9789»: en español el punto de miles no sale con 4 cifras si no se pide
const miles = (n: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0, useGrouping: 'always' } as Intl.NumberFormatOptions).format(n)

export function fichaDeCita(p: {
  cita: CitaParaFicha
  lead: LeadParaFicha | null
  llamadas: LlamadaParaFicha[]
  notas: NotaParaFicha[]
  reuniones: ReunionParaFicha[]
  analisis: AnalisisParaFicha | null
  urlInforme?: string | null
}): FichaCliente {
  const { cita, lead } = p
  const datos: DatoFicha[] = []
  const poner = (etiqueta: string, v: unknown, max = 120) => {
    const t = limpio(v, max)
    if (t && !datos.some((d) => d.etiqueta === etiqueta)) datos.push({ etiqueta, valor: t })
  }
  const decisor = limpio(lead?.decisor, 60)
  poner('Contacto', decisor ? `${decisor}${lead?.cargo_decisor ? ` (${limpio(lead.cargo_decisor, 40)})` : ''}` : cita.lead_name)
  poner('Teléfono', cita.lead_phone)
  poner('Correo', cita.lead_email)
  poner('Razón social', cita.razon_social ?? lead?.company)
  poner('CIF', cita.cif)
  poner('Sector', cita.sector ?? [lead?.category, lead?.subcategory].filter(Boolean).join(' · '))
  poner('Ciudad', cita.ciudad ?? lead?.ciudad ?? lead?.province)
  const fact = numero(cita.revenue_amount) ?? numero(lead?.revenue_monthly)
  if (fact !== null && fact > 0) poner('Facturación', `${miles(fact)} €/mes`)
  const usd = numero(lead?.ventas_estimadas_usd)
  if (usd !== null && usd > 0) poner('Ventas estimadas', `${miles(usd)} $/mes (estimación)`)
  poner('Plataforma', cita.plataforma ?? lead?.plataforma)
  const prods = cita.n_productos ?? lead?.n_productos
  if (prods) poner('Productos', miles(prods))
  const anos = cita.anos_tienda ?? lead?.anos_tienda
  if (anos) poner('Años de tienda', String(anos))
  if (lead?.amazon_start) poner('En Amazon desde', lead.amazon_start)
  const rating = numero(lead?.rating)
  const resenas = numero(lead?.resenas)
  if (rating !== null) poner('Valoración', `${rating.toLocaleString('es-ES')} ★${resenas ? ` (${miles(resenas)} reseñas)` : ''}`)
  poner('Web', cita.web ?? lead?.web, 80)
  poner('Amazon', cita.amazon_link ?? lead?.seller_url, 80)
  poner('Instagram', lead?.instagram, 60)

  /* ---------- historial ---------- */
  const historial: HitoFicha[] = []
  for (const l of p.llamadas) {
    const t = limpio([l.resumen, l.siguiente_paso ? `Siguiente paso: ${l.siguiente_paso}` : null, l.interes ? `Interés: ${l.interes}` : null].filter(Boolean).join(' · '), 320)
    if (t) historial.push({ fecha: l.fecha.slice(0, 10), tipo: 'llamada', texto: t })
  }
  for (const n of p.notas) {
    const t = limpio(n.body, 260)
    if (t) historial.push({ fecha: n.occurred_at.slice(0, 10), tipo: 'nota', texto: t })
  }
  for (const r of p.reuniones) {
    const pasos = Array.isArray(r.proximos_pasos) ? (r.proximos_pasos as unknown[]).map((x) => limpio(typeof x === 'string' ? x : (x as { texto?: string })?.texto, 80)).filter(Boolean).join('; ') : null
    const t = limpio([r.resumen, pasos ? `Próximos pasos: ${pasos}` : null].filter(Boolean).join(' · '), 340)
    if (t) historial.push({ fecha: r.fecha.slice(0, 10), tipo: 'reunion', texto: t })
  }
  if (cita.transcription_summary) {
    const t = limpio(cita.transcription_summary, 340)
    if (t) historial.push({ fecha: cita.start_time.slice(0, 10), tipo: 'cita', texto: t })
  }
  historial.sort((a, b) => b.fecha.localeCompare(a.fecha))

  /* ---------- su cuenta de Amazon (análisis) ---------- */
  let amazon: FichaCliente['amazon'] = null
  const inf = p.analisis?.informe
  if (inf) {
    const cifras: DatoFicha[] = []
    const c = inf.cifras ?? {}
    const mon = inf.moneda === 'MXN' ? 'MXN' : '€'
    if (c.productos) cifras.push({ etiqueta: 'Productos', valor: miles(c.productos) })
    if (inf.ventas?.compras) cifras.push({ etiqueta: 'Compras/mes', valor: `+${miles(inf.ventas.compras)}` })
    if (inf.ventas?.importe) cifras.push({ etiqueta: 'Venta/mes', valor: `~${miles(inf.ventas.importe)} ${mon}` })
    if (typeof c.buyBox === 'number') cifras.push({ etiqueta: 'Buy Box', valor: `${Math.round(c.buyBox)} %` })
    if (typeof c.positivas12m === 'number') cifras.push({ etiqueta: 'Positivas 12 m', valor: `${Math.round(c.positivas12m)} %` })
    if (c.fba) cifras.push({ etiqueta: 'FBA', valor: c.fba === 'si' ? 'Sí' : c.fba === 'no' ? 'No' : 'Parcial' })
    if (c.mercadosActivos) cifras.push({ etiqueta: 'Países', valor: String(c.mercadosActivos) })
    amazon = {
      resumen: limpio(inf.resumen, 420) ?? limpio(inf.tipoTexto, 120),
      cifras,
      oportunidades: (inf.oportunidades ?? []).map((o) => limpio([o.titulo, o.cifra ? `(${o.cifra})` : null].filter(Boolean).join(' '), 120)).filter((x): x is string => !!x).slice(0, 5),
      fortalezas: (inf.fortalezas ?? []).map((o) => limpio([o.titulo, o.cifra ? `(${o.cifra})` : null].filter(Boolean).join(' '), 120)).filter((x): x is string => !!x).slice(0, 3),
      guion: (inf.guion?.frases ?? []).map((f) => limpio(f, 220)).filter((x): x is string => !!x).slice(0, 6),
      url: p.urlInforme ?? null,
    }
  }

  return {
    nombre: limpio(lead?.store_name, 80) ?? limpio(cita.lead_company, 80) ?? limpio(cita.lead_name, 80) ?? 'Cliente',
    empresa: limpio(cita.lead_company ?? lead?.company, 80),
    inicio: cita.start_time,
    fin: cita.end_time,
    comercial: limpio(cita.comercial?.full_name, 60),
    meet: cita.google_meet_link,
    // Sin comprobar en la cita, pero con su cuenta de Amazon analizada: vende (TOP CELULAR salía «sin comprobar» con 1 producto y 3 países)
    vendeEnAmazon: (cita.vende_en_amazon ?? 'sin_comprobar') === 'sin_comprobar' && amazon && (inf?.cifras?.productos ?? 0) > 0 ? 'si' : (cita.vende_en_amazon ?? 'sin_comprobar'),
    datos,
    historial: historial.slice(0, 8),
    amazon,
    notasDeLaCita: limpio(cita.notes, 600),
  }
}

/* ------------------------------------------------------------------ */
/* Un primer guion, sin IA                                             */
/* ------------------------------------------------------------------ */

/** Corta en el último espacio antes de `max` y pone «…» (no a media palabra) */
function hastaPalabra(t: string, max: number): string {
  if (t.length <= max) return t
  const corte = t.lastIndexOf(' ', max - 1)
  return `${t.slice(0, corte > max * 0.6 ? corte : max - 1).replace(/[\s.,;:·-]+$/, '')}…`
}

export function guionDeArranque(f: FichaCliente): { objetivo: string; puntos: string[]; preguntas: string[] } {
  const vende = f.vendeEnAmazon === 'si'
  const noVende = f.vendeEnAmazon === 'no'
  const objetivo = vende
    ? `Entender cómo le va en Amazon, enseñarle dónde está perdiendo ventas y acordar el siguiente paso con Liberty Seller.`
    : noVende
      ? `Ver si su producto tiene sitio en Amazon, qué haría falta para empezar y acordar el siguiente paso.`
      : `Saber si vende en Amazon y cómo, detectar dónde podemos ayudarle y acordar el siguiente paso.`
  const puntos: string[] = []
  if (f.historial[0]) puntos.push(`Retomar lo último: ${hastaPalabra(f.historial[0].texto, 150)}`)
  for (const o of f.amazon?.oportunidades.slice(0, 3) ?? []) puntos.push(o)
  for (const g of f.amazon?.guion.slice(0, 2) ?? []) if (puntos.length < 6) puntos.push(g)
  if (puntos.length < 3) {
    if (vende) puntos.push('Su situación en Amazon: ventas, Buy Box, stock y valoraciones')
    else puntos.push('Su negocio hoy: canales, productos estrella y volumen')
    puntos.push('Qué hacemos en Liberty Seller y cómo trabajamos (gestión integral, FBA, publicidad, fichas)')
  }
  puntos.push('Siguiente paso: propuesta, fecha y quién decide')
  const preguntas = vende
    ? [
        '¿Cuánto vendes al mes en Amazon y cuánto pesa sobre el total?',
        '¿Quién lleva hoy la cuenta y cuánto tiempo le dedica?',
        '¿Usas FBA o envías tú? ¿Has tenido roturas de stock?',
        '¿Haces publicidad en Amazon? ¿Con qué ACoS?',
        '¿Qué es lo que más te preocupa ahora mismo de Amazon?',
        '¿Quién decide y en qué plazo os planteáis empezar?',
      ]
    : [
        '¿Dónde vendes hoy y cuánto factura cada canal?',
        '¿Has probado Amazon alguna vez? ¿Qué pasó?',
        '¿Tienes marca registrada y stock para mandar a Amazon?',
        '¿Cuáles son tus 5 productos que más se venden?',
        '¿Qué objetivo tienes para los próximos 6–12 meses?',
        '¿Quién decide y en qué plazo os planteáis empezar?',
      ]
  return { objetivo, puntos: puntos.slice(0, 7), preguntas }
}

/* ------------------------------------------------------------------ */
/* Lo que se guarda                                                    */
/* ------------------------------------------------------------------ */

export const LIMITES_PREPARACION = { objetivo: 600, item: 300, items: 12, notas: 4000 } as const

export function limpiarPreparacion(cuerpo: unknown): { objetivo: string; puntos: string[]; preguntas: string[]; notas: string } | null {
  if (!cuerpo || typeof cuerpo !== 'object') return null
  const c = cuerpo as Record<string, unknown>
  const L = LIMITES_PREPARACION
  const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '')
  const lista = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .map((x) => texto(x, L.item).replace(/\s+/g, ' '))
      .filter(Boolean)
      .slice(0, L.items)
  return { objetivo: texto(c.objetivo, L.objetivo), puntos: lista(c.puntos), preguntas: lista(c.preguntas), notas: texto(c.notas, L.notas) }
}
