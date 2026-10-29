import { fechaDeRellamada, NOMBRE_DE_LISTA_SIN_ORIGEN } from '@/lib/cold-calling/cartera'
import { etiquetaDeVencimiento } from '@/lib/cold-calling/fechas'
import { hoyMadrid, sumarDias } from '@/lib/rendimiento/dia'
import { telefonoLegible } from '@/lib/rendimiento/telefonos'
import { ETIQUETA_DE_INTERES } from '@/lib/transcripcion/tipos'
import { COLD_NOTE_LABELS, COLD_STATUS_LABELS, COLD_STATUSES, type ColdLeadStatus, type ColdNoteKind } from '@/lib/types/cold-leads'
import { aTexto, entero, opcion, texto } from '../argumentos'
import type { ContextoMcp, Servicio } from '../contexto'
import { ErrorDeHerramienta, type Herramienta } from '../protocolo'
import {
  ajustarAlTamano,
  aMinutos,
  comprobar,
  datosDePagina,
  diaArg,
  elegirPersona,
  equipoComercial,
  fallo,
  fechaHora,
  fetchAll,
  instantesDe,
  normalizar,
  paginaArg,
  patronDeBusqueda,
  personasPorId,
  recortar,
  servicioDe,
  type Persona,
} from './comun'
import { leerTranscripciones, resultadoDeLlamada, type TranscripcionResumida } from './rendimiento'
import { secuenciasDeUnLead } from './secuencias'

/**
 * COLD CALLING PARA CLAUDE, PRIMERA PARTE: LOS LEADS (el embudo, buscar uno y su ficha entera).
 * SOLO SERVIDOR; lo puro (`armar…`, `tarjetaDeLead`) se prueba en leads.prueba.ts con una base en memoria.
 *
 * Lo que se cuenta aquí es lo que ve el equipo en la pantalla de Cold Calling, con sus mismas reglas (lib/cold-calling/cartera.ts):
 *   · un lead CERRADO («No le interesa») no tiene rellamada, aunque arrastre una fecha vieja;
 *   · «trabajados» son todos menos «Sin contactar»; «cualificados» (los que tienen una cita agendada);
 *   · «rellamadas para llamar» son las de hoy y las que se pasaron de fecha y siguen sin hacerse; «atrasadas», solo estas últimas;
 *   · el día de una rellamada es un día del calendario de Madrid.
 *
 * Los números de teléfono y los correos de los leads se devuelven tal cual: es un conector interno, solo para administradores (lib/mcp/auth.ts).
 */

/* ------------------------------------------------------------------ */
/* Los tipos                                                           */
/* ------------------------------------------------------------------ */

/** Lo mínimo de cada lead para contar el embudo (7.000 filas: se leen pocas columnas) */
export interface FilaDeCartera {
  assigned_to: string | null
  status: ColdLeadStatus
  source_list: string | null
  next_call_date: string | null
  last_contacted_at: string | null
  call_attempts: number | null
  tipo_lead: string | null
}

/** Un lead tal como se enseña en una lista */
export interface LeadLeido {
  id: string
  store_name: string
  company: string | null
  status: ColdLeadStatus
  assigned_to: string | null
  source_list: string | null
  tipo_lead: string | null
  ciudad: string | null
  province: string | null
  nivel: number | null
  revenue_monthly: number | string | null
  ventas_estimadas_usd: number | string | null
  call_attempts: number | null
  last_contacted_at: string | null
  next_call_date: string | null
  follow_up: string | null
  phone: string | null
  email: string | null
  decisor: string | null
  cargo_decisor: string | null
  web: string | null
}

/** Lo que se añade para la ficha entera */
export interface LeadCompleto extends LeadLeido {
  directors: string | null
  seller_url: string | null
  category: string | null
  subcategory: string | null
  business_address: string | null
  mercantile_registry: string | null
  amazon_start: string | null
  vende_en_amazon: string | null
  vende_en_amazon_comprobado_en: string | null
  plataforma: string | null
  n_productos: number | null
  anos_tienda: number | string | null
  instagram: string | null
  telefonos_extra: string | null
  emails_extra: string | null
  cif: string | null
  tipo_empresa: string | null
  n_administradores: number | null
  action_label: string | null
  created_at: string
  updated_at: string
}

const CAMPOS_DE_CARTERA = 'assigned_to, status, source_list, next_call_date, last_contacted_at, call_attempts, tipo_lead'

const CAMPOS_DE_LEAD =
  'id, store_name, company, status, assigned_to, source_list, tipo_lead, ciudad, province, nivel, revenue_monthly, ventas_estimadas_usd, call_attempts, last_contacted_at, next_call_date, follow_up, phone, email, decisor, cargo_decisor, web'

