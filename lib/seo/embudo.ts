/**
 * SEO · EL DIAGNÓSTICO DEL EMBUDO DE BRAND ANALYTICS. PURO (se prueba sin base de datos ni Amazon).
 *
 * El SOP de la agencia (skill «seo-listing-amazon») manda mirar el embudo ANTES de tocar la ficha: impresiones → clics → carrito → compras, y en qué escalón se cae la cuota del producto. Ese
 * escalón dice QUIÉN tiene que arreglarlo:
 *
 *     se cae en      el trabajo es de
 *     impresiones    SEO (la ficha)
 *     clics          imagen principal, precio o reseñas — NO es SEO
 *     carrito        bullets, A+ o precio
 *     compra         envío o Buy Box
 *
 * Reescribir el título cuando la fuga está en los clics no cambia nada y gasta la única ventana de cambio del mes. Es el diagnóstico más valioso que se puede dar.
 *
 * CÓMO SE DECIDE QUE UN ESCALÓN «SE CAE». La cuota de impresiones de un producto es siempre pequeña (en una búsqueda salen decenas de productos), así que no se compara con un número fijo: se
 * compara cada escalón con el anterior (un embudo sano mantiene o sube la cuota al bajar: 8 % → 9 % → 11 % → 12 %). Si el producto se lleva el 3 % de las impresiones, lo esperable es que se
 * lleve un 3 % de los clics; si se queda por debajo del 70 % de lo esperable (ratio < 0,7), ahí se cae. El SOP decía «la mitad»; la investigación de nov 2026
 * (keepa-estudios/investigacion-seo-ppc-2026.md, §2.2) propone 0,7 porque una fuga del 30 % ya es grande. Es una ESTIMACIÓN: está en UMBRALES_DEL_EMBUDO para revisarla con datos propios.
 * Y solo se juzga cuando lo esperable son al menos 3 clics/carritos/compras: con 0 de 1 esperado no se puede decir nada (es azar), y decirlo sería inventar.
 *
 * INFRAEXPUESTA (misma investigación): si la cuota de compras es al menos 1,2 veces la de impresiones y la de impresiones no pasa del 20 %, el producto convierte mejor que la media cuando sale;
 * lo que le falta es salir más, y lo más rápido es publicidad (keyword EXACTA, subir puja o Top of Search en esa búsqueda). También es candidata a título o Item Highlights si no está.
 *
 * ANTES DE JUZGAR, SE DESCARTA (paso 3 del SOP):
 *   · Sin intención de compra: búsquedas que casi nunca acaban en compra («google», «mis reseñas»): no hay nada que ganar.
 *   · Otro precio, otra categoría: si el sector compra a menos de la mitad de nuestro precio, no hay título que lo arregle (y suele ser un falso amigo: «nfc» compra pegatinas de 8 €).
 * Lo que queda y no se cae en ningún escalón es VISIBILIDAD: cuando sale, le va bien; lo que falta es salir más. Eso sí es SEO.
 *
 * POCOS DATOS Y BÚSQUEDAS AJENAS (nov 2026). Si no se ha podido juzgar ningún escalón (lo esperable no llega a 3 en ninguno) y el producto no tiene ni un carrito ni una compra, no se sabe nada de
 * esa búsqueda: es 'sin-datos'. Antes caía en 'visibilidad' y búsquedas de otro producto («lego», «murdoku», «hitster juego de mesa», «risk») encabezaban las tareas y le llegaban a la IA como
 * «falta salir más». Si además (o si pierde en clics sin un carrito ni una compra propios) alguna palabra distintiva de la búsqueda no está en ninguna parte de la ficha, se marca `posibleAjena`:
 * sigue en la tabla y en la cobertura, pero no cuenta para las
 * palabras, la oportunidad, el embudo del producto ni la propuesta. Lo que el SEO decide a mano («No es nuestro producto», migración 333) manda sobre la heurística: 'ajena' (impacto 0) o «sí es
 * nuestro» (nunca posibleAjena).
 */

import { normalizar, palabras, type TextosDeFicha } from './cobertura'

export type Etapa = 'impresiones' | 'clics' | 'carrito' | 'compra'

