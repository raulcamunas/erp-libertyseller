/**
 * LO QUE HABLA LA PANTALLA DE BUY BOX CON /api/plataforma/buybox.
 *
 * Se puede importar desde un componente de cliente: aquí no hay sesión, ni
 * cliente de Supabase, ni service_role. Solo tipos.
 *
 * Los tipos se toman prestados del módulo de servidor con `import type`, que
 * TypeScript BORRA al compilar: no queda ni un require de pantalla.ts —que usa
 * service_role— en el paquete del navegador, y a cambio la pantalla no puede
 * desviarse de lo que la ruta devuelve de verdad. El día que alguien le quite un
 * campo a la consulta, esto deja de compilar en vez de pintar `undefined`.
 *
 * Es el mismo montaje que lib/plataforma/cliente.ts para A1.
 */

import type { ConfigBuyBox } from './datos'
import type {
  CompetidorHistorico,
  ConfigPantalla,
  DecisionPendiente,
  FilaBuyBox,
  HistoricoSku,
  PuntoSerie,
  ResumenBuyBox,
} from './pantalla'
import type { Veredicto } from './tipos'

export type {
  CompetidorHistorico,
  ConfigBuyBox,
  ConfigPantalla,
  DecisionPendiente,
  FilaBuyBox,
  HistoricoSku,
  PuntoSerie,
  ResumenBuyBox,
}

export interface BuyBoxRespuesta {
  resumen: ResumenBuyBox[]
  filas: FilaBuyBox[]
  total: number
  desde: number
  limite: number
  config: ConfigPantalla
  /** Los veredictos por los que se puede filtrar, con su etiqueta */
  etiquetas: Record<Veredicto, string>
  leidoAt: string
}

export interface HistoricoRespuesta {
  historico: HistoricoSku
  competidores: CompetidorHistorico[]
  dias: number
  leidoAt: string
}

export interface ConfigRespuesta {
  config: ConfigPantalla
  mensaje?: string
}

export interface ColaRespuesta {
  encolados: number
  mensaje: string
}
