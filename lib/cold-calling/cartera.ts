import { CAJAS_DEL_CICLO, cajaDelCiclo, enCiclo, esListaDeCiclo, type EstadoVisible } from '@/lib/cold-calling/ciclo'
import { contarPrioridadesDe } from '@/lib/cold-calling/partners'
import { COLD_STATUSES, esPartner, esTiendaOnline, pesoOrden, type ColdLead, type ColdSort } from '@/lib/types/cold-leads'

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
 *    deshacerlo, y parecería que le han desaparecido los leads (normalizarFiltros). Lo mismo vale para la prioridad y el «menciona
 *    Amazon» de los partners.
 *
 * 6. LOS PARTNERS TIENEN SU PROPIO NÚMERO DE ORDEN Y SUS PROPIOS FILTROS. No tienen facturación ni nivel: tienen una prioridad (1 a 4, la
 *    de la columna «Prioridad» del Excel de captación) y puntos, y pesoOrden() los junta en un solo número con la prioridad mandando.
 *    El rango de facturación no se les aplica (como a las tiendas online: ninguno tiene `revenue_monthly`), y el filtro de prioridad
 *    deja fuera a todo lo que no sea un partner de esa prioridad.
 *
 * 7. UNA LISTA DE CICLO TIENE SUS PROPIAS CAJAS DE ESTADO. En una lista donde más de la mitad de los leads están en el ciclo comercial (lib/cold-calling/ciclo.ts) los chips de estado son
 *    Sin contactar · Fase 2 · Fase 3 · No responde · En seguimiento · Cita agendada · No le interesa, y se cuenta y se filtra por la caja de cada lead y no por su `status`. En todas las demás
 *    vistas, incluida «Todas las listas», los chips son los de siempre y cada lead cuenta por su estado de verdad: así ningún lead se queda sin chip en ninguna vista. Un chip que ya no existe
 *    en la vista que se mira (un «Fase 2» recordado y una lista que no es de ciclo) se quita solo, como el nivel y la prioridad (regla 5).
 */

export interface FiltrosDeCartera {
  busqueda: string
  /** Un estado de siempre o, solo en una lista de ciclo, una de sus tres cajas (Fase 2, Fase 3, No responde) */
  estado: EstadoVisible | 'all'
  /** 'all' o el nombre de la lista de origen («1a lista», «José V2»…; sin lista, «Sin lista») */
  lista: string
  /** 1, 2 o 3, o 'all'. Solo lo traen las tiendas online */
  nivel: number | 'all'
  /** Rango de facturación en euros al mes, como texto de un campo numérico. Solo para vendedores de Amazon */
  minRev: string
  maxRev: string
  /** 1 a 4, o 'all'. La «Prioridad» de un partner: 1 llamar primero, 2 segunda ronda, 3 solo email, 4 revisar. Solo la traen los partners */
  prioridad: number | 'all'
  /** Solo los partners cuya web menciona Amazon: ya conocen el canal, y son los que mejor entienden de qué se les habla */
  mencionaAmazon: boolean
  orden: ColdSort
}

export const SIN_FILTROS: FiltrosDeCartera = { busqueda: '', estado: 'all', lista: 'all', nivel: 'all', minRev: '', maxRev: '', prioridad: 'all', mencionaAmazon: false, orden: 'due_first' }

export const NOMBRE_DE_LISTA_SIN_ORIGEN = 'Sin lista'

/** ¿Hay algo puesto? El orden también cuenta: cambiarlo es cambiar lo que se ve */
export function hayFiltros(f: FiltrosDeCartera): boolean {
  return f.busqueda !== '' || f.estado !== 'all' || f.lista !== 'all' || f.nivel !== 'all' || f.minRev !== '' || f.maxRev !== '' || f.prioridad !== 'all' || f.mencionaAmazon || f.orden !== 'due_first'
}

