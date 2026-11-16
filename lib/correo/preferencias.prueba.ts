import {
  CODIGO_FALTA_318,
  FALTA_MIGRACION_318,
  avisaA,
  buzonesSoloPorRebotes,
  rebotesQueMeTocan,
  esFaltaDe318,
  buzonSilenciado,
  destinatariosDeRebote,
  enMisCorreos,
  estaSilenciado,
  filtrarAvisos,
  hastaDeDuracion,
  hiloSilenciado,
  misBuzonesQueAvisan,
  quienRecibeElAviso,
  validarPeticionDePreferencias,
  type Preferencia,
  type Silencios,
} from '@/lib/correo/preferencias'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const igual = (n: string, real: unknown, esperado: unknown) => ok(n, JSON.stringify(real) === JSON.stringify(esperado), `${JSON.stringify(real)} (esperaba ${JSON.stringify(esperado)})`)

const AHORA = Date.parse('2026-11-16T12:00:00Z')
const antes = new Date(AHORA - 60_000).toISOString()
const despues = new Date(AHORA + 60_000).toISOString()
const pref = (buzonId: string, p: Partial<Preferencia> = {}): Preferencia => ({ buzonId, enMisCorreos: null, orden: null, silenciado: false, silenciadoHasta: null, ...p })
const todosLeen = () => true

console.log('\n1. ¿Silenciado ahora?')
{
  ok('sin fila: no', !estaSilenciado(null, false, AHORA))
  ok('con fila y sin fecha: siempre', estaSilenciado(null, true, AHORA))
  ok('fecha futura: sí', estaSilenciado(despues, true, AHORA))
  ok('fecha vencida: ya no (vuelve a avisar sola)', !estaSilenciado(antes, true, AHORA))
  ok('fecha que no se entiende: como vencida', !estaSilenciado('mañana', true, AHORA))
  ok('buzón con silencio vencido: no silenciado', !buzonSilenciado(pref('b', { silenciado: true, silenciadoHasta: antes }), AHORA))
  ok('buzón silenciado para siempre', buzonSilenciado(pref('b', { silenciado: true }), AHORA))
  ok('casilla quitada aunque quede la fecha: no', !buzonSilenciado(pref('b', { silenciado: false, silenciadoHasta: despues }), AHORA))
}

console.log('\n2. «Mis correos» por defecto y elegido')
{
  ok('propio sin elegir: sí', enMisCorreos({ esMio: true, asignado: false }, undefined))
  ok('asignado sin elegir: sí', enMisCorreos({ esMio: false, asignado: true }, undefined))
  ok('del equipo sin elegir: no', !enMisCorreos({ esMio: false, asignado: false }, undefined))
  ok('del equipo añadido: sí', enMisCorreos({ esMio: false, asignado: false }, pref('b', { enMisCorreos: true })))
  ok('el dueño que se lo quita: no', !enMisCorreos({ esMio: true, asignado: false }, pref('b', { enMisCorreos: false })))
}

console.log('\n3. avisaA: la única regla')
{
  ok('dueño sin nada: avisa', avisaA({ esDueno: true, asignado: false, seguidor: false }, undefined, AHORA))
  ok('nadie (ni dueño, ni asignado, ni sigue): no', !avisaA({ esDueno: false, asignado: false, seguidor: false }, undefined, AHORA))
  ok('el dueño que se lo quita de Mis correos: no', !avisaA({ esDueno: true, asignado: false, seguidor: false }, pref('b', { enMisCorreos: false }), AHORA))
  ok('seguidor: avisa', avisaA({ esDueno: false, asignado: false, seguidor: true }, pref('b', { enMisCorreos: true }), AHORA))
  ok('asignado silenciado 8 h: no', !avisaA({ esDueno: false, asignado: true, seguidor: false }, pref('b', { silenciado: true, silenciadoHasta: despues }), AHORA))
  ok('asignado con el silencio vencido: vuelve a avisar', avisaA({ esDueno: false, asignado: true, seguidor: false }, pref('b', { silenciado: true, silenciadoHasta: antes }), AHORA))
  ok('«siempre»: nunca avisa', !avisaA({ esDueno: true, asignado: false, seguidor: false }, pref('b', { silenciado: true, silenciadoHasta: null }), AHORA))
}

