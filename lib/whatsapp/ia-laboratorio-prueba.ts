import type { DatosDeLead, LlamadaParaIa, NotaParaIa } from '@/lib/correo/ia-contexto'
import type { ClienteDeCorreoIa } from '@/lib/correo/ia-generar'
import { momentoDelCaso, type CasoDePrueba } from './ia-casos'
import { escribirMensaje } from './ia-escribir'
import type { PerfilDeWhatsapp } from './ia-perfil'
import type { RespuestaDePrueba, ResultadoDePrueba } from './ia-laboratorio-tipos'
import type { SituacionDeWhatsapp } from './mensajes'

/**
 * PROBAR UN PERFIL CON VARIOS CASOS A LA VEZ — SOLO SERVIDOR.
 * ===========================================================
 * Escribe un mensaje por cada caso (los de prueba inventados o un lead real) con el perfil que se le dé, SIN enviar ni guardar nada, y devuelve para cada uno el mensaje, lo que ha tardado,
 * lo que ha costado y lo que recibió la IA. Pasa por `escribirMensaje`, la misma función que usa la ruta de los comerciales: lo que se prueba es lo que se usa. Se comprueba con
 * ia-laboratorio-prueba.prueba.ts.
 *
 * Los casos se lanzan de CUATRO EN CUATRO: diez de golpe saturarían la API (y la espera sería la de uno solo, pero con un 429 de regalo). Un caso que falla no tumba a los demás.
 */

export interface LeadRealParaProbar {
  id: string
  etiqueta: string
  lead: DatosDeLead
  notas: readonly NotaParaIa[]
  llamadas: readonly LlamadaParaIa[]
}

export interface EntradaDeLote {
  perfil: PerfilDeWhatsapp
  casos: readonly CasoDePrueba[]
  /** Un lead real, además o en vez de los casos */
  real?: LeadRealParaProbar | null
  /** Solo para el lead real: si se quiere fijar el momento. En los casos, el del caso */
  situacion?: SituacionDeWhatsapp | null
  miNombre: string | null
  /** Lo que pide el comercial: se aplica a todos los casos que no traen la suya */
  indicaciones: string | null
  anterior: string | null
  ahora?: number
}

const CONCURRENCIA = 4

/** Hace `fn` con cada elemento, `limite` a la vez, y devuelve los resultados en el mismo orden. `fn` no debe lanzar (aquí, nunca lo hace) */
export async function conLimite<T, R>(elementos: readonly T[], limite: number, fn: (e: T, i: number) => Promise<R>): Promise<R[]> {
  const salida = new Array<R>(elementos.length)
  let siguiente = 0
  const obreros = Array.from({ length: Math.min(limite, elementos.length) }, async () => {
    while (siguiente < elementos.length) {
      const i = siguiente++
      salida[i] = await fn(elementos[i], i)
    }
  })
  await Promise.all(obreros)
  return salida
}

const palabrasDe = (t: string | null | undefined): number => (t ? t.trim().split(/\s+/).filter(Boolean).length : 0)

export async function probarEnLote(entrada: EntradaDeLote, opciones: { cliente?: ClienteDeCorreoIa; tiempoMaximoMs?: number; entorno?: Record<string, string | undefined> } = {}): Promise<Pick<RespuestaDePrueba, 'sistema' | 'resultados'>> {
  const ahora = entrada.ahora ?? Date.now()
  type Tarea = { id: string; etiqueta: string; real: boolean; lead: DatosDeLead; notas: readonly NotaParaIa[]; llamadas: readonly LlamadaParaIa[]; situacion: SituacionDeWhatsapp | null; indicaciones: string | null }
  const tareas: Tarea[] = entrada.casos.map((c) => {
    const d = c.datos(ahora)
    return { id: c.id, etiqueta: c.etiqueta, real: false, lead: d.lead, notas: d.notas, llamadas: d.llamadas, situacion: momentoDelCaso(c, ahora), indicaciones: c.indicaciones ?? entrada.indicaciones }
  })
  if (entrada.real) {
    tareas.push({ id: entrada.real.id, etiqueta: entrada.real.etiqueta, real: true, lead: entrada.real.lead, notas: entrada.real.notas, llamadas: entrada.real.llamadas, situacion: entrada.situacion ?? null, indicaciones: entrada.indicaciones })
  }

  let sistema: RespuestaDePrueba['sistema'] = []
  const resultados = await conLimite(tareas, CONCURRENCIA, async (t): Promise<ResultadoDePrueba> => {
    try {
      const s = await escribirMensaje(
        { perfil: entrada.perfil, lead: t.lead, notas: t.notas, llamadas: t.llamadas, situacion: t.situacion, miNombre: entrada.miNombre, indicaciones: t.indicaciones, anterior: entrada.anterior, ahora },
        { cliente: opciones.cliente, tiempoMaximoMs: opciones.tiempoMaximoMs, entorno: opciones.entorno }
      )
      if (sistema.length === 0) sistema = s.encargo.bloques.filter((b) => b.en === 'sistema')
      const r = s.resultado
      return {
        id: t.id,
        etiqueta: t.etiqueta,
        real: t.real,
        situacion: s.situacion,
        ok: r.mensaje !== null,
        mensaje: r.mensaje?.mensaje ?? null,
        base: r.mensaje?.base ?? null,
        aviso: r.mensaje ? r.aviso : null,
        problemas: r.problemas,
        error: r.mensaje ? null : (r.aviso ?? 'No se ha podido escribir el mensaje.'),
        modelo: r.modelo,
        ms: s.ms,
        coste: s.coste,
        costeMaximo: s.costeMaximo,
        tokens: r.tokens,
        llamadas: r.llamadas,
        palabras: palabrasDe(r.mensaje?.mensaje),
        maxPalabras: s.maxPalabras,
        encargo: s.encargo.bloques.filter((b) => b.en === 'encargo'),
      }
    } catch (error) {
      // Escribir un mensaje no lanza (ia-generar.ts); si algo imprevisto pasa en un caso, ese caso lo dice y los demás siguen
      console.error('[whatsapp-ia] prueba: fallo en un caso', { caso: t.id, mensaje: error instanceof Error ? error.message : 'desconocido' })
      return { id: t.id, etiqueta: t.etiqueta, real: t.real, situacion: t.situacion ?? 'primer_contacto', ok: false, mensaje: null, base: null, aviso: null, problemas: [], error: 'No se ha podido escribir el mensaje de este caso.', modelo: '', ms: 0, coste: null, costeMaximo: null, tokens: null, llamadas: 0, palabras: 0, maxPalabras: 0, encargo: [] }
    }
  })
  return { sistema, resultados }
}