const CAMPOS_DE_FICHA = `${CAMPOS_DE_LEAD}, directors, seller_url, category, subcategory, business_address, mercantile_registry, amazon_start, vende_en_amazon, vende_en_amazon_comprobado_en, plataforma, n_productos, anos_tienda, instagram, telefonos_extra, emails_extra, cif, tipo_empresa, n_administradores, action_label, created_at, updated_at`

/* ------------------------------------------------------------------ */
/* Pequeñas ayudas                                                     */
/* ------------------------------------------------------------------ */

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export const etiquetaDeEstado = (s: string): string => COLD_STATUS_LABELS[s as ColdLeadStatus] ?? s
export const etiquetaDeCanal = (k: string): string => COLD_NOTE_LABELS[k as ColdNoteKind] ?? k

const SIN_ASIGNAR = 'Sin asignar'

/** El nombre de quien lleva un lead. Alguien que ya no existe en perfiles no se confunde con «sin asignar» */
export function duenoDe(asignado: string | null, personas: ReadonlyMap<string, Persona>): string {
  if (!asignado) return SIN_ASIGNAR
  return personas.get(asignado)?.nombre ?? 'Alguien que ya no está'
}

/** El estado pedido, por su clave («no_contesta») o por su nombre en pantalla («No contesta»). Un estado desconocido es un error con la lista. La clave de «Cita agendada» sigue siendo `cita_cualificada`, así que el nombre de antes («cita cualificada») también se entiende */
export function estadoArg(args: Record<string, unknown>): ColdLeadStatus | undefined {
  const v = texto(args, 'estado', { max: 40 })
  if (v === undefined) return undefined
  const q = normalizar(v).replace(/\s+/g, '_')
  for (const s of COLD_STATUSES) {
    if (s === q || normalizar(COLD_STATUS_LABELS[s]).replace(/\s+/g, '_') === q) return s
  }
  throw new ErrorDeHerramienta(`«estado» tiene que ser uno de: ${COLD_STATUSES.map((s) => `${s} (${COLD_STATUS_LABELS[s]})`).join(', ')}.`)
}

const ESQUEMA_ESTADO = {
  type: 'string',
  enum: [...COLD_STATUSES],
  description: 'Estado del lead: pendiente = Sin contactar · no_contesta = No contesta · programado = Rellamada programada · email_enviado = Info enviada · seguimiento = En seguimiento · cita_cualificada = Cita agendada · no_interesa = No le interesa.',
}
const ESQUEMA_COMERCIAL = { type: 'string', description: 'El comercial al que está asignado el lead: su nombre (o parte), su correo o su id. rendimiento_equipo los lista.' }
const ESQUEMA_LISTA = { type: 'string', description: 'La lista de origen del lead, tal como sale en cold_resumen (por_lista), por ejemplo «1a lista» o «No Amazon V1». Distingue mayúsculas de acentos: cópiala tal cual.' }

/* ------------------------------------------------------------------ */
/* La tarjeta de un lead                                               */
/* ------------------------------------------------------------------ */

export function tarjetaDeLead(l: LeadLeido, personas: ReadonlyMap<string, Persona>, hoy: string): Record<string, unknown> {
  const rellamada = fechaDeRellamada(l)
  const tienda = l.tipo_lead === 'tienda_online'
  const partner = l.tipo_lead === 'partner'
  return {
    id: l.id,
    tienda: l.store_name,
    empresa: l.company && l.company !== l.store_name ? l.company : null,
    estado: etiquetaDeEstado(l.status),
    comercial: duenoDe(l.assigned_to, personas),
    lista: l.source_list || NOMBRE_DE_LISTA_SIN_ORIGEN,
    tipo: partner ? 'partner (posible socio: agencia, gestoría, fulfillment, registro de marcas)' : tienda ? 'tienda online' : 'vendedor de Amazon',
    ciudad: l.ciudad || l.province || null,
    nivel: l.nivel,
    facturacion_mensual_eur: tienda ? null : num(l.revenue_monthly),
    ventas_estimadas_usd: tienda ? num(l.ventas_estimadas_usd) : null,
    intentos_de_llamada: l.call_attempts ?? 0,
    ultimo_contacto: fechaHora(l.last_contacted_at),
    rellamar_el: rellamada,
    rellamada: rellamada ? etiquetaDeVencimiento(rellamada, hoy) || null : null,
    seguimiento: recortar(l.follow_up, 240),
    decisor: l.decisor ? (l.cargo_decisor ? `${l.decisor} (${l.cargo_decisor})` : l.decisor) : null,
    telefono: l.phone,
    email: l.email,
    web: l.web,
  }
}

