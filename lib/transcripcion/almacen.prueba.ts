import type { createServiceClient } from '@/lib/supabase/service'
import { FALTA_MIGRACION_TRANSCRIPCION, almacenDeSupabase } from '@/lib/transcripcion/almacen'
import type { LlamadaPendiente } from '@/lib/transcripcion/motor'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LA PARTE QUE HABLA CON SUPABASE, CONTRA UN CLIENTE FALSO QUE APUNTA CADA LLAMADA.
 *
 * No prueba SQL (eso está en la migración 244, probada en un Postgres de verdad): prueba que el código pide la tabla, las columnas y los filtros
 * correctos y que traduce bien lo que vuelve, incluidos los errores.
 */

type Servicio = ReturnType<typeof createServiceClient>
type Llamada = { tabla: string | null; rpc: string | null; cadena: Array<[string, unknown[]]> }
type Respuesta = { data?: unknown; error?: unknown }

function falso(responder: (l: Llamada) => Respuesta): { servicio: Servicio; llamadas: Llamada[] } {
  const llamadas: Llamada[] = []
  const constructor = (tabla: string | null, rpc: string | null, argumentosRpc: unknown[] = []) => {
    const cadena: Array<[string, unknown[]]> = []
    const ejecutar = () => {
      const l: Llamada = { tabla, rpc, cadena: rpc ? [['rpc', argumentosRpc], ...cadena] : cadena }
      llamadas.push(l)
      const r = responder(l)
      return { data: r.data ?? null, error: r.error ?? null }
    }
    const proxy: Record<string, unknown> = {}
    for (const metodo of ['select', 'eq', 'gte', 'lt', 'limit', 'update', 'maybeSingle', 'order', 'in', 'or', 'insert']) {
      proxy[metodo] = (...args: unknown[]) => {
        cadena.push([metodo, args])
        return proxy
      }
    }
    proxy.then = (alResolver: (v: unknown) => unknown, alRechazar?: (e: unknown) => unknown) => Promise.resolve(ejecutar()).then(alResolver, alRechazar)
    return proxy
  }
  const servicio = {
    from: (tabla: string) => constructor(tabla, null),
    rpc: (nombre: string, args: unknown) => constructor(null, nombre, [args]),
  } as unknown as Servicio
  return { servicio, llamadas }
}

const AHORA = Date.parse('2026-10-23T15:00:00Z')
const L: LlamadaPendiente = { id: 'c1', user_id: 'u1', lead_id: 'l1', fecha: '2026-10-23T14:00:00Z', direccion: 'outbound', duracion_s: 60, grabacion_id: 'g1', intentos: 0 }
const cadena = (l: Llamada, metodo: string) => l.cadena.find(([m]) => m === metodo)?.[1]
const hay = (l: Llamada, metodo: string, ...args: unknown[]) => l.cadena.some(([m, a]) => m === metodo && JSON.stringify(a) === JSON.stringify(args))

