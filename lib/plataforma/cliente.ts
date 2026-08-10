/**
 * LO QUE HABLA LA PANTALLA DE LA PLATAFORMA CON /api/plataforma.
 *
 * Se puede importar desde un componente de cliente: aquí no hay sesión, ni
 * cliente de Supabase, ni service_role. Solo tipos. Es el gemelo de navegador de
 * lib/plataforma/pantallas.ts, igual que lib/amazon/client.ts lo es de
 * lib/amazon/data.ts.
 *
 * Los tipos se toman prestados del módulo de servidor con `import type`, que
 * TypeScript BORRA al compilar: no queda ni un require de pantallas.ts —que usa
 * service_role— en el paquete del navegador, y a cambio la pantalla no puede
 * desviarse de lo que la ruta devuelve de verdad. El día que alguien le quite un
 * campo a la consulta, esto deja de compilar en vez de pintar `undefined`.
 *
 * POR QUÉ TODO VA POR RUTA DE API Y NO CONTRA SUPABASE: porque desde el
 * navegador NO SE PUEDE. La migración 118 le retira a `authenticated` cualquier
 * permiso sobre amazon_connections, y la 125 le retira el EXECUTE de las tres
 * funciones de cobertura. Todo lo que toque esto pasa por el servidor o no pasa.
 */

import type { ConexionPlataforma } from './datos'
import type {
  ClienteConIngesta,
  CoberturaUnidad,
  FichaSku,
  FilaCatalogo,
  FiltroSeguimiento,
  UltimoRefresco,
} from './pantallas'
import type {
  AmazonEvento,
  AmazonJob,
  AmazonJobEstado,
  AmazonJobTipo,
  EventoSeveridad,
  ReglaActivos,
  SnapshotBsr,
  SnapshotInventario,
} from './tipos'

export type {
  ClienteConIngesta,
  CoberturaUnidad,
  ConexionPlataforma,
  FichaSku,
  FilaCatalogo,
  FiltroSeguimiento,
  UltimoRefresco,
}

export interface ClientesRespuesta {
  clientes: ClienteConIngesta[]
  leidoAt: string
}

export interface IngestaRespuesta {
  /**
   * El ciclo de catalogo por conexion, y el ultimo FOEP por cuenta y pais.
   *
   * Ninguno de los dos sale de amazon_jobs —el primero lo mueve el cron y deja
   * su marca en la conexion, el segundo es una FASE dentro de «Precios y Buy
   * Box»— y aun asi tienen que salir en la rejilla de «Al dia»: si no, arriba se
   * dice cada cuanto se piden y abajo no hay forma de comprobar si se piden.
   */
  catalogo?: Array<{
    connectionId: string
    nombre: string
    ultimo: string | null
    items: number | null
  }>
  /** «connectionId|marketplaceId» -> fecha del ultimo FOEP */
  foep?: Record<string, string>

  refrescos: UltimoRefresco[]
  jobs: AmazonJob[]
  eventos: AmazonEvento[]
  /** Los tipos que el motor sabe ejecutar HOY. Los demás están declarados pero
      se quedarían en la cola dando error, así que no se ofrecen */
  tiposEjecutables: AmazonJobTipo[]
  etiquetas: {
    tipos: Record<AmazonJobTipo, string>
    estados: Record<AmazonJobEstado, string>
    severidades: Record<EventoSeveridad, string>
  }
  leidoAt: string
}

export interface CoberturaRespuesta {
  cobertura: CoberturaUnidad[]
  ventanas: { bsrDias: number; inventarioDias: number }
  leidoAt: string
}

export interface CatalogoRespuesta {
  filas: FilaCatalogo[]
  total: number
  desde: number
  limite: number
  filtro: FiltroSeguimiento
  leidoAt: string
}

export interface MarcarRespuesta {
  cambiados: number
  mensaje: string
}

export interface ReglaRespuesta {
  regla: ReglaActivos | null
  /** El criterio contado en una frase. Nueve interruptores no se leen de un
      vistazo y esta pantalla decide de qué SKU nos ocupamos cada noche */
  descripcion: string
  deFabrica: Record<string, unknown>
  leidoAt?: string
  mensaje?: string
}

export interface SkuRespuesta extends FichaSku {
  eventos: AmazonEvento[]
  leidoAt: string
}

export interface JobRespuesta {
  job: AmazonJob | null
  yaExistia?: boolean
  inmediato?: boolean
  mensaje?: string
}

export interface PlanRespuesta {
  creados: number
  yaVivos: number
  clientes: number
  mensaje: string
  entradas: Array<{
    tipo: AmazonJobTipo
    cliente: string
    connectionId: string | null
    marketplaceId: string | null
    creado: boolean
    motivo: string
  }>
}

export type { AmazonEvento, AmazonJob, AmazonJobTipo, ReglaActivos, SnapshotBsr, SnapshotInventario }
