/**
 * EL TURNO DE LOS INFORMES: DE QUÉ COMERCIAL SE HACE EL SIGUIENTE.
 *
 * Raúl (16 nov 2026): «saca 1 de Alejandro, luego 1 de Maoli, luego 1 de Daniela, luego 1 de José y luego uno de Naomi. Que es así como
 * están llamando». Hasta entonces el turno iba horneado en el orden de los ficheros de la cola (y no era ese). Ahora lo decide el código:
 *
 *   1. Cada cola (Amazon y sin Amazon) se agrupa por comercial CONSERVANDO EL ORDEN DEL FICHERO, que es la prioridad que ya tenía (sin
 *      contactar, fases, resto, «no interesa»; de menor a mayor facturación).
 *   2. Se recorre ORDEN_DE_COMERCIALES empezando por el siguiente al último que tuvo informe. Al que no le queda nada se le salta.
 *   3. Para el elegido, el tipo es el contrario del último suyo (mitad Amazon, mitad sin Amazon, por persona) si le quedan de los dos; si no, el que le quede.
 *   4. Cuando a los cinco no les queda nada, el «resto» (los que no están en el turno y los sin comercial), en el orden del fichero y alternando.
 *
 * El turno NO vive en memoria (se perdía en cada despliegue): se deduce de los últimos hechos (`estadoDelTurno`), sacados de la bitácora
 * con el comercial de la cola, la misma fuente que agrupa el Repartidor (`hechosDelTurno`).
 * Lógica pura, sin Supabase: pruebas en turnos.prueba.ts (`npx tsx lib/analisis-amazon/turnos.prueba.ts`).
 */

/** EL ORDEN EN QUE SE REPARTEN LOS INFORMES (Raúl, 16 nov 2026: «así es como están llamando»). El único sitio donde se cambia. */
export const ORDEN_DE_COMERCIALES = [
  { id: 'e2d283da-b72f-4a91-9478-9fc9ee817fcb', nombre: 'Alejandro' },
  { id: '55b6c3a2-af73-4fec-b082-ffa6542d9019', nombre: 'Maoli' },
  { id: '4f01dd8a-de2f-4ed7-8c5c-9b62cd46b7e4', nombre: 'Daniela' },
  { id: '6a53c10f-f661-4d07-afe6-8123a45afb3c', nombre: 'José' },
  { id: '29bcc583-ad29-471a-a41f-cead1c301696', nombre: 'Naomi' },
  { id: 'ec1ca458-8e69-4620-80e1-c7e1dbab7301', nombre: 'Sharon' },
] as const

export type TipoDeCola = 'amazon' | 'sin'
/** La llave del grupo de los que no están en el turno (y de los sin comercial) */
export const RESTO = 'resto'

/**
 * Los tokens de Keepa que hacen falta para empezar una tienda de cada tipo (la recogida no empieza una sin saldo para acabarla). Aquí y no
 * en recogida.ts para que el panel (cliente) pinte las mismas rayas sin importar código de servidor.
 *   amazon  con 10 productos (13 nov 2026) un informe de Amazon gasta ~100; con 110 no se queda a medias
 *   sin     marca, sus vendedores y hasta 2 mercados de 6 (~150-200; el umbral cubre el peor caso)
 */
export const COSTE_DE_TIPO: Readonly<Record<'amazon' | 'sin', number>> = { amazon: 110, sin: 280 }

export const otroTipo =(t: TipoDeCola): TipoDeCola => (t === 'amazon' ? 'sin' : 'amazon')

/** «José» = «jose» = «  JOSÉ García »: minúsculas, sin tildes, y solo la primera palabra (en la cola el comercial va por nombre de pila) */
export function normalizarNombre(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .split(/\s+/)[0]
}

/**
 * Nombre de pila → id de perfil. SOLO coincidencia exacta del nombre normalizado («Daniella» no es «Daniela»). Si un nombre sale en dos
 * perfiles es ambiguo y no se resuelve (esa entrada va al «resto»): mejor fuera del turno que en el de otra persona.
 */
export function idPorNombre(perfiles: ReadonlyArray<{ id: string; full_name: string | null }>): Map<string, string> {
  const vistos = new Map<string, string | null>()
  for (const p of perfiles) {
    const n = normalizarNombre(p.full_name)
    if (!n) continue
    vistos.set(n, vistos.has(n) && vistos.get(n) !== p.id ? null : p.id)
  }
  const salida = new Map<string, string>()
  for (const [n, id] of vistos) if (id) salida.set(n, id)
  return salida
}

/** El comercial de una entrada de la cola: su id si lo trae; si no, el que corresponda a su nombre */
export function comercialDe(entrada: { comercial?: string | null; comercialId?: string | null }, porNombre: ReadonlyMap<string, string>): string | null {
  if (entrada.comercialId) return entrada.comercialId
  const n = normalizarNombre(entrada.comercial)
  return n ? (porNombre.get(n) ?? null) : null
}

