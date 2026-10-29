/**
 * LOS TIPOS DE LOS FESTIVOS — solo tipos.
 * ========================================
 * Un calendario anual es lo que publica el BOE cada octubre: las fiestas de cada comunidad autónoma (y de Ceuta y Melilla), más dos notas al pie con las fiestas de las
 * islas de Canarias y la sustitución del Valle de Arán. Se genera con scripts/festivos-desde-boe.py en lib/festivos/datos/<año>.ts.
 */

import type { CodigoCcaa } from '@/lib/ubicacion/zonas'

/** Una zona más pequeña que la comunidad con fiestas propias: las siete islas de Canarias (La Graciosa cuenta con Lanzarote) y el Valle de Arán */
export type CodigoZona = 'hierro' | 'fuerteventura' | 'gran-canaria' | 'gomera' | 'palma' | 'lanzarote' | 'tenerife' | 'aran'

export interface FiestaDeComunidades {
  /** El día, «2026-11-02» */
  f: string
  /** El nombre, como lo escribe el BOE */
  n: string
  /** Las comunidades que la celebran; «todas» si son las diecinueve */
  c: 'todas' | readonly CodigoCcaa[]
}

export interface FiestaDeZona {
  f: string
  n: string
  z: CodigoZona
}

export interface CalendarioAnual {
  anio: number
  /** De dónde sale: el identificador del BOE */
  fuente: string
  fiestas: readonly FiestaDeComunidades[]
  zonas: readonly FiestaDeZona[]
  /** Un día en que la fiesta de la comunidad no se celebra en esa zona porque la sustituye otra */
  sinFiestaEnZona: readonly { f: string; z: CodigoZona }[]
}

/**
 * Una fiesta LOCAL: dos por municipio y año, que fija cada ayuntamiento y publica el boletín de cada comunidad (el BOE no las recoge). Se guarda con el código INE del municipio
 * (cinco cifras) y su nombre, que es lo que se enseña. Solo hay las de las comunidades cuyo boletín se ha cargado (hoy, la Comunidad de Madrid, 2026): para el resto de municipios no se
 * sabe, y no se inventa.
 */
export interface FiestaLocal {
  f: string
  ine: string
  lugar: string
}

/** Dónde está un lead, para saber si un día es festivo para él */
export interface Lugar {
  ccaa: CodigoCcaa
  /** El municipio (INE, cinco dígitos), si se sabe: hace falta para las islas de Canarias y el Valle de Arán */
  ine?: string | null
}

/** Una fiesta que cae en un día para un lugar */
export interface Fiesta {
  dia: string
  nombre: string
  /** Para todos los españoles, para la comunidad, para una isla o el Valle de Arán, o solo para su municipio (fiesta local) */
  alcance: 'nacional' | 'comunidad' | 'zona' | 'local'
  /** El municipio, en las fiestas locales */
  lugar?: string
}
