import { instanteDeOpcion, type OpcionDeAviso } from './recordatorios'
import { horaDeMadridEnDias, partesEnMadrid, instanteEnMadrid } from './tiempo'

/**
 * LOS COMANDOS CON «/» DE LA CAJA DE ESCRIBIR — PURO. Se escriben al principio del mensaje y, en vez de enviarse, hacen algo:
 *
 *   /recordar <cuándo> <texto>     te avisa a esa hora («20min», «1h», «3h», «mañana», «lunes», «17:30», «mañana 9:00»)
 *   /estado <texto>                pone tu estado (una hora)
 *   /junta                         abre una junta en este canal
 *   /encuesta                      abre el cuadro de la encuesta
 *   /erp <pregunta>                pregunta a los datos del ERP (solo administradores)
 *   /silenciar                     silencia o activa los avisos de este canal
 */

export type NombreDeComando = 'recordar' | 'estado' | 'junta' | 'encuesta' | 'erp' | 'silenciar'

export interface DefinicionDeComando {
  nombre: NombreDeComando
  uso: string
  descripcion: string
  soloAdmin?: boolean
}

export const COMANDOS: readonly DefinicionDeComando[] = [
  { nombre: 'recordar', uso: '/recordar mañana 9:00 llamar a ShoesF', descripcion: 'Te aviso a esa hora (20min, 1h, 3h, mañana, lunes, 17:30…)' },
  { nombre: 'estado', uso: '/estado En una reunión', descripcion: 'Pone tu estado durante una hora' },
  { nombre: 'junta', uso: '/junta', descripcion: 'Abre una junta de voz y vídeo aquí' },
  { nombre: 'encuesta', uso: '/encuesta', descripcion: 'Crea una encuesta en este canal' },
  { nombre: 'erp', uso: '/erp ¿cuántas citas hay hoy?', descripcion: 'Pregunta a los datos del ERP (solo administradores)', soloAdmin: true },
  { nombre: 'silenciar', uso: '/silenciar', descripcion: 'Silencia o activa los avisos de este canal' },
]

export type Comando = { nombre: NombreDeComando; argumentos: string }

/** ¿El texto empieza por un comando conocido? null si es un mensaje normal (también si es una ruta como «/Users/…» o un comando que no existe) */
export function leerComando(texto: string, esAdmin: boolean): Comando | null {
  const m = /^\/([a-záéíóúñ]+)(?:\s+([\s\S]*))?$/i.exec(texto.trim())
  if (!m) return null
  const nombre = m[1].toLowerCase()
  const def = COMANDOS.find((c) => c.nombre === nombre)
  if (!def || (def.soloAdmin && !esAdmin)) return null
  return { nombre: def.nombre, argumentos: (m[2] ?? '').trim() }
}

/** Los comandos que se ofrecen al escribir «/…» (solo si es lo único que hay escrito) */
export function sugerenciasDeComandos(texto: string, esAdmin: boolean): DefinicionDeComando[] {
  const m = /^\/([a-záéíóúñ]*)$/i.exec(texto)
  if (!m) return []
  const q = m[1].toLowerCase()
  return COMANDOS.filter((c) => (!c.soloAdmin || esAdmin) && c.nombre.startsWith(q))
}

const RAPIDAS: Array<[RegExp, OpcionDeAviso]> = [
  [/^20\s*(?:min|m|minutos)\b/i, '20min'],
  [/^1\s*(?:h|hora)\b/i, '1h'],
  [/^3\s*(?:h|horas)\b/i, '3h'],
]

export type CuandoYTexto = { ok: true; en: number; texto: string } | { ok: false; motivo: string }

/**
 * «mañana 9:00 llamar a ShoesF» → cuándo y qué. Acepta 20min / 1h / 3h, «mañana» (a las 9, o a la hora que se diga), «lunes» (a las 9) y una hora suelta («17:30»: hoy si aún no
 * ha pasado, y si ya pasó, mañana).
 */
export function leerRecordatorio(argumentos: string, ahora: number): CuandoYTexto {
  const a = argumentos.trim()
  if (!a) return { ok: false, motivo: 'Dime cuándo y de qué: /recordar mañana 9:00 llamar a ShoesF' }
  for (const [re, opcion] of RAPIDAS) {
    const m = re.exec(a)
    if (m) return conTexto(instanteDeOpcion(opcion, ahora), a.slice(m[0].length))
  }
  const hora = (t: string) => {
    const h = /^(\d{1,2})[:.h](\d{2})\b/.exec(t) ?? /^(\d{1,2})\s*h\b/.exec(t)
    if (!h) return null
    const hh = Number(h[1])
    const mm = h[2] !== undefined && /^\d{2}$/.test(h[2]) ? Number(h[2]) : 0
    return hh <= 23 && mm <= 59 ? { hh, mm, largo: h[0].length } : null
  }
  const manana = /^ma(?:ñ|n)ana\b/i.exec(a)
  if (manana) {
    const resto = a.slice(manana[0].length).trim()
    const h = hora(resto)
    return h ? conTexto(horaDeMadridEnDias(ahora, 1, h.hh, h.mm), resto.slice(h.largo)) : conTexto(instanteDeOpcion('manana', ahora), resto)
  }
  const lunes = /^(?:el\s+)?lunes\b/i.exec(a)
  if (lunes) return conTexto(instanteDeOpcion('lunes', ahora), a.slice(lunes[0].length))
  const suelta = hora(a)
  if (suelta) {
    const p = partesEnMadrid(ahora)
    const hoy = instanteEnMadrid(p.anio, p.mes, p.dia, suelta.hh, suelta.mm)
    return conTexto(hoy > ahora + 60_000 ? hoy : horaDeMadridEnDias(ahora, 1, suelta.hh, suelta.mm), a.slice(suelta.largo))
  }
  return { ok: false, motivo: 'No he entendido cuándo. Prueba con 20min, 1h, 3h, mañana, lunes o una hora como 17:30.' }
}

function conTexto(en: number, resto: string): CuandoYTexto {
  const texto = resto.trim()
  return texto ? { ok: true, en, texto } : { ok: false, motivo: '¿De qué quieres que te avise? Escríbelo después de la hora.' }
}
