/**
 * EL BUSCADOR: las cuentas de texto (sin acentos, por palabras, con el trozo resaltado). PURO. Lo que busca en el cuerpo y en los comentarios es `tc_buscar` en la base de datos
 * (migración 277); los títulos se buscan aquí mismo, en el navegador, porque ya están todos cargados y así sale al teclear.
 */

/** Minúsculas y sin acentos (la ñ cuenta como n, igual que en la base de datos) */
export const sinAcentos = (t: string): string => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Las palabras de lo que se busca, sin acentos y sin vacías */
export const palabrasDe = (consulta: string): string[] => sinAcentos(consulta).split(/\s+/).filter(Boolean)

/** ¿Está TODAS las palabras en el texto? (en cualquier orden y sin mirar acentos ni mayúsculas) */
export function coincide(texto: string, consulta: string): boolean {
  const palabras = palabrasDe(consulta)
  if (palabras.length === 0) return false
  const t = sinAcentos(texto)
  return palabras.every((p) => t.includes(p))
}

export interface TrozoResaltado {
  texto: string
  resaltado: boolean
}

/** Parte un texto en trozos marcando los que son alguna de las palabras buscadas (sin acentos ni mayúsculas, pero devolviendo el texto original) */
export function resaltar(texto: string, consulta: string): TrozoResaltado[] {
  const palabras = palabrasDe(consulta)
  if (palabras.length === 0 || texto === '') return [{ texto, resaltado: false }]
  // `normalize('NFD')` cambia el largo del texto; se normaliza letra a letra para que las posiciones sigan valiendo sobre el original
  const letras = [...texto]
  const planas = letras.map((l) => sinAcentos(l))
  const plano = planas.join('')
  // El inicio, en el texto plano, de cada letra original
  const inicios: number[] = []
  let pos = 0
  for (const p of planas) {
    inicios.push(pos)
    pos += p.length
  }
  const marcas = new Array<boolean>(letras.length).fill(false)
  for (const palabra of palabras) {
    let desde = 0
    for (;;) {
      const i = plano.indexOf(palabra, desde)
      if (i < 0) break
      for (let k = 0; k < letras.length; k++) if (inicios[k] < i + palabra.length && inicios[k] + planas[k].length > i) marcas[k] = true
      desde = i + Math.max(palabra.length, 1)
    }
  }
  const salida: TrozoResaltado[] = []
  for (let k = 0; k < letras.length; k++) {
    const ultimo = salida[salida.length - 1]
    if (ultimo && ultimo.resaltado === marcas[k]) ultimo.texto += letras[k]
    else salida.push({ texto: letras[k], resaltado: marcas[k] })
  }
  return salida
}

/** Lo mínimo que se acepta buscar en el servidor: con una letra saldría media base de datos */
export const MIN_LETRAS_DE_BUSQUEDA = 2