/* ------------------------------------------------------------------ */
/* El embudo                                                           */
/* ------------------------------------------------------------------ */

export const MAX_LISTAS_EN_EL_RESUMEN = 25

function contarEstados(filas: readonly FilaDeCartera[]): Record<string, number> {
  const por = new Map<string, number>(COLD_STATUSES.map((s) => [s, 0]))
  for (const f of filas) por.set(f.status, (por.get(f.status) ?? 0) + 1)
  return Object.fromEntries([...por.entries()].map(([s, n]) => [etiquetaDeEstado(s), n]))
}

/** Los números de un grupo de leads, con las reglas de la pantalla de Cold Calling */
export function cifrasDeCartera(filas: readonly FilaDeCartera[], hoy: string) {
  let trabajados = 0
  let cualificados = 0
  let paraLlamar = 0
  let atrasadas = 0
  let deHoy = 0
  let enSemana = 0
  const dentroDe7 = sumarDias(hoy, 7)
  let ultimo: string | null = null
  for (const f of filas) {
    if (f.status !== 'pendiente') trabajados += 1
    if (f.status === 'cita_cualificada') cualificados += 1
    const dia = fechaDeRellamada(f)
    if (dia) {
      if (dia <= hoy) paraLlamar += 1
      if (dia < hoy) atrasadas += 1
      if (dia === hoy) deHoy += 1
      if (dia > hoy && dia <= dentroDe7) enSemana += 1
    }
    if (f.last_contacted_at && (ultimo === null || Date.parse(f.last_contacted_at) > Date.parse(ultimo))) ultimo = f.last_contacted_at
  }
  return {
    leads: filas.length,
    trabajados,
    sin_contactar: filas.length - trabajados,
    cualificados,
    cualificados_sobre_trabajados_pct: trabajados > 0 ? Math.round((cualificados / trabajados) * 100) : null,
    rellamadas_para_llamar: paraLlamar,
    de_ellas_atrasadas: atrasadas,
    rellamadas_de_hoy: deHoy,
    rellamadas_proximos_7_dias: enSemana,
    ultimo_contacto: fechaHora(ultimo),
  }
}

export interface EntradaDelResumen {
  hoy: string
  filas: readonly FilaDeCartera[]
  personas: ReadonlyMap<string, Persona>
  filtro: { comercial: string | null; lista: string | null }
}

export function armarResumenDeCartera(e: EntradaDelResumen): Record<string, unknown> {
  const { hoy, filas, personas } = e
  const porDueno = new Map<string, FilaDeCartera[]>()
  for (const f of filas) {
    const k = f.assigned_to ?? ''
    const a = porDueno.get(k)
    if (a) a.push(f)
    else porDueno.set(k, [f])
  }
  const comerciales = [...porDueno.entries()]
    .map(([id, lista]) => ({
      comercial: duenoDe(id || null, personas),
      id: id || null,
      ...cifrasDeCartera(lista, hoy),
      por_estado: contarEstados(lista),
      intentos_de_llamada_en_total: lista.reduce((suma, f) => suma + (f.call_attempts ?? 0), 0),
    }))
    .sort((a, b) => b.leads - a.leads || a.comercial.localeCompare(b.comercial, 'es'))

  const porLista = new Map<string, FilaDeCartera[]>()
  for (const f of filas) {
    const k = f.source_list || NOMBRE_DE_LISTA_SIN_ORIGEN
    const a = porLista.get(k)
    if (a) a.push(f)
    else porLista.set(k, [f])
  }
  const listas = [...porLista.entries()]
    .map(([lista, grupo]) => {
      const c = cifrasDeCartera(grupo, hoy)
      return { lista, leads: c.leads, trabajados: c.trabajados, sin_contactar: c.sin_contactar, cualificados: c.cualificados }
    })
    .sort((a, b) => b.leads - a.leads || a.lista.localeCompare(b.lista, 'es'))

  const tiendas = filas.filter((f) => f.tipo_lead === 'tienda_online').length
  const partners = filas.filter((f) => f.tipo_lead === 'partner').length

  return {
    dia: hoy,
    filtro: e.filtro,
    cartera: cifrasDeCartera(filas, hoy),
    por_estado: contarEstados(filas),
    por_tipo: { vendedores_de_amazon: filas.length - tiendas - partners, tiendas_online: tiendas, partners },
    por_comercial: comerciales,
    por_lista: listas.slice(0, MAX_LISTAS_EN_EL_RESUMEN),
    listas_no_mostradas: Math.max(0, listas.length - MAX_LISTAS_EN_EL_RESUMEN),
    reglas: [
      'Un lead cerrado («No le interesa») no tiene rellamada, aunque conserve una fecha vieja.',
      'trabajados = todos los leads menos «Sin contactar»; cualificados = los que tienen una cita agendada (después el manager la marca como cualificada o no).',
      'rellamadas_para_llamar = las de hoy y las atrasadas que siguen sin hacerse; los días son los de Madrid.',
    ],
  }
}

