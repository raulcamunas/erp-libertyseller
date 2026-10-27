/**
 * EL FILTRO DE LA BÚSQUEDA DE LEADS DESDE LA AGENDA.
 * ===================================================
 * Escribir «casa luz», «600112233» o «info@casaluz.es» tiene que encontrar al lead sin que el comercial piense en qué columna está cada cosa. PostgREST recibe la
 * búsqueda como un filtro de texto con comas y paréntesis como separadores (`col.ilike.%x%,col2.ilike.%x%`), así que:
 *
 *   · LO QUE SE ESCRIBE SE LIMPIA antes de meterlo ahí. Una coma, un paréntesis o un asterisco dentro del texto partiría el filtro en trozos que significan otra cosa
 *     (`casa,luz` buscaría «casa» en una columna y una columna llamada «luz» que no existe, y la consulta entera fallaría con un 400 sin explicación).
 *   · UN TELÉFONO SE BUSCA SIN FORMATO. En la base están como el Excel los trajo («600 11 22 33», «+34 600-11-22-33», «91.234.56.78»); si alguien teclea los dígitos pegados no
 *     coincidirían nunca. Con cinco dígitos o más se busca también con una expresión regular (`6[^0-9]*0[^0-9]*0…`): entre dos dígitos solo se admite lo que NO es un dígito.
 *     NO con comodines (`6%0%0%…`): casan con cualquier cosa entre dígito y dígito, también con otros dígitos, y contra la base real un número entero de 11 cifras traía de 5 a 25
 *     leads y los primeros seis dígitos, 504 — el buen resultado se perdía entre los falsos. Con la regular, de 1 a 6 y 18.
 *
 * Es puro: no toca la base ni la red.
 */

const MINIMO = 2

/** El texto tal como puede ir dentro de un patrón `%…%`: sin los caracteres que PostgREST usa para separar o que son comodines */
export function textoSeguro(texto: string): string {
  return texto.replace(/[,()*%\\"]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Las columnas donde se busca, por texto. En el mismo orden en que se miran de cabeza: la tienda, la razón social, el contacto, el correo, la web y el CIF */
const COLUMNAS_DE_TEXTO = ['store_name', 'company', 'decisor', 'email', 'web', 'cif'] as const

/** Las de teléfono, que además se buscan sin formato */
const COLUMNAS_DE_TELEFONO = ['phone', 'telefonos_extra'] as const

/**
 * El filtro `.or(...)` para ese texto, o null si todavía no hay nada que buscar (menos de dos caracteres útiles).
 */
export function filtroDeBusqueda(escrito: string): string | null {
  const texto = textoSeguro(escrito)
  if (texto.length < MINIMO) return null

  const condiciones: string[] = COLUMNAS_DE_TEXTO.map((c) => `${c}.ilike.%${texto}%`)
  condiciones.push(...COLUMNAS_DE_TELEFONO.map((c) => `${c}.ilike.%${texto}%`))

  const digitos = texto.replace(/\D/g, '')
  // Solo si lo escrito es, en lo esencial, un número de teléfono: «+34 600 11 22 33» sí, «casa 12» no
  const esTelefono = digitos.length >= 5 && digitos.length >= texto.replace(/[\s+().-]/g, '').length - 1
  if (esTelefono) {
    const patron = digitos.split('').join('[^0-9]*')
    condiciones.push(...COLUMNAS_DE_TELEFONO.map((c) => `${c}.imatch.${patron}`))
  }
  return condiciones.join(',')
}
