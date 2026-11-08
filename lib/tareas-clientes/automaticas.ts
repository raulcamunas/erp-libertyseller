import { bloqueNuevo, type Bloque } from './bloques'
import { sinAcentos } from './busqueda'

/**
 * LAS TAREAS QUE CREA EL PROPIO ERP — PURO.
 *
 * Cuando algo grave pasa en la cuenta de un cliente (una alerta de logística FBA, listings suprimidos con stock) el ERP lo convierte en una TAREA de ese cliente, en su tablero,
 * para que no dependa de que alguien mire la pantalla de alertas. Reglas que lo hacen seguro:
 *
 *   · Cada propuesta lleva una CLAVE (`origen_ref`). Mientras exista una tarea con esa clave —aunque esté hecha o archivada— NO se crea otra: borrar o terminar la tarea no la resucita.
 *   · Solo lo grave: alertas críticas o altas. Lo demás se queda en su pantalla.
 *   · Nace APAGADO: cada fuente la enciende un administrador, y elige en qué columna caen y a quién se asignan.
 */

export type FuenteAutomatica = 'fba' | 'cumplimiento'

export const FUENTES: ReadonlyArray<{ id: FuenteAutomatica; nombre: string; que: string; donde: string }> = [
  { id: 'fba', nombre: 'Alertas de logística FBA', que: 'Cada alerta crítica o alta (rotura de stock, envío atascado o incompleto, descuadre) abre una tarea en el cliente.', donde: 'Remesas › Alertas' },
  { id: 'cumplimiento', nombre: 'Listings suprimidos con stock', que: 'Una tarea por semana y cliente cuando Amazon tiene suprimidos listings que tienen stock, con los primeros SKU.', donde: 'Growth › Cumplimiento' },
]

export interface PropuestaDeTarea {
  /** Única por cliente: es lo que impide crear dos veces lo mismo */
  clave: string
  fuente: FuenteAutomatica
  titulo: string
  icono: string
  departamento: string
  contenido: Bloque[]
}

export interface AlertaFba {
  clave: string
  tipo: string
  severidad: 'critica' | 'alta' | 'media' | 'info'
  titulo: string
  detalle: string | null
  sku: string | null
  estado: 'abierta' | 'resuelta' | 'silenciada'
}

const p = (t: string): Bloque => bloqueNuevo('parrafo', t)
const punto = (t: string): Bloque => bloqueNuevo('vineta', t)

/** Las alertas que merecen tarea: abiertas y de gravedad crítica o alta */
export function propuestasDeAlertasFba(alertas: readonly AlertaFba[]): PropuestaDeTarea[] {
  return alertas
    .filter((a) => a.estado === 'abierta' && (a.severidad === 'critica' || a.severidad === 'alta'))
    .map((a) => ({
      clave: `fba:${a.clave}`,
      fuente: 'fba' as const,
      titulo: a.titulo.slice(0, 200),
      icono: a.severidad === 'critica' ? '🚨' : '⚠️',
      departamento: 'STOCK',
      contenido: [p(a.detalle?.trim() || a.titulo), ...(a.sku ? [punto(`Referencia: ${a.sku}`)] : []), p('Creada automáticamente desde Remesas › Alertas. Cuando se resuelva allí, cierra esta tarea.')],
    }))
}

export interface ListingSuprimido {
  sku: string
  titulo: string | null
  tema: string | null
  errores: number
}

/** El número de semana ISO de un día «AAAA-MM-DD», como «2026-W45» */
export function claveDeSemana(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number)
  const f = new Date(Date.UTC(a, m - 1, d))
  const diaSemana = f.getUTCDay() || 7
  f.setUTCDate(f.getUTCDate() + 4 - diaSemana)
  const inicio = new Date(Date.UTC(f.getUTCFullYear(), 0, 1))
  const semana = Math.ceil(((f.getTime() - inicio.getTime()) / 86_400_000 + 1) / 7)
  return `${f.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`
}

const TEMAS: Record<string, string> = { normativa: 'normativa', peligrosas: 'mercancías peligrosas', aprobacion: 'aprobación', marca: 'marca', identificadores: 'identificadores', imagenes: 'imágenes', precio: 'precio', duplicado: 'duplicado', datos: 'datos', otros: 'otros' }
export const MAX_SKU_EN_LA_TAREA = 12

/** Una tarea por semana con los listings suprimidos que tienen stock; null si no hay ninguno */
export function propuestaDeCumplimiento(listings: readonly ListingSuprimido[], hoy: string): PropuestaDeTarea | null {
  if (listings.length === 0) return null
  const ordenados = [...listings].sort((a, b) => b.errores - a.errores || a.sku.localeCompare(b.sku))
  const filas = ordenados.slice(0, MAX_SKU_EN_LA_TAREA).map((l) => punto(`${l.sku}${l.titulo ? ` — ${l.titulo.slice(0, 80)}` : ''}${l.tema ? ` (${TEMAS[l.tema] ?? l.tema})` : ''}`))
  return {
    clave: `cumpl:${claveDeSemana(hoy)}`,
    fuente: 'cumplimiento',
    titulo: `${listings.length} listing${listings.length === 1 ? '' : 's'} suprimido${listings.length === 1 ? '' : 's'} con stock`,
    icono: '🛑',
    departamento: 'PRODUCTO',
    contenido: [p('Amazon ha dejado de mostrar estos listings y tienen stock en FBA: cada día sin arreglarlos es venta perdida.'), ...filas, ...(ordenados.length > filas.length ? [p(`…y ${ordenados.length - filas.length} más en Growth › Cumplimiento.`)] : []), p('Creada automáticamente desde Growth › Cumplimiento.')],
  }
}

/** Para cruzar los clientes del ERP con los de Amazon por el nombre cuando todavía no se han enlazado a mano */
export const nombreParaCruzar = (n: string): string => sinAcentos(n).replace(/[^a-z0-9]+/g, ' ').trim()

export interface ClienteParaCruzar {
  id: string
  nombre: string
}

/** Qué cliente de tareas corresponde a cada cliente de Amazon: primero lo enlazado a mano, después el mismo nombre (sin tildes, mayúsculas ni signos). Un nombre que repite no se adivina */
export function cruzarClientes(tareas: ReadonlyArray<ClienteParaCruzar & { amazonClientId?: string | null }>, amazon: readonly ClienteParaCruzar[]): { porAmazon: Map<string, string>; sinPareja: ClienteParaCruzar[] } {
  const porAmazon = new Map<string, string>()
  const conEnlace = tareas.filter((t) => t.amazonClientId && amazon.some((a) => a.id === t.amazonClientId))
  for (const t of conEnlace) porAmazon.set(t.amazonClientId as string, t.id)
  const usadosT = new Set(porAmazon.values())
  const nombresT = new Map<string, string[]>()
  for (const t of tareas) if (!usadosT.has(t.id)) nombresT.set(nombreParaCruzar(t.nombre), [...(nombresT.get(nombreParaCruzar(t.nombre)) ?? []), t.id])
  const sinPareja: ClienteParaCruzar[] = []
  for (const a of amazon) {
    if (porAmazon.has(a.id)) continue
    const candidatos = nombresT.get(nombreParaCruzar(a.nombre)) ?? []
    if (candidatos.length === 1) porAmazon.set(a.id, candidatos[0])
    else sinPareja.push(a)
  }
  return { porAmazon, sinPareja }
}