/* ------------------------------------------------------------------ */
/* Resolver a qué lead se refiere el texto                             */
/* ------------------------------------------------------------------ */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface LeadBasico {
  id: string
  store_name: string
  company: string | null
  assigned_to: string | null
}

/** Los leads cuyo nombre, empresa, correo o teléfono contiene el texto (los más recientes primero) */
export async function buscarLeadsPorTexto(s: Servicio, consulta: string, tope: number): Promise<LeadBasico[]> {
  const p = patronDeBusqueda(consulta)
  const { data } = comprobar(
    await s
      .from('cold_leads')
      .select('id, store_name, company, assigned_to')
      .or(`store_name.ilike.${p},company.ilike.${p},email.ilike.${p},phone.ilike.${p},web.ilike.${p}`)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .limit(tope),
    'cold_leads'
  )
  return (data ?? []) as LeadBasico[]
}

async function candidatos(s: Servicio, lista: readonly LeadBasico[]): Promise<string> {
  const personas = await personasPorId(s, lista.map((l) => l.assigned_to).filter((x): x is string => !!x))
  return lista.map((l) => `${l.store_name}${l.company && l.company !== l.store_name ? ` (${l.company})` : ''} · ${duenoDe(l.assigned_to, personas)} · id ${l.id}`).join('\n')
}

/** UN lead por su id o por su nombre. Si el nombre vale para varios, el error los lista con su id para acertar a la segunda */
export async function leadUnico(s: Servicio, valor: string): Promise<string> {
  const v = valor.trim()
  if (UUID.test(v)) return v.toLowerCase()
  const encontrados = await buscarLeadsPorTexto(s, v, 8)
  if (encontrados.length === 0) throw new ErrorDeHerramienta(`No hay ningún lead que contenga «${valor}» en su nombre, empresa, correo, teléfono o web. Prueba con menos palabras.`)
  if (encontrados.length > 1) {
    const exactos = encontrados.filter((l) => normalizar(l.store_name) === normalizar(v) || normalizar(l.company ?? '') === normalizar(v))
    if (exactos.length === 1) return exactos[0].id
    throw new ErrorDeHerramienta(`«${valor}» puede ser varios leads. Pide el que toca por su id:\n${await candidatos(s, encontrados)}`)
  }
  return encontrados[0].id
}

export const MAX_LEADS_POR_NOMBRE = 25

/** Los ids de los leads a los que se refiere el texto (un id, o todos los que lo contienen, hasta MAX_LEADS_POR_NOMBRE): para filtrar listas */
export async function leadsDeFiltro(s: Servicio, valor: string): Promise<string[]> {
  const v = valor.trim()
  if (UUID.test(v)) return [v.toLowerCase()]
  const encontrados = await buscarLeadsPorTexto(s, v, MAX_LEADS_POR_NOMBRE + 1)
  if (encontrados.length === 0) throw new ErrorDeHerramienta(`No hay ningún lead que contenga «${valor}» en su nombre, empresa, correo, teléfono o web.`)
  if (encontrados.length > MAX_LEADS_POR_NOMBRE) throw new ErrorDeHerramienta(`«${valor}» sale en más de ${MAX_LEADS_POR_NOMBRE} leads: es demasiado general. Escribe más del nombre o usa el id.`)
  return encontrados.map((l) => l.id)
}

/** El comercial pedido en `comercial`, o null si no se pidió */
export async function comercialArg(s: Servicio, args: Record<string, unknown>): Promise<Persona | null> {
  const q = texto(args, 'comercial', { max: 120 })
  if (!q) return null
  return elegirPersona(await equipoComercial(s), q)
}

/* ------------------------------------------------------------------ */
/* cold_resumen                                                        */
/* ------------------------------------------------------------------ */

