import { reiniciarLaCampana } from '@/lib/correo/secuencias/alarmas'
import { nuevaBase, type BaseEnMemoria } from '@/lib/correo/secuencias/cliente-falso'
import { B1, B2, DIA, HORA, MIN, T0, UA, UB, UC, crearMundo, type Entorno, type Mundo } from '@/lib/correo/secuencias/mundo-de-pruebas'
import { vigilarLaSalud } from '@/lib/correo/secuencias/vigia'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

let baseActual: BaseEnMemoria
const entorno: Entorno = {
  async nuevo(reloj) {
    const { base, service } = nuevaBase(reloj)
    base.sembrar('correo_secuencias', { nombre: 'Prospección', es_base: true, activa: true, pasos: [{ orden: 1, dias: 3 }, { orden: 2, dias: 7 }] })
    base.sembrar('correo_secuencia_ajustes', { id: true, activa: false, modo_ensayo: true })
    baseActual = base
    return { service, soloEnMemoria: { ausentes: base.ausentes } }
  },
}

/** Un mundo con el motor en envío real y el proceso corriendo cada minuto hasta hace nada */
async function mundoSano(opciones: Parameters<typeof crearMundo>[1] = {}): Promise<Mundo> {
  reiniciarLaCampana()
  const m = await crearMundo(entorno, { activa: true, ensayo: false, ...opciones })
  m.reloj.ahora = T0 + 3 * HORA
  await m.actualizar('correo_buzones', { ultimo_sync_at: m.iso(m.reloj.ahora - 2 * MIN) }, (q) => q.in('id', [B1, B2]))
  await pasadaDelMotor(m, m.reloj.ahora - 30_000)
  return m
}

async function pasadaDelMotor(m: Mundo, en: number, ok = true, error: string | null = null) {
  await m.sembrar('cron_ejecuciones', { tarea: 'correo-secuencias', iniciado_at: m.iso(en), terminado_at: m.iso(en + 800), ok, error, duracion_ms: 800 })
}

const vigilar = (m: Mundo, ahora = m.reloj.ahora) => vigilarLaSalud(m.service as unknown as Parameters<typeof vigilarLaSalud>[0], { ahora })
const campana = (m: Mundo) => m.leer('notifications', (q) => q.eq('type', 'alarma_correo'))
const titulosDe = (filas: Array<Record<string, unknown>>, usuario: string) => filas.filter((f) => f.user_id === usuario).map((f) => String(f.title))

