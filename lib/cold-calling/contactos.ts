import { claveDeTelefono, clavesDeTelefonos, quitarCeroDecimal, trocearTelefonos } from '@/lib/rendimiento/telefonos'

/**
 * LOS TELÉFONOS Y LOS CORREOS DE UN LEAD, Y CÓMO AÑADIR UNO NUEVO.
 * PURO. Se prueba en contactos.prueba.ts.
 *
 * Un lead guarda su contacto en cuatro campos de texto, porque llegó de un Excel:
 *
 *   · `phone`           el teléfono (a veces varios en el mismo campo)
 *   · `telefonos_extra` otros teléfonos, separados por «; »
 *   · `email`           el correo (a veces varios)
 *   · `emails_extra`    otros correos, separados por «; »
 *
 * Añadir un contacto desde la ficha NO reescribe lo que ya hay: si el campo principal está vacío, el nuevo pasa a ser el
 * principal; si no, se añade al final del campo extra. Un teléfono que ya está (aunque esté escrito de otra forma:
 * «+34 600 11 22 33» y «600112233» son el mismo) o un correo que ya está no se vuelve a añadir.
 */

export interface ContactosDeLead {
  phone: string | null
  email: string | null
  telefonos_extra: string | null
  emails_extra: string | null
}

/** Lo que se guarda: solo los campos que cambian */
export type CamposDeContacto = Partial<Pick<ContactosDeLead, 'phone' | 'telefonos_extra' | 'email' | 'emails_extra'>>

export type ResultadoDeAnadir =
  | { ok: true; campos: CamposDeContacto; valor: string }
  | { ok: false; motivo: 'invalido' | 'repetido' }

const CORREO = /^[^\s@,;/]+@[^\s@,;/]+\.[^\s@,;/]{2,}$/
const SEPARADOR_DE_CORREOS = /[\s/,;]+/

/** Todos los teléfonos del lead, tal como se escribieron y sin repetidos (los de `phone` primero, luego los extra) */
export function telefonosDelLead(lead: Pick<ContactosDeLead, 'phone' | 'telefonos_extra'>): string[] {
  const vistos = new Set<string>()
  const salida: string[] = []
  for (const t of [...trocearTelefonos(lead.phone), ...trocearTelefonos(lead.telefonos_extra)]) {
    // Los que no dan clave (algo que no es un teléfono) se enseñan igual, una sola vez
    const clave = claveDeTelefono(t) ?? `texto:${t}`
    if (vistos.has(clave)) continue
    vistos.add(clave)
    salida.push(t)
  }
  return salida
}

/** Todos los correos del lead, sin repetidos (los de `email` primero, luego los extra) */
export function emailsDelLead(lead: Pick<ContactosDeLead, 'email' | 'emails_extra'>): string[] {
  const vistos = new Set<string>()
  const salida: string[] = []
  for (const campo of [lead.email, lead.emails_extra]) {
    for (const e of (campo ?? '').split(SEPARADOR_DE_CORREOS)) {
      if (!e.includes('@')) continue
      const clave = e.toLowerCase()
      if (vistos.has(clave)) continue
      vistos.add(clave)
      salida.push(e)
    }
  }
  return salida
}

/**
 * El teléfono como se guarda: en formato internacional, para que se pueda pegar tal cual en WhatsApp o en Rinkel.
 *   600 11 22 33  ->  +34600112233        (nueve cifras españolas)
 *   0034 600112233 -> +34600112233
 *   +44 20 7946 0958 -> +442079460958     (con prefijo, se respeta)
 * Lo que no se reconoce como un teléfono (letras, muy corto, un número de otro país sin prefijo) devuelve null: no se adivina.
 */
export function normalizarTelefono(crudo: unknown): string | null {
  if (typeof crudo !== 'string') return null
  const texto = quitarCeroDecimal(crudo.trim())
  if (texto === '' || /[a-z]/i.test(texto)) return null
  const cifras = texto.replace(/\D/g, '')
  if (texto.startsWith('+')) return cifras.length >= 8 && cifras.length <= 15 ? `+${cifras}` : null
  if (/^00(?!0)/.test(texto)) {
    const sinDoblecero = cifras.slice(2)
    return sinDoblecero.length >= 8 && sinDoblecero.length <= 15 ? `+${sinDoblecero}` : null
  }
  if (/^[6-9]\d{8}$/.test(cifras)) return `+34${cifras}`
  if (/^34[6-9]\d{8}$/.test(cifras)) return `+${cifras}`
  return null
}

/** El correo como se guarda (sin «mailto:», en minúsculas), o null si no lo parece */
export function normalizarEmail(crudo: unknown): string | null {
  if (typeof crudo !== 'string') return null
  const correo = crudo.trim().replace(/^mailto:/i, '').toLowerCase()
  return CORREO.test(correo) ? correo : null
}

/** Qué campos cambiar para añadir un teléfono a un lead, o por qué no se puede */
export function anadirTelefono(lead: Pick<ContactosDeLead, 'phone' | 'telefonos_extra'>, crudo: unknown): ResultadoDeAnadir {
  const nuevo = normalizarTelefono(crudo)
  if (!nuevo) return { ok: false, motivo: 'invalido' }
  const clave = claveDeTelefono(nuevo)
  const yaEstan = new Set([...clavesDeTelefonos(lead.phone), ...clavesDeTelefonos(lead.telefonos_extra)])
  if (clave && yaEstan.has(clave)) return { ok: false, motivo: 'repetido' }
  if (!(lead.phone ?? '').trim()) return { ok: true, campos: { phone: nuevo }, valor: nuevo }
  const extra = [(lead.telefonos_extra ?? '').trim(), nuevo].filter(Boolean).join('; ')
  return { ok: true, campos: { telefonos_extra: extra }, valor: nuevo }
}

/** Qué campos cambiar para añadir un correo a un lead, o por qué no se puede */
export function anadirEmail(lead: Pick<ContactosDeLead, 'email' | 'emails_extra'>, crudo: unknown): ResultadoDeAnadir {
  const nuevo = normalizarEmail(crudo)
  if (!nuevo) return { ok: false, motivo: 'invalido' }
  if (emailsDelLead(lead).some((e) => e.toLowerCase() === nuevo)) return { ok: false, motivo: 'repetido' }
  if (!(lead.email ?? '').trim()) return { ok: true, campos: { email: nuevo }, valor: nuevo }
  const extra = [(lead.emails_extra ?? '').trim(), nuevo].filter(Boolean).join('; ')
  return { ok: true, campos: { emails_extra: extra }, valor: nuevo }
}
