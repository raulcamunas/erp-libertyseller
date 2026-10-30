import type { SupabaseClient } from '@supabase/supabase-js'
import { diaDeMadrid, instanteDeMadrid } from '@/lib/correo/secuencias/fechas'
import { AVANCE_AUTOMATICO_DE_FASES, decidirAvance, type CambioDelCiclo, type LeadParaElCiclo, type PasoParaElCiclo, type SecuenciaParaElCiclo } from './ciclo-avance'
import { ESTADOS_DE_RITMO } from './ciclo'

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
 * DESDE EL 30 OCT 2026 LAS FASES LAS PULSA LA PERSONA (lib/cold-calling/ciclo-manual.ts) y este proceso corre con el avance automático APAGADO (AVANCE_AUTOMATICO_DE_FASES, en ciclo-avance.ts): ya no mira
 * secuencias, ni leads en Fase 1, ni llamadas de Rinkel. Solo hace lo que no es del comercial y lee lo mínimo: (1) quita la fase a quien ya no está en el ritmo (la IA que cierra por «no me
 * interesa» y la rellamada sola cambian el estado sin pasar por la ficha) y (2) devuelve a Fase 1 a los de «No responde» cuando se cumplen sus 60 días. Los de Fase 2 y Fase 3 que siguen en el ritmo
 * no se leen: no hay nada que decidir por ellos. Lo que sigue sobre secuencias y llamadas describe el modo automático, que se conserva y se comprueba pero está apagado.
 *
 * LEE POCO. No recorre los miles de leads de las listas de ciclo: parte de las secuencias VIVAS (un centenar) y de los leads que ya tienen una fase (los del ritmo). Un lead en Fase 1 sin
 * secuencia no cuesta ni una lectura. Con nada que hacer, una pasada son tres consultas pequeñas. Para saber si ya se ha llamado a los de Fase 2 y 3 que tienen la rellamada vencida, una consulta
 * más a las llamadas salientes de Rinkel de esos pocos leads (rinkel_llamadas se busca por lead, con índice).
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
  /**
   * SOLO CON LAS FASES A MANO. Los leads del ciclo en los que el proceso tiene algo que hacer: los que tienen fase y ya no están en el ritmo (alguien ha hablado con ellos: se les quita la fase) y los de
   * «No responde» a los que ya les llegó su día (vuelven a Fase 1). Los de Fase 2 y 3 que siguen en el ritmo NO salen: los mueve la persona.
   */
  leadsParaElModoManual(hoy: string): Promise<LeadDelCicloFila[]>
  /** Los leads que tienen ahora una secuencia en marcha */
  leadsConSecuenciaViva(): Promise<string[]>
  /** De esos ids, los que están en el ciclo y todavía no tienen fase (Fase 1) */
  leadsEnFase1(ids: readonly string[]): Promise<LeadDelCicloFila[]>
  /** La última secuencia de cada lead, con sus pasos. Los que no tienen ninguna no salen */
  secuenciasDe(ids: readonly string[]): Promise<Map<string, SecuenciaParaElCiclo>>
  /**
   * Las llamadas SALIENTES a esos leads desde esa fecha (el día de la rellamada más antigua): su lead y cuándo. Es lo que dice si «ya se le ha llamado». Sin Rinkel (o sin la tabla) devuelve
   * vacío: entonces nadie avanza por llamada y los leads se quedan donde están hasta que la secuencia de correos acabe.
   */
  llamadasSalientesDesde(ids: readonly string[], desdeIso: string): Promise<Array<{ lead_id: string; fecha: string }>>
  /** Guarda el cambio SOLO si el lead sigue como se leyó, y lo apunta en su historial. Devuelve si lo guardó */
  aplicar(lead: LeadDelCicloFila, campos: CambioDelCiclo['campos'], ahoraIso: string, nota: string): Promise<boolean>
}

export interface OpcionesDelCiclo {
  /** ¿Avanzan las fases solas, según las secuencias de correo y las llamadas? Por defecto, lo que diga AVANCE_AUTOMATICO_DE_FASES (NO desde el 30 oct 2026: las pulsa la persona). Para las pruebas del modo automático */
  avanceAutomatico?: boolean
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
  const automatico = op.avanceAutomatico ?? AVANCE_AUTOMATICO_DE_FASES
  const cambios: ResumenDelCiclo['cambios'] = { fase_2: 0, fase_3: 0, sin_respuesta: 0, otra_vuelta: 0, sale_del_ritmo: 0 }
  const vacio = (extra: Partial<ResumenDelCiclo>): ResumenDelCiclo => ({ revisados: 0, cambios, alVuelo: 0, errores: 0, quedan: false, ensayo, faltaLaMigracion: false, resumen: '', ...extra })

  let conFase: LeadDelCicloFila[]
  try {
    conFase = automatico ? await almacen.leadsConFase(hoy) : await almacen.leadsParaElModoManual(hoy)
  } catch (error) {
    if (faltaLaMigracionDelCiclo(error)) return vacio({ faltaLaMigracion: true, resumen: 'Falta lanzar la migración 264 (ciclo comercial): no se ha tocado nada.' })
    throw error
  }

