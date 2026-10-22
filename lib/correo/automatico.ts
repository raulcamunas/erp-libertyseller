/**
 * ¿LO HA ESCRITO UNA PERSONA O UNA MÁQUINA?
 * =========================================
 * PURO: no toca la base ni la red. Se comprueba con automatico.prueba.ts.
 *
 * Una bandeja de comercial se llena de avisos de Amazon, facturas, boletines y notificaciones. Un hilo cuyo
 * último correo es uno de esos NO espera respuesta de nadie, y si contara como «pendiente de contestar» la lista de
 * pendientes dejaría de servir. Aquí se decide, con las cabeceras que los propios programas de envío ponen:
 *
 *   · Auto-Submitted distinto de «no» (RFC 3834): respuestas automáticas, avisos de ausencia, rebotes.
 *   · Precedence: bulk, list, junk o auto_reply: envíos masivos.
 *   · List-Id y List-Unsubscribe: listas de correo y boletines.
 *   · X-Auto-Response-Suppress y X-Autoreply: Exchange y otros.
 *   · Return-Path vacío («<>»): un rebote.
 *   · Un remitente de los que no esperan respuesta: no-reply, mailer-daemon, notifications…
 *
 * Se acierta casi siempre pero no siempre: un falso «automático» solo hace que ese hilo no salga en pendientes, y se
 * sigue viendo en la bandeja como cualquier otro.
 */

export interface CabecerasDeAutomatismo {
  autoSubmitted?: string | null
  precedence?: string | null
  listId?: string | null
  listUnsubscribe?: string | null
  autoResponseSuppress?: string | null
  xAutoreply?: string | null
  returnPath?: string | null
  /** La dirección de quien lo envía, en minúsculas */
  deDireccion: string
}

const PRECEDENCIAS_MASIVAS = new Set(['bulk', 'list', 'junk', 'auto_reply'])

/** Remitentes que no esperan que se les conteste. Con sufijo tras un separador vale: «no-reply+abc», «notifications.2» */
const REMITENTE_AUTOMATICO = /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|notificaciones?|alerts?|newsletter|robot)(?:[._+-]|\d|$)/

const hay = (v: string | null | undefined): boolean => typeof v === 'string' && v.trim() !== ''

export function esAutomatico(c: CabecerasDeAutomatismo): boolean {
  if (hay(c.autoSubmitted) && c.autoSubmitted!.trim().toLowerCase() !== 'no') return true
  if (hay(c.precedence) && PRECEDENCIAS_MASIVAS.has(c.precedence!.trim().toLowerCase())) return true
  if (hay(c.listId) || hay(c.listUnsubscribe)) return true
  if (hay(c.autoResponseSuppress) || hay(c.xAutoreply)) return true
  if (typeof c.returnPath === 'string' && c.returnPath.replace(/\s/g, '') === '<>') return true

  const local = c.deDireccion.split('@')[0] ?? ''
  return REMITENTE_AUTOMATICO.test(local)
}
