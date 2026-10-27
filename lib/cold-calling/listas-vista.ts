import { COLD_STATUSES } from '@/lib/types/cold-leads'
import {
  SIN_DUENO,
  claveDeLista,
  type FilaDeResumen,
  type Movimiento,
  type ResultadoDeAnadir,
  type ResultadoDeMover,
  type ResumenDeLista,
  type TipoDeLista,
} from './listas'

/**
 * LO QUE LA PANTALLA DE LISTAS CALCULA Y DICE — PURO.
 * ===================================================
 * Filtrar la tabla de listas, cuánto trabajo tiene cada persona, y las frases (antes de hacer algo, después de hacerlo y en el historial). No toca la base ni la red.
 * Se comprueba con listas-vista.prueba.ts.
 */

/* ------------------------------------------------------------------ */
/* Filtrar las listas de la tabla                                      */
/* ------------------------------------------------------------------ */

/** Minúsculas y sin tildes, para buscar «jose» y encontrar «José V2» */
export const sinTildes = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export interface OpcionesDeFiltroDeListas {
  texto: string
  tipo: TipoDeLista | 'todas'
  /** true = enseñar también las archivadas (siempre al final) */
  archivadas: boolean
  /** El id de una persona (su lista, o la que tiene leads suyos), SIN_DUENO (listas con leads sin dueño) o null (todas) */
  persona: string | null
}

export function filtrarListas(listas: readonly ResumenDeLista[], op: OpcionesDeFiltroDeListas): ResumenDeLista[] {
  const texto = sinTildes(op.texto.trim())
  return listas.filter((l) => {
    if (l.archivada && !op.archivadas) return false
    if (op.tipo !== 'todas' && l.tipo !== op.tipo) return false
    if (texto !== '' && !sinTildes(`${l.nombre} ${l.descripcion ?? ''}`).includes(texto)) return false
    if (op.persona === SIN_DUENO) return l.duenos.some((d) => d.id === null)
    if (op.persona !== null) return l.responsable === op.persona || l.duenos.some((d) => d.id === op.persona)
    return true
  })
}

/* ------------------------------------------------------------------ */
/* Cuánto trabajo tiene cada persona                                   */
/* ------------------------------------------------------------------ */

export interface CargaDePersona {
  /** El id de la persona, o null = los leads que no tienen dueño */
  id: string | null
  total: number
  pendientes: number
  /** Los que ya se han tocado: cualquier estado menos «Sin contactar» */
  trabajados: number
  /** 0 a 1 */
  pctTrabajados: number
  llamados: number
  intentos: number
  /** En cuántas listas distintas tiene leads */
  listas: number
  ultimoContacto: number | null
}

/** Una fila por persona (y una para los leads sin dueño), de más a menos leads */
export function cargaPorPersona(filas: readonly FilaDeResumen[]): CargaDePersona[] {
  const por = new Map<string | null, CargaDePersona & { _listas: Set<string> }>()
  for (const f of filas) {
    let c = por.get(f.dueno)
    if (!c) {
      c = { id: f.dueno, total: 0, pendientes: 0, trabajados: 0, pctTrabajados: 0, llamados: 0, intentos: 0, listas: 0, ultimoContacto: null, _listas: new Set() }
      por.set(f.dueno, c)
    }
    c.total += f.total
    c.pendientes += f.pendiente
    c.llamados += f.llamados
    c.intentos += f.intentos
    const clave = claveDeLista(f.lista)
    if (clave !== '') c._listas.add(clave)
    const ultimo = f.ultimo_contacto ? Date.parse(f.ultimo_contacto) : Number.NaN
    if (Number.isFinite(ultimo) && (c.ultimoContacto === null || ultimo > c.ultimoContacto)) c.ultimoContacto = ultimo
  }
  return [...por.values()]
    .map(({ _listas, ...c }) => ({ ...c, trabajados: c.total - c.pendientes, pctTrabajados: c.total > 0 ? (c.total - c.pendientes) / c.total : 0, listas: _listas.size }))
    .sort((a, b) => b.total - a.total || (a.id ?? '').localeCompare(b.id ?? ''))
}

/** Los estados en el orden en que se pintan las barras, con su cantidad (los que no tienen ninguno, fuera) */
export function segmentosDeEstados(estados: Record<string, number>): Array<{ estado: (typeof COLD_STATUSES)[number]; n: number }> {
  return COLD_STATUSES.map((estado) => ({ estado, n: estados[estado] ?? 0 })).filter((s) => s.n > 0)
}

