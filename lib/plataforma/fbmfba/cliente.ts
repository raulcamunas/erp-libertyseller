/**
 * LO QUE HABLA LA PANTALLA DE FBM → FBA CON /api/plataforma/fbmfba.
 *
 * Se puede importar desde un componente de cliente: aquí no hay sesión, ni
 * cliente de Supabase, ni service_role. SOLO TIPOS.
 *
 * Los tipos se toman prestados de los módulos de servidor con `import type`, que
 * TypeScript BORRA al compilar: no queda ni un require de datos.ts —que usa
 * service_role— en el paquete del navegador, y a cambio la pantalla no puede
 * desviarse de lo que la ruta devuelve de verdad. El día que alguien le quite un
 * campo a la consulta, esto deja de compilar en vez de pintar `undefined`.
 *
 * Es el mismo montaje que lib/plataforma/buybox/cliente.ts y
 * lib/plataforma/costes/cliente.ts.
 */

import type { AnalisisSku } from './analisis'
import type { ParametrosFiscales, SugerenciaFiscal } from './fiscal'
import type { Comparacion, DesgloseMargen, ResultadoMargen, TarifasEscenario } from './margen'
import type { ResumenA4, UnidadA4 } from './pantalla'
import type {
  CanalA4,
  ConfianzaDims,
  ConfigFbmFba,
  EstadoRotacion,
  ProcedenciaDims,
  Rotacion,
  Salvedad,
  SentidoFoep,
  VeredictoA4,
} from './tipos'

export type {
  AnalisisSku,
  CanalA4,
  Comparacion,
  ConfianzaDims,
  ConfigFbmFba,
  DesgloseMargen,
  EstadoRotacion,
  ParametrosFiscales,
  ProcedenciaDims,
  ResultadoMargen,
  ResumenA4,
  Rotacion,
  Salvedad,
  SentidoFoep,
  SugerenciaFiscal,
  TarifasEscenario,
  UnidadA4,
  VeredictoA4,
}

/** Lo que devuelve GET /api/plataforma/fbmfba */
export interface FbmFbaRespuesta {
  /** Las cuentas y países del cliente. Vacío = todavía no ha autorizado ninguna */
  unidades: UnidadA4[]
  /** La cuenta y el país que se están mirando. null si no hay ninguna */
  unidad: UnidadA4 | null
  filas: AnalisisSku[]
  resumen: ResumenA4 | null
  /** El impuesto que se ha aplicado, y de dónde sale */
  fiscal: ParametrosFiscales | null
  /**
   * Lo que la pantalla PROPONE para un marketplace conocido.
   *
   * No es un valor por defecto y el motor no lo consulta: hace falta que una
   * persona lo guarde para que exista, y entonces la fila tiene fecha y dueño.
   * Esa es toda la diferencia entre un dato y una suposición.
   */
  sugerenciaFiscal: SugerenciaFiscal | null
  config: ConfigFbmFba | null
  /** Lo que nadie ha decidido y hace falta. Se enseña, no se rellena solo */
  faltaPorDecidir: string[]
  moneda: string | null
  /** veredicto -> etiqueta, para que la pantalla no tenga su propia copia */
  etiquetas: Record<VeredictoA4, string>
  canales: Record<CanalA4, string>
  leidoAt: string
}

export interface ConfigA4Respuesta {
  config: ConfigFbmFba
  mensaje?: string
}

export interface FiscalRespuesta {
  fiscal: ParametrosFiscales
  mensaje?: string
}
