/**
 * NORMALIZAR UN TEXTO DE UBICACIÓN PARA COMPARARLO — PURO.
 * ========================================================
 * En los leads el mismo sitio viene escrito de mil maneras: «MADRID», «Madrid», «Seville», «A Coruña», «La Coruña», «L'Hospitalet de Llobregat», «Castelló de la Plana /
 * Castellón de la Plana», «ALICANTE ,SPAIN». Para compararlos todos con los mismos nombres hay que dejarlos en una sola forma: sin tildes (la ñ cuenta como n), en minúsculas,
 * con los apóstrofos y los signos hechos espacio y sin espacios de más. El localizador compara SIEMPRE textos ya normalizados, también los nombres de su lista.
 */

/** Sin tildes, en minúsculas y solo con letras, cifras y espacios sueltos. «L'Hospitalet de Llobregat» -> «l hospitalet de llobregat» */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Palabras que no dicen dónde están: el país y su resumen. Un trozo de texto que sea solo una de ellas no cuenta como lugar */
const SIN_LUGAR = new Set(['espana', 'spain', 'es', 'esp', 'europe', 'europa', 'peninsula', 'peninsula y baleares', 'espana peninsula', 'peninsular', 'otros', 'otro', 'sin provincia', 'n a', 'na', 'none', 'null'])

export const noDiceDonde = (normalizado: string): boolean => normalizado === '' || SIN_LUGAR.has(normalizado)

/** El país pegado al lugar («sevilla espana», «espana madrid»): se quita para que quede solo el lugar */
const PAIS_PEGADO = /^(?:espana|spain)\s+|\s+(?:espana|spain)$/

/**
 * Parte un texto libre en los trozos que pueden ser un lugar: por comas, puntos y comas, paréntesis, barras y rayas con espacios («Falset, Tarragona», «ALICANTE/ESPAÑA»,
 * «Ribeira (A Coruña)»). El texto entero va el primero: «Vitoria-Gasteiz» y «Castelló de la Plana/Castellón de la Plana» se prueban enteros antes de partirse. Con `desdeElFinal`
 * los trozos van del último al primero (en una dirección el municipio está al final y la calle al principio), pero el texto entero sigue yendo el primero.
 */
export function trozosDeLugar(texto: string, desdeElFinal = false): string[] {
  const sinPais = (n: string) => n.replace(PAIS_PEGADO, '').trim()
  const entero = sinPais(normalizar(texto))
  const partes = texto
    .split(/[,;()|\\\n]+|\s+[-–—]\s+|\/|\s[-–—](?=\S)/)
    .map((p) => sinPais(normalizar(p)))
    .filter((p) => p !== '' && !noDiceDonde(p))
  const vistos = new Set<string>()
  const salida: string[] = []
  for (const p of [entero, ...(desdeElFinal ? [...partes].reverse() : partes)]) {
    if (p !== '' && !noDiceDonde(p) && !vistos.has(p)) {
      vistos.add(p)
      salida.push(p)
    }
  }
  return salida
}
