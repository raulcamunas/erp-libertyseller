import { COLD_STATUSES, type ColdLeadStatus, type ColdLeadTipo, type ColdVendeAmazon } from '@/lib/types/cold-leads'

/**
 * LAS LISTAS DE LEADS DE COLD CALLING: LO QUE COMPARTEN LA PANTALLA Y EL SERVIDOR — PURO.
 * ========================================================================================
 * No toca la base ni la red. Se comprueba con listas.prueba.ts. Lo que habla con la base está en listas-servidor.ts; lo que se pinta, en components/cold-calling/listas.
 *
 * UNA LISTA SIGUE SIENDO EL TEXTO `cold_leads.source_list` (migración 257: hay además un registro con el nombre, el responsable y si está archivada). Se agrupa por el
 * nombre SIN MIRAR mayúsculas NI ESPACIOS de los lados —igual que la base—, así que «maoli v1» y «Maoli V1» son la misma lista.
 */

export const NOMBRE_SIN_LISTA = 'Sin lista'
/** Los dos valores especiales de los filtros: los leads sin lista y los leads sin dueño. No pueden ser el nombre de una lista ni un id */
export const SIN_LISTA = '__sin_lista__'
export const SIN_DUENO = '__sin_dueno__'

export const MAXIMO_POR_OPERACION = 10_000
export const MAXIMO_DEL_BANCO_POR_OPERACION = 3_000

/** La clave con la que se comparan los nombres de lista: la misma que usa la base (lower + btrim) */
export const claveDeLista = (nombre: string | null | undefined): string => (nombre ?? '').trim().toLowerCase()

/** El nombre como se guarda: sin espacios de los lados y con los dobles reducidos. null si queda vacío */
export function limpiarNombreDeLista(nombre: unknown): string | null {
  if (typeof nombre !== 'string') return null
  const limpio = nombre.replace(/\s+/g, ' ').trim()
  return limpio === '' ? null : limpio
}

/* ------------------------------------------------------------------ */
/* El resumen de las listas                                            */
/* ------------------------------------------------------------------ */

/** Una fila de cold_listas_resumen(): una lista, un dueño y un tipo */
export interface FilaDeResumen {
  lista: string | null
  dueno: string | null
  tipo_lead: ColdLeadTipo
  total: number
  pendiente: number
  no_contesta: number
  programado: number
  email_enviado: number
  seguimiento: number
  cita_cualificada: number
  no_interesa: number
  vende: number
  no_vende: number
  sin_comprobar: number
  llamados: number
  intentos: number
  ultimo_contacto: string | null
}

/** Una fila de cold_lead_lists */
export interface ListaRegistrada {
  id: string
  nombre: string
  descripcion: string | null
  responsable: string | null
  archivada: boolean
  creada_por?: string | null
  created_at?: string
}

export type TipoDeLista = ColdLeadTipo | 'mixto'

export interface ResumenDeLista {
  /** claveDeLista(nombre), o SIN_LISTA */
  clave: string
  nombre: string
  /** El id del registro. null si la lista no está registrada (la tienen leads pero nadie la ha creado) o es «Sin lista» */
  id: string | null
  registrada: boolean
  archivada: boolean
  descripcion: string | null
  /** A quién está asignada la lista (el registro), no a quién pertenecen sus leads: eso es `duenos` */
  responsable: string | null
  total: number
  estados: Record<ColdLeadStatus, number>
  porTipo: Record<ColdLeadTipo, number>
  vende: Record<ColdVendeAmazon, number>
  llamados: number
  intentos: number
  ultimoContacto: number | null
  /** De quién son los leads, de más a menos. El id null son los que no tienen dueño */
  duenos: Array<{ id: string | null; n: number }>
  /** Los que ya se han tocado: cualquier estado menos «Sin contactar» */
  trabajados: number
  /** 0 a 1 */
  pctTrabajados: number
  /** Los que han tenido al menos un intento de llamada. 0 a 1 */
  pctLlamados: number
  tipo: TipoDeLista | null
}