  let todos: LeadDelCicloFila[]
  const pendientes: Array<{ lead: LeadDelCicloFila; cambio: CambioDelCiclo }> = []
  if (!automatico) {
    // Con las fases a mano no se mira nada más: ni secuencias, ni leads en Fase 1, ni las llamadas de Rinkel. Solo lo que no es del comercial: quitar la fase a quien ya salió del ritmo y devolver a
    // Fase 1 a los de «No responde» a los que ya les llegó su día
    todos = conFase
    for (const lead of todos) {
      const cambio = decidirAvance(lead, null, hoy, { avanceAutomatico: false })
      if (cambio) pendientes.push({ lead, cambio })
    }
  } else {
    const vivas = await almacen.leadsConSecuenciaViva()
    const yaConFase = new Set(conFase.map((l) => l.id))
    const enFase1 = vivas.length > 0 ? await almacen.leadsEnFase1(vivas.filter((id) => !yaConFase.has(id))) : []
    todos = [...conFase, ...enFase1]
    const secuencias = todos.length > 0 ? await almacen.secuenciasDe(todos.map((l) => l.id)) : new Map<string, SecuenciaParaElCiclo>()

    // ¿Se ha llamado ya a los de Fase 2 y 3 a los que les toca (o se les pasó el día)? Pasan de fase al llamar, no al pasar el día: se miran las llamadas salientes desde el día de su rellamada
    const aLlamar = todos.filter((l) => (l.ciclo_fase === 'f2' || l.ciclo_fase === 'f3') && l.next_call_date !== null && l.next_call_date <= hoy)
    const diasDeLlamada = new Map<string, string[]>()
    if (aLlamar.length > 0) {
      const masAntigua = aLlamar.reduce((min, l) => (l.next_call_date! < min ? l.next_call_date! : min), hoy)
      const llamadas = await almacen.llamadasSalientesDesde(aLlamar.map((l) => l.id), new Date(instanteDeMadrid(masAntigua, 0)).toISOString())
      for (const c of llamadas) {
        const ms = Date.parse(c.fecha)
        if (Number.isNaN(ms)) continue
        diasDeLlamada.set(c.lead_id, [...(diasDeLlamada.get(c.lead_id) ?? []), diaDeMadrid(ms)])
      }
    }

    for (const lead of todos) {
      const llamadaHecha = lead.next_call_date !== null && (diasDeLlamada.get(lead.id) ?? []).some((dia) => dia >= lead.next_call_date!)
      const cambio = decidirAvance(lead, secuencias.get(lead.id) ?? null, hoy, { llamadaHecha })
      if (cambio) pendientes.push({ lead, cambio })
    }
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
        const guardado = await almacen.aplicar(lead, cambio.campos, ahoraIso, cambio.nota)
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
  const frase = hechos === 0 && alVuelo === 0 && errores === 0 ? (automatico ? `Nada que mover (${todos.length} leads del ritmo mirados).` : `Nada que mover (fases a mano: ${todos.length} leads mirados).`) :`${ensayo ? 'Haría' : 'Movidos'}: ${partes.join(', ') || 'ninguno'}${alVuelo > 0 ? `; ${alVuelo} tocados por una persona mientras tanto, se rehacen en la siguiente` : ''}${quedan ? '; quedan más para la siguiente pasada' : ''}.`
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

    async leadsParaElModoManual(hoy) {
      const fuera: LeadDelCicloFila[] = []
      for (let tramo = 0; tramo < MAX_TRAMOS; tramo++) {
        const { data, error } = await db
          .from('cold_leads')
          .select(COLUMNAS_DEL_CICLO)
          .not('ciclo_vuelta', 'is', null)
          .not('ciclo_fase', 'is', null)
          // Con fase: o ya no está en el ritmo (se le quita) o es de «No responde» y ya le llegó su día (vuelve a Fase 1). Los de Fase 2 y 3 que siguen en el ritmo no se piden
          .or(`status.not.in.(${ESTADOS_DE_RITMO.join(',')}),and(ciclo_fase.eq.sin_respuesta,next_call_date.lte.${hoy})`)
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

    async llamadasSalientesDesde(ids, desdeIso) {
      const fuera: Array<{ lead_id: string; fecha: string }> = []
      for (const grupo of trozos(ids, GRUPO)) {
        const { data, error } = await db.from('rinkel_llamadas').select('lead_id, fecha').eq('direccion', 'outbound').in('lead_id', grupo).gte('fecha', desdeIso).limit(TRAMO)
        // Sin la tabla (la migración 234) o sin poder leerla, no se avanza por llamada: no se tumba la pasada por esto
        if (error) return fuera
        fuera.push(...((data ?? []) as unknown as Array<{ lead_id: string; fecha: string }>))
      }
      return fuera
    },

    async aplicar(lead, campos, ahoraIso, nota) {
      let consulta = db.from('cold_leads').update({ ...campos, updated_at: ahoraIso }).eq('id', lead.id).eq('status', lead.status).not('ciclo_vuelta', 'is', null)
      consulta = lead.ciclo_fase === null ? consulta.is('ciclo_fase', null) : consulta.eq('ciclo_fase', lead.ciclo_fase)
      const { data, error } = await consulta.select('id')
      if (error) throw error
      const guardado = (data ?? []).length > 0
      // El historial del lead dice cuándo y por qué cambió de fase. Es un apunte: si no se puede escribir, el cambio ya está hecho y no se deshace ni se da por fallido
      if (guardado) {
        try {
          await db.from('cold_lead_notes').insert({ lead_id: lead.id, author_id: null, kind: 'nota', body: nota.slice(0, 8000), occurred_at: ahoraIso, es_respuesta: false })
        } catch {
          // sin apunte
        }
      }
      return guardado
    },
  }
}