export const ETAPAS: readonly Etapa[] = ['impresiones', 'clics', 'carrito', 'compra']

/** Quién tiene que arreglar cada escalón y qué se hace, en palabras del SOP */
/** Quién trabaja una búsqueda INFRAEXPUESTA: publicidad primero (es lo que da exposición ya), y el título si no la lleva */
export const RESPONSABLE_INFRAEXPUESTA = { quien: 'PPC', esSeo: false, accion: 'Darle exposición con publicidad: keyword EXACTA propia, subir la puja o Top of Search en esa búsqueda. Si no está en el título ni en los Item Highlights, también es candidata para el próximo cambio de ficha.' }

export const RESPONSABLE: Record<Etapa, { quien: string; accion: string; esSeo: boolean }> = {
  impresiones: { quien: 'SEO', esSeo: true, accion: 'Que la búsqueda esté en el título o en los Item Highlights; si ya está, empujarla con una keyword EXACTA en publicidad.' },
  clics: { quien: 'Imagen principal, precio o reseñas', esSeo: false, accion: 'No es SEO: no reescribas el título. Compara la imagen principal, el precio y las valoraciones con los que se llevan el clic en esa búsqueda.' },
  carrito: { quien: 'Bullets, A+ o precio', esSeo: false, accion: 'Entran pero no lo añaden: revisa que los bullets y el A+ respondan a esa búsqueda y que el precio no asuste frente al del sector.' },
  compra: { quien: 'Envío o Buy Box', esSeo: false, accion: 'Lo añaden pero no lo compran: revisa que tengas la Buy Box, el plazo de entrega y que no haya roturas de stock.' },
}

export const NOMBRE_DE_ETAPA: Record<Etapa, string> = { impresiones: 'Impresiones', clics: 'Clics', carrito: 'Carrito', compra: 'Compra' }

/** Lo que hace falta de una búsqueda (o de la suma de varias) para diagnosticarla */
export interface FilaDeEmbudo {
  consulta?: string
  volumen: number | null
  impresionesTotal?: number | null
  impresionesAsin?: number | null
  cuotaImpresiones: number | null
  clicsTotal?: number | null
  clicsAsin?: number | null
  cuotaClics: number | null
  carritosTotal?: number | null
  carritosAsin?: number | null
  cuotaCarritos: number | null
  comprasTotal: number | null
  comprasAsin: number | null
  cuotaCompras: number | null
  precioMedianoTotal?: number | null
  precioMedianoAsin?: number | null
}

export type Veredicto =
  /** Casi nadie compra tras esa búsqueda: no hay nada que ganar */
  | { tipo: 'ruido'; motivo: string }
  /** El sector compra a menos de la mitad de nuestro precio: ni el mejor título lo arregla */
  | { tipo: 'otro-precio'; motivo: string }
  /** Se cae en un escalón: el trabajo es de quien dice RESPONSABLE[etapa] */
  | { tipo: 'fuga'; etapa: Exclude<Etapa, 'impresiones'>; motivo: string; /** 0..1: cuánto de lo esperable se pierde */ caida: number }
  /** No se cae en ningún escalón: falta salir más (SEO). `fuerza` > 1 = cuando sale, convierte mejor que la media de la búsqueda */
  | { tipo: 'visibilidad'; motivo: string; fuerza: number | null }
  /** Compra ≥ 1,2 × impresiones con poca exposición: convierte de sobra, sale poco. Trabajo de PPC (y de título si no está) */
  | { tipo: 'infraexpuesta'; motivo: string; fuerza: number }
  /** Ya se lleva una parte grande de las compras: mantener */
  | { tipo: 'lider'; motivo: string }
  /** No se ha podido juzgar ningún escalón y no hay ni un carrito ni una compra propios: no se sabe nada (y puede ser de otro producto) */
  | { tipo: 'sin-datos'; motivo: string }
  /** El SEO ha dicho que no es nuestro producto (lista por cuenta y país, migración 333): no se trabaja */
  | { tipo: 'ajena'; motivo: string }

