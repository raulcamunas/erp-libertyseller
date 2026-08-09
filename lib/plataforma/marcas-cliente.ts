/**
 * LO QUE HABLA LA PESTAÑA DE MARCAS CON /api/plataforma/marcas.
 *
 * Se puede importar desde un componente de cliente: aquí no hay sesión, ni
 * cliente de Supabase, ni service_role. Solo tipos. Es el mismo patrón que
 * lib/plataforma/cliente.ts, y está en un fichero aparte por una razón práctica:
 * cinco pantallas se están escribiendo a la vez y un único fichero de tipos
 * compartido es cinco agentes editando las mismas líneas.
 *
 * Los tipos se toman prestados del módulo de servidor con `import type`, que
 * TypeScript BORRA al compilar: no queda ni un require de marcas.ts —que usa
 * service_role— en el paquete del navegador, y a cambio la pantalla no puede
 * desviarse de lo que la ruta devuelve de verdad. El día que alguien le quite un
 * campo a la consulta, esto deja de compilar en vez de pintar `undefined`.
 */

import type {
  FiltroReferencias,
  MarcaDelCatalogo,
  ReferenciaMarca,
  ResumenMarcas,
  UltimoBarrido,
} from './marcas'

export type {
  FiltroReferencias,
  MarcaDelCatalogo,
  ReferenciaMarca,
  ResumenMarcas,
  UltimoBarrido,
}

/** GET /api/plataforma/marcas?clientId= */
export interface MarcasRespuesta extends ResumenMarcas {
  /**
   * Por qué la lista puede estar vacía. Sin esto la pantalla solo puede decir
   * «no hay marcas», que es indistinguible de una avería.
   */
  barridos: { censo: UltimoBarrido | null; enriquecido: UltimoBarrido | null }
  leidoAt: string
}

/** PATCH /api/plataforma/marcas — guardar la lista entera */
export interface GuardarMarcasRespuesta extends MarcasRespuesta {
  /** Cuántas referencias han cambiado de clasificación al guardar */
  listingsTocados: number
  /** Cuántas marcas han quedado guardadas como propias */
  marcasGuardadas: number
  mensaje: string
}

/** GET /api/plataforma/marcas/referencias */
export interface ReferenciasRespuesta {
  filas: ReferenciaMarca[]
  /** El tope se ha llenado y hay más sin enseñar */
  hayMas: boolean
  limite: number
  leidoAt: string
}

/**
 * PATCH /api/plataforma/marcas/referencias — la excepción de una sola.
 *
 * Vuelve SOLO lo que ha cambiado, no la referencia entera: el SKU y el título ya
 * los tiene la pantalla, y devolverlos vacíos para rellenar un hueco sería
 * inventarse un dato donde no lo hay.
 */
export interface ReferenciaRespuesta {
  id: string
  marca: string | null
  esMarcaPropia: boolean
  origen: 'marca' | 'manual' | null
  mensaje: string
}
