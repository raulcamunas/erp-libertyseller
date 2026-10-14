/**
 * LEER UNA HOJA DE REFERENCIAS Y DECIR QUÉ HARÍA EN LA BASE DE DATOS.
 * PURA: sin pantalla ni red. Se comprueba con catalogo.prueba.ts.
 *
 * Dos pasos, y los dos se pueden ejecutar sin escribir nada:
 *
 *   leerCatalogo         el texto de la hoja -> filas limpias, más la lista de lo
 *                        que no se ha podido leer o merece una mirada.
 *   planificarImportacion  esas filas contra lo que ya hay -> qué es nuevo, qué
 *                        cambia, qué ya estaba y qué choca.
 *
 * La pantalla enseña el plan ANTES de aplicarlo, y el servidor lo recalcula contra
 * la base en el momento de escribir (no se fía del que le llega): así una carga
 * hecha con la lista de ayer no pisa lo que alguien corrigió hoy.
 *
 *
 * ============ NUNCA BORRA, NUNCA VACÍA ============
 *
 * Importar suma y completa. Una celda vacía en el archivo NO borra el dato que ya
 * hubiera en la base: si alguien completó un FNSKU a mano y mañana se vuelve a
 * subir una hoja vieja, el FNSKU se queda. Para quitar un dato se edita la fila.
 */

import Papa from 'papaparse'
import {
  limpiarCodigoAmazon,
  limpiarContinuidad,
  limpiarEan,
  limpiarPrecio,
  limpiarSku,
  limpiarTalla,
  limpiarTexto,
} from './normalizar'
import { claveTalla, type DatosFila, type FilaCatalogo } from './tipos'
import { avisosDeFila } from './validar'

/** Una fila de la hoja, ya limpia. `continuidad` null = la hoja no lo dice */
export interface FilaEntrante extends Omit<DatosFila, 'continuidad'> {
  continuidad: boolean | null
  /** El número de fila en la hoja, para decirle a quien la sube dónde mirar */
  fila: number
}

export type TipoAvisoImportacion =
  | 'saltada' //   no se importa: le falta REF, talla o color
  | 'repetida' //  la misma talla dos veces con los mismos datos: se junta
  | 'choque' //    dos filas se pisan con datos distintos: se queda la primera
  | 'dato' //      se importa, pero algo no tiene buena pinta

export interface AvisoImportacion {
  fila: number
  tipo: TipoAvisoImportacion
  texto: string
}

export interface LecturaCatalogo {
  filas: FilaEntrante[]
  avisos: AvisoImportacion[]
  /** Qué columna de la hoja se ha entendido como qué campo */
  columnas: Array<{ campo: CampoLeido; titulo: string }>
  /** Columnas con título que no se usan (CHECK…), para decirlo y que no sorprenda */
  ignoradas: string[]
  /** Filas con contenido que había en la hoja, importables o no */
  leidas: number
  /** Si no se ha podido ni empezar: la frase que se le enseña a la persona */
  error: string | null
}

type CampoLeido = keyof DatosFila

/** Los nombres con los que se reconoce cada columna. Sin tildes ni mayúsculas */
const NOMBRES: Record<CampoLeido, string[]> = {
  ref: ['ref', 'referencia', 'modelo', 'ref.'],
  nombre: ['nombre y color', 'nombre', 'color', 'producto', 'descripcion'],
  talla: ['talla', 'size', 'variante', 'numero'],
  ean: ['ean', 'ean13', 'ean 13', 'codigo de barras', 'barcode'],
  fnsku: ['fnsku'],
  asin: ['asin'],
  fbasku: ['fbasku', 'fba sku', 'sku', 'msku', 'sku amazon', 'seller sku', 'merchant sku'],
  codArt: ['cod art', 'cod. art', 'cod. art.', 'codart', 'cod articulo', 'codigo articulo', 'codigo de articulo'],
  continuidad: ['continuidad', 'continua', 'continuacion'],
  precio: ['precio', 'pvp', 'precio venta', 'precio de venta'],
  nota: ['nota', 'notas', 'observaciones', 'comentarios'],
}