/** Dónde está alguien en el turno: su id si está en el orden, si no RESTO */
export function grupoDe(comercialId: string | null | undefined, orden: readonly string[] = IDS_DEL_ORDEN): string {
  return comercialId && orden.includes(comercialId) ? comercialId : RESTO
}

export const IDS_DEL_ORDEN: readonly string[] = ORDEN_DE_COMERCIALES.map((c) => c.id)

/** Lo que hay que saber del pasado para elegir el siguiente */
export interface EstadoDelTurno {
  /** El grupo (id del comercial o RESTO) del último informe HECHO */
  ultimoGrupo: string | null
  /** El tipo del último informe hecho de cada grupo */
  ultimoTipoPor: Map<string, TipoDeCola>
}

/**
 * El turno deducido de los últimos informes guardados (los más nuevos primero): de quién fue el último y qué tipo hizo cada uno la última vez.
 * `comercialId` es el comercial de la entrada de la cola (ver `hechosDelTurno`).
 */
export function estadoDelTurno(ultimos: ReadonlyArray<{ comercialId: string | null; tipo: TipoDeCola }>, orden: readonly string[] = IDS_DEL_ORDEN): EstadoDelTurno {
  const ultimoTipoPor = new Map<string, TipoDeCola>()
  for (const u of ultimos) {
    const g = grupoDe(u.comercialId, orden)
    if (!ultimoTipoPor.has(g)) ultimoTipoPor.set(g, u.tipo)
  }
  return { ultimoGrupo: ultimos.length ? grupoDe(ultimos[0].comercialId, orden) : null, ultimoTipoPor }
}

/** Un informe hecho visto por el turno: de quién era en la cola, de qué tipo y cuándo */
export interface HechoDelTurno {
  comercialId: string | null
  tipo: TipoDeCola
  at: string
  lead: string
}

/**
 * LOS ÚLTIMOS HECHOS PARA EL TURNO (los más nuevos primero), DE LA MISMA FUENTE QUE EL REPARTIDOR.
 *
 * El Repartidor agrupa lo pendiente por el comercial de la ENTRADA DE LA COLA. Si el turno se dedujera del dueño ACTUAL del lead
 * (`assigned_to`), un lead reasignado (movimientos de lista, ciclos) haría saltar el turno: hecho en el hueco de Alejandro, leído luego como
 * de Daniela → le tocaría a José, y Maoli y Daniela perderían su vez. Por eso manda la bitácora, que guarda el `comercialId` de la cola.
 *
 * `informes` (dueño actual del lead) solo rellena lo que la bitácora no cubre: lo anterior a su primer hecho (lo del portátil y lo de antes
 * del 16 nov) y el caso de bitácora vacía justo tras el despliegue. Nunca se repite un lead que ya está en la bitácora.
 */
