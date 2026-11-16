import { avisoDeAsignacionDeBuzon, avisoDeAsignacionDeHilo, avisoDeCorreoNuevo, avisoDeRespuestaDeLead, type AvisoParaLaCampana } from '@/lib/correo/campana'
import {
  DIAS_DE_VIDA_DE_UN_AVISO,
  avisarDeCorreoNuevo,
  escribirAvisoDeAsignacion,
  escribirAvisosDeCorreo,
  apagarAvisosAlAbrirHilo,
  marcarAvisosDeCorreoLeidos,
  purgarAvisosDeCorreoViejos,
  reiniciarLaCampanaDeCorreo,
} from '@/lib/correo/campana-servidor'
import { FaltaMigracion318, destinatariosDeAvisos, guardarPreferencias, leerPreferencias, leerSilencios, listarSilenciados, sinLeerMios } from '@/lib/correo/preferencias-servidor'
import { ACCESOS_RECIENTES } from '@/lib/correo/quien-servidor'
import { ESQUEMA, nuevaBase, type BaseEnMemoria } from '@/lib/correo/secuencias/cliente-falso'
import { B1, B2, DIA, HORA, MIN, T0, UA, UB, UC, UD, identificador } from '@/lib/correo/secuencias/mundo-de-pruebas'

// La base de mentira de las secuencias no conoce las tablas de la regla de acceso ni las de la 318: se le enseñan aquí (solo en este proceso)
const E = ESQUEMA as unknown as Record<string, { columnas: readonly string[]; requeridas?: readonly string[] }>
E.user_app_permissions = { columnas: ['user_id', 'app_id', 'can_access'] }
E.correo_buzon_lectores = { columnas: ['buzon_id', 'lector_id', 'concedido_por', 'concedido_at'] }
E.correo_buzon_bloqueos = { columnas: ['buzon_id', 'lector_id', 'bloqueado_por', 'bloqueado_at'] }
E.correo_buzon_asignaciones = { columnas: ['buzon_id', 'persona_id', 'puede_responder', 'asignado_por', 'asignado_at'] }
E.correo_buzon_preferencias = { columnas: ['user_id', 'buzon_id', 'en_mis_correos', 'orden', 'silenciado', 'silenciado_hasta', 'actualizado_at'] }
E.correo_hilo_silencios = { columnas: ['user_id', 'hilo_id', 'hasta', 'creado_at'] }
E.correo_remitente_silencios = { columnas: ['user_id', 'direccion', 'hasta', 'creado_at'] }
E.correo_accesos = { columnas: ['id', 'buzon_id', 'usuario_id', 'usuario_nombre', 'accion', 'hilo_id', 'asunto', 'creado_at'] }
E.correo_mensajes = { ...E.correo_mensajes, columnas: [...E.correo_mensajes.columnas, 'enviado_por', 'enviado_por_nombre'] }
const TABLAS_318 = ['correo_buzon_asignaciones', 'correo_buzon_preferencias', 'correo_hilo_silencios', 'correo_remitente_silencios']

// Más gente del equipo: además de Ana (dueña de B1) y Alejandro (dueño de B2)
const UE = '00000000-0000-4000-8000-0000000000a5'
const UF = '00000000-0000-4000-8000-0000000000a6'
const UG = '00000000-0000-4000-8000-0000000000a7'
const UH = '00000000-0000-4000-8000-0000000000a8'
const UP = '00000000-0000-4000-8000-0000000000a9'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const iso = (ms: number): string => new Date(ms).toISOString()
type Servicio = Parameters<typeof escribirAvisosDeCorreo>[0]

interface Mundo {
  base: BaseEnMemoria
  servicio: Servicio
  reloj: { ahora: number }
  sembrarMensaje(m: { id: number; buzon?: string; direccion?: 'entrante' | 'saliente'; de?: string; nombre?: string | null; asunto?: string; texto?: string; vista?: string; fecha?: number; creado?: number; leido?: boolean; automatico?: boolean; enviadoPor?: string | null }): string
  notificaciones(usuario?: string): Array<Record<string, unknown>>
}

const HILO = identificador('d', 1)

function mundo(): Mundo {
  reiniciarLaCampanaDeCorreo()
  ACCESOS_RECIENTES.clear()
  const reloj = { ahora: T0 }
  const { base, service } = nuevaBase(() => reloj.ahora)
  base.sembrar('profiles', [
    { id: UA, full_name: 'Ana', email: 'ana@libertyseller.com', role: 'employee', is_comercial: true },
    { id: UB, full_name: 'Alejandro', email: 'alejandro@libertyseller.com', role: 'employee', is_comercial: true },
  ])
  base.sembrar('user_app_permissions', [
    { user_id: UA, app_id: 'correo', can_access: true },
    { user_id: UB, app_id: 'correo', can_access: true },
  ])
  base.sembrar('correo_buzones', [
    { id: B1, user_id: UA, direccion: 'ana@libertyseller.es', nombre: 'Ana López', usuario: 'ana@libertyseller.es', imap_host: 'x', smtp_host: 'x', desde_fecha: iso(T0 - 365 * DIA) },
    { id: B2, user_id: UB, direccion: 'alejandro@libertyseller.es', nombre: 'Alejandro', usuario: 'alejandro@libertyseller.es', imap_host: 'x', smtp_host: 'x', desde_fecha: iso(T0 - 365 * DIA) },
  ])
  base.sembrar('correo_hilos', [
    { id: HILO, buzon_id: B1, asunto: 'Varios', primer_mensaje_at: iso(T0), ultimo_mensaje_at: iso(T0) },
    { id: identificador('d', 2), buzon_id: B2, asunto: 'Varios', primer_mensaje_at: iso(T0), ultimo_mensaje_at: iso(T0) },
  ])
  const m: Mundo = {
    base,
    servicio: service as unknown as Servicio,
    reloj,
    sembrarMensaje(d) {
      const id = identificador('f', d.id)
      const buzon = d.buzon ?? B1
      base.sembrar('correo_mensajes', {
        id,
        buzon_id: buzon,
        hilo_id: buzon === B1 ? HILO : identificador('d', 2),
        direccion: d.direccion ?? 'entrante',
        de_direccion: d.de ?? 'marta@tienda.es',
        de_nombre: d.nombre === undefined ? 'Marta López' : d.nombre,
        asunto: d.asunto ?? 'Re: Propuesta',
        texto: d.texto ?? 'Hola, me interesa.',
        vista_previa: d.vista ?? 'Hola, me interesa.',
        fecha: iso(d.fecha ?? reloj.ahora - 10 * MIN),
        creado_at: iso(d.creado ?? reloj.ahora - 5_000),
        leido: d.leido ?? false,
        automatico: d.automatico ?? false,
        enviado_por: d.enviadoPor ?? null,
      })
      return id
    },
    notificaciones: (usuario) => base.filas('notifications').filter((f) => !usuario || f.user_id === usuario),
  }
  return m
}