export const coldResumen: Herramienta<ContextoMcp> = {
  nombre: 'cold_resumen',
  titulo: 'Cold Calling: el embudo de leads',
  descripcion:
    'El estado de la cartera de Cold Calling (los leads a los que se llama en frío): cuántos hay en cada estado (sin contactar, no contesta, rellamada programada, info enviada, en seguimiento, cita agendada, ' +
    'no le interesa), cuántos se han trabajado y cuántos están cualificados, cuántas rellamadas hay para hoy y cuántas atrasadas, y todo eso desglosado por comercial y por lista de origen, con el último contacto de ' +
    'cada uno. Es la herramienta para «cómo va el proceso de ventas» y para encontrar rellamadas que se están cayendo. Se puede acotar a un comercial o a una lista. Para ver los leads en concreto usa ' +
    'cold_buscar_leads; para uno entero, cold_ficha_lead.',
  esquema: { type: 'object', properties: { comercial: ESQUEMA_COMERCIAL, lista: ESQUEMA_LISTA }, additionalProperties: false },
  soloLectura: true,
  async ejecutar(args, ctx) {
    const s = servicioDe(ctx)
    const hoy = hoyMadrid()
    const persona = await comercialArg(s, args)
    const lista = texto(args, 'lista', { max: 120 }) ?? null
    const filas = await fetchAll<FilaDeCartera>((de, a) => {
      let q = s.from('cold_leads').select(CAMPOS_DE_CARTERA)
      if (persona) q = q.eq('assigned_to', persona.id)
      if (lista) q = q.eq('source_list', lista)
      return q.order('id', { ascending: true }).range(de, a)
    }).catch((e) => fallo(e, 'cold_leads'))
    const personas = await personasPorId(s, filas.map((f) => f.assigned_to).filter((x): x is string => !!x))
    const salida = armarResumenDeCartera({ hoy, filas, personas, filtro: { comercial: persona?.nombre ?? null, lista } })
    if (filas.length === 0 && lista) salida.aviso = `No hay ningún lead en la lista «${lista}». Sin ese filtro, cold_resumen enseña las listas que existen.`
    return { texto: aTexto(salida, 30_000) }
  },
}

/* ------------------------------------------------------------------ */
/* cold_buscar_leads                                                   */
/* ------------------------------------------------------------------ */

const RELLAMADAS = ['vencidas', 'hoy', 'hasta_hoy', 'proximos_7_dias', 'con_fecha'] as const
const ORDENES = ['actualizado', 'ultimo_contacto', 'rellamada', 'nombre'] as const

