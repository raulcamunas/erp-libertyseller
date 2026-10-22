/**
 * PLANTILLAS DE CORREO: LOS CAMPOS ENTRE LLAVES.
 * ==============================================
 * PURO: no toca la base ni la red. Se comprueba con plantillas.prueba.ts.
 *
 * Una plantilla es un asunto y un texto escritos una vez. Donde quieras que algo cambie de un envío a otro se escribe un CAMPO entre dobles
 * llaves, y al usarla se rellena solo lo que se sabe:
 *
 *   {{empresa}}    la empresa o tienda del lead, si el mensaje se abre desde su ficha de Cold Calling
 *   {{mi_nombre}}  el nombre con el que firma el buzón desde el que se envía
 *   {{mi_correo}}  la dirección de ese buzón
 *   {{nombre}}     la persona a la que se escribe. NO se rellena nunca solo: el decisor de una tienda viene del registro mercantil como
 *                  «APELLIDOS NOMBRE» y escribir «Hola Narro Garcia Julian» a alguien es peor que preguntarle a quien envía cómo se llama
 *
 * LO QUE NO SE SABE SE QUEDA ESCRITO, TAL CUAL, con sus llaves, para que se vea y se complete. Y un mensaje con un campo sin rellenar NO SE
 * ENVÍA (`camposSinRellenar`): «Hola {{nombre}}» a un cliente de verdad es la clase de error que no se puede deshacer.
 */

export interface PlantillaDeCorreo {
  id: string
  /** null = del equipo: la ve todo el mundo y solo un administrador la toca */
  user_id: string | null
  nombre: string
  asunto: string
  texto: string
}

export interface DatosDeRelleno {
  empresa?: string | null
  mi_nombre?: string | null
  mi_correo?: string | null
}

export interface CampoDePlantilla {
  clave: 'empresa' | 'nombre' | 'mi_nombre' | 'mi_correo'
  /** Lo que se escribe */
  etiqueta: string
  /** Cómo se rellena, para quien las escribe */
  ayuda: string
}

export const CAMPOS_DE_PLANTILLA: readonly CampoDePlantilla[] = [
  { clave: 'empresa', etiqueta: '{{empresa}}', ayuda: 'La empresa o tienda del lead (si se escribe desde su ficha de Cold Calling)' },
  { clave: 'nombre', etiqueta: '{{nombre}}', ayuda: 'La persona a la que escribes: lo pones tú al enviar' },
  { clave: 'mi_nombre', etiqueta: '{{mi_nombre}}', ayuda: 'Tu nombre, el del buzón desde el que envías' },
  { clave: 'mi_correo', etiqueta: '{{mi_correo}}', ayuda: 'Tu dirección de correo' },
]

/** Un campo: «{{empresa}}», con espacios dentro permitidos y sin mirar mayúsculas */
const CAMPO = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

/** Rellena los campos que se saben. Los que no, se dejan como están */
export function rellenarPlantilla(texto: string, datos: DatosDeRelleno): string {
  const valor = (clave: string): string => {
    const v = clave === 'empresa' ? datos.empresa : clave === 'mi_nombre' ? datos.mi_nombre : clave === 'mi_correo' ? datos.mi_correo : null
    return (v ?? '').trim()
  }
  return texto.replace(CAMPO, (entero, clave: string) => {
    const k = clave.toLowerCase()
    const v = valor(k)
    return v === '' ? entero : v
  })
}

/** Los campos que quedan sin rellenar en un texto, sin repetir y en orden, tal y como están escritos (con sus llaves) */
export function camposSinRellenar(texto: string): string[] {
  const vistos = new Set<string>()
  const salida: string[] = []
  for (const m of texto.matchAll(CAMPO)) {
    const normal = `{{${m[1].toLowerCase()}}}`
    if (vistos.has(normal)) continue
    vistos.add(normal)
    salida.push(normal)
  }
  return salida
}

/** El nombre para comparar: sin espacios de más y sin mirar mayúsculas (la base impide dos plantillas con el mismo nombre así) */
export const nombreNormalizado = (nombre: string): string => nombre.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * El texto de una plantilla a partir de lo escrito en el mensaje: SIN la firma del buzón. La firma entra sola al abrir cada mensaje; si se
 * guardara dentro, al usar la plantilla saldría dos veces.
 */
export function textoSinFirma(texto: string, firma: string | null | undefined): string {
  const f = (firma ?? '').trim()
  const t = texto.replace(/\s+$/, '')
  if (f && t.endsWith(f)) return t.slice(0, t.length - f.length).replace(/\s+$/, '')
  return t
}

/**
 * Dónde queda un texto nuevo al insertarlo en otro. Si lo escrito es SOLO lo que había al abrir el mensaje (o está vacío), la plantilla
 * ocupa el principio y la firma sigue debajo; si ya se ha escrito algo, se inserta donde está el cursor y no se pisa nada.
 */
export function insertarPlantilla(actual: string, inicial: string, nuevo: string, cursor: number): { texto: string; cursor: number } {
  if (actual === inicial || actual.trim() === '') {
    const cuerpo = nuevo.replace(/\s+$/, '')
    return { texto: `${cuerpo}${actual === inicial ? inicial : ''}`, cursor: cuerpo.length }
  }
  const pos = Math.max(0, Math.min(cursor, actual.length))
  return { texto: actual.slice(0, pos) + nuevo + actual.slice(pos), cursor: pos + nuevo.length }
}
