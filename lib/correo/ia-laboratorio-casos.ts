import type { CasoDePrueba } from '@/lib/whatsapp/ia-casos'
import { conLimite } from '@/lib/ia/concurrencia'
import { costeDeUso } from '@/lib/ia/precios'
import type { EjemploGanador } from './ia-ejemplos'
import { contextoParaIa, tipoDeLead, type DatosDeLead, type LlamadaParaIa, type NotaParaIa } from './ia-contexto'
import { redactarConIa, type ClienteDeCorreoIa } from './ia-generar'
import type { CorreoDePrueba, SeguimientoDePrueba } from './ia-laboratorio-tipos'
import { compilarInstrucciones, construirMensajes, type SeccionesDeInstrucciones } from './ia-prompt'
import { costeAproximado, montarEjemplos, type EjemploPropio } from './ia-version'
import { escribirSeguimientos, modeloDeSecuencias } from './secuencias/ia'
import { asuntoDeSeguimiento } from './secuencias/inscripcion'
import { construirEncargoDeSeguimientos } from './secuencias/seguimientos'

/**
 * PROBAR UNA CONFIGURACIÓN DE CORREO CON VARIAS PERSONAS DE PRUEBA, Y CON SUS SEGUIMIENTOS — SOLO SERVIDOR.
 * =========================================================================================================
 * Escribe un correo por cada persona (las de prueba inventadas, que son las mismas que usa la IA de WhatsApp, o un lead real) con las instrucciones que se le den, SIN enviar ni
 * guardar nada, y devuelve para cada una el correo, lo que ha tardado, lo que ha costado y lo que recibió la IA. Pasa por las mismas funciones que escriben un correo de verdad
 * (`redactarConIa`, con `construirMensajes`): lo que se prueba es lo que se usa.
 *
 * Con `seguimientos`, además, escribe los seguimientos de la secuencia para cada persona a partir de su primer correo, igual que lo hace el cuadro de Correo al programar la secuencia:
 * se ve el hilo entero (el primer correo y lo que saldría a los 3 y a los 7 días hábiles si no contesta). Se comprueba con ia-laboratorio-casos.prueba.ts.
 *
 * Las personas se lanzan de CUATRO EN CUATRO (diez de golpe saturarían la API) y una que falla no tumba a las demás.
 */

export interface LeadRealParaCorreo {
  id: string
  etiqueta: string
  lead: DatosDeLead
  notas: readonly NotaParaIa[]
  llamadas: readonly LlamadaParaIa[]
}

export interface EntradaDeCorreosDePrueba {
  secciones: SeccionesDeInstrucciones
  /** Los ejemplos propios que la versión elige */
  elegidos: readonly EjemploPropio[]
  /** Los correos del equipo que funcionaron (los que se le enseñan si la versión lo pide) */
  ganadores: readonly EjemploGanador[]
  usarGanadores: boolean
  modelo: string | null
  casos: readonly CasoDePrueba[]
  real?: LeadRealParaCorreo | null
  miNombre: string | null
  /** Lo que pide el comercial: se aplica a los casos que no traen la suya */
  indicaciones: string | null
  /** Escribir también los seguimientos de la secuencia para cada persona */
  seguimientos: boolean
  /** Los pasos de la secuencia: a los cuántos días hábiles sale cada seguimiento */
  pasos: ReadonlyArray<{ orden: number; dias: number }>
  ahora?: number
}

const CONCURRENCIA = 4

