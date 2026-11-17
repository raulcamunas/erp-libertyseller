/**
 * LA RECOGIDA DE KEEPA EN EL SERVIDOR: cada minuto, si Keepa tiene saldo para una tienda entera, se analiza la siguiente de la cola, se
 * construye su informe y se guarda (el lead queda con «Con informe»). Sustituye a la recogida y al importador del portátil.
 *
 * LA COLA vive en Storage (bucket privado `analisis-keepa`, sin migración):
 *   cola.json      [{ lead, seller, tienda, comercial }] en el orden acordado: primero los «sin contactar», luego Fase 2 y 3 con llamada
 *                  próxima, luego el resto y al final los «no interesa». El TURNO entre comerciales ya no va en el orden del fichero: lo
 *                  decide turnos.ts al vuelo (Alejandro → Maoli → Daniela → José → Naomi, configurable en ORDEN_DE_COMERCIALES).
 *   saltados.json  { sellerId: motivo } los que no tienen informe posible (Keepa no los conoce, sin productos, el lead ya no existe…)
 * Lo hecho no se apunta aparte: es el lead con `analisis_amazon_at`. Así lo que cargó el portátil cuenta igual.
 *
 * Una tienda se hace de una tirada (unos segundos) y solo si hay saldo para ella: no hay esperas largas dentro de la ruta. Si hay saldo
 * acumulado (tras un despliegue, por ejemplo) hace varias seguidas hasta MINUTOS_POR_PASADA.
 *
 * DOS COLAS A LA VEZ (13 nov 2026): la de vendedores de Amazon (cola.json) y la de tiendas online que no venden en Amazon
 * (cola-sin-amazon.json, informe de lib/analisis-sin-amazon). Se alternan: una de cada, y si una se acaba sigue la otra. Las de la
 * segunda se apuntan en saltados.json con la clave `lead:<id>`. Si al estudiar una tienda «sin Amazon» resulta que el vendedor de su
 * marca es ella (mismo CIF o razón social), el lead se marca como vendedor y pasa al principio de la cola de Amazon.
 *
 * TURNOS POR COMERCIAL (16 nov 2026, turnos.ts): uno de cada comercial en el orden de ORDEN_DE_COMERCIALES, y para cada uno se alterna Amazon
 * y sin Amazon. El turno se deduce de los últimos hechos de la bitácora, con el comercial de la cola como agrupa el Repartidor (antes era una
 * variable en memoria que se perdía en cada despliegue; el dueño actual del lead solo de respaldo, ver turnos.ts `hechosDelTurno`). Un
 * saltado no consume el turno; un hecho sí. Si no hay saldo para lo que toca, se espera: no se cuela otro más barato.
 *
 * BITÁCORA (bitacora.json): cada hecho, saltado o fallo con su hora y sus tokens, para el panel «Informes» de Cold Calling. Y el saldo se
 * pregunta ANTES de leer las colas: en la mayoría de pasadas no hay saldo y no hace falta bajar 1,6 MB de colas ni paginar los hechos.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { construirAnalisis } from './construir'
import { guardarAnalisis } from './guardar'
import { estudiarVendedor, saldoKeepa, SinTokens, type Saldo } from './keepa'
import { falta303 } from './servidor'
import { clientesActuales, esCliente, type Clientes } from './clientes'
import { leerCatalogo } from '@/lib/analisis-sin-amazon/catalogo'
import { estudiarTienda, planDeEstudio } from '@/lib/analisis-sin-amazon/estudio'
import { construirSinAmazon, SELLER_SIN_AMAZON } from '@/lib/analisis-sin-amazon/construir'
import { apuntarEnBitacora, escribirJson, leerJson, type EnCola, type EnColaSinAmazon, type EventoDeBitacora } from './almacen'
import { COSTE_DE_TIPO, comercialDe, estadoDelTurno, hechosDelTurno, idPorNombre, Repartidor, trasHecho, type HechoDelTurno, type TipoDeCola } from './turnos'

export { BUCKET, type EnCola, type EnColaSinAmazon } from './almacen'
/** Lo que hace falta para empezar cada tipo de tienda (110 y 280; el porqué, en turnos.ts COSTE_DE_TIPO) */
const TOKENS_POR_TIENDA = COSTE_DE_TIPO.amazon
const TOKENS_SIN_AMAZON = COSTE_DE_TIPO.sin
const MINUTOS_POR_PASADA = 4
const INTENTOS_ANTES_DE_SALTAR = 3

