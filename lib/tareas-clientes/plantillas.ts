import { createServiceClient } from '@/lib/supabase/service'
import { puedeVer, type Permitidos } from './permisos'
import { bloquesValidos, crearTarea, ErrorDeTareas, esUuid, exigirAcceso, personasConAcceso, type Actor, type TareaLigera } from './servidor'
import { cuerpoDesdePlantilla, ocurrenciaPendiente, primeraFecha, recurrenciaValida, sumarDias, titularDesdePlantilla } from './recurrencia'
import { estadosDe, type ClienteTC, type PlantillaTC } from './tipos'

/**
 * LAS PLANTILLAS DE TAREA (migración 276): crear, cambiar, borrar, usar a mano y repetir solas. SOLO SERVIDOR.
 *
 * REPETIR SOLAS: `ejecutarRecurrencias()` la llama cada sesión abierta (al abrir el ERP y cada media hora) y la pasada del cron de Notion. Cada plantilla se «reserva» moviendo
 * `proxima_en` con la condición de que siga valiendo lo que se leyó: si dos sesiones la piden a la vez, solo una gana y la otra se salta esa plantilla (y la restricción única de
 * la tabla de tareas lo impediría aunque fallase). La tarea sale con el día de la ocurrencia, aunque se cree unas horas o días después.
 */

const tope = (v: unknown, largo: number): string | null => (typeof v === 'string' ? v.trim().slice(0, largo) : null)

/** El día de hoy en España, como `AAAA-MM-DD`: a las 23:30 de allí no puede ser ya mañana */
export const hoyEnEspana = (): string => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })

export async function listarPlantillas(clienteId?: string | null, permitidos?: Permitidos): Promise<PlantillaTC[]> {
  if (clienteId) exigirAcceso(permitidos, clienteId)
  const service = createServiceClient()
  let consulta = service.from('tc_plantillas').select('*').order('nombre')
  // Las de ese cliente y las generales
  if (clienteId) consulta = consulta.or(`cliente_id.eq.${clienteId},cliente_id.is.null`)
  const { data, error } = await consulta
  if (error) throw new ErrorDeTareas(`No se han podido leer las plantillas: ${error.message}`, 500)
  // Quien solo ve unos clientes no ve las plantillas de los demás (las generales sí)
  return ((data ?? []) as PlantillaTC[]).filter((p) => puedeVer(permitidos, p.cliente_id))
}

/** Lo que llega del navegador, comprobado: lo que no se reconoce se ignora; lo que está mal falla con el motivo */
export async function guardarPlantilla(actor: Actor, id: string | null, entrada: Record<string, unknown>): Promise<PlantillaTC> {
  const service = createServiceClient()
  const previa = id ? ((await service.from('tc_plantillas').select('*').eq('id', id).maybeSingle()).data as PlantillaTC | null) : null
  if (id && !previa) throw new ErrorDeTareas('Esa plantilla no existe.', 404)
  if (previa) exigirAcceso(actor.clientes, previa.cliente_id)

  const fila: Record<string, unknown> = {}
  if ('nombre' in entrada || !previa) {
    const nombre = tope(entrada.nombre, 120)
    if (!nombre) throw new ErrorDeTareas('La plantilla necesita un nombre.')
    fila.nombre = nombre
  }
  if ('icono' in entrada) fila.icono = entrada.icono ? tope(entrada.icono, 16) : null
  if ('titulo' in entrada) fila.titulo = tope(entrada.titulo, 500) ?? ''
  if ('estado' in entrada) fila.estado = entrada.estado ? tope(entrada.estado, 80) : null
  if ('departamento' in entrada) fila.departamento = entrada.departamento ? tope(entrada.departamento, 80) : null
  if ('responsables' in entrada) {
    if (!Array.isArray(entrada.responsables)) throw new ErrorDeTareas('Los responsables no son una lista.')
    fila.responsables = [...new Set(entrada.responsables.filter(esUuid))]
  }
  if ('dias_para_vencer' in entrada) {
    const n = entrada.dias_para_vencer === null || entrada.dias_para_vencer === '' ? null : Number(entrada.dias_para_vencer)
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 365)) throw new ErrorDeTareas('Los días hasta el vencimiento son un número de 0 a 365.')
    fila.dias_para_vencer = n
  }
  if ('contenido' in entrada) {
    const b = bloquesValidos(entrada.contenido)
    if (!b) throw new ErrorDeTareas('El cuerpo de la plantilla no es válido.')
    fila.contenido = b
  }
  if ('cliente_id' in entrada || !previa) {
    const c = entrada.cliente_id
    if (c !== null && c !== undefined && c !== '' && !esUuid(c)) throw new ErrorDeTareas('Ese cliente no es válido.')
    fila.cliente_id = c ? String(c) : null
  }
  if ('activa' in entrada) fila.activa = entrada.activa === true

  exigirAcceso(actor.clientes, (fila.cliente_id as string | null | undefined) ?? undefined)
  // La repetición: necesita un cliente, y cuando cambia (o se reactiva) se recalcula el día de la próxima
  const rec = 'recurrencia' in entrada ? recurrenciaValida(entrada.recurrencia) : recurrenciaValida(previa?.recurrencia)
  const clienteFinal = ('cliente_id' in fila ? fila.cliente_id : previa?.cliente_id) as string | null
  const activaFinal = ('activa' in fila ? fila.activa : (previa?.activa ?? true)) as boolean
  if (rec.tipo !== 'ninguna' && !clienteFinal) throw new ErrorDeTareas('Una plantilla que se repite tiene que ser de un cliente concreto.')
  if ('recurrencia' in entrada || 'activa' in fila || 'cliente_id' in fila) {
    fila.recurrencia = rec
    const cambio = !previa || JSON.stringify(recurrenciaValida(previa.recurrencia)) !== JSON.stringify(rec) || (activaFinal && !previa.activa) || !previa.proxima_en
    if (rec.tipo === 'ninguna' || !activaFinal) fila.proxima_en = null
    else if (cambio) fila.proxima_en = primeraFecha(rec, hoyEnEspana())
  }

  if (previa) {
    const { data, error } = await service.from('tc_plantillas').update(fila).eq('id', previa.id).select('*').single()
    if (error || !data) throw new ErrorDeTareas(`No se ha podido guardar la plantilla: ${error?.message ?? 'sin respuesta'}`, 500)
    return data as PlantillaTC
  }
  const { data, error } = await service.from('tc_plantillas').insert({ ...fila, creado_por: actor.userId || null }).select('*').single()
  if (error || !data) throw new ErrorDeTareas(`No se ha podido crear la plantilla: ${error?.message ?? 'sin respuesta'}`, 500)
  return data as PlantillaTC
}

