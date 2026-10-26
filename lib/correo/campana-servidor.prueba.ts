import { avisoDeCorreoNuevo, avisoDeRespuestaDeLead, type AvisoParaLaCampana } from '@/lib/correo/campana'
import {
  DIAS_DE_VIDA_DE_UN_AVISO,
  avisarDeCorreoNuevo,
  escribirAvisosDeCorreo,
  marcarAvisosDeCorreoLeidos,
  purgarAvisosDeCorreoViejos,
  reiniciarLaCampanaDeCorreo,
} from '@/lib/correo/campana-servidor'
import { nuevaBase, type BaseEnMemoria } from '@/lib/correo/secuencias/cliente-falso'
import { B1, B2, DIA, HORA, MIN, T0, UA, UB, identificador } from '@/lib/correo/secuencias/mundo-de-pruebas'

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
  sembrarMensaje(m: { id: number; buzon?: string; direccion?: 'entrante' | 'saliente'; de?: string; nombre?: string | null; asunto?: string; texto?: string; vista?: string; fecha?: number; creado?: number; leido?: boolean; automatico?: boolean }): string
  notificaciones(usuario?: string): Array<Record<string, unknown>>
}

const HILO = identificador('d', 1)

function mundo(): Mundo {
  reiniciarLaCampanaDeCorreo()
  const reloj = { ahora: T0 }
  const { base, service } = nuevaBase(() => reloj.ahora)
  base.sembrar('profiles', [
    { id: UA, full_name: 'Ana', email: 'ana@libertyseller.com', role: 'employee', is_comercial: true },
    { id: UB, full_name: 'Alejandro', email: 'alejandro@libertyseller.com', role: 'employee', is_comercial: true },
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
    await marcarAvisosDeCorreoLeidos(m.servicio, [a, identificador('f', 99)])
    const tras = m.notificaciones()
    ok('abrir el hilo marca como leído solo el aviso de lo que se ha leído', tras.find((f) => f.clave === `msg:${a}`)?.read === true && tras.find((f) => f.clave === `msg:${b}`)?.read === false)
    await marcarAvisosDeCorreoLeidos(m.servicio, [])
    ok('sin nada que marcar no hace nada ni falla', m.notificaciones().length === 2)
  }

  console.log('\n=== mejorar un aviso: misma clave, más información ===')
  {
    const m = mundo()
    const msg = m.sembrarMensaje({ id: 1 })
    await avisarDeCorreoNuevo(m.servicio, BUZON_DE_ANA, { desde: m.reloj.ahora - 30_000, ahora: m.reloj.ahora })
    await marcarAvisosDeCorreoLeidos(m.servicio, [msg])
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
    await marcarAvisosDeCorreoLeidos(n.servicio, [identificador('f', 1)])
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
    await marcarAvisosDeCorreoLeidos(m.servicio, [identificador('f', 1)])
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

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
