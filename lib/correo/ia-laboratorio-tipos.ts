import type { SeccionesDeInstrucciones } from './ia-prompt'
import type { ResumenDeGrupo, Veredicto } from './ia-resultados'

/**
 * LO QUE VIAJA ENTRE LAS RUTAS DE /api/correo/laboratorio Y LA PANTALLA «CONFIGURACIÓN DE CORREOS». Solo tipos: sin código del servidor, para que
 * la pantalla los importe sin arrastrar nada.
 */

export interface VersionVista {
  id: string
  nombre: string
  notas: string | null
  secciones: SeccionesDeInstrucciones
  ejemplosIds: string[]
  usarGanadores: boolean
  modelo: string | null
  peso: number
  activa: boolean
  esBase: boolean
  archivada: boolean
  creadaAt: string
  actualizadaAt: string
  /** Borradores que ha escrito y borradores que se llegaron a enviar */
  generados: number
  enviados: number
  /** Ya ha escrito algún borrador (o es la original): su contenido no se edita, se duplica */
  usada: boolean
  /** Cuántos de cada 100 correos usan esta versión ahora mismo (0 si no está en marcha) */
  porcentaje: number
}

export interface EjemploVista {
  id: string
  titulo: string
  asunto: string
  texto: string
  tipo: 'entrar' | 'optimizar' | 'ambos'
  nota: string | null
  activo: boolean
  creadoAt: string
  actualizadoAt: string
  /** Lo lee una versión que ya ha escrito borradores: no se cambia ni se borra */
  bloqueado: boolean
}

export interface RespuestaDeVersiones {
  ok: boolean
  versiones: VersionVista[]
  ejemplos: EjemploVista[]
}

export interface CorreoConRespuesta {
  asunto: string
  texto: string
  cambios: number | null
  enviadoAt: string
}

export interface ResultadosDeVersion {
  /** null = borradores de antes de las versiones */
  id: string | null
  nombre: string
  esBase: boolean
  enMarcha: boolean
  resumen: ResumenDeGrupo
  conRespuesta: CorreoConRespuesta[]
}

export interface ResultadosDeLaConfiguracion {
  dias: number
  desde: string
  versiones: ResultadosDeVersion[]
  /** Los correos fríos enviados sin IA en la misma ventana. null si no se han podido contar */
  aMano: ResumenDeGrupo | null
  veredicto: Veredicto
}

export interface RespuestaDeResultados extends ResultadosDeLaConfiguracion {
  ok: boolean
}

export interface CorreoQueFunciona {
  id: string
  asunto: string
  texto: string
  tipo: 'entrar' | 'optimizar'
  respondioEn: string
}

export interface RespuestaDePrueba {
  ok: boolean
  asunto: string
  texto: string
  angulo: string
  modelo: string
  ejemplos: number
  /** Dólares, aproximado. null si no se conoce el precio del modelo */
  coste: number | null
  avisos: string[]
}