export function hechosDelTurno(
  bitacora: ReadonlyArray<{ at: string; tipo: TipoDeCola; lead: string; comercialId: string | null; resultado: string }>,
  informes: ReadonlyArray<HechoDelTurno>,
  cuantos: number,
): HechoDelTurno[] {
  const deLaBitacora = bitacora
    .filter((ev) => ev.resultado === 'hecho')
    .map((ev) => ({ comercialId: ev.comercialId ?? null, tipo: ev.tipo, at: ev.at, lead: ev.lead }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  const claves = new Set(deLaBitacora.map((h) => `${h.tipo}:${h.lead}`))
  const masViejo = deLaBitacora.length ? Date.parse(deLaBitacora[deLaBitacora.length - 1].at) : Infinity
  const anteriores = informes
    .filter((h) => !claves.has(`${h.tipo}:${h.lead}`) && Date.parse(h.at) < masViejo)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  return [...deLaBitacora, ...anteriores].slice(0, cuantos)
}

export type Eleccion<A, S> = { tipo: 'amazon'; v: A; grupo: string } | { tipo: 'sin'; v: S; grupo: string }

/**
 * EL REPARTIDOR: las dos colas pendientes agrupadas por comercial, con un puntero por grupo y tipo. Se monta una vez por pasada (las colas
 * tienen miles de entradas) y se le va pidiendo `siguiente` y `quitar`.
 */
export class Repartidor<A, S> {
  private grupos = new Map<string, { amazon: A[]; sin: S[]; ia: number; ib: number }>()
  readonly orden: readonly string[]

  constructor(pendAm: readonly A[], pendSin: readonly S[], comercialIdDe: (v: A | S) => string | null, orden: readonly string[] = IDS_DEL_ORDEN) {
    this.orden = orden
    for (const v of pendAm) this.grupo(grupoDe(comercialIdDe(v), orden)).amazon.push(v)
    for (const v of pendSin) this.grupo(grupoDe(comercialIdDe(v), orden)).sin.push(v)
  }

  private grupo(id: string) {
    let g = this.grupos.get(id)
    if (!g) {
      g = { amazon: [], sin: [], ia: 0, ib: 0 }
      this.grupos.set(id, g)
    }
    return g
  }

  /** Cuántas le quedan a un grupo de un tipo (o de los dos) */
  quedan(grupo: string, tipo?: TipoDeCola): number {
    const g = this.grupos.get(grupo)
    if (!g) return 0
    const a = g.amazon.length - g.ia
    const b = g.sin.length - g.ib
    return tipo === 'amazon' ? a : tipo === 'sin' ? b : a + b
  }

  /** Lo siguiente que toca, sin quitarlo de la cola. null = no queda nada en ninguna */
  siguiente(estado: EstadoDelTurno): Eleccion<A, S> | null {
    const n = this.orden.length
    const desde = estado.ultimoGrupo ? this.orden.indexOf(estado.ultimoGrupo) + 1 : 0 // RESTO o desconocido → indexOf -1 → empieza por el primero
    for (let k = 0; k < n; k++) {
      const id = this.orden[(desde + k) % n]
      if (this.quedan(id) > 0) return this.de(id, estado)
    }
    return this.quedan(RESTO) > 0 ? this.de(RESTO, estado) : null
  }

  private de(id: string, estado: EstadoDelTurno): Eleccion<A, S> {
    const g = this.grupo(id)
    const hayA = g.ia < g.amazon.length
    const hayB = g.ib < g.sin.length
    const ultimo = estado.ultimoTipoPor.get(id)
    const tipo: TipoDeCola = hayA && hayB ? (ultimo ? otroTipo(ultimo) : 'amazon') : hayA ? 'amazon' : 'sin'
    return tipo === 'amazon' ? { tipo, v: g.amazon[g.ia], grupo: id } : { tipo, v: g.sin[g.ib], grupo: id }
  }

  /** Quita de la cola lo elegido (hecho, saltado o intentado en esta pasada) */
  quitar(e: Eleccion<A, S>) {
    const g = this.grupos.get(e.grupo)
    if (!g) return
    if (e.tipo === 'amazon') g.ia++
    else g.ib++
  }
}

/** Tras un informe HECHO, el turno pasa: es lo que se apunta. (Un saltado no consume el turno: el mismo comercial sigue con su siguiente.) */
export function trasHecho(estado: EstadoDelTurno, e: { grupo: string; tipo: TipoDeCola }): EstadoDelTurno {
  const ultimoTipoPor = new Map(estado.ultimoTipoPor)
  ultimoTipoPor.set(e.grupo, e.tipo)
  return { ultimoGrupo: e.grupo, ultimoTipoPor }
}

/** Atajo puro para las pruebas y el panel: las N siguientes que saldrían si todas se hicieran */
export function simularTurnos<A, S>(pendAm: readonly A[], pendSin: readonly S[], comercialIdDe: (v: A | S) => string | null, estado: EstadoDelTurno, cuantas: number, orden: readonly string[] = IDS_DEL_ORDEN): Eleccion<A, S>[] {
  const r = new Repartidor(pendAm, pendSin, comercialIdDe, orden)
  const salida: Eleccion<A, S>[] = []
  let e = estado
  for (let i = 0; i < cuantas; i++) {
    const s = r.siguiente(e)
    if (!s) break
    salida.push(s)
    r.quitar(s)
    e = trasHecho(e, s)
  }
  return salida
}

/**
 * ¿Se respeta el turno? De cada par de informes seguidos (más viejo → más nuevo), el segundo debía ser del siguiente en el orden al que le
 * quedara algo. `conPendientes` dice quién tiene algo pendiente AHORA (se usa como aproximación de entonces). Devuelve la proporción que
 * cumple, o null si no hay pares.
 */
export function cumplimientoDelTurno(hechos: ReadonlyArray<{ comercialId: string | null }>, conPendientes: ReadonlySet<string>, orden: readonly string[] = IDS_DEL_ORDEN): number | null {
  if (hechos.length < 2) return null
  let bien = 0
  for (let i = 1; i < hechos.length; i++) {
    const previo = grupoDe(hechos[i - 1].comercialId, orden)
    const actual = grupoDe(hechos[i].comercialId, orden)
    const desde = orden.indexOf(previo) + 1
    let esperado: string = RESTO
    for (let k = 0; k < orden.length; k++) {
      const id = orden[(desde + k) % orden.length]
      if (conPendientes.has(id)) {
        esperado = id
        break
      }
    }
    // Si a nadie del turno le queda nada, cualquiera del resto vale
    if (actual === esperado) bien++
  }
  return bien / (hechos.length - 1)
}