/** Cuántos filtros hay puestos, sin contar la búsqueda (que tiene su propia caja a la vista) ni el orden */
export function cuantosFiltros(f: FiltrosDeCartera): number {
  return (f.estado !== 'all' ? 1 : 0) + (f.lista !== 'all' ? 1 : 0) + (f.nivel !== 'all' ? 1 : 0) + (f.minRev !== '' || f.maxRev !== '' ? 1 : 0) + (f.prioridad !== 'all' ? 1 : 0) + (f.mencionaAmazon ? 1 : 0)
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
  // Regla 2: a una tienda online no se le aplica (ni a un partner: tampoco tiene facturación); a un seller sin importe, con rango activo, no se le deja pasar
  if (esTiendaOnline(lead) || esPartner(lead)) return true
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

export function filtrar(leads: readonly ColdLead[], f: FiltrosDeCartera, modoCiclo = false): ColdLead[] {
  const q = f.busqueda.trim().toLowerCase()
  const min = aNumero(f.minRev)
  const max = aNumero(f.maxRev)
  return leads.filter((l) => {
    if (f.nivel !== 'all' && l.nivel !== f.nivel) return false
    if (f.prioridad !== 'all' && !(esPartner(l) && l.prioridad === f.prioridad)) return false
    if (f.mencionaAmazon && !(esPartner(l) && l.menciona_amazon === true)) return false
    if (f.estado !== 'all' && (modoCiclo ? cajaDelCiclo(l) : l.status) !== f.estado) return false
    if (f.lista !== 'all' && listaDe(l) !== f.lista) return false
    if (!dentroDelRango(l, min, max)) return false
    if (q && !textoDeBusqueda(l).includes(q)) return false
    return true
  })
}

const colador = new Intl.Collator('es')

/** El número por el que se ordena «Nivel y ventas» / «Prioridad y puntos»: el nivel de una tienda, la prioridad de un partner; sin ninguno, al final */
const rangoDeTrabajo = (lead: ColdLead): number => (esPartner(lead) ? (lead.prioridad ?? 99) : (lead.nivel ?? 99))

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
      // nivel, las que más venden (estimado). Los leads sin nivel —los de Amazon— van detrás en vez de colarse arriba con un nulo.
      // En un partner el «nivel» es su prioridad (1 a 4) y lo que desempata son sus puntos (que ya van dentro del peso)
      return copia.sort((a, b) => rangoDeTrabajo(a) - rangoDeTrabajo(b) || porPeso(a, b))
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

export function filtrarYOrdenar(leads: readonly ColdLead[], f: FiltrosDeCartera, modoCiclo = false): ColdLead[] {
  return ordenar(filtrar(leads, f, modoCiclo), f.orden)
}

/* ------------------------------------------------------------------ */
/* Contar                                                              */
/* ------------------------------------------------------------------ */

/**
 * Cuántos hay de cada estado en la cartera de la persona. Sale de `scoped` y no de lo ya filtrado, que lleva este filtro encima. En una lista de ciclo (regla 7) cuenta por la caja de cada
 * lead; en cualquier otra vista, por su estado.
 */
export function contarPorEstado(leads: readonly ColdLead[], modoCiclo = false): Map<EstadoVisible, number> {
  const mapa = new Map<EstadoVisible, number>()
  for (const l of leads) {
    const estado = modoCiclo ? cajaDelCiclo(l) : l.status
    mapa.set(estado, (mapa.get(estado) ?? 0) + 1)
  }
  return mapa
}

/**
 * ¿Se está mirando una lista de ciclo? Solo con UNA lista elegida (en «Todas las listas» se mezclan los leads del ciclo con los de siempre y los chips son los de siempre) y cuando más de la
 * mitad de lo que hay en ella está en el ciclo (esListaDeCiclo). Se pregunta por la cartera entera de la persona y no por lo ya filtrado: con un filtro puesto los chips no pueden cambiar de
 * juego.
 */
export function esVistaDeCiclo(leads: readonly ColdLead[], lista: string): boolean {
  if (lista === 'all') return false
  let total = 0
  let enElCiclo = 0
  for (const l of leads) {
    if (listaDe(l) !== lista) continue
    total++
    if (enCiclo(l)) enElCiclo++
  }
  return esListaDeCiclo(total, enElCiclo)
}

/** Las listas de ciclo que hay en la cartera: las que cumplen la regla de esListaDeCiclo */
export function listasDeCiclo(leads: readonly ColdLead[]): Set<string> {
  const total = new Map<string, number>()
  const enElCiclo = new Map<string, number>()
  for (const l of leads) {
    const lista = listaDe(l)
    total.set(lista, (total.get(lista) ?? 0) + 1)
    if (enCiclo(l)) enElCiclo.set(lista, (enElCiclo.get(lista) ?? 0) + 1)
  }
  return new Set([...enElCiclo].filter(([lista, n]) => esListaDeCiclo(total.get(lista) ?? 0, n)).map(([lista]) => lista))
}

/**
 * Los leads que saldrían al elegir cada lista, con los demás filtros puestos: lo que cuenta el desplegable de listas. El estado solo cuenta si existe como chip en la vista de ESA lista (una de
 * ciclo tiene sus cajas, las demás los siete de siempre): si no, `normalizarFiltros` lo quita al elegirla y salen todos. Sin esto, con «No responde» puesto en una lista de ciclo el desplegable
 * enseñaría las demás listas con cero leads y no se podría ir a ellas.
 */
function filtrarParaLasListas(leads: readonly ColdLead[], f: FiltrosDeCartera, enCiclos: ReadonlySet<string>): ColdLead[] {
  const pasan = filtrar(leads, { ...f, lista: 'all', estado: 'all' })
  const estado = f.estado
  if (estado === 'all') return pasan
  return pasan.filter((l) => {
    const delCiclo = enCiclos.has(listaDe(l))
    // Tipada como lista de EstadoVisible: con la unión de las dos listas TypeScript 5.9 exige que el argumento valga para las dos a la vez
    const chips: readonly EstadoVisible[] = delCiclo ? CAJAS_DEL_CICLO : COLD_STATUSES
    if (!chips.includes(estado)) return true
    return (delCiclo ? cajaDelCiclo(l) : l.status) === estado
  })
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

/** Cuántos partners hay de cada prioridad DENTRO DE LA LISTA elegida: la prioridad solo tiene sentido en una lista de partners */
export function contarPrioridades(leads: readonly ColdLead[], lista: string): Record<1 | 2 | 3 | 4, number> {
  return contarPrioridadesDe(leads, lista, listaDe)
}

/** ¿Hay algún partner en la lista elegida? Entonces existen los filtros de prioridad y de «menciona Amazon» */
export function hayPartnersEn(leads: readonly ColdLead[], lista: string): boolean {
  return leads.some((l) => esPartner(l) && (lista === 'all' || listaDe(l) === lista))
}

/**
 * Quita lo que ya no tiene nada que filtrar (regla 5): una lista que ya no existe en la cartera que se mira, un nivel que no
 * tiene ningún lead en la lista elegida, una prioridad o un «menciona Amazon» sin ningún partner. Devuelve LOS MISMOS filtros
 * (misma referencia) si no hay nada que quitar.
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
  let prioridad = f.prioridad
  if (prioridad !== 'all') {
    const prioridades = contarPrioridades(cartera, lista)
    if (prioridad !== 1 && prioridad !== 2 && prioridad !== 3 && prioridad !== 4) prioridad = 'all'
    else if (prioridades[prioridad] === 0) prioridad = 'all'
  }
  const mencionaAmazon = f.mencionaAmazon && hayPartnersEn(cartera, lista)
  // Una caja que no existe en la vista que se mira (regla 7): «Fase 2» sin una lista de ciclo, o «No contesta» dentro de una
  let estado = f.estado
  if (estado !== 'all') {
    const chips: readonly EstadoVisible[] = esVistaDeCiclo(cartera, lista) ? CAJAS_DEL_CICLO : COLD_STATUSES
    if (!chips.includes(estado)) estado = 'all'
  }
  return lista === f.lista && nivel === f.nivel && prioridad === f.prioridad && mencionaAmazon === f.mencionaAmazon && estado === f.estado ? f : { ...f, lista, nivel, prioridad, mencionaAmazon, estado }
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
  /** Cuántos hay de cada estado con los demás filtros puestos: lo que saldría al pulsar ese estado (en una lista de ciclo, de cada caja) */
  porEstado: Map<EstadoVisible, number>
  /** ¿Es una lista de ciclo la que se mira? Entonces los chips de estado son sus cajas (regla 7) */
  modoCiclo: boolean
  /** Cuántos hay con los demás filtros y sea cual sea el estado: el número del chip «Todos» */
  totalSinEstado: number
  niveles: Record<1 | 2 | 3, number>
  /** Cuántos partners hay de cada prioridad con los demás filtros puestos */
  prioridades: Record<1 | 2 | 3 | 4, number>
  /** Cuántos partners cuya web menciona Amazon hay con los demás filtros puestos: lo que saldría al pulsar «Menciona Amazon» */
  mencionanAmazon: number
  listas: Array<[string, number]>
}

/**
 * EL ORDEN DE LA VISTA. En las cajas del ritmo de una lista de ciclo —Fase 2, Fase 3 y «No responde»— el orden es SIEMPRE «las rellamadas primero», sea cual sea el que se haya elegido: arriba los
 * que ya toca llamar y, entre ellos, los MÁS ANTIGUOS (los más atrasados), después los de hoy y al final los que todavía no han llegado a su día. Los leads pasan de fase cuando la persona pulsa
 * la siguiente (lib/cold-calling/ciclo-manual.ts), así que los atrasados se acumulan con los días y se limpian de arriba abajo llamando. En cualquier otra vista manda el orden que haya elegido cada persona.
 */
export function ordenDeLaVista(f: FiltrosDeCartera, modoCiclo: boolean): ColdSort {
  return modoCiclo && (f.estado === 'fase_2' || f.estado === 'fase_3' || f.estado === 'no_responde') ? 'due_first' : f.orden
}

/**
 * LOS NÚMEROS DE LOS CHIPS DICEN LO QUE SALDRÍA AL PULSARLOS.
 *
 * Cada grupo de chips (estado, nivel, lista) cuenta con TODOS LOS DEMÁS filtros puestos y sin el suyo propio. Con la lista «No Amazon
 * V1» elegida, «Sin contactar 760» es lo que se ve al pulsarlo; antes los estados contaban la cartera entera y el chip decía 891 cuando
 * al pulsarlo salían 760, y no había forma de saber por qué.
 */
export function panorama(leads: readonly ColdLead[], f: FiltrosDeCartera, modoCiclo: boolean = esVistaDeCiclo(leads, f.lista)): Panorama {
  const sinEstado = filtrar(leads, { ...f, estado: 'all' }, modoCiclo)
  return {
    visibles: ordenar(filtrar(leads, f, modoCiclo), ordenDeLaVista(f, modoCiclo)),
    porEstado: contarPorEstado(sinEstado, modoCiclo),
    modoCiclo,
    totalSinEstado: sinEstado.length,
    niveles: contarNiveles(filtrar(leads, { ...f, nivel: 'all' }, modoCiclo), 'all'),
    prioridades: contarPrioridades(filtrar(leads, { ...f, prioridad: 'all' }, modoCiclo), 'all'),
    mencionanAmazon: filtrar(leads, { ...f, mencionaAmazon: false }, modoCiclo).filter((l) => esPartner(l) && l.menciona_amazon === true).length,
    listas: listasDisponibles(filtrarParaLasListas(leads, f, listasDeCiclo(leads))),
  }
}
