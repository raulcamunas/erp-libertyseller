import { esTiendaOnline, pesoOrden, type ColdLead, type ColdLeadStatus, type ColdSort } from '@/lib/types/cold-leads'

/**
 * LA CARTERA DE COLD CALLING: FILTRAR, ORDENAR, CONTAR Y SACAR LAS RELLAMADAS.
 * ============================================================================
 * PURO. Se comprueba con cartera.prueba.ts. Lo usa el tablero (components/cold-calling/ColdCallingBoard.tsx).
 *
 * Estas reglas vivían dentro del componente, mezcladas con el pintado. Aquí están solas, con sus pruebas, porque casi todas
 * existen por un fallo que ya pasó y que no da ningún error: una pantalla que se queda vacía sin decir por qué, una
 * rellamada apalabrada que desaparece detrás de un filtro, unas tiendas que caen al final de la lista y no se ven nunca.
 *
 *
 * ============ LAS CINCO REGLAS QUE NO SE VEN ============
 *
 * 1. LAS DOS CIFRAS DE ORDEN NO SE MEZCLAN. Un vendedor de Amazon trae euros observados (`revenue_monthly`); una tienda
 *    online trae dólares estimados (`ventas_estimadas_usd`) y su `revenue_monthly` es nulo. pesoOrden() elige la que toca
 *    según el tipo. Sirve para ORDENAR y solo para eso: nunca se suman, ni se comparan en un filtro de rango.
 *
 * 2. EL RANGO DE FACTURACIÓN NO SE APLICA A LAS TIENDAS ONLINE. Ninguna tiene `revenue_monthly`, y un rango olvidado en las
 *    preferencias de ayer las dejaría todas fuera: pantalla vacía, sin una pista de por qué. Y con rango activo, un seller
 *    sin importe queda fuera: no se puede afirmar que caiga dentro.
 *
 * 3. UNA RELLAMADA NO SE FILTRA. Es un compromiso con una persona concreta a la que se le dijo «te llamo el martes»; los
 *    filtros son de PROSPECTAR (decidir a quién llamar de una cartera de miles). Con el filtro puesto en «más de 6.000 €», una
 *    rellamada apalabrada con un seller de 4.000 desaparecería y la llamada no se haría. Por eso salen de la cartera de la
 *    persona (`scoped`), nunca de la ya filtrada. Lo único que sí se respeta es de quién es el lead.
 *
 * 4. UN LEAD CERRADO NO TIENE RELLAMADA. Un «No le interesa» puede arrastrar una fecha vieja y esa fecha ya no significa nada:
 *    no cuenta como pendiente, no sale en la agenda y no sube al principio de la lista por su fecha.
 *
 * 5. UN FILTRO QUE YA NO TIENE NADA QUE FILTRAR SE QUITA SOLO. Los filtros de lista y de nivel se recuerdan de un día para
 *    otro; quien deje «Nivel 1» y mañana abra una lista de vendedores de Amazon vería la pantalla vacía sin ningún botón donde
 *    deshacerlo, y parecería que le han desaparecido los leads (normalizarFiltros).
 */

export interface FiltrosDeCartera {
  busqueda: string
  estado: ColdLeadStatus | 'all'
  /** 'all' o el nombre de la lista de origen («1a lista», «José V2»…; sin lista, «Sin lista») */
  lista: string
  /** 1, 2 o 3, o 'all'. Solo lo traen las tiendas online */
  nivel: number | 'all'
  /** Rango de facturación en euros al mes, como texto de un campo numérico. Solo para vendedores de Amazon */
  minRev: string
  maxRev: string
  orden: ColdSort
}

export const SIN_FILTROS: FiltrosDeCartera = { busqueda: '', estado: 'all', lista: 'all', nivel: 'all', minRev: '', maxRev: '', orden: 'due_first' }

export const NOMBRE_DE_LISTA_SIN_ORIGEN = 'Sin lista'

