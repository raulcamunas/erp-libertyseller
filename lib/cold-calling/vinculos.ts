import { claveDeTelefono, clavesDeTelefonos } from '@/lib/rendimiento/telefonos'

/**
 * CASAR CADA LLAMADA DE RINKEL CON SU LEAD DE COLD CALLING.
 * ==========================================================
 * PURO. Se comprueba con vinculos.prueba.ts. No toca la base ni la red: recibe leads y llamadas y devuelve qué
 * llamada va con qué lead y cómo está de sano el casamiento. Lo usan el servidor (vinculos-servidor.ts) al importar,
 * al repasar y al diagnosticar.
 *
 *
 * ============ LA REGLA ============
 *
 * Una llamada se enlaza con un lead cuando el número del otro lado (Rinkel lo da en E.164: «+34910210465») y alguno de
 * los teléfonos del lead (`phone` y `telefonos_extra`, escritos como los tecleó una persona: «+34 910 21 04 65»,
 * «910.21.04.65», «910210465 / 600112233»…) dan la MISMA CLAVE (ver lib/rendimiento/telefonos.ts: nueve cifras sin
 * prefijo para España, prefijo entero para el resto).
 *
 *   · SOLO LEADS DEL COMERCIAL QUE LLAMÓ. La llamada de una persona se casa con los leads asignados a ella; el nombre
 *     de una tienda de la cartera de otro no hace falta para saber a quién se llamó.
 *   · SI VARIOS LEADS DE LA MISMA PERSONA COMPARTEN EL TELÉFONO (la misma empresa en dos listas, una centralita común) la
 *     llamada se lleva UNO, el mismo siempre: el que sigue abierto y se tocó más recientemente (elegirLead).
 *   · UN NÚMERO OCULTO NO SE CASA CON NADIE.
 *
 * Y lo importante, que no se ve en el código: un lead cuyo teléfono no da ninguna clave no recibe NUNCA una llamada, y no
 * da ningún error. Por eso existe diagnosticar(): para enseñar cuántos leads hay así y con qué teléfono.
 */

export interface LeadParaVincular {
  id: string
  assigned_to: string | null
  phone: string | null
  telefonos_extra: string | null
  /** Para elegir entre varios con el mismo teléfono. Pueden faltar */
  status?: string | null
  last_contacted_at?: string | null
  /** Solo para enseñar ejemplos en el diagnóstico */
  store_name?: string | null
}

export interface LlamadaParaVincular {
  id: string
  user_id: string
  fecha: string
  direccion: string
  numero: string | null
  lead_id: string | null
}

export type IndiceDeTelefonos = Map<string, LeadParaVincular[]>

/** Todas las claves de teléfono de un lead: el principal y los extra, sin repetidos */
export function clavesDelLead(lead: Pick<LeadParaVincular, 'phone' | 'telefonos_extra'>): string[] {
  const claves = clavesDeTelefonos(lead.phone)
  for (const c of clavesDeTelefonos(lead.telefonos_extra)) if (!claves.includes(c)) claves.push(c)
  return claves
}

/** clave de teléfono -> los leads que la tienen (de todos los comerciales: el filtro por persona se hace al casar) */
export function indiceDeTelefonos(leads: readonly LeadParaVincular[]): IndiceDeTelefonos {
  const indice: IndiceDeTelefonos = new Map()
  for (const lead of leads) {
    for (const clave of clavesDelLead(lead)) {
      const lista = indice.get(clave)
      if (lista) lista.push(lead)
      else indice.set(clave, [lead])
    }
  }
  return indice
}

/**
 * Cuál se lleva la llamada cuando hay varios leads con el mismo teléfono. SIEMPRE el mismo para los mismos datos:
 *   1. el que sigue abierto antes que el descartado («No le interesa»),
 *   2. el que se tocó más recientemente (los que nunca se tocaron, al final),
 *   3. y a igualdad, el de id menor, para que el orden de lectura de la base no cambie el resultado.
 */
