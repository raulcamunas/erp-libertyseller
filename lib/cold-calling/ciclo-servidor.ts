import type { SupabaseClient } from '@supabase/supabase-js'
import { diaDeMadrid } from '@/lib/correo/secuencias/fechas'
import { decidirAvance, type CambioDelCiclo, type LeadParaElCiclo, type PasoParaElCiclo, type SecuenciaParaElCiclo } from './ciclo-avance'

/**
 * EL PROCESO AUTOMÁTICO «CICLO COMERCIAL»: HACE AVANZAR LAS FASES DE LOS LEADS DE LAS LISTAS DE CICLO.
 * =====================================================================================================
 * SOLO SERVIDOR. Se comprueba con ciclo-servidor.prueba.ts, con un almacén en memoria. La regla (cuándo pasa un lead de una fase a otra) está en ciclo-avance.ts y no toca la base; esto
 * solo lee lo que hace falta, se la pasa y guarda lo que decide.
 *
 * VA APARTE DEL MOTOR DE LAS SECUENCIAS, A PROPÓSITO. El motor manda correos reales a nombre de los comerciales y es lo último que se quiere tocar para poner una etiqueta: este proceso solo
 * LEE las secuencias (inscripciones y pasos) y solo ESCRIBE en cold_leads (`ciclo_fase`, `ciclo_vuelta`, la fecha de rellamada y, al acabar el ritmo sin respuesta, «Sin contactar» → «No contesta»).
 * Si falla, los correos siguen saliendo igual.
 *
 * LEE POCO. No recorre los miles de leads de las listas de ciclo: parte de las secuencias VIVAS (un centenar) y de los leads que ya tienen una fase (los del ritmo). Un lead en Fase 1 sin
 * secuencia no cuesta ni una lectura. Con nada que hacer, una pasada son tres consultas pequeñas.
 *
 * ESCRIBE CON CUIDADO. Cada cambio lleva de condición lo que se leyó (el estado y la fase de antes): si una persona cambió el lead mientras tanto, gana ella y el cambio se deja para la pasada
 * siguiente, que lo vuelve a decidir con lo nuevo. Y por tandas con pausa, y con un tope por pasada: cada lead guardado es un aviso del tiempo real a las pantallas abiertas, y a las doce de la
 * noche pasan de fase todos los que salieron el día anterior.
 */

export const COLUMNAS_DEL_CICLO = 'id, status, ciclo_fase, ciclo_vuelta, next_call_date, ccaa, municipio_ine'

export interface LeadDelCicloFila extends LeadParaElCiclo {
  id: string
}

/** Lo que este proceso necesita de la base. Hay una versión con Supabase (abajo) y otra en memoria para las pruebas */
export interface AlmacenDelCiclo {
  /**
   * Los leads del ciclo que ya tienen una fase puesta y algo que mirar hoy: los de Fase 2 y Fase 3, y los de «No responde» SOLO si ya les llegó su día. Los aparcados a dos meses no se leen
   * (con miles, serían decenas de consultas cada pasada sin nada que decidir).
   */
  leadsConFase(hoy: string): Promise<LeadDelCicloFila[]>
  /** Los leads que tienen ahora una secuencia en marcha */
  leadsConSecuenciaViva(): Promise<string[]>
  /** De esos ids, los que están en el ciclo y todavía no tienen fase (Fase 1) */
  leadsEnFase1(ids: readonly string[]): Promise<LeadDelCicloFila[]>
  /** La última secuencia de cada lead, con sus pasos. Los que no tienen ninguna no salen */
  secuenciasDe(ids: readonly string[]): Promise<Map<string, SecuenciaParaElCiclo>>
  /** Guarda el cambio SOLO si el lead sigue como se leyó. Devuelve si lo guardó */
  aplicar(lead: LeadDelCicloFila, campos: CambioDelCiclo['campos'], ahoraIso: string): Promise<boolean>
}

export interface OpcionesDelCiclo {
  /** Para las pruebas: el reloj */
  ahora?: () => number
  /** Sin guardar nada: dice lo que haría. Sirve para mirar antes de encender nada */
  ensayo?: boolean
  /** Cuántos cambios como máximo por pasada. Por defecto 300; los que sobren se hacen en la siguiente */
  tope?: number
  /** Pausa entre cambios, en milisegundos. Por defecto 40 */
  pausaMs?: number
  esperar?: (ms: number) => Promise<void>
}

export interface ResumenDelCiclo {
  /** Leads mirados en esta pasada */
  revisados: number
  cambios: Record<CambioDelCiclo['motivo'], number>
  /** Cambios que no se guardaron porque una persona había tocado el lead mientras tanto: se rehacen en la siguiente pasada */
  alVuelo: number
  /** Cambios que la base ha rechazado (un fallo de verdad, no una carrera). El resto de la pasada sí se hace, y al final la pasada sale en rojo en Sistema */
  errores: number
  /** true si se paró por el tope y todavía quedan cambios por hacer */
  quedan: boolean
  ensayo: boolean
  /** La base todavía no tiene la migración 264: no se ha tocado nada */
  faltaLaMigracion: boolean
  /** Una frase para Sistema */
  resumen: string
}