const estadosVacios = (): Record<ColdLeadStatus, number> => Object.fromEntries(COLD_STATUSES.map((e) => [e, 0])) as Record<ColdLeadStatus, number>

function resumenVacio(clave: string, nombre: string): ResumenDeLista {
  return {
    clave,
    nombre,
    id: null,
    registrada: false,
    archivada: false,
    descripcion: null,
    responsable: null,
    total: 0,
    estados: estadosVacios(),
    porTipo: { seller_amazon: 0, tienda_online: 0, partner: 0 },
    vende: { sin_comprobar: 0, no_vende: 0, vende: 0 },
    llamados: 0,
    intentos: 0,
    ultimoContacto: null,
    duenos: [],
    trabajados: 0,
    pctTrabajados: 0,
    pctLlamados: 0,
    tipo: null,
  }
}

export interface PanoramaDeListas {
  /** Las listas con nombre, registradas o no, archivadas incluidas (la pantalla decide si las enseña) */
  listas: ResumenDeLista[]
  /** Los leads que no tienen lista. null si no hay ninguno */
  sinLista: ResumenDeLista | null
  totales: {
    leads: number
    listas: number
    sinDueno: number
    /** Los que venden en Amazon (vendedores de Amazon) y los que no (tiendas online) */
    venden: number
    noVenden: number
    /** Los partners (agencias, fulfillment, registro de marcas, gestorías): ni venden ni dejan de vender en Amazon, no se les pregunta */
    partners: number
    /** Lo comprobado a mano de si venden ya en Amazon */
    vendeComprobado: number
    noVendeComprobado: number
    sinComprobar: number
    trabajados: number
    pctTrabajados: number
  }
}

