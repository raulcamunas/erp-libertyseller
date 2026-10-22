/**
 * DIRECCIONES DE CORREO: LEERLAS, VALIDARLAS Y ESCRIBIRLAS.
 * =========================================================
 * PURO: no toca la base ni la red. Se comprueba con direcciones.prueba.ts.
 *
 * Las direcciones llegan de dos sitios en los que no se puede confiar: las cabeceras de un correo ajeno y lo
 * que escribe la persona en «Para». En los dos casos pasan por aquí antes de guardarse o de enviarse:
 *
 *   · Siempre en minúsculas y sin espacios: dos escrituras de la misma dirección son la misma.
 *   · Nada de saltos de línea ni de caracteres de control, ni en la dirección ni en el nombre: es lo que usa la
 *     inyección de cabeceras (una dirección que cuela un `\r\nBcc: …` manda el correo a quien no toca).
 *   · Solo direcciones normales: letras, cifras y los signos que permite el estándar en la parte local, y un
 *     dominio con al menos un punto. Lo raro (comentarios, direcciones entre comillas, dominios sin punto) se
 *     rechaza: ningún cliente real lo necesita y es por donde se cuelan los fallos.
 */

export interface Persona {
  nombre: string
  direccion: string
}

const LOCAL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/
const ETIQUETA = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const TLD = /^(?:[a-z]{2,24}|xn--[a-z0-9-]{2,59})$/

/** Caracteres de control (incluidos \r y \n) y los que cierran o abren una dirección dentro de una cabecera */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/g

/** La dirección en minúsculas, o null si no es una dirección que aceptemos */
export function normalizarDireccion(entrada: unknown): string | null {
  if (typeof entrada !== 'string') return null
  const d = entrada.trim().toLowerCase()
  if (d.length < 3 || d.length > 254) return null

  const arroba = d.lastIndexOf('@')
  if (arroba < 1) return null
  const local = d.slice(0, arroba)
  const dominio = d.slice(arroba + 1)

  if (local.length > 64 || !LOCAL.test(local)) return null
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null

  const etiquetas = dominio.split('.')
  if (etiquetas.length < 2) return null
  if (!etiquetas.every((e) => ETIQUETA.test(e))) return null
  if (!TLD.test(etiquetas[etiquetas.length - 1])) return null
  return d
}

export const esDireccionValida = (entrada: unknown): boolean => normalizarDireccion(entrada) !== null

/** «cliente.es» de «ana@cliente.es» */
export function dominioDe(direccion: string): string {
  const arroba = direccion.lastIndexOf('@')
  return arroba < 0 ? '' : direccion.slice(arroba + 1).toLowerCase()
}

/** El nombre de una persona, listo para guardarse: sin comillas de adorno, sin saltos de línea y con tope */
export function limpiarNombre(entrada: unknown): string {
  if (typeof entrada !== 'string') return ''
  let n = entrada.replace(CONTROL, ' ').replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim()
  // «"Ana López"» -> «Ana López»
  while (n.length >= 2 && ((n.startsWith('"') && n.endsWith('"')) || (n.startsWith("'") && n.endsWith("'")))) {
    n = n.slice(1, -1).trim()
  }
  return n.replace(/\\(["'\\])/g, '$1').slice(0, 120)
}

/** Parte un texto con varias direcciones por las comas, los puntos y comas y los saltos de línea que NO están dentro de comillas ni de < > */
function separar(texto: string): string[] {
  const trozos: string[] = []
  let actual = ''
  let comillas = false
  let angular = 0
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (c === '\\' && comillas) {
      actual += c + (texto[i + 1] ?? '')
      i++
      continue
    }
    if (c === '"') comillas = !comillas
    else if (!comillas && c === '<') angular++
    else if (!comillas && c === '>' && angular > 0) angular--
    if (!comillas && angular === 0 && (c === ',' || c === ';' || c === '\n' || c === '\r')) {
      if (actual.trim()) trozos.push(actual)
      actual = ''
      continue
    }
    actual += c
  }
  if (actual.trim()) trozos.push(actual)
  return trozos
}

/**
 * Lee una lista de direcciones tal y como se escribe: «Ana <ana@x.es>, bob@y.es; "Pérez, Luis" <luis@z.es>».
 * Devuelve las que valen y, aparte, lo que se ha escrito y NO es una dirección aceptable: quien envía un correo tiene que
 * saber que «ana@» no ha entrado en la lista, no enterarse cuando el cliente no contesta.
 */
export function leerLista(entrada: unknown): { personas: Persona[]; invalidas: string[] } {
  const texto = Array.isArray(entrada) ? entrada.filter((x) => typeof x === 'string').join(',') : entrada
  if (typeof texto !== 'string') return { personas: [], invalidas: [] }

  const personas: Persona[] = []
  const invalidas: string[] = []
  for (const trozo of separar(texto)) {
    const t = trozo.trim()
    const angular = /^([\s\S]*)<([^<>]+)>\s*$/.exec(t)
    const direccion = normalizarDireccion(angular ? angular[2] : t)
    if (!direccion) {
      invalidas.push(t.replace(CONTROL, ' ').replace(/\s+/g, ' ').slice(0, 120))
      continue
    }
    personas.push({ nombre: angular ? limpiarNombre(angular[1]) : '', direccion })
  }
  return { personas: sinRepetidas(personas), invalidas }
}

/** Solo las direcciones que valen. Ver leerLista */
export function analizarLista(entrada: unknown): Persona[] {
  return leerLista(entrada).personas
}

/** Quita las repetidas (por dirección), conservando el primer nombre que tuvieran */
export function sinRepetidas(personas: Persona[]): Persona[] {
  const vistas = new Map<string, Persona>()
  for (const p of personas) {
    const previa = vistas.get(p.direccion)
    if (!previa) vistas.set(p.direccion, p)
    else if (!previa.nombre && p.nombre) previa.nombre = p.nombre
  }
  return [...vistas.values()]
}

/** «Ana López <ana@x.es>», o solo la dirección si no hay nombre */
export function etiquetaDePersona(p: Persona): string {
  return p.nombre ? `${p.nombre} <${p.direccion}>` : p.direccion
}

/** Lo que se enseña de una persona en una lista: su nombre, o su dirección si no tiene */
export const nombreOCorreo = (p: Persona): string => p.nombre || p.direccion

/** Todas las personas en una línea de texto, para buscar por ellas */
export function lineaDePersonas(...listas: Persona[][]): string {
  return listas
    .flat()
    .map((p) => (p.nombre ? `${p.nombre} ${p.direccion}` : p.direccion))
    .join(', ')
    .slice(0, 2000)
}
