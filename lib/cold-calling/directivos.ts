/**
 * LOS DIRECTIVOS DE UN VENDEDOR, DE UN TEXTO A UNA LISTA.
 *
 * `cold_leads.directors` llega del Excel como una sola cadena: «NARRO GARCIA JULIAN (Administrador solidario); VALERO NAVARRO JUAN JOSE
 * (Administrador solidario); …». En la ficha eso eran siete líneas de mayúsculas pegadas, imposibles de recorrer con la vista mientras se
 * habla por teléfono. Aquí se separa en personas, se agrupa por cargo (seis «Administrador solidario» no se repiten seis veces) y se
 * escriben los nombres como se leen.
 *
 * SOLO PINTA. Lo guardado no se toca: el dato sigue siendo la cadena de siempre y la búsqueda, el Excel y la exportación la siguen usando
 * tal cual. Un texto que no se entiende se devuelve como UNA persona sin cargo (se ve entero) en vez de perderse.
 */

export interface Directivo {
  nombre: string
  cargo: string | null
}

export interface GrupoDeDirectivos {
  cargo: string | null
  nombres: string[]
}

/** Lo que va entre el último paréntesis de cierre de la pieza y su paréntesis de apertura. null si la pieza no termina en «)» */
function separarCargo(pieza: string): { nombre: string; cargo: string | null } {
  if (!pieza.endsWith(')')) return { nombre: pieza, cargo: null }
  let profundidad = 0
  for (let i = pieza.length - 1; i >= 0; i--) {
    const c = pieza[i]
    if (c === ')') profundidad++
    else if (c === '(') {
      profundidad--
      if (profundidad === 0) {
        const nombre = pieza.slice(0, i).trim()
        const cargo = pieza.slice(i + 1, -1).trim()
        // «(Administrador)» sin nombre delante no es un directivo: es un texto raro y se deja entero
        return nombre ? { nombre, cargo: cargo || null } : { nombre: pieza, cargo: null }
      }
    }
  }
  return { nombre: pieza, cargo: null }
}

export function parsearDirectivos(texto: string | null | undefined): Directivo[] {
  if (!texto) return []
  const vistos = new Set<string>()
  const resultado: Directivo[] = []
  for (const bruta of texto.split(/\s*(?:;|\n)\s*/)) {
    const pieza = bruta.replace(/\s+/g, ' ').trim()
    if (!pieza) continue
    const d = separarCargo(pieza)
    const clave = `${d.nombre.toLowerCase()}|${(d.cargo ?? '').toLowerCase()}`
    if (vistos.has(clave)) continue
    vistos.add(clave)
    resultado.push(d)
  }
  return resultado
}

/** Las formas societarias que se quedan en mayúsculas cuando el «directivo» es otra empresa */
const SIGLAS = new Set(['SL', 'SA', 'SLU', 'SAU', 'SLP', 'SLL', 'SLNE', 'SC', 'SCP', 'CB', 'SCOOP', 'AIE', 'UTE', 'ETT', 'SGR', 'SAL', 'SRL', 'LTD', 'LLC', 'GMBH', 'BV', 'II', 'III', 'IV'])
/** Las partículas que en un nombre español van en minúscula salvo al principio */
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'da', 'do', 'dos', 'das', 'van', 'von', 'der', 'di', 'du', 'le', 'al'])

/**
 * «NARRO GARCIA JULIAN» → «Narro Garcia Julian». Mismo orden y mismas letras: solo cambia entre mayúsculas y minúsculas. Un nombre que ya viene
 * con minúsculas se deja como está (alguien lo escribió así). No se inventan tildes: si el Excel no las trae, no se ponen.
 */
export function nombreLegible(nombre: string): string {
  if (nombre !== nombre.toUpperCase()) return nombre
  return nombre
    .toLowerCase()
    .split(' ')
    .map((palabra, i) => {
      if (SIGLAS.has(palabra.toUpperCase().replace(/\./g, ''))) return palabra.toUpperCase()
      if (i > 0 && PARTICULAS.has(palabra)) return palabra
      // Capitaliza también tras guion y apóstrofo: «ruiz-gomez» → «Ruiz-Gomez», «d'angelo» → «D'Angelo»
      return palabra.replace(/(^|[-'’])(\p{L})/gu, (_, antes: string, letra: string) => antes + letra.toUpperCase())
    })
    .join(' ')
}

/** El cargo en frase: «ADMINISTRADOR SOLIDARIO» → «Administrador solidario». Lo que ya viene en minúsculas se respeta */
export function cargoLegible(cargo: string): string {
  const t = cargo.trim()
  if (!t) return t
  if (t !== t.toUpperCase()) return t[0].toUpperCase() + t.slice(1)
  const minus = t.toLowerCase()
  return minus[0].toUpperCase() + minus.slice(1)
}

/** Agrupa por cargo (sin distinguir mayúsculas), en el orden en que aparece cada cargo por primera vez */
export function agruparPorCargo(directivos: readonly Directivo[]): GrupoDeDirectivos[] {
  const grupos = new Map<string, GrupoDeDirectivos>()
  for (const d of directivos) {
    const clave = (d.cargo ?? '').toLowerCase()
    let g = grupos.get(clave)
    if (!g) {
      g = { cargo: d.cargo ? cargoLegible(d.cargo) : null, nombres: [] }
      grupos.set(clave, g)
    }
    g.nombres.push(nombreLegible(d.nombre))
  }
  return [...grupos.values()]
}
