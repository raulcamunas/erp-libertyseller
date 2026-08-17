/**
 * ORIGEN «API DEL PROVEEDOR»: no hay fichero, se arma en el momento.
 * ================================================================
 * SOLO SERVIDOR: aquí se usan las credenciales del proveedor.
 *
 * Los otros cinco conectores son lo mismo con distinta puerta: alguien deja un
 * Excel en un sitio y el ERP va a buscarlo. Este no. Se llama a la API del
 * proveedor del cliente, se pide su catálogo entero y con la respuesta se
 * fabrica el volcado.
 *
 * Lo que gana el módulo con esto es todo lo que desaparece: no hay fichero que
 * nadie tenga que acordarse de dejar, ni carpeta que se pueda mover, ni
 * exportación nocturna que se quede colgada sirviendo los datos de anteayer sin
 * que nadie se entere. Casi todos los fallos silenciosos de este módulo
 * empiezan en uno de esos tres sitios.
 *
 * Y lo que aparece a cambio, que hay que decirlo: si la API del proveedor está
 * caída no hay volcado viejo con el que salir del paso. Por eso «subida a mano»
 * sigue existiendo y sigue siendo la salida de emergencia.
 *
 *
 * ============ POR QUÉ DEVUELVE UN CSV Y NO LAS FILAS YA LEÍDAS ============
 *
 * Porque el contrato de esta carpeta es que todos los conectores devuelven un
 * FicheroOrigen y a partir de ahí el proceso es idéntico venga de donde venga.
 * Romperlo para ahorrarse un CSV en memoria significaría que las reglas, el
 * cruce, los frenos y el simulacro tendrían dos caminos distintos que mantener
 * — y el segundo, el nuevo, sin los años de casos raros que tiene el primero.
 *
 * Así que aquí se serializa a CSV y el lector de siempre lo abre. El fichero no
 * toca el disco: existe medio segundo, en memoria.
 *
 *
 * ============ EL CSV TIENE QUE SALIR IDÉNTICO SI NADA HA CAMBIADO ============
 *
 * Esto no es manía: `procesarPerfil` decide si hay volcado nuevo comparando el
 * SHA-256 de los bytes con el de la última vez. Si el CSV llevara la fecha
 * dentro, o si el orden de las filas dependiera de en qué orden le apeteciera
 * contestar a la API, la huella cambiaría en cada pasada y el ERP reprocesaría
 * y volvería a contrastar el catálogo entero cada media hora para acabar
 * diciendo «sin cambios». El historial se llenaría de ruido y la única señal que
 * importa —«hoy el volcado ha cambiado»— se perdería dentro.
 *
 * De ahí las tres reglas: filas ORDENADAS POR CÓDIGO, columnas en orden fijo, y
 * ninguna fecha dentro del fichero. En el NOMBRE sí va, que no entra en la
 * huella y ayuda a saber qué se descargó al mirar una ejecución vieja.
 *
 *
 * ============ EL STOCK NEGATIVO SE COPIA TAL CUAL, CON SU SIGNO ============
 *
 * La API devuelve negativos —se han visto -1, -8 y -100— y significan que han
 * vendido más unidades de las que tenían. Aquí la tentación es convertirlos a
 * cero de paso, ya que Amazon no admite negativos.
 *
 * SERÍA UN ERROR, y se descubrió comprobándolo: el lector ya los convierte a
 * cero, pero además LOS CUENTA y saca un aviso diciendo cuántos artículos
 * están sobrevendidos en el almacén del cliente. Ese aviso es el único sitio
 * donde ese dato existe, porque después de la conversión un -56 y un 0 de
 * verdad son indistinguibles. Capándolos aquí el aviso no saltaría nunca y el
 * dato se perdería sin que nadie notara que faltaba.
 *
 * Así que este conector transporta y no interpreta. Quien decide qué significa
 * un número es el lector, que ya sabe.
 *
 *
 * ============ LAS CREDENCIALES Y SU LÍMITE DE HOY ============
 *
 * Salen del entorno del servidor (ver lib/entrais/api.ts), no de
 * `stock_origen_credenciales`. Es lo que ya estaba montado y funcionando.
 *
 * LA LIMITACIÓN QUE ESO IMPONE, ESCRITA PARA QUE NO SE DESCUBRA SOLA: hay UNAS
 * credenciales de Entrais para todo el ERP. El día que un segundo cliente
 * compre al mismo proveedor con su propia cuenta, esto le serviría el catálogo
 * del primero —con sus precios de compra— sin dar ningún error. Antes de que
 * eso pase hay que mover el secreto a la tabla cifrada por perfil, que es donde
 * viven los del SFTP y los del FTPS y donde este debería acabar.
 */

