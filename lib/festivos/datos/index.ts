/**
 * LOS CALENDARIOS QUE CONOCE LA APP. Cada octubre el BOE publica el del año siguiente: se genera con
 *   /Users/raulcamunas/venv/bin/python scripts/festivos-desde-boe.py --boe BOE-A-… --anio <año>
 * y se añade aquí una línea. Sin el calendario de un año la app no dice nada de los festivos de ese año (no inventa).
 */

import type { CalendarioAnual } from '../tipos'
import { CALENDARIO_2026 } from './2026'
import { CALENDARIO_2027 } from './2027'

export const CALENDARIOS: readonly CalendarioAnual[] = [CALENDARIO_2026, CALENDARIO_2027]