export const coldBuscarLeads: Herramienta<ContextoMcp> = {
  nombre: 'cold_buscar_leads',
  titulo: 'Cold Calling: buscar leads',
  descripcion:
    'Busca y lista leads de Cold Calling con filtros: texto (nombre de la tienda, empresa, correo, teléfono o web), estado, comercial, lista de origen, rellamadas (vencidas, de hoy, de la semana…), día del último ' +
    'contacto, nivel y tipo de lead. Devuelve por cada lead su estado, quién lo lleva, intentos de llamada, último contacto, cuándo hay que rellamar, el texto de seguimiento, teléfono, correo y decisor, con el ' +
    'total que cumple el filtro y paginación. Para el historial, las llamadas y la transcripción de uno concreto usa cold_ficha_lead.',
  esquema: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Parte del nombre de la tienda, de la empresa, del correo, del teléfono o de la web.' },
      estado: ESQUEMA_ESTADO,
      comercial: ESQUEMA_COMERCIAL,
      lista: ESQUEMA_LISTA,
      rellamada: {
        type: 'string',
        enum: [...RELLAMADAS],
        description: 'Solo los que tienen rellamada: vencidas = fecha pasada y sin hacer · hoy · hasta_hoy = hoy y las vencidas (las que hay que llamar ya) · proximos_7_dias · con_fecha = cualquiera. Los leads cerrados («No le interesa») no cuentan.',
      },
      contactado_desde: { type: 'string', description: 'Último contacto desde este día (AAAA-MM-DD, «hoy» o «ayer»).' },
      contactado_hasta: { type: 'string', description: 'Último contacto hasta este día, incluido.' },
      nivel: { type: 'integer', description: '1, 2 o 3 (potencial de la tienda; 1 es el más alto). Solo lo tienen las tiendas online.' },
      tipo: { type: 'string', enum: ['seller_amazon', 'tienda_online', 'partner'], description: 'Vendedor que ya está en Amazon, tienda online que todavía no, o partner (posible socio: agencia de desarrollo ecommerce, fulfillment, registro de marcas, gestoría; no es un cliente).' },
      orden: { type: 'string', enum: [...ORDENES], description: 'actualizado (lo último que se ha tocado, por defecto) · ultimo_contacto · rellamada (la más próxima primero) · nombre.' },
      limite: { type: 'integer', description: 'Leads por página. Por defecto 20, hasta 50.' },
      pagina: { type: 'integer', description: 'Empieza en 0. La respuesta dice cuál es la siguiente.' },
    },
    additionalProperties: false,
  },
  soloLectura: true,
  async ejecutar(args, ctx) {
    const s = servicioDe(ctx)
    const hoy = hoyMadrid()
    const p = paginaArg(args, { limite: 20, max: 50 })
    const persona = await comercialArg(s, args)
    const estado = estadoArg(args)
    const busqueda = texto(args, 'texto', { max: 120 })
    const lista = texto(args, 'lista', { max: 120 })
    const rellamada = opcion<(typeof RELLAMADAS)[number] | ''>(args, 'rellamada', ['', ...RELLAMADAS], '')
    const nivel = args.nivel === undefined || args.nivel === null || args.nivel === '' ? undefined : entero(args, 'nivel', { min: 1, max: 3, defecto: 1 })
    const tipo = opcion<'' | 'seller_amazon' | 'tienda_online' | 'partner'>(args, 'tipo', ['', 'seller_amazon', 'tienda_online', 'partner'], '')
    const orden = opcion<(typeof ORDENES)[number]>(args, 'orden', ORDENES, 'actualizado')
    const desdeContacto = texto(args, 'contactado_desde', { max: 10 })
    const hastaContacto = texto(args, 'contactado_hasta', { max: 10 })
    const dDesde = desdeContacto ? diaArg({ d: desdeContacto }, 'd', { hoy }) : undefined
    const dHasta = hastaContacto ? diaArg({ d: hastaContacto }, 'd', { hoy }) : undefined
    if (dDesde && dHasta && dDesde > dHasta) throw new ErrorDeHerramienta(`«contactado_desde» (${dDesde}) no puede ser posterior a «contactado_hasta» (${dHasta}).`)

    let q = s.from('cold_leads').select(CAMPOS_DE_LEAD, { count: 'exact' })
    if (persona) q = q.eq('assigned_to', persona.id)
    if (estado) q = q.eq('status', estado)
    if (lista) q = q.eq('source_list', lista)
    if (nivel !== undefined) q = q.eq('nivel', nivel)
    if (tipo) q = q.eq('tipo_lead', tipo)
    if (busqueda) {
      const pat = patronDeBusqueda(busqueda)
      q = q.or(`store_name.ilike.${pat},company.ilike.${pat},email.ilike.${pat},phone.ilike.${pat},web.ilike.${pat}`)
    }
    if (rellamada) {
      q = q.neq('status', 'no_interesa')
      if (rellamada === 'vencidas') q = q.lt('next_call_date', hoy)
      else if (rellamada === 'hoy') q = q.eq('next_call_date', hoy)
      else if (rellamada === 'hasta_hoy') q = q.lte('next_call_date', hoy)
      else if (rellamada === 'proximos_7_dias') q = q.gt('next_call_date', hoy).lte('next_call_date', sumarDias(hoy, 7))
      else q = q.not('next_call_date', 'is', null)
    }
    if (dDesde) q = q.gte('last_contacted_at', instantesDe({ desde: dDesde, hasta: dDesde }).desde)
    if (dHasta) q = q.lt('last_contacted_at', instantesDe({ desde: dHasta, hasta: dHasta }).hasta)

    if (orden === 'nombre') q = q.order('store_name', { ascending: true })
    else if (orden === 'rellamada') q = q.order('next_call_date', { ascending: true, nullsFirst: false })
    else if (orden === 'ultimo_contacto') q = q.order('last_contacted_at', { ascending: false, nullsFirst: false })
    else q = q.order('updated_at', { ascending: false })
    q = q.order('id', { ascending: true }).range(p.desde, p.hasta)

    const { data, count } = comprobar(await q, 'cold_leads')
    const leads = (data ?? []) as LeadLeido[]
    const personas = await personasPorId(s, leads.map((l) => l.assigned_to).filter((x): x is string => !!x))
    const total = count ?? leads.length
    const salida: Record<string, unknown> = {
      dia: hoy,
      filtro: { texto: busqueda ?? null, estado: estado ? etiquetaDeEstado(estado) : null, comercial: persona?.nombre ?? null, lista: lista ?? null, rellamada: rellamada || null, nivel: nivel ?? null, tipo: tipo || null },
      ...datosDePagina(p, total, leads.length),
      leads: leads.map((l) => tarjetaDeLead(l, personas, hoy)),
    }
    if (total === 0 && lista) salida.aviso = `Ningún lead cumple el filtro. Si «${lista}» no se escribe exactamente como sale en cold_resumen, no lo encuentra: cópiala de ahí.`
    return { texto: aTexto(ajustarAlTamano(salida, 'leads', 27_000), 30_000) }
  },
}

