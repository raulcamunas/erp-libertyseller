/**
 * SEO · EDITAR LA FICHA DESDE EL ERP: QUÉ SE MANDA A AMAZON Y CÓMO SE COMPRUEBA QUE HA QUEDADO. PURO (se prueba sin Amazon).
 *
 * Lo usan las dos puertas que escriben en una ficha: el editor a mano (pestaña Ficha) y «Aplicar en Amazon» de la propuesta con IA. Las dos pasan por
 * lib/seo/edicion-servidor.ts, que valida antes en Amazon (VALIDATION_PREVIEW), apunta quién y cuándo en `seo_ediciones` (migración 312) y, al releer la
 * ficha, compara campo a campo con lo enviado.
 *
 *   · planDePatch       el PATCH exacto de la Listings API, solo con los campos que cambian. Los Item Highlights van con el atributo que tenga el tipo de
 *                       producto (sale de la Product Type Definitions API); si no lo tiene, NO se pierden en silencio: se devuelve un aviso.
 *   · verificarEdicion  ¿lo que hay ahora en la ficha es lo que se mandó? Amazon acepta el envío (ACCEPTED) aunque luego gane otro contribuidor o su IA lo
 *                       reescriba: «aceptado» no es «aplicado».
 */

import { bytesDe, caracteresDe, LIMITE_BACKEND_BYTES, LIMITE_BULLETS_BYTES, LIMITE_HIGHLIGHTS_CARACTERES, LIMITE_TITULO_CARACTERES } from './cobertura'
import { revisarFicha, type Incidencia } from './norma'

export type CampoFicha = 'titulo' | 'highlights' | 'bullets' | 'descripcion' | 'backend'
export const CAMPOS_FICHA: readonly CampoFicha[] = ['titulo', 'highlights', 'bullets', 'descripcion', 'backend']

export const NOMBRE_DE_CAMPO: Record<CampoFicha, string> = {
  titulo: 'Título',
  highlights: 'Item Highlights',
  bullets: 'Viñetas',
  descripcion: 'Descripción',
  backend: 'Backend',
}

/** Los textos editables de una ficha. `highlights` y `descripcion` pueden faltar (propuestas viejas, tipos de producto sin highlights) */
export interface TextosFicha {
  titulo: string
  highlights?: string | null
  bullets: string[]
  descripcion?: string | null
  backend: string
}

/** Lo que Amazon admite en la descripción (2.000 caracteres en casi todas las categorías) */
export const LIMITE_DESCRIPCION_CARACTERES = 2000
export const MAX_VINETAS = 5

/** Espacios normalizados: lo que Amazon devuelve puede traer dobles espacios o saltos que no cambian nada */
export const normalizarTexto = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

const valorDe = (t: TextosFicha, campo: CampoFicha): string => (campo === 'bullets' ? t.bullets.map(normalizarTexto).filter(Boolean).join('\n') : normalizarTexto(t[campo] as string | null | undefined))

/** Los campos que de verdad cambian entre lo que hay y lo nuevo (lo que no cambia no se manda: así no se pisa nada sin querer) */
export function camposCambiados(antes: TextosFicha, despues: TextosFicha): CampoFicha[] {
  return CAMPOS_FICHA.filter((c) => {
    // Unos highlights o una descripción que no vienen en lo nuevo no se tocan (no es «borrarlos»)
    if ((c === 'highlights' || c === 'descripcion') && (despues[c] === undefined || despues[c] === null)) return false
    return valorDe(antes, c) !== valorDe(despues, c)
  })
}

/* ------------------------------------------------------------------ */
/* Los límites, para el editor y para el servidor                      */
/* ------------------------------------------------------------------ */

export interface MedidaDeCampo {
  campo: CampoFicha
  valor: number
  limite: number
  unidad: 'car.' | 'bytes'
  pasa: boolean
}

/** Los contadores del editor, con la norma de 2026 (título 75 car., highlights 125, viñetas 1.000 bytes, descripción 2.000 car., backend 249 bytes) */
export function medidasDeEdicion(t: TextosFicha): MedidaDeCampo[] {
  const m = (campo: CampoFicha, valor: number, limite: number, unidad: MedidaDeCampo['unidad']): MedidaDeCampo => ({ campo, valor, limite, unidad, pasa: valor > limite })
  return [
    m('titulo', caracteresDe(t.titulo), LIMITE_TITULO_CARACTERES, 'car.'),
    m('highlights', caracteresDe(t.highlights ?? ''), LIMITE_HIGHLIGHTS_CARACTERES, 'car.'),
    m('bullets', t.bullets.reduce((s, b) => s + bytesDe(b), 0), LIMITE_BULLETS_BYTES, 'bytes'),
    m('descripcion', caracteresDe(t.descripcion ?? ''), LIMITE_DESCRIPCION_CARACTERES, 'car.'),
    m('backend', bytesDe(t.backend), LIMITE_BACKEND_BYTES, 'bytes'),
  ]
}

/**
 * Lo que impide mandar la edición (no hay vuelta: Amazon reescribe o ignora) y lo que solo se avisa. El servidor lo vuelve a comprobar: el navegador no
 * manda.
 */
