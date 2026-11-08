import OpenAI from 'openai'
import { fusionarNotas, leerDocumento } from '@/lib/crm/gemini/documento'
import { leerCorreoDeGemini } from '@/lib/crm/gemini/correo'
import { ErrorDeGoogle } from '@/lib/crm/gemini/errores-google'
import { fuenteDeGoogleReal, googleEstaConfigurado } from '@/lib/crm/gemini/google'
import { esfuerzoDeIa, modeloDeIa, razona } from '@/lib/ia/modelo'
import { createServiceClient } from '@/lib/supabase/service'
import { costeDeTexto } from '@/lib/transcripcion/precios'
import { filtrarPorCliente, type Permitidos } from './permisos'
import { clienteDeLaReunion, cuentaLaReunion, REUNIONES_DESDE, cuerpoDePropuesta, encargoDeReunion, ESQUEMA_DE_PROPUESTAS, leerPropuestas, limpiarEdicion, type EdicionDeAceptacion, type PropuestaLeida } from './reuniones'
import { avisar, crearTarea, ErrorDeTareas, esUuid, exigirAcceso, personasConAcceso, type Actor, type TareaLigera } from './servidor'
import { departamentosDe, estadosDe, type ClienteTC } from './tipos'

/**
 * LAS TAREAS PROPUESTAS TRAS UNA REUNIÓN (tablas `tc_reuniones` y `tc_propuestas`, migración 279). SOLO SERVIDOR.
 *
 * La pasada (`pasadaDeReuniones`) la lanza la del cron de Notion cada pocos minutos o el botón «Buscar reuniones». Parte de las notas de Gemini que el CRM ya apuntó como
 * «ignoradas» (reuniones que no son de venta) cuyo título lleva el nombre de un cliente de tareas: abre el correo y el documento de esa reunión (solo esas; el resto de reuniones
 * internas no se abre nunca), le pide a la IA las tareas y las guarda como PROPUESTAS. Nada se crea solo: las acepta o las descarta una persona (`aceptarPropuestas`).
 */

const DIAS_ATRAS = 21
const NUEVAS_POR_PASADA = 3
const INTENTOS_MAXIMOS = 3
const ESPERA_ENTRE_PASADAS_MS = 8 * 60_000
let ultimaPasada = 0

const faltaLaMigracion = (e: { message?: string; code?: string } | null | undefined): boolean => Boolean(e && (e.code === '42P01' || /tc_reuniones|tc_propuestas/.test(e.message ?? '')))
const MENSAJE_SIN_MIGRACION = 'Falta lanzar la migración 279 en Supabase para las tareas propuestas de las reuniones.'

export interface ResumenDeReuniones {
  resumen: string
  reuniones: number
  propuestas: number
  costeUsd: number
}

interface FilaDeNota {
  id: string
  titulo: string
  fecha_reunion: string | null
  creada_en: string
  gmail_message_id: string | null
}

