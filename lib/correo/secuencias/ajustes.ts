import { esDia } from './fechas'
import type { AjustesDelMotor, TramoDeRampa } from './reglas'
import type { CambiosDeBuzonDelMotor } from './almacen'

/**
 * VALIDAR LOS CAMBIOS DE AJUSTES QUE LLEGAN DE LA PANTALLA — PURO. Se comprueba con ajustes.prueba.ts.
 * ====================================================================================================
 * Los ajustes deciden cuántos correos salen y a qué horas, y alguno enciende el envío REAL. Lo que llega del navegador no se da por bueno: cada
 * campo se comprueba (tipo, entero, rango) y se traduce a la columna de la base. Un valor fuera de rango es un error con una frase que se entiende,
 * nunca se «corrige» en silencio.
 *
 * Pasar de «ensayo» a «envío real» con el motor encendido necesita una confirmación EXPLÍCITA (`confirmarEnvioReal`): la pantalla la pide con un aviso, y
 * aquí se exige otra vez, para que un clic suelto o una petición a medias no manden correos a clientes.
 */

export interface ResultadoDeValidacion<T> {
  ok: true
  cambios: T
  /** Cosas que no impiden guardar pero que conviene saber */
  avisos: string[]
}
export type Rechazo = { ok: false; error: string }

const esObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

function entero(valor: unknown, nombre: string, minimo: number, maximo: number): number | Rechazo {
  if (typeof valor !== 'number' || !Number.isInteger(valor)) return { ok: false, error: `«${nombre}» tiene que ser un número entero.` }
  if (valor < minimo || valor > maximo) return { ok: false, error: `«${nombre}» tiene que estar entre ${minimo} y ${maximo}.` }
  return valor
}
const fallo = (v: unknown): v is Rechazo => typeof v === 'object' && v !== null && 'ok' in v

export interface CambiosDeAjustes {
  /** Las columnas de correo_secuencia_ajustes que cambian */
  columnas: Record<string, unknown>
  /** Cómo quedan los ajustes después de aplicar los cambios */
  resultado: AjustesDelMotor
}

export function validarAjustes(entrada: unknown, actuales: AjustesDelMotor): ResultadoDeValidacion<CambiosDeAjustes> | Rechazo {
  if (!esObjeto(entrada)) return { ok: false, error: 'No se ha entendido lo que se ha mandado.' }
  const columnas: Record<string, unknown> = {}
  const resultado: AjustesDelMotor = { ...actuales, rampa: actuales.rampa.map((t) => ({ ...t })), festivos: [...actuales.festivos] }
  const avisos: string[] = []

  for (const [clave, columna] of [
    ['activa', 'activa'],
    ['modoEnsayo', 'modo_ensayo'],
    ['respuestasIa', 'respuestas_ia'],
    ['respuestasCerrarNo', 'respuestas_cerrar_no'],
    ['respuestasRellamada', 'respuestas_rellamada'],
  ] as const) {
    if (entrada[clave] === undefined) continue
    if (typeof entrada[clave] !== 'boolean') return { ok: false, error: `«${clave}» tiene que ser verdadero o falso.` }
    // Sin la migración 246 la base no tiene estas columnas: se dice claro en vez de fallar al guardar
    if (clave.startsWith('respuestas') && !actuales.respuestasDisponible) return { ok: false, error: 'Falta lanzar la migración 246_correo_respuestas_ia.sql en el editor SQL de Supabase para poder cambiar esto.' }
    columnas[columna] = entrada[clave]
    resultado[clave] = entrada[clave] as boolean
  }

  const numeros: Array<[keyof AjustesDelMotor, string, string, number, number]> = [
    ['ventanaDesdeMin', 'ventana_desde_min', 'La hora de apertura', 0, 1439],
    ['ventanaHastaMin', 'ventana_hasta_min', 'La hora de cierre', 1, 1440],
    ['huecoGlobalS', 'hueco_global_s', 'El hueco entre dos envíos cualesquiera', 5, 3600],
    ['huecoBuzonS', 'hueco_buzon_s', 'El hueco entre dos envíos del mismo buzón', 10, 7200],
    ['pesoMananaPct', 'peso_manana_pct', 'El porcentaje de la mañana', 0, 100],
    ['topeHora', 'tope_hora', 'El tope por hora', 1, 500],
    ['diasHastaNoInteresa', 'dias_hasta_no_interesa', 'Los días hasta pasar a «No interesa»', 1, 60],
    ['frenoRebotesPct', 'freno_rebotes_pct', 'El porcentaje de rebotes del freno', 1, 100],
    ['frenoMinimoEnvios', 'freno_minimo_envios', 'El mínimo de envíos del freno', 5, 1000],
  ]
  for (const [clave, columna, nombre, minimo, maximo] of numeros) {
    if (entrada[clave] === undefined) continue
    const n = entero(entrada[clave], nombre, minimo, maximo)
    if (fallo(n)) return n
    columnas[columna] = n
    ;(resultado[clave] as number) = n
  }
  if (resultado.ventanaHastaMin <= resultado.ventanaDesdeMin) return { ok: false, error: 'La hora de cierre tiene que ser posterior a la de apertura.' }
  if (resultado.huecoBuzonS < resultado.huecoGlobalS) avisos.push('El hueco entre envíos del mismo buzón es menor que el de todo el sistema: el segundo no tiene efecto.')
  if (resultado.ventanaDesdeMin < 480 || resultado.ventanaHastaMin > 1200) avisos.push('El horario de envío se sale de lo habitual en una empresa (de 8:00 a 20:00): los correos fuera de horario laboral rinden peor.')

  if (entrada.rampa !== undefined) {
    if (!Array.isArray(entrada.rampa) || entrada.rampa.length < 1 || entrada.rampa.length > 12) return { ok: false, error: 'La rampa tiene que tener entre 1 y 12 tramos.' }
    const tramos: TramoDeRampa[] = []
    let anterior = 0
    for (const t of entrada.rampa) {
      if (!esObjeto(t)) return { ok: false, error: 'Un tramo de la rampa no se entiende.' }
      const desde = entero(t.desde, 'El día en que empieza un tramo', 1, 3650)
      if (fallo(desde)) return desde
      const tope = entero(t.tope, 'El tope diario de un tramo', 1, 1000)
      if (fallo(tope)) return tope
      if (desde <= anterior) return { ok: false, error: 'Los tramos de la rampa tienen que ir de menor a mayor día, sin repetir ninguno.' }
      anterior = desde
      tramos.push({ desde, tope })
    }
    if (tramos[0].desde !== 1) return { ok: false, error: 'El primer tramo de la rampa tiene que empezar el día 1.' }
    columnas.rampa = tramos
    resultado.rampa = tramos
    if (tramos.some((t) => t.tope > 300)) avisos.push('Hay un tope diario por encima de 300 correos por buzón: los proveedores de correo (Hostinger) tienen sus propios límites y el riesgo de caer en spam crece rápido.')
  }

  if (entrada.festivos !== undefined) {
    if (!Array.isArray(entrada.festivos) || entrada.festivos.length > 150) return { ok: false, error: 'La lista de festivos no se entiende (máximo 150 días).' }
    if (!entrada.festivos.every(esDia)) return { ok: false, error: 'Todos los festivos tienen que ser fechas válidas (AAAA-MM-DD).' }
    const lista = [...new Set(entrada.festivos as string[])].sort()
    columnas.festivos = lista
    resultado.festivos = lista
  }

  // Pasar a envío real con el motor encendido: solo con confirmación explícita
  const enviaDeVerdad = resultado.activa && !resultado.modoEnsayo
  const antesEnviabaDeVerdad = actuales.activa && !actuales.modoEnsayo
  if (enviaDeVerdad && !antesEnviabaDeVerdad && entrada.confirmarEnvioReal !== true) {
    return { ok: false, error: 'Pasar a envío real manda correos de verdad a clientes: hay que confirmarlo expresamente.' }
  }
  if (enviaDeVerdad && !antesEnviabaDeVerdad) avisos.push('El envío real está encendido: desde ahora los seguimientos salen a su hora.')

  if (Object.keys(columnas).length === 0) return { ok: false, error: 'No hay ningún cambio que guardar.' }
  return { ok: true, cambios: { columnas, resultado }, avisos }
}

