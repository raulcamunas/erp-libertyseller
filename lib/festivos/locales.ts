/**
 * LAS FIESTAS LOCALES QUE CONOCE LA APP. Dos por municipio y año, que fija cada ayuntamiento y publica el boletín oficial de su comunidad: no hay una lista nacional, así que se cargan
 * comunidad a comunidad desde el boletín. Hoy: la Comunidad de Madrid, 2026 (scripts/festivos-locales-madrid.py, del BOCM). Las de 2027 se publican en diciembre de 2026.
 *
 * Lo que no está aquí NO es «sin fiestas locales»: es «no se sabe». Un lead de un municipio sin fiestas cargadas solo recibe los avisos de su comunidad.
 */

import type { FiestaLocal } from './tipos'
import { LOCALES_2026_MD } from './datos/locales-2026-md'

export const FIESTAS_LOCALES: readonly FiestaLocal[] = [...LOCALES_2026_MD]