function clave(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function campoDe(titulo: string): CampoLeido | null {
  const k = clave(titulo)
  if (!k) return null
  for (const [campo, nombres] of Object.entries(NOMBRES) as Array<[CampoLeido, string[]]>) {
    if (nombres.includes(k)) return campo
  }
  return null
}

const vacia = (celdas: string[]) => celdas.every((c) => (c ?? '').trim() === '')

/**
 * Lee lo que sale de copiar unas celdas de la hoja de cálculo (tabuladores) o de
 * abrir un CSV (comas o punto y coma, con las comillas de «74,95»). Papaparse
 * adivina el separador; la cabecera es la primera fila que reconoce REF y talla.
 */
export function leerCatalogo(texto: string): LecturaCatalogo {
  const vacio = (error: string): LecturaCatalogo => ({ filas: [], avisos: [], columnas: [], ignoradas: [], leidas: 0, error })

  const limpio = texto.replace(/^﻿/, '')
  if (limpio.trim() === '') return vacio('No hay nada que leer. Sube el archivo o pega las celdas con su fila de títulos.')

  const lectura = Papa.parse<string[]>(limpio, { skipEmptyLines: false })
  const tabla = lectura.data as string[][]

  // La cabecera: la primera fila (de las diez primeras) con REF y talla reconocidos
  let filaCabecera = -1
  for (let i = 0; i < Math.min(10, tabla.length); i++) {
    const campos = tabla[i].map(campoDe)
    if (campos.includes('ref') && campos.includes('talla')) {
      filaCabecera = i
      break
    }
  }
  if (filaCabecera < 0) {
    return vacio(
      'No encuentro las columnas. La primera fila tiene que llevar los títulos, al menos REF y Talla ' +
        '(y lo normal: Nombre y color, EAN, FBASKU, FNSKU y ASIN).'
    )
  }

  const cabecera = tabla[filaCabecera]
  const columnas: LecturaCatalogo['columnas'] = []
  const ignoradas: string[] = []
  const indice = new Map<CampoLeido, number>()
  const sinTitulo: number[] = []

  cabecera.forEach((titulo, i) => {
    const campo = campoDe(titulo)
    if (campo && !indice.has(campo)) {
      indice.set(campo, i)
      columnas.push({ campo, titulo: titulo.trim() })
    } else if (clave(titulo)) {
      ignoradas.push(titulo.trim())
    } else {
      sinTitulo.push(i)
    }
  })

  if (!indice.has('nombre')) {
    return vacio('Falta la columna «Nombre y color»: sin ella no se puede distinguir un color de otro.')
  }

  const cel = (r: string[], campo: CampoLeido): string => {
    const i = indice.get(campo)
    return i === undefined ? '' : (r[i] ?? '')
  }

  const filas: FilaEntrante[] = []
  const avisos: AvisoImportacion[] = []
  let leidas = 0

  // Para detectar repetidos dentro del propio archivo
  const porTalla = new Map<string, FilaEntrante>()
  const porSku = new Map<string, FilaEntrante>()
  const porFnsku = new Map<string, FilaEntrante>()
  const porAsin = new Map<string, FilaEntrante>()

  for (let i = filaCabecera + 1; i < tabla.length; i++) {
    const celdas = tabla[i]
    if (vacia(celdas)) continue
    leidas += 1
    const fila = i + 1

    const ref = limpiarTexto(cel(celdas, 'ref'))
    const nombre = limpiarTexto(cel(celdas, 'nombre'))
    const talla = limpiarTalla(cel(celdas, 'talla'))

    if (!ref) {
      avisos.push({ fila, tipo: 'saltada', texto: 'Sin REF: no se importa' })
      continue
    }
    if (!talla) {
      avisos.push({ fila, tipo: 'saltada', texto: `${ref} ${nombre}: sin talla (o con un error de la hoja): no se importa`.replace('  ', ' ') })
      continue
    }
    if (!nombre) {
      avisos.push({ fila, tipo: 'saltada', texto: `${ref} talla ${talla}: sin «Nombre y color»: no se importa` })
      continue
    }

    // Una columna sin título que lleve algo se toma por nota («REVISAR PRECIO»)
    const sueltas = sinTitulo.map((c) => limpiarTexto(celdas[c])).filter(Boolean)
    const nota = limpiarTexto(cel(celdas, 'nota')) || sueltas.join(' · ')

    const entrante: FilaEntrante = {
      fila,
      ref,
      nombre,
      talla,
      ean: limpiarEan(cel(celdas, 'ean')) || null,
      fnsku: limpiarCodigoAmazon(cel(celdas, 'fnsku')) || null,
      asin: limpiarCodigoAmazon(cel(celdas, 'asin')) || null,
      fbasku: limpiarSku(cel(celdas, 'fbasku')) || null,
      codArt: limpiarSku(cel(celdas, 'codArt')) || null,
      continuidad: limpiarContinuidad(cel(celdas, 'continuidad')),
      precio: limpiarPrecio(cel(celdas, 'precio')),
      nota: nota || null,
    }

    const etiqueta = `${ref} ${nombre} talla ${talla}`

    // ---------- La misma talla otra vez ----------
    const claveT = claveTalla(ref, nombre, talla)
    const previaT = porTalla.get(claveT)
    if (previaT) {
      if (mismosDatos(previaT, entrante)) {
        avisos.push({ fila, tipo: 'repetida', texto: `${etiqueta} está repetida (fila ${previaT.fila}): se junta` })
      } else {
        avisos.push({
          fila,
          tipo: 'choque',
          texto: `${etiqueta} ya estaba en la fila ${previaT.fila} con otros datos: se queda la de la fila ${previaT.fila}`,
        })
      }
      continue
    }

    // ---------- El mismo FBASKU en otra talla ----------
    if (entrante.fbasku) {
      const previaS = porSku.get(entrante.fbasku)
      if (previaS) {
        avisos.push({
          fila,
          tipo: 'choque',
          texto: `El FBASKU ${entrante.fbasku} ya es de la fila ${previaS.fila} (${previaS.ref} ${previaS.nombre} talla ${previaS.talla}): ${etiqueta} no se importa`,
        })
        continue
      }
    }

    // ---------- Se importa. Lo que merece una mirada se anota ----------
    for (const a of avisosDeFila(entrante)) {
      // Lo que falta se cuenta aparte, como «incompletas»; aquí solo lo que está mal escrito
      if (a.gravedad === 'aviso') avisos.push({ fila, tipo: 'dato', texto: `${etiqueta}: ${a.texto}` })
    }
    if (entrante.fnsku) {
      const otra = porFnsku.get(entrante.fnsku)
      if (otra) avisos.push({ fila, tipo: 'dato', texto: `${etiqueta}: comparte el FNSKU ${entrante.fnsku} con la fila ${otra.fila} (${otra.ref} ${otra.nombre} talla ${otra.talla}). Una de las dos está copiada` })
      else porFnsku.set(entrante.fnsku, entrante)
    }
    if (entrante.asin) {
      const otra = porAsin.get(entrante.asin)
      if (otra) avisos.push({ fila, tipo: 'dato', texto: `${etiqueta}: comparte el ASIN ${entrante.asin} con la fila ${otra.fila} (${otra.ref} ${otra.nombre} talla ${otra.talla}). Una de las dos está copiada` })
      else porAsin.set(entrante.asin, entrante)
    }

    porTalla.set(claveT, entrante)
    if (entrante.fbasku) porSku.set(entrante.fbasku, entrante)
    filas.push(entrante)
  }

  if (filas.length === 0 && leidas > 0) {
    return { filas, avisos, columnas, ignoradas, leidas, error: 'Ninguna fila tiene REF, Nombre y color y Talla a la vez: no hay nada que importar.' }
  }

  return { filas, avisos, columnas, ignoradas, leidas, error: null }
}

/** ¿Dicen lo mismo, ignorando lo que una de las dos no rellena? */
function mismosDatos(a: FilaEntrante, b: FilaEntrante): boolean {
  const campos: Array<keyof DatosFila> = ['ean', 'fnsku', 'asin', 'fbasku', 'codArt', 'precio']
  return campos.every((c) => a[c] === null || b[c] === null || a[c] === b[c])
}

/* ------------------------------------------------------------------ */
/* Contra lo que ya hay                                                */
/* ------------------------------------------------------------------ */

export interface CambioFila {
  id: string
  fila: number
  antes: FilaCatalogo
  despues: DatosFila
  /** Los campos que de verdad cambian */
  campos: Array<keyof DatosFila>
}

export interface PlanImportacion {
  nuevas: FilaEntrante[]
  cambios: CambioFila[]
  /** Ya estaban tal cual */
  iguales: number
  /** Las que no se pueden aplicar: pisarían otra fila de la base */
  conflictos: AvisoImportacion[]
}

const CAMPOS_COMPARABLES: Array<keyof DatosFila> = [
  'ref',
  'nombre',
  'talla',
  'ean',
  'fnsku',
  'asin',
  'fbasku',
  'codArt',
  'continuidad',
  'precio',
  'nota',
]

function iguales(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.005
  return a === b
}

/**
 * Para cada fila del archivo: ¿es nueva, completa una que ya existe, o no cambia nada?
 *
 * Se reconoce una fila existente por su FBASKU y, si no lo tiene, por REF + color +
 * talla. Lo que el archivo trae en blanco no se toca (ver arriba).
 */
export function planificarImportacion(entrantes: readonly FilaEntrante[], existentes: readonly FilaCatalogo[]): PlanImportacion {
  const porSku = new Map<string, FilaCatalogo>()
  const porTalla = new Map<string, FilaCatalogo>()
  for (const e of existentes) {
    if (e.fbasku) porSku.set(e.fbasku, e)
    porTalla.set(claveTalla(e.ref, e.nombre, e.talla), e)
  }

  const plan: PlanImportacion = { nuevas: [], cambios: [], iguales: 0, conflictos: [] }
  // Para que dos filas del archivo no acaben fusionándose con la misma de la base
  const tomadas = new Set<string>()

  for (const f of entrantes) {
    const etiqueta = `${f.ref} ${f.nombre} talla ${f.talla}`
    const porS = f.fbasku ? porSku.get(f.fbasku) : undefined
    const porT = porTalla.get(claveTalla(f.ref, f.nombre, f.talla))

    if (porS && porT && porS.id !== porT.id) {
      plan.conflictos.push({
        fila: f.fila,
        tipo: 'choque',
        texto: `${etiqueta}: el FBASKU ${f.fbasku} es de otra talla de la base (${porS.ref} ${porS.nombre} ${porS.talla}) y esta talla ya existe con otro FBASKU. Corrígelo a mano`,
      })
      continue
    }

    const existente = porS ?? porT
    if (!existente) {
      plan.nuevas.push(f)
      continue
    }

    if (tomadas.has(existente.id)) {
      plan.conflictos.push({ fila: f.fila, tipo: 'choque', texto: `${etiqueta}: otra fila del archivo ya actualiza esta misma talla de la base` })
      continue
    }
    tomadas.add(existente.id)

    // Si cambia el FBASKU, que no sea por uno que ya tiene otra fila de la base
    if (f.fbasku && f.fbasku !== existente.fbasku) {
      const propietaria = porSku.get(f.fbasku)
      if (propietaria && propietaria.id !== existente.id) {
        plan.conflictos.push({ fila: f.fila, tipo: 'choque', texto: `${etiqueta}: el FBASKU ${f.fbasku} ya lo tiene otra talla de la base` })
        continue
      }
    }

    // Lo que el archivo dice sobre lo que ya hay. Lo vacío no cuenta.
    const despues: DatosFila = {
      ref: f.ref,
      nombre: f.nombre,
      talla: f.talla,
      ean: f.ean ?? existente.ean,
      fnsku: f.fnsku ?? existente.fnsku,
      asin: f.asin ?? existente.asin,
      fbasku: f.fbasku ?? existente.fbasku,
      codArt: f.codArt ?? existente.codArt,
      continuidad: f.continuidad ?? existente.continuidad,
      precio: f.precio ?? existente.precio,
      nota: f.nota ?? existente.nota,
    }
    const campos = CAMPOS_COMPARABLES.filter((c) => !iguales(despues[c], existente[c]))
    if (campos.length === 0) plan.iguales += 1
    else plan.cambios.push({ id: existente.id, fila: f.fila, antes: existente, despues, campos })
  }

  return plan
}

/* ------------------------------------------------------------------ */
/* Lo que cuenta la API                                                */
/* ------------------------------------------------------------------ */

export interface ResumenImportacion {
  simulado: boolean
  sinMigrar: boolean
  /** Si no se ha podido leer el archivo: la frase para enseñar */
  error: string | null
  leidas: number
  importables: number
  columnas: Array<{ campo: string; titulo: string }>
  ignoradas: string[]
  nuevas: number
  cambian: number
  iguales: number
  avisos: AvisoImportacion[]
  conflictos: AvisoImportacion[]
  /** Los primeros cambios, para enseñar qué se va a tocar */
  cambios: Array<{ fila: number; etiqueta: string; campos: string[] }>
  /** Solo al aplicar */
  resultado: { creadas: number; actualizadas: number; fallidas: number } | null
}
