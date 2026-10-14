/**
 * AVISOS A SLACK.
 * SOLO SERVIDOR.
 *
 * Manda un mensaje al canal de un Incoming Webhook. La URL vive en la variable
 * de entorno SLACK_WEBHOOK_URL y es un SECRETO: quien la tenga puede escribir en
 * el canal. Nunca se registra ni se devuelve, ni siquiera en un error.
 *
 * NUNCA LANZA. Un aviso que falla no puede tumbar lo que avisaba: si Slack está
 * caído o la variable no está, la verificación se guarda igual y el motivo queda
 * en el resultado de esta función, para quien quiera mirar.
 */

export type ResultadoSlack = { ok: true } | { ok: false; motivo: string }

/** Slack corta un mensaje por encima de ~40.000 caracteres; esto deja mucho margen */
const MAX_TEXTO = 3500

export async function enviarSlack(texto: string): Promise<ResultadoSlack> {
  const url = (process.env.SLACK_WEBHOOK_URL ?? '').trim()
  if (!url) return { ok: false, motivo: 'Falta la variable SLACK_WEBHOOK_URL: el aviso no se ha enviado.' }
  // Un webhook de Slack tiene SIEMPRE esta forma. Cualquier otra cosa —por ejemplo
  // un comando curl pegado entero— se rechaza en vez de mandarlo a donde sea.
  if (!/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+$/.test(url)) {
    return {
      ok: false,
      motivo:
        'SLACK_WEBHOOK_URL no tiene la forma de una URL de webhook de Slack (https://hooks.slack.com/services/…). ' +
        'Tiene que ser solo la dirección, sin el comando curl.',
    }
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texto.slice(0, MAX_TEXTO) }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { ok: false, motivo: `Slack ha contestado ${res.status}.` }
    return { ok: true }
  } catch (e) {
    // El mensaje de error de fetch puede llevar la URL: no se devuelve tal cual
    return { ok: false, motivo: e instanceof Error && e.name === 'TimeoutError' ? 'Slack no ha contestado a tiempo.' : 'No se ha podido contactar con Slack.' }
  }
}
