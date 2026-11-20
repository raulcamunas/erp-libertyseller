/**
 * AMAZON ADS · EL FLUJO DE TÉRMINOS ENTRE CAMPAÑAS Y EL DIARIO POR DÍAS. PURO (lo usan la ruta /api/ads/cuenta/flujo y la pantalla «Flujo»; pruebas en flujo-calculo.prueba.ts).
 *
 * De las filas del log (ads_cambios_log), las propuestas (ads_propuestas), los eventos del agente y las cifras diarias de cada segmentación saca:
 *   · el FLUJO de un producto: qué términos han pasado de una campaña a otra (cosechas) y cuáles se han negativizado, con quién lo hizo y por qué;
 *   · el DIARIO: por cada día (hora de España), qué se ha hecho, qué no y por qué, y las notas del agente.
 *
 * Dos detalles de cómo se escribe el log que aquí importan:
 *   · Una cosecha aplicada deja DOS filas con la misma propuesta: la keyword (o el ASIN) en la campaña DESTINO y la negativa en la campaña ORIGEN. Se juntan en una flecha.
 *   · Una fila fallida lleva el término en `campo` y `valor_nuevo` vacío; una buena, el tipo en `campo` y el término en `valor_nuevo`.
 */

import { partesDeNombre, esAsin as pareceAsin } from './reglas'
import type { Rol } from './estructura'
import { quienSinPersona } from './log-calculo'

/* ------------------------------------------------------------------ */
/* Tipos de entrada (filas ya leídas de la base)                       */
/* ------------------------------------------------------------------ */

export interface FilaDeLogFlujo {
  id: string
  creadoAt: string
  campaignId: string | null
  nombreCampana: string | null
  entidad: string
  accion: string
  campo: string | null
  valorAnterior: string | null
  valorNuevo: string | null
  motivo: string | null
  origen: string
  ok: boolean
  error: string | null
  /** El nombre de la persona (ya resuelto), o null */
  persona: string | null
  propuestaId: string | null
  entidadId: string | null
}

export interface MetricasDePropuesta {
  clics?: number
  pedidos?: number
  gasto?: number
  ventas?: number
  acosPct?: number | null
  concordancia?: string
}

export interface PropuestaFlujo {
  id: string
  tipo: string
  estado: string
  origen: string | null
  asin: string | null
  termino: string | null
  campaignId: string | null
  campaignNombre: string | null
  desdeRol: string | null
  haciaRol: string | null
  haciaCampaignId: string | null
  haciaCampaignNombre: string | null
  negativizarEnOrigen: boolean
  motivo: string | null
  metricas: MetricasDePropuesta | null
  creadaAt: string
  resueltaAt: string | null
  retenidaMotivo: string | null
  retenidaAt: string | null
  error: string | null
  /** Persona que la resolvió (nombre ya resuelto) */
  resueltaPor: string | null
}

export interface EventoFlujo {
  id: string
  creadoAt: string
  tipo: string
  titulo: string
  detalle: string | null
  /** El JSON de `datos` como texto, para buscar el ASIN */
  datosTexto: string
}

export interface DiaDeObjetivo {
  fecha: string
  objetivoId: string
  clics: number
  pedidos: number
  gasto: number
  ventas: number
}

export interface EfectoFlujo {
  propuestaId: string
  veredicto: string | null
}

export interface CampanaConocida {
  campaignId: string
  nombre: string
  rol: Rol | null
}

/* ------------------------------------------------------------------ */
/* Tipos de salida (los de la API)                                     */
/* ------------------------------------------------------------------ */

export type ClaseDeAccion = 'puja_sube' | 'puja_baja' | 'presupuesto_sube' | 'presupuesto_baja' | 'negativa' | 'cosecha' | 'pausa' | 'activa' | 'deshacer' | 'descartada' | 'crear' | 'otro'

export type EstadoDeTermino = 'hecho' | 'deshecho' | 'fallido' | 'pendiente' | 'caducada' | 'descartada' | 'ensayada'
export type QuienDeTermino = 'agente' | 'motor' | 'persona' | 'ensayo'

export const SUMIDERO = 'negativizadas'

export interface NodoDeFlujo {
  id: string
  rol: Rol | 'NEGATIVIZADAS'
  nombre: string
  entran: number
  salen: number
  negativas: number
  pujas: { suben: number; bajan: number }
  presupuesto: { de: number; a: number } | null
  /** La campaña no existe todavía (solo la nombra una propuesta) */
  hipotetica?: boolean
}

export interface FlechaDeFlujo {
  id: string
  desde: string
  hacia: string
  tipo: 'cosecha' | 'negativa'
  hechos: number
  propuestos: number
  deshechos: number
  fallidos: number
}

export interface CifrasAntes {
  clics: number
  pedidos: number
  gasto: number
  ventas: number
  acosPct: number | null
}

export interface CifrasDespues {
  desde: string
  clics: number
  pedidos: number
  gasto: number
  ventas: number
}

export interface TerminoDeFlujo {
  id: string
  flechaId: string
  termino: string
  esAsin: boolean
  fecha: string
  quien: QuienDeTermino
  persona: string | null
  estado: EstadoDeTermino
  concordancia: 'exacta' | 'frase' | 'producto' | null
  negativizadoEnOrigen: boolean
  motivo: string
  antes: CifrasAntes | null
  despues: CifrasDespues | null
  veredicto: string | null
  propuestaId: string | null
  logId: string | null
}

export interface Flujo {
  nodos: NodoDeFlujo[]
  flechas: FlechaDeFlujo[]
  terminos: TerminoDeFlujo[]
}