const fechaAms = (v: string | null | undefined): number | null => {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

/** Junta las filas de la base y el registro en una lista por nombre, con todo lo que la pantalla enseña de cada una */
export function armarPanorama(filas: readonly FilaDeResumen[], registro: readonly ListaRegistrada[]): PanoramaDeListas {
  const porClave = new Map<string, ResumenDeLista>()
  const duenosPorClave = new Map<string, Map<string | null, number>>()
  let sinLista: ResumenDeLista | null = null
  const duenosSinLista = new Map<string | null, number>()

  for (const r of registro) {
    const clave = claveDeLista(r.nombre)
    if (clave === '' || porClave.has(clave)) continue
    const l = resumenVacio(clave, r.nombre.trim())
    l.id = r.id
    l.registrada = true
    l.archivada = r.archivada
    l.descripcion = r.descripcion
    l.responsable = r.responsable
    porClave.set(clave, l)
    duenosPorClave.set(clave, new Map())
  }

  const sumar = (l: ResumenDeLista, duenos: Map<string | null, number>, f: FilaDeResumen) => {
    l.total += f.total
    for (const e of COLD_STATUSES) l.estados[e] += f[e] ?? 0
    l.porTipo[f.tipo_lead] = (l.porTipo[f.tipo_lead] ?? 0) + f.total
    l.vende.vende += f.vende
    l.vende.no_vende += f.no_vende
    l.vende.sin_comprobar += f.sin_comprobar
    l.llamados += f.llamados
    l.intentos += f.intentos
    const ultimo = fechaAms(f.ultimo_contacto)
    if (ultimo !== null && (l.ultimoContacto === null || ultimo > l.ultimoContacto)) l.ultimoContacto = ultimo
    duenos.set(f.dueno, (duenos.get(f.dueno) ?? 0) + f.total)
  }

  for (const f of filas) {
    const clave = claveDeLista(f.lista)
    if (clave === '') {
      sinLista ??= resumenVacio(SIN_LISTA, NOMBRE_SIN_LISTA)
      sumar(sinLista, duenosSinLista, f)
      continue
    }
    let l = porClave.get(clave)
    if (!l) {
      l = resumenVacio(clave, (f.lista ?? '').trim())
      porClave.set(clave, l)
      duenosPorClave.set(clave, new Map())
    }
    sumar(l, duenosPorClave.get(clave)!, f)
  }

  const cerrar = (l: ResumenDeLista, duenos: Map<string | null, number>) => {
    l.duenos = [...duenos.entries()].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n || (a.id ?? '').localeCompare(b.id ?? ''))
    l.trabajados = l.total - l.estados.pendiente
    l.pctTrabajados = l.total > 0 ? l.trabajados / l.total : 0
    l.pctLlamados = l.total > 0 ? l.llamados / l.total : 0
    // De qué tipo es la lista: del único que tenga; con más de uno, «mezcla». Una lista vacía no es de ninguno
    const presentes = (['seller_amazon', 'tienda_online', 'partner'] as const).filter((t) => l.porTipo[t] > 0)
    l.tipo = l.total === 0 || presentes.length === 0 ? null : presentes.length > 1 ? 'mixto' : presentes[0]
  }
  for (const [clave, l] of porClave) cerrar(l, duenosPorClave.get(clave)!)
  if (sinLista) cerrar(sinLista, duenosSinLista)

  const listas = [...porClave.values()]
  const todas = sinLista ? [...listas, sinLista] : listas
  const leads = todas.reduce((s, l) => s + l.total, 0)
  const trabajados = todas.reduce((s, l) => s + l.trabajados, 0)
  const sumaPor = (campo: (l: ResumenDeLista) => number) => todas.reduce((s, l) => s + campo(l), 0)
  let sinDueno = 0
  for (const l of todas) for (const d of l.duenos) if (d.id === null) sinDueno += d.n

  return {
    listas,
    sinLista,
    totales: {
      leads,
      listas: listas.filter((l) => !l.archivada).length,
      sinDueno,
      venden: sumaPor((l) => l.porTipo.seller_amazon),
      noVenden: sumaPor((l) => l.porTipo.tienda_online),
      partners: sumaPor((l) => l.porTipo.partner),
      vendeComprobado: sumaPor((l) => l.vende.vende),
      noVendeComprobado: sumaPor((l) => l.vende.no_vende),
      sinComprobar: sumaPor((l) => l.vende.sin_comprobar),
      trabajados,
      pctTrabajados: leads > 0 ? trabajados / leads : 0,
    },
  }
}

/** Lo mínimo de un lead para resumirlo */
export interface LeadParaResumir {
  source_list: string | null
  assigned_to: string | null
  tipo_lead: ColdLeadTipo
  status: ColdLeadStatus
  vende_en_amazon: ColdVendeAmazon
  call_attempts: number | null
  last_contacted_at: string | null
}

/**
 * Lo mismo que cold_listas_resumen() de la base, hecho aquí con los leads en la mano. Solo para cuando la migración 257 todavía no está lanzada: la pantalla enseña las
 * listas y lo usadas que están de todas formas, aunque todavía no se pueda cambiar nada. Se agrupa igual que la base: por el texto de la lista (recortado), el dueño y el tipo.
 */
export function resumirLeads(leads: readonly LeadParaResumir[]): FilaDeResumen[] {
  const grupos = new Map<string, FilaDeResumen>()
  for (const l of leads) {
    const lista = (l.source_list ?? '').trim() === '' ? null : (l.source_list as string).trim()
    const clave = JSON.stringify([lista, l.assigned_to, l.tipo_lead])
    let f = grupos.get(clave)
    if (!f) {
      f = { lista, dueno: l.assigned_to, tipo_lead: l.tipo_lead, total: 0, pendiente: 0, no_contesta: 0, programado: 0, email_enviado: 0, seguimiento: 0, cita_cualificada: 0, no_interesa: 0, vende: 0, no_vende: 0, sin_comprobar: 0, llamados: 0, intentos: 0, ultimo_contacto: null }
      grupos.set(clave, f)
    }
    f.total++
    f[l.status]++
    f[l.vende_en_amazon === 'vende' ? 'vende' : l.vende_en_amazon === 'no_vende' ? 'no_vende' : 'sin_comprobar']++
    const intentos = l.call_attempts ?? 0
    if (intentos > 0) f.llamados++
    f.intentos += intentos
    if (l.last_contacted_at && (f.ultimo_contacto === null || Date.parse(l.last_contacted_at) > Date.parse(f.ultimo_contacto))) f.ultimo_contacto = l.last_contacted_at
  }
  return [...grupos.values()]
}