/* ------------------------------------------------------------------ */
/* La ficha entera                                                     */
/* ------------------------------------------------------------------ */

export interface ApunteLeido {
  id: string
  author_id: string | null
  kind: string
  es_respuesta: boolean | null
  body: string | null
  occurred_at: string
}

export interface LlamadaDeFicha {
  id: string
  user_id: string
  lead_id: string | null
  fecha: string
  direccion: string
  estado: string
  duracion_s: number
  numero: string | null
  numero_anonimo: boolean
  grabacion_id: string | null
  grabacion_hasta: string | null
}

export interface CitaDeFicha {
  id: string
  comercial_id: string | null
  lead_name: string
  lead_company: string | null
  start_time: string
  status: string
  created_at: string
  lead_ref_id: string | null
}

/** Una llamada con lo que se entendió de ella: lo que comparten la ficha del lead y la lista de llamadas */
export function llamadaParaClaude(l: LlamadaDeFicha, e: { comercial: string; cliente: string | null; transcripcion: TranscripcionResumida | undefined; ahora: number }): Record<string, unknown> {
  const t = e.transcripcion
  const caducada = l.grabacion_hasta ? Date.parse(l.grabacion_hasta) < e.ahora : false
  return {
    llamada_id: l.id,
    cuando: fechaHora(l.fecha),
    comercial: e.comercial,
    sentido: l.direccion === 'inbound' ? 'recibida' : 'saliente',
    cliente: e.cliente ?? (l.numero ? telefonoLegible(l.numero) : 'número oculto'),
    minutos: aMinutos(l.duracion_s),
    resultado: resultadoDeLlamada(l),
    grabacion: l.grabacion_id ? (caducada ? 'caducada (Rinkel las guarda 90 días)' : 'sí') : 'no',
    transcripcion: t
      ? t.estado === 'hecha'
        ? { estado: 'hecha', tipo: t.tipo, interes: t.interes ? (ETIQUETA_DE_INTERES[t.interes as keyof typeof ETIQUETA_DE_INTERES] ?? t.interes) : null, resumen: recortar(t.resumen, 320), siguiente_paso: recortar(t.siguiente_paso, 200) }
        : { estado: t.estado }
      : null,
  }
}

