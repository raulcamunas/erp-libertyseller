import { bloqueNuevo, conTexto, estaBloqueado, juntarIguales, nuevoIdDeBloque, textoDe, type Bloque, type Segmento, type TipoDeBloque } from './bloques'

/**
 * LAS OPERACIONES DEL EDITOR SOBRE LA LISTA DE BLOQUES — PURAS.
 *
 * Partir un bloque al pulsar Enter, unirlo con el anterior con Retroceso, sangrarlo, cambiarle el tipo, moverlo… Cada operación recibe la lista y devuelve la lista nueva (y,
 * si hace falta, dónde ha de quedar el cursor). El editor de pantalla solo traduce teclas a estas operaciones; aquí se comprueban sin navegador (edicion.prueba.ts).
 */

export const NIVEL_MAXIMO = 4

/** Los tipos que continúan al pulsar Enter: la lista sigue y la de tareas empieza con la casilla sin marcar */
const CONTINUAN: ReadonlySet<TipoDeBloque> = new Set(['vineta', 'numerada', 'tarea'])
const SE_SANGRAN: ReadonlySet<TipoDeBloque> = new Set(['parrafo', 'vineta', 'numerada', 'tarea', 'cita'])

export interface Resultado {
  bloques: Bloque[]
  /** El bloque donde se pone el cursor y en qué punto de su texto */
  cursor?: { id: string; posicion: number | 'inicio' | 'final' }
}

const indiceDe = (b: readonly Bloque[], id: string) => b.findIndex((x) => x.id === id)

export function reemplazar(bloques: readonly Bloque[], id: string, cambios: Partial<Bloque>): Bloque[] {
  return bloques.map((b) => (b.id === id ? { ...b, ...cambios } : b))
}

/** Cambia el tipo de un bloque conservando su texto. Un divisor no tiene texto y un bloque de tareas empieza sin marcar */
export function cambiarTipo(bloques: readonly Bloque[], id: string, tipo: TipoDeBloque, extra: Partial<Bloque> = {}): Bloque[] {
  return bloques.map((b) => {
    if (b.id !== id || estaBloqueado(b)) return b
    const { hecho: _hecho, icono: _icono, lenguaje: _lenguaje, ...resto } = b
    void _hecho
    void _icono
    void _lenguaje
    return { ...resto, tipo, texto: tipo === 'divisor' ? [] : b.texto, ...(tipo === 'tarea' ? { hecho: false } : {}), ...(tipo === 'aviso' ? { icono: '💡' } : {}), ...(tipo === 'codigo' ? { lenguaje: 'plain text' } : {}), ...extra }
  })
}

/**
 * Enter en mitad de un bloque: lo que queda antes del cursor se queda y lo de después pasa a un bloque nuevo. Un elemento de lista vacío no abre otro: sale de la lista
 * (sube un nivel si estaba sangrado, y si no se vuelve párrafo). Un título o una cita abren un párrafo.
 */
export function dividir(bloques: readonly Bloque[], id: string, antes: readonly Segmento[], despues: readonly Segmento[]): Resultado {
  const i = indiceDe(bloques, id)
  if (i < 0) return { bloques: [...bloques] }
  const actual = bloques[i]
  const vacio = antes.length === 0 && despues.length === 0
  if (vacio && (CONTINUAN.has(actual.tipo) || actual.tipo === 'cita' || actual.tipo === 'aviso')) {
    const sale: Bloque = (actual.nivel ?? 0) > 0 ? { ...actual, nivel: (actual.nivel ?? 0) - 1 } : { ...cambiarTipo([actual], actual.id, 'parrafo')[0] }
    return { bloques: bloques.map((b, k) => (k === i ? sale : b)), cursor: { id, posicion: 'inicio' } }
  }
  const tipoNuevo: TipoDeBloque = CONTINUAN.has(actual.tipo) ? actual.tipo : 'parrafo'
  const nuevo: Bloque = { ...bloqueNuevo(tipoNuevo), texto: juntarIguales(despues), ...((actual.nivel ?? 0) > 0 && CONTINUAN.has(actual.tipo) ? { nivel: actual.nivel } : {}) }
  const primero: Bloque = { ...actual, texto: juntarIguales(antes) }
  const lista = [...bloques]
  lista.splice(i, 1, primero, nuevo)
  return { bloques: lista, cursor: { id: nuevo.id, posicion: 'inicio' } }
}

/**
 * Retroceso al principio de un bloque. Si no es un párrafo, primero se vuelve párrafo (como en Notion); si ya lo es, se une con el anterior. Con un divisor delante lo
 * quita; con un bloque que el editor no entiende delante, no hace nada.
 */
