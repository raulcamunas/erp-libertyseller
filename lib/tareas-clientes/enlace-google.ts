/**
 * LOS ENLACES DE GOOGLE DRIVE Y DOCS EN LA TARJETA DE UNA TAREA — PURO. Entiende un enlace pegado en «Enlace» y dice si es un documento, una hoja, una presentación, un archivo o una carpeta de Google, con su identificador y
 * la dirección con la que se puede ver incrustado. Solo se aceptan https y los dos dominios de Google (docs.google.com y drive.google.com): cualquier otra cosa no es «un enlace de Google» y se queda como un enlace normal.
 * La dirección del visor es la de «vista previa» de Google (sin menús ni edición); quien la mira necesita tener acceso al archivo con su cuenta de Google. Se comprueba en enlace-google.prueba.ts.
 */

export type TipoDeEnlaceGoogle = 'documento' | 'hoja' | 'presentacion' | 'archivo' | 'carpeta' | 'formulario'

export interface EnlaceDeGoogle {
  tipo: TipoDeEnlaceGoogle
  /** El identificador del archivo o la carpeta en Drive */
  id: string
  /** El enlace tal cual se pegó (https), para abrirlo en Google */
  abrir: string
  /** La dirección para verlo incrustado, o null si Google no deja incrustar ese tipo (un formulario) */
  visor: string | null
  /** «Documento de Google», «Hoja de cálculo»… para cuando no se sabe el nombre */
  etiqueta: string
}

export const ETIQUETA_DE_TIPO: Record<TipoDeEnlaceGoogle, string> = {
  documento: 'Documento de Google',
  hoja: 'Hoja de cálculo de Google',
  presentacion: 'Presentación de Google',
  archivo: 'Archivo de Drive',
  carpeta: 'Carpeta de Drive',
  formulario: 'Formulario de Google',
}

const ID = /^[A-Za-z0-9_-]{10,128}$/

/** Un tramo de la dirección que puede ser «u/0» (el número de cuenta de Google): se salta */
function sinCuenta(partes: string[]): string[] {
  return partes[0] === 'u' && /^\d+$/.test(partes[1] ?? '') ? partes.slice(2) : partes
}

/**
 * Lo que hay en un enlace de Google Docs, Hojas, Presentaciones, Formularios o Drive: documento, hoja, presentación, archivo, carpeta o formulario. null si no es de Google o no se reconoce.
 */
export function leerEnlaceDeGoogle(texto: string | null | undefined): EnlaceDeGoogle | null {
  const bruto = (texto ?? '').trim()
  if (!bruto || bruto.length > 2000) return null
  let url: URL
  try {
    url = new URL(bruto)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase()
  const partes = url.pathname.split('/').filter(Boolean)
  const abrir = url.toString()
  const hecho = (tipo: TipoDeEnlaceGoogle, id: string | undefined, visor: (id: string) => string | null): EnlaceDeGoogle | null =>
    id && ID.test(id) ? { tipo, id, abrir, visor: visor(id), etiqueta: ETIQUETA_DE_TIPO[tipo] } : null

  if (host === 'docs.google.com') {
    const [familia, ...resto] = sinCuenta(partes)
    const sinC = sinCuenta(resto)
    const id = sinC[0] === 'd' ? sinC[1] : undefined
    if (familia === 'document') return hecho('documento', id, (i) => `https://docs.google.com/document/d/${i}/preview`)
    if (familia === 'spreadsheets') return hecho('hoja', id, (i) => `https://docs.google.com/spreadsheets/d/${i}/preview`)
    if (familia === 'presentation') return hecho('presentacion', id, (i) => `https://docs.google.com/presentation/d/${i}/preview`)
    // Un formulario publicado (/forms/d/e/<id>/viewform) se puede incrustar; el de edición no
    if (familia === 'forms') return hecho('formulario', sinC[0] === 'd' && sinC[1] === 'e' ? sinC[2] : id, () => null)
    return null
  }

  if (host === 'drive.google.com') {
    const p = sinCuenta(partes)
    // /file/d/<id>/view  ·  /file/u/0/d/<id>/view
    if (p[0] === 'file') {
      const q = sinCuenta(p.slice(1))
      return hecho('archivo', q[0] === 'd' ? q[1] : undefined, (i) => `https://drive.google.com/file/d/${i}/preview`)
    }
    // /drive/folders/<id>  ·  /drive/u/0/folders/<id>  ·  /folders/<id>
    const ruta = p[0] === 'drive' ? sinCuenta(p.slice(1)) : p
    if (ruta[0] === 'folders') return hecho('carpeta', ruta[1], (i) => `https://drive.google.com/embeddedfolderview?id=${i}#list`)
    // /open?id=<id>  ·  /uc?id=<id>: un archivo (o carpeta) por su identificador
    if (p[0] === 'open' || p[0] === 'uc') return hecho('archivo', url.searchParams.get('id') ?? undefined, (i) => `https://drive.google.com/file/d/${i}/preview`)
    return null
  }
  return null
}
