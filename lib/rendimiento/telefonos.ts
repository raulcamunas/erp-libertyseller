/**
 * CASAR EL TELÉFONO DE UNA LLAMADA CON EL DE UN LEAD.
 * ===================================================
 * PURO. Se comprueba con telefonos.prueba.ts.
 *
 * Rinkel da el número del otro lado en E.164 («+34600112233») y el Excel de la centralita lo
 * trae sin el más («34600112233»). Los leads de Cold Calling vienen de un Excel y llevan el
 * teléfono como lo tecleó alguien: «+34600112233», «+34 600 11 22 33», «600.112.233»,
 * «600 11 22 33», «0034600112233», o varios en el mismo campo separados por barra o por punto y
 * coma. Sin una forma común, «esta llamada es a ese lead» no se puede saber, y la lista de
 * llamadas del día saldría con números sueltos en vez de con el nombre de la tienda.
 *
 * LA FORMA COMÚN ES LA CLAVE DE NUEVE CIFRAS: el número nacional español sin prefijo. Es lo que
 * identifica de verdad a un abonado en España, y quita de en medio los tres sitios donde se
 * escribe distinto el mismo número (el +34, el 0034 y los espacios o puntos). Un número de otro
 * país NO se recorta a nueve cifras —«+44 20 7946 0958» y «+49 20 7946 0958» no son el mismo
 * teléfono—: lleva su prefijo entero y un «+» delante, que no se parece a ninguna clave española.
 */

/**
 * La clave de un solo número, o null si no parece un teléfono.
 *
 * Con «+» o «00» delante manda el prefijo que traiga: «+34…» es España, lo demás es de fuera. Sin
 * prefijo, nueve cifras son un número español (fijo o móvil, que es lo que se teclea de memoria) y
 * once que empiezan por 34 son uno español escrito sin el más. Cualquier otra cosa —un código
 * interno, una extensión, un «9» suelto— NO se adivina: devuelve null.
 */
export function claveDeTelefono(crudo: unknown): string | null {
  if (crudo === null || crudo === undefined) return null
  const texto = String(crudo).trim()
  if (!texto) return null

  const llevaMas = texto.startsWith('+')
  const llevaDoblecero = /^00(?!0)/.test(texto)
  const cifras = texto.replace(/\D/g, '')
  if (cifras.length < 8) return null

  if (llevaMas || llevaDoblecero) {
    const conPrefijo = llevaDoblecero ? cifras.slice(2) : cifras
    if (conPrefijo.startsWith('34') && conPrefijo.length === 11) return conPrefijo.slice(2)
    // De otro país (o un +34 con más o menos cifras de las debidas): se conserva entero y se distingue con el «+»
    return conPrefijo.length >= 8 && conPrefijo.length <= 15 ? `+${conPrefijo}` : null
  }

  if (cifras.length === 9) return cifras
  if (cifras.length === 11 && cifras.startsWith('34')) return cifras.slice(2)
  return null
}

/**
 * Las claves de TODOS los teléfonos que lleve un texto. Un lead puede traer varios en el mismo
 * campo («931112244 / 600112233», «600112233; 931112244»), y el que sirve para casar la llamada
 * es cualquiera de ellos. Sin repetidos y en el orden en que aparecen.
 */
export function clavesDeTelefonos(texto: unknown): string[] {
  if (texto === null || texto === undefined) return []
  const claves: string[] = []
  for (const trozo of String(texto).split(/[/;,]|\s-\s/)) {
    const clave = claveDeTelefono(trozo)
    if (clave && !claves.includes(clave)) claves.push(clave)
  }
  return claves
}

/** El teléfono tal como se lee en pantalla: «+34 600 11 22 33». Si no es español se devuelve como llegó */
export function telefonoLegible(e164: string | null | undefined): string {
  if (!e164) return 'Número oculto'
  const m = /^\+34(\d{3})(\d{2})(\d{2})(\d{2})$/.exec(e164)
  return m ? `+34 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : e164
}
