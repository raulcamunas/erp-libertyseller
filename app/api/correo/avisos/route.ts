import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { buzonesAjenosQueSeLeen } from '@/lib/correo/acceso'
import { MARGEN_DE_RELOJ_MS, VENTANA_DE_NOVEDAD_MS, avisosDeCorreo, esRebote, type AvisoDeCorreo, type MensajeParaAviso } from '@/lib/correo/avisos'
import { quienEnvioPorHilo } from '@/lib/correo/campana-servidor'
import { buzonesSoloPorRebotes, filtrarAvisos, misBuzonesQueAvisan, rebotesQueMeTocan, type Preferencia } from '@/lib/correo/preferencias'
import { leerPreferencias, leerSilencios, sinLeerMios } from '@/lib/correo/preferencias-servidor'
import { buzonesAsignadosA, leerDuenos, quienPide, registrarAcceso } from '@/lib/correo/quien-servidor'
import { SIN_CACHE, registrar, requerirCorreo, respuestaDeFallo } from '@/lib/correo/rutas'
import { esperaTrasFallos, nombreDeLaSesion, sincronizarBuzonPorId } from '@/lib/correo/servidor'
import { leerCuerpoConTope } from '@/lib/subidas-limite'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LOS CORREOS NUEVOS DE «MIS CORREOS» DESDE LA ÚLTIMA VEZ — el aviso de «correo nuevo» de abajo a la derecha y el número del menú.
 *
 * POST { desde }  La pantalla lo pregunta cada minuto mientras el ERP está abierto y a la vista, esté en la aplicación que esté. Por la VÍA CORTA
 * (sin cargar la regla de acceso de todo el equipo):
 *
 *   0. Qué buzones mira: los PROPIOS (como siempre), los ASIGNADOS a quien llama (migración 318) y los que SIGUE (en_mis_correos = true en sus
 *      preferencias). Son 2 consultas más que antes. Solo los seguidos ajenos se comprueban con la regla de acceso (UN quienPide y una lectura de
 *      dueños): un buzón que ya no se puede leer no avisa aunque siga en «Mis correos».
 *   1. Lee por IMAP los propios y los asignados que no se hayan leído en los últimos 55 segundos (el mismo `sincronizarBuzonPorId` que la pantalla
 *      de Correo, con su turno). Los SEGUIDOS no: esos los lee el proceso automático cada minuto, y así no se multiplica el IMAP.
 *   2. Devuelve los correos de PERSONAS (y los rebotes) que han entrado desde `desde`, sin leer y con fecha reciente, de los buzones que AVISAN
 *      (`misBuzonesQueAvisan`: en «Mis correos» y sin silenciar), sin los hilos ni los remitentes silenciados (`filtrarAvisos`; los rebotes no se
 *      silencian nunca). Lo antiguo que entra de golpe al conectar un buzón no avisa (ver lib/correo/avisos.ts).
 *      LOS REBOTES NO SE SILENCIAN NUNCA, tampoco aquí: los propios y asignados que NO avisan (silenciados o fuera de «Mis correos») se miran
 *      aparte SOLO por sus rebotes, con la regla de la campana: del propio, todos; del asignado, los de lo que envió quien mira.
 *   3. Cuántas conversaciones sin leer tienen esos buzones, sin las silenciadas (`sinLeerMios`, la RPC correo_sin_leer_de): el número del menú.
 *
 * EL RASTRO. Un aviso de un buzón AJENO enseña el asunto y el principio del correo solo si antes se ha podido dejar la fila 'aviso' en
 * correo_accesos (una por persona y buzón cada 30 minutos). Si no se puede, o si el buzón solo se SIGUE (no está asignado), el aviso sale sin
 * asunto ni vista previa: «Correo nuevo en jose@…». El contenido, al abrirlo (que deja su propio rastro).
 *
 * `ahora` es la hora del servidor al EMPEZAR: la pantalla lo usa como `desde` de la siguiente vez. Lo que se importe durante esta lectura
 * tiene una fecha de entrada posterior y volverá a salir en la siguiente consulta: la pantalla descarta los repetidos por su id.
 *
 * SIN LA MIGRACIÓN 318, COMO ANTES: sin asignaciones ni preferencias, solo los buzones propios, y el número sale de correo_resumen_buzones.
 * Sin la app «Correo» (o con un partner) contesta 403, y la pantalla deja de preguntar. Sin la migración 236, 503.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const MAX_BYTES_CUERPO = 1024