export const coldFichaLead: Herramienta<ContextoMcp> = {
  nombre: 'cold_ficha_lead',
  titulo: 'Cold Calling: la ficha entera de un lead',
  descripcion:
    'Todo lo que hay de UN lead de Cold Calling: sus datos (estado, quién lo lleva, lista, facturación, decisor, teléfonos, correos, web, CIF…), su historial de apuntes (llamadas, correos, WhatsApp, LinkedIn y ' +
    'notas, con lo que dijo el cliente), sus llamadas de Rinkel con lo que se entendió de cada una, las citas que se le han agendado y las secuencias de correo de seguimiento que se le han lanzado con el estado de ' +
    'cada correo. El lead se pide por su id o por parte de su nombre, empresa, correo o teléfono; si el nombre vale para varios, la respuesta los lista con su id. Para leer una llamada entera usa cold_transcripcion.',
  esquema: {
    type: 'object',
    properties: {
      lead: { type: 'string', description: 'El id del lead, o parte de su nombre, empresa, correo, teléfono o web.' },
      max_apuntes: { type: 'integer', description: 'Cuántos apuntes del historial devolver, los más recientes. Por defecto 30, hasta 100.' },
      max_llamadas: { type: 'integer', description: 'Cuántas llamadas devolver, las más recientes. Por defecto 15, hasta 50.' },
    },
    required: ['lead'],
    additionalProperties: false,
  },
  soloLectura: true,
  async ejecutar(args, ctx) {
    const s = servicioDe(ctx)
    const hoy = hoyMadrid()
    const ahora = Date.now()
    const consulta = texto(args, 'lead', { requerido: true, max: 120 })!
    const maxApuntes = entero(args, 'max_apuntes', { min: 1, max: 100, defecto: 30 })
    const maxLlamadas = entero(args, 'max_llamadas', { min: 1, max: 50, defecto: 15 })
    const id = await leadUnico(s, consulta)

    const { data: fila } = comprobar(await s.from('cold_leads').select(CAMPOS_DE_FICHA).eq('id', id).maybeSingle(), 'cold_leads')
    const lead = fila as LeadCompleto | null
    if (!lead) throw new ErrorDeHerramienta('No existe ningún lead con ese id.')

    const nombre = patronDeBusqueda(lead.store_name)
    const [apuntes, llamadas, citas] = await Promise.all([
      s.from('cold_lead_notes').select('id, author_id, kind, es_respuesta, body, occurred_at', { count: 'exact' }).eq('lead_id', id).order('occurred_at', { ascending: false }).order('id', { ascending: true }).limit(maxApuntes),
      s.from('rinkel_llamadas').select('id, user_id, lead_id, fecha, direccion, estado, duracion_s, numero, numero_anonimo, grabacion_id, grabacion_hasta', { count: 'exact' }).eq('lead_id', id).order('fecha', { ascending: false }).order('id', { ascending: true }).limit(maxLlamadas),
      s.from('appointments').select('id, comercial_id, lead_name, lead_company, start_time, status, created_at, lead_ref_id').eq('is_external', false).or(`lead_ref_id.eq.${id},lead_name.ilike.${nombre}`).order('start_time', { ascending: false }).limit(6),
    ])
    comprobar(apuntes, 'cold_lead_notes')
    const llamadasLeidas = comprobar(llamadas, 'rinkel_llamadas')
    comprobar(citas, 'appointments')

    const listaApuntes = (apuntes.data ?? []) as ApunteLeido[]
    const listaLlamadas = (llamadasLeidas.data ?? []) as LlamadaDeFicha[]
    const listaCitas = (citas.data ?? []) as CitaDeFicha[]

    const [personas, transcripciones, secuencias] = await Promise.all([
      personasPorId(s, [lead.assigned_to, ...listaApuntes.map((a) => a.author_id), ...listaLlamadas.map((l) => l.user_id), ...listaCitas.map((c) => c.comercial_id)].filter((x): x is string => !!x)),
      leerTranscripciones(s, listaLlamadas.map((l) => l.id)),
      secuenciasDeUnLead(s, ctx, id),
    ])

    const tarjeta = tarjetaDeLead(lead, personas, hoy)
    const salida = {
      lead: {
        ...tarjeta,
        seguimiento: recortar(lead.follow_up, 1000),
        directores: lead.directors,
        administradores_del_borme: lead.n_administradores,
        cif: lead.cif,
        tipo_de_empresa: lead.tipo_empresa,
        direccion: lead.business_address,
        registro_mercantil: lead.mercantile_registry,
        categoria: [lead.category, lead.subcategory].filter(Boolean).join(' · ') || null,
        vende_en_amazon: lead.vende_en_amazon,
        vende_en_amazon_comprobado: fechaHora(lead.vende_en_amazon_comprobado_en),
        vende_desde: lead.amazon_start,
        url_del_vendedor: lead.seller_url,
        plataforma: lead.plataforma,
        productos: lead.n_productos,
        anos_de_la_tienda: num(lead.anos_tienda),
        instagram: lead.instagram,
        telefonos_extra: lead.telefonos_extra,
        emails_extra: lead.emails_extra,
        creado: fechaHora(lead.created_at),
        actualizado: fechaHora(lead.updated_at),
      },
      historial: {
        total: apuntes.count ?? listaApuntes.length,
        mostrados: listaApuntes.length,
        apuntes: listaApuntes.map((a) => ({
          cuando: fechaHora(a.occurred_at),
          canal: etiquetaDeCanal(a.kind),
          autor: a.author_id ? (personas.get(a.author_id)?.nombre ?? 'Alguien que ya no está') : null,
          respuesta_del_cliente: a.es_respuesta === true,
          texto: recortar(a.body, 700),
        })),
      },
      llamadas: {
        total: llamadas.count ?? listaLlamadas.length,
        mostradas: listaLlamadas.length,
        ultimas: listaLlamadas.map((l) => llamadaParaClaude(l, { comercial: personas.get(l.user_id)?.nombre ?? 'Alguien que ya no está', cliente: lead.store_name, transcripcion: transcripciones.get(l.id), ahora })),
      },
      citas: listaCitas.map((c) => ({
        reunion: fechaHora(c.start_time),
        estado: c.status,
        agendada_por: c.comercial_id ? (personas.get(c.comercial_id)?.nombre ?? null) : null,
        agendada: fechaHora(c.created_at),
        enlazada_al_lead: c.lead_ref_id === id ? 'sí' : 'solo por el nombre (puede no ser el mismo)',
        cliente: c.lead_company && c.lead_company !== c.lead_name ? `${c.lead_name} (${c.lead_company})` : c.lead_name,
      })),
      secuencias_de_correo: secuencias,
    }
    return { texto: aTexto(salida, 32_000) }
  },
}

export const HERRAMIENTAS_DE_LEADS: readonly Herramienta<ContextoMcp>[] = [coldResumen, coldBuscarLeads, coldFichaLead]