export type CriterioDeOrdenDeListas = 'leads' | 'nombre' | 'uso' | 'reciente'

export const ETIQUETA_DE_ORDEN_DE_LISTAS: Record<CriterioDeOrdenDeListas, string> = {
  leads: 'Más leads',
  nombre: 'Nombre A-Z',
  uso: 'Más usadas',
  reciente: 'Última actividad',
}

/** Las archivadas siempre al final; dentro de cada grupo, por el criterio */
export function ordenarListas(listas: readonly ResumenDeLista[], criterio: CriterioDeOrdenDeListas): ResumenDeLista[] {
  const por: Record<CriterioDeOrdenDeListas, (a: ResumenDeLista, b: ResumenDeLista) => number> = {
    leads: (a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'),
    nombre: (a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }),
    uso: (a, b) => b.pctTrabajados - a.pctTrabajados || b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'),
    reciente: (a, b) => (b.ultimoContacto ?? 0) - (a.ultimoContacto ?? 0) || a.nombre.localeCompare(b.nombre, 'es'),
  }
  return [...listas].sort((a, b) => Number(a.archivada) - Number(b.archivada) || por[criterio](a, b))
}

/* ------------------------------------------------------------------ */
/* Los filtros de los leads                                            */
/* ------------------------------------------------------------------ */

export type OrdenDeLeads = 'prioridad' | 'nombre' | 'reciente' | 'nuevos'
export type TipoDeEmpresaFiltro = 'sociedad' | 'autonomo' | 'sin_tipo'

export interface FiltroDeLeads {
  /** El nombre de una lista, SIN_LISTA, o null (todas) */
  lista: string | null
  /** El id de una persona, SIN_DUENO, o null (todas) */
  dueno: string | null
  estado: ColdLeadStatus | null
  vende: ColdVendeAmazon | null
  tipo: ColdLeadTipo | null
  nivel: 1 | 2 | 3 | null
  empresa: TipoDeEmpresaFiltro | null
  q: string
  orden: OrdenDeLeads
}