/** Pide a la IA las tareas de una reunión. null si no se pudo (y por qué, para apuntarlo) */
async function pedirPropuestas(encargo: { system: string; usuario: string }, departamentos: readonly string[]): Promise<{ propuestas: PropuestaLeida[] | null; aviso: string | null; modelo: string; costeUsd: number }> {
  const modelo = modeloDeIa()
  const clave = process.env.OPENAI_API_KEY?.trim()
  if (!clave) return { propuestas: null, aviso: 'Falta OPENAI_API_KEY en el servidor.', modelo, costeUsd: 0 }
  const control = new AbortController()
  const reloj = setTimeout(() => control.abort(), 120_000)
  try {
    const openai = new OpenAI({ apiKey: clave, maxRetries: 1 })
    const completion = (await openai.chat.completions.create(
      {
        model: modelo,
        max_completion_tokens: 12_000,
        ...(razona(modelo) ? { reasoning_effort: esfuerzoDeIa('low') } : { temperature: 0.2 }),
        response_format: { type: 'json_schema', json_schema: { name: 'propuestas_de_reunion', strict: true, schema: ESQUEMA_DE_PROPUESTAS as unknown as Record<string, unknown> } },
        messages: [
          { role: 'system', content: encargo.system },
          { role: 'user', content: encargo.usuario },
        ],
      } as never,
      { signal: control.signal }
    )) as unknown as { choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
    const costeUsd = completion.usage ? costeDeTexto(modelo, completion.usage.prompt_tokens ?? 0, completion.usage.completion_tokens ?? 0) : 0
    const eleccion = completion.choices?.[0]
    if (eleccion?.message?.refusal) return { propuestas: null, aviso: 'La IA se ha negado a analizar esta reunión.', modelo, costeUsd }
    const propuestas = leerPropuestas(eleccion?.message?.content, departamentos)
    if (!propuestas) return { propuestas: null, aviso: eleccion?.finish_reason === 'length' ? 'La respuesta de la IA se ha cortado.' : 'La IA ha devuelto algo que no se entiende.', modelo, costeUsd }
    return { propuestas, aviso: null, modelo, costeUsd }
  } catch (e) {
    const x = e as { status?: number; code?: string }
    console.error('[tareas-reuniones] fallo de la IA', { estado: x?.status ?? null, codigo: x?.code ?? null })
    return { propuestas: null, aviso: `La IA ha fallado (${x?.status ?? x?.code ?? 'sin respuesta'}).`, modelo, costeUsd: 0 }
  } finally {
    clearTimeout(reloj)
  }
}

export async function pasadaDeReuniones(opciones: { forzar?: boolean } = {}): Promise<ResumenDeReuniones> {
  const vacio = (resumen: string): ResumenDeReuniones => ({ resumen, reuniones: 0, propuestas: 0, costeUsd: 0 })
  if (!opciones.forzar && Date.now() - ultimaPasada < ESPERA_ENTRE_PASADAS_MS) return vacio('reciente')
  ultimaPasada = Date.now()
  if (!googleEstaConfigurado()) return vacio('Google no está configurado en el servidor')

  const service = createServiceClient()
  const { data: previas, error: errorDeLectura } = await service.from('tc_reuniones').select('gmail_message_id, estado, intentos, id').limit(2000)
  if (errorDeLectura) return vacio(faltaLaMigracion(errorDeLectura) ? 'falta la migración 279' : `error: ${errorDeLectura.message}`)
  const yaVistas = new Map(((previas ?? []) as Array<{ gmail_message_id: string | null; estado: string; intentos: number; id: string }>).filter((r) => r.gmail_message_id).map((r) => [r.gmail_message_id as string, r]))

  const { data: clientes } = await service.from('tc_clientes').select('*').eq('activo', true)
  const lista = (clientes ?? []) as ClienteTC[]
  if (lista.length === 0) return vacio('sin clientes')

  const desde = new Date(Date.now() - DIAS_ATRAS * 86_400_000).toISOString()
  const { data: notas } = await service.from('crm_notas_reunion').select('id, titulo, fecha_reunion, creada_en, gmail_message_id').eq('estado', 'ignorada').not('gmail_message_id', 'is', null).gte('creada_en', desde).order('creada_en', { ascending: false }).limit(300)
  const candidatas = ((notas ?? []) as FilaDeNota[])
    .map((n) => ({ n, cliente: clienteDeLaReunion(n.titulo, lista) }))
    .filter((x): x is { n: FilaDeNota; cliente: { id: string; nombre: string } } => Boolean(x.cliente))
    // Solo las reuniones de la fecha de arranque en adelante: lo anterior ya está resuelto
    .filter(({ n }) => cuentaLaReunion(n.fecha_reunion ?? n.creada_en))
    .filter(({ n }) => {
      const previa = yaVistas.get(n.gmail_message_id as string)
      return !previa || (previa.estado === 'pendiente' && previa.intentos < INTENTOS_MAXIMOS)
    })
    .sort((a, b) => (a.n.fecha_reunion ?? a.n.creada_en).localeCompare(b.n.fecha_reunion ?? b.n.creada_en))
    .slice(0, NUEVAS_POR_PASADA)

  if (candidatas.length === 0) return vacio('nada nuevo')
  const google = fuenteDeGoogleReal()
  const resultado: ResumenDeReuniones = { resumen: '', reuniones: 0, propuestas: 0, costeUsd: 0 }
  const avisos: string[] = []

  for (const { n, cliente } of candidatas) {
    const idCorreo = n.gmail_message_id as string
    try {
      const correo = await google.leerCorreo(idCorreo)
      let nota = correo ? leerCorreoDeGemini(correo) : null
      if (!nota) {
        avisos.push(`«${n.titulo}»: correo ilegible`)
        continue
      }
      if (nota.driveFileId) {
        try {
          const delDoc = leerDocumento(await google.leerDocumento(nota.driveFileId), nota.driveFileId)
          if (delDoc) nota = fusionarNotas(nota, delDoc)
        } catch (e) {
          if (e instanceof ErrorDeGoogle && e.esGeneral) throw e
        }
      }
      const completo = cliente && lista.find((c) => c.id === cliente.id)
      if (!completo) continue
      const departamentos = departamentosDe(completo).map((d) => d.nombre)
      const fecha = nota.fechaReunion ?? n.fecha_reunion ?? n.creada_en
      const encargo = encargoDeReunion({ cliente: completo.nombre, titulo: n.titulo, fecha, resumen: nota.resumen, proximosPasos: nota.proximosPasos.map((p) => (typeof p === 'string' ? p : (p as { texto?: string }).texto ?? '')).filter(Boolean), detalle: nota.detalle, departamentos })

      const previa = yaVistas.get(idCorreo)
      let reunionId = previa?.id
      if (!reunionId) {
        const { data, error } = await service.from('tc_reuniones').insert({ cliente_id: completo.id, gmail_message_id: idCorreo, drive_file_id: nota.driveFileId, titulo: n.titulo, fecha_reunion: fecha, resumen: nota.resumen }).select('id').single()
        if (error || !data) {
          avisos.push(`«${n.titulo}»: no se pudo apuntar (${error?.message ?? 'sin respuesta'})`)
          continue
        }
        reunionId = (data as { id: string }).id
      }

      const r = await pedirPropuestas(encargo, departamentos)
      resultado.costeUsd += r.costeUsd
      if (!r.propuestas) {
        const intentos = (previa?.intentos ?? 0) + 1
        await service.from('tc_reuniones').update({ intentos, error: r.aviso, estado: intentos >= INTENTOS_MAXIMOS ? 'error' : 'pendiente', modelo: r.modelo, coste_usd: r.costeUsd }).eq('id', reunionId)
        avisos.push(`«${n.titulo}»: ${r.aviso}`)
        continue
      }
      if (r.propuestas.length > 0) {
        await service.from('tc_propuestas').insert(r.propuestas.map((p, i) => ({ reunion_id: reunionId, cliente_id: completo.id, titulo: p.titulo, columna: p.columna, departamento: p.departamento, subtareas: p.subtareas, contexto: p.contexto, orden: i })))
      }
      await service.from('tc_reuniones').update({ estado: r.propuestas.length > 0 ? 'analizada' : 'sin_propuestas', error: null, modelo: r.modelo, coste_usd: r.costeUsd, analizada_en: new Date().toISOString(), intentos: (previa?.intentos ?? 0) + 1 }).eq('id', reunionId)
      // La campana de quien ve a ese cliente: hay tareas por elegir
      if (r.propuestas.length > 0) {
        const gente = await personasConAcceso(completo.id).catch(() => [])
        await avisar(gente.map((g) => ({ userId: g.id, tipo: 'task_updated' as const, titulo: `Tareas propuestas · ${completo.nombre}`, mensaje: `${r.propuestas?.length} tareas salen de «${n.titulo}». Elige las buenas.`, clave: `tc:reunion:${reunionId}:${g.id}`, clienteId: completo.id, tareaId: null })))
      }
      resultado.reuniones += 1
      resultado.propuestas += r.propuestas.length
    } catch (e) {
      if (e instanceof ErrorDeGoogle && e.esGeneral) {
        avisos.push(`Google: ${e.message}`)
        break
      }
      avisos.push(`«${n.titulo}»: ${e instanceof Error ? e.message : 'error'}`)
    }
  }
  resultado.resumen = `${resultado.reuniones} reuniones · ${resultado.propuestas} propuestas${avisos.length ? ` · ${avisos.join(' | ')}` : ''}`
  return resultado
}

/* ------------------------------------------------------------------ */
/* Lo que ve y decide el equipo                                        */
/* ------------------------------------------------------------------ */

export interface PropuestaDeReunion {
  id: string
  titulo: string
  columna: 'En progreso' | 'Backlog'
  departamento: string | null
  subtareas: string[]
  contexto: string
}

export interface ReunionConPropuestas {
  id: string
  titulo: string
  fecha_reunion: string | null
  propuestas: PropuestaDeReunion[]
}

export async function propuestasDeUnCliente(clienteId: string, permitidos: Permitidos): Promise<{ disponible: boolean; reuniones: ReunionConPropuestas[] }> {
  exigirAcceso(permitidos, clienteId)
  const service = createServiceClient()
  const { data, error } = await service.from('tc_propuestas').select('id, reunion_id, titulo, columna, departamento, subtareas, contexto, orden').eq('cliente_id', clienteId).eq('estado', 'pendiente').order('orden').limit(300)
  if (error) {
    if (faltaLaMigracion(error)) return { disponible: false, reuniones: [] }
    throw new ErrorDeTareas(`No se han podido leer las propuestas: ${error.message}`, 500)
  }
  const filas = (data ?? []) as Array<PropuestaDeReunion & { reunion_id: string }>
  if (filas.length === 0) return { disponible: true, reuniones: [] }
  const { data: reuniones } = await service.from('tc_reuniones').select('id, titulo, fecha_reunion').in('id', [...new Set(filas.map((f) => f.reunion_id))]).order('fecha_reunion', { ascending: false })
  return {
    disponible: true,
    reuniones: ((reuniones ?? []) as Array<{ id: string; titulo: string; fecha_reunion: string | null }>).filter((r) => cuentaLaReunion(r.fecha_reunion)).map((r) => ({ ...r, propuestas: filas.filter((f) => f.reunion_id === r.id).map(({ reunion_id: _r, ...p }) => (void _r, { ...p, subtareas: Array.isArray(p.subtareas) ? p.subtareas : [] })) })),
  }
}

/** Cuántas propuestas pendientes hay por cliente (para el aviso de la barra lateral y para abrir la ventana al entrar) */
export async function contarPropuestas(permitidos: Permitidos): Promise<Record<string, number>> {
  const { data, error } = await createServiceClient().from('tc_propuestas').select('cliente_id, tc_reuniones!inner(fecha_reunion)').eq('estado', 'pendiente').gte('tc_reuniones.fecha_reunion', REUNIONES_DESDE).limit(5000)
  if (error) return {}
  const visibles = filtrarPorCliente((data ?? []) as unknown as Array<{ cliente_id: string }>, permitidos, (p) => p.cliente_id)
  const cuenta: Record<string, number> = {}
  for (const p of visibles) cuenta[p.cliente_id] = (cuenta[p.cliente_id] ?? 0) + 1
  return cuenta
}

export interface ResultadoDeDecision {
  creadas: TareaLigera[]
  descartadas: number
  fallos: string[]
}

/**
 * Acepta las propuestas indicadas (con lo que se haya cambiado en cada una) y descarta las de `descartar`. Cada propuesta se «reserva» antes de crear su tarea
 * (pendiente → aceptada solo si seguía pendiente): si dos personas deciden a la vez, la tarea sale una sola vez. Si crear la tarea falla, la propuesta vuelve a pendiente.
 */
export async function decidirPropuestas(actor: Actor, clienteId: string, aceptar: readonly EdicionDeAceptacion[], descartar: readonly string[]): Promise<ResultadoDeDecision> {
  exigirAcceso(actor.clientes, clienteId)
  if (!esUuid(clienteId)) throw new ErrorDeTareas('Ese cliente no existe.', 404)
  const service = createServiceClient()
  const { data: cliente } = await service.from('tc_clientes').select('*').eq('id', clienteId).maybeSingle()
  if (!cliente) throw new ErrorDeTareas('Ese cliente no existe.', 404)
  const estados = estadosDe(cliente as ClienteTC)
  const columnas = estados.map((e) => e.nombre)
  const departamentos = departamentosDe(cliente as ClienteTC).map((d) => d.nombre)
  const cuando = new Date().toISOString()
  const resultado: ResultadoDeDecision = { creadas: [], descartadas: 0, fallos: [] }

  const ids = aceptar.map((a) => a.id).filter(esUuid)
  const { data: filas } = ids.length > 0 ? await service.from('tc_propuestas').select('id, titulo, columna, departamento, subtareas, contexto').eq('cliente_id', clienteId).eq('estado', 'pendiente').in('id', ids) : { data: [] }
  const base = new Map(((filas ?? []) as Array<{ id: string; titulo: string; columna: 'En progreso' | 'Backlog'; departamento: string | null; subtareas: string[]; contexto: string }>).map((f) => [f.id, f]))

  for (const a of aceptar) {
    const original = base.get(a.id)
    if (!original) continue
    const { data: reservada } = await service.from('tc_propuestas').update({ estado: 'aceptada', decidida_por: actor.userId || null, decidida_en: cuando }).eq('id', a.id).eq('estado', 'pendiente').select('id').maybeSingle()
    if (!reservada) continue
    const e = limpiarEdicion(a, { ...original, subtareas: Array.isArray(original.subtareas) ? original.subtareas : [] }, columnas, departamentos)
    // Si el tablero de ese cliente no tiene la columna (p. ej. no se llama «En progreso»), va a la primera en curso o, si no, a la primera
    const estado = columnas.includes(e.columna) ? e.columna : estados.find((x) => x.grupo === 'en_curso')?.nombre ?? columnas[0]
    try {
      const tarea = await crearTarea(actor, { clienteId, titulo: e.titulo, estado, departamento: e.departamento, contenido: cuerpoDePropuesta(e), ...(e.responsables.length > 0 ? { responsables: e.responsables } : {}), ...(e.fecha_inicio ? { fecha_inicio: e.fecha_inicio } : {}) })
      await service.from('tc_propuestas').update({ tarea_id: tarea.id }).eq('id', a.id)
      resultado.creadas.push(tarea)
    } catch (err) {
      await service.from('tc_propuestas').update({ estado: 'pendiente', decidida_por: null, decidida_en: null }).eq('id', a.id)
      resultado.fallos.push(`${e.titulo}: ${err instanceof Error ? err.message : 'no se ha podido crear'}`)
    }
  }

  const aDescartar = descartar.filter(esUuid)
  if (aDescartar.length > 0) {
    const { data: hechas } = await service.from('tc_propuestas').update({ estado: 'descartada', decidida_por: actor.userId || null, decidida_en: cuando }).eq('cliente_id', clienteId).eq('estado', 'pendiente').in('id', aDescartar).select('id')
    resultado.descartadas = (hechas ?? []).length
  }
  return resultado
}
