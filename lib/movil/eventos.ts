/**
 * Avisos (en `window`) entre las piezas del móvil, que viven en sitios distintos del árbol.
 *   · EVENTO_NAVEGANDO: alguien (una celda del Inicio) acaba de pulsar un enlace a `detail` (la ruta). La barra lateral lo usa para poner ya el título
 *     en la cabecera y encender la pestaña, sin esperar a que cargue la página.
 *   · EVENTO_ABRIR_AVISOS: la campana de la cabecera pide abrir el panel de notificaciones (vive en la hoja «Más»).
 */
export const EVENTO_NAVEGANDO = 'erp:movil:navegando'
export const EVENTO_ABRIR_AVISOS = 'erp:movil:abrir-avisos'

export function avisarNavegando(ruta: string): void {
  try {
    window.dispatchEvent(new CustomEvent<string>(EVENTO_NAVEGANDO, { detail: ruta }))
  } catch {
    /* fuera del navegador */
  }
}
