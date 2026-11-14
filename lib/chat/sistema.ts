/**
 * TEXTOS DE LOS AVISOS AUTOMÁTICOS DEL ERP EN EL CHAT — PURO. Lo que el ERP cuenta solo (el stock subido a un cliente, una cita agendada…) llega al canal #notificaciones-erp; aquí se
 * escribe el texto. Quien lo guarda y lo reparte es sistema-servidor.ts. Se comprueba en sistema.prueba.ts.
 */

const EMOJIS_DE_SLACK: Record<string, string> = { white_check_mark: '✅', warning: '⚠️', x: '❌', heavy_check_mark: '✔️', rocket: '🚀', calendar: '📅', package: '📦' }

/** Un texto escrito para Slack (`*negrita*`, `:warning:`) al del chat (`**negrita**`, ⚠️) */
export function slackAChat(texto: string): string {
  return texto.replace(/:([a-z0-9_]+):/g, (m, nombre: string) => EMOJIS_DE_SLACK[nombre] ?? m).replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,:;!?]|$)/g, '$1**$2**')
}

const FORMATO_DE_CITA = { timeZone: 'Europe/Madrid', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false } as const

/** «mié, 12 nov, 16:00» en hora de Madrid */
export function fechaDeCita(inicioIso: string): string {
  const d = new Date(inicioIso)
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('es-ES', FORMATO_DE_CITA).format(d).replace(/\./g, '')
}

/** El aviso de que un comercial ha agendado una cita */
export function textoDeCita(c: { comercial: string; lead: string; empresa?: string | null; inicioIso: string; closer?: string | null; enlace?: string | null }): string {
  const cuando = fechaDeCita(c.inicioIso)
  const con = c.empresa && c.empresa.trim() && c.empresa.trim().toLowerCase() !== c.lead.trim().toLowerCase() ? `**${c.lead.trim()}** (${c.empresa.trim()})` : `**${c.lead.trim()}**`
  const lineas = [`📅 **${c.comercial}** ha agendado una cita con ${con}${cuando ? ` · ${cuando}` : ''}`]
  if (c.closer && c.closer.trim()) lineas.push(`Cierra: ${c.closer.trim()}`)
  if (c.enlace) lineas.push(c.enlace)
  return lineas.join('\n')
}