export const FILTRO_DE_LEADS_VACIO: FiltroDeLeads = { lista: null, dueno: null, estado: null, vende: null, tipo: null, nivel: null, empresa: null, q: '', orden: 'prioridad' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const esUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

const enLista = <T extends string>(v: unknown, validos: readonly T[]): T | null => (typeof v === 'string' && (validos as readonly string[]).includes(v) ? (v as T) : null)

/** Lo que llega del navegador, saneado: cada campo vale lo que debe valer o es «sin filtro». Nunca lanza */
export function leerFiltroDeLeads(crudo: unknown): FiltroDeLeads {
  const o = (typeof crudo === 'object' && crudo !== null ? crudo : {}) as Record<string, unknown>
  const lista = o.lista === SIN_LISTA ? SIN_LISTA : limpiarNombreDeLista(o.lista)
  const nivel = Number(o.nivel)
  return {
    lista: lista !== null && lista.length <= 80 ? lista : null,
    dueno: o.dueno === SIN_DUENO ? SIN_DUENO : esUuid(o.dueno) ? o.dueno.toLowerCase() : null,
    estado: enLista(o.estado, COLD_STATUSES),
    vende: enLista(o.vende, ['sin_comprobar', 'no_vende', 'vende'] as const),
    tipo: enLista(o.tipo, ['seller_amazon', 'tienda_online', 'partner'] as const),
    nivel: nivel === 1 || nivel === 2 || nivel === 3 ? nivel : null,
    empresa: enLista(o.empresa, ['sociedad', 'autonomo', 'sin_tipo'] as const),
    q: typeof o.q === 'string' ? o.q.trim().slice(0, 100) : '',
    orden: enLista(o.orden, ['prioridad', 'nombre', 'reciente', 'nuevos'] as const) ?? 'prioridad',
  }
}

/** El filtro tal como lo espera cold_leads_buscar: solo lo que filtra de verdad */
export function filtroParaLaBase(f: FiltroDeLeads): Record<string, string | number> {
  const salida: Record<string, string | number> = { orden: f.orden }
  if (f.lista) salida.lista = f.lista
  if (f.dueno) salida.dueno = f.dueno
  if (f.estado) salida.estado = f.estado
  if (f.vende) salida.vende = f.vende
  if (f.tipo) salida.tipo = f.tipo
  if (f.nivel) salida.nivel = f.nivel
  if (f.empresa) salida.empresa = f.empresa
  if (f.q) salida.q = f.q
  return salida
}

export const hayFiltroDeLeads = (f: FiltroDeLeads): boolean => f.lista !== null || f.dueno !== null || f.estado !== null || f.vende !== null || f.tipo !== null || f.nivel !== null || f.empresa !== null || f.q !== ''

/* ------------------------------------------------------------------ */
/* El banco de tiendas                                                 */
/* ------------------------------------------------------------------ */

export interface FiltroDeBanco {
  nivel: 1 | 2 | 3 | null
  /**
   * La letra del tramo: A (llamar primero), B (llamar en segunda ronda), C (solo correo), D (descartada: no se reparte nunca), G (gran cuenta, de Alejandro); o AB, las dos de
   * llamar juntas. Sin tramo salen todas menos las descartadas.
   */
  tramo: 'AB' | 'A' | 'B' | 'C' | 'D' | 'G' | null
  empresa: TipoDeEmpresaFiltro | null
  categoria: string | null
  plataforma: string | null
  ciudad: string
  conTelefono: boolean
  conEmail: boolean
  conDecisor: boolean
  ventasMin: number | null
  q: string
  incluirRepartidas: boolean
}

export const FILTRO_DE_BANCO_VACIO: FiltroDeBanco = {
  nivel: null,
  tramo: null,
  empresa: null,
  categoria: null,
  plataforma: null,
  ciudad: '',
  conTelefono: false,
  conEmail: false,
  conDecisor: false,
  ventasMin: null,
  q: '',
  incluirRepartidas: false,
}

export const ETIQUETA_DE_TRAMO: Record<NonNullable<FiltroDeBanco['tramo']>, string> = {
  AB: 'A y B · Para llamar',
  A: 'A · Llamar primero',
  B: 'B · Llamar (2ª ronda)',
  C: 'C · Email',
  D: 'D · Descartadas (no se reparten)',
  G: 'G · Gran cuenta',
}

const texto = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null)

export function leerFiltroDeBanco(crudo: unknown): FiltroDeBanco {
  const o = (typeof crudo === 'object' && crudo !== null ? crudo : {}) as Record<string, unknown>
  const nivel = Number(o.nivel)
  const ventas = Number(o.ventasMin)
  return {
    nivel: nivel === 1 || nivel === 2 || nivel === 3 ? nivel : null,
    tramo: enLista(typeof o.tramo === 'string' ? o.tramo.toUpperCase() : null, ['AB', 'A', 'B', 'C', 'D', 'G'] as const),
    empresa: enLista(o.empresa, ['sociedad', 'autonomo', 'sin_tipo'] as const),
    categoria: texto(o.categoria, 80),
    plataforma: texto(o.plataforma, 40),
    ciudad: texto(o.ciudad, 60) ?? '',
    conTelefono: o.conTelefono === true,
    conEmail: o.conEmail === true,
    conDecisor: o.conDecisor === true,
    ventasMin: o.ventasMin !== null && o.ventasMin !== undefined && o.ventasMin !== '' && Number.isFinite(ventas) && ventas >= 0 ? ventas : null,
    q: texto(o.q, 100) ?? '',
    incluirRepartidas: o.incluirRepartidas === true,
  }
}