console.log('\n4. misBuzonesQueAvisan y quienRecibeElAviso dicen lo mismo')
{
  // Patricia tiene asignado el buzón de Daniela, pero lo ha quitado de «Mis correos»
  const prefsPatricia = new Map([['b-daniela', pref('b-daniela', { enMisCorreos: false })]])
  igual('para Patricia, el buzón no avisa', misBuzonesQueAvisan([{ id: 'b-daniela', esMio: false, asignado: true }], prefsPatricia, AHORA), [])
  igual(
    'y la campana no se lo escribe a ella (sí a Daniela)',
    quienRecibeElAviso({
      duenoId: 'daniela',
      asignados: [{ personaId: 'patricia' }],
      seguidores: [],
      quitadoDeMisCorreos: ['patricia'],
      silenciadoPor: new Map(),
      puedeLeer: todosLeen,
      ahora: AHORA,
    }),
    ['daniela'],
  )

  // Y al revés: el mismo cruce cuando sí avisa
  igual('sin quitarlo, avisa a los dos lados', misBuzonesQueAvisan([{ id: 'b-daniela', esMio: false, asignado: true }], new Map(), AHORA), ['b-daniela'])
  igual(
    'y la campana se lo escribe',
    quienRecibeElAviso({ duenoId: 'daniela', asignados: [{ personaId: 'patricia' }], seguidores: [], silenciadoPor: new Map(), puedeLeer: todosLeen, ahora: AHORA }),
    ['daniela', 'patricia'],
  )

  // Cruce sistemático: para cada caso, las dos funciones coinciden sobre la persona
  const casos: Array<{ n: string; esDueno: boolean; asignado: boolean; p?: Preferencia }> = [
    { n: 'dueño', esDueno: true, asignado: false },
    { n: 'dueño que lo quita', esDueno: true, asignado: false, p: pref('b', { enMisCorreos: false }) },
    { n: 'dueño silenciado', esDueno: true, asignado: false, p: pref('b', { silenciado: true }) },
    { n: 'asignado', esDueno: false, asignado: true },
    { n: 'asignado silenciado vencido', esDueno: false, asignado: true, p: pref('b', { silenciado: true, silenciadoHasta: antes }) },
    { n: 'seguidor', esDueno: false, asignado: false, p: pref('b', { enMisCorreos: true }) },
    { n: 'seguidor silenciado', esDueno: false, asignado: false, p: pref('b', { enMisCorreos: true, silenciado: true, silenciadoHasta: despues }) },
    { n: 'del equipo sin seguir', esDueno: false, asignado: false },
  ]
  for (const c of casos) {
    const vista = misBuzonesQueAvisan([{ id: 'b', esMio: c.esDueno, asignado: c.asignado }], c.p ? new Map([['b', c.p]]) : new Map(), AHORA).includes('b')
    const campana = quienRecibeElAviso({
      duenoId: c.esDueno ? 'yo' : 'otra',
      asignados: c.asignado ? [{ personaId: 'yo' }] : [],
      seguidores: c.p?.enMisCorreos === true ? ['yo'] : [],
      quitadoDeMisCorreos: c.p?.enMisCorreos === false ? ['yo'] : [],
      silenciadoPor: c.p?.silenciado ? new Map([['yo', c.p.silenciadoHasta]]) : new Map(),
      puedeLeer: todosLeen,
      ahora: AHORA,
    }).includes('yo')
    ok(`cruce · ${c.n}: ${vista ? 'avisa' : 'no avisa'} en los dos`, vista === campana, `vista=${vista} campana=${campana}`)
  }
}