export interface ResumenDelDia {
  pujasSuben: number
  pujasBajan: number
  negativas: number
  cosechas: number
  pausas: number
  presupuestosSuben: number
  presupuestosBajan: number
  deshechos: number
  fallidos: number
  ensayos: number
}

export interface AccionDelDia {
  id: string
  hora: string
  clase: ClaseDeAccion
  frase: string
  de: string | null
  a: string | null
  campaignId: string | null
  rol: Rol | null
  asin: string | null
  motivo: string | null
  quien: string
  ok: boolean
  deshecho: boolean
  ensayo: boolean
  propuestaId: string | null
}

export interface NoHecha {
  id: string
  termino: string
  tipo: string
  campaignId: string
  rol: Rol | null
  motivo: string
}

export interface NotaDelDia {
  id: string
  hora: string
  tipo: string
  titulo: string
  detalle: string | null
}

export interface DiaDelDiario {
  dia: string
  etiqueta: string
  resumen: ResumenDelDia
  acciones: AccionDelDia[]
  noHechas: NoHecha[]
  notas: NotaDelDia[]
}

/* ------------------------------------------------------------------ */
/* Pequeñas ayudas                                                     */
/* ------------------------------------------------------------------ */

/** «0,35» → 0.35; «1.234,50» → 1234.5; «12.5» → 12.5. null si no es un número */
export function numeroDeTexto(t: string | null | undefined): number | null {
  if (t == null) return null
  let s = String(t).trim().replace(/[^\d,.-]/g, '')
  if (!s) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const PARTES_ESPANA = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

function partesEspana(iso: string | number | Date): Record<string, string> {
  const r: Record<string, string> = {}
  for (const p of PARTES_ESPANA.formatToParts(new Date(iso))) r[p.type] = p.value
  return r
}

/** El día en España, «AAAA-MM-DD» */
export function diaEspana(iso: string | number | Date): string {
  const p = partesEspana(iso)
  return `${p.year}-${p.month}-${p.day}`
}

/** La hora en España, «HH:MM» */
export function horaEspana(iso: string | number | Date): string {
  const p = partesEspana(iso)
  return `${p.hour === '24' ? '00' : p.hour}:${p.minute}`
}

/** Suma días a un «AAAA-MM-DD» (en calendario, sin husos) */
export function sumarDias(dia: string, n: number): string {
  return new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

/** El instante (ISO, UTC) en que empieza un día de España */
export function inicioDelDiaEspana(dia: string): string {
  const guess = Date.parse(`${dia}T00:00:00Z`)
  const p = partesEspana(guess)
  const comoUtc = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}:00Z`)
  return new Date(guess - (comoUtc - guess)).toISOString()
}

const DIAS_SEMANA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** «Hoy», «Ayer» o «mié 18 nov» (los dos días en España) */
export function etiquetaDeDia(dia: string, hoy: string): string {
  if (dia === hoy) return 'Hoy'
  if (dia === sumarDias(hoy, -1)) return 'Ayer'
  const d = new Date(`${dia}T12:00:00Z`)
  return `${DIAS_SEMANA[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`
}

/** El rol de una campaña por su nombre (la nomenclatura «ASIN | SKU | RESUMEN | ROL») */
export function rolDeNombre(nombre: string | null | undefined): Rol | null {
  return nombre ? (partesDeNombre(nombre)?.rol ?? null) : null
}

/** El ASIN de una campaña por su nombre (o null si no sigue la nomenclatura ni lo lleva) */
export function asinDeNombre(nombre: string | null | undefined): string | null {
  if (!nombre) return null
  const p = partesDeNombre(nombre)
  if (p && /^B0[A-Z0-9]{8}$/.test(p.asin)) return p.asin
  return nombre.toUpperCase().match(/\bB0[A-Z0-9]{8}\b/)?.[0] ?? null
}

const ROL_CORTO: Record<Rol, string> = {
  'AUTO RADAR': 'AUTO RADAR',
  'MANUAL AMPLIA': 'MANUAL AMPLIA',
  'MANUAL EXACTA / DOMINIO': 'EXACTA DOMINIO',
  'MANUAL EXACTA / ESTABILIDAD': 'EXACTA ESTABILIDAD',
  'ATAQUE ASIN': 'ATAQUE ASIN',
}

/** «EXACTA DOMINIO» en vez de «MANUAL EXACTA / DOMINIO», para frases */
export function rolCorto(rol: string | null | undefined): string {
  return rol && rol in ROL_CORTO ? ROL_CORTO[rol as Rol] : (rol ?? '')
}

const ROLES_VALIDOS = new Set<string>(Object.keys(ROL_CORTO))
const comoRol = (r: string | null | undefined): Rol | null => (r && ROLES_VALIDOS.has(r) ? (r as Rol) : null)

/* ------------------------------------------------------------------ */
/* Clasificar y describir una fila del log                             */
/* ------------------------------------------------------------------ */

const esPuja = (campo: string | null) => /^puja de /i.test(campo ?? '')
const esPresupuesto = (campo: string | null) => (campo ?? '').trim().toLowerCase() === 'presupuesto diario'

/** Qué clase de cosa es una fila del log (para el icono, el resumen y el filtro) */
export function clasificarEntrada(f: Pick<FilaDeLogFlujo, 'entidad' | 'accion' | 'campo' | 'valorAnterior' | 'valorNuevo'>): ClaseDeAccion {
  switch (f.accion) {
    case 'deshacer':
      return 'deshacer'
    case 'negativizar':
      return 'negativa'
    case 'promover':
      return 'cosecha'
    case 'pausar':
      return 'pausa'
    case 'activar':
      return 'activa'
    case 'descartar':
      return 'descartada'
    case 'crear':
      return 'crear'
    case 'cambiar': {
      const puja = esPuja(f.campo)
      const presupuesto = esPresupuesto(f.campo)
      if (!puja && !presupuesto) return 'otro'
      const de = numeroDeTexto(f.valorAnterior)
      const a = numeroDeTexto(f.valorNuevo)
      if (de == null || a == null || de === a) return 'otro'
      if (puja) return a > de ? 'puja_sube' : 'puja_baja'
      return a > de ? 'presupuesto_sube' : 'presupuesto_baja'
    }
    default:
      return 'otro'
  }
}

/** El término de una fila de negativa, cosecha o deshacer (en las fallidas va en `campo`) */
export function terminoDeFila(f: Pick<FilaDeLogFlujo, 'accion' | 'campo' | 'valorNuevo' | 'valorAnterior' | 'ok'>): string | null {
  if (f.accion === 'negativizar') return (f.ok && f.valorNuevo ? f.valorNuevo : f.campo)?.trim() || null
  if (f.accion === 'promover') {
    if (f.ok && f.valorNuevo) return f.valorNuevo.split(' → ')[0].trim() || null
    return f.campo?.trim() || null
  }
  if (f.accion === 'deshacer') return f.valorAnterior?.trim() || f.campo?.trim() || null
  return null
}

/** El texto entre «…» de un campo como «puja de «jamón»» o «estado de «ASIN B0…»» */
const entreComillas = (t: string | null) => t?.match(/«(.+)»/)?.[1] ?? null

/** «5 clics (1,22) sin pedido» sacado del motivo, para la frase */
function cifraDelMotivo(motivo: string | null): string | null {
  const m = (motivo ?? '').match(/(\d+) clics? \(([\d.,]+)\) sin pedido/)
  return m ? `${m[1]} ${m[1] === '1' ? 'clic' : 'clics'} (${m[2]}) sin pedido` : null
}

/** Lo que se ha hecho, en una frase para alguien que no sabe de PPC: «Se ha negativizado "crocs" en AUTO RADAR (exacta): 5 clics (1,22) sin pedido» */
export function fraseDeAccion(f: FilaDeLogFlujo, clase: ClaseDeAccion = clasificarEntrada(f)): string {
  const rol = rolDeNombre(f.nombreCampana)
  const donde = rol ? rolCorto(rol) : (f.nombreCampana ?? 'la cuenta')
  const termino = terminoDeFila(f)
  switch (clase) {
    case 'negativa': {
      const tipo = /productos/i.test(f.campo ?? '') ? 'producto' : 'exacta'
      if (!f.ok) return `No se ha podido negativizar "${termino ?? '¿?'}" en ${donde}`
      const cifra = cifraDelMotivo(f.motivo)
      return `Se ha negativizado "${termino ?? '¿?'}" en ${donde} (${tipo})${cifra ? `: ${cifra}` : ''}`
    }
    case 'cosecha': {
      const desde = rolCorto(f.valorAnterior)
      if (!f.ok) return `No se ha podido pasar "${termino ?? '¿?'}" a ${donde}`
      return `Se ha pasado "${termino ?? '¿?'}" de ${desde || 'otra campaña'} a ${donde}`
    }
    case 'puja_sube':
    case 'puja_baja':
      return `Se ha ${clase === 'puja_sube' ? 'subido' : 'bajado'} la puja de «${entreComillas(f.campo) ?? '¿?'}» en ${donde}`
    case 'presupuesto_sube':
    case 'presupuesto_baja':
      return `Se ha ${clase === 'presupuesto_sube' ? 'subido' : 'bajado'} el presupuesto diario de ${donde}`
    case 'pausa': {
      const que = entreComillas(f.campo)
      if (!f.ok) return `No se ha podido pausar ${que ? `«${que}»` : 'la campaña'} en ${donde}`
      return que ? `Se ha pausado «${que}» en ${donde}` : `Se ha pausado la campaña ${donde}`
    }
    case 'activa': {
      const que = entreComillas(f.campo)
      return que ? `Se ha reactivado «${que}» en ${donde}` : `Se ha activado la campaña ${donde}`
    }
    case 'deshacer': {
      if (!f.ok) return `No se ha podido deshacer un cambio en ${donde}`
      if (esPuja(f.campo)) return `Se ha deshecho el cambio de puja de «${entreComillas(f.campo) ?? '¿?'}» en ${donde}`
      if (esPresupuesto(f.campo)) return `Se ha deshecho el cambio de presupuesto de ${donde}`
      return `Se ha quitado "${termino ?? '¿?'}" de ${donde} (deshecho)`
    }
    case 'descartada':
      return `Se ha descartado una propuesta${f.campo ? ` (${f.campo})` : ''}`
    case 'crear':
      return f.ok ? `Se ha creado ${f.entidad === 'campaña' ? 'la campaña' : `un ${f.entidad}`} ${donde}` : `No se ha podido crear ${f.entidad === 'campaña' ? 'la campaña' : `un ${f.entidad}`} ${donde}`
    default: {
      if (f.entidad === 'ficha') return f.accion === 'firmar' ? 'Se ha firmado la ficha de la cuenta' : f.accion === 'quitar-firma' ? 'Se ha quitado la firma de la ficha' : `Se ha cambiado «${f.campo ?? '¿?'}» en la ficha de la cuenta`
      if (f.entidad === 'motor' || /modo del motor/i.test(f.campo ?? '')) return 'Se ha cambiado el modo del motor'
      if (f.accion === 'archivar') return `Se ha archivado la campaña ${donde}`
      if (f.accion === 'cambiar' && f.campo) return `Se ha cambiado «${f.campo}» en ${donde}`
      return `${f.accion.charAt(0).toUpperCase()}${f.accion.slice(1)} · ${f.entidad}${f.campo ? ` · ${f.campo}` : ''}`
    }
  }
}

/** Quién lo hizo, en palabras: «Agente PPC», «Motor · aprobada por Ana», «Ana (a mano)», «Ensayo»… */
export function quienDeFila(f: Pick<FilaDeLogFlujo, 'origen' | 'motivo' | 'persona' | 'propuestaId'>, origenDePropuesta: string | null): { texto: string; tipo: QuienDeTermino } {
  if (f.origen === 'ensayo') return { texto: 'Ensayo', tipo: 'ensayo' }
  const sinPersona = quienSinPersona(f.origen, f.motivo)
  if (sinPersona === 'Agente PPC') return { texto: 'Agente PPC', tipo: 'agente' }
  if (f.persona) {
    if (f.propuestaId && origenDePropuesta) return { texto: `${origenDePropuesta === 'agente' ? 'Agente' : 'Motor'} · aprobada por ${f.persona}`, tipo: 'persona' }
    return { texto: `${f.persona} (a mano)`, tipo: 'persona' }
  }
  if (f.origen === 'estructura') return { texto: 'Crear campañas', tipo: 'persona' }
  if (f.origen === 'manual') return { texto: f.propuestaId ? 'Motor · aprobada a mano' : 'A mano', tipo: 'persona' }
  return { texto: sinPersona || 'Motor', tipo: 'motor' }
}

/* ------------------------------------------------------------------ */
/* El flujo de un producto                                             */
/* ------------------------------------------------------------------ */

const PRIORIDAD_DE_ESTADO: Record<EstadoDeTermino, number> = { hecho: 0, deshecho: 1, fallido: 2, ensayada: 3, pendiente: 4, caducada: 5, descartada: 6 }

function estadoDePropuesta(estado: string): EstadoDeTermino | null {
  switch (estado) {
    case 'aplicada':
      return 'hecho'
    case 'deshecha':
      return 'deshecho'
    case 'error':
      return 'fallido'
    case 'pendiente':
      return 'pendiente'
    case 'caducada':
      return 'caducada'
    case 'descartada':
    case 'obsoleta':
      return 'descartada'
    case 'ensayada':
      return 'ensayada'
    default:
      return null
  }
}

/** El motivo que se enseña de una propuesta que no se ha hecho: por qué caducó o por qué está retenida */
export function motivoDeNoHecha(p: Pick<PropuestaFlujo, 'estado' | 'error' | 'retenidaMotivo' | 'motivo'>): string {
  if (p.estado === 'caducada' && p.error) return p.error.replace(/^Caducada por el agente:\s*/i, '')
  if (p.retenidaMotivo) return `Retenida: ${p.retenidaMotivo}`
  if (p.error) return p.error
  return p.motivo ?? ''
}

function antesDe(m: MetricasDePropuesta | null | undefined): CifrasAntes | null {
  if (!m || (m.clics == null && m.pedidos == null)) return null
  return { clics: Number(m.clics ?? 0), pedidos: Number(m.pedidos ?? 0), gasto: Number(m.gasto ?? 0), ventas: Number(m.ventas ?? 0), acosPct: m.acosPct == null ? null : Number(m.acosPct) }
}

export interface EntradaDelFlujo {
  asin: string
  /** Todas las filas del log del periodo (se quedan las de las campañas de este producto) */
  filas: readonly FilaDeLogFlujo[]
  /** Las propuestas del periodo y las que nombran las filas */
  propuestas: readonly PropuestaFlujo[]
  /** Campañas conocidas de la cuenta (de ads_estructuras y del log) */
  campanas: readonly CampanaConocida[]
  diasDeObjetivo: readonly DiaDeObjetivo[]
  efectos: readonly EfectoFlujo[]
  conPropuestas: boolean
}

/**
 * EL FLUJO de un producto: las campañas (nodos), las flechas (cosechas de una a otra y negativas al «sumidero») y la lista de términos de cada flecha.
 * Junta las dos filas de cada cosecha por su propuesta, marca lo deshecho y, si se pide, añade lo propuesto que no se ha hecho.
 */
export function construirFlujo(e: EntradaDelFlujo): Flujo {
  const asin = e.asin.toUpperCase()
  const propuestaPorId = new Map(e.propuestas.map((p) => [p.id, p]))
  const veredictoPorPropuesta = new Map(e.efectos.filter((x) => x.veredicto).map((x) => [x.propuestaId, x.veredicto as string]))

  // ---- los nodos: las campañas del producto ----
  const nodos = new Map<string, NodoDeFlujo>()
  const nuevoNodo = (id: string, nombre: string, rol: Rol, hipotetica = false): NodoDeFlujo => ({ id, rol, nombre, entran: 0, salen: 0, negativas: 0, pujas: { suben: 0, bajan: 0 }, presupuesto: null, ...(hipotetica ? { hipotetica } : {}) })
  const anadirCampana = (id: string | null, nombre: string | null, rolDado?: string | null) => {
    if (!id || nodos.has(id)) return
    if (asinDeNombre(nombre) !== asin) return
    const rol = rolDeNombre(nombre) ?? comoRol(rolDado)
    if (!rol) return
    nodos.set(id, nuevoNodo(id, nombre ?? id, rol))
  }
  for (const c of e.campanas) anadirCampana(c.campaignId, c.nombre, c.rol)
  for (const f of e.filas) anadirCampana(f.campaignId, f.nombreCampana)
  for (const p of e.propuestas) {
    if ((p.asin ?? '').toUpperCase() !== asin && asinDeNombre(p.campaignNombre) !== asin) continue
    anadirCampana(p.campaignId, p.campaignNombre ?? `${asin} | | | ${p.desdeRol ?? ''}`, p.desdeRol)
    anadirCampana(p.haciaCampaignId, p.haciaCampaignNombre ?? `${asin} | | | ${p.haciaRol ?? ''}`, p.haciaRol)
  }
  const nodoDeRol = (rol: string | null | undefined): string | null => {
    const r = comoRol(rol)
    if (!r) return null
    for (const n of nodos.values()) if (n.rol === r && !n.hipotetica) return n.id
    const id = `rol:${r}`
    if (!nodos.has(id)) nodos.set(id, nuevoNodo(id, `${rolCorto(r)} (todavía no existe)`, r, true))
    return id
  }

  const filas = e.filas.filter((f) => f.campaignId && nodos.has(f.campaignId))

  // ---- lo deshecho: por propuesta ----
  const deshechas = new Set<string>()
  for (const f of filas) if (f.accion === 'deshacer' && f.ok && f.propuestaId) deshechas.add(f.propuestaId)
  for (const p of e.propuestas) if (p.estado === 'deshecha') deshechas.add(p.id)

  // ---- las flechas y los términos ----
  const flechas = new Map<string, FlechaDeFlujo>()
  const flecha = (tipo: 'cosecha' | 'negativa', desde: string, hacia: string) => {
    const id = `${tipo}:${desde}>${hacia}`
    let x = flechas.get(id)
    if (!x) flechas.set(id, (x = { id, desde, hacia, tipo, hechos: 0, propuestos: 0, deshechos: 0, fallidos: 0 }))
    return x
  }
  const terminos = new Map<string, TerminoDeFlujo>()
  const cuenta = (fl: FlechaDeFlujo, estado: EstadoDeTermino) => {
    if (estado === 'hecho') fl.hechos++
    else if (estado === 'deshecho') fl.deshechos++
    else if (estado === 'fallido') fl.fallidos++
    else fl.propuestos++
  }
  const poner = (t: TerminoDeFlujo) => {
    const ya = terminos.get(t.id)
    if (ya && PRIORIDAD_DE_ESTADO[ya.estado] <= PRIORIDAD_DE_ESTADO[t.estado]) return
    terminos.set(t.id, t)
  }

  const quienYPersona = (f: FilaDeLogFlujo) => {
    const p = f.propuestaId ? propuestaPorId.get(f.propuestaId) : undefined
    const q = quienDeFila(f, p?.origen ?? null)
    return { quien: q.tipo, persona: f.persona }
  }
  const estadoDeFila = (f: FilaDeLogFlujo): EstadoDeTermino => (!f.ok ? 'fallido' : f.origen === 'ensayo' ? 'ensayada' : f.propuestaId && deshechas.has(f.propuestaId) ? 'deshecho' : 'hecho')

  // 1) Cosechas del log (la fila «promover» en el destino) y su negativa en origen
  const negativaDeCosecha = new Map<string, FilaDeLogFlujo>()
  const cosechas = filas.filter((f) => f.accion === 'promover')
  const propuestasDeCosecha = new Set(cosechas.map((f) => f.propuestaId).filter((x): x is string => !!x))
  for (const f of filas) if (f.accion === 'negativizar' && f.propuestaId && propuestasDeCosecha.has(f.propuestaId)) negativaDeCosecha.set(f.propuestaId, f)

  for (const f of cosechas) {
    const p = f.propuestaId ? propuestaPorId.get(f.propuestaId) : undefined
    const neg = f.propuestaId ? negativaDeCosecha.get(f.propuestaId) : undefined
    const origen = neg?.campaignId ?? (p?.campaignId && nodos.has(p.campaignId) ? p.campaignId : null) ?? nodoDeRol(f.valorAnterior ?? p?.desdeRol)
    const destino = f.campaignId as string
    if (!origen) continue
    const fl = flecha('cosecha', origen, destino)
    const estado = estadoDeFila(f)
    const termino = terminoDeFila(f) ?? p?.termino ?? '¿?'
    cuenta(fl, estado)
    if (estado === 'hecho') {
      nodos.get(destino)!.entran++
      nodos.get(origen)!.salen++
    }
    poner({
      id: f.propuestaId ?? f.id,
      flechaId: fl.id,
      termino,
      esAsin: f.entidad === 'target' || pareceAsin(termino),
      fecha: f.creadoAt,
      ...quienYPersona(f),
      estado,
      concordancia: f.entidad === 'target' ? 'producto' : /frase/i.test(f.campo ?? '') ? 'frase' : 'exacta',
      negativizadoEnOrigen: Boolean(neg?.ok) || Boolean(p?.negativizarEnOrigen && estado === 'hecho'),
      motivo: f.motivo ?? p?.motivo ?? '',
      antes: antesDe(p?.metricas),
      despues: null,
      veredicto: f.propuestaId ? (veredictoPorPropuesta.get(f.propuestaId) ?? null) : null,
      propuestaId: f.propuestaId,
      logId: f.id,
    })
  }

  // 2) Negativas del log que no son parte de una cosecha
  for (const f of filas) {
    if (f.accion !== 'negativizar') continue
    if (f.propuestaId && propuestasDeCosecha.has(f.propuestaId)) {
      if (f.ok && f.origen !== 'ensayo') nodos.get(f.campaignId as string)!.negativas++
      continue
    }
    const p = f.propuestaId ? propuestaPorId.get(f.propuestaId) : undefined
    const fl = flecha('negativa', f.campaignId as string, SUMIDERO)
    const estado = estadoDeFila(f)
    cuenta(fl, estado)
    if (estado === 'hecho') nodos.get(f.campaignId as string)!.negativas++
    const termino = terminoDeFila(f) ?? p?.termino ?? '¿?'
    poner({
      id: f.propuestaId ?? f.id,
      flechaId: fl.id,
      termino,
      esAsin: /productos/i.test(f.campo ?? '') || pareceAsin(termino),
      fecha: f.creadoAt,
      ...quienYPersona(f),
      estado,
      concordancia: /productos/i.test(f.campo ?? '') ? 'producto' : f.ok ? 'exacta' : null,
      negativizadoEnOrigen: false,
      motivo: f.motivo ?? p?.motivo ?? '',
      antes: antesDe(p?.metricas),
      despues: null,
      veredicto: f.propuestaId ? (veredictoPorPropuesta.get(f.propuestaId) ?? null) : null,
      propuestaId: f.propuestaId,
      logId: f.id,
    })
  }

  // 3) Pujas y presupuestos (solo lo hecho de verdad)
  const presupuestos = filas.filter((f) => f.ok && f.origen !== 'ensayo' && f.accion === 'cambiar' && esPresupuesto(f.campo)).sort((a, b) => a.creadoAt.localeCompare(b.creadoAt))
  for (const f of filas) {
    if (!f.ok || f.origen === 'ensayo') continue
    const c = clasificarEntrada(f)
    const n = nodos.get(f.campaignId as string)!
    if (c === 'puja_sube') n.pujas.suben++
    else if (c === 'puja_baja') n.pujas.bajan++
  }
  for (const f of presupuestos) {
    const n = nodos.get(f.campaignId as string)!
    const de = numeroDeTexto(f.valorAnterior)
    const a = numeroDeTexto(f.valorNuevo)
    if (de == null || a == null) continue
    n.presupuesto = n.presupuesto ? { de: n.presupuesto.de, a } : { de, a }
  }

  // 4) Lo propuesto que no está en el log (pendiente, caducado, descartado, ensayado…)
  if (e.conPropuestas) {
    for (const p of e.propuestas) {
      if (p.tipo !== 'promover' && p.tipo !== 'negativizar') continue
      if ((p.asin ?? '').toUpperCase() !== asin && asinDeNombre(p.campaignNombre) !== asin) continue
      if (terminos.has(p.id)) continue
      const estado = estadoDePropuesta(p.estado)
      if (!estado || estado === 'hecho' || estado === 'deshecho') continue // lo hecho ya sale del log
      const origen = p.campaignId && nodos.has(p.campaignId) ? p.campaignId : nodoDeRol(p.desdeRol)
      if (!origen) continue
      let fl: FlechaDeFlujo
      if (p.tipo === 'promover') {
        const destino = p.haciaCampaignId && nodos.has(p.haciaCampaignId) ? p.haciaCampaignId : nodoDeRol(p.haciaRol)
        if (!destino) continue
        fl = flecha('cosecha', origen, destino)
      } else fl = flecha('negativa', origen, SUMIDERO)
      cuenta(fl, estado)
      const termino = p.termino ?? '¿?'
      const conc = (p.metricas?.concordancia ?? '').toLowerCase()
      poner({
        id: p.id,
        flechaId: fl.id,
        termino,
        esAsin: pareceAsin(termino),
        fecha: p.resueltaAt ?? p.retenidaAt ?? p.creadaAt,
        quien: p.origen === 'agente' ? 'agente' : 'motor',
        persona: p.resueltaPor,
        estado,
        concordancia: pareceAsin(termino) ? 'producto' : conc.includes('fras') || conc === 'phrase' ? 'frase' : p.tipo === 'promover' ? ((p.haciaRol ?? '').includes('EXACTA') ? 'exacta' : 'frase') : 'exacta',
        negativizadoEnOrigen: false,
        motivo: estado === 'pendiente' && !p.retenidaMotivo ? (p.motivo ?? '') : motivoDeNoHecha(p),
        antes: antesDe(p.metricas),
        despues: null,
        veredicto: veredictoPorPropuesta.get(p.id) ?? null,
        propuestaId: p.id,
        logId: null,
      })
    }
  }

  // 5) El «después» de cada cosecha hecha: lo que lleva la keyword nueva desde el día en que se creó
  const entidadDeTermino = new Map<string, string>()
  for (const f of cosechas) if (f.ok && f.entidadId) entidadDeTermino.set(f.propuestaId ?? f.id, f.entidadId)
  for (const t of terminos.values()) {
    const objetivo = entidadDeTermino.get(t.id)
    if (!objetivo || (t.estado !== 'hecho' && t.estado !== 'deshecho')) continue
    const desde = diaEspana(t.fecha)
    const d: CifrasDespues = { desde, clics: 0, pedidos: 0, gasto: 0, ventas: 0 }
    for (const x of e.diasDeObjetivo) {
      if (x.objetivoId !== objetivo || x.fecha < desde) continue
      d.clics += x.clics
      d.pedidos += x.pedidos
      d.gasto += x.gasto
      d.ventas += x.ventas
    }
    d.gasto = Math.round(d.gasto * 100) / 100
    d.ventas = Math.round(d.ventas * 100) / 100
    t.despues = d
  }

  // El sumidero solo si alguna flecha llega a él (o, sin flechas, para que el dibujo tenga suelo)
  const lista = [...nodos.values()]
  const totalNegativas = [...flechas.values()].filter((f) => f.tipo === 'negativa').reduce((s, f) => s + f.hechos, 0)
  lista.push({ id: SUMIDERO, rol: 'NEGATIVIZADAS', nombre: 'Negativizadas', entran: totalNegativas, salen: 0, negativas: 0, pujas: { suben: 0, bajan: 0 }, presupuesto: null })

  return {
    nodos: lista,
    flechas: [...flechas.values()].sort((a, b) => b.hechos + b.propuestos - (a.hechos + a.propuestos)),
    terminos: [...terminos.values()].sort((a, b) => b.fecha.localeCompare(a.fecha)),
  }
}

/* ------------------------------------------------------------------ */
/* El diario por días                                                  */
/* ------------------------------------------------------------------ */

export function resumenDelDia(acciones: readonly AccionDelDia[]): ResumenDelDia {
  const r: ResumenDelDia = { pujasSuben: 0, pujasBajan: 0, negativas: 0, cosechas: 0, pausas: 0, presupuestosSuben: 0, presupuestosBajan: 0, deshechos: 0, fallidos: 0, ensayos: 0 }
  for (const a of acciones) {
    if (!a.ok) {
      r.fallidos++
      continue
    }
    if (a.ensayo) {
      r.ensayos++
      continue
    }
    if (a.deshecho) r.deshechos++
    if (a.deshecho && a.clase !== 'deshacer') continue
    switch (a.clase) {
      case 'puja_sube':
        r.pujasSuben++
        break
      case 'puja_baja':
        r.pujasBajan++
        break
      case 'negativa':
        r.negativas++
        break
      case 'cosecha':
        r.cosechas++
        break
      case 'pausa':
        r.pausas++
        break
      case 'presupuesto_sube':
        r.presupuestosSuben++
        break
      case 'presupuesto_baja':
        r.presupuestosBajan++
        break
      case 'deshacer':
        r.deshechos++
        break
    }
  }
  return r
}

/** Los tipos de nota del agente que son de UN producto (llevan su nombre o su ASIN); el resto son de toda la cuenta */
const NOTAS_DE_PRODUCTO = new Set(['postura', 'objetivo_auto', 'agotada_top'])

export interface EntradaDelDiario {
  filas: readonly FilaDeLogFlujo[]
  propuestas: readonly PropuestaFlujo[]
  eventos: readonly EventoFlujo[]
  /** Si se da, solo lo de este producto (y las notas de toda la cuenta como contexto) */
  asin: string | null
  /** Primer día del periodo (España); lo de antes no se enseña */
  desde: string
  hoy: string
}

/**
 * EL DIARIO: un bloque por día (el más reciente arriba) con lo que se ha hecho, lo que NO y por qué (caducadas y retenidas) y las notas del agente.
 * Lo de «Crear campañas» se resume en una línea por producto y día; la negativa en origen de una cosecha va dentro de la línea de la cosecha.
 */
export function construirDiario(e: EntradaDelDiario): DiaDelDiario[] {
  const asin = e.asin?.toUpperCase() ?? null
  const propuestaPorId = new Map(e.propuestas.map((p) => [p.id, p]))
  const deshechas = new Set<string>()
  for (const f of e.filas) if (f.accion === 'deshacer' && f.ok && f.propuestaId) deshechas.add(f.propuestaId)
  for (const p of e.propuestas) if (p.estado === 'deshecha') deshechas.add(p.id)

  const delProducto = (nombre: string | null) => !asin || asinDeNombre(nombre) === asin
  const filas = e.filas.filter((f) => delProducto(f.nombreCampana) && (!asin || f.campaignId))
  const cosechaPorPropuesta = new Map<string, FilaDeLogFlujo>()
  for (const f of filas) if (f.accion === 'promover' && f.propuestaId) cosechaPorPropuesta.set(f.propuestaId, f)

  const dias = new Map<string, DiaDelDiario>()
  const dia = (d: string) => {
    let x = dias.get(d)
    if (!x) dias.set(d, (x = { dia: d, etiqueta: etiquetaDeDia(d, e.hoy), resumen: resumenDelDia([]), acciones: [], noHechas: [], notas: [] }))
    return x
  }

  // «Crear campañas»: una línea por producto y día
  const creadas = new Map<string, { dia: string; asin: string | null; resumen: string | null; campanas: number; fallos: number; ultima: FilaDeLogFlujo; quien: string }>()

  for (const f of filas) {
    const d = diaEspana(f.creadoAt)
    if (d < e.desde) continue
    if (f.origen === 'estructura' && f.accion !== 'archivar') {
      const a = asinDeNombre(f.nombreCampana)
      const clave = `${d}|${a ?? '-'}`
      let c = creadas.get(clave)
      if (!c) creadas.set(clave, (c = { dia: d, asin: a, resumen: f.nombreCampana ? (partesDeNombre(f.nombreCampana)?.resumen ?? null) : null, campanas: 0, fallos: 0, ultima: f, quien: f.persona ?? 'Crear campañas' }))
      if (f.entidad === 'campaña' && f.accion === 'crear') {
        if (f.ok) c.campanas++
        else c.fallos++
      }
      if (f.creadoAt > c.ultima.creadoAt) c.ultima = f
      continue
    }
    // La negativa en origen de una cosecha va dentro de su línea
    if (f.accion === 'negativizar' && f.ok && f.propuestaId && cosechaPorPropuesta.has(f.propuestaId)) continue
    const clase = clasificarEntrada(f)
    const p = f.propuestaId ? propuestaPorId.get(f.propuestaId) : undefined
    let frase = fraseDeAccion(f, clase)
    if (clase === 'cosecha' && f.ok) {
      const neg = filas.find((x) => x.accion === 'negativizar' && x.ok && x.propuestaId === f.propuestaId)
      if (neg) frase += ` y se ha negativizado en ${rolCorto(rolDeNombre(neg.nombreCampana)) || 'la de origen'}`
    }
    const conValores = clase === 'puja_sube' || clase === 'puja_baja' || clase === 'presupuesto_sube' || clase === 'presupuesto_baja' || (clase === 'deshacer' && (esPuja(f.campo) || esPresupuesto(f.campo))) || (clase === 'otro' && f.accion === 'cambiar')
    dia(d).acciones.push({
      id: f.id,
      hora: horaEspana(f.creadoAt),
      clase,
      frase,
      de: conValores ? f.valorAnterior : null,
      a: conValores ? f.valorNuevo : null,
      campaignId: f.campaignId,
      rol: rolDeNombre(f.nombreCampana),
      asin: asinDeNombre(f.nombreCampana),
      motivo: f.ok ? f.motivo : f.error ? `${f.error}${f.motivo ? ` · ${f.motivo}` : ''}` : f.motivo,
      quien: quienDeFila(f, p?.origen ?? null).texto,
      ok: f.ok,
      deshecho: clase !== 'deshacer' && Boolean(f.propuestaId && deshechas.has(f.propuestaId)),
      ensayo: f.origen === 'ensayo',
      propuestaId: f.propuestaId,
    })
  }
  for (const c of creadas.values()) {
    const n = c.campanas
    const de = c.asin ? `de ${c.asin}${c.resumen ? ` (${c.resumen})` : ''}` : ''
    const frase = n > 0 ? `Se ${n === 1 ? 'ha creado 1 campaña' : `han creado ${n} campañas`} ${de}`.trim() : `Se han añadido grupos, anuncios o segmentaciones ${de}`.trim()
    dia(c.dia).acciones.push({
      id: `crear:${c.dia}:${c.asin ?? '-'}`,
      hora: horaEspana(c.ultima.creadoAt),
      clase: 'crear',
      frase: c.fallos > 0 ? `${frase} (${c.fallos} no se ${c.fallos === 1 ? 'ha' : 'han'} podido crear)` : frase,
      de: null,
      a: null,
      campaignId: null,
      rol: null,
      asin: c.asin,
      motivo: null,
      quien: c.quien,
      ok: c.fallos === 0 || n > 0,
      deshecho: false,
      ensayo: false,
      propuestaId: null,
    })
  }

  // Lo que NO se ha hecho: caducadas, retenidas y con error
  for (const p of e.propuestas) {
    if (asin && (p.asin ?? '').toUpperCase() !== asin && asinDeNombre(p.campaignNombre) !== asin) continue
    let cuando: string | null = null
    if (p.estado === 'caducada') cuando = p.resueltaAt ?? p.creadaAt
    else if (p.estado === 'pendiente' && p.retenidaMotivo) cuando = p.retenidaAt ?? p.creadaAt
    else if (p.estado === 'error') cuando = p.resueltaAt ?? p.creadaAt
    if (!cuando) continue
    const d = diaEspana(cuando)
    if (d < e.desde) continue
    dia(d).noHechas.push({ id: p.id, termino: p.termino ?? '', tipo: p.tipo, campaignId: p.campaignId ?? '', rol: rolDeNombre(p.campaignNombre) ?? comoRol(p.desdeRol), motivo: motivoDeNoHecha(p) })
  }

  // Las notas del agente: las de toda la cuenta siempre; las de un producto, solo si son de este
  for (const ev of e.eventos) {
    const d = diaEspana(ev.creadoAt)
    if (d < e.desde) continue
    if (asin && NOTAS_DE_PRODUCTO.has(ev.tipo) && !`${ev.titulo} ${ev.detalle ?? ''} ${ev.datosTexto}`.toUpperCase().includes(asin)) continue
    dia(d).notas.push({ id: ev.id, hora: horaEspana(ev.creadoAt), tipo: ev.tipo, titulo: ev.titulo, detalle: ev.detalle })
  }

  const salida = [...dias.values()].sort((a, b) => b.dia.localeCompare(a.dia))
  for (const x of salida) {
    x.acciones.sort((a, b) => b.hora.localeCompare(a.hora))
    x.notas.sort((a, b) => b.hora.localeCompare(a.hora))
    x.resumen = resumenDelDia(x.acciones)
  }
  return salida
}

/* ------------------------------------------------------------------ */
/* El selector de productos                                            */
/* ------------------------------------------------------------------ */

export interface ProductoDelFlujo {
  asin: string
  resumen: string
  cambios: number
  roles: Rol[]
}

/** Los productos con algo en el periodo, los que más cambios tienen primero */
export function productosDelPeriodo(filas: readonly FilaDeLogFlujo[], propuestas: readonly PropuestaFlujo[], campanas: readonly CampanaConocida[]): ProductoDelFlujo[] {
  const por = new Map<string, { resumen: string; cambios: number; roles: Set<Rol> }>()
  const tocar = (nombre: string | null, asinDado?: string | null, cambio = 0) => {
    const asin = asinDado?.toUpperCase() || asinDeNombre(nombre)
    if (!asin) return
    let x = por.get(asin)
    if (!x) por.set(asin, (x = { resumen: '', cambios: 0, roles: new Set() }))
    const p = nombre ? partesDeNombre(nombre) : null
    if (p && asinDeNombre(nombre) === asin) {
      if (!x.resumen && p.resumen) x.resumen = p.resumen
      x.roles.add(p.rol)
    }
    x.cambios += cambio
  }
  for (const f of filas) tocar(f.nombreCampana, null, 1)
  for (const p of propuestas) tocar(p.campaignNombre, p.asin)
  for (const c of campanas) {
    const asin = asinDeNombre(c.nombre)
    if (asin && por.has(asin)) tocar(c.nombre, asin)
  }
  const orden: Rol[] = ['AUTO RADAR', 'MANUAL AMPLIA', 'MANUAL EXACTA / DOMINIO', 'MANUAL EXACTA / ESTABILIDAD', 'ATAQUE ASIN']
  return [...por.entries()]
    .map(([asin, x]) => ({ asin, resumen: x.resumen, cambios: x.cambios, roles: orden.filter((r) => x.roles.has(r)) }))
    .sort((a, b) => b.cambios - a.cambios || a.asin.localeCompare(b.asin))
}

