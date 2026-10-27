/**
 * LA LISTA DE CLIENTES DEL HUB: QUÉ SE VE DE CADA UNO, CÓMO SE BUSCA Y CÓMO SE ORDENA.
 * ===================================================================================
 * La lista de la izquierda del CRM tiene que contestar de un vistazo a lo que antes obligaba a abrir ficha por ficha: ¿en qué fase está?, ¿desde cuándo?, ¿qué hay que hacer con
 * él y para cuándo?, ¿se habló ya con él, y con qué interés? Todo eso sale de cosas que ya existen —la ficha, el historial de fases y las notas de las reuniones— y aquí se
 * junta en UNA línea por cliente (`ResumenDeFila`), sin tocar la base: el servidor ya trajo los datos.
 *
 * LA FECHA DE LA PRÓXIMA ACCIÓN ES UN DÍA («2026-10-30», una columna `date`) Y SE COMPARA CON EL DÍA DE HOY EN MADRID, no con el del navegador: un comercial en Bogotá a las
 * 20:00 todavía está en el día anterior y no tiene por qué ver «vencida» una acción de mañana en España.
 *
 * Es puro: no toca la base ni el navegador.
 */

import { diaDeMadrid } from '@/lib/correo/secuencias/fechas'
import { CRM_STAGES, crmContact, type CrmClientWithDetails, type CrmStage } from '@/lib/types/crm'
import { cicloDeVenta, diasEntre, lineaDeFases, type EntradaDeFase } from './fases'
import type { EstadoDeNota, InteresDelCliente } from './gemini/tipos'

/** De cada nota, lo justo para la lista (el contenido se pide al abrir la ficha) */
export interface NotaLigera {
  id: string
  client_id: string | null
  estado: EstadoDeNota
  fecha_reunion: string | null
  /** El nivel de interés que dedujo la IA, si ya se analizó */
  interes: InteresDelCliente | null
}

export const ETIQUETA_CORTA: Record<CrmStage, string> = {
  nuevo: 'Nuevo',
  seguimiento: 'Seguimiento',
  propuesta_enviada: 'Propuesta',
  revision_propuesta: 'Revisión',
  negociacion: 'Negociación',
  ganado: 'Cerrado',
  perdido: 'Perdido',
}

export function agruparPorCliente<T extends { client_id: string | null }>(filas: readonly T[]): Record<string, T[]> {
  const salida: Record<string, T[]> = {}
  for (const f of filas) {
    if (!f.client_id) continue
    ;(salida[f.client_id] ??= []).push(f)
  }
  return salida
}

/** «AP» para «Ana Pérez»; «?» si no hay nombre */
export function iniciales(nombre: string | null | undefined): string {
  const palabras = (nombre ?? '').trim().split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return '?'
  if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase()
  return (palabras[0][0] + palabras[palabras.length - 1][0]).toUpperCase()
}

export type EstadoDeLaAccion = 'vencida' | 'hoy' | 'proxima'

/** ¿La próxima acción ya pasó, es hoy o es futura? null si no hay fecha. `ahora` en milisegundos */
export function estadoDeLaAccion(fecha: string | null | undefined, ahora: number): EstadoDeLaAccion | null {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}/.test(fecha)) return null
  const dia = fecha.slice(0, 10)
  const hoy = diaDeMadrid(ahora)
  return dia < hoy ? 'vencida' : dia === hoy ? 'hoy' : 'proxima'
}

export interface ResumenDeFila {
  id: string
  nombre: string
  empresa: string | null
  stage: CrmStage
  /** Posición en el camino (0-5) para los puntitos de la fila */
  indice: number
  /** 0 a 1 */
  avance: number
  diasEnLaFase: number | null
  accion: { texto: string; fecha: string | null; estado: EstadoDeLaAccion | null } | null
  /** Cuándo fue la última reunión con notas, si la hay */
  ultimaReunion: string | null
  interes: InteresDelCliente | null
  /** Cuántas notas de reunión tiene (sin contar las ignoradas) */
  notas: number
  /** Tiene una nota que espera análisis */
  porAnalizar: boolean
}

const NIVEL: Record<InteresDelCliente, number> = { alto: 4, medio: 3, bajo: 2, no_claro: 1, ninguno: 0 }

export function resumenDeFila(
  c: CrmClientWithDetails,
  historial: readonly EntradaDeFase[] | undefined,
  notas: readonly NotaLigera[] | undefined,
  ahora: number
): ResumenDeFila {
  const contacto = crmContact(c)
  const linea = lineaDeFases(c.stage, historial ?? [], new Date(ahora))
  const delCliente = (notas ?? []).filter((n) => n.estado !== 'ignorada')
  const conFecha = delCliente.filter((n) => n.fecha_reunion).sort((a, b) => (b.fecha_reunion ?? '').localeCompare(a.fecha_reunion ?? ''))
  // El interés que cuenta es el de la reunión MÁS RECIENTE que ya tiene análisis
  const interes = conFecha.find((n) => n.interes)?.interes ?? delCliente.find((n) => n.interes)?.interes ?? null

  const texto = (c.next_action ?? '').trim()
  return {
    id: c.id,
    nombre: contacto.name?.trim() || 'Sin nombre',
    empresa: contacto.company?.trim() || null,
    stage: c.stage,
    indice: linea.indice,
    avance: linea.avance,
    diasEnLaFase: linea.diasEnLaActual,
    accion: texto || c.next_action_date ? { texto, fecha: c.next_action_date ?? null, estado: c.stage === 'ganado' || c.stage === 'perdido' ? null : estadoDeLaAccion(c.next_action_date, ahora) } : null,
    ultimaReunion: conFecha[0]?.fecha_reunion ?? null,
    interes,
    notas: delCliente.length,
    porAnalizar: delCliente.some((n) => n.estado === 'pendiente'),
  }
}