console.log('\n5. quienRecibeElAviso: quién pierde la lectura, repetidos y silencios')
{
  const r = quienRecibeElAviso({
    duenoId: 'ana',
    asignados: [{ personaId: 'patricia' }, { personaId: 'ana' }],
    seguidores: ['jose', 'patricia', 'maoli', 'raul'],
    silenciadoPor: new Map([['maoli', null]]),
    // José seguía el buzón, pero le han bloqueado: ya no lo lee
    puedeLeer: (id) => id !== 'jose',
    ahora: AHORA,
  })
  igual('dueña, asignada y seguidor; sin José (ya no lee), sin Maoli (silenciado) y sin repetir', r, ['ana', 'patricia', 'raul'])
  igual(
    'la dueña que se lo quita de Mis correos: no le llega',
    quienRecibeElAviso({ duenoId: 'ana', asignados: [], seguidores: [], quitadoDeMisCorreos: ['ana'], silenciadoPor: new Map(), puedeLeer: todosLeen, ahora: AHORA }),
    [],
  )
  igual(
    'silencio vencido: vuelve a llegar',
    quienRecibeElAviso({ duenoId: 'ana', asignados: [], seguidores: [], silenciadoPor: new Map([['ana', antes]]), puedeLeer: todosLeen, ahora: AHORA }),
    ['ana'],
  )
}

console.log('\n6. Rebotes: siempre al dueño, sin silencios')
{
  // Daniela tiene silenciado su buzón y el remitente mailer-daemon; Patricia envió el correo que rebotó
  const silenciosDaniela: Silencios = { hilos: new Map(), remitentes: new Map([['mailer-daemon@hostinger.com', null]]) }
  const rebote = { hilo_id: 'h1', de_direccion: 'MAILER-DAEMON@hostinger.com', rebote: true }
  const normal = { hilo_id: 'h2', de_direccion: 'mailer-daemon@hostinger.com', rebote: false }
  igual('el rebote de mailer-daemon silenciado sigue en la lista', filtrarAvisos([rebote, normal], silenciosDaniela, AHORA), [rebote])
  igual('buzón silenciado: el rebote va al dueño igual', destinatariosDeRebote({ duenoId: 'daniela', enviadoPor: null, puedeLeer: todosLeen }), ['daniela'])
  ok(
    '(mientras que un correo normal, con el buzón silenciado, no le llega)',
    quienRecibeElAviso({ duenoId: 'daniela', asignados: [], seguidores: [], silenciadoPor: new Map([['daniela', null]]), puedeLeer: todosLeen, ahora: AHORA }).length === 0,
  )
  igual('y a quien lo envió, si sigue leyendo', destinatariosDeRebote({ duenoId: 'daniela', enviadoPor: 'patricia', puedeLeer: todosLeen }), ['daniela', 'patricia'])
  igual('quien lo envió y ya no lee: solo el dueño', destinatariosDeRebote({ duenoId: 'daniela', enviadoPor: 'patricia', puedeLeer: (id) => id !== 'patricia' }), ['daniela'])
  igual('lo envió el dueño: una vez', destinatariosDeRebote({ duenoId: 'daniela', enviadoPor: 'daniela', puedeLeer: todosLeen }), ['daniela'])

  // El aviso de abajo a la derecha: un buzón silenciado (o fuera de «Mis correos») se sigue mirando por sus rebotes
  const buzonesDeDaniela = [
    { id: 'b-propio-silenciado', via: 'propio' as const },
    { id: 'b-propio-avisa', via: 'propio' as const },
    { id: 'b-asignado-fuera', via: 'asignado' as const },
    { id: 'b-seguido-silenciado', via: 'seguido' as const },
  ]
  igual(
    'buzones solo por rebotes: los propios y asignados que no avisan, nunca los seguidos',
    buzonesSoloPorRebotes(buzonesDeDaniela, ['b-propio-avisa']),
    ['b-propio-silenciado', 'b-asignado-fuera'],
  )
  const filas = [
    { id: 'r1', buzon_id: 'b-propio-silenciado', hilo_id: 'h1', rebote: true },
    { id: 'n1', buzon_id: 'b-propio-silenciado', hilo_id: 'h1', rebote: false },
    { id: 'r2', buzon_id: 'b-asignado-fuera', hilo_id: 'h2', rebote: true },
    { id: 'r3', buzon_id: 'b-asignado-fuera', hilo_id: 'h3', rebote: true },
  ]
  igual(
    'buzón propio silenciado: el rebote sale y el correo normal no',
    rebotesQueMeTocan(filas, { userId: 'daniela', propios: new Set(['b-propio-silenciado']), enviadoPorHilo: new Map() }).map((f) => f.id),
    ['r1'],
  )
  igual(
    'buzón asignado fuera de «Mis correos»: solo el rebote de lo que envió ella',
    rebotesQueMeTocan(filas, { userId: 'daniela', propios: new Set(), enviadoPorHilo: new Map([['h2', 'daniela'], ['h3', 'patricia']]) }).map((f) => f.id),
    ['r2'],
  )
  igual('sin saber quién mira, de un asignado ninguno', rebotesQueMeTocan(filas, { userId: '', propios: new Set(), enviadoPorHilo: new Map([['h2', '']]) }), [])
}

