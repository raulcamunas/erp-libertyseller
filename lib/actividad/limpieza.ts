/**
 * LIMPIAR LO QUE EL NAVEGADOR CUENTA ANTES DE GUARDARLO.
 * PURO. Se prueba en limpieza.prueba.ts.
 *
 * El registro de actividad guarda DÓNDE está una persona y QUÉ botón pulsa, nunca lo que escribe ni los datos con los
 * que trabaja. Esto es la aduana: lo que llega del navegador (que es de quien lo manda, no de fiar) se recorta aquí a
 * una ruta sin identificadores y a una etiqueta corta sin correos, teléfonos ni cifras largas.
 */

export const MAX_RUTA = 120
export const MAX_ETIQUETA = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * La ruta de una pantalla, sin consulta ni fragmento y con los identificadores cambiados por `:id`.
 *
 *   /dashboard/cold-calling?lead=abc#x   ->  /dashboard/cold-calling
 *   /dashboard/clients/3f2b…-…/notas     ->  /dashboard/clients/:id/notas
 *   /encajar/Xk3…(token largo)           ->  /encajar/:id
 *
 * Devuelve null si no es una ruta del propio sitio (no empieza por «/»).
 */
export function rutaLimpia(bruta: unknown): string | null {
  if (typeof bruta !== 'string') return null
  const ruta = bruta.trim()
  if (!ruta.startsWith('/') || ruta.startsWith('//')) return null
  const sinConsulta = ruta.split(/[?#]/)[0] ?? ''
  const trozos = sinConsulta.split('/').map((trozo) => {
    if (trozo === '') return trozo
    if (UUID.test(trozo)) return ':id'
    // Un número largo (id, teléfono) o un testigo largo (token, hash) no dice nada de la pantalla y puede ser un dato
    if (/^\d{4,}$/.test(trozo)) return ':id'
    if (/^[A-Za-z0-9_-]{24,}$/.test(trozo)) return ':id'
    return trozo.slice(0, 40)
  })
  const limpia = trozos.join('/').replace(/\/{2,}/g, '/')
  return (limpia === '' ? '/' : limpia).slice(0, MAX_RUTA)
}

/**
 * El nombre de un botón o enlace, apto para guardar.
 *
 * Se descarta lo que parece un dato de alguien —un correo, un teléfono, una cifra larga, una dirección web— y se
 * recorta lo largo. Devuelve null si no queda nada que decir.
 */
export function etiquetaLimpia(bruta: unknown): string | null {
  if (typeof bruta !== 'string') return null
  const texto = bruta
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (texto === '') return null
  if (/@/.test(texto)) return '(dato oculto)'
  if (/https?:\/\/|www\./i.test(texto)) return '(enlace)'
  if (/\d{6,}/.test(texto) || /\+?\d[\d\s().-]{7,}\d/.test(texto)) return '(dato oculto)'
  return texto.length > MAX_ETIQUETA ? `${texto.slice(0, MAX_ETIQUETA - 1).trimEnd()}…` : texto
}

/** Un texto libre y corto (la huella del navegador): sin saltos ni caracteres de control, y con techo */
export function textoCorto(bruto: unknown, maximo: number): string | null {
  if (typeof bruto !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const texto = bruto.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return texto === '' ? null : texto.slice(0, maximo)
}