/**
 * LOS UMBRALES, TODOS ESTIMACIONES (sin fuente primaria; revisarlos tras un trimestre con datos propios). Se pueden cambiar por llamada con `ContextoDeEmbudo.umbrales`.
 *   caida           por debajo de esta fracción de lo esperable, el escalón «se cae» (0,7: investigación nov 2026; el SOP decía 0,5)
 *   minimoEsperado  lo mínimo esperable (clics, carritos o compras) para poder juzgar un escalón
 *   infraexpuesta   cuota de compras ÷ cuota de impresiones a partir de la cual convierte de sobra
 *   impresionesMax  …siempre que la cuota de impresiones no pase de esto
 *   comprasMinimas  compras propias mínimas para hablar de «infraexpuesta» (con una sola compra es azar)
 *   lider           cuota de compras a partir de la cual el producto ya manda en esa búsqueda
 */
export const UMBRALES_DEL_EMBUDO = { caida: 0.7, minimoEsperado: 3, infraexpuesta: 1.2, impresionesMax: 0.2, comprasMinimas: 2, lider: 0.3 }
export type UmbralesDelEmbudo = typeof UMBRALES_DEL_EMBUDO

const pct = (x: number) => `${(x * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`
const ent = (x: number) => Math.round(x).toLocaleString('es-ES')
const eur = (x: number) => x.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** La cuota de un escalón: de los recuentos si los hay (más fiable), si no la que da Amazon */
function cuotaDe(asin: number | null | undefined, total: number | null | undefined, cuota: number | null): number | null {
  if (asin != null && total != null && total > 0) return asin / total
  return cuota
}

export function cuotasDe(f: FilaDeEmbudo): Record<Etapa, number | null> {
  return {
    impresiones: cuotaDe(f.impresionesAsin, f.impresionesTotal, f.cuotaImpresiones),
    clics: cuotaDe(f.clicsAsin, f.clicsTotal, f.cuotaClics),
    carrito: cuotaDe(f.carritosAsin, f.carritosTotal, f.cuotaCarritos),
    compra: cuotaDe(f.comprasAsin, f.comprasTotal, f.cuotaCompras),
  }
}

/**
 * La «tasa de compra» de una búsqueda: compras de todo Amazon ÷ veces que se buscó. Sirve para saber si una búsqueda tiene intención de compra; se compara con la de las demás búsquedas del mismo
 * producto (un jamón entero se compra menos por búsqueda que unas pilas, y no por eso es ruido).
 */
export function tasaDeCompra(f: Pick<FilaDeEmbudo, 'volumen' | 'comprasTotal'>): number | null {
  if (!f.volumen || f.volumen <= 0 || f.comprasTotal == null) return null
  return f.comprasTotal / f.volumen
}