const MOTIVOS: Array<[CambioDelCiclo['motivo'], string]> = [
  ['fase_2', 'a Fase 2'],
  ['fase_3', 'a Fase 3'],
  ['sin_respuesta', 'a «No responde»'],
  ['otra_vuelta', 'a otra vuelta'],
  ['sale_del_ritmo', 'sin fase (ya se ha hablado con ellos)'],
]

/** ¿La base no tiene las columnas (o la tabla) de esa migración? Nada que hacer todavía */
export function faltaLaMigracionDelCiclo(error: unknown): boolean {
  const codigo = (error as { code?: unknown } | null)?.code
  return codigo === '42703' || codigo === 'PGRST204' || codigo === 'PGRST205' || codigo === '42P01'
}

export async function avanzarElCiclo(almacen: AlmacenDelCiclo, op: OpcionesDelCiclo = {}): Promise<ResumenDelCiclo> {
  const ahora = (op.ahora ?? Date.now)()
  const hoy = diaDeMadrid(ahora)
  const tope = op.tope ?? 300
  const pausaMs = op.pausaMs ?? 40
  const esperar = op.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const ensayo = op.ensayo ?? false
  const cambios: ResumenDelCiclo['cambios'] = { fase_2: 0, fase_3: 0, sin_respuesta: 0, otra_vuelta: 0, sale_del_ritmo: 0 }
  const vacio = (extra: Partial<ResumenDelCiclo>): ResumenDelCiclo => ({ revisados: 0, cambios, alVuelo: 0, errores: 0, quedan: false, ensayo, faltaLaMigracion: false, resumen: '', ...extra })

  let conFase: LeadDelCicloFila[]
  try {
    conFase = await almacen.leadsConFase(hoy)
  } catch (error) {
    if (faltaLaMigracionDelCiclo(error)) return vacio({ faltaLaMigracion: true, resumen: 'Falta lanzar la migración 264 (ciclo comercial): no se ha tocado nada.' })
    throw error
  }
  const vivas = await almacen.leadsConSecuenciaViva()
  const yaConFase = new Set(conFase.map((l) => l.id))
  const enFase1 = vivas.length > 0 ? await almacen.leadsEnFase1(vivas.filter((id) => !yaConFase.has(id))) : []
  const todos = [...conFase, ...enFase1]
  const secuencias = todos.length > 0 ? await almacen.secuenciasDe(todos.map((l) => l.id)) : new Map<string, SecuenciaParaElCiclo>()

  const pendientes: Array<{ lead: LeadDelCicloFila; cambio: CambioDelCiclo }> = []
  for (const lead of todos) {
    const cambio = decidirAvance(lead, secuencias.get(lead.id) ?? null, hoy)
    if (cambio) pendientes.push({ lead, cambio })
  }

  const ahoraIso = new Date(ahora).toISOString()
  let alVuelo = 0
  let hechos = 0
  let errores = 0
  let primerError = ''
  for (const { lead, cambio } of pendientes.slice(0, tope)) {
    if (!ensayo) {
      // Un lead que la base rechaza no puede dejar parados a todos los demás en cada pasada: se cuenta, se sigue, y al final la pasada lo dice en rojo
      try {
        const guardado = await almacen.aplicar(lead, cambio.campos, ahoraIso)
        if (!guardado) {
          alVuelo++
          continue
        }
      } catch (error) {
        errores++
        if (!primerError) primerError = (error as { message?: string } | null)?.message ?? String(error)
        continue
      }
      if (pausaMs > 0) await esperar(pausaMs)
    }
    cambios[cambio.motivo]++
    hechos++
  }

  const quedan = pendientes.length > tope
  const partes = MOTIVOS.filter(([m]) => cambios[m] > 0).map(([m, texto]) => `${cambios[m]} ${texto}`)
  const frase = hechos === 0 && alVuelo === 0 && errores === 0 ? `Nada que mover (${todos.length} leads del ritmo mirados).` : `${ensayo ? 'Haría' : 'Movidos'}: ${partes.join(', ') || 'ninguno'}${alVuelo > 0 ? `; ${alVuelo} tocados por una persona mientras tanto, se rehacen en la siguiente` : ''}${quedan ? '; quedan más para la siguiente pasada' : ''}.`
  // Lo demás ya está guardado: se avisa DESPUÉS, para que Sistema ponga la pasada en rojo sin haber dejado parado a nadie
  if (errores > 0) throw new Error(`Ciclo comercial: ${errores} cambio${errores === 1 ? '' : 's'} no se ha${errores === 1 ? '' : 'n'} podido guardar (${primerError.slice(0, 160)}). ${frase}`)
  return vacio({ revisados: todos.length, alVuelo, quedan, resumen: frase })
}