const BUZON_DE_ANA = { id: B1, user_id: UA }

async function main() {
  console.log('\n=== avisar del correo que acaba de entrar ===')
  {
    const m = mundo()
    const persona = m.sembrarMensaje({ id: 1 })
    m.sembrarMensaje({ id: 2, automatico: true, de: 'newsletter@tienda.es', nombre: 'Boletín', asunto: 'Novedades' })
    const rebote = m.sembrarMensaje({
      id: 3,
      automatico: true,
      de: 'mailer-daemon@googlemail.com',
      nombre: 'Mail Delivery Subsystem',
      asunto: 'Delivery Status Notification (Failure)',
      vista: 'Address not found',
      texto: "Address not found. Your message wasn't delivered to hola@tienda.es because the address couldn't be found. 550 5.1.1 user unknown",
    })
    m.sembrarMensaje({ id: 4, leido: true })
    m.sembrarMensaje({ id: 5, fecha: m.reloj.ahora - 5 * HORA })
    m.sembrarMensaje({ id: 6, creado: m.reloj.ahora - 2 * HORA })
    m.sembrarMensaje({ id: 7, direccion: 'saliente' })
    m.sembrarMensaje({ id: 8, buzon: B2 })

    const r = await avisarDeCorreoNuevo(m.servicio, BUZON_DE_ANA, { desde: m.reloj.ahora - 30_000, ahora: m.reloj.ahora })
    const todas = m.notificaciones()
    ok('avisa del correo de una persona y del rebote: dos avisos, los dos para Ana', r.avisos === 2 && todas.length === 2 && todas.every((f) => f.user_id === UA), JSON.stringify(r))
    const nuevo = todas.find((f) => f.type === 'correo_nuevo')
    const rbt = todas.find((f) => f.type === 'correo_rebote')
    ok('el del correo lleva su clave, su texto y a dónde lleva', nuevo?.clave === `msg:${persona}` && nuevo.title === 'Correo nuevo de Marta López' && String(nuevo.message).startsWith('Re: Propuesta') && JSON.stringify(nuevo.datos) === JSON.stringify({ buzonId: B1, hiloId: HILO, mensajeId: persona }), JSON.stringify(nuevo))
    ok('el del rebote dice a qué dirección iba y por qué', rbt?.clave === `msg:${rebote}` && String(rbt.message).includes('hola@tienda.es') && String(rbt.message).includes('no existe') && (rbt.datos as { direccion?: string }).direccion === 'hola@tienda.es', JSON.stringify(rbt))
    ok('nuevos y sin leer', todas.every((f) => f.read === false))
    ok('no avisa de lo automático, lo ya leído, lo antiguo, lo que se importó de golpe, lo que sale ni del buzón de otra persona', !todas.some((f) => [2, 4, 5, 6, 7, 8].some((n) => f.clave === `msg:${identificador('f', n)}`)))

    const otra = await avisarDeCorreoNuevo(m.servicio, BUZON_DE_ANA, { desde: m.reloj.ahora - 30_000, ahora: m.reloj.ahora })
    ok('volver a mirar lo mismo no repite nada (dos lecturas a la vez, o la siguiente con su margen)', m.notificaciones().length === 2 && otra.faltaMigracion === false)

    m.reloj.ahora += MIN
    const nueva = m.sembrarMensaje({ id: 9, de: 'luis@otra.es', nombre: null, asunto: 'Hola', vista: '' })
    await avisarDeCorreoNuevo(m.servicio, BUZON_DE_ANA, { desde: m.reloj.ahora - 30_000, ahora: m.reloj.ahora })
    const sinNombre = m.notificaciones().find((f) => f.clave === `msg:${nueva}`)
    ok('un correo posterior avisa con la dirección si no trae nombre', m.notificaciones().length === 3 && sinNombre?.title === 'Correo nuevo de luis@otra.es' && sinNombre.message === 'Hola', JSON.stringify(sinNombre))
  }

  console.log('\n=== lo que se lee, se apaga ===')
  {
    const m = mundo()
    const a = m.sembrarMensaje({ id: 1 })
    const b = m.sembrarMensaje({ id: 2, de: 'luis@otra.es', nombre: 'Luis' })
    await avisarDeCorreoNuevo(m.servicio, BUZON_DE_ANA, { desde: m.reloj.ahora - 30_000, ahora: m.reloj.ahora })
    await marcarAvisosDeCorreoLeidos(m.servicio, UA, [a, identificador('f', 99)])
    const tras = m.notificaciones()
    ok('abrir el hilo marca como leído solo el aviso de lo que se ha leído', tras.find((f) => f.clave === `msg:${a}`)?.read === true && tras.find((f) => f.clave === `msg:${b}`)?.read === false)
    await marcarAvisosDeCorreoLeidos(m.servicio, UA, [])
    ok('sin nada que marcar no hace nada ni falla', m.notificaciones().length === 2)
  }
  {
    // La dueña y una persona asignada tienen avisos con la MISMA clave: que lea la asignada no apaga los de la dueña (tampoco el rebote)
    const m = mundo()
    const nuevo = avisoDeCorreoNuevo(UA, { id: identificador('f', 1), buzonId: B1, hiloId: HILO, de: 'Marta', asunto: 'a', vistaPrevia: '', fecha: iso(T0), rebote: false })
    const rebote = avisoDeCorreoNuevo(UA, { id: identificador('f', 2), buzonId: B1, hiloId: HILO, de: 'Mail Delivery', asunto: 'Undelivered', vistaPrevia: '', fecha: iso(T0), rebote: true })
    await escribirAvisosDeCorreo(m.servicio, [nuevo, { ...nuevo, userId: UB }, rebote, { ...rebote, userId: UB }])
    await marcarAvisosDeCorreoLeidos(m.servicio, UB, [identificador('f', 1), identificador('f', 2)])
    ok('la asignada que lee apaga solo SUS avisos', m.notificaciones(UB).length === 2 && m.notificaciones(UB).every((f) => f.read === true), JSON.stringify(m.notificaciones(UB)))
    ok('los de la dueña, incluido el rebote, siguen sin leer', m.notificaciones(UA).length === 2 && m.notificaciones(UA).every((f) => f.read === false), JSON.stringify(m.notificaciones(UA)))
    await marcarAvisosDeCorreoLeidos(m.servicio, '', [identificador('f', 1)])
    ok('sin saber quién lee no apaga nada', m.notificaciones(UA).every((f) => f.read === false))
  }

  console.log('\n=== abrir un hilo sin poder responder apaga SUS avisos ===')
  {
    // Ana es la dueña; Alejandro sigue el buzón (o lo tiene «solo avisos»): los dos tienen aviso de los mismos correos
    const m = mundo()
    const f1 = identificador('f', 1)
    const f2 = identificador('f', 2)
    const f3 = identificador('f', 3)
    const aviso = (id: string, userId: string) => avisoDeCorreoNuevo(userId, { id, buzonId: B1, hiloId: HILO, de: 'Marta', asunto: 'a', vistaPrevia: '', fecha: iso(T0), rebote: false })
    await escribirAvisosDeCorreo(m.servicio, [aviso(f1, UA), aviso(f1, UB), aviso(f2, UA), aviso(f2, UB), aviso(f3, UB)])
    const abierto = {
      puedeResponder: false,
      mensajes: [
        { id: f1, direccion: 'entrante' as const, leido: false },
        // ya leído por la dueña: al seguidor le seguía avisando, también se apaga
        { id: f2, direccion: 'entrante' as const, leido: true },
      ],
    }
    const n = await apagarAvisosAlAbrirHilo(m.servicio, UB, abierto)
    const deAle = m.notificaciones(UB)
    ok('el seguidor abre el hilo: sus avisos de esos mensajes quedan leídos', n === 2 && deAle.filter((f) => f.clave === `msg:${f1}` || f.clave === `msg:${f2}`).every((f) => f.read === true), JSON.stringify(deAle))
    ok('el de un mensaje que no se le ha enseñado sigue sin leer', deAle.find((f) => f.clave === `msg:${f3}`)?.read === false)
    ok('los de la dueña no cambian', m.notificaciones(UA).length === 2 && m.notificaciones(UA).every((f) => f.read === false), JSON.stringify(m.notificaciones(UA)))
    const antes = m.base.registro.filter((c) => c.tabla === 'notifications').length
    const n2 = await apagarAvisosAlAbrirHilo(m.servicio, UA, { ...abierto, puedeResponder: true })
    ok('quien puede responder no pasa por aquí (lo hace el PATCH leido)', n2 === 0 && m.base.registro.filter((c) => c.tabla === 'notifications').length === antes && m.notificaciones(UA).every((f) => f.read === false))
  }

  console.log('\n=== mejorar un aviso: misma clave, más información ===')
  {
    const m = mundo()
    const msg = m.sembrarMensaje({ id: 1 })
    await avisarDeCorreoNuevo(m.servicio, BUZON_DE_ANA, { desde: m.reloj.ahora - 30_000, ahora: m.reloj.ahora })
    await marcarAvisosDeCorreoLeidos(m.servicio, UA, [msg])
    const mejora: AvisoParaLaCampana | null = avisoDeRespuestaDeLead({
      userId: UA, buzonId: B1, leadId: identificador('e', 1), lead: 'Casa Luz', mensajeId: msg, hiloId: null, inscripcionId: identificador('c', 1), clase: 'interesado', resumen: 'Quiere hablar.', hecho: null,
    })
    const r = await escribirAvisosDeCorreo(m.servicio, [mejora!])
    const filas = m.notificaciones(UA)
    ok('el aviso de ese correo cambia de texto y de tipo, sin duplicarse', r.escritos === 1 && filas.length === 1 && filas[0].type === 'respuesta_lead' && filas[0].title === 'Casa Luz está interesado', JSON.stringify(filas))
    ok('y sigue leído si ya se había leído (no vuelve a molestar)', filas[0].read === true)
    const datos = filas[0].datos as Record<string, string>
    ok('conserva lo que llevaba (el hilo) y añade lo nuevo (la secuencia y qué entendió la IA)', datos.hiloId === HILO && datos.buzonId === B1 && datos.clase === 'interesado' && datos.inscripcionId === identificador('c', 1), JSON.stringify(datos))
    // una mejora de un aviso que no existía lo crea
    const huerfano = avisoDeRespuestaDeLead({ userId: UA, buzonId: B1, leadId: identificador('e', 2), lead: 'Otra', mensajeId: identificador('f', 50), clase: 'pide_info', resumen: 'Pide precios.', hecho: null })
    await escribirAvisosDeCorreo(m.servicio, [huerfano!])
    const creado = m.notificaciones(UA).find((f) => f.clave === `msg:${identificador('f', 50)}`)
    ok('si el aviso no existía, la mejora lo crea sin leer', creado?.read === false && creado.type === 'respuesta_lead')
    // lo que no es una mejora no pisa lo que ya había
    const otraVez = avisoDeCorreoNuevo(UA, { id: msg, buzonId: B1, hiloId: HILO, de: 'Marta', asunto: 'Otra cosa', vistaPrevia: '', fecha: iso(T0), rebote: false })
    await escribirAvisosDeCorreo(m.servicio, [otraVez])
    ok('un aviso que no es mejora no pisa al que ya hay', m.notificaciones(UA).find((f) => f.clave === `msg:${msg}`)?.type === 'respuesta_lead')
    // dentro de una misma tanda, la misma clave no revienta
    const x = avisoDeCorreoNuevo(UA, { id: identificador('f', 60), buzonId: B1, hiloId: HILO, de: 'A', asunto: 'a', vistaPrevia: '', fecha: iso(T0), rebote: false })
    const rr = await escribirAvisosDeCorreo(m.servicio, [x, { ...x, titulo: 'otro' }])
    ok('dos avisos con la misma clave en la misma tanda se quedan en uno', rr.escritos === 1 && m.notificaciones(UA).filter((f) => f.clave === x.clave).length === 1)
  }

  console.log('\n=== cada persona, lo suyo ===')
  {
    const m = mundo()
    const ana = avisoDeCorreoNuevo(UA, { id: identificador('f', 1), buzonId: B1, hiloId: HILO, de: 'Marta', asunto: 'a', vistaPrevia: '', fecha: iso(T0), rebote: false })
    const ale = { ...ana, userId: UB }
    await escribirAvisosDeCorreo(m.servicio, [ana, ale])
    ok('la misma clave para dos personas son dos avisos, uno para cada una', m.notificaciones(UA).length === 1 && m.notificaciones(UB).length === 1)
  }

  console.log('\n=== sin la migración 251 ===')
  {
    const m = mundo()
    m.base.sinLa251 = true
    const msg = m.sembrarMensaje({ id: 1 })
    const r = await avisarDeCorreoNuevo(m.servicio, BUZON_DE_ANA, { desde: m.reloj.ahora - 30_000, ahora: m.reloj.ahora, reloj: () => m.reloj.ahora })
    ok('no escribe nada, lo dice y no revienta', r.faltaMigracion === true && r.avisos === 0 && m.notificaciones().length === 0, JSON.stringify(r))
    const consultas = () => m.base.registro.filter((c) => c.tabla === 'notifications').length
    const antes = consultas()
    await escribirAvisosDeCorreo(m.servicio, [avisoDeCorreoNuevo(UA, { id: msg, buzonId: B1, hiloId: HILO, de: 'Marta', asunto: 'a', vistaPrevia: '', fecha: iso(T0), rebote: false })], () => m.reloj.ahora + 10 * MIN)
    ok('durante la hora siguiente ni lo intenta', consultas() === antes)
    m.base.sinLa251 = false
    const r2 = await escribirAvisosDeCorreo(m.servicio, [avisoDeCorreoNuevo(UA, { id: msg, buzonId: B1, hiloId: HILO, de: 'Marta', asunto: 'a', vistaPrevia: '', fecha: iso(T0), rebote: false })], () => m.reloj.ahora + 2 * HORA)
    ok('pasada la hora vuelve a intentarlo y, ya con la migración, escribe', r2.escritos === 1 && r2.faltaMigracion === false && m.notificaciones().length === 1)
    // marcar como leído sin la migración tampoco rompe
    const n = mundo()
    n.base.sinLa251 = true
    await marcarAvisosDeCorreoLeidos(n.servicio, UA, [identificador('f', 1)])
    ok('marcar como leído sin la migración no lanza', true)
  }
  {
    // Sin la 251 pero con el tipo rechazado por la restricción (23514): lo mismo
    const m = mundo()
    m.base.tiposDeNotificacion.delete('correo_nuevo')
    const r = await escribirAvisosDeCorreo(m.servicio, [avisoDeCorreoNuevo(UA, { id: identificador('f', 1), buzonId: B1, hiloId: HILO, de: 'Marta', asunto: 'a', vistaPrevia: '', fecha: iso(T0), rebote: false })])
    ok('si la base rechaza el tipo, se toma por falta de migración', r.faltaMigracion === true && r.escritos === 0)
  }
  {
    // Un fallo de verdad de la base sí se propaga a quien llama (que lo envuelve y lo apunta)
    const m = mundo()
    m.base.ausentes.add('notifications')
    let lanzo = false
    try {
      await escribirAvisosDeCorreo(m.servicio, [avisoDeCorreoNuevo(UA, { id: identificador('f', 1), buzonId: B1, hiloId: HILO, de: 'Marta', asunto: 'a', vistaPrevia: '', fecha: iso(T0), rebote: false })])
    } catch {
      lanzo = true
    }
    ok('un fallo de la base que no es de migración se propaga', lanzo)
    // y marcar como leído se lo come
    await marcarAvisosDeCorreoLeidos(m.servicio, UA, [identificador('f', 1)])
    ok('pero marcar como leído nunca lanza', true)
  }

  console.log('\n=== la limpieza ===')
  {
    const m = mundo()
    const viejo = iso(m.reloj.ahora - (DIAS_DE_VIDA_DE_UN_AVISO + 5) * DIA)
    const reciente = iso(m.reloj.ahora - 3 * DIA)
    m.base.sembrar('notifications', [
      { user_id: UA, type: 'correo_nuevo', title: 'viejo', created_at: viejo, clave: 'msg:v1' },
      { user_id: UA, type: 'secuencia_pausada', title: 'viejo 2', created_at: viejo, clave: 'pausa:1:1' },
      { user_id: UA, type: 'correo_nuevo', title: 'reciente', created_at: reciente, clave: 'msg:r1' },
      { user_id: UA, type: 'web_lead', title: 'de otra cosa, vieja', created_at: viejo },
      { user_id: UA, type: 'alarma_correo', title: 'alarma vieja', created_at: viejo },
    ])
    const hecho = await purgarAvisosDeCorreoViejos(m.servicio, m.reloj.ahora)
    const quedan = m.notificaciones().map((f) => f.title)
    ok('borra los avisos de correo de más de 45 días y solo esos', hecho === true && quedan.length === 3 && quedan.includes('reciente') && quedan.includes('de otra cosa, vieja') && quedan.includes('alarma vieja'), JSON.stringify(quedan))
    const otra = await purgarAvisosDeCorreoViejos(m.servicio, m.reloj.ahora + HORA)
    ok('como mucho una vez cada seis horas', otra === false)
    const mas = await purgarAvisosDeCorreoViejos(m.servicio, m.reloj.ahora + 7 * HORA)
    ok('y pasadas seis horas, otra vez', mas === true)
    const n = mundo()
    n.base.ausentes.add('notifications')
    ok('si la base falla, no lanza', (await purgarAvisosDeCorreoViejos(n.servicio, n.reloj.ahora)) === false)
  }

  console.log('\n=== a quién avisa un correo nuevo (migración 318) ===')
  {
    // Ana es la dueña de B1. Alejandro (UB) lo tiene ASIGNADO con respuesta. Carla (UC) lo SIGUE con la supervisión del correo.
    // Dani (UD) lo sigue pero se lo han bloqueado. Eva (UE) lo sigue con la supervisión pero perdió la app Correo. Fede (UF) lo tiene asignado y SILENCIADO.
    // Gema (UG) lo tiene asignado y tiene silenciada a marta@tienda.es. Hugo (UH) lo sigue y está desactivado. Pablo (UP) es partner con una asignación colada.
    const m = mundo()
    m.base.sembrar('profiles', [
      { id: UC, full_name: 'Carla', email: 'carla@l.es', role: 'employee', is_comercial: false },
      { id: UD, full_name: 'Dani', email: 'dani@l.es', role: 'employee', is_comercial: false },
      { id: UE, full_name: 'Eva', email: 'eva@l.es', role: 'employee', is_comercial: false },
      { id: UF, full_name: 'Fede', email: 'fede@l.es', role: 'employee', is_comercial: false },
      { id: UG, full_name: 'Gema', email: 'gema@l.es', role: 'employee', is_comercial: false },
      { id: UH, full_name: 'Hugo', email: 'hugo@l.es', role: 'employee', is_comercial: false },
      { id: UP, full_name: 'Pablo', email: 'pablo@socio.es', role: 'partner', is_comercial: false },
    ])
    m.base.sembrar('user_app_permissions', [
      ...[UC, UD, UF, UG, UH].map((u) => ({ user_id: u, app_id: 'correo', can_access: true })),
      ...[UC, UD, UE, UH].map((u) => ({ user_id: u, app_id: 'correo-supervision', can_access: true })),
      { user_id: UP, app_id: 'correo', can_access: true },
    ])
    m.base.sembrar('correo_buzon_bloqueos', [{ buzon_id: B1, lector_id: UD }])
    m.base.sembrar('correo_buzon_asignaciones', [
      { buzon_id: B1, persona_id: UB, puede_responder: true },
      { buzon_id: B1, persona_id: UF, puede_responder: false },
      { buzon_id: B1, persona_id: UG, puede_responder: true },
      { buzon_id: B1, persona_id: UP, puede_responder: true },
    ])
    m.base.sembrar('correo_buzon_preferencias', [
      ...[UC, UD, UE, UH].map((u) => ({ user_id: u, buzon_id: B1, en_mis_correos: true, silenciado: false })),
      { user_id: UF, buzon_id: B1, en_mis_correos: null, silenciado: true, silenciado_hasta: null },
    ])
    m.base.sembrar('correo_remitente_silencios', [{ user_id: UG, direccion: 'marta@tienda.es', hasta: null }])
    ;(m.servicio as unknown as { auth: unknown }).auth = { admin: { listUsers: async () => ({ data: { users: [{ id: UH, banned_until: '2999-01-01T00:00:00Z' }] }, error: null }) } }

    const dest = await destinatariosDeAvisos(m.servicio, BUZON_DE_ANA, { ahora: m.reloj.ahora })
    const ids = dest.map((d) => d.personaId)
    ok('destinatarios: la dueña, los asignados que no lo tienen silenciado y quien lo sigue y lo puede leer', ids.join() === [UA, UB, UG, UC].join(), ids.join())
    ok('con contenido la dueña y los asignados; quien solo lo sigue, sin contenido', dest.find((d) => d.personaId === UA)?.conContenido === true && dest.find((d) => d.personaId === UB)?.conContenido === true && dest.find((d) => d.personaId === UC)?.conContenido === false && dest.find((d) => d.personaId === UC)?.asignado === false)

    const marta = m.sembrarMensaje({ id: 1 })
    const luis = m.sembrarMensaje({ id: 2, de: 'luis@otra.es', nombre: 'Luis', asunto: 'Pedido', vista: 'Te mando el pedido' })
    const r = await avisarDeCorreoNuevo(m.servicio, BUZON_DE_ANA, { desde: m.reloj.ahora - 30_000, ahora: m.reloj.ahora })
    const de = (u: string) => m.notificaciones(u)
    ok('la dueña sola recibe lo de siempre (con contenido)', de(UA).length === 2 && de(UA).some((f) => f.title === 'Correo nuevo de Marta López' && String(f.message).startsWith('Re: Propuesta')))
    ok('el asignado recibe los dos con contenido', de(UB).length === 2 && de(UB).every((f) => String(f.title).startsWith('Correo nuevo de ')), JSON.stringify(de(UB).map((f) => f.title)))
    const accesos = m.base.filas('correo_accesos')
    ok('y antes queda su rastro «aviso» (uno por persona y buzón, no uno por correo)', accesos.filter((a) => a.usuario_id === UB && a.accion === 'aviso' && a.buzon_id === B1).length === 1, JSON.stringify(accesos))
    ok('la dueña no deja rastro (es suyo)', !accesos.some((a) => a.usuario_id === UA))
    ok('quien solo lo sigue recibe «Correo nuevo en <dirección>», sin asunto ni remitente', de(UC).length === 2 && de(UC).every((f) => f.title === 'Correo nuevo en ana@libertyseller.es' && !String(f.message).includes('Propuesta') && !String(f.message).includes('pedido')), JSON.stringify(de(UC)))
    ok('y no deja rastro (no ha visto contenido)', !accesos.some((a) => a.usuario_id === UC))
    ok('quien tiene el remitente silenciado solo recibe el del otro remitente', de(UG).length === 1 && de(UG)[0].clave === `msg:${luis}`, JSON.stringify(de(UG).map((f) => f.clave)))
    ok('quien tiene el buzón silenciado no recibe nada', de(UF).length === 0)
    ok('quien ya no lo puede leer (bloqueado) no recibe nada', de(UD).length === 0)
    ok('quien perdió la app Correo no recibe nada', de(UE).length === 0)
    ok('quien está desactivado no recibe nada', de(UH).length === 0)
    ok('un partner con una asignación colada no recibe nada', de(UP).length === 0)
    ok('cada uno con la clave del correo (msg:<id>)', de(UB).some((f) => f.clave === `msg:${marta}`) && de(UC).some((f) => f.clave === `msg:${marta}`))
    ok('cuenta todos los avisos escritos', r.avisos === 2 + 2 + 2 + 1, JSON.stringify(r))
  }
  {
    // La dueña que ha silenciado una conversación concreta no recibe avisos de ella; y la que quita su buzón de «Mis correos», ninguno
    const m = mundo()
    m.base.sembrar('correo_hilo_silencios', [{ user_id: UA, hilo_id: HILO, hasta: iso(m.reloj.ahora + HORA) }])
    m.sembrarMensaje({ id: 1 })
    await avisarDeCorreoNuevo(m.servicio, BUZON_DE_ANA, { desde: m.reloj.ahora - 30_000, ahora: m.reloj.ahora })
    ok('un hilo silenciado no avisa ni a su dueña', m.notificaciones(UA).length === 0)
    const n = mundo()
    n.base.sembrar('correo_hilo_silencios', [{ user_id: UA, hilo_id: HILO, hasta: iso(n.reloj.ahora - HORA) }])
    n.sembrarMensaje({ id: 1 })
    await avisarDeCorreoNuevo(n.servicio, BUZON_DE_ANA, { desde: n.reloj.ahora - 30_000, ahora: n.reloj.ahora })
    ok('un silencio vencido ya no silencia', n.notificaciones(UA).length === 1)
    const q = mundo()
    q.base.sembrar('correo_buzon_preferencias', [{ user_id: UA, buzon_id: B1, en_mis_correos: false, silenciado: false }])
    q.sembrarMensaje({ id: 1 })
    await avisarDeCorreoNuevo(q.servicio, BUZON_DE_ANA, { desde: q.reloj.ahora - 30_000, ahora: q.reloj.ahora })
    ok('la dueña que lo quita de «Mis correos» deja de recibir avisos', q.notificaciones(UA).length === 0)
  }
  {
    // Un seguidor que PIERDE la lectura (le quitan el permiso) deja de recibir avisos sin tocar nada más: no hay caché que invalidar
    const m = mundo()
    m.base.sembrar('profiles', [{ id: UC, full_name: 'Carla', email: 'carla@l.es', role: 'employee', is_comercial: false }])
    m.base.sembrar('user_app_permissions', [{ user_id: UC, app_id: 'correo', can_access: true }, { user_id: UC, app_id: 'correo-supervision', can_access: true }])
    m.base.sembrar('correo_buzon_preferencias', [{ user_id: UC, buzon_id: B1, en_mis_correos: true, silenciado: false }])
    m.sembrarMensaje({ id: 1 })
    await avisarDeCorreoNuevo(m.servicio, BUZON_DE_ANA, { desde: m.reloj.ahora - 30_000, ahora: m.reloj.ahora })
    ok('mientras lo lee, le llega', m.notificaciones(UC).length === 1)
    m.base.tablas.set('user_app_permissions', m.base.filas('user_app_permissions').filter((f) => !(f.user_id === UC && f.app_id === 'correo-supervision')))
    m.reloj.ahora += MIN
    m.sembrarMensaje({ id: 2, de: 'luis@otra.es' })
    await avisarDeCorreoNuevo(m.servicio, BUZON_DE_ANA, { desde: m.reloj.ahora - 30_000, ahora: m.reloj.ahora })
    ok('al perder la lectura, el siguiente ya no le llega (y a la dueña sí)', m.notificaciones(UC).length === 1 && m.notificaciones(UA).length === 2)
  }

  console.log('\n=== el rastro del aviso no se puede escribir: aviso sin contenido ===')
  {
    const m = mundo()
    m.base.sembrar('correo_buzon_asignaciones', [{ buzon_id: B1, persona_id: UB, puede_responder: true }])
    m.base.ausentes.add('correo_accesos')
    m.sembrarMensaje({ id: 1 })
    await avisarDeCorreoNuevo(m.servicio, BUZON_DE_ANA, { desde: m.reloj.ahora - 30_000, ahora: m.reloj.ahora })
    const suyo = m.notificaciones(UB)
    ok('el asignado recibe el aviso, pero «Correo nuevo en <dirección>» y sin asunto', suyo.length === 1 && suyo[0].title === 'Correo nuevo en ana@libertyseller.es' && !String(suyo[0].message).includes('Propuesta'), JSON.stringify(suyo))
    ok('la dueña, con contenido como siempre', m.notificaciones(UA)[0]?.title === 'Correo nuevo de Marta López')
  }

  console.log('\n=== los rebotes: a la dueña y a quien lo envió, sin silencios ===')
  {
    const m = mundo()
    m.base.sembrar('correo_buzon_asignaciones', [{ buzon_id: B1, persona_id: UB, puede_responder: true }])
    // Ana tiene el buzón silenciado y a mailer-daemon silenciado; Alejandro también tiene silenciado al mailer-daemon
    m.base.sembrar('correo_buzon_preferencias', [{ user_id: UA, buzon_id: B1, en_mis_correos: null, silenciado: true, silenciado_hasta: null }])
    m.base.sembrar('correo_remitente_silencios', [
      { user_id: UA, direccion: 'mailer-daemon@googlemail.com', hasta: null },
      { user_id: UB, direccion: 'mailer-daemon@googlemail.com', hasta: null },
    ])
    m.base.sembrar('correo_hilo_silencios', [{ user_id: UB, hilo_id: HILO, hasta: null }])
    // Alejandro envió desde el buzón de Ana el correo que rebota (el último saliente del hilo con enviado_por)
    m.sembrarMensaje({ id: 10, direccion: 'saliente', de: 'ana@libertyseller.es', fecha: m.reloj.ahora - HORA, enviadoPor: UB, leido: true })
    m.sembrarMensaje({ id: 11, direccion: 'saliente', de: 'ana@libertyseller.es', fecha: m.reloj.ahora - 2 * HORA, enviadoPor: null, leido: true })
    const rebote = m.sembrarMensaje({
      id: 3,
      automatico: true,
      de: 'mailer-daemon@googlemail.com',
      nombre: 'Mail Delivery Subsystem',
      asunto: 'Delivery Status Notification (Failure)',
      texto: "Address not found. Your message wasn't delivered to hola@tienda.es because the address couldn't be found. 550 5.1.1 user unknown",
    })
    m.sembrarMensaje({ id: 4 })
    await avisarDeCorreoNuevo(m.servicio, BUZON_DE_ANA, { desde: m.reloj.ahora - 30_000, ahora: m.reloj.ahora })
    const ana = m.notificaciones(UA)
    ok('la dueña recibe el rebote aunque tenga el buzón y el remitente silenciados', ana.length === 1 && ana[0].type === 'correo_rebote' && ana[0].clave === `msg:${rebote}` && ana[0].title === 'Un correo tuyo no se ha entregado', JSON.stringify(ana))
    const ale = m.notificaciones(UB)
    ok('quien lo envió lo recibe también, con su texto («que enviaste desde…»)', ale.some((f) => f.type === 'correo_rebote' && f.title === 'Un correo que enviaste desde ana@libertyseller.es no se ha entregado' && String(f.message).includes('hola@tienda.es')), JSON.stringify(ale))
    ok('pero el correo normal de ese hilo silenciado no le llega a él', !ale.some((f) => f.type === 'correo_nuevo'))
  }
  {
    // Sin enviado_por (correo enviado por la dueña, o sin la 318) el rebote es solo de la dueña; y quien lo envió pero ya no lo lee, no lo recibe
    const m = mundo()
    m.base.sembrar('correo_buzon_bloqueos', [{ buzon_id: B1, lector_id: UB }])
    m.sembrarMensaje({ id: 10, direccion: 'saliente', fecha: m.reloj.ahora - HORA, enviadoPor: UB, leido: true })
    m.sembrarMensaje({ id: 3, automatico: true, de: 'mailer-daemon@googlemail.com', asunto: 'Delivery Status Notification (Failure)', texto: '550 user unknown' })
    await avisarDeCorreoNuevo(m.servicio, BUZON_DE_ANA, { desde: m.reloj.ahora - 30_000, ahora: m.reloj.ahora })
    ok('quien envió pero ya no puede leer el buzón no recibe el rebote', m.notificaciones(UB).length === 0 && m.notificaciones(UA).length === 1)
  }

  console.log('\n=== sin la migración 318: solo la dueña, como antes ===')
  {
    const m = mundo()
    for (const t of TABLAS_318) m.base.ausentes.add(t)
    m.sembrarMensaje({ id: 1 })
    const dest = await destinatariosDeAvisos(m.servicio, BUZON_DE_ANA)
    ok('destinatarios: solo la dueña, con contenido', dest.length === 1 && dest[0].personaId === UA && dest[0].conContenido)
    const r = await avisarDeCorreoNuevo(m.servicio, BUZON_DE_ANA, { desde: m.reloj.ahora - 30_000, ahora: m.reloj.ahora })
    ok('y el aviso sale igual', r.avisos === 1 && m.notificaciones(UA).length === 1)
    ok('leer preferencias y silencios no rompe', (await leerPreferencias(m.servicio, UA)).disponible === false && (await leerSilencios(m.servicio, UA)).hilos.size === 0)
    const g = await guardarPreferencias(m.servicio, UA, [{ buzonId: B1, enMisCorreos: true }]).catch((e) => e)
    ok('guardar dice que falta la 318', g instanceof FaltaMigracion318 && /318_correo_mis_asignaciones_silencios/.test(g.message))
    const l = await listarSilenciados(m.servicio, UA, () => true)
    ok('«Silenciados» vacío y no disponible', l.disponible === false && l.hilos.length === 0)
  }

  console.log('\n=== avisos de asignación: su propia vía ===')
  {
    const PERSONA = avisoDeAsignacionDeBuzon({ para: 'persona', buzonId: B1, direccion: 'ana@libertyseller.es', duenoId: UA, personaId: UB, personaNombre: 'Alejandro', porId: UC, porNombre: 'Raúl', puedeResponder: true, asignadoAt: iso(T0) })!
    const HILO_A = avisoDeAsignacionDeHilo({ userId: UB, buzonId: B1, hiloId: HILO, porId: UA, porNombre: 'Ana', asunto: 'Varios', asignadoAt: iso(T0) })!
    {
      // La 318 a medias: la tabla existe pero la campana no admite el tipo (23514)
      const m = mundo()
      const r = await escribirAvisoDeAsignacion(m.servicio, [PERSONA])
      ok('la base rechaza correo_asignado: no escribe y dice que falta la migración', r.faltaMigracion === true && r.escritos === 0 && m.notificaciones().length === 0)
      m.sembrarMensaje({ id: 1 })
      const n = await avisarDeCorreoNuevo(m.servicio, BUZON_DE_ANA, { desde: m.reloj.ahora - 30_000, ahora: m.reloj.ahora })
      ok('y el correo_nuevo siguiente se escribe igual (otro interruptor)', n.avisos === 1 && n.faltaMigracion === false && m.notificaciones(UA).length === 1)
      const mezcla = await escribirAvisosDeCorreo(m.servicio, [HILO_A, avisoDeCorreoNuevo(UA, { id: identificador('f', 77), buzonId: B1, hiloId: HILO, de: 'X', asunto: 'a', vistaPrevia: '', fecha: iso(T0), rebote: false })])
      ok('una tanda mezclada escribe el correo nuevo aunque la asignación se rechace', mezcla.escritos === 1 && m.notificaciones(UA).length === 2)
    }
    {
      // Sin la tabla de asignaciones ni lo intenta
      const m = mundo()
      m.base.ausentes.add('correo_buzon_asignaciones')
      const antes = m.base.registro.filter((c) => c.tabla === 'notifications').length
      const r = await escribirAvisoDeAsignacion(m.servicio, [PERSONA])
      ok('sin correo_buzon_asignaciones no toca la campana', r.faltaMigracion === true && m.base.registro.filter((c) => c.tabla === 'notifications').length === antes)
    }
    {
      // Con la 318 lanzada
      const m = mundo()
      m.base.tiposDeNotificacion.add('correo_asignado')
      const r = await escribirAvisoDeAsignacion(m.servicio, [PERSONA, HILO_A, PERSONA])
      const filas = m.notificaciones(UB)
      ok('con la 318 se escriben (sin repetir)', r.escritos === 2 && filas.length === 2 && filas.every((f) => f.type === 'correo_asignado'))
      ok('con su clave y sus datos', filas.some((f) => f.clave === PERSONA.clave && (f.datos as { motivo?: string }).motivo === 'buzon') && filas.some((f) => f.clave === HILO_A.clave && (f.datos as { hiloId?: string }).hiloId === HILO))
      await escribirAvisoDeAsignacion(m.servicio, [PERSONA])
      ok('volver a escribir la misma asignación no repite el aviso', m.notificaciones(UB).length === 2)
    }
  }

  console.log('\n=== guardar y listar lo silenciado ===')
  {
    const m = mundo()
    await guardarPreferencias(m.servicio, UA, [{ buzonId: B1, enMisCorreos: true, orden: 2 }, { buzonId: B2, silencio: '8h' }, { remitente: 'pesado@x.es', silencio: 'siempre' }], { ahora: m.reloj.ahora })
    let p = await leerPreferencias(m.servicio, UA)
    ok('guarda «Mis correos», el orden y el silencio de un buzón (8 h)', p.disponible && p.porBuzon.get(B1)?.enMisCorreos === true && p.porBuzon.get(B1)?.orden === 2 && p.porBuzon.get(B2)?.silenciado === true && p.porBuzon.get(B2)?.silenciadoHasta === iso(m.reloj.ahora + 8 * HORA), JSON.stringify([...p.porBuzon.values()]))
    await guardarPreferencias(m.servicio, UA, [{ buzonId: B1, silencio: 'siempre' }], { ahora: m.reloj.ahora })
    p = await leerPreferencias(m.servicio, UA)
    ok('un cambio que no menciona algo lo deja como estaba', p.porBuzon.get(B1)?.enMisCorreos === true && p.porBuzon.get(B1)?.orden === 2 && p.porBuzon.get(B1)?.silenciado === true && p.porBuzon.get(B1)?.silenciadoHasta === null)
    await guardarPreferencias(m.servicio, UA, [{ buzonId: B1, silencio: 'quitar' }])
    ok('quitar el silencio', (await leerPreferencias(m.servicio, UA)).porBuzon.get(B1)?.silenciado === false)
    ok('el remitente queda silenciado para siempre', (await leerSilencios(m.servicio, UA)).remitentes.get('pesado@x.es') === null)
    m.base.sembrar('correo_hilo_silencios', [
      { user_id: UA, hilo_id: HILO, hasta: null },
      { user_id: UA, hilo_id: identificador('d', 2), hasta: null },
      { user_id: UA, hilo_id: identificador('d', 3), hasta: iso(m.reloj.ahora - HORA) },
    ])
    const l = await listarSilenciados(m.servicio, UA, (b) => b === B1, { ahora: m.reloj.ahora })
    ok('«Silenciados»: los hilos de buzones que todavía lee, con su asunto; nada del que ya no lee ni lo vencido', l.disponible && l.hilos.length === 1 && l.hilos[0].hiloId === HILO && l.hilos[0].asunto === 'Varios', JSON.stringify(l.hilos))
    ok('las preferencias del buzón que ya no lee tampoco salen', l.preferencias.every((x) => x.buzonId === B1))
    ok('y los remitentes', l.remitentes.length === 1 && l.remitentes[0].direccion === 'pesado@x.es')
    await guardarPreferencias(m.servicio, UA, [{ remitente: 'pesado@x.es', silencio: 'quitar' }])
    ok('dejar de silenciar un remitente lo borra', (await leerSilencios(m.servicio, UA)).remitentes.size === 0)
  }

  console.log('\n=== sin leer descontando lo silenciado ===')
  {
    const llamadas: string[] = []
    const falso = (con318: boolean) =>
      ({
        rpc: async (nombre: string) => {
          llamadas.push(nombre)
          if (nombre === 'correo_sin_leer_de') return con318 ? { data: [{ buzon_id: B1, hilos_sin_leer: '3' }], error: null } : { data: null, error: { code: 'PGRST202' } }
          return { data: [{ buzon_id: B1, hilos_sin_leer: 5 }, { buzon_id: B2, hilos_sin_leer: 1 }], error: null }
        },
      }) as unknown as Parameters<typeof sinLeerMios>[0]
    const con = await sinLeerMios(falso(true), UA, [B1, B2])
    ok('con la 318: la cuenta de correo_sin_leer_de, y 0 en el buzón sin nada', con.get(B1) === 3 && con.get(B2) === 0 && llamadas.join() === 'correo_sin_leer_de')
    llamadas.length = 0
    const sin = await sinLeerMios(falso(false), UA, [B1, B2])
    ok('sin la 318: la de siempre (correo_resumen_buzones)', sin.get(B1) === 5 && sin.get(B2) === 1 && llamadas.join() === 'correo_sin_leer_de,correo_resumen_buzones')
    ok('sin buzones, sin consultas', (await sinLeerMios(falso(true), UA, [])).size === 0)
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
