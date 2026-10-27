import { nuevaBase } from '@/lib/correo/secuencias/cliente-falso'
import { ejecutarPasada } from '@/lib/correo/secuencias/motor'
import { B1, B2, HORA, MIN, T0, UA, UB, UC, crearMundo, type Entorno, type Mundo } from '@/lib/correo/secuencias/mundo-de-pruebas'
import type { Servicio } from '../contexto'
import type { ContextoMcp } from '../contexto'
import { fallaCon, usar } from './datos-de-pruebas'
import { correoCola, correoEnvios, elegirBuzon, horaDeMinutos, quienDelConector, secuenciasDeUnLead } from './secuencias'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const entorno: Entorno = {
  async nuevo(reloj) {
    const { base, service } = nuevaBase(reloj)
    base.sembrar('correo_secuencias', { nombre: 'Prospección', es_base: true, activa: true, pasos: [{ orden: 1, dias: 3 }, { orden: 2, dias: 7 }] })
    base.sembrar('correo_secuencia_ajustes', { id: true, activa: false, modo_ensayo: true })
    return { service, soloEnMemoria: { ausentes: base.ausentes } }
  },
}

/** El contexto del conector con la base y el reloj de un mundo de pruebas. Pregunta Raúl, administrador */
const contexto = (m: Mundo): ContextoMcp => ({ usuario: { id: UC, email: 'raul@libertyseller.com', rol: 'admin', clienteOAuth: 'prueba' }, servicio: m.service as unknown as Servicio, ahora: m.reloj.ahora })