import {
  EntraisError,
  llamarEntraisDetalle,
  type EntornoEntrais,
  type ProductoEntrais,
} from '@/lib/entrais/api'
import { OrigenError, textoConfig, type ConectorOrigen, type ContextoOrigen, type FicheroOrigen } from './tipos'

/** Los proveedores a los que este conector sabe llamar */
const PROVEEDORES = [{ valor: 'entrais', etiqueta: 'Entrais · aseuropa.com' }]

/**
 * LAS CABECERAS SON LOS NOMBRES QUE LOS PERFILES YA BUSCAN.
 *
 * Aquí había «COD_INTERNO», copiado del fichero de tarifa del proveedor, y
 * estaba mal: un perfil recién creado busca la referencia entre «Articulo»,
 * «Cod.Articulo», «Codigo articulo», «Referencia» y «SKU», así que el conector
 * generaba un fichero impecable que el lector rechazaba por no reconocer la
 * columna. El aviso lo explicaba bien, pero es una configuración de más que no
 * tiene por qué existir.
 *
 * «SKU» además es lo correcto y no una comodidad: el `code` del proveedor ES el
 * SKU con el que el cliente tiene creados sus listings en Amazon —comprobado
 * contra Seller Central, cinco de cinco—. Llamarlo de otra forma escondería
 * justo el hecho del que depende que el cruce funcione.
 */
const CABECERAS = ['SKU', 'EAN', 'STOCK', 'PRECIO', 'CANON', 'DIGITAL', 'NOMBRE'] as const

function entornoDe(config: Record<string, unknown>): EntornoEntrais {
  // Por omisión, PRUEBAS. Un perfil a medio configurar tiene que apuntar al
  // entorno que no tiene consecuencias, no al del cliente de verdad.
  return textoConfig(config, 'entorno') === 'real' ? 'real' : 'pruebas'
}

/**
 * Una celda de CSV, siempre entrecomillada.
 *
 * Siempre, y no solo cuando hace falta, porque las descripciones del proveedor
 * llevan comillas dentro con toda naturalidad —«SSD 2,5''», «MONITOR 27"»— y
 * comas, y puntos y comas. Entrecomillar solo a veces obliga a acertar con la
 * condición; entrecomillar siempre no tiene condición que acertar.
 */