/** El filtro del banco tal como lo espera cold_banco_buscar */
export function filtroDeBancoParaLaBase(f: FiltroDeBanco): Record<string, string | number | boolean> {
  const salida: Record<string, string | number | boolean> = {}
  if (f.nivel) salida.nivel = f.nivel
  if (f.tramo) salida.tramo = f.tramo
  if (f.empresa) salida.empresa = f.empresa
  if (f.categoria) salida.categoria = f.categoria
  if (f.plataforma) salida.plataforma = f.plataforma
  if (f.ciudad) salida.ciudad = f.ciudad
  if (f.conTelefono) salida.con_telefono = true
  if (f.conEmail) salida.con_email = true
  if (f.conDecisor) salida.con_decisor = true
  if (f.ventasMin !== null) salida.ventas_min = f.ventasMin
  if (f.q) salida.q = f.q
  if (f.incluirRepartidas) salida.incluir_repartidas = true
  return salida
}

export const hayFiltroDeBanco = (f: FiltroDeBanco): boolean => JSON.stringify({ ...f, incluirRepartidas: false }) !== JSON.stringify(FILTRO_DE_BANCO_VACIO)

/* ------------------------------------------------------------------ */
/* Nombres de lista para una persona                                   */
/* ------------------------------------------------------------------ */

/**
 * Cómo se llama una persona en el nombre de su lista: «Maoli», «José», «María Fernanda». Con dos palabras o menos se usa el nombre tal cual («María Fernanda», «Ana
 * López»: no se puede saber cuál es el apellido); con más, la primera. Sin nombre, lo que va antes de la @ del correo. Es una propuesta: se puede cambiar al crear la lista.
 */