/* ------------------------------------------------------------------ */
/* El almacén de verdad: Supabase con la clave de servicio             */
/* ------------------------------------------------------------------ */

type Servicio = Pick<SupabaseClient, 'from'>

const TRAMO = 1000
/** Cuántos ids caben en un `in (...)` sin pasarse de largo en la dirección */
const GRUPO = 80
const MAX_TRAMOS = 30

function trozos<T>(lista: readonly T[], tamano: number): T[][] {
  const fuera: T[][] = []
  for (let i = 0; i < lista.length; i += tamano) fuera.push(lista.slice(i, i + tamano))
  return fuera
}

export function almacenDeSupabase(db: Servicio): AlmacenDelCiclo {
  return {
    async leadsConFase(hoy) {
      const fuera: LeadDelCicloFila[] = []
      for (let tramo = 0; tramo < MAX_TRAMOS; tramo++) {
        const { data, error } = await db
          .from('cold_leads')
          .select(COLUMNAS_DEL_CICLO)
          .not('ciclo_vuelta', 'is', null)
          .not('ciclo_fase', 'is', null)
          .or(`ciclo_fase.neq.sin_respuesta,next_call_date.lte.${hoy}`)
          .order('id', { ascending: true })
          .range(tramo * TRAMO, tramo * TRAMO + TRAMO - 1)
        if (error) throw error
        const filas = (data ?? []) as unknown as LeadDelCicloFila[]
        fuera.push(...filas)
        if (filas.length < TRAMO) break
      }
      return fuera
    },

    async leadsConSecuenciaViva() {
      const ids = new Set<string>()
      for (let tramo = 0; tramo < MAX_TRAMOS; tramo++) {
        const { data, error } = await db.from('correo_secuencia_inscripciones').select('lead_id').eq('estado', 'activa').order('id', { ascending: true }).range(tramo * TRAMO, tramo * TRAMO + TRAMO - 1)
        if (error) throw error
        const filas = (data ?? []) as unknown as Array<{ lead_id: string | null }>
        for (const f of filas) if (f.lead_id) ids.add(f.lead_id)
        if (filas.length < TRAMO) break
      }
      return [...ids]
    },

    async leadsEnFase1(ids) {
      const fuera: LeadDelCicloFila[] = []
      for (const grupo of trozos(ids, GRUPO)) {
        const { data, error } = await db.from('cold_leads').select(COLUMNAS_DEL_CICLO).not('ciclo_vuelta', 'is', null).is('ciclo_fase', null).in('id', grupo)
        if (error) throw error
        fuera.push(...((data ?? []) as unknown as LeadDelCicloFila[]))
      }
      return fuera
    },

    async secuenciasDe(ids) {
      const porLead = new Map<string, { id: string; estado: string }>()
      for (const grupo of trozos(ids, GRUPO)) {
        // La última de cada lead: el orden por creación, de la más nueva a la más vieja, y la primera que sale de cada uno
        const { data, error } = await db.from('correo_secuencia_inscripciones').select('id, lead_id, estado, creada_at').in('lead_id', grupo).order('creada_at', { ascending: false })
        if (error) throw error
        for (const f of (data ?? []) as unknown as Array<{ id: string; lead_id: string | null; estado: string }>) if (f.lead_id && !porLead.has(f.lead_id)) porLead.set(f.lead_id, { id: f.id, estado: f.estado })
      }
      const pasosDe = new Map<string, PasoParaElCiclo[]>()
      for (const grupo of trozos([...porLead.values()].map((i) => i.id), GRUPO)) {
        const { data, error } = await db.from('correo_secuencia_pasos').select('inscripcion_id, orden, estado, programado_at, enviado_at').in('inscripcion_id', grupo).order('orden', { ascending: true })
        if (error) throw error
        for (const p of (data ?? []) as unknown as Array<PasoParaElCiclo & { inscripcion_id: string }>) {
          const lista = pasosDe.get(p.inscripcion_id) ?? []
          lista.push({ orden: p.orden, estado: p.estado, programado_at: p.programado_at, enviado_at: p.enviado_at })
          pasosDe.set(p.inscripcion_id, lista)
        }
      }
      const fuera = new Map<string, SecuenciaParaElCiclo>()
      for (const [leadId, ins] of porLead) fuera.set(leadId, { estado: ins.estado, pasos: pasosDe.get(ins.id) ?? [] })
      return fuera
    },

    async aplicar(lead, campos, ahoraIso) {
      let consulta = db.from('cold_leads').update({ ...campos, updated_at: ahoraIso }).eq('id', lead.id).eq('status', lead.status).not('ciclo_vuelta', 'is', null)
      consulta = lead.ciclo_fase === null ? consulta.is('ciclo_fase', null) : consulta.eq('ciclo_fase', lead.ciclo_fase)
      const { data, error } = await consulta.select('id')
      if (error) throw error
      return (data ?? []).length > 0
    },
  }
}