export function retrocederAlInicio(bloques: readonly Bloque[], id: string): Resultado {
  const i = indiceDe(bloques, id)
  if (i < 0) return { bloques: [...bloques] }
  const actual = bloques[i]
  if (actual.tipo !== 'parrafo' && conTexto(actual.tipo)) {
    return { bloques: cambiarTipo(bloques, id, 'parrafo'), cursor: { id, posicion: 'inicio' } }
  }
  if ((actual.nivel ?? 0) > 0) return { bloques: reemplazar(bloques, id, { nivel: (actual.nivel ?? 0) - 1 }), cursor: { id, posicion: 'inicio' } }
  if (i === 0) return { bloques: [...bloques], cursor: { id, posicion: 'inicio' } }
  const previo = bloques[i - 1]
  if (previo.tipo === 'divisor') return { bloques: bloques.filter((_, k) => k !== i - 1), cursor: { id, posicion: 'inicio' } }
  if (!conTexto(previo.tipo)) return { bloques: [...bloques] }
  const punto = textoDe(previo.texto).length
  const unido: Bloque = { ...previo, texto: juntarIguales([...previo.texto, ...actual.texto]) }
  const lista = bloques.filter((_, k) => k !== i).map((b) => (b.id === previo.id ? unido : b))
  return { bloques: lista, cursor: { id: previo.id, posicion: punto } }
}

/** Sangra (+1) o quita sangría (−1). Solo donde tiene sentido, y nunca más que el bloque de arriba más uno */
export function sangrar(bloques: readonly Bloque[], id: string, delta: 1 | -1): Bloque[] {
  const i = indiceDe(bloques, id)
  if (i < 0) return [...bloques]
  const actual = bloques[i]
  if (!SE_SANGRAN.has(actual.tipo)) return [...bloques]
  const nivel = actual.nivel ?? 0
  const tope = i === 0 ? 0 : Math.min(NIVEL_MAXIMO, (bloques[i - 1].nivel ?? 0) + 1)
  const nuevo = Math.max(0, Math.min(tope, nivel + delta))
  if (nuevo === nivel) return [...bloques]
  return bloques.map((b) => {
    if (b.id !== id) return b
    const { nivel: _n, ...resto } = b
    void _n
    return nuevo === 0 ? resto : { ...resto, nivel: nuevo }
  })
}

export function insertarDespues(bloques: readonly Bloque[], id: string | null, bloque: Bloque): Bloque[] {
  const lista = [...bloques]
  const i = id ? indiceDe(bloques, id) : -1
  lista.splice(i < 0 ? lista.length : i + 1, 0, bloque)
  return lista
}

/** Borra un bloque. Un bloque de Notion que no sabemos editar no se borra desde aquí: sería perder algo que no entendemos */
export function borrar(bloques: readonly Bloque[], id: string): Bloque[] {
  const b = bloques.find((x) => x.id === id)
  if (!b || b.tipo === 'notion') return [...bloques]
  return bloques.filter((x) => x.id !== id)
}

export function mover(bloques: readonly Bloque[], desde: number, hasta: number): Bloque[] {
  if (desde === hasta || desde < 0 || hasta < 0 || desde >= bloques.length || hasta >= bloques.length) return [...bloques]
  const lista = [...bloques]
  const [x] = lista.splice(desde, 1)
  lista.splice(hasta, 0, x)
  return lista
}

/** El número que lleva cada elemento de una lista numerada: sigue contando mientras haya elementos seguidos del mismo nivel */
export function numeracion(bloques: readonly Bloque[]): Array<number | null> {
  const cuentas: number[] = []
  return bloques.map((b) => {
    const nivel = b.nivel ?? 0
    // Al volver a un nivel más alto, los más hondos empiezan de nuevo
    cuentas.length = Math.min(cuentas.length, nivel + 1)
    if (b.tipo !== 'numerada') {
      cuentas[nivel] = 0
      return null
    }
    cuentas[nivel] = (cuentas[nivel] ?? 0) + 1
    return cuentas[nivel]
  })
}

/** Lo que el texto escrito al principio de un párrafo pide ser: «# » un título, «- » una viñeta, «[] » una casilla… */
export function atajoDeMarkdown(texto: string): { tipo: TipoDeBloque; resto: string; extra?: Partial<Bloque> } | null {
  const m = /^(#{1,3}|[-*]|\d+\.|\[ ?\]|\[x\]|>|```)(\s|$)/i.exec(texto)
  if (!m) return texto === '---' ? { tipo: 'divisor', resto: '' } : null
  const marca = m[1]
  const resto = texto.slice(m[0].length)
  if (marca === '#') return { tipo: 'h1', resto }
  if (marca === '##') return { tipo: 'h2', resto }
  if (marca === '###') return { tipo: 'h3', resto }
  if (marca === '-' || marca === '*') return { tipo: 'vineta', resto }
  if (/^\d+\.$/.test(marca)) return { tipo: 'numerada', resto }
  if (marca === '>') return { tipo: 'cita', resto }
  if (marca === '```') return { tipo: 'codigo', resto }
  return { tipo: 'tarea', resto, extra: { hecho: marca.toLowerCase() === '[x]' } }
}

/** Una copia de los bloques con ids nuevos, para duplicar un trozo sin que dos bloques compartan identificador */
export const copiarConIdsNuevos = (bloques: readonly Bloque[]): Bloque[] => bloques.map((b) => ({ ...b, id: nuevoIdDeBloque(), notion_id: undefined }))