export function validarAjustesDeBuzon(entrada: unknown): ResultadoDeValidacion<CambiosDeBuzonDelMotor & { quitarPausa?: boolean; pausarHastaMañana?: boolean }> | Rechazo {
  if (!esObjeto(entrada)) return { ok: false, error: 'No se ha entendido lo que se ha mandado.' }
  const cambios: CambiosDeBuzonDelMotor & { quitarPausa?: boolean; pausarHastaMañana?: boolean } = {}
  if (entrada.participa !== undefined) {
    if (typeof entrada.participa !== 'boolean') return { ok: false, error: '«participa» tiene que ser verdadero o falso.' }
    cambios.participa = entrada.participa
  }
  if (entrada.topeDiario !== undefined) {
    if (entrada.topeDiario === null) cambios.topeDiario = null
    else {
      const n = entero(entrada.topeDiario, 'El tope diario del buzón', 1, 1000)
      if (fallo(n)) return n
      cambios.topeDiario = n
    }
  }
  for (const [clave, nombre, min, max] of [['llamadasDesdeMin', 'La hora en que empieza a llamar', 0, 1439], ['llamadasHastaMin', 'La hora en que acaba de llamar', 1, 1440]] as const) {
    if (entrada[clave] === undefined) continue
    const n = entero(entrada[clave], nombre, min, max)
    if (fallo(n)) return n
    cambios[clave] = n
  }
  if (cambios.llamadasDesdeMin !== undefined && cambios.llamadasHastaMin !== undefined && cambios.llamadasHastaMin <= cambios.llamadasDesdeMin) return { ok: false, error: 'La hora en que acaba de llamar tiene que ser posterior a la de inicio.' }
  if (entrada.quitarPausa === true) cambios.quitarPausa = true
  if (entrada.pausarHastaMañana === true) cambios.pausarHastaMañana = true
  if (cambios.quitarPausa && cambios.pausarHastaMañana) return { ok: false, error: 'No se puede quitar la pausa y ponerla a la vez.' }
  if (Object.keys(cambios).length === 0) return { ok: false, error: 'No hay ningún cambio que guardar.' }
  return { ok: true, cambios, avisos: [] }
}