/** Cuántos informes recientes se miran para saber de quién fue el último y qué tipo hizo cada comercial (5 comerciales × ~5) */
const INFORMES_PARA_EL_TURNO = 25

/** Los fallos seguidos de cada vendedor, en memoria (el servidor es un solo proceso) */
const fallos = new Map<string, number>()
let enMarcha = false
/**
 * Lo que necesita lo que toca ahora (110 o 280 tokens), para no leer las colas si no hay saldo para ello. En memoria: tras un despliegue
 * vale lo mínimo y la primera pasada con saldo lo corrige.
 */
let necesitaLoSiguiente = TOKENS_POR_TIENDA

/** ¿Hay una pasada en marcha en este proceso? (para el panel de Informes) */
export const recogidaEnMarcha = () => enMarcha

const costeDe = (tipo: TipoDeCola) => (tipo === 'amazon' ? TOKENS_POR_TIENDA : TOKENS_SIN_AMAZON)

/**
 * Los últimos informes guardados con el dueño ACTUAL de su lead. Solo de respaldo para el turno (`hechosDelTurno`): manda la bitácora, que
 * guarda el comercial de la entrada de la cola, como agrupa el Repartidor. Esto cubre la bitácora vacía y lo de antes de ella.
 */
async function ultimosInformes(s: SupabaseClient): Promise<HechoDelTurno[]> {
  const { data, error } = await s.from('analisis_amazon').select('lead_id, seller_id, creado_en, cold_leads(assigned_to)').order('creado_en', { ascending: false }).limit(INFORMES_PARA_EL_TURNO)
  if (error) throw error
  return ((data ?? []) as Array<{ lead_id: string; seller_id: string; creado_en: string; cold_leads: { assigned_to: string | null } | Array<{ assigned_to: string | null }> | null }>).map((f) => {
    const lead = Array.isArray(f.cold_leads) ? f.cold_leads[0] : f.cold_leads
    return { comercialId: lead?.assigned_to ?? null, tipo: f.seller_id === SELLER_SIN_AMAZON ? 'sin' : 'amazon', at: f.creado_en, lead: f.lead_id }
  })
}

async function perfiles(s: SupabaseClient): Promise<Array<{ id: string; full_name: string | null }>> {
  const { data, error } = await s.from('profiles').select('id, full_name')
  if (error) throw error
  return (data ?? []) as Array<{ id: string; full_name: string | null }>
}

/** El resumen de la pasada (cabe en 480): si hay que recortar, se recortan los nombres y nunca lo de detrás, que el panel lee («N tokens», «esperando saldo…») */
export function componerResumen(hechas: number, nombres: readonly string[], cola: string, tokens: number, motivo: string): string {
  const cola_ = [cola, tokens > 0 ? `${tokens} tokens` : '', motivo].filter(Boolean).join(' · ')
  if (!hechas) return `ningún informe nuevo · ${cola_}`.slice(0, 480)
  const cabeza = `${hechas} ${hechas === 1 ? 'informe' : 'informes'}`
  const hueco = 480 - cabeza.length - cola_.length - 6
  let lista = nombres.join(', ')
  if (lista.length > hueco) lista = hueco > 1 ? lista.slice(0, hueco - 1) + '…' : ''
  return `${cabeza}${lista ? ` (${lista})` : ''} · ${cola_}`.slice(0, 480)
}

/** Los leads de la cola que ya tienen informe */
async function yaHechos(s: SupabaseClient): Promise<Set<string>> {
  const hechos = new Set<string>()
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await s.from('cold_leads').select('id').not('analisis_amazon_at', 'is', null).range(desde, desde + 999)
    if (error) throw error
    for (const f of data ?? []) hechos.add((f as { id: string }).id)
    if (!data || data.length < 1000) break
  }
  return hechos
}

export type ResultadoDePasada = { hechos: number; tokens: number; pendientes: number; resumen: string }

type Tarea = { tipo: 'amazon'; v: EnCola } | { tipo: 'sin'; v: EnColaSinAmazon }
type Hecho = { ok: true; nombre: string } | { ok: false; saltar?: string; parar?: string }

