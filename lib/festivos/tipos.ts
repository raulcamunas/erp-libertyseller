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
  /** Para todos los españoles, para la comunidad, o solo para una isla o el Valle de Arán */
  alcance: 'nacional' | 'comunidad' | 'zona'
}
