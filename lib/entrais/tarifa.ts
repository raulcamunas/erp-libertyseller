/**
 * ENTRAIS · EL CSV DE TARIFA DEL PROVEEDOR
 * ========================================
 * PURO: sin base de datos, sin red, sin React. Lo importa el servidor y lo
 * importa el navegador, y por eso está separado de `bloqueados.ts`.
 *
 * Esa separación no es de estilo. El fichero de tarifa son VEINTE MEGAS —casi
 * todo descripciones largas que no se usan— y de sus veinticinco columnas hacen
 * falta cuatro. Subirlo entero al servidor para tirar el 99 % es pedirle a un
 * proxy que lo deje pasar; el sitio donde suele morir eso es en un límite de
 * tamaño de cuerpo que nadie recuerda haber puesto.
 *
 * Así que lo lee la pantalla y manda lo que queda: unos kilobytes. Lo que el
 * servidor NO hace es fiarse de eso a ciegas — ver `cargarTarifa`.
 */

/* ------------------------------------------------------------------ */
/* Leer el fichero de tarifa                                           */
/* ------------------------------------------------------------------ */

export interface FilaTarifa {
  sku: string
  nombre: string
  familia: string
  precio: number | null
  envioDirecto: boolean
}

/**
 * EL CSV DEL PROVEEDOR VIENE EN LATIN-1 Y SEPARADO POR PUNTO Y COMA.
 *
 * Las dos cosas hay que saberlas de antemano y ninguna se puede adivinar sin
 * riesgo: leído como UTF-8 el fichero no falla, simplemente sale con «Códigó»
 * y «GARANTÍA» rotos, y eso no se nota hasta que alguien mira la lista. De
 * descodificarlo se encarga quien lee el fichero; aquí llega ya como texto.
 *
 * Se lee con un analizador propio y no con el lector del módulo de stock a
 * propósito. Aquel resuelve el problema difícil —qué columna es cuál cuando
 * cada proveedor las llama de otra forma— y para eso necesita un perfil con sus
 * alias. Aquí el fichero tiene una forma fija, conocida, y de sus veinticinco
 * columnas hacen falta cuatro. Montar un perfil para eso sería configuración que
 * alguien tiene que mantener a cambio de nada.
 *
 * Lo que sí importa es que las descripciones llevan comillas dentro con toda
 * naturalidad —«SSD 2,5''», «GARANTIA 1 AÑO ''in situ''»— y saltos de línea en
 * los campos largos. De ahí que esto sea un analizador de verdad con estado de
 * «dentro de comillas» y no un `split(';')`, que partiría esas filas en trozos.
 */
export function leerTarifa(texto: string): FilaTarifa[] {

  const filas: string[][] = []
  let campo = ''
  let fila: string[] = []
  let dentro = false

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (dentro) {
      if (c === '"') {
        // Dos comillas seguidas dentro de un campo son una comilla literal.
        if (texto[i + 1] === '"') {
          campo += '"'
          i++
        } else dentro = false
      } else campo += c
    } else if (c === '"') dentro = true
    else if (c === ';') {
      fila.push(campo)
      campo = ''
    } else if (c === '\n') {
      fila.push(campo)
      filas.push(fila)
      fila = []
      campo = ''
    } else if (c !== '\r') campo += c
  }
  if (campo !== '' || fila.length > 0) {
    fila.push(campo)
    filas.push(fila)
  }

  if (filas.length === 0) throw new Error('El fichero de tarifa está vacío.')

  const cabecera = filas[0].map((c) => c.trim().toUpperCase())
  const col = (nombre: string) => cabecera.indexOf(nombre)

  const iSku = col('COD_INTERNO')
  const iEnvio = col('ENVIO_DIRECTO')

  /**
   * Si falta alguna de las dos se para AQUÍ y con nombres.
   *
   * Sin esto, un fichero que no sea la tarifa —o una versión suya en la que el
   * proveedor haya renombrado la columna— se leería entero, encontraría cero
   * artículos de envío directo y dejaría la lista de bloqueados VACÍA. Un
   * bloqueo que no bloquea nada y además parece cargado es el peor resultado
   * posible de esta pantalla.
   */
  if (iSku < 0 || iEnvio < 0) {
    const faltan = [iSku < 0 ? 'COD_INTERNO' : null, iEnvio < 0 ? 'ENVIO_DIRECTO' : null]
      .filter(Boolean)
      .join(' y ')
    throw new Error(
      `Al fichero le falta la columna ${faltan}. Las que trae son: ` +
        `${cabecera.slice(0, 30).join(', ')}. ¿Seguro que es el CSV de tarifa del proveedor?`
    )
  }

  const iNombre = col('NOMBRE')
  const iFamilia = col('FAMILIA')
  const iPrecio = col('PRECIO')

  const resultado: FilaTarifa[] = []
  for (const f of filas.slice(1)) {
    const sku = (f[iSku] ?? '').trim()
    if (!sku) continue
    const marca = (f[iEnvio] ?? '').trim().toUpperCase()
    resultado.push({
      sku,
      nombre: (f[iNombre] ?? '').trim(),
      familia: (f[iFamilia] ?? '').trim(),
      // Los importes vienen con coma decimal y punto de millares: «1.492,60».
      precio: numero(f[iPrecio] ?? ''),
      // «SI», y se admiten las variantes de siempre por si cambian de criterio.
      envioDirecto: marca === 'SI' || marca === 'SÍ' || marca === 'S' || marca === '1',
    })
  }
  return resultado
}

function numero(v: string): number | null {
  const limpio = v.trim().replace(/\./g, '').replace(',', '.')
  if (!limpio) return null
  const n = Number(limpio)
  return Number.isFinite(n) ? n : null
}