const PRESUPUESTO_MS = 8_000
const ENTRE_LECTURAS_MS = 55_000
/** Una consulta con un `desde` más antiguo que esto se trata como la primera: no se avisa de lo que llegó mientras no se estaba mirando */
const MAX_ANTIGUEDAD_DEL_DESDE_MS = 10 * 60_000
/** Los avisos que se devuelven de una vez (la pila de abajo a la derecha enseña 3 y «N más») */
const MAX_AVISOS = 5

const CAMPOS = 'id, user_id, direccion, ultimo_intento_at, credenciales_invalidas, fallos_seguidos'

interface FilaDeBuzon {
  id: string
  user_id: string
  direccion: string
  ultimo_intento_at: string | null
  credenciales_invalidas: boolean
  fallos_seguidos: number
}

/** De dónde le viene a quien llama cada buzón que mira: suyo, asignado por un administrador o solo seguido (en «Mis correos») */
type Via = 'propio' | 'asignado' | 'seguido'

/** Un aviso sin nada del correo: ni quién lo escribe, ni el asunto, ni el principio. Solo que ha llegado algo y a qué buzón */
function sinContenido(a: AvisoDeCorreo, direccion: string): AvisoDeCorreo {
  return { ...a, de: direccion, asunto: `Correo nuevo en ${direccion}`, vistaPrevia: '' }
}