/* ------------------------------------------------------------------ */
/* Filtrar y ordenar                                                   */
/* ------------------------------------------------------------------ */

export interface FiltroDeLista {
  /** 'abiertos' = todo lo que no está cerrado ni perdido */
  fase: CrmStage | 'todas' | 'abiertos'
  texto: string
  /** id del responsable, 'sin' = sin asignar, 'todos' */
  responsable: string
  soloConAccionVencida: boolean
}

export const FILTRO_INICIAL: FiltroDeLista = { fase: 'todas', texto: '', responsable: 'todos', soloConAccionVencida: false }

export type OrdenDeLista = 'reunion' | 'accion' | 'nombre'

const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function coincideConLaBusqueda(c: CrmClientWithDetails, texto: string): boolean {
  const q = sinTildes(texto.trim())
  if (!q) return true
  const contacto = crmContact(c)
  return [contacto.name, contacto.company, contacto.email, contacto.phone, c.country, c.website].filter(Boolean).some((v) => sinTildes(String(v)).includes(q))
}

export function filtrarClientes(clientes: readonly CrmClientWithDetails[], filtro: FiltroDeLista, resumenes: ReadonlyMap<string, ResumenDeFila>): CrmClientWithDetails[] {
  return clientes.filter((c) => {
    if (filtro.fase === 'abiertos' ? c.stage === 'ganado' || c.stage === 'perdido' : filtro.fase !== 'todas' && c.stage !== filtro.fase) return false
    if (filtro.responsable === 'sin' ? c.owner_id : filtro.responsable !== 'todos' && c.owner_id !== filtro.responsable) return false
    if (filtro.soloConAccionVencida && resumenes.get(c.id)?.accion?.estado !== 'vencida') return false
    return coincideConLaBusqueda(c, filtro.texto)
  })
}

/** Por defecto, la reunión más reciente primero (como siempre); «acción»: lo que vence antes, y lo vencido arriba del todo */
export function ordenarClientes(clientes: readonly CrmClientWithDetails[], orden: OrdenDeLista, resumenes: ReadonlyMap<string, ResumenDeFila>): CrmClientWithDetails[] {
  const copia = [...clientes]
  const fechaDeReunion = (c: CrmClientWithDetails) => new Date(c.appointment?.start_time ?? c.created_at).getTime()
  if (orden === 'nombre') return copia.sort((a, b) => (resumenes.get(a.id)?.nombre ?? '').localeCompare(resumenes.get(b.id)?.nombre ?? '', 'es'))
  if (orden === 'accion') {
    const clave = (c: CrmClientWithDetails) => {
      const f = resumenes.get(c.id)?.accion?.fecha
      return f ? f.slice(0, 10) : '9999-12-31'
    }
    return copia.sort((a, b) => clave(a).localeCompare(clave(b)) || fechaDeReunion(b) - fechaDeReunion(a))
  }
  return copia.sort((a, b) => fechaDeReunion(b) - fechaDeReunion(a))
}

/* ------------------------------------------------------------------ */
/* Cifras de cabecera                                                  */
/* ------------------------------------------------------------------ */

export interface CifrasDelPipeline {
  total: number
  /** Ni cerrados ni perdidos */
  abiertos: number
  ganados: number
  perdidos: number
  /** Acciones pendientes con la fecha ya pasada, en clientes abiertos */
  accionesVencidas: number
  /** De los que ya se decidieron (cerrados + perdidos), qué parte se cerró. null si aún no hay ninguno decidido */
  conversion: number | null
  /** Días medios del primer contacto al cierre, de los cerrados con fechas fiables. null si no hay ninguno */
  cicloMedio: number | null
  porFase: Record<CrmStage, number>
}

export function cifrasDelPipeline(
  clientes: readonly CrmClientWithDetails[],
  historiales: Readonly<Record<string, readonly EntradaDeFase[]>>,
  resumenes: ReadonlyMap<string, ResumenDeFila>
): CifrasDelPipeline {
  const porFase = Object.fromEntries(CRM_STAGES.map((s) => [s, 0])) as Record<CrmStage, number>
  let accionesVencidas = 0
  const ciclos: number[] = []
  for (const c of clientes) {
    porFase[c.stage]++
    if (resumenes.get(c.id)?.accion?.estado === 'vencida') accionesVencidas++
    if (c.stage === 'ganado') {
      const ciclo = cicloDeVenta(historiales[c.id] ?? [])
      if (ciclo !== null) ciclos.push(ciclo)
    }
  }
  const decididos = porFase.ganado + porFase.perdido
  return {
    total: clientes.length,
    abiertos: clientes.length - decididos,
    ganados: porFase.ganado,
    perdidos: porFase.perdido,
    accionesVencidas,
    conversion: decididos > 0 ? porFase.ganado / decididos : null,
    cicloMedio: ciclos.length > 0 ? Math.round(ciclos.reduce((a, b) => a + b, 0) / ciclos.length) : null,
    porFase,
  }
}

/** El interés de más a menos, para ordenar o puntuar */
export const nivelDeInteres = (i: InteresDelCliente | null | undefined): number => (i ? NIVEL[i] : -1)

export { diasEntre }
