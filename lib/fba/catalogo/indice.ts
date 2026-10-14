/**
 * LAS FILAS DE LA BASE DE DATOS, ORDENADAS PARA ELEGIR.
 * PURA: sin pantalla ni red.
 *
 * Los desplegables de una propuesta se encadenan —REF, después los colores de esa
 * REF, después las tallas de ese color— y para eso las filas planas tienen que
 * estar agrupadas. Se hace UNA vez al cargar, y cada desplegable lee el grupo que
 * le toca sin recorrer las cuatrocientas filas.
 *
 * La REF y el color se comparan sin mayúsculas ni tildes («Cuero» y «CUERO» son el
 * mismo color), pero se enseñan como los escribió quien los dio de alta primero.
 */

import { compararNatural, compararTalla } from './normalizar'
import { claveModelo, claveTalla, claveTexto, type FilaCatalogo } from './tipos'
import { estaCompleta } from './validar'

/** Un color de una REF con todas sus tallas */
export interface Modelo {
  clave: string
  ref: string
  nombre: string
  /** Ordenadas por talla */
  filas: FilaCatalogo[]
  /** Cuántas tallas le falta algún dato (FBASKU, EAN, FNSKU o ASIN) */
  incompletas: number
  /** Todas sus tallas están marcadas como sin continuidad */
  sinContinuidad: boolean
}

/** Una REF con sus colores */
export interface GrupoRef {
  clave: string
  ref: string
  modelos: Modelo[]
}

export interface IndiceCatalogo {
  grupos: GrupoRef[]
  /** Todos los modelos, por REF y color */
  modelos: Modelo[]
  /** Por FBASKU exacto: así se reconoce una línea ya guardada en una remesa */
  porSku: Map<string, FilaCatalogo>
  porId: Map<string, FilaCatalogo>
  /** Por REF + color + talla */
  porTalla: Map<string, FilaCatalogo>
}

export function construirIndice(filas: readonly FilaCatalogo[]): IndiceCatalogo {
  const porSku = new Map<string, FilaCatalogo>()
  const porId = new Map<string, FilaCatalogo>()
  const porTalla = new Map<string, FilaCatalogo>()
  const modelosPorClave = new Map<string, Modelo>()
  const gruposPorClave = new Map<string, GrupoRef>()

  // Ordenadas de entrada: la REF y el color que se enseñan son los primeros que
  // salen, y así no cambian de una carga a otra.
  const ordenadas = [...filas].sort(
    (a, b) => compararNatural(a.ref, b.ref) || compararNatural(a.nombre, b.nombre) || compararTalla(a.talla, b.talla)
  )

  for (const f of ordenadas) {
    porId.set(f.id, f)
    if (f.fbasku) porSku.set(f.fbasku, f)
    porTalla.set(claveTalla(f.ref, f.nombre, f.talla), f)

    const cm = claveModelo(f.ref, f.nombre)
    let modelo = modelosPorClave.get(cm)
    if (!modelo) {
      modelo = { clave: cm, ref: f.ref, nombre: f.nombre, filas: [], incompletas: 0, sinContinuidad: true }
      modelosPorClave.set(cm, modelo)

      const cr = claveTexto(f.ref)
      let grupo = gruposPorClave.get(cr)
      if (!grupo) {
        grupo = { clave: cr, ref: f.ref, modelos: [] }
        gruposPorClave.set(cr, grupo)
      }
      grupo.modelos.push(modelo)
    }
    modelo.filas.push(f)
    if (!estaCompleta(f)) modelo.incompletas += 1
    if (f.continuidad) modelo.sinContinuidad = false
  }

  const grupos = Array.from(gruposPorClave.values()).sort((a, b) => compararNatural(a.ref, b.ref))
  for (const g of grupos) g.modelos.sort((a, b) => compararNatural(a.nombre, b.nombre))

  return {
    grupos,
    modelos: grupos.flatMap((g) => g.modelos),
    porSku,
    porId,
    porTalla,
  }
}

/** Los colores de una REF. Vacío si no existe */
export function coloresDe(ix: IndiceCatalogo, ref: string): Modelo[] {
  const k = claveTexto(ref)
  return ix.grupos.find((g) => g.clave === k)?.modelos ?? []
}

export function buscarModelo(ix: IndiceCatalogo, ref: string, nombre: string): Modelo | undefined {
  const k = claveModelo(ref, nombre)
  return ix.modelos.find((m) => m.clave === k)
}

export function buscarTalla(ix: IndiceCatalogo, ref: string, nombre: string, talla: string): FilaCatalogo | undefined {
  return ix.porTalla.get(claveTalla(ref, nombre, talla))
}

/* ------------------------------------------------------------------ */
/* Buscar                                                              */
/* ------------------------------------------------------------------ */

/**
 * Todo lo que se puede teclear para encontrar un modelo, en una sola cadena y ya
 * sin mayúsculas ni tildes: la REF, el color y los códigos de cada talla. Así
 * pegar un EAN o un FBASKU en el buscador lleva al modelo al que pertenece.
 */
export function textoBuscable(m: Modelo): string {
  const partes = [m.ref, m.nombre]
  for (const f of m.filas) partes.push(f.ean ?? '', f.fnsku ?? '', f.asin ?? '', f.fbasku ?? '', f.codArt ?? '')
  return claveTexto(partes.join(' '))
}

/** ¿Encaja con lo escrito? Cada palabra tiene que aparecer en algún sitio */
export function coincide(textoModelo: string, busqueda: string): boolean {
  const palabras = claveTexto(busqueda).split(' ').filter(Boolean)
  return palabras.every((p) => textoModelo.includes(p))
}

/* ------------------------------------------------------------------ */
/* De la base de datos a una línea de remesa                           */
/* ------------------------------------------------------------------ */

/**
 * La forma de una línea elegida para una remesa. Es la misma que `Elegido`, la del
 * selector de productos de Amazon, a propósito: las pantallas que guardan líneas no
 * distinguen de dónde vinieron.
 */
export interface LineaElegida {
  sku: string
  titulo: string | null
  asin: string | null
  fnsku: string | null
  stock: number | null
  vendible: number | null
  unidades: number
  variante: string | null
  referencia: string | null
  ean: string | null
}

/**
 * LA ÚNICA TRADUCCIÓN ENTRE LOS DOS VOCABULARIOS.
 *
 *   FBASKU            -> sku       (el Merchant SKU del manifiesto)
 *   Nombre y color    -> titulo    (se guarda en la columna `nombre` de la línea)
 *   Talla             -> variante
 *   REF               -> referencia
 *
 * Es la misma correspondencia con la que se migraron las remesas del Excel
 * (migración 191), así que las líneas nuevas y las históricas tienen el mismo aspecto.
 *
 * Una talla sin FBASKU no tiene traducción: la remesa exige SKU. Quien llame tiene
 * que haber comprobado `sePuedeMandar` antes.
 */
export function aLineaElegida(f: FilaCatalogo, unidades: number): LineaElegida {
  if (!f.fbasku) throw new Error(`La talla ${f.talla} de ${f.ref} ${f.nombre} no tiene FBASKU`)
  return {
    sku: f.fbasku,
    titulo: f.nombre,
    asin: f.asin,
    fnsku: f.fnsku,
    stock: null,
    vendible: null,
    unidades,
    variante: f.talla,
    referencia: f.ref,
    ean: f.ean,
  }
}