export async function POST(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion
  const corte = Date.now()

  const cuerpo = await leerCuerpoConTope(request, MAX_BYTES_CUERPO)
  if (cuerpo instanceof NextResponse) return cuerpo
  let json: { desde?: unknown } = {}
  try {
    json = cuerpo.texto.trim() === '' ? {} : (JSON.parse(cuerpo.texto) as typeof json)
  } catch {
    return fail(400, 'No se ha entendido lo que se ha mandado')
  }
  const desdeCrudo = typeof json.desde === 'string' ? Date.parse(json.desde) : NaN
  const desde = Number.isFinite(desdeCrudo) && corte - desdeCrudo <= MAX_ANTIGUEDAD_DEL_DESDE_MS ? desdeCrudo : null

  try {
    const service = createServiceClient()
    const ahora = new Date(corte).toISOString()

    // 0. Los propios, mis asignaciones y mis preferencias, a la vez. Sin la 318, las dos últimas llegan vacías
    const [propiosR, asignaciones, preferencias] = await Promise.all([
      service.from('correo_buzones').select(CAMPOS).eq('user_id', sesion.userId),
      buzonesAsignadosA(service, sesion.userId),
      leerPreferencias(service, sesion.userId),
    ])
    if (propiosR.error) throw new Error('No se han podido leer los buzones.', { cause: propiosR.error })
    const propios = (propiosR.data ?? []) as FilaDeBuzon[]
    const via = new Map<string, Via>(propios.map((b) => [b.id, 'propio']))

    // Un partner nunca tiene buzones asignados (la regla tampoco los contaría); requerirCorreo ya no lo deja pasar, pero no se fía
    const asignados = sesion.role === 'partner' ? [] : [...asignaciones.asignados].filter((id) => !via.has(id))
    for (const id of asignados) via.set(id, 'asignado')
    const seguidos = [...preferencias.porBuzon.values()].filter((p) => p.enMisCorreos === true && !via.has(p.buzonId)).map((p) => p.buzonId)

    let buzones: FilaDeBuzon[] = propios
    const ajenos = [...asignados, ...seguidos]
    if (ajenos.length > 0) {
      const { data, error } = await service.from('correo_buzones').select(CAMPOS).in('id', ajenos)
      if (error) throw new Error('No se han podido leer los buzones.', { cause: error })
      let filas = (data ?? []) as FilaDeBuzon[]

      // Todos los ajenos pasan por la regla, también los asignados: si una asignación y un bloqueo llegan a convivir (dos
      // administradores a la vez, o una fila colada), gana el bloqueo, como en la bandeja, el hilo y la campana
      if (filas.length > 0) {
        const [quien, duenos] = await Promise.all([quienPide(service, sesion), leerDuenos(service, filas.map((b) => b.user_id))])
        filas = buzonesAjenosQueSeLeen(quien, filas, duenos)
      }
      for (const b of filas) if (!via.has(b.id)) via.set(b.id, 'seguido')
      buzones = [...propios, ...filas]
    }
    // Lo que no ha llegado a leerse (un seguido que ya no se puede leer, un asignado cuyo buzón se ha borrado) no cuenta
    for (const id of [...via.keys()]) if (!buzones.some((b) => b.id === id)) via.delete(id)

    if (buzones.length === 0) return NextResponse.json({ ahora, hayBuzon: false, nuevos: [], sinLeer: 0 }, { headers: SIN_CACHE })

    // 1. IMAP: solo los propios y los asignados que están conectados, no rechazados y a los que les toca por su espera tras fallos
    const aMirar = buzones.filter((b) => via.get(b.id) === 'propio' || via.get(b.id) === 'asignado')
    if (aMirar.length > 0) {
      const { data: conClave, error: errorClaves } = await service.from('correo_credenciales').select('buzon_id').in('buzon_id', aMirar.map((b) => b.id))
      if (errorClaves) throw new Error('No se han podido comprobar las conexiones.', { cause: errorClaves })
      const conectados = new Set(((conClave ?? []) as Array<{ buzon_id: string }>).map((c) => c.buzon_id))
      const alDia = (b: FilaDeBuzon) => {
        const ultimo = b.ultimo_intento_at ? Date.parse(b.ultimo_intento_at) : 0
        const espera = Math.max(ENTRE_LECTURAS_MS, esperaTrasFallos(b.fallos_seguidos))
        return corte - ultimo < espera
      }
      const aLeer = aMirar.filter((b) => conectados.has(b.id) && !b.credenciales_invalidas && !alDia(b))
      // Lo que falle al leer lo deja apuntado la propia lectura en el buzón; aquí no hace falta nada más
      await Promise.allSettled(aLeer.map((b) => sincronizarBuzonPorId(service, b.id, { presupuestoMs: PRESUPUESTO_MS })))
    }

    // 2. Los buzones que avisan: en «Mis correos» y sin silenciar. Sin la 318 no hay preferencias: todos los propios
    const prefs: Map<string, Preferencia> = preferencias.porBuzon
    const queAvisan = misBuzonesQueAvisan(
      buzones.map((b) => ({ id: b.id, esMio: via.get(b.id) === 'propio', asignado: via.get(b.id) === 'asignado' })),
      prefs,
      corte
    )
    const direccionDe = new Map(buzones.map((b) => [b.id, b.direccion]))

    // Los que no avisan pero cuyos rebotes sí: propios y asignados silenciados o fuera de «Mis correos»
    const soloPorRebotes = buzonesSoloPorRebotes(
      buzones.map((b) => ({ id: b.id, via: via.get(b.id) ?? 'seguido' })),
      queAvisan
    )

    let nuevos: AvisoDeCorreo[] = []
    if (desde !== null && (queAvisan.length > 0 || soloPorRebotes.length > 0)) {
      const leerNuevos = async (ids: string[]) => {
        if (ids.length === 0) return [] as Array<MensajeParaAviso & { rebote: boolean }>
        const { data, error: errorMensajes } = await service
          .from('correo_mensajes')
          .select('id, buzon_id, hilo_id, de_nombre, de_direccion, asunto, vista_previa, fecha, automatico')
          .in('buzon_id', ids)
          .eq('direccion', 'entrante')
          .eq('leido', false)
          .gt('creado_at', new Date(desde - MARGEN_DE_RELOJ_MS).toISOString())
          .gte('fecha', new Date(corte - VENTANA_DE_NOVEDAD_MS).toISOString())
          .order('fecha', { ascending: false })
          .limit(25)
        if (errorMensajes) throw new Error('No se han podido leer los correos nuevos.', { cause: errorMensajes })
        return ((data ?? []) as MensajeParaAviso[]).map((m) => ({ ...m, rebote: esRebote(m) }))
      }
      const [deLosQueAvisan, candidatos] = await Promise.all([leerNuevos(queAvisan), leerNuevos(soloPorRebotes)])
      let filas = deLosQueAvisan
      // Mis hilos y remitentes silenciados (los rebotes se saltan el filtro). Sin la 318, ninguno
      if (filas.length > 0 && preferencias.disponible) filas = filtrarAvisos(filas, await leerSilencios(service, sesion.userId), corte)

      // Los rebotes de los que no avisan: del propio, todos; del asignado, los de los hilos cuyo último saliente envió quien mira
      const rebotes = candidatos.filter((f) => f.rebote)
      if (rebotes.length > 0) {
        const propiosIds = new Set(propios.map((b) => b.id))
        const enviadoPorHilo = new Map<string, string>()
        const deAsignados = [...new Set(rebotes.filter((f) => !propiosIds.has(f.buzon_id)).map((f) => f.buzon_id))]
        for (const buzonId of deAsignados) {
          const hilos = [...new Set(rebotes.filter((f) => f.buzon_id === buzonId).map((f) => f.hilo_id))]
          for (const [hilo, quien] of await quienEnvioPorHilo(service, buzonId, hilos)) enviadoPorHilo.set(hilo, quien)
        }
        filas = [...filas, ...rebotesQueMeTocan(rebotes, { userId: sesion.userId, propios: propiosIds, enviadoPorHilo })]
      }
      nuevos = avisosDeCorreo(filas, MAX_AVISOS)

      // El rastro de los ajenos: con la fila 'aviso', con contenido; sin ella (o si solo se sigue), sin asunto ni vista previa
      const ajenosConAvisos = [...new Set(nuevos.map((a) => a.buzonId).filter((id) => via.get(id) !== 'propio'))]
      if (ajenosConAvisos.length > 0) {
        const conContenido = new Set<string>()
        const asignadosConAvisos = ajenosConAvisos.filter((id) => via.get(id) === 'asignado')
        if (asignadosConAvisos.length > 0) {
          const quien = { userId: sesion.userId, nombre: await nombreDeLaSesion(service, sesion.userId) }
          const rastros = await Promise.allSettled(asignadosConAvisos.map((id) => registrarAcceso(service, quien, id, 'aviso', null, { ahora: corte })))
          rastros.forEach((r, i) => {
            if (r.status === 'fulfilled') conContenido.add(asignadosConAvisos[i])
            else registrar('Correo · avisos: sin rastro del aviso, va sin contenido', r.reason)
          })
        }
        nuevos = nuevos.map((a) => (via.get(a.buzonId) === 'propio' || conContenido.has(a.buzonId) ? a : sinContenido(a, direccionDe.get(a.buzonId) ?? 'otro buzón')))
      }
    }

    // 3. El número del menú: conversaciones sin leer de los buzones que avisan, sin las silenciadas
    let sinLeer = 0
    if (preferencias.disponible) {
      if (queAvisan.length > 0) for (const n of (await sinLeerMios(service, sesion.userId, queAvisan)).values()) sinLeer += n
    } else {
      // Sin la 318, como antes: el total de los propios
      const { data: resumen } = await service.rpc('correo_resumen_buzones', { p_buzones: propios.map((b) => b.id) })
      for (const f of (resumen ?? []) as Array<{ hilos_sin_leer: number | string | null }>) sinLeer += Number(f.hilos_sin_leer ?? 0)
    }

    return NextResponse.json({ ahora, hayBuzon: true, nuevos, sinLeer }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('Correo · avisos: fallo', error)
  }
}
