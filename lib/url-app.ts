/**
 * URL BASE DE LA APLICACIÓN, DECIDIDA POR EL SERVIDOR Y NUNCA POR QUIEN LLAMA.
 *
 * QUÉ IMPIDE: un SSRF de lectura, sin sesión, en el que la cabecera `Origin` (o
 * `Host`) de quien hace la petición decide a qué servidor sale a hablar el VPS,
 * y además le devuelve el cuerpo de la respuesta.
 *
 * LO QUE COLABA ANTES (reproducido de punta a punta contra el código real, con
 * un Supabase de mentira para no tocar producción):
 *
 *     $ node oyente.js            # escucha en 127.0.0.1:9993
 *     $ curl -H 'Origin: http://127.0.0.1:9993' \
 *            http://SERVIDOR/api/auditor/share/aud_ssrftest
 *
 *     [OYENTE-SSRF] GOLPE: POST /api/auditor/analyze desde 127.0.0.1
 *     {"...","ai_analysis":{"SECRETO_INTERNO":"esto-no-deberia-salir-nunca-del-VPS"}}
 *
 * O sea: el servidor hizo la petición al destino que le marcó el atacante, le
 * devolvió el cuerpo en el JSON de respuesta (HTTP 200, SIN cookie de sesión) y
 * encima lo guardó en `audit_reports.ai_analysis`. Con eso se alcanza
 * localhost, la red interna del VPS, otros contenedores de Easypanel o
 * 169.254.169.254, y se lee la respuesta.
 *
 * El fallback estaba VIVO en producción: `NEXT_PUBLIC_APP_URL` no está en
 * .env.local ni es build ARG del Dockerfile, y Next inlina las NEXT_PUBLIC_* en
 * el build, así que en el contenedor la variable no existe.
 *
 * POR QUÉ NO CAMBIA NADA: para el tráfico legítimo el destino es exactamente el
 * mismo de hoy. En producción el navegador pide `/api/auditor/share/...` en el
 * mismo origen, y un GET al mismo origen no lleva cabecera `Origin`, así que
 * hoy se usa `https://${host}` = el dominio real. Este módulo devuelve ese
 * mismo dominio, pero fijado por el servidor.
 *
 * Mismo criterio que ya usaba app/api/appointments/google-watch/route.ts:41.
 *
 * EN DESARROLLO: si hace falta que estas llamadas internas apunten a la máquina
 * local en vez de a producción, se define NEXT_PUBLIC_APP_URL en .env.local
 * (por ejemplo http://localhost:3000). Es una variable de entorno, no una
 * cabecera de la petición: no la controla quien llama.
 */
export const URL_APP_POR_DEFECTO = 'https://app.libertyseller.com'

export function urlBaseApp(): string {
  return process.env.NEXT_PUBLIC_APP_URL || URL_APP_POR_DEFECTO
}
