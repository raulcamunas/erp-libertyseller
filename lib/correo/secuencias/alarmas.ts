import type { createServiceClient } from '@/lib/supabase/service'
import type { Alarma } from './salud'

/**
 * LOS AVISOS DE LA CAMPANA CUANDO ALGO SE ESTROPEA — SOLO SERVIDOR.
 * =================================================================
 * Lo que `salud.ts` marca para avisar (un buzón sin conexión, el motor parado, envíos fallidos, rebotes por encima del límite) llega a la campana de
 * las Notificaciones: a TODOS LOS ADMINISTRADORES y, si el problema es de un buzón, también a su dueño (que es quien casi siempre lo arregla). Se
 * escribe en `notifications` (migración 040) con el tipo `alarma_correo`, que añade la migración 248.
 *
 * NO SE REPITE: si ya se avisó a esa persona de lo mismo (mismo título) en las últimas 12 horas, no se avisa otra vez. Mientras el problema siga
 * ahí se le recuerda dos veces al día, no cada tres minutos; y si se arregla y vuelve a pasar más tarde, se avisa de nuevo. Por eso el título de
 * un aviso no lleva cifras que cambien: el título es la clave.
 *
 * SIN LA MIGRACIÓN 248 la base rechaza el tipo (23514): se apunta una vez en el registro, se deja de intentar durante una hora y la pantalla
 * de Salud sigue enseñando las alarmas. Un aviso que no se puede escribir no tumba nada.
 */

type Servicio = ReturnType<typeof createServiceClient>

export const TIPO_DE_AVISO = 'alarma_correo'
export const REPETIR_AVISO_CADA_MS = 12 * 3_600_000
export const FALTA_LA_MIGRACION_248 = 'Falta lanzar la migración 248_alarmas_de_correo.sql en el editor SQL de Supabase: sin ella los avisos de la campana no se pueden escribir (las alarmas se ven igual en Correo → Secuencias → Salud).'

export interface AvisoParaEscribir {
  userId: string
  titulo: string
  mensaje: string
}

export interface Avisador {
  /** A quién se ha avisado de qué desde `desde`: claves `claveDeAviso(userId, título)` */
  yaAvisados(desde: number): Promise<ReadonlySet<string>>
  escribir(avisos: readonly AvisoParaEscribir[]): Promise<{ escritos: number; faltaMigracion: boolean }>
}

export const claveDeAviso = (userId: string, titulo: string): string => `${userId}\u0000${titulo}`
export const tituloDeAviso = (titulo: string): string => `Correo · ${titulo}`
export const mensajeDeAviso = (detalle: string): string => `${detalle} Lo ves en Correo → Secuencias → Salud.`

/**
 * Avisa de las alarmas que lo piden. Devuelve cuántos avisos se han escrito. Quién recibe cada una: los administradores y, en las de un buzón, su
 * dueño (con el texto en segunda persona).
 */
export async function avisarDeAlarmas(
  avisador: Avisador,
  alarmas: readonly Alarma[],
  contexto: { administradores: readonly string[]; ahora: number; repetirCadaMs?: number }
): Promise<{ avisos: number; faltaMigracion: boolean }> {
  const aAvisar = alarmas.filter((a) => a.avisar)
  if (aAvisar.length === 0) return { avisos: 0, faltaMigracion: false }
  const yaAvisados = await avisador.yaAvisados(contexto.ahora - (contexto.repetirCadaMs ?? REPETIR_AVISO_CADA_MS))
  const nuevos: AvisoParaEscribir[] = []
  for (const a of aAvisar) {
    const destinatarios = new Set(contexto.administradores)
    if (a.duenoId) destinatarios.add(a.duenoId)
    for (const userId of destinatarios) {
      const texto = userId === a.duenoId && a.paraElDueno ? a.paraElDueno : { titulo: a.titulo, detalle: a.detalle }
      const titulo = tituloDeAviso(texto.titulo)
      const clave = claveDeAviso(userId, titulo)
      if (yaAvisados.has(clave)) continue
      nuevos.push({ userId, titulo, mensaje: mensajeDeAviso(texto.detalle) })
    }
  }
  if (nuevos.length === 0) return { avisos: 0, faltaMigracion: false }
  const r = await avisador.escribir(nuevos)
  return { avisos: r.escritos, faltaMigracion: r.faltaMigracion }
}

/* ------------------------------------------------------------------ */
/* La campana de verdad                                                */
/* ------------------------------------------------------------------ */

/** Hasta cuándo no se vuelve a intentar escribir porque la base rechazó el tipo (falta la 248). Vive lo que vive el proceso */
let sinLa248Hasta = 0

export function avisadorDeLaCampana(service: Servicio, reloj: () => number = Date.now): Avisador {
  return {
    async yaAvisados(desde) {
      const { data, error } = await service.from('notifications').select('user_id, title').eq('type', TIPO_DE_AVISO).gte('created_at', new Date(desde).toISOString()).limit(1000)
      if (error) throw new Error('No se ha podido mirar a quién se había avisado ya.', { cause: error })
      return new Set(((data ?? []) as Array<{ user_id: string; title: string }>).map((f) => claveDeAviso(f.user_id, f.title)))
    },
    async escribir(avisos) {
      if (avisos.length === 0) return { escritos: 0, faltaMigracion: false }
      if (reloj() < sinLa248Hasta) return { escritos: 0, faltaMigracion: true }
      const { error } = await service.from('notifications').insert(avisos.map((a) => ({ user_id: a.userId, type: TIPO_DE_AVISO, title: a.titulo, message: a.mensaje })))
      if (error) {
        // 23514 = la restricción del tipo no admite todavía «alarma_correo»: falta la migración 248
        if (error.code === '23514') {
          sinLa248Hasta = reloj() + 3_600_000
          console.warn('Correo · vigía:', FALTA_LA_MIGRACION_248)
          return { escritos: 0, faltaMigracion: true }
        }
        throw new Error('No se han podido escribir los avisos de la campana.', { cause: error })
      }
      return { escritos: avisos.length, faltaMigracion: false }
    },
  }
}

/** Solo para las pruebas: vuelve a intentar escribir aunque antes se hubiera rechazado */
export function reiniciarLaCampana(): void {
  sinLa248Hasta = 0
}