export async function borrarPlantilla(id: string, permitidos?: Permitidos): Promise<void> {
  if (permitidos) {
    const { data } = await createServiceClient().from('tc_plantillas').select('cliente_id').eq('id', id).maybeSingle()
    exigirAcceso(permitidos, data?.cliente_id)
  }
  const { error } = await createServiceClient().from('tc_plantillas').delete().eq('id', id)
  if (error) throw new ErrorDeTareas(`No se ha podido borrar la plantilla: ${error.message}`, 500)
}

/** Una tarea nueva con lo de la plantilla. `fecha` es el día que se le pone (hoy si no se dice) */
export async function usarPlantilla(actor: Actor, plantilla: PlantillaTC, clienteId: string, fecha: string = hoyEnEspana(), marcarOrigen = false): Promise<TareaLigera> {
  if (plantilla.cliente_id && plantilla.cliente_id !== clienteId) throw new ErrorDeTareas('Esa plantilla es de otro cliente.')
  exigirAcceso(actor.clientes, clienteId)
  const service = createServiceClient()
  const { data: cliente } = await service.from('tc_clientes').select('*').eq('id', clienteId).maybeSingle()
  if (!cliente) throw new ErrorDeTareas('Ese cliente no existe.', 404)
  const estados = new Set(estadosDe(cliente as ClienteTC).map((e) => e.nombre))
  const conAcceso = new Set((await personasConAcceso()).map((p) => p.id))

  const tarea = await crearTarea(actor, {
    clienteId,
    titulo: titularDesdePlantilla(plantilla.titulo || plantilla.nombre, fecha),
    ...(plantilla.icono ? { icono: plantilla.icono } : {}),
    // Una columna que ese cliente no tenga (la plantilla es general) se ignora: la tarea cae en la primera
    ...(plantilla.estado && estados.has(plantilla.estado) ? { estado: plantilla.estado } : {}),
    ...(plantilla.departamento ? { departamento: plantilla.departamento } : {}),
    responsables: plantilla.responsables.filter((r) => conAcceso.has(r)),
    fecha_inicio: fecha,
    ...(plantilla.dias_para_vencer !== null ? { fecha_fin: sumarDias(fecha, plantilla.dias_para_vencer) } : {}),
    contenido: cuerpoDesdePlantilla((plantilla.contenido ?? []) as Parameters<typeof cuerpoDesdePlantilla>[0]),
  })
  if (marcarOrigen) await service.from('tc_tareas').update({ plantilla_id: plantilla.id, plantilla_fecha: fecha }).eq('id', tarea.id)
  return tarea
}

/** Crea las tareas de las plantillas que ya tocan. Devuelve cuántas ha creado */
export async function ejecutarRecurrencias(): Promise<{ creadas: number; fallidas: number }> {
  const service = createServiceClient()
  const hoy = hoyEnEspana()
  const { data } = await service.from('tc_plantillas').select('*').eq('activa', true).not('cliente_id', 'is', null).not('proxima_en', 'is', null).lte('proxima_en', hoy).limit(50)
  let creadas = 0
  let fallidas = 0
  for (const p of (data ?? []) as PlantillaTC[]) {
    const pendiente = ocurrenciaPendiente(recurrenciaValida(p.recurrencia), p.proxima_en as string, hoy)
    if (!pendiente) continue
    // Reservar: solo gana quien mueva `proxima_en` desde el valor que leyó
    const { data: ganada } = await service.from('tc_plantillas').update({ proxima_en: pendiente.siguiente, ultima_en: new Date().toISOString() }).eq('id', p.id).eq('proxima_en', p.proxima_en as string).select('id')
    if (!ganada || ganada.length === 0) continue
    try {
      await usarPlantilla({ userId: '', nombre: `Plantilla «${p.nombre}»` }, p, p.cliente_id as string, pendiente.ocurrencia, true)
      creadas += 1
    } catch (e) {
      fallidas += 1
      console.error(`No se ha podido crear la tarea de la plantilla «${p.nombre}»:`, e instanceof Error ? e.message : e)
    }
  }
  return { creadas, fallidas }
}