export function bloqueosDeEdicion(t: TextosFicha, campos: readonly CampoFicha[]): { bloqueos: string[]; incidencias: Incidencia[] } {
  const bloqueos: string[] = []
  const toca = (c: CampoFicha) => campos.includes(c)
  if (toca('titulo') && !normalizarTexto(t.titulo)) bloqueos.push('El título no puede quedar vacío.')
  for (const md of medidasDeEdicion(t)) {
    if (!toca(md.campo) || !md.pasa) continue
    bloqueos.push(`${NOMBRE_DE_CAMPO[md.campo]}: ${md.valor.toLocaleString('es-ES')} de ${md.limite.toLocaleString('es-ES')} ${md.unidad}.${md.campo === 'backend' ? ' Un byte de más y Amazon lo ignora entero.' : md.campo === 'titulo' ? ' Amazon reescribe los títulos fuera de norma.' : ''}`)
  }
  if (toca('bullets')) {
    const llenas = t.bullets.filter((b) => normalizarTexto(b)).length
    if (llenas === 0) bloqueos.push('Hay que dejar al menos una viñeta.')
    if (t.bullets.length > MAX_VINETAS) bloqueos.push(`Como mucho ${MAX_VINETAS} viñetas.`)
  }
  const { incidencias } = revisarFicha({ titulo: t.titulo, bullets: t.bullets, descripcion: t.descripcion ?? null, backend: t.backend })
  return { bloqueos, incidencias }
}

/* ------------------------------------------------------------------ */
/* El atributo de los Item Highlights                                   */
/* ------------------------------------------------------------------ */

/**
 * LOS NOMBRES POSIBLES DEL ATRIBUTO. La Listings API no tiene un nombre fijo y documentado para los Item Highlights en todos los tipos de producto: se mira
 * en la definición del tipo (getDefinitionsProductType → propertyGroups[*].propertyNames) cuál de estos tiene. Si no tiene ninguno, se avisa y no se manda.
 */
export const CANDIDATOS_HIGHLIGHTS = ['item_highlights', 'item_highlight', 'product_highlights', 'highlights'] as const

/** De los atributos que admite el tipo de producto, el de los Item Highlights (o null si no lo tiene) */
export function atributoDeHighlights(propiedades: Iterable<string>): string | null {
  const todas = [...propiedades]
  const set = new Set(todas)
  for (const c of CANDIDATOS_HIGHLIGHTS) if (set.has(c)) return c
  return todas.find((p) => /highlight/i.test(p)) ?? null
}

type ValorDeAtributo = { value?: unknown; marketplace_id?: string; language_tag?: string }

/** Los valores de texto de un atributo de un listing, de este marketplace (o, si ninguno dice cuál, todos) */
export function valoresDeAtributo(atributos: Record<string, unknown> | undefined, clave: string, marketplaceId: string): string[] {
  const lista = (atributos?.[clave] ?? []) as ValorDeAtributo[]
  if (!Array.isArray(lista)) return []
  const delMercado = lista.filter((v) => !v.marketplace_id || v.marketplace_id === marketplaceId)
  return (delMercado.length > 0 ? delMercado : lista).map((v) => (typeof v.value === 'string' ? v.value.trim() : '')).filter(Boolean)
}

/** Los Item Highlights de un listing leído: con el atributo conocido, o buscando entre los nombres posibles */
export function highlightsDeAtributos(atributos: Record<string, unknown> | undefined, marketplaceId: string, atributo?: string | null): string | null {
  const clave = atributo ?? atributoDeHighlights(Object.keys(atributos ?? {}))
  if (!clave) return null
  const v = valoresDeAtributo(atributos, clave, marketplaceId)
  return v.length > 0 ? v.join(' ') : null
}

/* ------------------------------------------------------------------ */
/* El PATCH                                                            */
/* ------------------------------------------------------------------ */

export interface OperacionDeFicha {
  op: 'replace'
  path: string
  value: Array<{ value: string; language_tag: string; marketplace_id: string }>
}

const RUTA: Record<Exclude<CampoFicha, 'highlights'>, string> = {
  titulo: '/attributes/item_name',
  bullets: '/attributes/bullet_point',
  descripcion: '/attributes/product_description',
  backend: '/attributes/generic_keyword',
}

/**
 * El PATCH de los campos pedidos, en ESTE marketplace y con el idioma de la ficha. `replace` es un valor absoluto: mandarlo dos veces deja lo mismo.
 *   · Viñetas: se manda la lista entera (Amazon sustituye todas las del marketplace), sin vacías.
 *   · Backend vacío: no se manda (no se borra el que hubiera sin querer).
 *   · Highlights: solo con atributo conocido; si no, aviso.
 */