async function hacerAmazon(s: SupabaseClient, clave: string, v: EnCola, clientes: Clientes): Promise<Hecho & { tokens: number }> {
  if (esCliente(clientes, { seller: v.seller, nombres: [v.tienda] })) return { ok: false, saltar: 'es cliente nuestro', tokens: 0 }
  const e = await estudiarVendedor(clave, v.seller)
  if (e.sinDatos) return { ok: false, saltar: 'sin datos en Keepa', tokens: e.gastado }
  const informe = construirAnalisis({ vendedorEs: e.vendedorEs, paises: e.paises, productos: e.productos, competencia: e.competencia, fecha: e.productos.fecha })
  const r = await guardarAnalisis(s, v, informe, e.productos.fecha)
  if (!r.ok) {
    if (falta303(r.error)) return { ok: false, parar: 'falta la migración 303', tokens: e.gastado }
    if (r.error.code === '23503') return { ok: false, saltar: 'el lead ya no existe', tokens: e.gastado }
    throw new Error(`no se ha podido guardar: ${r.error.message}`)
  }
  return { ok: true, nombre: v.tienda, tokens: e.gastado }
}

export async function hacerSinAmazon(s: SupabaseClient, clave: string, v: EnColaSinAmazon, clientes: Clientes, comercialId: string | null): Promise<Hecho & { tokens: number }> {
  const { data: lead, error } = await s.from('cold_leads').select('id, store_name, web, cif, company, vende_en_amazon, seller_url').eq('id', v.lead).maybeSingle()
  if (error) throw error
  const l = lead as { store_name: string | null; web: string | null; cif: string | null; company: string | null; vende_en_amazon: string | null; seller_url: string | null } | null
  if (!l) return { ok: false, saltar: 'el lead ya no existe', tokens: 0 }
  if (esCliente(clientes, { nombres: [l.store_name, l.company, v.tienda], web: l.web ?? v.web })) return { ok: false, saltar: 'es cliente nuestro', tokens: 0 }
  if (l.vende_en_amazon === 'vende' || l.seller_url) return { ok: false, saltar: 'ya vende en Amazon', tokens: 0 }
  const web = l.web ?? v.web
  const catalogo = web ? await leerCatalogo(web) : null
  if (!catalogo) return { ok: false, saltar: 'su web no contesta', tokens: 0 }
  const nombre = l.store_name ?? v.tienda
  const datos = { nombre, web: catalogo.origen, cif: l.cif, empresa: l.company }
  const plan = await planDeEstudio(datos, catalogo)
  if (!plan.marcas.length && !plan.busquedas.length) return { ok: false, saltar: 'no se sabe qué vende', tokens: 0 }
  const e = await estudiarTienda(clave, datos, plan, catalogo.productos.map((p) => p.titulo))

  if (e.propio) {
    // Es vendedor de Amazon: se marca y pasa al principio de la cola del informe de Amazon
    await s.from('cold_leads').update({ vende_en_amazon: 'vende', seller_url: `https://www.amazon.es/sp?seller=${e.propio.sellerId}` }).eq('id', v.lead)
    const cola = await leerJson<EnCola[]>(s, 'cola.json', [])
    if (!cola.some((c) => c.lead === v.lead)) await escribirJson(s, 'cola.json', [{ lead: v.lead, seller: e.propio.sellerId, tienda: nombre, comercial: v.comercial, ...(comercialId ? { comercialId } : {}) }, ...cola])
    return { ok: false, saltar: `vende en Amazon como ${e.propio.nombre} (por ${e.propio.por}): pasa a la cola de Amazon`, tokens: e.gastado }
  }
  if (!e.marca.productos.length && !e.mercados.length) return { ok: false, saltar: 'nada comparable en Amazon', tokens: e.gastado }

  const informe = construirSinAmazon(e, { nombre, web: catalogo.origen, productosWeb: catalogo.productos.length, cif: l.cif, empresa: l.company })
  const r = await guardarAnalisis(s, { lead: v.lead, seller: SELLER_SIN_AMAZON }, informe, e.fecha)
  if (!r.ok) {
    if (falta303(r.error)) return { ok: false, parar: 'falta la migración 303', tokens: e.gastado }
    if (r.error.code === '23503') return { ok: false, saltar: 'el lead ya no existe', tokens: e.gastado }
    throw new Error(`no se ha podido guardar: ${r.error.message}`)
  }
  return { ok: true, nombre: `${nombre} (sin Amazon)`, tokens: e.gastado }
}