const run = async () => {
  console.log('\n=== los ajustes ===')
  {
    const f = falso(() => ({ data: { desde: '2026-10-23T15:00:00Z', minimo_segundos: 20, tope_diario_minutos: 400, otra: 'x' } }))
    const a = await almacenDeSupabase(f.servicio, () => AHORA).leerAjustes()
    const l = f.llamadas[0]
    ok('lee la fila única de la tabla de ajustes', l.tabla === 'rinkel_transcripcion_ajustes' && hay(l, 'eq', 'id', true) && hay(l, 'select', 'desde, minimo_segundos, tope_diario_minutos'))
    ok('y devuelve solo los tres campos', JSON.stringify(a) === JSON.stringify({ desde: '2026-10-23T15:00:00Z', minimo_segundos: 20, tope_diario_minutos: 400 }))
  }
  const falla = async (n: string, f: () => Promise<unknown>, cond: (m: string) => boolean) => {
    try {
      await f()
      ok(n, false, 'no ha fallado')
    } catch (e) {
      ok(n, cond((e as Error).message), (e as Error).message)
    }
  }
  await falla('tabla inexistente (migración sin lanzar): dice qué fichero lanzar', () => almacenDeSupabase(falso(() => ({ error: { code: '42P01' } })).servicio).leerAjustes(), (m) => m === FALTA_MIGRACION_TRANSCRIPCION && /244_rinkel_transcripciones/.test(m))
  await falla('tabla fuera de la caché de PostgREST: lo mismo', () => almacenDeSupabase(falso(() => ({ error: { code: 'PGRST205' } })).servicio).leerAjustes(), (m) => m === FALTA_MIGRACION_TRANSCRIPCION)
  await falla('otro error: una frase nuestra, sin el cuerpo', () => almacenDeSupabase(falso(() => ({ error: { code: '500', message: 'secreto interno' } })).servicio).leerAjustes(), (m) => /ajustes de la transcripción/.test(m) && !/secreto/.test(m))
  await falla('sin la fila de ajustes: pide volver a lanzar la migración (no se asume nada)', () => almacenDeSupabase(falso(() => ({ data: null })).servicio).leerAjustes(), (m) => /vuelve a lanzar la migración 244/.test(m))

  console.log('\n=== lo gastado en 24 horas ===')
  {
    const f = falso(() => ({ data: [{ segundos_audio: 60 }, { segundos_audio: null }, { segundos_audio: 125 }] }))
    const s = await almacenDeSupabase(f.servicio, () => AHORA).segundosDeLasUltimas24Horas()
    const l = f.llamadas[0]
    ok('suma los segundos (y salta los nulos)', s === 185)
    ok('desde hace 24 horas exactas, por la columna transcrita_at', hay(l, 'gte', 'transcrita_at', '2026-10-22T15:00:00.000Z') && l.tabla === 'rinkel_transcripciones')
    ok('con tope de filas explícito', hay(l, 'limit', 1000))
  }

  console.log('\n=== cerrar las reservas abandonadas ===')
  {
    const f = falso(() => ({}))
    await almacenDeSupabase(f.servicio, () => AHORA).cerrarAbandonadas()
    const l = f.llamadas[0]
    const cambios = cadena(l, 'update')?.[0] as Record<string, unknown>
    ok('solo las «procesando» con los tres intentos gastados y la reserva muerta (más de 10 min)', hay(l, 'eq', 'estado', 'procesando') && hay(l, 'gte', 'intentos', 3) && hay(l, 'lt', 'bloqueada_at', '2026-10-23T14:50:00.000Z'))
    ok('las deja fallidas y sin turno', cambios.estado === 'fallida' && cambios.siguiente_intento_at === null && cambios.bloqueada_at === null)
  }
  {
    // Que falle esto no tumba la pasada
    const quieto = console.error
    console.error = () => undefined
    await almacenDeSupabase(falso(() => ({ error: { code: 'XX000' } })).servicio).cerrarAbandonadas()
    console.error = quieto
    ok('si no se puede cerrar, no lanza (se hará en la próxima)', true)
  }

  console.log('\n=== qué falta por transcribir ===')
  {
    const filas = [{ id: 'c1', user_id: 'u1', lead_id: 'l1', fecha: 'f', direccion: 'outbound', duracion_s: 60, grabacion_id: 'g1', intentos: 0, sobra: 'x' }]
    const f = falso(() => ({ data: filas }))
    const r = await almacenDeSupabase(f.servicio).pendientes({ desde: '2026-10-23T15:00:00Z', minimo_segundos: 20, tope_diario_minutos: 400 }, 12)
    const l = f.llamadas[0]
    ok('llama a la función con los ajustes, el límite y las reglas de reintento', l.rpc === 'rinkel_transcripciones_pendientes' && JSON.stringify(l.cadena[0][1][0]) === JSON.stringify({ p_desde: '2026-10-23T15:00:00Z', p_minimo: 20, p_limite: 12, p_bloqueo_min: 10, p_max_intentos: 3 }))
    ok('devuelve solo los campos que usa el motor', r.length === 1 && !('sobra' in r[0]) && r[0].grabacion_id === 'g1')
    ok('sin datos, lista vacía', (await almacenDeSupabase(falso(() => ({ data: null })).servicio).pendientes({ desde: 'x', minimo_segundos: 20, tope_diario_minutos: 1 }, 5)).length === 0)
  }
  await falla('función inexistente (PGRST202): dice qué migración lanzar', () => almacenDeSupabase(falso(() => ({ error: { code: 'PGRST202' } })).servicio).pendientes({ desde: 'x', minimo_segundos: 20, tope_diario_minutos: 1 }, 5), (m) => m === FALTA_MIGRACION_TRANSCRIPCION)

  console.log('\n=== reservar una llamada ===')
  {
    const fila = { llamada_id: 'c1', intentos: 2, transcripcion: 'hola', segundos_audio: 61, idioma: 'es', modelo_voz: 'gpt-transcribe', coste_voz_usd: '0.00458', sobra: 1 }
    const f = falso(() => ({ data: [fila] }))
    const r = await almacenDeSupabase(f.servicio).reservar(L)
    ok('llama a la función con la llamada, su dueño y las reglas', f.llamadas[0].rpc === 'rinkel_transcripcion_reclamar' && JSON.stringify(f.llamadas[0].cadena[0][1][0]) === JSON.stringify({ p_llamada: 'c1', p_user: 'u1', p_bloqueo_min: 10, p_max_intentos: 3 }))
    ok('devuelve lo que una pasada anterior dejó hecho (el dinero llega como texto y se lee como número)', r?.intentos === 2 && r.transcripcion === 'hola' && r.segundos_audio === 61 && r.idioma === 'es' && r.modelo_voz === 'gpt-transcribe' && r.coste_voz_usd === 0.00458)
    const nueva = await almacenDeSupabase(falso(() => ({ data: [{ llamada_id: 'c1', intentos: 1, transcripcion: null }] })).servicio).reservar(L)
    ok('una nueva viene sin transcripción', nueva?.intentos === 1 && nueva.transcripcion === null && nueva.segundos_audio === null)
    ok('si no devuelve nada, la llamada es de otro: null', (await almacenDeSupabase(falso(() => ({ data: [] })).servicio).reservar(L)) === null && (await almacenDeSupabase(falso(() => ({ data: null })).servicio).reservar(L)) === null)
  }
  await falla('un error al reservar sale como frase nuestra', () => almacenDeSupabase(falso(() => ({ error: { code: '500' } })).servicio).reservar(L), (m) => /reservar la llamada/.test(m))

  console.log('\n=== el nombre de la tienda y del comercial ===')
  {
    const f = falso((l) => (l.tabla === 'cold_leads' ? { data: { store_name: ' Joe Black Pets ', company: 'JOE BLACK SL' } } : { data: { full_name: ' Maoli García ' } }))
    const c = await almacenDeSupabase(f.servicio).contexto(L)
    ok('pide el lead por su id y el perfil por el dueño de la llamada', f.llamadas.some((l) => l.tabla === 'cold_leads' && hay(l, 'eq', 'id', 'l1')) && f.llamadas.some((l) => l.tabla === 'profiles' && hay(l, 'eq', 'id', 'u1')))
    ok('nombre comercial antes que razón social, sin espacios sobrantes', c.empresa === 'Joe Black Pets' && c.comercial === 'Maoli García')
    const solo = await almacenDeSupabase(falso((l) => (l.tabla === 'cold_leads' ? { data: { store_name: null, company: 'Razón SL' } } : { data: null })).servicio).contexto(L)
    ok('sin nombre comercial vale la razón social; sin perfil, null', solo.empresa === 'Razón SL' && solo.comercial === null)
    const nada = await almacenDeSupabase(falso(() => ({ error: { code: '500' } })).servicio).contexto(L)
    ok('si falla leer los nombres NO falla la llamada (se transcribe con peores pistas)', nada.empresa === null && nada.comercial === null)
  }

  console.log('\n=== guardar ===')
  {
    const f = falso(() => ({}))
    const a = almacenDeSupabase(f.servicio, () => AHORA)
    await a.guardarTranscripcion('c1', { texto: 'hola', idioma: 'es', segundos: 61, modelo: 'gpt-transcribe', costeUsd: 0.0046 })
    const l = f.llamadas[0]
    const p = cadena(l, 'update')?.[0] as Record<string, unknown>
    ok('la transcripción: texto, idioma, segundos, modelo y coste, en la fila de esa llamada', l.tabla === 'rinkel_transcripciones' && hay(l, 'eq', 'llamada_id', 'c1') && p.transcripcion === 'hola' && p.idioma === 'es' && p.segundos_audio === 61 && p.modelo_voz === 'gpt-transcribe' && p.coste_voz_usd === 0.0046 && p.transcrita_at === '2026-10-23T15:00:00.000Z')
    ok('sin tocar el estado (sigue «procesando»)', !('estado' in p))

    await a.guardarResultado('c1', {
      tipo: 'conversacion',
      resumen: 'Resumen',
      linea: [{ quien: 'cliente', texto: 'Dijo que sí.' }],
      siguiente_paso: 'Llamar el jueves',
      interes: 'alto',
      modeloTexto: 'gpt-6-luna',
      costeTextoUsd: 0.0003,
      transcripcion: { texto: 'hola', idioma: 'es', segundos: 61, modelo: 'gpt-transcribe', costeUsd: 0.0046 },
    })
    const r = cadena(f.llamadas[1], 'update')?.[0] as Record<string, unknown>
    ok('el resultado: estado «hecha», limpia el motivo y los turnos', r.estado === 'hecha' && r.motivo === null && r.siguiente_intento_at === null && r.bloqueada_at === null && r.hecha_at === '2026-10-23T15:00:00.000Z')
    ok('con el resumen, la línea (como lista), el paso y el interés', r.resumen === 'Resumen' && JSON.stringify(r.linea) === JSON.stringify([{ quien: 'cliente', texto: 'Dijo que sí.' }]) && r.siguiente_paso === 'Llamar el jueves' && r.interes === 'alto' && r.tipo === 'conversacion')
    ok('y la transcripción otra vez, por si la primera no se pudo guardar', r.transcripcion === 'hola' && r.segundos_audio === 61 && r.coste_voz_usd === 0.0046 && r.modelo_texto === 'gpt-6-luna' && r.coste_texto_usd === 0.0003)
  }
  await falla('un fallo al guardar sale como frase nuestra', () => almacenDeSupabase(falso(() => ({ error: { code: '500' } })).servicio).guardarResultado('c1', { tipo: 'sin_contenido', resumen: null, linea: [], siguiente_paso: null, interes: 'no_claro', modeloTexto: null, costeTextoUsd: 0, transcripcion: { texto: '', idioma: null, segundos: 1, modelo: 'm', costeUsd: 0 } }), (m) => /guardar el resumen/.test(m))

  console.log('\n=== apuntar un fallo ===')
  {
    const f = falso(() => ({}))
    await almacenDeSupabase(f.servicio, () => AHORA).marcarFallo('c1', { estado: 'fallida', motivo: 'x'.repeat(500), siguienteIntentoAt: '2026-10-23T15:03:00.000Z', devolverIntento: false })
    const p = cadena(f.llamadas[0], 'update')?.[0] as Record<string, unknown>
    ok('estado, turno y motivo (recortado a 300), sin reserva', p.estado === 'fallida' && p.siguiente_intento_at === '2026-10-23T15:03:00.000Z' && (p.motivo as string).length === 300 && p.bloqueada_at === null && !('intentos' in p))
  }
  {
    const f = falso((l) => (cadena(l, 'update') ? {} : { data: { intentos: 2 } }))
    await almacenDeSupabase(f.servicio, () => AHORA).marcarFallo('c1', { estado: 'fallida', motivo: 'sin saldo', siguienteIntentoAt: null, devolverIntento: true })
    const actualizacion = f.llamadas.find((l) => cadena(l, 'update'))!
    const p = cadena(actualizacion, 'update')?.[0] as Record<string, unknown>
    ok('si el fallo no es de la llamada, el intento se devuelve (2 -> 1)', p.intentos === 1)
  }
  {
    const f = falso((l) => (cadena(l, 'update') ? {} : { data: { intentos: 0 } }))
    await almacenDeSupabase(f.servicio, () => AHORA).marcarFallo('c1', { estado: 'fallida', motivo: 'x', siguienteIntentoAt: null, devolverIntento: true })
    const p = cadena(f.llamadas.find((l) => cadena(l, 'update'))!, 'update')?.[0] as Record<string, unknown>
    ok('y nunca baja de cero', p.intentos === 0)
  }

  console.log('\n=== la rellamada que pide el cliente ===')
  {
    const f = falso(() => ({ data: { status: 'pendiente', assigned_to: 'u1', next_call_date: '2026-11-05', sobra: 1 } }))
    const l = await almacenDeSupabase(f.servicio).leadParaRellamada('l1')
    ok('lee estado, comercial y día de rellamada del lead por su id', f.llamadas[0].tabla === 'cold_leads' && hay(f.llamadas[0], 'select', 'status, assigned_to, next_call_date') && hay(f.llamadas[0], 'eq', 'id', 'l1'))
    ok('y los devuelve con nombres nuestros', l?.status === 'pendiente' && l.assignedTo === 'u1' && l.nextCallDate === '2026-11-05' && !('sobra' in (l as object)))
    ok('sin comercial ni día, null (no undefined)', (await almacenDeSupabase(falso(() => ({ data: { status: 'pendiente', assigned_to: null, next_call_date: null } })).servicio).leadParaRellamada('l1'))?.assignedTo === null)
    ok('un lead que ya no existe es null', (await almacenDeSupabase(falso(() => ({ data: null })).servicio).leadParaRellamada('l1')) === null)
  }
  await falla('un error al leer el lead sale como frase nuestra, sin el cuerpo de la respuesta', () => almacenDeSupabase(falso(() => ({ error: { code: '500', message: 'secreto interno' } })).servicio).leadParaRellamada('l1'), (m) => /leer el lead/.test(m) && !/secreto/.test(m))
  {
    const f = falso(() => ({ data: { festivos: ['2026-12-08', 'no-es-un-dia', 7, '2027-01-06'] } }))
    const d = await almacenDeSupabase(f.servicio).festivos()
    ok('los festivos salen de los ajustes de las secuencias, solo los que son un día', f.llamadas[0].tabla === 'correo_secuencia_ajustes' && hay(f.llamadas[0], 'eq', 'id', true) && d.join() === '2026-12-08,2027-01-06', d.join())
    ok('sin la tabla o con un error, ninguno (no es motivo para perder la rellamada)', (await almacenDeSupabase(falso(() => ({ error: { code: '42P01' } })).servicio).festivos()).length === 0 && (await almacenDeSupabase(falso(() => ({ data: null })).servicio).festivos()).length === 0 && (await almacenDeSupabase(falso(() => ({ data: { festivos: 'raro' } })).servicio).festivos()).length === 0)
  }
  {
    // La primera escritura toca algo: 'programado'
    const f = falso(() => ({ data: [{ id: 'l1' }] }))
    const r = await almacenDeSupabase(f.servicio, () => AHORA).ponerRellamada('l1', '2026-10-29', '2026-10-23', AHORA)
    const l = f.llamadas[0]
    const cambios = cadena(l, 'update')?.[0] as Record<string, unknown>
    ok('pone el estado «programado» y el día, en el lead de la llamada', r === 'programado' && f.llamadas.length === 1 && l.tabla === 'cold_leads' && cambios.status === 'programado' && cambios.next_call_date === '2026-10-29' && hay(l, 'eq', 'id', 'l1'))
    ok('solo si nadie lo lleva (los cuatro estados de siempre)', hay(l, 'in', 'status', ['pendiente', 'no_contesta', 'programado', 'email_enviado']))
    ok('y solo si no tiene ya otra rellamada para más adelante: sin día, de hoy o anterior, o este mismo', hay(l, 'or', 'next_call_date.is.null,next_call_date.lte.2026-10-23,next_call_date.eq.2026-10-29'))
    ok('con la hora de ahora en updated_at', cambios.updated_at === '2026-10-23T15:00:00.000Z')
  }
  {
    // Nada que cambiar con el primer filtro: un lead «En seguimiento» solo recibe la fecha
    const f = falso((l) => (hay(l, 'eq', 'status', 'seguimiento') ? { data: [{ id: 'l1' }] } : { data: [] }))
    const r = await almacenDeSupabase(f.servicio, () => AHORA).ponerRellamada('l1', '2026-10-29', '2026-10-23', AHORA)
    const segunda = f.llamadas[1]
    const cambios = cadena(segunda, 'update')?.[0] as Record<string, unknown>
    ok('si no cuela el primero, prueba con «En seguimiento» y solo cambia la fecha (nunca el estado)', r === 'solo_fecha' && f.llamadas.length === 2 && hay(segunda, 'eq', 'status', 'seguimiento') && cambios.next_call_date === '2026-10-29' && !('status' in cambios))
    ok('con el mismo filtro de la rellamada de más adelante', hay(segunda, 'or', 'next_call_date.is.null,next_call_date.lte.2026-10-23,next_call_date.eq.2026-10-29'))
  }
  {
    const f = falso(() => ({ data: [] }))
    ok('y si tampoco, «no»: no se ha tocado nada', (await almacenDeSupabase(f.servicio, () => AHORA).ponerRellamada('l1', '2026-10-29', '2026-10-23', AHORA)) === 'no' && f.llamadas.length === 2)
    ok('sin datos devueltos es lo mismo', (await almacenDeSupabase(falso(() => ({ data: null })).servicio).ponerRellamada('l1', '2026-10-29', '2026-10-23', AHORA)) === 'no')
  }
  await falla('un error al poner la rellamada sale como frase nuestra', () => almacenDeSupabase(falso(() => ({ error: { code: '500', message: 'secreto interno' } })).servicio).ponerRellamada('l1', '2026-10-29', '2026-10-23', AHORA), (m) => /poner la rellamada/.test(m) && !/secreto/.test(m))
  {
    const f = falso(() => ({}))
    await almacenDeSupabase(f.servicio).apuntarNota('l1', 'x'.repeat(9000), AHORA)
    const fila = cadena(f.llamadas[0], 'insert')?.[0] as Record<string, unknown>
    ok('una nota del sistema: sin autor, de tipo «nota», que no es una respuesta del cliente, en la hora que ocurrió y recortada', f.llamadas[0].tabla === 'cold_lead_notes' && fila.lead_id === 'l1' && fila.author_id === null && fila.kind === 'nota' && fila.es_respuesta === false && fila.occurred_at === '2026-10-23T15:00:00.000Z' && (fila.body as string).length === 8000)
    const quieto = console.error
    console.error = () => undefined
    await almacenDeSupabase(falso(() => ({ error: { code: '23503' } })).servicio).apuntarNota('l1', 'hola', AHORA)
    console.error = quieto
    ok('si no se puede escribir, no lanza: se apunta y se sigue', true)
  }
}

run().then(
  () => {
    console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
    if (fallos > 0) process.exit(1)
  },
  (e) => {
    console.error('Explotó la prueba:', e)
    process.exit(1)
  }
)