/* ------------------------------------------------------------------ */
/* Frases                                                              */
/* ------------------------------------------------------------------ */

const numero = (n: number) => n.toLocaleString('es-ES')
export const leadsTexto = (n: number) => (n === 1 ? '1 lead' : `${numero(n)} leads`)
export const tiendasTexto = (n: number) => (n === 1 ? '1 tienda' : `${numero(n)} tiendas`)

export interface OperacionDeMover {
  n: number
  cambiaLista: boolean
  /** null = sacarlos de toda lista */
  lista: string | null
  cambiaDueno: boolean
  /** null = dejarlos sin dueño */
  dueno: string | null
  nombreDe: (id: string) => string
}

/** Lo que se va a hacer, antes de hacerlo: «Mover 120 leads a «José V3» y asignarlos a José» */
export function fraseDeMover(o: OperacionDeMover): string {
  const quien = o.dueno ? o.nombreDe(o.dueno) : null
  const lista = o.cambiaLista ? (o.lista ? `a «${o.lista}»` : 'fuera de toda lista') : null
  if (o.cambiaLista && o.cambiaDueno) return `Mover ${leadsTexto(o.n)} ${lista} y ${quien ? `asignarlos a ${quien}` : 'dejarlos sin dueño'}`
  if (o.cambiaLista) return o.lista ? `Mover ${leadsTexto(o.n)} ${lista}` : `Sacar ${leadsTexto(o.n)} de su lista`
  if (o.cambiaDueno) return quien ? `Asignar ${leadsTexto(o.n)} a ${quien}` : `Dejar ${leadsTexto(o.n)} sin dueño`
  return 'No hay nada que cambiar'
}

/** Lo que se ha hecho, después de hacerlo (para el aviso). `cambiados` es lo que dice el servidor: puede ser menos que los elegidos si algunos ya estaban así */
export function mensajeDeMover(o: OperacionDeMover, r: ResultadoDeMover): string {
  if (r.cambiados === 0) return 'No ha cambiado nada: ya estaban así.'
  const quien = o.dueno ? o.nombreDe(o.dueno) : null
  const lista = o.cambiaLista ? (o.lista ? `a «${o.lista}»` : 'fuera de toda lista') : null
  let base: string
  if (o.cambiaLista && o.cambiaDueno) base = `${leadsTexto(r.cambiados)} ${r.cambiados === 1 ? 'movido' : 'movidos'} ${lista} y ${quien ? `asignados a ${quien}` : 'sin dueño'}`
  else if (o.cambiaLista) base = o.lista ? `${leadsTexto(r.cambiados)} ${r.cambiados === 1 ? 'movido' : 'movidos'} ${lista}` : `${leadsTexto(r.cambiados)} sacados de su lista`
  else base = quien ? `${leadsTexto(r.cambiados)} ${r.cambiados === 1 ? 'asignado' : 'asignados'} a ${quien}` : `${leadsTexto(r.cambiados)} sin dueño`
  const yaEstaban = o.n - r.cambiados
  return yaEstaban > 0 ? `${base} (${yaEstaban === 1 ? 'otro ya estaba así' : `otros ${numero(yaEstaban)} ya estaban así`}).` : `${base}.`
}

/** Lo que se va a hacer al añadir tiendas del banco, antes de hacerlo */
export function fraseDeAnadir(a: { n: number; lista: string; dueno: string | null; nombreDe: (id: string) => string }): string {
  return `Añadir ${tiendasTexto(a.n)} a «${a.lista}»${a.dueno ? `, asignadas a ${a.nombreDe(a.dueno)}` : ', sin dueño'}`
}

/** Lo que ha pasado al añadir tiendas, después de hacerlo */
export function mensajeDeAnadir(r: ResultadoDeAnadir): string {
  const partes: string[] = []
  if (r.anadidos > 0) partes.push(`${tiendasTexto(r.anadidos)} ${r.anadidos === 1 ? 'añadida' : 'añadidas'} a «${r.lista}»`)
  if (r.ya_estaban > 0) partes.push(`${numero(r.ya_estaban)} ${r.ya_estaban === 1 ? 'ya estaba' : 'ya estaban'} entre los leads`)
  if (r.no_disponibles > 0) partes.push(`${numero(r.no_disponibles)} ${r.no_disponibles === 1 ? 'no estaba disponible' : 'no estaban disponibles'} (ya repartidas o descartadas)`)
  if (partes.length === 0) return 'No se ha añadido ninguna tienda.'
  if (r.anadidos === 0) return `No se ha añadido ninguna tienda: ${partes.join('; ')}.`
  return `${partes.join('; ')}.`
}