export function planDePatch(t: TextosFicha, campos: readonly CampoFicha[], o: { marketplaceId: string; languageTag: string; atributoHighlights: string | null }): { patches: OperacionDeFicha[]; avisos: string[]; enviados: CampoFicha[] } {
  const v = (value: string) => ({ value, language_tag: o.languageTag, marketplace_id: o.marketplaceId })
  const patches: OperacionDeFicha[] = []
  const avisos: string[] = []
  const enviados: CampoFicha[] = []
  for (const c of CAMPOS_FICHA) {
    if (!campos.includes(c)) continue
    if (c === 'highlights') {
      const h = normalizarTexto(t.highlights)
      if (!h) continue
      if (!o.atributoHighlights) {
        avisos.push('Este tipo de producto no tiene el atributo de Item Highlights en Amazon: no se han mandado. Pégalos a mano en Seller Central si la ficha los admite.')
        continue
      }
      patches.push({ op: 'replace', path: `/attributes/${o.atributoHighlights}`, value: [v(h)] })
      enviados.push(c)
      continue
    }
    if (c === 'bullets') {
      const lista = t.bullets.map(normalizarTexto).filter(Boolean).slice(0, MAX_VINETAS)
      if (lista.length === 0) continue
      patches.push({ op: 'replace', path: RUTA.bullets, value: lista.map(v) })
      enviados.push(c)
      continue
    }
    const texto = c === 'descripcion' ? (t.descripcion ?? '').trim() : normalizarTexto(t[c])
    if (!texto) continue
    patches.push({ op: 'replace', path: RUTA[c], value: [v(texto)] })
    enviados.push(c)
  }
  return { patches, avisos, enviados }
}

/* ------------------------------------------------------------------ */
/* La verificación                                                     */
/* ------------------------------------------------------------------ */

export type EstadoVerificado = 'aplicada' | 'no_aplicada' | 'parcial' | 'pendiente'
export type ComparacionDeCampo = 'igual' | 'distinto' | 'sin_leer'

/** Tras cuánto se da por perdida una edición que todavía no se ve en la ficha (Amazon suele tardar minutos; con imágenes o revisiones, horas) */
export const HORAS_PARA_DAR_POR_NO_APLICADA = 24
/** Antes de esto no se juzga: Amazon procesa el envío en unos minutos */
export const MINUTOS_ANTES_DE_VERIFICAR = 5

/**
 * ¿Lo que se lee ahora es lo que se mandó? Campo a campo, con los espacios normalizados (y las viñetas en orden). Un campo que la lectura no trae (los
 * highlights de un tipo sin atributo legible) queda «sin_leer» y no cuenta.
 *   · todos iguales                 → aplicada
 *   · alguno igual y alguno distinto → parcial (si ya pasó el plazo) o pendiente
 *   · ninguno igual                  → no_aplicada (si ya pasó el plazo) o pendiente
 */
export function verificarEdicion(enviado: TextosFicha, leido: Partial<TextosFicha>, campos: readonly CampoFicha[], horasDesdeEnvio: number): { estado: EstadoVerificado; campos: Partial<Record<CampoFicha, ComparacionDeCampo>> } {
  const res: Partial<Record<CampoFicha, ComparacionDeCampo>> = {}
  for (const c of campos) {
    const l = leido[c]
    if (l === undefined || l === null) {
      res[c] = 'sin_leer'
      continue
    }
    res[c] = valorDe(enviado, c) === valorDe({ titulo: '', bullets: [], backend: '', ...leido } as TextosFicha, c) ? 'igual' : 'distinto'
  }
  const juzgados = Object.values(res).filter((x) => x !== 'sin_leer')
  const iguales = juzgados.filter((x) => x === 'igual').length
  const plazo = horasDesdeEnvio >= HORAS_PARA_DAR_POR_NO_APLICADA
  // Nada se ha podido leer (Amazon no devuelve el SKU): no se puede decir que haya quedado. Pasado el plazo, no aplicada (antes salía «aplicada»)
  if (juzgados.length === 0) return { estado: plazo ? 'no_aplicada' : 'pendiente', campos: res }
  if (iguales === juzgados.length) return { estado: 'aplicada', campos: res }
  if (!plazo) return { estado: 'pendiente', campos: res }
  return { estado: iguales > 0 ? 'parcial' : 'no_aplicada', campos: res }
}

/** Qué decir de una edición verificada que no ha quedado: lo más probable, sin inventar */
export function explicacionDeNoAplicada(estado: EstadoVerificado, campos: Partial<Record<CampoFicha, ComparacionDeCampo>>): string | null {
  if (estado !== 'no_aplicada' && estado !== 'parcial') return null
  const distintos = (Object.entries(campos) as Array<[CampoFicha, ComparacionDeCampo]>).filter(([, v]) => v === 'distinto').map(([k]) => NOMBRE_DE_CAMPO[k].toLowerCase())
  if (distintos.length === 0) return 'En 24 horas no se ha podido releer la ficha (Amazon no devuelve el SKU en esta cuenta y país): no se puede confirmar que el cambio haya quedado. Revísalo en Seller Central.'
  return `Amazon aceptó el envío pero en la ficha no está ${distintos.join(', ')}: suele ser porque otro contribuidor (o el fabricante) tiene prioridad sobre ese campo, o porque Amazon lo ha reescrito. Revísalo en Seller Central (Gestionar inventario → Editar → «Ver contribución»).`
}