async function main() {
  console.log('\n=== cuando todo va bien ===')
  {
    const m = await mundoSano()
    const r = await vigilar(m)
    ok('no hay alarmas ni avisos', r.alarmas === 0 && r.avisos === 0 && !r.omitido, JSON.stringify(r))
    ok('la campana, vacía', (await campana(m)).length === 0)
  }

  console.log('\n=== lo que no se vigila ===')
  {
    const m = await mundoSano({ activa: false })
    await m.actualizar('correo_buzones', { credenciales_invalidas: true }, (q) => q.eq('id', B1))
    const r = await vigilar(m)
    ok('con el motor apagado no se mira nada (aunque haya un buzón con la contraseña mal)', r.omitido === 'El motor está apagado' && r.avisos === 0 && (await campana(m)).length === 0, JSON.stringify(r))
  }
  {
    const m = await mundoSano()
    m.ausentes?.add('correo_secuencia_ajustes')
    const r = await vigilar(m)
    ok('sin la migración 245, se salta sin romper', r.omitido === 'Falta la migración 245' && r.avisos === 0)
  }

  console.log('\n=== un buzón con la contraseña mal ===')
  {
    const m = await mundoSano()
    await m.actualizar('correo_buzones', { credenciales_invalidas: true, ultimo_error: 'AUTHENTICATIONFAILED', fallos_seguidos: 1 }, (q) => q.eq('id', B1))
    const r = await vigilar(m)
    const filas = await campana(m)
    ok('avisa a la administradora y a la dueña del buzón', r.alarmas === 1 && r.avisos === 2 && filas.length === 2 && filas.every((f) => f.read === false), JSON.stringify(r))
    ok('a Raúl, «el buzón de Ana»; a Ana, «tu buzón»', titulosDe(filas, UC)[0] === 'Correo · El buzón de Ana no se puede conectar' && titulosDe(filas, UA)[0] === 'Correo · Tu buzón no se puede conectar', JSON.stringify(titulosDe(filas, UC).concat(titulosDe(filas, UA))))
    ok('Alejandro no se entera de un buzón que no es suyo', titulosDe(filas, UB).length === 0)
    ok('el mensaje dice dónde mirar', String(filas.find((f) => f.user_id === UA)?.message).includes('Ponla de nuevo en Correo.') && String(filas[0].message).endsWith('Lo ves en Correo → Secuencias → Salud.'))

    m.reloj.ahora += 3 * MIN
    const otra = await vigilar(m)
    ok('tres minutos después, lo mismo no se repite', otra.avisos === 0 && (await campana(m)).length === 2)
    m.reloj.ahora += 11 * HORA
    await pasadaDelMotor(m, m.reloj.ahora - 20_000)
    ok('a las 11 horas, tampoco', (await vigilar(m)).avisos === 0)
    m.reloj.ahora += 2 * HORA
    await pasadaDelMotor(m, m.reloj.ahora - 20_000)
    const pasado = await vigilar(m)
    ok('a las 13 horas, si sigue así, se recuerda', pasado.avisos === 2 && (await campana(m)).length === 4, JSON.stringify(pasado))

    // se arregla y vuelve a romperse: el aviso es otra vez nuevo cuando pasa el plazo
    await m.actualizar('correo_buzones', { credenciales_invalidas: false, ultimo_error: null, fallos_seguidos: 0 }, (q) => q.eq('id', B1))
    await m.actualizar('correo_buzones', { ultimo_sync_at: m.iso(m.reloj.ahora - 2 * MIN) }, (q) => q.in('id', [B1, B2]))
    const sana = await vigilar(m)
    ok('arreglado el buzón (y leído otra vez), no hay alarmas', sana.alarmas === 0 && sana.avisos === 0, JSON.stringify(sana))
  }
  {
    const m = await mundoSano()
    await m.actualizar('correo_secuencia_buzones', { participa: false }, (q) => q.eq('buzon_id', B1))
    await m.actualizar('correo_buzones', { credenciales_invalidas: true }, (q) => q.eq('id', B1))
    const r = await vigilar(m)
    ok('un buzón que no participa en las secuencias con la contraseña mal sale como alarma, pero NO va a la campana', r.alarmas === 1 && r.avisos === 0 && (await campana(m)).length === 0, JSON.stringify(r))
  }

  console.log('\n=== el motor parado ===')
  {
    const m = await mundoSano()
    // La última pasada fue hace 20 minutos y nada más
    await m.actualizar('cron_ejecuciones', { iniciado_at: m.iso(m.reloj.ahora - 20 * MIN) }, (q) => q.eq('tarea', 'correo-secuencias'))
    const r = await vigilar(m)
    const filas = await campana(m)
    ok('avisa solo a los administradores (no tiene dueño)', r.avisos === 1 && filas.length === 1 && filas[0].user_id === UC && filas[0].title === 'Correo · El motor de seguimientos se ha parado', JSON.stringify(filas))
    ok('y dice cuánto lleva parado', String(filas[0].message).startsWith('Lleva 20 min sin ejecutarse'))
  }
  {
    const m = await mundoSano()
    await m.actualizar('cron_ejecuciones', { iniciado_at: m.iso(m.reloj.ahora - 6 * MIN) }, (q) => q.eq('tarea', 'correo-secuencias'))
    ok('con 6 minutos sin pasar (lo que tarda un despliegue) no salta', (await vigilar(m)).avisos === 0)
  }
  {
    const m = await mundoSano()
    // Las pasadas lanzadas a mano por alguien no cuentan: el proceso automático lleva 25 minutos sin entrar
    await m.actualizar('cron_ejecuciones', { iniciado_at: m.iso(m.reloj.ahora - 25 * MIN) }, (q) => q.eq('tarea', 'correo-secuencias'))
    await m.sembrar('cron_ejecuciones', { tarea: 'correo-secuencias', iniciado_at: m.iso(m.reloj.ahora - MIN), ok: true, lanzado_por: UC })
    const r = await vigilar(m)
    ok('una pasada lanzada a mano no tapa que el automático esté parado', r.avisos === 1, JSON.stringify(r))
  }
  {
    const m = await mundoSano()
    m.ausentes?.add('cron_ejecuciones')
    const r = await vigilar(m)
    ok('sin el registro de procesos no se puede saber si corre: no se acusa a nadie', r.avisos === 0 && r.alarmas === 0, JSON.stringify(r))
  }
  {
    const m = await mundoSano()
    // 50 pasadas en la última hora, 40 de ellas con error
    for (let i = 0; i < 50; i++) await pasadaDelMotor(m, m.reloj.ahora - (i + 1) * 50_000, i % 5 !== 0 ? false : true, i % 5 !== 0 ? 'connect ETIMEDOUT' : null)
    const r = await vigilar(m)
    const filas = await campana(m)
    ok('un motor que falla casi todas las veces avisa a los administradores', r.avisos === 1 && filas[0]?.title === 'Correo · El motor de seguimientos está fallando' && String(filas[0].message).includes('ETIMEDOUT'), JSON.stringify(filas))
  }

  console.log('\n=== rebotes, envíos fallidos y lo que no hace falta avisar ===')
  {
    const m = await mundoSano()
    for (let i = 0; i < 25; i++) await m.saliente({ para: `x${i}@empresa.es`, messageId: `volumen-${i}@libertyseller.es`, cuando: m.reloj.ahora - (i + 1) * 5 * MIN })
    for (let i = 0; i < 3; i++) await m.entrante({ de: 'mailer-daemon@googlemail.com', hilo: null, automatico: true, asunto: 'Delivery Status Notification (Failure)', texto: `Your message wasn't delivered to x${i}@empresa.es. 550 5.1.1 user unknown`, cuando: m.reloj.ahora - (i + 1) * 10 * MIN, n: 9000 + i })
    const r = await vigilar(m)
    const filas = await campana(m)
    ok('3 rebotes en 25 correos (12 %): avisa a la administradora y a la dueña', r.avisos === 2 && titulosDe(filas, UC)[0] === 'Correo · El buzón de Ana rebota demasiado' && titulosDe(filas, UA)[0] === 'Correo · Tu buzón rebota demasiado', JSON.stringify(filas.map((f) => [f.user_id, f.title])))
    ok('con las cifras y el límite', String(filas[0].message).includes('3 rebotes en 25 correos en 24 h (12 %; el límite es 4 %)'), String(filas[0].message))
  }
  {
    const m = await mundoSano()
    const a = await m.secuenciaNueva(1)
    if (!a.resultado.ok) throw new Error(a.resultado.mensaje)
    const pasos = await m.pasos(a.resultado.inscripcionId)
    await m.actualizar('correo_secuencia_pasos', { estado: 'fallido', motivo: 'El servidor de correo no contesta' }, (q) => q.eq('id', pasos[1].id))
    const r = await vigilar(m)
    const filas = await campana(m)
    ok('un envío fallado avisa a los administradores', r.avisos === 1 && filas[0]?.title === 'Correo · Hay seguimientos que no han podido salir' && filas[0].user_id === UC, JSON.stringify(filas))
    // si la secuencia se cancela, ya no importa
    await m.actualizar('correo_secuencia_inscripciones', { estado: 'cancelada' }, (q) => q.eq('id', a.resultado.ok ? a.resultado.inscripcionId : ''))
    m.reloj.ahora += 13 * HORA
    await pasadaDelMotor(m, m.reloj.ahora - 20_000)
    await m.actualizar('correo_buzones', { ultimo_sync_at: m.iso(m.reloj.ahora - 2 * MIN) }, (q) => q.in('id', [B1, B2]))
    const despues = await vigilar(m)
    ok('un fallo de una secuencia que ya se canceló no cuenta', despues.alarmas === 0 && despues.avisos === 0, JSON.stringify(despues))
  }
  {
    const m = await mundoSano()
    await m.actualizar('correo_secuencia_buzones', { pausado_hasta: m.iso(m.reloj.ahora + 5 * HORA), motivo_pausa: 'Pausado a mano por un administrador.' }, (q) => q.eq('buzon_id', B2))
    const r = await vigilar(m)
    ok('un buzón en pausa a mano es una alarma ámbar de la pantalla y no molesta a nadie en la campana', r.alarmas === 1 && r.avisos === 0 && (await campana(m)).length === 0, JSON.stringify(r))
  }

  console.log('\n=== sin la migración 248 ===')
  {
    const m = await mundoSano()
    baseActual.tiposDeNotificacion.delete('alarma_correo')
    await m.actualizar('correo_buzones', { credenciales_invalidas: true }, (q) => q.eq('id', B1))
    const r = await vigilar(m)
    ok('la base rechaza el tipo: se dice que falta, no se rompe y no queda nada escrito', r.faltaMigracion === true && r.avisos === 0 && r.alarmas === 1 && (await m.leer('notifications')).length === 0, JSON.stringify(r))
    const antes = baseActual.registro.filter((c) => c.tabla === 'notifications' && c.op === 'insert').length
    m.reloj.ahora += 3 * MIN
    await pasadaDelMotor(m, m.reloj.ahora - 20_000)
    const otra = await vigilar(m)
    const despues = baseActual.registro.filter((c) => c.tabla === 'notifications' && c.op === 'insert').length
    ok('y no se vuelve a intentar escribir cada tres minutos', otra.faltaMigracion === true && despues === antes, `${antes} -> ${despues}`)
    baseActual.tiposDeNotificacion.add('alarma_correo')
    reiniciarLaCampana()
    const lanzada = await vigilar(m)
    ok('con la migración lanzada, vuelve a funcionar', lanzada.avisos === 2 && (await campana(m)).length === 2, JSON.stringify(lanzada))
  }

  console.log('\n=== la verificación de direcciones (MillionVerifier) ===')
  {
    /** La fila de ajustes de la verificación: encendida, con clave (cifrada, no se lee aquí) y lo que se diga */
    const verificacion = async (m: Mundo, f: Record<string, unknown> = {}) => m.sembrar('correo_verificacion_ajustes', { id: true, activa: true, clave_cifrada: 'v1.cifrada', creditos: 5000, ...f })
    const sinCreditos = (m: Mundo) => ({ creditos: 0, error_causa: 'sin_creditos', error_texto: 'Se han acabado los créditos.', error_at: m.iso(m.reloj.ahora - 5 * MIN) })

    const m = await mundoSano()
    await verificacion(m)
    const sana = await vigilar(m)
    ok('con la verificación sana no hay nada que avisar', sana.alarmas === 0 && sana.avisos === 0 && (await campana(m)).length === 0, JSON.stringify(sana))

    await m.actualizar('correo_verificacion_ajustes', sinCreditos(m), (q) => q.eq('id', true))
    const r = await vigilar(m)
    const filas = await campana(m)
    ok('sin créditos: una alarma, y el aviso llega a los administradores', r.alarmas === 1 && r.avisos === 1 && filas.length === 1 && filas[0].user_id === UC && /Se han acabado los créditos de MillionVerifier/.test(String(filas[0].title)), JSON.stringify([r, filas.map((f) => f.title)]))
    ok('NO le llega a los comerciales (no es de su buzón)', titulosDe(filas, UA).length === 0 && titulosDe(filas, UB).length === 0)
    ok('el mensaje dice dónde verlo', /Correo → Secuencias → Salud/.test(String(filas[0].message)) && /SIN comprobar/.test(String(filas[0].message)))
    m.reloj.ahora += 3 * MIN
    await pasadaDelMotor(m, m.reloj.ahora - 20_000)
    await m.actualizar('correo_buzones', { ultimo_sync_at: m.iso(m.reloj.ahora - 2 * MIN) }, (q) => q.in('id', [B1, B2]))
    const otra = await vigilar(m)
    ok('mientras siga igual no se repite el aviso cada tres minutos', otra.alarmas === 1 && otra.avisos === 0 && (await campana(m)).length === 1, JSON.stringify(otra))

    // Con el motor APAGADO la verificación sigue comprobando los primeros correos que se envían a mano: se avisa igualmente
    const apagado = await mundoSano({ activa: false })
    await verificacion(apagado, sinCreditos(apagado))
    const ra = await vigilar(apagado)
    const fa = await campana(apagado)
    ok('con el motor apagado, sin créditos: se avisa igualmente a los administradores', ra.alarmas === 1 && ra.avisos === 1 && fa.length === 1 && fa[0].user_id === UC && /verificación de direcciones/.test(String(ra.omitido)), JSON.stringify([ra, fa.length]))
    const rb = await vigilar(apagado)
    ok('…y tampoco se repite', rb.avisos === 0 && (await campana(apagado)).length === 1, JSON.stringify(rb))

    const apagadoSano = await mundoSano({ activa: false })
    await verificacion(apagadoSano)
    const rc = await vigilar(apagadoSano)
    ok('con el motor apagado y la verificación sana, no se mira nada más', rc.omitido === 'El motor está apagado' && rc.alarmas === 0 && rc.avisos === 0 && (await campana(apagadoSano)).length === 0, JSON.stringify(rc))

    const apagadoYSinVerificar = await mundoSano({ activa: false })
    await verificacion(apagadoYSinVerificar, { ...sinCreditos(apagadoYSinVerificar), activa: false })
    const rd = await vigilar(apagadoYSinVerificar)
    ok('si la verificación está apagada, su fallo viejo no avisa a nadie', rd.omitido === 'El motor está apagado' && rd.avisos === 0 && (await campana(apagadoYSinVerificar)).length === 0, JSON.stringify(rd))

    const sinClave = await mundoSano()
    await verificacion(sinClave, { ...sinCreditos(sinClave), clave_cifrada: null })
    const re = await vigilar(sinClave)
    ok('sin clave tampoco hay nada que vigilar', re.alarmas === 0 && re.avisos === 0, JSON.stringify(re))

    const pocos = await mundoSano()
    await verificacion(pocos, { creditos: 300 })
    const rf = await vigilar(pocos)
    ok('quedan pocos créditos: se avisa a los administradores (ámbar), antes de que se acaben', rf.alarmas === 1 && rf.avisos === 1 && /Quedan pocos créditos/.test(String((await campana(pocos))[0]?.title)), JSON.stringify(rf))

    const sinTabla = await mundoSano()
    baseActual.ausentes.add('correo_verificacion_ajustes')
    const rg = await vigilar(sinTabla)
    ok('sin la migración 256, nada cambia', rg.alarmas === 0 && rg.avisos === 0, JSON.stringify(rg))
  }

  void DIA
  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