export function nombreCortoDePersona(nombreCompleto: string | null | undefined, correo?: string | null): string {
  const palabras = (nombreCompleto ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (palabras.length > 0) return palabras.length <= 2 ? palabras.join(' ') : palabras[0]
  const local = (correo ?? '').split('@')[0].replace(/[._-]+/g, ' ').trim()
  return local === '' ? 'Lista nueva' : local.charAt(0).toUpperCase() + local.slice(1)
}

/**
 * El nombre que se le propone a la lista de una persona: «Ana V1» y, si ya existe, «Ana V2», «Ana V3»… Se mira sin tener en cuenta mayúsculas.
 * `existentes` son los nombres de lista que ya hay (archivadas incluidas: un nombre archivado sigue ocupado).
 */
export function nombreDeListaSugerido(persona: string, existentes: readonly string[]): string {
  const base = limpiarNombreDeLista(persona) ?? 'Lista'
  const ocupados = new Set(existentes.map(claveDeLista))
  for (let version = 1; version < 1000; version++) {
    const candidato = `${base} V${version}`
    if (!ocupados.has(claveDeLista(candidato))) return candidato
  }
  return `${base} ${Date.now()}`
}

/* ------------------------------------------------------------------ */
/* Cómo se enseña lo usada que está una lista                          */
/* ------------------------------------------------------------------ */

export const porcentajeTexto = (p: number): string => `${(p * 100).toLocaleString('es-ES', { maximumFractionDigits: p > 0 && p < 0.1 ? 1 : 0 })} %`

/** «Sin tocar», «En marcha», «Trabajada»…: una palabra para decir de un vistazo cómo va una lista */
export type SituacionDeLista = 'vacia' | 'sin_tocar' | 'empezada' | 'en_marcha' | 'casi_agotada'

export function situacionDeLista(l: Pick<ResumenDeLista, 'total' | 'pctTrabajados'>): SituacionDeLista {
  if (l.total === 0) return 'vacia'
  if (l.pctTrabajados === 0) return 'sin_tocar'
  if (l.pctTrabajados < 0.25) return 'empezada'
  if (l.pctTrabajados < 0.8) return 'en_marcha'
  return 'casi_agotada'
}

export const ETIQUETA_DE_SITUACION: Record<SituacionDeLista, string> = {
  vacia: 'Vacía',
  sin_tocar: 'Sin tocar',
  empezada: 'Empezada',
  en_marcha: 'En marcha',
  casi_agotada: 'Casi agotada',
}

export const ETIQUETA_DE_TIPO_DE_LISTA: Record<TipoDeLista, string> = {
  seller_amazon: 'Venden en Amazon',
  tienda_online: 'No venden en Amazon',
  partner: 'Partners',
  mixto: 'Mezcla',
}

/* ------------------------------------------------------------------ */
/* Lo que devuelve el servidor y enseña la pantalla                    */
/* ------------------------------------------------------------------ */

export const LEADS_POR_PAGINA = 100
export const TIENDAS_POR_PAGINA = 50

/** Cuántos leads de la lista pasan a la persona al asignar una lista: ninguno (solo el responsable), los que no tienen dueño, los sin contactar o todos */
export type AlcanceDeAsignar = 'ninguno' | 'sin_dueno' | 'pendientes' | 'todos'
export const ALCANCES: readonly AlcanceDeAsignar[] = ['ninguno', 'sin_dueno', 'pendientes', 'todos']

export interface PersonaDelEquipo {
  id: string
  nombre: string
  rol: string
  /** El puesto (migración 257): comercial, manager_comercial, gestion_administrativa. null = sin puesto, o todavía sin migración */
  puesto: string | null
  /** Sale en el equipo que llama: es la marca `is_comercial` */
  llama: boolean
  /** Puede entrar en Cold Calling: administrador, partner o con la casilla de la app. Asignar leads a quien no puede es mandarlos a ningún sitio */
  coldCalling: boolean
}

export interface FilaDeLead {
  id: string
  store_name: string
  company: string | null
  phone: string | null
  email: string | null
  ciudad: string | null
  category: string | null
  status: string
  assigned_to: string | null
  source_list: string | null
  tipo_lead: string
  vende_en_amazon: string
  nivel: number | null
  tipo_empresa: string | null
  call_attempts: number
  last_contacted_at: string | null
  next_call_date: string | null
  ventas_estimadas_usd: number | null
  revenue_monthly: number | null
  web: string | null
  decisor: string | null
}

export interface Movimiento {
  id: string
  usuario: string | null
  accion: string
  n: number
  lista_origen: string | null
  lista_destino: string | null
  cambia_lista: boolean
  cambia_dueno: boolean
  dueno_destino: string | null
  deshecho_at: string | null
  created_at: string
  se_puede_deshacer: boolean
}

export interface ResultadoDeMover {
  movimiento: string | null
  cambiados: number
}

export interface ResumenDelBanco {
  total: number
  /** Las que se pueden repartir ahora: ni repartidas ni descartadas. Lo demás del resumen (niveles, tramos…) cuenta solo estas */
  libres: number
  /** Las que nunca se reparten (nivel 4 o tramo D) y siguen sin lead */
  descartadas: number
  por_nivel: Record<string, number>
  por_tramo: Record<string, number>
  por_tipo: Record<string, number>
  categorias: Array<{ nombre: string; n: number }>
  plataformas: Array<{ nombre: string; n: number }>
}

export interface FilaDelBanco {
  dominio: string
  tienda: string
  ciudad: string | null
  categoria: string
  nivel: number | null
  tramo: string | null
  ventas: number | null
  productos: number | null
  anios: number | null
  plataforma: string | null
  tipo_empresa: string | null
  razon_social: string | null
  decisor: string | null
  telefono: boolean
  email: boolean
  repartida: boolean
  lista: string | null
}

export interface ResultadoDeAnadir {
  movimiento: string | null
  anadidos: number
  ya_estaban: number
  no_disponibles: number
  lista: string
}
