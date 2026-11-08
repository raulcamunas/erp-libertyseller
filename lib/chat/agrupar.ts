import type { MensajeChat } from './tipos'

const ZONA = 'Europe/Madrid'

/** El día (AAAA-MM-DD) de una fecha, en hora de España */
export function diaDe(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

/** «Hoy», «Ayer» o «lunes, 3 de noviembre» (con el año si no es este) */
export function etiquetaDeDia(iso: string, ahora: number = Date.now()): string {
  const dia = diaDe(iso)
  if (dia === diaDe(new Date(ahora).toISOString())) return 'Hoy'
  if (dia === diaDe(new Date(ahora - 86_400_000).toISOString())) return 'Ayer'
  const mismoAnio = dia.slice(0, 4) === diaDe(new Date(ahora).toISOString()).slice(0, 4)
  const texto = new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long', ...(mismoAnio ? {} : { year: 'numeric' }) }).format(new Date(iso))
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

export function horaDe(iso: string): string {
  return new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

/** Seguidos de la misma persona en menos de esto se pintan juntos, sin repetir su nombre */
export const MINUTOS_DE_RACHA = 5

export type FilaDeMensajes =
  | { tipo: 'dia'; clave: string; etiqueta: string }
  | { tipo: 'nuevos'; clave: string }
  | { tipo: 'mensaje'; clave: string; mensaje: MensajeChat; continuacion: boolean }

/**
 * Los mensajes de un canal (los de arriba, no las respuestas de los hilos) como filas para pintar: con el separador de cada día, la marca «Nuevos» antes del primero que no he
 * leído y la indicación de cuáles continúan la racha del anterior.
 */
export function filasDeMensajes(mensajes: readonly MensajeChat[], opciones: { yo: string; ultimoLeidoEn: string | null; ahora?: number }): FilaDeMensajes[] {
  const { yo, ultimoLeidoEn, ahora } = opciones
  const filas: FilaDeMensajes[] = []
  let diaPrevio = ''
  let previo: MensajeChat | null = null
  let marcado = false
  for (const m of mensajes) {
    if (m.hilo_de !== null) continue
    const dia = diaDe(m.creado_en)
    if (dia !== diaPrevio) {
      filas.push({ tipo: 'dia', clave: `d-${dia}`, etiqueta: etiquetaDeDia(m.creado_en, ahora) })
      diaPrevio = dia
      previo = null
    }
    if (!marcado && ultimoLeidoEn && m.autor_id !== yo && m.borrado_en === null && Date.parse(m.creado_en) > Date.parse(ultimoLeidoEn)) {
      filas.push({ tipo: 'nuevos', clave: 'nuevos' })
      marcado = true
      previo = null
    }
    const continuacion = Boolean(previo && previo.autor_id === m.autor_id && previo.autor_id !== null && previo.borrado_en === null && m.borrado_en === null && Date.parse(m.creado_en) - Date.parse(previo.creado_en) < MINUTOS_DE_RACHA * 60_000)
    filas.push({ tipo: 'mensaje', clave: `m-${m.id}`, mensaje: m, continuacion })
    previo = m
  }
  return filas
}

/** Mete un mensaje nuevo en una lista ya ordenada por id sin repetirlo (puede llegar por el directo y por la respuesta de quien lo envió) */
export function conMensaje(lista: readonly MensajeChat[], nuevo: MensajeChat): MensajeChat[] {
  const i = lista.findIndex((m) => m.id === nuevo.id)
  if (i >= 0) {
    const copia = [...lista]
    copia[i] = { ...copia[i], ...nuevo }
    return copia
  }
  const salida = [...lista, nuevo]
  salida.sort((a, b) => a.id - b.id)
  return salida
}