function celda(valor: string | number): string {
  const texto = String(valor ?? '')
    // Un salto de línea dentro de una celda parte la fila en dos y el lector se
    // encuentra media línea sin código. Pasa en las descripciones largas.
    .replace(/[\r\n]+/g, ' ')
    .replace(/"/g, '""')
  return `"${texto}"`
}

/**
 * El catálogo del proveedor, en CSV.
 *
 * Los decimales van con PUNTO y siempre con dos cifras. El lector avisa de que
 * un número con un separador seguido de exactamente tres cifras es ambiguo
 * —«1.499» puede ser mil cuatrocientos noventa y nueve o uno con cuatrocientos
 * noventa y nueve— y con dos decimales fijos ese caso no puede darse.
 */
function aCsv(productos: ProductoEntrais[]): { csv: string; negativos: number } {
  let negativos = 0

  // ORDEN FIJO POR CÓDIGO. Ver la nota de la huella arriba: sin esto el fichero
  // sale distinto cada vez aunque el catálogo no se haya movido.
  const ordenados = [...productos].sort((a, b) => a.code - b.code)

  const lineas = [CABECERAS.join(';')]
  for (const p of ordenados) {
    if (p.stock < 0) negativos++
    lineas.push(
      [
        celda(p.code),
        celda(p.ean ?? ''),
        // Con su signo. Ver la nota de arriba: el lector lo capa y AVISA, y
        // ese aviso es lo que dice qué artículos están sobrevendidos.
        celda(Math.trunc(p.stock)),
        celda(p.price.toFixed(2)),
        celda((p.digitalCanon ?? 0).toFixed(2)),
        celda(p.digital ? 'SI' : 'NO'),
        celda(p.description ?? ''),
      ].join(';')
    )
  }

  return { csv: lineas.join('\n'), negativos }
}

interface Catalogo {
  fichero: FicheroOrigen
  total: number
  conStock: number
  negativos: number
  deCache: boolean
  edadMs: number
  quedan: number | null
  limite: number | null
}

/** Trae el catálogo y lo deja hecho fichero. Es lo único que llama a la API */
async function traerCatalogo(ctx: ContextoOrigen): Promise<Catalogo> {
  const proveedor = textoConfig(ctx.config, 'proveedor') || 'entrais'
  if (proveedor !== 'entrais') {
    throw new OrigenError(
      `El perfil «${ctx.perfil}» apunta al proveedor «${proveedor}», y este conector solo sabe hablar con Entrais. ` +
        'Elige un proveedor de la lista.'
    )
  }

  const entorno = entornoDe(ctx.config)

  let lectura: Awaited<ReturnType<typeof llamarEntraisDetalle<ProductoEntrais[]>>>
  try {
    /**
     * SIN FORZAR FRESCURA, y es lo importante de esta línea.
     *
     * Entrais deja CUATRO llamadas por hora al catálogo. Se deja decidir a la
     * caché de lib/entrais/api.ts, que sirve lo de hace menos de veinte minutos
     * y solo llama cuando el dato ha vencido. Con el perfil a treinta minutos
     * el ciclo siempre encuentra la caché vencida y trae datos frescos; lo que
     * se ahorra son las llamadas de quien está configurando el perfil a base de
     * probar, mirar y volver a probar — que sin esto agota la hora en cuatro
     * clics.
     */
    lectura = await llamarEntraisDetalle<ProductoEntrais[]>(entorno, '/api/v1/Products')
  } catch (error) {
    // Se traduce a OrigenError para que el módulo lo cuente como «no llego al
    // origen» —que es lo que es— y no como «el fichero no encaja con el
    // perfil», que mandaría a mirar columnas que están perfectamente.
    if (error instanceof EntraisError) {
      throw new OrigenError(error.message, { esDeAcceso: error.estado === 401 || error.estado === 403 })
    }
    throw new OrigenError(
      `No se ha podido leer el catálogo de Entrais para el perfil «${ctx.perfil}»: ` +
        (error instanceof Error ? error.message : 'error desconocido'),
      { esDeAcceso: true }
    )
  }

  const productos = lectura.datos
  if (!Array.isArray(productos)) {
    throw new OrigenError(
      'Entrais ha contestado algo que no es una lista de productos. Su API ha cambiado de forma o el entorno elegido no es el que toca.'
    )
  }

  /**
   * UN CATÁLOGO VACÍO NO SE PROCESA, SE PARA.
   *
   * Si esto siguiera, el volcado tendría cero líneas, el cruce no casaría con
   * nada y el simulacro propondría poner a cero el stock de todo el catálogo de
   * Amazon. Los frenos lo pararían —para eso están— pero un freno saltando por
   * algo que se sabía aquí es una alarma que alguien tiene que ir a mirar.
   */
  if (productos.length === 0) {
    throw new OrigenError(
      `Entrais ha contestado sin ningún producto en el entorno «${entorno}». No se sigue: un volcado ` +
        'vacío pondría a cero el stock de todo el catálogo. Comprueba el entorno del perfil y que la cuenta del cliente sigue activa.'
    )
  }

  const { csv, negativos } = aCsv(productos)
  const bytes = Buffer.from(csv, 'utf8')

  if (bytes.byteLength > ctx.maxBytes) {
    throw new OrigenError(
      `El catálogo de Entrais son ${productos.length.toLocaleString('es-ES')} productos y ocupa ` +
        `${mb(bytes.byteLength)} MB, por encima del máximo de ${mb(ctx.maxBytes)} MB.`
    )
  }

  /**
   * LA FECHA ES LA DE LA LECTURA, NO LA DE AHORA.
   *
   * Si esto sale de la caché, el dato es de hace un rato y decir que es de
   * ahora sería mentir en el único sitio donde se mira para saber si el volcado
   * está fresco: la ficha de la ejecución.
   */
  const leidoEn = new Date(Date.now() - lectura.edadMs)

  return {
    total: productos.length,
    conStock: productos.filter((p) => p.stock > 0).length,
    negativos,
    deCache: lectura.deCache,
    edadMs: lectura.edadMs,
    quedan: lectura.cuota?.quedan ?? null,
    limite: lectura.cuota?.limite ?? null,
    fichero: {
      // La fecha va en el NOMBRE y no dentro: así se sabe de cuándo era al
      // mirar una ejecución vieja, y la huella sigue dependiendo solo del
      // contenido.
      nombre: `entrais-${entorno}-${leidoEn.toISOString().slice(0, 16).replace('T', '-')}.csv`,
      bytes,
      idExterno: null,
      // SIN HUELLA PROPIA: una API no tiene md5 ni fecha de modificación que
      // dar. Quien decide si hay novedad es el SHA-256 que `procesarPerfil`
      // calcula sobre estos bytes, y por eso el CSV se genera determinista.
      huella: null,
      modificadoAt: leidoEn.toISOString(),
      tamano: bytes.byteLength,
    },
  }
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

export const conectorApi: ConectorOrigen = {
  id: 'api',
  etiqueta: 'API del proveedor',
  descripcion:
    'Se conecta a la API del proveedor del cliente y arma el volcado en el momento. No hay fichero que nadie tenga que dejar en ningún sitio, así que tampoco hay fichero que se quede viejo sin avisar. OJO: Entrais solo admite 4 llamadas por hora a su catálogo, así que la cadencia de este perfil no puede bajar de 30 minutos.',
  construido: true,

  campos: [
    {
      clave: 'proveedor',
      etiqueta: 'Proveedor',
      tipo: 'opcion',
      ayuda: 'A qué API se llama. Cada una tiene su forma de identificarse y sus campos.',
      requerido: true,
      opciones: PROVEEDORES,
    },
    {
      clave: 'entorno',
      etiqueta: 'Entorno',
      tipo: 'opcion',
      ayuda:
        'Pruebas es el catálogo de mentira del proveedor y sirve para configurar el perfil sin tocar nada. Real es la cuenta del cliente: es el que hay que dejar puesto cuando el perfil esté listo para enviar.',
      requerido: true,
      opciones: [
        { valor: 'pruebas', etiqueta: 'Pruebas' },
        { valor: 'real', etiqueta: 'Real' },
      ],
    },
  ],

  /**
   * Sin explorador: no hay carpetas que abrir ni mensajes que listar. Lo que
   * hay es una respuesta, y «Comprobar» ya la trae entera y la resume.
   */

  async comprobar(ctx) {
    try {
      const cat = await traerCatalogo(ctx)
      return {
        ok: true,
        mensaje:
          `Entrais (${entornoDe(ctx.config)}) ha devuelto ${cat.total.toLocaleString('es-ES')} productos, ` +
          `${cat.conStock.toLocaleString('es-ES')} con stock` +
          (cat.negativos > 0
            ? `, y ${cat.negativos} sobrevendidos (stock negativo), que se publicarán como cero. `
            : '. ') +
          // LA CUOTA SE DICE SIEMPRE, no solo cuando se agota. Enterarse de que
          // solo hay cuatro llamadas por hora el día que se acaban es
          // enterarse tarde.
          (cat.deCache
            ? `Sin gastar cuota: es la lectura de hace ${Math.max(1, Math.round(cat.edadMs / 60_000))} minutos.`
            : 'Llamada nueva.') +
          (cat.quedan !== null
            ? ` Quedan ${cat.quedan} de ${cat.limite} llamadas de esta hora.`
            : ''),
        candidatos: [
          {
            nombre: cat.fichero.nombre,
            idExterno: null,
            modificadoAt: cat.fichero.modificadoAt,
            tamano: cat.fichero.tamano,
            elegido: true,
            descarte: null,
            nota: `Columnas: ${CABECERAS.join(', ')}`,
          },
        ],
      }
    } catch (error) {
      return {
        ok: false,
        mensaje: error instanceof Error ? error.message : 'No se ha podido leer la API del proveedor.',
        candidatos: [],
      }
    }
  },

  async traer(ctx) {
    const { fichero } = await traerCatalogo(ctx)
    return fichero
  },
}