/** Lo que ha pasado al deshacer un movimiento. `accion` es la del movimiento que se deshizo */
export function mensajeDeDeshacer(r: { deshechos: number; conservados: number; accion: string }): string {
  if (r.accion === 'anadir_del_banco') {
    const quitadas = r.deshechos === 0 ? 'No se ha quitado ninguna tienda' : `${tiendasTexto(r.deshechos)} ${r.deshechos === 1 ? 'quitada' : 'quitadas'} (las que seguían sin tocar)`
    return r.conservados > 0 ? `${quitadas}; ${r.conservados === 1 ? 'otra se queda porque ya se había trabajado' : `otras ${numero(r.conservados)} se quedan porque ya se habían trabajado`}.` : `${quitadas}.`
  }
  const vueltos = r.deshechos === 0 ? 'No ha vuelto ningún lead a como estaba' : `${leadsTexto(r.deshechos)} ${r.deshechos === 1 ? 'vuelve' : 'vuelven'} a como estaban`
  return r.conservados > 0 ? `${vueltos}; ${r.conservados === 1 ? 'otro se queda como está porque alguien lo ha vuelto a tocar después' : `otros ${numero(r.conservados)} se quedan como están porque alguien los ha vuelto a tocar después`}.` : `${vueltos}.`
}

export const ETIQUETA_DE_ACCION: Record<string, string> = {
  crear_lista: 'Lista creada',
  renombrar_lista: 'Lista renombrada',
  archivar_lista: 'Lista archivada',
  desarchivar_lista: 'Lista recuperada',
  responsable_lista: 'Responsable de la lista',
  mover: 'Leads movidos',
  asignar: 'Leads asignados',
  mover_asignar: 'Leads movidos y asignados',
  asignar_lista: 'Lista asignada',
  anadir_del_banco: 'Tiendas añadidas',
  deshacer: 'Movimiento deshecho',
}

/** Una línea del historial: qué pasó, con nombres de persona y de lista */
export function describirMovimiento(m: Movimiento, nombreDe: (id: string | null) => string): string {
  const origen = m.lista_origen ? `«${m.lista_origen}»` : null
  const destino = m.lista_destino ? `«${m.lista_destino}»` : null
  const quien = m.dueno_destino ? nombreDe(m.dueno_destino) : null
  switch (m.accion) {
    case 'crear_lista':
      return `Creó la lista ${destino ?? ''}${quien ? `, asignada a ${quien}` : ''}`.trim()
    case 'renombrar_lista':
      return `Renombró ${origen ?? 'una lista'} a ${destino ?? '…'} (${leadsTexto(m.n)})`
    case 'archivar_lista':
      return `Archivó la lista ${origen ?? ''}`.trim()
    case 'desarchivar_lista':
      return `Recuperó la lista ${origen ?? ''}`.trim()
    case 'responsable_lista':
      return quien ? `Puso a ${quien} de responsable de ${origen ?? 'una lista'}` : `Quitó el responsable de ${origen ?? 'una lista'}`
    case 'mover':
      if (m.cambia_lista && !m.lista_destino) return `Sacó ${leadsTexto(m.n)} de ${origen ?? 'su lista'}`
      return `Movió ${leadsTexto(m.n)} ${origen ? `de ${origen} ` : ''}a ${destino ?? 'otra lista'}`
    case 'asignar':
      return quien ? `Asignó ${leadsTexto(m.n)} a ${quien}` : `Dejó ${leadsTexto(m.n)} sin dueño`
    case 'mover_asignar':
      return `Movió ${leadsTexto(m.n)} ${m.lista_destino ? `a ${destino}` : 'fuera de toda lista'} y ${quien ? `los asignó a ${quien}` : 'los dejó sin dueño'}`
    case 'asignar_lista':
      return `Pasó ${leadsTexto(m.n)} ${origen ? `de ${origen} ` : ''}${quien ? `a ${quien}` : 'a nadie'}`
    case 'anadir_del_banco':
      return m.n === 0 ? `Intentó añadir tiendas del banco a ${destino ?? 'una lista'}, pero ninguna estaba libre` : `Añadió ${tiendasTexto(m.n)} del banco a ${destino ?? 'una lista'}${quien ? `, asignadas a ${quien}` : ''}`
    case 'deshacer':
      return `Deshizo un movimiento (${leadsTexto(m.n)})`
    default:
      return m.accion
  }
}