export function mediana(valores: readonly number[]): number | null {
  const v = [...valores].filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

export interface ContextoDeEmbudo {
  /** Nuestro precio (el del listing; si no, el mediano al que nos compran). null = no se mira el precio */
  precioPropio: number | null
  /** La tasa de compra mediana de las búsquedas del producto (ver tasaDeCompra). null = solo cuenta «cero compras» como ruido */
  tasaMediana: number | null
  /** Para cambiar algún umbral (ver UMBRALES_DEL_EMBUDO) */
  umbrales?: Partial<UmbralesDelEmbudo>
}

/** Una búsqueda es ruido si nadie compra o si se compra menos de una quinta parte de lo normal en las búsquedas del producto (y nunca por encima del 0,2 %) */
const UMBRAL_RUIDO_RELATIVO = 0.2
const UMBRAL_RUIDO_MINIMO = 0.002

/** EL DIAGNÓSTICO DE UNA BÚSQUEDA (o de la suma de varias) */
export function diagnosticar(f: FilaDeEmbudo, ctx: ContextoDeEmbudo): Veredicto {
  const u = { ...UMBRALES_DEL_EMBUDO, ...ctx.umbrales }
  const comprasTotal = f.comprasTotal ?? 0
  const tasa = tasaDeCompra(f)
  if (comprasTotal <= 0) return { tipo: 'ruido', motivo: `${ent(f.volumen ?? 0)} búsquedas y ninguna compra en todo Amazon: no hay nada que ganar.` }
  const umbralRuido = Math.max(UMBRAL_RUIDO_MINIMO, (ctx.tasaMediana ?? 0) * UMBRAL_RUIDO_RELATIVO)
  if (tasa != null && tasa < umbralRuido) return { tipo: 'ruido', motivo: `Casi nadie compra tras esta búsqueda (${ent(comprasTotal)} compras de ${ent(f.volumen ?? 0)} búsquedas): es de navegar o de otra cosa.` }

  if (ctx.precioPropio != null && ctx.precioPropio > 0 && f.precioMedianoTotal != null && f.precioMedianoTotal > 0 && f.precioMedianoTotal < ctx.precioPropio / 2) {
    return {
      tipo: 'otro-precio',
      motivo: `El sector compra a ${eur(f.precioMedianoTotal)} y tú vendes a ${eur(ctx.precioPropio)}: menos de la mitad. No hay título que lo arregle; suele ser otro producto (falso amigo).`,
    }
  }

  const c = cuotasDe(f)
  const totales: Record<Exclude<Etapa, 'impresiones'>, number | null | undefined> = { clics: f.clicsTotal, carrito: f.carritosTotal, compra: f.comprasTotal }
  const propios: Record<Exclude<Etapa, 'impresiones'>, number | null | undefined> = { clics: f.clicsAsin, carrito: f.carritosAsin, compra: f.comprasAsin }
  const anterior: Record<Exclude<Etapa, 'impresiones'>, Etapa> = { clics: 'impresiones', carrito: 'clics', compra: 'carrito' }

  // El primer escalón que se cae (en orden): arreglar ese primero, que lo de detrás depende de él
  let juzgados = 0
  for (const e of ['clics', 'carrito', 'compra'] as const) {
    const previa = c[anterior[e]]
    const total = totales[e]
    const propio = propios[e] ?? (c[e] != null && total != null ? (c[e] as number) * total : null)
    if (previa == null || total == null || propio == null) continue
    const esperado = previa * total
    if (esperado < u.minimoEsperado) continue
    juzgados++
    const ratio = propio / esperado
    if (ratio < u.caida) {
      const que = e === 'clics' ? 'clics' : e === 'carrito' ? 'añadidos al carrito' : 'compras'
      return {
        tipo: 'fuga',
        etapa: e,
        caida: 1 - ratio,
        motivo: `Con tu ${pct(previa)} de ${e === 'clics' ? 'las impresiones' : e === 'carrito' ? 'los clics' : 'los carritos'} te tocarían unos ${ent(esperado)} ${que} y has tenido ${ent(propio)}: se pierde el ${pct(1 - ratio)} en ${NOMBRE_DE_ETAPA[e].toLowerCase()}.`,
      }
    }
  }

  // Ningún escalón juzgable y ni un carrito ni una compra: no hay nada que decir (con 661 impresiones de 14 millones, «falta visibilidad» era inventar)
  if (juzgados === 0 && (f.comprasAsin ?? 0) === 0 && (f.carritosAsin ?? 0) === 0) {
    return {
      tipo: 'sin-datos',
      motivo:
        c.impresiones == null
          ? 'Amazon no da tus impresiones en esta búsqueda y no tienes ni un carrito ni una compra: pocos datos para juzgarla.'
          : `Sales en el ${pct(c.impresiones)} de las impresiones, sin carritos ni compras, y con eso no se puede juzgar ningún escalón del embudo: pocos datos. Si no describe tu producto, puede ser de otro.`,
    }
  }

  // Liderar con una compra de una es azar: hacen falta compras propias suficientes y un mercado que se pueda juzgar (lo mismo que se pide a «infraexpuesta»)
  if (c.compra != null && c.compra >= u.lider && (f.comprasAsin ?? 0) >= u.comprasMinimas && comprasTotal >= u.minimoEsperado)
    return { tipo: 'lider', motivo: `Ya te llevas el ${pct(c.compra)} de las compras de esta búsqueda: mantenerla.` }

  const imp = c.impresiones
  if (imp != null && imp > 0 && imp <= u.impresionesMax && c.compra != null && (f.comprasAsin ?? 0) >= u.comprasMinimas && c.compra / imp >= u.infraexpuesta) {
    const fuerza = c.compra / imp
    return {
      tipo: 'infraexpuesta',
      fuerza,
      motivo: `Sales en el ${pct(imp)} de las impresiones y te llevas el ${pct(c.compra)} de las compras (${fuerza.toLocaleString('es-ES', { maximumFractionDigits: 1 })} veces más): convierte de sobra, le falta exposición.`,
    }
  }

  const fuerza = imp != null && imp > 0 && c.compra != null && (f.comprasAsin ?? 0) > 0 ? c.compra / imp : imp != null && imp > 0 && c.clics != null && (f.clicsAsin ?? 0) > 0 ? c.clics / imp : null
  const motivo =
    imp == null
      ? 'Amazon no da tus impresiones en esta búsqueda.'
      : fuerza != null && fuerza >= u.infraexpuesta
        ? `Sales en el ${pct(imp)} de las impresiones y, cuando sales, te eligen ${fuerza.toLocaleString('es-ES', { maximumFractionDigits: 1 })} veces más que la media: hay que salir más. Es SEO.`
        : `Sales en el ${pct(imp)} de las impresiones y el resto del embudo no se cae: lo que falta es salir más. Es SEO.`
  return { tipo: 'visibilidad', motivo, fuerza }
}

/** Nuestro precio: el del listing; si no se sabe, la mediana del precio al que nos han comprado en las búsquedas */
export function precioPropioDe(precioListing: number | null | undefined, filas: ReadonlyArray<Pick<FilaDeEmbudo, 'precioMedianoAsin'>>): number | null {
  if (precioListing != null && precioListing > 0) return precioListing
  return mediana(filas.map((f) => f.precioMedianoAsin).filter((x): x is number => x != null && x > 0))
}

export function contextoDe(filas: ReadonlyArray<FilaDeEmbudo>, precioListing: number | null | undefined): ContextoDeEmbudo {
  return { precioPropio: precioPropioDe(precioListing, filas), tasaMediana: mediana(filas.map(tasaDeCompra).filter((x): x is number => x != null && x > 0)) }
}

/** La suma de varias búsquedas como si fueran una (para el embudo del producto entero) */
export function sumarEmbudo(filas: ReadonlyArray<FilaDeEmbudo>): FilaDeEmbudo {
  const s = (k: keyof FilaDeEmbudo) => filas.reduce((a, f) => a + (typeof f[k] === 'number' ? (f[k] as number) : 0), 0)
  const hay = (k: keyof FilaDeEmbudo) => filas.some((f) => typeof f[k] === 'number')
  const r: FilaDeEmbudo = {
    volumen: s('volumen'),
    impresionesTotal: hay('impresionesTotal') ? s('impresionesTotal') : null,
    impresionesAsin: hay('impresionesAsin') ? s('impresionesAsin') : null,
    clicsTotal: hay('clicsTotal') ? s('clicsTotal') : null,
    clicsAsin: hay('clicsAsin') ? s('clicsAsin') : null,
    carritosTotal: hay('carritosTotal') ? s('carritosTotal') : null,
    carritosAsin: hay('carritosAsin') ? s('carritosAsin') : null,
    comprasTotal: s('comprasTotal'),
    comprasAsin: s('comprasAsin'),
    cuotaImpresiones: null,
    cuotaClics: null,
    cuotaCarritos: null,
    cuotaCompras: null,
  }
  const c = cuotasDe(r)
  return { ...r, cuotaImpresiones: c.impresiones, cuotaClics: c.clics, cuotaCarritos: c.carrito, cuotaCompras: c.compra }
}

export interface BusquedaDiagnosticada<T extends FilaDeEmbudo> {
  fila: T
  veredicto: Veredicto
  /** Las compras de todo Amazon en esa búsqueda que todavía no son tuyas, ajustadas por lo que se puede ganar. SOLO PARA ORDENAR: no se enseña como compras (puede ser hasta el doble) */
  impacto: number
  /** Las compras de todo Amazon en esa búsqueda que todavía no son tuyas, tal cual (sin multiplicador): lo que se enseña */
  compras: number
  /** 'sin-datos' (o pierde en clics sin un carrito ni una compra propios) y con alguna palabra distintiva que no está en ninguna parte de la ficha: puede ser otro producto o una marca ajena. Sigue en
   * la tabla, pero no cuenta para la ficha */
  posibleAjena: boolean
}

/** Las compras que aún no son tuyas en una búsqueda (sin ajustar) */
export const comprasEnJuego = (f: Pick<FilaDeEmbudo, 'comprasTotal' | 'comprasAsin'>) => Math.max(0, (f.comprasTotal ?? 0) - (f.comprasAsin ?? 0))

/** Cuánto pesa arreglar una búsqueda: compras que aún no son tuyas. El ruido y lo ajeno no pesan, lo de otro precio pesa poco y lo que no se puede juzgar, algo */
export function impactoDe(f: FilaDeEmbudo, v: Veredicto): number {
  const enJuego = comprasEnJuego(f)
  if (v.tipo === 'ruido' || v.tipo === 'ajena') return 0
  if (v.tipo === 'otro-precio') return enJuego * 0.1
  if (v.tipo === 'sin-datos') return enJuego * 0.3
  if (v.tipo === 'lider') return enJuego * 0.2
  // Lo infraexpuesto convierte: cada impresión de más rinde por encima de la media
  if (v.tipo === 'infraexpuesta') return enJuego * Math.min(2, v.fuerza / 1.2)
  return enJuego
}

/** La ficha tal como la usa la heurística de búsquedas ajenas: también los Item Highlights si se han leído */
export type FichaParaAjenas = TextosDeFicha & { highlights?: string | null }

/** Lo que el SEO ha decidido a mano por cuenta y país (migración 333): búsquedas que no son del producto y búsquedas que la heurística marcaba y sí lo son. Texto tal cual: se normaliza dentro */
export interface DecisionesDeBusquedas {
  ajenas?: readonly string[]
  nuestras?: readonly string[]
}

export interface OpcionesDeDiagnostico extends DecisionesDeBusquedas {
  /** La ficha leída: sin ella no se marca ninguna búsqueda como posible ajena (no hay con qué comparar) */
  ficha?: FichaParaAjenas | null
}

/** La clave con que se guarda una búsqueda decidida a mano: sin tildes, mayúsculas ni signos */
export const claveDeBusqueda = (consulta: string) => normalizar(consulta).replace(/\s+/g, ' ')

/** Cuántas palabras más repetidas de las búsquedas del producto se consideran «del producto» (no distintivas) */
export const PALABRAS_COMUNES = 10

/**
 * Las palabras más repetidas en las búsquedas de un producto (por raíz, contando cada búsqueda una vez y sin las palabras vacías). Las que NO están aquí son «distintivas»: si una búsqueda sin
 * datos lleva una palabra distintiva que tampoco está en la ficha, puede ser de otro producto.
 */
export function palabrasComunes(consultas: readonly string[], n = PALABRAS_COMUNES): Set<string> {
  const veces = new Map<string, number>()
  for (const q of consultas) for (const r of new Set(palabras(q))) veces.set(r, (veces.get(r) ?? 0) + 1)
  // «Repetida» es que salga en al menos 2 búsquedas: en un producto con pocas búsquedas, las 10 primeras serían todas sus palabras y nada sería distintivo
  return new Set([...veces.entries()].filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([r]) => r))
}