console.log('\n7. Hilos y remitentes')
{
  const s: Silencios = {
    hilos: new Map([
      ['h-siempre', null],
      ['h-vencido', antes],
      ['h-8h', despues],
    ]),
    remitentes: new Map([['ana@cliente.es', null]]),
  }
  ok('hilo silenciado para siempre', hiloSilenciado({ id: 'h-siempre', contraparteDireccion: 'x@y.es' }, s, AHORA))
  ok('hilo con silencio vencido: no', !hiloSilenciado({ id: 'h-vencido', contraparteDireccion: 'x@y.es' }, s, AHORA))
  ok('hilo con silencio en vigor', hiloSilenciado({ id: 'h-8h', contraparteDireccion: 'x@y.es' }, s, AHORA))
  ok('remitente silenciado (contraparte, sin mirar mayúsculas)', hiloSilenciado({ id: 'otro', contraparteDireccion: ' Ana@Cliente.es ' }, s, AHORA))
  ok('nada silenciado', !hiloSilenciado({ id: 'otro', contraparteDireccion: 'b@c.es' }, s, AHORA))
  const filas = [
    { hilo_id: 'h-siempre', de_direccion: 'b@c.es' },
    { hilo_id: 'h-vencido', de_direccion: 'b@c.es' },
    { hilo_id: 'h-otro', de_direccion: 'ANA@cliente.es' },
    { hilo_id: 'h-otro', de_direccion: 'b@c.es' },
    { hilo_id: 'h-siempre', de_direccion: 'b@c.es', tipo: 'respuesta_lead' },
    { hilo_id: 'h-siempre', de_direccion: 'ana@cliente.es', tipo: 'correo_asignado' },
    { hilo_id: 'h-siempre', de_direccion: 'b@c.es', tipo: 'secuencia_pausada' },
  ]
  igual(
    'filtrarAvisos: quita hilo y remitente (por de_direccion); deja los vencidos y los tipos que no se silencian',
    filtrarAvisos(filas, s, AHORA).map((f) => `${f.hilo_id}/${f.de_direccion}/${(f as { tipo?: string }).tipo ?? ''}`),
    ['h-vencido/b@c.es/', 'h-otro/b@c.es/', 'h-siempre/b@c.es/respuesta_lead', 'h-siempre/ana@cliente.es/correo_asignado', 'h-siempre/b@c.es/secuencia_pausada'],
  )
}

console.log('\n8. Duraciones (Europe/Madrid)')
{
  const a = new Date('2026-11-16T12:00:00Z') // 13:00 en Madrid (invierno)
  igual('8 h', hastaDeDuracion('8h', a), '2026-11-16T20:00:00.000Z')
  igual('mañana a las 8:00 de Madrid (invierno, UTC+1)', hastaDeDuracion('manana', a), '2026-11-17T07:00:00.000Z')
  igual('a las 00:30 de Madrid sigue siendo «mañana» del calendario', hastaDeDuracion('manana', new Date('2026-11-16T23:30:00Z')), '2026-11-18T07:00:00.000Z')
  igual('en verano (UTC+2)', hastaDeDuracion('manana', new Date('2026-07-10T10:00:00Z')), '2026-07-11T06:00:00.000Z')
  igual('la noche del cambio de hora de octubre', hastaDeDuracion('manana', new Date('2026-10-24T20:00:00Z')), '2026-10-25T07:00:00.000Z')
  igual('la noche del cambio de hora de marzo', hastaDeDuracion('manana', new Date('2026-03-28T20:00:00Z')), '2026-03-29T06:00:00.000Z')
  igual('fin de mes y de año', hastaDeDuracion('manana', new Date('2026-12-31T15:00:00Z')), '2027-01-01T07:00:00.000Z')
  igual('1 semana', hastaDeDuracion('semana', a), '2026-11-23T12:00:00.000Z')
  igual('siempre = null', hastaDeDuracion('siempre', a), null)
}

