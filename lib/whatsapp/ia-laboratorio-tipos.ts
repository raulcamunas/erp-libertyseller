import type { CasoVista } from './ia-casos'
import type { ModeloElegible } from '@/lib/ia/precios'
import type { PerfilDeWhatsapp } from './ia-perfil'
import type { BloqueDelEncargo } from './ia-prompt'
import type { ProblemaDeWhatsapp } from './ia-revision'
import type { SituacionDeWhatsapp } from './mensajes'

/**
 * LO QUE VIAJA ENTRE LAS RUTAS DE /api/correo/laboratorio/whatsapp Y LA PANTALLA «CONFIGURACIÓN DE LA IA». Solo tipos: sin código del servidor, para que la pantalla los
 * importe sin arrastrar nada.
 */

export interface VersionDeWhatsappVista {
  id: string
  nombre: string
  notas: string | null
  perfil: PerfilDeWhatsapp
  enProduccion: boolean
  esBase: boolean
  archivada: boolean
  publicadaAt: string | null
  /** Ya ha estado en producción (o es la original): su contenido no se edita, se duplica */
  bloqueada: boolean
  creadaAt: string
  actualizadaAt: string
}

export interface ModeloVista extends ModeloElegible {
  /** Dólares por millón de tokens: entrada, entrada en caché y salida */
  precio: { entrada: number; cache: number | null; salida: number }
}

export interface RespuestaDeVersionesDeWhatsapp {
  ok: boolean
  versiones: VersionDeWhatsappVista[]
  /** La configuración de serie del código: de donde parte una versión nueva y a lo que vuelve «Volver al texto de serie» */
  serie: PerfilDeWhatsapp
  casos: CasoVista[]
  modelos: ModeloVista[]
  /** Si no se ha lanzado la migración, la frase que lo dice: se puede probar, pero no guardar ni publicar */
  faltaMigracion: string | null
}

export interface ResultadoDePrueba {
  /** El id del caso o del lead real */
  id: string
  etiqueta: string
  real: boolean
  situacion: SituacionDeWhatsapp
  /** ¿Hay mensaje? */
  ok: boolean
  mensaje: string | null
  /** En qué se ha apoyado la IA */
  base: string | null
  aviso: string | null
  problemas: ProblemaDeWhatsapp[]
  /** Por qué no hay mensaje, si no lo hay */
  error: string | null
  modelo: string
  /** Milisegundos que ha tardado */
  ms: number
  /** Dólares, con la caché que hubiera / sin nada en caché. null si no se conoce el precio del modelo */
  coste: number | null
  costeMaximo: number | null
  tokens: { entrada: number; salida: number; cache: number } | null
  llamadas: number
  palabras: number
  /** Hasta cuántas palabras se deja pasar con este perfil */
  maxPalabras: number
  /** Lo que recibió la IA además de las instrucciones: los datos del lead, el momento, lo ya escrito… */
  encargo: BloqueDelEncargo[]
}

export interface RespuestaDePrueba {
  ok: boolean
  /** Con qué se ha probado: lo que hay en el editor, una versión guardada o lo que usa el equipo */
  origen: 'borrador' | 'version' | 'produccion'
  /** Las instrucciones que recibió la IA, en bloques con su origen: son las mismas para todos los resultados de esta petición */
  sistema: BloqueDelEncargo[]
  resultados: ResultadoDePrueba[]
  /** Avisos del perfil probado (pedirle a la IA algo que las reglas fijas prohíben, por ejemplo) */
  avisos: string[]
}