/** Las palabras de la ficha (título, viñetas, Item Highlights, backend y descripción), en raíz */
export function palabrasDeLaFicha(ficha: FichaParaAjenas): Set<string> {
  return new Set(palabras([ficha.titulo, ...ficha.bullets, ficha.highlights, ficha.backend, ficha.descripcion].filter(Boolean).join(' ')))
}

/** ¿Lleva la búsqueda alguna palabra distintiva (ni de las comunes del producto ni de la ficha)? Los números sueltos y lo de menos de 3 letras no cuentan (dan falsos avisos) */
export function tienePalabraAjena(consulta: string, comunes: ReadonlySet<string>, enFicha: ReadonlySet<string>): boolean {
  return palabras(consulta).some((r) => r.length >= 3 && !/^\d+$/.test(r) && !comunes.has(r) && !enFicha.has(r))
}

/**
 * ¿Puede ser de otro producto por cómo le va? Sin datos (lo de siempre) o perdiendo en los clics sin un solo carrito ni compra propios: con 14 millones de impresiones de «lego», lo esperable de
 * clics ya se puede juzgar y sale «pierde en clics», pero no es la imagen: es que no es tu producto. Lo decide del todo la palabra distintiva (tienePalabraAjena).
 */
function puedeSerAjena(f: FilaDeEmbudo, v: Veredicto): boolean {
  if (v.tipo === 'sin-datos') return true
  return v.tipo === 'fuga' && v.etapa === 'clics' && (f.comprasAsin ?? 0) === 0 && (f.carritosAsin ?? 0) === 0
}

