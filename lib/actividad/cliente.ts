import type { TipoDeEvento } from './ingesta'
import { etiquetaLimpia } from './limpieza'

/**
 * LO QUE HACE EL NAVEGADOR DE CADA EMPLEADO PARA CONTAR QUE ESTÁ AQUÍ.
 * Solo se usa en el navegador (components/actividad/RegistroDeActividad.tsx y la pantalla de inicio de sesión); lo que no
 * toca el DOM se prueba en cliente.prueba.ts.
 *
 * REGISTRAR NUNCA PUEDE ESTROPEAR NADA: todo va dentro de try, no espera a nadie y, si falla, se calla.
 */

export interface EventoSaliente {
  t: TipoDeEvento
  ruta?: string | null
  detalle?: string | null
  /** Hace cuántos milisegundos pasó: el servidor pone la hora, no el reloj del navegador */
  hace?: number
}

const CLAVE_DE_SESION = 'actividad:sesion'
const FORMA_DE_SESION = /^[A-Za-z0-9_-]{8,40}$/

function nuevoId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID().replace(/-/g, '')
  } catch {
    // sigue abajo
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

/**
 * La «sesión» es UNA PESTAÑA ABIERTA del navegador: un identificador al azar que vive en sessionStorage y sirve para
 * agrupar lo que hace. `nueva` es true la primera vez que se pide en esa pestaña, que es cuando hay que decir «ha abierto el ERP».
 */
export function idDeSesion(): { id: string; nueva: boolean } {
  try {
    const guardada = window.sessionStorage.getItem(CLAVE_DE_SESION)
    if (guardada && FORMA_DE_SESION.test(guardada)) return { id: guardada, nueva: false }
    const id = nuevoId()
    window.sessionStorage.setItem(CLAVE_DE_SESION, id)
    return { id, nueva: true }
  } catch {
    // Sin sessionStorage (modo privado muy estricto): un identificador solo para esta carga
    return { id: nuevoId(), nueva: true }
  }
}

/**
 * Manda un lote al servidor. Con `alSalir` (la pestaña se oculta o se cierra) usa sendBeacon, que el navegador deja
 * terminar aunque la página ya no esté; si no, un fetch con keepalive por si la página se va justo ahora.
 */
export function enviarLote(sesion: string, eventos: EventoSaliente[], opciones: { alSalir?: boolean } = {}): void {
  if (eventos.length === 0) return
  try {
    const cuerpo = JSON.stringify({ sesion, eventos })
    if (opciones.alSalir && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      if (navigator.sendBeacon('/api/actividad', new Blob([cuerpo], { type: 'application/json' }))) return
    }
    void fetch('/api/actividad', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: cuerpo,
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => undefined)
  } catch {
    // registrar nunca rompe nada
  }
}

/** Los controles cuyo nombre merece quedar apuntado: botones, enlaces, pestañas, opciones de menú */
export const SELECTOR_DE_CONTROL = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="link"], [role="switch"], [role="checkbox"], summary'
/** Las tablas y cuadrículas: lo que dice su texto es CONTENIDO (nombres, cifras), no el nombre de un botón */
export const SELECTOR_DE_TABLA = 'table, [role="grid"], [role="treegrid"], [role="row"]'
/** Lo que no se apunta nunca: un recuadro marcado con `data-sin-registro` y todo lo de dentro */
export const SELECTOR_SIN_REGISTRO = '[data-sin-registro]'

/**
 * EL NOMBRE DE UN BOTÓN, o null si no hay un nombre que merezca la pena guardar.
 *
 * Lo ideal es la etiqueta que el propio botón declara (`aria-label`, `title`). Si no la tiene, vale su texto solo si es
 * corto y de una línea: un texto largo o de varias líneas es el contenido de una fila de lista (el nombre de una tienda,
 * una cifra), no un botón, y NO se apunta. Dentro de una tabla solo vale la etiqueta declarada, nunca el texto.
 */
export function etiquetaDeControl(c: { aria: string | null; title: string | null; texto: string | null; dentroDeTabla: boolean }): string | null {
  const declarada = c.aria?.trim() || c.title?.trim() || ''
  if (declarada) return etiquetaLimpia(declarada)
  if (c.dentroDeTabla) return null
  const texto = (c.texto ?? '').trim()
  if (texto === '' || texto.includes('\n') || texto.length > 40) return null
  return etiquetaLimpia(texto)
}