export async function probarCorreosEnLote(entrada: EntradaDeCorreosDePrueba, opciones: { cliente?: ClienteDeCorreoIa; tiempoMaximoMs?: number } = {}): Promise<CorreoDePrueba[]> {
  const ahora = entrada.ahora ?? Date.now()
  type Tarea = { id: string; etiqueta: string; real: boolean; lead: DatosDeLead; notas: readonly NotaParaIa[]; llamadas: readonly LlamadaParaIa[]; indicaciones: string | null }
  const tareas: Tarea[] = entrada.casos.map((c) => {
    const d = c.datos(ahora)
    return { id: c.id, etiqueta: c.etiqueta, real: false, lead: d.lead, notas: d.notas, llamadas: d.llamadas, indicaciones: c.indicaciones ?? entrada.indicaciones }
  })
  if (entrada.real) tareas.push({ id: entrada.real.id, etiqueta: entrada.real.etiqueta, real: true, lead: entrada.real.lead, notas: entrada.real.notas, llamadas: entrada.real.llamadas, indicaciones: entrada.indicaciones })

  return conLimite(tareas, CONCURRENCIA, async (t): Promise<CorreoDePrueba> => {
    const vacio = { id: t.id, etiqueta: t.etiqueta, real: t.real, ok: false, asunto: null, texto: null, angulo: null, aviso: null, error: null, modelo: '', ms: 0, coste: null, ejemplos: 0, instrucciones: { system: '', usuario: '' }, seguimientos: null, seguimientosAviso: null, seguimientosCoste: null, seguimientosModelo: null } satisfies CorreoDePrueba
    try {
      const contexto = contextoParaIa({ lead: t.lead, notas: [...t.notas], llamadas: [...t.llamadas], correos: [], ahora })
      const ejemplos = montarEjemplos({ elegidos: entrada.elegidos, ganadores: entrada.ganadores, tipo: tipoDeLead(t.lead), usarGanadores: entrada.usarGanadores })
      const mensajes = construirMensajes({
        instrucciones: compilarInstrucciones(entrada.secciones),
        contexto,
        ejemplos,
        indicaciones: t.indicaciones,
        anterior: null,
        miNombre: entrada.miNombre,
        tieneFirma: true,
      })
      const inicio = Date.now()
      const r = await redactarConIa(mensajes, { ...(entrada.modelo ? { modelo: entrada.modelo } : {}), ...(opciones.cliente ? { cliente: opciones.cliente } : {}), ...(opciones.tiempoMaximoMs ? { tiempoMaximoMs: opciones.tiempoMaximoMs } : {}) })
      const ms = Date.now() - inicio
      const base: CorreoDePrueba = { ...vacio, modelo: r.modelo, ms, coste: costeAproximado(r.modelo, r.tokens), ejemplos: ejemplos.length, instrucciones: mensajes }
      if (!r.borrador) return { ...base, error: r.aviso ?? 'No se ha podido escribir el correo.' }
      const listo: CorreoDePrueba = { ...base, ok: true, asunto: r.borrador.asunto, texto: r.borrador.texto, angulo: r.borrador.angulo, aviso: r.aviso }
      if (!entrada.seguimientos || entrada.pasos.length === 0) return listo

      // Los seguimientos de la secuencia, con el mismo encargo que usa el cuadro de Correo al programarla
      const encargo = construirEncargoDeSeguimientos({
        contexto,
        primerCorreo: { asunto: r.borrador.asunto, texto: r.borrador.texto },
        pasos: entrada.pasos,
        indicaciones: t.indicaciones,
        miNombre: entrada.miNombre,
        tieneFirma: true,
      })
      const s = await escribirSeguimientos(encargo, entrada.pasos.length, r.borrador.texto, { ...(opciones.cliente ? { cliente: opciones.cliente } : {}), ...(opciones.tiempoMaximoMs ? { tiempoMaximoMs: opciones.tiempoMaximoMs } : {}) })
      const seguimientos: SeguimientoDePrueba[] | null = s.textos
        ? s.textos.map((texto, i) => ({ orden: entrada.pasos[i].orden, dias: entrada.pasos[i].dias, asunto: asuntoDeSeguimiento(r.borrador!.asunto), texto }))
        : null
      return { ...listo, seguimientos, seguimientosAviso: s.aviso, seguimientosCoste: s.tokens ? costeDeUso(s.modelo, s.tokens) : null, seguimientosModelo: s.modelo || modeloDeSecuencias() }
    } catch (error) {
      // Escribir un correo no lanza (ia-generar.ts); si algo imprevisto pasa con una persona, esa lo dice y las demás siguen
      console.error('[correo-ia] prueba con personas: fallo con una', { caso: t.id, mensaje: error instanceof Error ? error.message : 'desconocido' })
      return { ...vacio, error: 'No se ha podido escribir el correo de esta persona.' }
    }
  })
}