export function diagnosticarTodas<T extends FilaDeEmbudo>(filas: readonly T[], precioListing: number | null | undefined, opciones: OpcionesDeDiagnostico = {}): { contexto: ContextoDeEmbudo; busquedas: Array<BusquedaDiagnosticada<T>> } {
  const contexto = contextoDe(filas, precioListing)
  const ajenas = new Set((opciones.ajenas ?? []).map(claveDeBusqueda))
  const nuestras = new Set((opciones.nuestras ?? []).map(claveDeBusqueda))
  const comunes = palabrasComunes(filas.map((f) => f.consulta ?? ''))
  const enFicha = opciones.ficha ? palabrasDeLaFicha(opciones.ficha) : null
  const busquedas = filas.map((fila) => {
    const clave = claveDeBusqueda(fila.consulta ?? '')
    const veredicto: Veredicto = ajenas.has(clave) ? { tipo: 'ajena', motivo: 'Marcada como «No es nuestro producto»: no se trabaja en la ficha. Valora negativizarla en PPC.' } : diagnosticar(fila, contexto)
    const posibleAjena = puedeSerAjena(fila, veredicto) && !nuestras.has(clave) && enFicha != null && tienePalabraAjena(fila.consulta ?? '', comunes, enFicha)
    return { fila, veredicto, impacto: impactoDe(fila, veredicto), compras: veredicto.tipo === 'ajena' ? 0 : comprasEnJuego(fila), posibleAjena }
  })
  return { contexto, busquedas }
}

