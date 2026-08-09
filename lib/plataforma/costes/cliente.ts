/**
 * LO QUE HABLA LA PANTALLA DE COSTES CON /api/plataforma/costes.
 *
 * Se puede importar desde un componente de cliente: aquí no hay sesión, ni
 * cliente de Supabase, ni service_role. SOLO TIPOS. Es el gemelo de navegador de
 * pantalla.ts y datos.ts, igual que lib/plataforma/cliente.ts lo es de
 * pantallas.ts.
 *
 * Los tipos se toman prestados de los módulos de servidor con `import type`, que
 * TypeScript BORRA al compilar: no queda ni un require de datos.ts —que usa
 * service_role— en el paquete del navegador, y a cambio la pantalla no puede
 * desviarse de lo que la ruta devuelve de verdad. El día que alguien le quite un
 * campo a una consulta, esto deja de compilar en vez de pintar `undefined`.
 */

import type { EstadoCoste, ResumenCobertura } from './completitud'
import type { StockClienteBreve } from './datos'
import type { InformeImportacion } from './importar'
import type { FichaCoste, FilaCoste, FiltroEstado, VistaCobertura, VistaCostes } from './pantalla'
import type {
  AuditoriaCoste,
  CosteA5,
  ImportacionCostes,
  ModoImportacion,
  PerfilCostes,
  PoliticaCostes,
} from './tipos'

export type {
  AuditoriaCoste,
  CosteA5,
  EstadoCoste,
  FichaCoste,
  FilaCoste,
  FiltroEstado,
  ImportacionCostes,
  InformeImportacion,
  ModoImportacion,
  PerfilCostes,
  PoliticaCostes,
  ResumenCobertura,
  StockClienteBreve,
  VistaCobertura,
  VistaCostes,
}

/** La tabla de costes ya paginada, tal y como la devuelve GET /api/plataforma/costes */
export interface CostesRespuesta extends VistaCostes {
  leidoAt: string
}

export interface CoberturaRespuesta extends VistaCobertura {
  leidoAt: string
}

export interface PerfilesRespuesta {
  perfiles: PerfilCostes[]
  politica: PoliticaCostes
  importaciones: ImportacionCostes[]
  /** Los clientes de la sincronización de stock, para elegir de cuál se toma el
      mapeo referencia -> SKU */
  stockClientes: StockClienteBreve[]
}

export interface FichaRespuesta {
  ficha: FichaCoste
}

export interface ImportacionRespuesta {
  informe: InformeImportacion
}

export interface GuardarCosteRespuesta {
  cambiado: boolean
  alta?: boolean
  correccion?: boolean
  cambios?: string[]
  mensaje?: string
}