console.log('\n9. Validar la petición')
{
  const B = '11111111-1111-4111-8111-111111111111'
  const v = validarPeticionDePreferencias({
    cambios: [
      { buzonId: B.toUpperCase(), enMisCorreos: true, silencio: '8h' },
      { remitente: '  Mailer-Daemon@Hostinger.com ', silencio: 'siempre' },
    ],
  })
  igual('buena: ids y direcciones en minúsculas', v, {
    ok: true,
    cambios: [
      { buzonId: B, enMisCorreos: true, silencio: '8h' },
      { remitente: 'mailer-daemon@hostinger.com', silencio: 'siempre' },
    ],
  })
  ok('enMisCorreos null (volver a lo de por defecto) vale', validarPeticionDePreferencias({ cambios: [{ buzonId: B, enMisCorreos: null }] }).ok)
  ok('quitar silencio vale', validarPeticionDePreferencias({ cambios: [{ buzonId: B, silencio: 'quitar' }] }).ok)
  const mal = (n: string, e: unknown) => ok(n, !validarPeticionDePreferencias(e).ok)
  mal('sin cuerpo', null)
  mal('sin cambios', { cambios: [] })
  mal('51 cambios', { cambios: Array.from({ length: 51 }, (_, i) => ({ remitente: `a${i}@b.es`, silencio: '8h' })) })
  ok('50 cambios sí', validarPeticionDePreferencias({ cambios: Array.from({ length: 50 }, (_, i) => ({ remitente: `a${i}@b.es`, silencio: '8h' })) }).ok)
  mal('buzón que no es un UUID', { cambios: [{ buzonId: 'abc', enMisCorreos: true }] })
  mal('buzón repetido', { cambios: [{ buzonId: B, enMisCorreos: true }, { buzonId: B, silencio: '8h' }] })
  mal('cambio que no cambia nada', { cambios: [{ buzonId: B }] })
  mal('duración inventada', { cambios: [{ buzonId: B, silencio: '3 días' }] })
  mal('orden no entero', { cambios: [{ buzonId: B, orden: 1.5 }] })
  mal('remitente sin @', { cambios: [{ remitente: 'ana', silencio: '8h' }] })
  mal('remitente que empieza por @', { cambios: [{ remitente: '@cliente.es', silencio: '8h' }] })
  mal('remitente de 321 caracteres', { cambios: [{ remitente: `${'a'.repeat(310)}@cliente.es`, silencio: '8h' }] })
  ok('remitente de 320 caracteres sí', validarPeticionDePreferencias({ cambios: [{ remitente: `${'a'.repeat(309)}@cliente.es`, silencio: '8h' }] }).ok)
  mal('remitente sin duración', { cambios: [{ remitente: 'a@b.es' }] })
  mal('remitente repetido (con mayúsculas)', { cambios: [{ remitente: 'a@b.es', silencio: '8h' }, { remitente: 'A@B.es', silencio: 'quitar' }] })
  mal('buzón y remitente a la vez', { cambios: [{ buzonId: B, remitente: 'a@b.es', silencio: '8h' }] })
}

console.log('\n¿Es de verdad «falta la 318»?')
{
  ok('503 con el código: sí', esFaltaDe318({ estado: 503, mensaje: 'lo que sea', extra: { codigo: CODIGO_FALTA_318 } }))
  ok('503 con la frase exacta (rutas que solo mandan el texto): sí', esFaltaDe318({ estado: 503, mensaje: FALTA_MIGRACION_318, extra: {} }))
  ok('503 del proxy mientras se reinicia tras desplegar: NO', !esFaltaDe318({ estado: 503, mensaje: 'Algo ha fallado. Inténtalo de nuevo.', extra: {} }))
  ok('503 de otra migración que falta: NO', !esFaltaDe318({ estado: 503, mensaje: 'Falta lanzar la migración 255…', extra: { codigo: 'FALTA_MIGRACION_CORREO' } }))
  ok('un 500 con el código no cuenta', !esFaltaDe318({ estado: 500, mensaje: FALTA_MIGRACION_318, extra: { codigo: CODIGO_FALTA_318 } }))
}

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