export function elegirLead(candidatos: readonly LeadParaVincular[]): LeadParaVincular {
  const abierto = (l: LeadParaVincular) => (l.status === 'no_interesa' ? 1 : 0)
  const toque = (l: LeadParaVincular) => (l.last_contacted_at ? Date.parse(l.last_contacted_at) : Number.NEGATIVE_INFINITY)
  return [...candidatos].sort((a, b) => abierto(a) - abierto(b) || toque(b) - toque(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
}

/** El lead de ESTE comercial al que corresponde un número, o null */
export function leadDeLaLlamada(numero: string | null, comercial: string, indice: IndiceDeTelefonos): LeadParaVincular | null {
  const clave = numero ? claveDeTelefono(numero) : null
  if (!clave) return null
  const suyos = (indice.get(clave) ?? []).filter((l) => l.assigned_to === comercial)
  return suyos.length > 0 ? elegirLead(suyos) : null
}

/** clave -> id del lead que se lleva sus llamadas, para un comercial. Es lo que usa la importación de Rinkel */
export function mapaDeLeadsDe(indice: IndiceDeTelefonos, comercial: string): Map<string, string> {
  const mapa = new Map<string, string>()
  for (const [clave, leads] of indice) {
    const suyos = leads.filter((l) => l.assigned_to === comercial)
    if (suyos.length > 0) mapa.set(clave, elegirLead(suyos).id)
  }
  return mapa
}

export interface ParDeVinculo {
  llamada: string
  lead: string
  fecha: string
}

/** Qué llamadas SIN lead se pueden enlazar ahora. Nunca toca una que ya tiene lead */
export function planearVinculos(llamadas: readonly LlamadaParaVincular[], indice: IndiceDeTelefonos): ParDeVinculo[] {
  const pares: ParDeVinculo[] = []
  for (const l of llamadas) {
    if (l.lead_id !== null) continue
    const lead = leadDeLaLlamada(l.numero, l.user_id, indice)
    if (lead) pares.push({ llamada: l.id, lead: lead.id, fecha: l.fecha })
  }
  return pares
}

/* ------------------------------------------------------------------ */
/* El diagnóstico                                                      */
/* ------------------------------------------------------------------ */

export interface Diagnostico {
  llamadas: {
    total: number
    salientes: number
    /** De todas: las que llegaron con el número oculto */
    sinNumero: number
    salientesConNumero: number
    salientesEnlazadas: number
    /** salientesEnlazadas / salientesConNumero, de 0 a 1 */
    proporcionEnlazadas: number
    /** Sin lead hoy pero con un lead suyo que lo casa: un repaso las enlazaría */
    pendientesDeEnlazar: number
    /** Sin lead, y el teléfono es de un lead asignado a OTRO comercial */
    aLeadDeOtro: number
    /** Salientes con número que no están en ningún lead de nadie */
    sinLead: number
  }
  /** Los números más repetidos entre las salientes que no están en Cold Calling */
  numerosSinLead: Array<{ numero: string; llamadas: number; comercial: string }>
  leads: {
    total: number
    conTelefono: number
    /** Con al menos un teléfono que da clave: son los únicos a los que se pueden enlazar llamadas */
    reconocidos: number
    /** Con algo escrito en el teléfono pero ninguna clave: NO recibirán nunca una llamada */
    sinReconocer: number
    /** Teléfonos que comparten varios leads de la misma persona */
    compartidos: number
  }
  /** Ejemplos de teléfonos que no se reconocen, para corregirlos */
  sinReconocer: Array<{ id: string; nombre: string; telefono: string }>
  /** Ejemplos de teléfonos compartidos */
  compartidos: Array<{ telefono: string; leads: string[] }>
}

const EJEMPLOS = 30
const NUMEROS = 15

export function diagnosticar(
  llamadas: readonly LlamadaParaVincular[],
  leads: readonly LeadParaVincular[],
  nombreDeComercial: (id: string) => string = (id) => id
): Diagnostico {
  const indice = indiceDeTelefonos(leads)

  let salientes = 0
  let sinNumero = 0
  let salientesConNumero = 0
  let salientesEnlazadas = 0
  let pendientesDeEnlazar = 0
  let aLeadDeOtro = 0
  let sinLead = 0
  const sinLeadPorNumero = new Map<string, { numero: string; llamadas: number; comerciales: Map<string, number> }>()

  for (const l of llamadas) {
    if (!l.numero) sinNumero += 1
    if (l.direccion !== 'outbound') continue
    salientes += 1
    if (!l.numero) continue
    salientesConNumero += 1
    if (l.lead_id !== null) {
      salientesEnlazadas += 1
      continue
    }
    const clave = claveDeTelefono(l.numero)
    const delMundo = clave ? (indice.get(clave) ?? []) : []
    if (delMundo.some((x) => x.assigned_to === l.user_id)) pendientesDeEnlazar += 1
    else if (delMundo.length > 0) aLeadDeOtro += 1
    else {
      sinLead += 1
      const grupo = sinLeadPorNumero.get(l.numero) ?? { numero: l.numero, llamadas: 0, comerciales: new Map<string, number>() }
      grupo.llamadas += 1
      grupo.comerciales.set(l.user_id, (grupo.comerciales.get(l.user_id) ?? 0) + 1)
      sinLeadPorNumero.set(l.numero, grupo)
    }
  }

  const numerosSinLead = [...sinLeadPorNumero.values()]
    .sort((a, b) => b.llamadas - a.llamadas || (a.numero < b.numero ? -1 : 1))
    .slice(0, NUMEROS)
    .map((g) => {
      const quien = [...g.comerciales.entries()].sort((a, b) => b[1] - a[1])[0][0]
      return { numero: g.numero, llamadas: g.llamadas, comercial: nombreDeComercial(quien) }
    })

  let conTelefono = 0
  let reconocidos = 0
  const sinReconocer: Diagnostico['sinReconocer'] = []
  let totalSinReconocer = 0
  for (const lead of leads) {
    const crudo = [lead.phone, lead.telefonos_extra].filter((t): t is string => typeof t === 'string' && /\d/.test(t))
    if (crudo.length === 0) continue
    conTelefono += 1
    if (clavesDelLead(lead).length > 0) reconocidos += 1
    else {
      totalSinReconocer += 1
      if (sinReconocer.length < EJEMPLOS) sinReconocer.push({ id: lead.id, nombre: lead.store_name?.trim() || 'Sin nombre', telefono: crudo.join(' · ') })
    }
  }

  const compartidosLista: Diagnostico['compartidos'] = []
  let compartidos = 0
  for (const [clave, lista] of indice) {
    // Compartido = el mismo teléfono en dos leads DE LA MISMA PERSONA (lo que de verdad hace dudar a quién va la llamada)
    const porPersona = new Map<string, LeadParaVincular[]>()
    for (const lead of lista) porPersona.set(lead.assigned_to ?? '', [...(porPersona.get(lead.assigned_to ?? '') ?? []), lead])
    if (![...porPersona.values()].some((ls) => ls.length > 1)) continue
    compartidos += 1
    if (compartidosLista.length < 10) compartidosLista.push({ telefono: clave.startsWith('+') ? clave : `+34 ${clave}`, leads: lista.map((l) => l.store_name?.trim() || l.id) })
  }

  return {
    llamadas: {
      total: llamadas.length,
      salientes,
      sinNumero,
      salientesConNumero,
      salientesEnlazadas,
      proporcionEnlazadas: salientesConNumero > 0 ? salientesEnlazadas / salientesConNumero : 0,
      pendientesDeEnlazar,
      aLeadDeOtro,
      sinLead,
    },
    numerosSinLead,
    leads: { total: leads.length, conTelefono, reconocidos, sinReconocer: totalSinReconocer, compartidos },
    sinReconocer,
    compartidos: compartidosLista,
  }
}
