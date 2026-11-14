import { bloqueNuevo, textoDe, type Bloque } from './bloques'

/**
 * EL CUERPO DE UNA TAREA REPARTIDO EN DOS TARJETAS: LA LISTA DE TAREAS Y EL CONTEXTO — PURO.
 *
 * En el fondo sigue siendo UNA sola lista de bloques (la que se guarda y se manda a Notion): aquí solo se decide qué parte pinta cada tarjeta.
 *
 *   · LISTA   la primera tanda seguida de casillas («tarea»), con su encabezado «Lista de Tareas del proyecto» si lo tiene.
 *   · CONTEXTO todo lo demás (lo de antes de la lista y lo de después), sin el encabezado «Contexto» (la tarjeta ya se llama así).
 *
 * Al volver a juntarlo se conserva el sitio de cada cosa: lo que ya estaba antes de la lista sigue antes y lo de después sigue después. Los bloques se reconocen por su
 * identificador, así que un bloque nuevo que se escribe en el contexto cae del lado en el que estaba el cursor. Los encabezados se conservan tal cual (con su identificador de
 * Notion) mientras haga falta y se crean solos cuando una lista o un contexto nacen de cero, para que el cuerpo tenga siempre la misma forma que dejaba la rutina de las reuniones.
 */

export const TITULO_DE_LA_LISTA = 'Lista de Tareas del proyecto'
export const TITULO_DEL_CONTEXTO = 'Contexto'

export interface CuerpoSeparado {
  /** El encabezado de la lista tal como estaba (con su id de Notion), si lo había */
  cabeceraLista: Bloque | null
  /** Las casillas de la lista */
  lista: Bloque[]
  /** El encabezado «Contexto» tal como estaba, si lo había */
  cabeceraContexto: Bloque | null
  /** Lo que enseña la tarjeta de contexto: lo de antes de la lista y lo de después, sin el encabezado */
  contexto: Bloque[]
  /** Los bloques que estaban antes de la lista y los que estaban después (por id), para saber de qué lado cae un bloque nuevo */
  antes: ReadonlySet<string>
  despues: ReadonlySet<string>
  /** ¿Había algo escrito de verdad tras la lista? (un párrafo en blanco no cuenta) */
  despuesConContenido: boolean
  hayLista: boolean
}

const ENCABEZADOS = new Set(['h1', 'h2', 'h3'])
const esCabeceraDeLista = (b: Bloque | undefined): b is Bloque => Boolean(b && ENCABEZADOS.has(b.tipo) && /lista de tareas/i.test(textoDe(b.texto)))
const esCabeceraDeContexto = (b: Bloque | undefined): b is Bloque => Boolean(b && ENCABEZADOS.has(b.tipo) && /^\s*contexto\s*$/i.test(textoDe(b.texto)))

/** ¿Hay algo escrito de verdad? (un párrafo en blanco no cuenta) */
export const tieneContenido = (bloques: readonly Bloque[]): boolean => bloques.some((b) => b.tipo !== 'parrafo' || textoDe(b.texto).trim() !== '')

export function separarCuerpo(bloques: readonly Bloque[]): CuerpoSeparado {
  const primera = bloques.findIndex((b) => b.tipo === 'tarea')
  if (primera < 0) {
    const cabecera = esCabeceraDeContexto(bloques[0]) ? bloques[0] : null
    return { cabeceraLista: null, lista: [], cabeceraContexto: cabecera, contexto: cabecera ? bloques.slice(1) : [...bloques], antes: new Set(), despues: new Set(bloques.map((b) => b.id)), despuesConContenido: tieneContenido(cabecera ? bloques.slice(1) : bloques), hayLista: false }
  }
  const conCabecera = esCabeceraDeLista(bloques[primera - 1])
  const inicio = conCabecera ? primera - 1 : primera
  let fin = primera
  while (fin < bloques.length && bloques[fin].tipo === 'tarea') fin += 1
  const antes = bloques.slice(0, inicio)
  const despuesTodo = bloques.slice(fin)
  const cabeceraContexto = esCabeceraDeContexto(despuesTodo[0]) ? despuesTodo[0] : null
  const despues = cabeceraContexto ? despuesTodo.slice(1) : despuesTodo
  return {
    cabeceraLista: conCabecera ? bloques[inicio] : null,
    lista: bloques.slice(primera, fin),
    cabeceraContexto,
    contexto: [...antes, ...despues],
    antes: new Set(antes.map((b) => b.id)),
    despues: new Set(despues.map((b) => b.id)),
    despuesConContenido: tieneContenido(despues),
    hayLista: true,
  }
}

/**
 * Junta lo que se ha editado en cada tarjeta en el cuerpo completo. `previo` es lo que salió de `separarCuerpo` antes de editar: de él se sabe de qué lado estaba cada bloque
 * y qué encabezados había.
 */
export function unirCuerpo(previo: CuerpoSeparado, lista: readonly Bloque[], contexto: readonly Bloque[]): Bloque[] {
  let antes: Bloque[] = []
  let despues: Bloque[] = []
  if (previo.hayLista) {
    // Un bloque conocido va del lado en el que estaba; uno nuevo, del lado en el que está su vecino de arriba. Con bloques de los dos lados, lo nuevo de al principio va antes; si solo hay de
    // después (o ninguno), lo nuevo va después de la lista (escribir en un contexto vacío no puede colarse por encima de las casillas)
    let lado: 'antes' | 'despues' = previo.antes.size > 0 ? 'antes' : 'despues'
    for (const b of contexto) {
      if (previo.despues.has(b.id)) lado = 'despues'
      else if (previo.antes.has(b.id)) lado = previo.despues.size > 0 && lado === 'despues' ? 'despues' : 'antes'
      ;(lado === 'antes' ? antes : despues).push(b)
    }
  } else {
    despues = [...contexto]
    antes = []
  }
  const hayLista = lista.length > 0
  // El encabezado de la lista se crea solo cuando la lista NACE (una lista que ya existía sin encabezado se queda como estaba)
  const cabeceraLista = hayLista ? (previo.cabeceraLista ?? (previo.hayLista ? null : { ...bloqueNuevo('h1', TITULO_DE_LA_LISTA), texto: [{ t: TITULO_DE_LA_LISTA, k: 'green_background' }] })) : null
  // «Contexto» como encabezado solo si hay algo que encabezar y es la forma de siempre: ya lo había, o el contexto nace ahora (no había nada tras la lista) o nace la lista misma encima de un texto
  // suelto. Un texto que ya estaba tras la lista sin ese encabezado se deja como estaba: no se le inventa uno
  const nace = !previo.hayLista || !previo.despuesConContenido
  const conEncabezado = tieneContenido(despues) && (previo.cabeceraContexto !== null || (hayLista && nace))
  const cabeceraContexto = conEncabezado ? (previo.cabeceraContexto ?? bloqueNuevo('h2', TITULO_DEL_CONTEXTO)) : null
  return [...antes, ...(cabeceraLista ? [cabeceraLista] : []), ...lista, ...(cabeceraContexto ? [cabeceraContexto] : []), ...despues]
}