/** ¿Hay algo puesto? El orden también cuenta: cambiarlo es cambiar lo que se ve */
export function hayFiltros(f: FiltrosDeCartera): boolean {
  return f.busqueda !== '' || f.estado !== 'all' || f.lista !== 'all' || f.nivel !== 'all' || f.minRev !== '' || f.maxRev !== '' || f.orden !== 'due_first'
}

/** Cuántos filtros hay puestos, sin contar la búsqueda (que tiene su propia caja a la vista) ni el orden */
export function cuantosFiltros(f: FiltrosDeCartera): number {
  return (f.estado !== 'all' ? 1 : 0) + (f.lista !== 'all' ? 1 : 0) + (f.nivel !== 'all' ? 1 : 0) + (f.minRev !== '' || f.maxRev !== '' ? 1 : 0)
}

export const listaDe = (lead: Pick<ColdLead, 'source_list'>): string => lead.source_list || NOMBRE_DE_LISTA_SIN_ORIGEN

/** La fecha de rellamada que cuenta: un lead cerrado ya no tiene ninguna */
export const fechaDeRellamada = (lead: Pick<ColdLead, 'next_call_date' | 'status'>): string | null => (lead.status === 'no_interesa' ? null : lead.next_call_date || null)

/* ------------------------------------------------------------------ */
/* El peso y el texto de búsqueda se calculan UNA vez por lead         */
/* ------------------------------------------------------------------ */

const PESOS = new WeakMap<ColdLead, number>()
function peso(lead: ColdLead): number {
  let p = PESOS.get(lead)
  if (p === undefined) {
    p = pesoOrden(lead)
    PESOS.set(lead, p)
  }
  return p
}

const TEXTOS = new WeakMap<ColdLead, string>()
/**
 * Todo lo que se busca de un lead, en minúsculas y en un solo texto. `ciudad` y `web` entran porque en las tiendas online son
 * los dos campos por los que se busca de verdad: `province` viene vacía y el nombre de la tienda suele ser el dominio.
 */
function textoDeBusqueda(lead: ColdLead): string {
  let t = TEXTOS.get(lead)
  if (t === undefined) {
    t = [lead.store_name, lead.company, lead.phone, lead.email, lead.province, lead.category, lead.ciudad, lead.web]
      .filter(Boolean)
      .map((v) => String(v).toLowerCase())
      .join('\n')
    TEXTOS.set(lead, t)
  }
  return t
}

/* ------------------------------------------------------------------ */
/* Filtrar y ordenar                                                   */
/* ------------------------------------------------------------------ */

function dentroDelRango(lead: ColdLead, min: number | null, max: number | null): boolean {
  // Regla 2: a una tienda online no se le aplica; a un seller sin importe, con rango activo, no se le deja pasar
  if (esTiendaOnline(lead)) return true
  if (min === null && max === null) return true
  const rev = lead.revenue_monthly == null ? null : Number(lead.revenue_monthly)
  if (rev == null || Number.isNaN(rev)) return false
  if (min !== null && rev < min) return false
  if (max !== null && rev > max) return false
  return true
}

const aNumero = (texto: string): number | null => {
  if (texto.trim() === '') return null
  const n = Number(texto)
  return Number.isNaN(n) ? null : n
}

export function filtrar(leads: readonly ColdLead[], f: FiltrosDeCartera): ColdLead[] {
  const q = f.busqueda.trim().toLowerCase()
  const min = aNumero(f.minRev)
  const max = aNumero(f.maxRev)
  return leads.filter((l) => {
    if (f.nivel !== 'all' && l.nivel !== f.nivel) return false
    if (f.estado !== 'all' && l.status !== f.estado) return false
    if (f.lista !== 'all' && listaDe(l) !== f.lista) return false
    if (!dentroDelRango(l, min, max)) return false
    if (q && !textoDeBusqueda(l).includes(q)) return false
    return true
  })
}

const colador = new Intl.Collator('es')

