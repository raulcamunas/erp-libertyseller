import type { DatosDeLead, LlamadaParaIa, NotaParaIa } from '@/lib/correo/ia-contexto'
import type { ClienteDeCorreoIa } from '@/lib/correo/ia-generar'
import { costeDeUso, costeSinCache } from '@/lib/ia/precios'
import { escribirWhatsappConIa, type ResultadoDeWhatsappConIa } from './ia-generar'
import { palabrasDelPerfil, type PerfilDeWhatsapp } from './ia-perfil'
import { construirEncargoDeWhatsapp, contextoParaWhatsapp, enfoqueDelMensaje, whatsappsAnteriores, type EncargoDeWhatsapp } from './ia-prompt'
import { nombreParaElMensaje, situacionDelLead, type SituacionDeWhatsapp } from './mensajes'

/**
 * ESCRIBIR UN WHATSAPP: LA ÚNICA FUNCIÓN QUE LO HACE, TANTO EN PRODUCCIÓN COMO EN LA PRUEBA — SOLO SERVIDOR.
 * ==========================================================================================================
 * Recibe el perfil con el que se escribe y los datos del lead (los que sean: de un lead real, que lee la ruta con la sesión de quien pide, o de un caso de prueba inventado) y
 * hace todo lo demás: el contexto, el momento, el nombre de la empresa, lo ya escrito, la forma al azar, el encargo en bloques, la llamada a la IA y la cuenta de lo que ha costado.
 *
 * Que la ruta de los comerciales y la pantalla de calibrar pasen por AQUÍ es lo que garantiza que lo que se prueba es lo que se usa: no hay dos caminos que puedan separarse.
 * Se comprueba con ia-escribir.prueba.ts.
 */

export interface EntradaDeEscritura {
  perfil: PerfilDeWhatsapp
  lead: DatosDeLead
  notas: readonly NotaParaIa[]
  llamadas: readonly LlamadaParaIa[]
  /** null = la que sale del estado del lead */
  situacion?: SituacionDeWhatsapp | null
  /** El nombre de pila de quien escribe. Vacío si no se sabe */
  miNombre: string | null
  /** Lo que pide el comercial para este mensaje */
  indicaciones: string | null
  /** El mensaje que quiere cambiar */
  anterior: string | null
  ahora?: number
  /** Para repartir la forma al azar. En las pruebas, un valor fijo */
  aleatorio?: () => number
}

export interface SalidaDeEscritura {
  resultado: ResultadoDeWhatsappConIa
  encargo: EncargoDeWhatsapp
  situacion: SituacionDeWhatsapp
  /** Lo que ha tardado todo, en milisegundos */
  ms: number
  /** Dólares, con la caché que hubiera. null si no se conoce el precio del modelo o no se llegó a llamar */
  coste: number | null
  /** Dólares sin nada en caché: el techo (la primera petición tras un rato sin usar la IA) */
  costeMaximo: number | null
  /** Hasta cuántas palabras se deja pasar con este perfil: lo que el navegador debe avisar de «largo» */
  maxPalabras: number
}

export async function escribirMensaje(entrada: EntradaDeEscritura, opciones: { cliente?: ClienteDeCorreoIa; tiempoMaximoMs?: number; entorno?: Record<string, string | undefined> } = {}): Promise<SalidaDeEscritura> {
  const ahora = entrada.ahora ?? Date.now()
  const situacion = entrada.situacion ?? situacionDelLead(String(entrada.lead.status))
  const yaEscritos = whatsappsAnteriores(entrada.notas)
  const encargo = construirEncargoDeWhatsapp({
    contexto: contextoParaWhatsapp({ lead: entrada.lead, notas: entrada.notas, llamadas: entrada.llamadas, ahora }),
    situacion,
    perfil: entrada.perfil,
    miNombre: entrada.miNombre,
    empresa: nombreParaElMensaje(typeof entrada.lead.store_name === 'string' ? entrada.lead.store_name : null, typeof entrada.lead.company === 'string' ? entrada.lead.company : null),
    indicaciones: entrada.indicaciones,
    anterior: entrada.anterior,
    yaEscritos,
    // Sin nada concreto que pedir (y fuera del mensaje de después de hablar), una forma de empezar y de cerrar al azar: así los mensajes del equipo no salen todos con el mismo esqueleto
    enfoque: enfoqueDelMensaje({ situacion, pideAlgo: Boolean(entrada.indicaciones || entrada.anterior), aleatorio: entrada.aleatorio ?? Math.random, variar: entrada.perfil.ajustes.variar }),
  })
  const t0 = Date.now()
  const resultado = await escribirWhatsappConIa({ system: encargo.system, usuario: encargo.usuario }, yaEscritos, { perfil: entrada.perfil, cliente: opciones.cliente, tiempoMaximoMs: opciones.tiempoMaximoMs, entorno: opciones.entorno })
  return {
    resultado,
    encargo,
    situacion,
    ms: Date.now() - t0,
    coste: costeDeUso(resultado.modelo, resultado.tokens),
    costeMaximo: costeSinCache(resultado.modelo, resultado.tokens),
    maxPalabras: palabrasDelPerfil(entrada.perfil).limite,
  }
}