async function main() {
  console.log('\n=== quién pregunta ===')
  {
    const m = await crearMundo(entorno)
    const q = quienDelConector(contexto(m))
    ok('es un administrador, sin permisos sueltos: ve todos los buzones por su rol', q.role === 'admin' && q.userId === UC && !q.tienePermisoCorreo && !q.tienePermisoEquipo)
    ok('las horas de la ventana de envío', horaDeMinutos(540) === '09:00' && horaDeMinutos(1020) === '17:00' && horaDeMinutos(605) === '10:05')
  }

  console.log('\n=== elegir un buzón por lo que se escribe ===')
  {
    const buzones = [
      { id: B1, direccion: 'ana@libertyseller.es', nombre: 'Ana López', propietario: { nombre: 'Ana' } },
      { id: B2, direccion: 'alejandro@libertyseller.es', nombre: 'Alejandro', propietario: { nombre: 'Alejandro' } },
    ]
    ok('por dueño', elegirBuzon(buzones, 'ana').id === B1 && elegirBuzon(buzones, 'ALEJANDRO').id === B2)
    ok('por dirección entera', elegirBuzon(buzones, 'alejandro@libertyseller.es').id === B2)
    ok('por id', elegirBuzon(buzones, B1.toUpperCase()).id === B1)
    const mensaje = (consulta: string) => {
      try {
        elegirBuzon(buzones, consulta)
        return ''
      } catch (e) {
        return e instanceof Error ? e.message : String(e)
      }
    }
    ok('un texto que vale para los dos: el error los lista', /varios buzones/.test(mensaje('libertyseller.es')) && /Ana/.test(mensaje('libertyseller.es')) && /Alejandro/.test(mensaje('libertyseller.es')))
    ok('uno que no vale para ninguno: el error lista los que hay', /No hay ningún buzón de «zzz»/.test(mensaje('zzz')) && /ana@libertyseller\.es/.test(mensaje('zzz')))
  }

  console.log('\n=== correo_envios ===')
  {
    const m = await crearMundo(entorno, { activa: true, ensayo: false })
    const a1 = await m.secuenciaNueva(1)
    const a2 = await m.secuenciaNueva(2)
    const b1 = await m.secuenciaNueva(3, { buzon: B2 })
    if (!a1.resultado.ok || !a2.resultado.ok || !b1.resultado.ok) throw new Error('alta')
    for (let i = 0; i < 3; i++) await m.saliente({ para: `x${i}@y.es`, messageId: `mano-${i}@libertyseller.es`, cuando: T0 + i * MIN })
    m.reloj.ahora = T0 + HORA
    const ctx = contexto(m)

    const r = await usar(correoEnvios, ctx)
    ok('el motor, encendido y enviando de verdad', /real/.test(r.motor.modo) && /09:00/.test(r.motor.ventana_de_envio))
    ok('los dos buzones, cada uno con su dueño', r.hoy.por_buzon.length === 2 && r.hoy.por_buzon.some((b: any) => /^Ana/.test(b.buzon)) && r.hoy.por_buzon.some((b: any) => /^Alejandro/.test(b.buzon)))
    const ana = r.hoy.por_buzon.find((b: any) => /^Ana/.test(b.buzon))
    ok('lo enviado hoy a mano (3 sueltos + los 2 primeros de sus secuencias) y su tope', ana.de_ellos_a_mano === 5 && ana.enviados_hoy === 5 && ana.tope_del_dia === 150 && ana.secuencias_vivas === 2)
    ok('totales del día: 3 a mano y los primeros correos de las 3 secuencias', r.hoy.enviados === 6 && r.hoy.dia === '2026-10-28')
    ok('las secuencias por estado, con el nombre de la pantalla', r.secuencias_por_estado['En marcha'] === 3)
    ok('lo programado en los próximos días: 3 seguimientos el lunes 2 y 3 el viernes 6', r.proximos_dias.length === 5 && r.proximos_dias.reduce((s: number, d: any) => s + d.programados, 0) === 3 && (await usar(correoEnvios, ctx, { dias: 10 })).proximos_dias.reduce((s: number, d: any) => s + d.programados, 0) === 6)
    ok('los últimos 30 días', r.ultimos_30_dias.secuencias === 3 && r.ultimos_30_dias.vivas === 3)
    ok('la salud, con su nivel y resumen', typeof r.salud.nivel === 'string' && typeof r.salud.resumen === 'string' && Array.isArray(r.salud.alarmas))
    ok('lo que ha pasado, lo más reciente', Array.isArray(r.actividad_reciente) && r.actividad_reciente.length > 0 && r.actividad_reciente.length <= 15)
    ok('y las respuestas de leads a cero mientras nadie contesta', r.respuestas_de_los_leads_30_dias.leidas_por_la_ia === 0)

    const soloAna = await usar(correoEnvios, ctx, { buzon: 'ana' })
    ok('un buzón por el nombre de su dueño', soloAna.hoy.por_buzon.length === 1 && /^Ana/.test(soloAna.hoy.por_buzon[0].buzon))
    const soloAle = await usar(correoEnvios, ctx, { buzon: 'alejandro@libertyseller.es' })
    ok('o por su dirección', soloAle.hoy.por_buzon.length === 1)
    ok('con menos días', (await usar(correoEnvios, ctx, { dias: 2 })).proximos_dias.length === 2)
    ok('un buzón que no existe: el error lista los que hay', /Ana/.test((await fallaCon(correoEnvios, ctx, { buzon: 'pepito' })) ?? ''))
    ok('un número de días fuera de rango, error', /entre 1 y 10/.test((await fallaCon(correoEnvios, ctx, { dias: 99 })) ?? ''))

    // Una respuesta de un lead, leída por la IA
    m.reloj.ahora = T0 + 2 * HORA
    m.clasificaciones.push({ clase: 'no_interesa', confianza: 'alta', evidencia: 'no nos interesa', resumen: 'No les interesa.', fecha: null })
    await m.entrante({ de: a1.email, hilo: a1.hiloId, texto: 'Gracias, pero ahora mismo no nos interesa.', cuando: T0 + 2 * HORA - MIN })
    await ejecutarPasada(m.deps)
    const conRespuesta = await usar(correoEnvios, contexto(m))
    ok('lo que contestan los leads, leído por la IA, con la clase', conRespuesta.respuestas_de_los_leads_30_dias.leidas_por_la_ia === 1 && conRespuesta.respuestas_de_los_leads_30_dias.por_clase.length === 1)
    ok('y la secuencia cortada sale en los motivos', conRespuesta.ultimos_30_dias.por_que_se_cortaron.length >= 1)
  }
  {
    const apagado = await crearMundo(entorno, { activa: false, ensayo: true })
    ok('motor apagado: lo dice con todas las letras', /apagado/.test((await usar(correoEnvios, contexto(apagado))).motor.modo))
    const ensayo = await crearMundo(entorno, { activa: true, ensayo: true })
    ok('en ensayo: avisa de que NO envía de verdad', /ENSAYO/.test((await usar(correoEnvios, contexto(ensayo))).motor.modo) && /no envía de verdad/.test((await usar(correoEnvios, contexto(ensayo))).motor.modo))
    const sin = await crearMundo(entorno)
    sin.ausentes?.add('correo_secuencia_ajustes')
    const r = await usar(correoEnvios, contexto(sin))
    ok('sin la migración 245, no es un error: se dice cuál falta', r.disponible === false && /245_correo_secuencias\.sql/.test(r.aviso))
    const sinTabla = await crearMundo(entorno)
    sinTabla.ausentes?.add('correo_secuencia_pasos')
    const t = await usar(correoEnvios, contexto(sinTabla))
    ok('si falta otra tabla de secuencias, el mismo aviso y no un error', t.disponible === false && /245/.test(t.aviso))
  }

  console.log('\n=== correo_cola ===')
  {
    const m = await crearMundo(entorno, { activa: true, ensayo: false })
    const a1 = await m.secuenciaNueva(1)
    const a2 = await m.secuenciaNueva(2)
    const b1 = await m.secuenciaNueva(3, { buzon: B2 })
    if (!a1.resultado.ok || !a2.resultado.ok || !b1.resultado.ok) throw new Error('alta')
    m.reloj.ahora = T0 + HORA
    const ctx = contexto(m)

    const vivas = await usar(correoCola, ctx)
    ok('por defecto, las vivas: las tres', vivas.grupo === 'vivas' && vivas.total === 3 && vivas.secuencias.length === 3)
    const s = vivas.secuencias[0]
    ok('cada una: lead, comercial, estado y cuántos correos han salido', typeof s.lead === 'string' && typeof s.comercial === 'string' && s.estado === 'En marcha' && /^1 de 3 \(contando el primero/.test(s.correos_enviados))
    ok('con sus correos: el primero (de la persona, ya enviado) y los dos seguimientos programados', s.correos.length === 3 && s.correos[0].correo === 'primero (lo envió la persona)' && s.correos[0].estado === 'Enviado' && s.correos[1].correo === 'seguimiento 1' && s.correos[1].estado === 'Programado' && !!s.correos[1].programado)
    ok('y el siguiente que saldrá', s.siguiente && s.siguiente.correo === 'seguimiento 1' && !!s.siguiente.cuando)
    ok('los ids son los que luego se piden', /^[0-9a-f-]{36}$/.test(s.secuencia_id) && /^[0-9a-f-]{36}$/.test(s.lead_id))

    ok('las terminadas: ninguna todavía', (await usar(correoCola, ctx, { grupo: 'terminadas' })).total === 0)
    ok('todas', (await usar(correoCola, ctx, { grupo: 'todas' })).total === 3)
    ok('por buzón', (await usar(correoCola, ctx, { buzon: 'alejandro' })).total === 1 && (await usar(correoCola, ctx, { buzon: 'ana' })).total === 2)
    ok('por el nombre del lead', (await usar(correoCola, ctx, { texto: 'Tienda 1' })).total >= 1)
    ok('por la dirección a la que se escribe', (await usar(correoCola, ctx, { texto: a1.email })).total === 1)
    const p = await usar(correoCola, ctx, { limite: 2 })
    const p1 = await usar(correoCola, ctx, { limite: 2, pagina: 1 })
    ok('paginación', p.secuencias.length === 2 && p.hay_mas && p.siguiente_pagina === 1 && p1.secuencias.length === 1 && !p1.hay_mas)

    const id = a1.resultado.inscripcionId
    const d = await usar(correoCola, ctx, { secuencia: id })
    ok('el detalle de una: sus seguimientos con el texto programado', d.secuencia_id === id && d.correos.length === 3 && d.correos.slice(1).every((c: any) => typeof c.texto_programado === 'string' && c.texto_programado.length > 10))
    ok('la historia de lo que ha pasado', Array.isArray(d.historia) && d.historia.some((e: any) => e.tipo === 'inscrita'))
    ok('sin respuesta del lead, nada', d.respuesta_del_lead === null)
    ok('el detalle de una que no existe, error', /No existe/.test((await fallaCon(correoCola, ctx, { secuencia: '00000000-0000-4000-8000-ffffffffffff' })) ?? ''))
    ok('un id que no es un id, error con el formato', /formato/.test((await fallaCon(correoCola, ctx, { secuencia: 'abc' })) ?? ''))
    ok('un grupo inválido, error', /vivas/.test((await fallaCon(correoCola, ctx, { grupo: 'xx' })) ?? ''))

    // Una respuesta leída por la IA aparece en el detalle
    m.reloj.ahora = T0 + 2 * HORA
    m.clasificaciones.push({ clase: 'no_interesa', confianza: 'alta', evidencia: 'no nos interesa', resumen: 'No les interesa.', fecha: null })
    await m.entrante({ de: a1.email, hilo: a1.hiloId, texto: 'Gracias, pero ahora mismo no nos interesa.', cuando: T0 + 2 * HORA - MIN })
    await ejecutarPasada(m.deps)
    const cerrada = await usar(correoCola, contexto(m), { secuencia: id })
    ok('tras contestar, el detalle trae lo que entendió la IA y por qué se cortó', cerrada.respuesta_del_lead.clase.length > 0 && /no nos interesa/.test(cerrada.respuesta_del_lead.evidencia) && cerrada.por_que !== null)
    const terminadas = await usar(correoCola, contexto(m), { grupo: 'terminadas' })
    ok('y pasa a las terminadas', terminadas.total === 1 && terminadas.secuencias[0].secuencia_id === id)

    ok('de un lead concreto, sus secuencias para la ficha', ((await secuenciasDeUnLead(m.service as unknown as Servicio, contexto(m), a1.leadId)) as any[]).length === 1)
    ok('y de uno sin secuencias, vacío', ((await secuenciasDeUnLead(m.service as unknown as Servicio, contexto(m), '00000000-0000-4000-8000-ffffffffffff')) as any[]).length === 0)

    const sin = await crearMundo(entorno)
    sin.ausentes?.add('correo_secuencia_inscripciones')
    ok('sin la migración 245, la cola avisa en vez de fallar', /245/.test(JSON.stringify(await usar(correoCola, contexto(sin)))))
    const sinLead = await crearMundo(entorno)
    sinLead.ausentes?.add('correo_secuencia_buzones')
    const f = (await secuenciasDeUnLead(sinLead.service as unknown as Servicio, contexto(sinLead), '00000000-0000-4000-8000-ffffffffffff')) as any
    ok('y para la ficha de un lead, el mismo aviso', f.disponible === false && /245/.test(f.aviso))
  }

  console.log('\n=== quién no ve nada que no deba ===')
  {
    const m = await crearMundo(entorno, { activa: true })
    await m.secuenciaNueva(1)
    const comoAna: ContextoMcp = { ...contexto(m), usuario: { id: UA, email: 'ana@libertyseller.com', rol: 'employee', clienteOAuth: 'prueba' } }
    const comoAle: ContextoMcp = { ...contexto(m), usuario: { id: UB, email: 'alejandro@libertyseller.com', rol: 'employee', clienteOAuth: 'prueba' } }
    // El conector solo lo abre un administrador (auth.ts), pero si alguna vez el rol fuera otro, la regla de Correo manda: cada uno su buzón
    ok('si quien pregunta no fuera administrador, vería solo su buzón (la regla de Correo, no una nueva)', (await usar(correoEnvios, comoAna)).hoy.por_buzon.length === 1 && (await usar(correoCola, comoAle)).total === 0 && (await usar(correoCola, comoAna)).total === 1)
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
