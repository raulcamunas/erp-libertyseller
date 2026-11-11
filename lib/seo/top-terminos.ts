/**
 * SEO · EL INFORME «TOP SEARCH TERMS» DE BRAND ANALYTICS, LEÍDO SIN CARGARLO ENTERO. PURO (se prueba sin Amazon).
 *
 * `GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT` trae, para CADA búsqueda de Amazon en el país, los 3 ASIN que más clics se llevan con su cuota de clics y de conversión:
 *
 *     { "reportSpecification": {…}, "dataByDepartmentAndSearchTerm": [ { "departmentName", "searchTerm", "searchFrequencyRank", "clickedAsin", "clickShareRank", "clickShare",
 *       "conversionShare" }, … ] }
 *
 * Son MILLONES de filas (cientos de MB): no cabe en memoria como texto ni hay por qué guardarlo. Se lee a trozos según llega y solo se queda con las búsquedas que importan (las que ya salen en el
 * Search Query Performance de los productos seguidos).
 *
 * CÓMO: un recorrido carácter a carácter que sabe si está dentro de una cadena (para no confundirse con una «{» que forme parte de una búsqueda) y que guarda el texto de cada OBJETO CUYO PADRE ES
 * UNA LISTA: esos son justo las filas de datos (la cabecera `reportSpecification` es un objeto dentro del objeto raíz, y su `reportOptions` también). Cada fila se interpreta con JSON.parse, que es
 * pequeño y seguro.
 */

export interface FilaTop {
  consulta: string
  posicion: number
  asin: string
  departamento: string | null
  rangoFrecuencia: number | null
  cuotaClics: number | null
  cuotaConversion: number | null
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

/** De una fila cruda del informe a la nuestra, o null si no vale */
export function filaTopDe(o: Record<string, unknown>): FilaTop | null {
  const consulta = typeof o.searchTerm === 'string' ? o.searchTerm.trim() : ''
  const asin = typeof o.clickedAsin === 'string' ? o.clickedAsin.trim().toUpperCase() : ''
  const posicion = num(o.clickShareRank)
  if (!consulta || !/^[A-Z0-9]{10}$/.test(asin) || posicion == null || posicion < 1 || posicion > 3) return null
  return {
    consulta,
    posicion,
    asin,
    departamento: typeof o.departmentName === 'string' ? o.departmentName : null,
    rangoFrecuencia: num(o.searchFrequencyRank),
    cuotaClics: num(o.clickShare),
    cuotaConversion: num(o.conversionShare),
  }
}

export const normalizarConsulta = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * El lector: se le van dando trozos de texto y devuelve las filas que interesan. `quiere` decide con la búsqueda ya normalizada (minúsculas, espacios simples). `maxFilas` es un tope de seguridad.
 */
export class LectorDeTop {
  private pila: Array<'{' | '['> = []
  private enCadena = false
  private escapado = false
  /** El texto del objeto que se está guardando, o null si no se guarda nada */
  private actual: string[] | null = null
  private inicioTrozo = -1
  /** La altura de la pila cuando empezó el objeto que se guarda: se cierra al volver a ella */
  private nivel = -1
  filasVistas = 0
  readonly guardadas: FilaTop[] = []

  constructor(
    private readonly quiere: (consultaNormalizada: string) => boolean,
    private readonly maxFilas = 60_000
  ) {}

  empujar(trozo: string): void {
    // Si un objeto empezó en un trozo anterior, se sigue guardando desde el principio de este
    this.inicioTrozo = this.actual ? 0 : -1
    for (let i = 0; i < trozo.length; i++) {
      const ch = trozo.charCodeAt(i)
      if (this.enCadena) {
        if (this.escapado) this.escapado = false
        else if (ch === 92 /* \ */) this.escapado = true
        else if (ch === 34 /* " */) this.enCadena = false
        continue
      }
      if (ch === 34) {
        this.enCadena = true
      } else if (ch === 123 /* { */) {
        // Un objeto cuyo padre es una lista: una fila de datos
        if (!this.actual && this.pila[this.pila.length - 1] === '[') {
          this.actual = []
          this.inicioTrozo = i
          this.nivel = this.pila.length
        }
        this.pila.push('{')
      } else if (ch === 91 /* [ */) {
        this.pila.push('[')
      } else if (ch === 125 /* } */ || ch === 93 /* ] */) {
        this.pila.pop()
        // Se cierra el objeto que se estaba guardando (la pila vuelve a la altura en que empezó)
        if (ch === 125 && this.actual && this.pila.length === this.nivel) {
          this.actual.push(trozo.slice(this.inicioTrozo, i + 1))
          this.cerrarObjeto(this.actual.join(''))
          this.actual = null
          this.inicioTrozo = -1
        }
      }
    }
    // El objeto sigue abierto al acabar el trozo: se guarda lo que lleva
    if (this.actual && this.inicioTrozo >= 0) this.actual.push(trozo.slice(this.inicioTrozo))
  }

  private cerrarObjeto(texto: string): void {
    this.filasVistas++
    if (this.guardadas.length >= this.maxFilas) return
    // Filtro barato antes de interpretar: la gran mayoría de filas no interesan
    const m = /"searchTerm"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(texto)
    if (!m) return
    let consulta: string
    try {
      consulta = JSON.parse(`"${m[1]}"`) as string
    } catch {
      return
    }
    if (!this.quiere(normalizarConsulta(consulta))) return
    try {
      const fila = filaTopDe(JSON.parse(texto) as Record<string, unknown>)
      if (fila) this.guardadas.push(fila)
    } catch {
      /* una fila rota no tumba el informe */
    }
  }
}

/** Las 3 primeras de cada búsqueda, una vez (Amazon a veces repite la búsqueda en varios departamentos: se queda la de mejor rango de frecuencia) */
export function unaPorPosicion(filas: readonly FilaTop[]): FilaTop[] {
  const por = new Map<string, FilaTop>()
  for (const f of filas) {
    const k = `${normalizarConsulta(f.consulta)}|${f.posicion}`
    const ya = por.get(k)
    if (!ya || (f.rangoFrecuencia ?? Infinity) < (ya.rangoFrecuencia ?? Infinity)) por.set(k, f)
  }
  return [...por.values()]
}