/** Las búsquedas que sí son del producto (ni ruido, ni de otro precio, ni marcadas como ajenas): sobre ellas se eligen las palabras de la ficha */
export const esRelevante = (v: Veredicto) => v.tipo !== 'ruido' && v.tipo !== 'otro-precio' && v.tipo !== 'ajena'

/** Relevante y sin sospecha de ser de otro producto: lo que cuenta para la ficha, las tareas, el embudo del producto, los paneles y la IA */
export const esDelProducto = (d: Pick<BusquedaDiagnosticada<FilaDeEmbudo>, 'veredicto' | 'posibleAjena'>) => esRelevante(d.veredicto) && !d.posibleAjena

/**
 * EL EMBUDO DEL PRODUCTO ENTERO: la suma de sus búsquedas relevantes, diagnosticada igual. Es la «puerta de salida» del SOP: si dice que la fuga está en clics, carrito o compra, reescribir la
 * ficha no es lo primero.
 */
export function embudoDelProducto<T extends FilaDeEmbudo>(diagnosticadas: ReadonlyArray<BusquedaDiagnosticada<T>>, contexto: ContextoDeEmbudo): { suma: FilaDeEmbudo; veredicto: Veredicto | null; relevantes: number; descartadas: number } {
  // Las posibles ajenas no se suman: 661 impresiones de 14 millones de «lego» hunden la cuota del producto sin decir nada de él
  const relevantes = diagnosticadas.filter(esDelProducto).map((d) => d.fila)
  const suma = sumarEmbudo(relevantes)
  // En la suma ya no se mira el precio ni el ruido: se han quitado antes
  const veredicto = relevantes.length === 0 ? null : diagnosticar(suma, { precioPropio: null, tasaMediana: null, umbrales: contexto.umbrales })
  return { suma, veredicto, relevantes: relevantes.length, descartadas: diagnosticadas.length - relevantes.length }
}