/** Ordena una copia: los empates se quedan como venían, que es siempre el mismo orden (por id) */
export function ordenar(leads: readonly ColdLead[], orden: ColdSort): ColdLead[] {
  const porPeso = (a: ColdLead, b: ColdLead) => peso(b) - peso(a)
  const copia = [...leads]
  switch (orden) {
    case 'revenue_desc':
      return copia.sort(porPeso)
    case 'revenue_asc':
      return copia.sort((a, b) => -porPeso(a, b))
    case 'name':
      return copia.sort((a, b) => colador.compare(a.store_name, b.store_name))
    case 'prioridad':
      // El orden de trabajo de la lista nueva: primero el nivel que la propia lista marca como prioritario y, dentro del
      // nivel, las que más venden (estimado). Los leads sin nivel —los de Amazon— van detrás en vez de colarse arriba con un nulo
      return copia.sort((a, b) => (a.nivel ?? 99) - (b.nivel ?? 99) || porPeso(a, b))
    default:
      // due_first: las rellamadas pendientes arriba, la más antigua primero, y dentro de eso los que más facturan, que es donde
      // está el dinero. Un lead cerrado no tiene rellamada (regla 4)
      return copia.sort((a, b) => {
        const ad = fechaDeRellamada(a)
        const bd = fechaDeRellamada(b)
        if (ad && bd && ad !== bd) return ad < bd ? -1 : 1
        if (ad && !bd) return -1
        if (!ad && bd) return 1
        return porPeso(a, b)
      })
  }
}

export function filtrarYOrdenar(leads: readonly ColdLead[], f: FiltrosDeCartera): ColdLead[] {
  return ordenar(filtrar(leads, f), f.orden)
}

/* ------------------------------------------------------------------ */
/* Contar                                                              */
/* ------------------------------------------------------------------ */

/** Cuántos hay de cada estado en la cartera de la persona. Sale de `scoped` y no de lo ya filtrado, que lleva este filtro encima */
export function contarPorEstado(leads: readonly ColdLead[]): Map<ColdLeadStatus, number> {
  const mapa = new Map<ColdLeadStatus, number>()
  for (const l of leads) mapa.set(l.status, (mapa.get(l.status) ?? 0) + 1)
  return mapa
}

/** Las listas de origen que hay en la cartera, de la más grande a la más pequeña (a igualdad, por nombre) */
export function listasDisponibles(leads: readonly ColdLead[]): Array<[string, number]> {
  const mapa = new Map<string, number>()
  for (const l of leads) mapa.set(listaDe(l), (mapa.get(listaDe(l)) ?? 0) + 1)
  return [...mapa.entries()].sort((a, b) => b[1] - a[1] || colador.compare(a[0], b[0]))
}

/** Cuántos hay de cada nivel DENTRO DE LA LISTA elegida: el nivel solo tiene sentido en una lista de tiendas */
export function contarNiveles(leads: readonly ColdLead[], lista: string): Record<1 | 2 | 3, number> {
  const c: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 }
  for (const l of leads) {
    if (lista !== 'all' && listaDe(l) !== lista) continue
    if (l.nivel === 1 || l.nivel === 2 || l.nivel === 3) c[l.nivel] += 1
  }
  return c
}

/**
 * Quita lo que ya no tiene nada que filtrar (regla 5): una lista que ya no existe en la cartera que se mira, un nivel que no
 * tiene ningún lead en la lista elegida. Devuelve LOS MISMOS filtros (misma referencia) si no hay nada que quitar.
 */
export function normalizarFiltros(f: FiltrosDeCartera, cartera: readonly ColdLead[]): FiltrosDeCartera {
  let lista = f.lista
  if (lista !== 'all' && !cartera.some((l) => listaDe(l) === lista)) lista = 'all'
  let nivel = f.nivel
  if (nivel !== 'all') {
    const niveles = contarNiveles(cartera, lista)
    if (nivel !== 1 && nivel !== 2 && nivel !== 3) nivel = 'all'
    else if (niveles[nivel] === 0) nivel = 'all'
  }
  return lista === f.lista && nivel === f.nivel ? f : { ...f, lista, nivel }
}

export interface ResumenDeCartera {
  total: number
  /** Los que ya se han tocado: cualquier estado menos «Sin contactar» */
  trabajados: number
  cualificados: number
  /** Cualificados / trabajados, de 0 a 1 */
  conversion: number
  /** Las rellamadas que hay que hacer: las de hoy Y las que se pasaron de fecha y siguen sin hacerse */
  paraLlamar: number
  /** De ellas, las que ya se pasaron */
  atrasadas: number
}

