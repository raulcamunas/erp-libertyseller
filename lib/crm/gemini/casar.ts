/**
 * A QUÉ CLIENTE PERTENECE UNA NOTA DE GEMINI.
 * ============================================
 * Una nota llega con tres pistas, de más a menos fiable. Se prueban por ese orden y se para en la primera que da UN solo cliente:
 *
 *   1. EVENTO   el documento enlaza el evento del calendario (`…/calendar/event?eid=`), y el id de ese evento es exactamente `appointments.google_event_id`. Es la única pista que
 *               no se equivoca: ni con dos reuniones del mismo lead, ni con un nombre mal escrito, ni con otro correo.
 *   2. INVITADO el correo del invitado del documento es el del lead (`lead_email` de la cita o de la ficha). Si ese lead tiene VARIAS fichas (volvió a reservar tras no presentarse),
 *               gana la cita más cercana a cuándo se hizo la reunión.
 *   3. NOMBRE   el nombre que Gemini copia del título («Consultoría Estratégica Amazon · Liberty Seller · LAURA GOMEZ») se parece al del lead Y la cita cae en los dos días de
 *               la reunión. Es la pista más débil (dos personas se pueden llamar igual), así que exige la fecha y, con un solo nombre de pila, no se acepta.
 *
 * Si ninguna pista da un cliente la nota se queda SIN CITA y se asigna a mano en la pantalla (`metodo_cita = 'manual'`): equivocarse de cliente es peor que no casar. Cuando
 * una pista da varios clientes y no hay manera de distinguirlos, no se adivina: se baja a la siguiente pista con SOLO esos candidatos, y si tampoco, queda sin cita.
 *
 * Es puro: recibe la nota y la lista de candidatos y devuelve el veredicto. La carga de candidatos de la base la hace sincronizar.ts.
 */

import type { MetodoDeCita, NotaLeida } from './tipos'
import { nombreDelTitulo } from './correo'

/** Una ficha del CRM como candidata: los datos de contacto buenos son los de la cita si la hay (crmContact), si no los de la ficha */
export interface CandidatoDeCita {
  clientId: string
  appointmentId: string | null
  googleEventId: string | null
  email: string | null
  nombre: string | null
  /** Inicio de la cita (ISO); null en una ficha dada de alta a mano */
  inicio: string | null
}

export type ResultadoDeCasar =
  | { casada: true; clientId: string; appointmentId: string | null; metodo: Exclude<MetodoDeCita, 'manual'> }
  | { casada: false; motivo: 'ninguna' | 'ambigua' }

/** Cuántas horas de margen se dan al casar por el nombre: la nota de una reunión sale ese mismo día, y la cita puede haberse movido unas horas */
export const HORAS_DE_MARGEN_POR_NOMBRE = 48

const PALABRAS_SUELTAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'da', 'do', 'dos', 'van', 'von', 'sl', 'slu', 'sa', 'llc', 'inc', 'ltd'])

/** Las palabras de un nombre, comparables: minúsculas, sin tildes, sin lo que va entre paréntesis («(Socio único)») y sin partículas */
export function palabrasDelNombre(nombre: string | null | undefined): string[] {
  if (!nombre) return []
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length > 1 && !PALABRAS_SUELTAS.has(p))
}

/**
 * ¿Es el mismo nombre? Todas las palabras del más corto están en el más largo, y el más corto tiene al menos dos («Laura Gomez» = «Laura Gómez Pérez», «Mohsen Jalali» =
 * «Jalali Mohsen»). Con una sola palabra solo vale si los dos son EXACTAMENTE esa palabra.
 */
export function mismoNombre(a: string | null | undefined, b: string | null | undefined): 'completo' | 'solo_una_palabra' | null {
  const pa = palabrasDelNombre(a)
  const pb = palabrasDelNombre(b)
  if (pa.length === 0 || pb.length === 0) return null
  const [corto, largo] = pa.length <= pb.length ? [pa, pb] : [pb, pa]
  if (!corto.every((p) => largo.includes(p))) return null
  return corto.length >= 2 ? 'completo' : pa.length === pb.length ? 'solo_una_palabra' : null
}

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/** Horas entre dos instantes; null si falta alguno */
export function horasEntre(a: string | null | undefined, b: string | null | undefined): number | null {
  const x = ms(a)
  const y = ms(b)
  return x === null || y === null ? null : Math.abs(x - y) / 3_600_000
}

/** De varios candidatos, el de la cita más cercana a la reunión. null si no se puede decidir (sin fecha de la reunión o sin fecha de la cita en alguno) o hay empate */
function elMasCercano(candidatos: readonly CandidatoDeCita[], fechaReunion: string | null): CandidatoDeCita | null {
  if (candidatos.length === 1) return candidatos[0]
  const conDistancia = candidatos.map((c) => ({ c, h: horasEntre(c.inicio, fechaReunion) }))
  if (conDistancia.some((x) => x.h === null)) return null
  conDistancia.sort((p, q) => (p.h as number) - (q.h as number))
  // Un empate (dos citas a la misma distancia) no se resuelve a ojo
  if ((conDistancia[0].h as number) === (conDistancia[1].h as number)) return null
  return conDistancia[0].c
}

const aCasada = (c: CandidatoDeCita, metodo: Exclude<MetodoDeCita, 'manual'>): ResultadoDeCasar => ({ casada: true, clientId: c.clientId, appointmentId: c.appointmentId, metodo })

export function casarNota(nota: Pick<NotaLeida, 'googleEventId' | 'invitados' | 'titulo' | 'fechaReunion'>, candidatos: readonly CandidatoDeCita[]): ResultadoDeCasar {
  let pool: readonly CandidatoDeCita[] = candidatos
  let hubo = false

  // 1. EL EVENTO
  if (nota.googleEventId) {
    const porEvento = pool.filter((c) => c.googleEventId !== null && c.googleEventId === nota.googleEventId)
    if (porEvento.length === 1) return aCasada(porEvento[0], 'evento')
    if (porEvento.length > 1) {
      hubo = true
      pool = porEvento
    }
  }

  // 2. EL INVITADO
  const correos = new Set(nota.invitados.map((i) => i.trim().toLowerCase()).filter(Boolean))
  if (correos.size > 0) {
    const porCorreo = pool.filter((c) => c.email !== null && correos.has(c.email.trim().toLowerCase()))
    if (porCorreo.length > 0) {
      const elegido = elMasCercano(porCorreo, nota.fechaReunion)
      if (elegido) return aCasada(elegido, 'invitado')
      hubo = true
      pool = porCorreo
    }
  }

  // 3. EL NOMBRE, con la fecha
  const nombre = nombreDelTitulo(nota.titulo)
  if (nombre && nota.fechaReunion) {
    const porNombre = pool.filter((c) => {
      const parecido = mismoNombre(nombre, c.nombre)
      if (!parecido) return false
      const h = horasEntre(c.inicio, nota.fechaReunion)
      if (h === null || h > HORAS_DE_MARGEN_POR_NOMBRE) return false
      // Una sola palabra en común («Laura»): solo si la cita es del mismo día de la reunión
      return parecido === 'completo' || h <= 12
    })
    if (porNombre.length > 0) {
      const elegido = elMasCercano(porNombre, nota.fechaReunion)
      if (elegido) return aCasada(elegido, 'nombre')
      hubo = true
    }
  }

  return { casada: false, motivo: hubo ? 'ambigua' : 'ninguna' }
}