export async function pasadaDeRecogida(): Promise<ResultadoDePasada> {
  const nada = (resumen: string, pendientes = 0, tokens = 0): ResultadoDePasada => ({ hechos: 0, tokens, pendientes, resumen })
  const clave = (process.env.KEEPA_KEY ?? '').trim()
  if (!clave) return nada('falta KEEPA_KEY en el entorno del servidor')
  if (enMarcha) return nada('ya hay una pasada en marcha')
  enMarcha = true
  try {
    // El saldo primero (no gasta): si no llega para lo que toca, no se leen las colas ni los hechos
    let saldo: Saldo | null = await saldoKeepa(clave)
    if (saldo.tokens < necesitaLoSiguiente) return nada(`ningún informe nuevo · esperando saldo de Keepa (${saldo.tokens}/${necesitaLoSiguiente})`)

    const s = createServiceClient()
    const [cola, colaSin, saltados, hechos, clientes, gente, ultimos, bitacora, prioridad] = await Promise.all([
      leerJson<EnCola[]>(s, 'cola.json', []),
      leerJson<EnColaSinAmazon[]>(s, 'cola-sin-amazon.json', []),
      leerJson<Record<string, string>>(s, 'saltados.json', {}),
      yaHechos(s),
      clientesActuales(s),
      perfiles(s),
      ultimosInformes(s),
      // La bitácora (~2 MB) solo se baja en las pasadas con saldo: de ella sale el turno, con el comercial de la cola
      leerJson<EventoDeBitacora[]>(s, 'bitacora.json', []).catch(() => [] as EventoDeBitacora[]),
      // prioridad.json: ids de leads (en orden) que se hacen ANTES que el turno, sin consumirlo. Se vacía solo según se hacen (17 nov 2026)
      leerJson<string[]>(s, 'prioridad.json', []).catch(() => [] as string[]),
    ])
    if (!cola.length && !colaSin.length) return nada('no hay cola (cola.json en Storage)')
    const pendientesTodas = cola.filter((v) => !hechos.has(v.lead) && !saltados[v.seller])
    const pendientesSinTodas = colaSin.filter((v) => !hechos.has(v.lead) && !saltados[`lead:${v.lead}`])
    // Los prioritarios salen del reparto normal y van delante, en el orden de prioridad.json
    const ordenPrio = new Map((Array.isArray(prioridad) ? prioridad : []).map((id, i) => [id, i] as const))
    const prioritarios: Tarea[] = [
      ...pendientesTodas.filter((v) => ordenPrio.has(v.lead)).map((v): Tarea => ({ tipo: 'amazon', v })),
      ...pendientesSinTodas.filter((v) => ordenPrio.has(v.lead)).map((v): Tarea => ({ tipo: 'sin', v })),
    ].sort((a, b) => (ordenPrio.get(a.v.lead) ?? 0) - (ordenPrio.get(b.v.lead) ?? 0))
    const pendientes = pendientesTodas.filter((v) => !ordenPrio.has(v.lead))
    const pendientesSin = pendientesSinTodas.filter((v) => !ordenPrio.has(v.lead))
    if (!pendientes.length && !pendientesSin.length && !prioritarios.length) {
      necesitaLoSiguiente = TOKENS_POR_TIENDA
      return nada('cola terminada')
    }

    const totalAlEmpezar = pendientes.length + pendientesSin.length + prioritarios.length
    const porNombre = idPorNombre(gente)
    const comercialIdDe = (v: EnCola | EnColaSinAmazon) => comercialDe(v, porNombre)
    const reparto = new Repartidor<EnCola, EnColaSinAmazon>(pendientes, pendientesSin, comercialIdDe)
    let turno = estadoDelTurno(hechosDelTurno(Array.isArray(bitacora) ? bitacora : [], ultimos, INFORMES_PARA_EL_TURNO))

    const fin = Date.now() + MINUTOS_POR_PASADA * 60_000
    let hechas = 0
    let tokens = 0
    let saltadosNuevos = false
    const nombres: string[] = []
    const eventos: EventoDeBitacora[] = []
    let motivoDeParar = ''

    const apuntar = (tarea: Tarea, comercialId: string | null, resultado: EventoDeBitacora['resultado'], gastado: number, motivo?: string) =>
      eventos.push({ at: new Date().toISOString(), tipo: tarea.tipo, lead: tarea.v.lead, tienda: tarea.v.tienda, comercialId, resultado, ...(motivo ? { motivo: motivo.slice(0, 200) } : {}), tokens: gastado })

    const guardarLoApuntado = async () => {
      if (saltadosNuevos) await escribirJson(s, 'saltados.json', saltados)
      await apuntarEnBitacora(s, eventos)
    }

    while (Date.now() < fin) {
      const prio = prioritarios[0]
      const eleccion = prio ? null : reparto.siguiente(turno)
      if (!prio && !eleccion) break
      const tarea: Tarea = prio ?? (eleccion!.tipo === 'amazon' ? { tipo: 'amazon', v: eleccion!.v as EnCola } : { tipo: 'sin', v: eleccion!.v as EnColaSinAmazon })
      const necesita = costeDe(tarea.tipo)
      // El primer saldo es el de hace un momento; luego se vuelve a preguntar antes de cada tienda
      const ahora = saldo ?? (await saldoKeepa(clave))
      saldo = null
      if (ahora.tokens < necesita) {
        // Le toca a este: se espera a tener saldo para él (no se cuela otro más barato)
        motivoDeParar = `esperando saldo de Keepa (${ahora.tokens}/${necesita})`
        break
      }
      const llave = tarea.tipo === 'amazon' ? tarea.v.seller : `lead:${tarea.v.lead}`
      const comercialId = comercialIdDe(tarea.v)
      if (prio) prioritarios.shift()
      else reparto.quitar(eleccion!)
      try {
        const r = tarea.tipo === 'amazon' ? await hacerAmazon(s, clave, tarea.v, clientes) : await hacerSinAmazon(s, clave, tarea.v, clientes, comercialId)
        tokens += r.tokens
        if (r.ok) {
          fallos.delete(llave)
          hechas++
          nombres.push(r.nombre)
          if (eleccion) turno = trasHecho(turno, eleccion)
          apuntar(tarea, comercialId, 'hecho', r.tokens)
        } else if (r.parar) {
          await guardarLoApuntado()
          return nada(r.parar, totalAlEmpezar - hechas, tokens)
        } else if (r.saltar) {
          // Un saltado no consume el turno: el mismo comercial sigue con su siguiente
          saltados[llave] = r.saltar.slice(0, 200)
          saltadosNuevos = true
          apuntar(tarea, comercialId, 'saltado', r.tokens, r.saltar)
        }
      } catch (e) {
        if (e instanceof SinTokens) {
          motivoDeParar = 'Keepa se ha quedado sin saldo a mitad de tienda (se repite en la próxima)'
          break
        }
        const n = (fallos.get(llave) ?? 0) + 1
        fallos.set(llave, n)
        const mensaje = (e as Error).message
        console.warn(`[analisis-keepa] ${tarea.v.tienda}: ${mensaje} (intento ${n})`)
        apuntar(tarea, comercialId, 'fallo', 0, `${mensaje} (intento ${n})`)
        if (n >= INTENTOS_ANTES_DE_SALTAR) {
          saltados[llave] = `falla: ${mensaje}`.slice(0, 200)
          saltadosNuevos = true
          fallos.delete(llave)
          apuntar(tarea, comercialId, 'saltado', 0, `falla: ${mensaje}`)
        }
        break
      }
    }
    await guardarLoApuntado()

    // Lo que necesitará lo siguiente, para que la próxima pasada sepa sin leer nada si le llega el saldo
    const proxima = prioritarios[0] ?? reparto.siguiente(turno)
    necesitaLoSiguiente = proxima ? costeDe(proxima.tipo) : TOKENS_POR_TIENDA

    const quedan = totalAlEmpezar - hechas
    const resumen = componerResumen(hechas, nombres, `${quedan} en cola (${pendientes.length} de Amazon, ${pendientesSin.length} sin Amazon)`, tokens, motivoDeParar)
    return { hechos: hechas, tokens, pendientes: quedan, resumen }
  } finally {
    enMarcha = false
  }
}
