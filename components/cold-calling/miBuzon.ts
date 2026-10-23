import { pedir } from '@/components/correo/api'
import { elegirMiBuzon, type MiBuzon } from '@/lib/correo/mi-buzon'
import type { BuzonVisible } from '@/lib/correo/tipos'

/**
 * MI BUZÓN, YA A MANO PARA LA VENTANA RÁPIDA DE CORREO — SOLO NAVEGADOR.
 *
 * La ventana que escribe a un lead encima de la ficha (CorreoRapido.tsx) necesita saber desde qué buzón sale y con qué firma. Pedirlo en el
 * momento del clic añadiría una espera justo donde se quiere ir rápido, así que se pide una vez al montar el tablero (cuando el navegador
 * está parado) y se recuerda unos minutos. Se recuerda solo lo que salió bien: un fallo (sin red, sin permiso de Correo) se vuelve a
 * preguntar en el siguiente clic. «Sin buzón» se recuerda muy poco: quien lo conecta en Correo y vuelve no debe esperar para que le sirva.
 */

export type ResultadoDeMiBuzon = MiBuzon | { tipo: 'error'; mensaje: string }

const VIDA_DE_UN_BUZON_BUENO_MS = 5 * 60_000
const VIDA_DE_SIN_BUZON_MS = 15_000

let guardado: { hasta: number; valor: MiBuzon } | null = null
let enCurso: Promise<ResultadoDeMiBuzon> | null = null

/** Para que lo siguiente que se pida vuelva a preguntar (y para las pruebas) */
export function olvidarMiBuzon(): void {
  guardado = null
}

/** Lo que ya se sabe de mi buzón, al momento y sin preguntar: null si no se sabe o ya caducó */
export function miBuzonEnMemoria(ahora = Date.now()): MiBuzon | null {
  return guardado && guardado.hasta > ahora ? guardado.valor : null
}

export function cargarMiBuzon(ahora = Date.now()): Promise<ResultadoDeMiBuzon> {
  if (guardado && guardado.hasta > ahora) return Promise.resolve(guardado.valor)
  if (enCurso) return enCurso
  enCurso = pedir<{ buzones: BuzonVisible[] }>('/api/correo/buzones')
    .then((r): ResultadoDeMiBuzon => {
      if (!r.ok) return { tipo: 'error', mensaje: r.mensaje }
      const valor = elegirMiBuzon(r.datos.buzones)
      guardado = { hasta: Date.now() + (valor.tipo === 'listo' ? VIDA_DE_UN_BUZON_BUENO_MS : VIDA_DE_SIN_BUZON_MS), valor }
      return valor
    })
    .finally(() => {
      enCurso = null
    })
  return enCurso
}