export function resumenDeCartera(leads: readonly ColdLead[], hoy: string): ResumenDeCartera {
  let trabajados = 0
  let cualificados = 0
  let paraLlamar = 0
  let atrasadas = 0
  for (const l of leads) {
    if (l.status !== 'pendiente') trabajados += 1
    if (l.status === 'cita_cualificada') cualificados += 1
    const fecha = fechaDeRellamada(l)
    if (fecha && fecha <= hoy) {
      paraLlamar += 1
      if (fecha < hoy) atrasadas += 1
    }
  }
  return { total: leads.length, trabajados, cualificados, conversion: trabajados > 0 ? cualificados / trabajados : 0, paraLlamar, atrasadas }
}

/* ------------------------------------------------------------------ */
/* La agenda de rellamadas                                             */
/* ------------------------------------------------------------------ */

export interface Rellamadas {
  /** Las del día que se mira, las que más facturan primero */
  delDia: ColdLead[]
  /** Solo si se mira HOY: las que se pasaron de fecha y siguen ahí, las más viejas primero (llevan más tiempo cayéndose) */
  atrasadas: ColdLead[]
}

/**
 * Las rellamadas de un día. Salen de la cartera de la persona y no de lo filtrado (regla 3), y sin los cerrados (regla 4).
 * «Atrasadas» solo tiene sentido mirando HOY: puestos a mirar el jueves que viene, «atrasado» no quiere decir nada.
 */
export function rellamadasDe(cartera: readonly ColdLead[], dia: string, hoy: string): Rellamadas {
  const pendientes = cartera.filter((l) => fechaDeRellamada(l) !== null)
  const delDia = pendientes.filter((l) => l.next_call_date === dia).sort((a, b) => peso(b) - peso(a))
  const atrasadas = dia === hoy ? pendientes.filter((l) => (l.next_call_date as string) < hoy).sort((a, b) => ((a.next_call_date as string) < (b.next_call_date as string) ? -1 : (a.next_call_date as string) > (b.next_call_date as string) ? 1 : peso(b) - peso(a))) : []
  return { delDia, atrasadas }
}

/* ------------------------------------------------------------------ */
/* Todo lo que pinta la pantalla de una vez                            */
/* ------------------------------------------------------------------ */

export interface Panorama {
  /** Los leads que salen con TODO lo que hay puesto, ya ordenados */
  visibles: ColdLead[]
  /** Cuántos hay de cada estado con los demás filtros puestos: lo que saldría al pulsar ese estado */
  porEstado: Map<ColdLeadStatus, number>
  /** Cuántos hay con los demás filtros y sea cual sea el estado: el número del chip «Todos» */
  totalSinEstado: number
  niveles: Record<1 | 2 | 3, number>
  listas: Array<[string, number]>
}

/**
 * LOS NÚMEROS DE LOS CHIPS DICEN LO QUE SALDRÍA AL PULSARLOS.
 *
 * Cada grupo de chips (estado, nivel, lista) cuenta con TODOS LOS DEMÁS filtros puestos y sin el suyo propio. Con la lista «No Amazon
 * V1» elegida, «Sin contactar 760» es lo que se ve al pulsarlo; antes los estados contaban la cartera entera y el chip decía 891 cuando
 * al pulsarlo salían 760, y no había forma de saber por qué.
 */
export function panorama(leads: readonly ColdLead[], f: FiltrosDeCartera): Panorama {
  const sinEstado = filtrar(leads, { ...f, estado: 'all' })
  return {
    visibles: ordenar(filtrar(leads, f), f.orden),
    porEstado: contarPorEstado(sinEstado),
    totalSinEstado: sinEstado.length,
    niveles: contarNiveles(filtrar(leads, { ...f, nivel: 'all' }), 'all'),
    listas: listasDisponibles(filtrar(leads, { ...f, lista: 'all' })),
  }
}
