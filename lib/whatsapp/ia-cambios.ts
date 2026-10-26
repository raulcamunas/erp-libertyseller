import { MANDOS, SECCIONES_DE_WHATSAPP, type ModoDeEjemplos, type PerfilDeWhatsapp } from './ia-perfil'
import { ETIQUETA_DE_SITUACION, SITUACIONES_DE_WHATSAPP } from './mensajes'

/**
 * QUÉ SE HA CAMBIADO ENTRE DOS PERFILES, EN FRASES — SE USA EN LA PANTALLA «CONFIGURACIÓN DE LA IA».
 * ====================================================================================================
 * Antes de publicar, quien calibra necesita saber qué ha tocado respecto a lo que usa el equipo ahora: «Cómo les habla: Cercano → De usted», «Cómo persuade: texto cambiado»… Es
 * una lista corta, ordenada como el editor (mandos, momentos, textos, ejemplos, modelo) y sin repetir lo que no cambia. Se comprueba con ia-cambios.prueba.ts.
 */

const MODO: Record<ModoDeEjemplos, string> = { serie: 'los de serie', propios: 'los tuyos', ninguno: 'ninguno' }
const RAZONAMIENTO: Record<string, string> = { none: 'sin razonar', low: 'poco', medium: 'medio', high: 'mucho', xhigh: 'muchísimo' }

const siNo = (v: boolean) => (v ? 'sí' : 'no')
const distinto = (a: string, b: string) => a.trim() !== b.trim()

export function cambiosDelPerfil(nuevo: PerfilDeWhatsapp, antes: PerfilDeWhatsapp): string[] {
  const c: string[] = []

  for (const m of MANDOS) {
    const opciones = m.opciones as ReadonlyArray<{ valor: string; etiqueta: string }>
    const a = antes.ajustes[m.clave]
    const n = nuevo.ajustes[m.clave]
    if (a !== n) c.push(`${m.titulo}: ${opciones.find((o) => o.valor === a)?.etiqueta ?? String(a)} → ${opciones.find((o) => o.valor === n)?.etiqueta ?? String(n)}`)
  }
  if (nuevo.ajustes.variar !== antes.ajustes.variar) c.push(`Variar cómo empieza y cierra cada mensaje: ${siNo(antes.ajustes.variar)} → ${siNo(nuevo.ajustes.variar)}`)

  for (const s of SITUACIONES_DE_WHATSAPP) {
    if (distinto(nuevo.momentos[s], antes.momentos[s])) c.push(`Qué se espera en «${ETIQUETA_DE_SITUACION[s]}»: texto cambiado`)
  }

  for (const s of SECCIONES_DE_WHATSAPP) {
    if (s.clave === 'ejemplos') continue
    const a = antes.secciones[s.clave]
    const n = nuevo.secciones[s.clave]
    if (!distinto(n, a)) continue
    if (s.clave === 'extra') c.push(`${s.titulo}: ${a.trim() === '' ? 'añadidas' : n.trim() === '' ? 'quitadas' : 'cambiadas'}`)
    else c.push(`${s.titulo}: texto cambiado`)
  }

  if (nuevo.ejemplosModo !== antes.ejemplosModo) c.push(`Ejemplos de tono: ${MODO[antes.ejemplosModo]} → ${MODO[nuevo.ejemplosModo]}`)
  // El texto de los ejemplos solo cuenta si se le enseñan a la IA (modo «los tuyos»): si no, cambiarlo no cambia nada
  else if (nuevo.ejemplosModo === 'propios' && distinto(nuevo.secciones.ejemplos, antes.secciones.ejemplos)) c.push('Tus ejemplos de tono: cambiados')

  if (nuevo.modelo !== antes.modelo) c.push(`Modelo: ${antes.modelo ?? 'el de siempre'} → ${nuevo.modelo ?? 'el de siempre'}`)
  if (nuevo.esfuerzo !== antes.esfuerzo) c.push(`Razonamiento: ${antes.esfuerzo ? (RAZONAMIENTO[antes.esfuerzo] ?? antes.esfuerzo) : 'el de siempre'} → ${nuevo.esfuerzo ? (RAZONAMIENTO[nuevo.esfuerzo] ?? nuevo.esfuerzo) : 'el de siempre'}`)

  return c
}
