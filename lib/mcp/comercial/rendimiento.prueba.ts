import { sumarDias } from '@/lib/rendimiento/dia'
import type { FilaDiaria } from '@/lib/rendimiento/comparativa'
import { ErrorDeHerramienta } from '../protocolo'
import { ANA, MAOLI, MFER, crearDatos, fallaCon, usar } from './datos-de-pruebas'
import type { Persona } from './comun'
import { armarEquipo, cambiosDe, cifrasDe, estadoDeRinkel, periodoDe, rendimientoComercial, rendimientoEquipo, resumenCorto, type VinculoDeRinkel } from './rendimiento'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const mensajeDe = (f: () => unknown): string | null => {
  try {
    f()
    return null
  } catch (e) {
    return e instanceof ErrorDeHerramienta ? e.message : `OTRO ERROR: ${String(e)}`
  }
}

const HOY = '2026-10-27' // martes
const AHORA = Date.parse('2026-10-27T11:00:00.000Z')

const total = (e: Partial<ReturnType<typeof base>> = {}) => ({ ...base(), ...e })
function base() {
  return { llamadas: 0, intentos: 0, recibidas: 0, contestadas: 0, segundos: 0, conversaciones: 0, whatsapp: 0, whatsappApuntes: 0, correos: 0, correosApuntes: 0, respuestas: 0, citas: 0 }
}

async function main() {
  console.log('\n=== las cifras, con los nombres de la pantalla ===')
  {
    const c = cifrasDe(total({ llamadas: 20, intentos: 26, recibidas: 1, contestadas: 8, segundos: 1500, conversaciones: 3, whatsapp: 4, whatsappApuntes: 6, correos: 5, correosApuntes: 5, respuestas: 2, citas: 1 }))
    ok('llamadas hechas y intentos aparte', c.llamadas_hechas === 20 && c.intentos === 26)
    ok('tasa de contacto = contestadas / hechas', c.tasa_de_contacto_pct === 40)
    ok('el tiempo al teléfono en minutos', c.tiempo_al_telefono_min === 25)
    ok('whatsapp y correos son clientes; los apuntes, aparte', c.whatsapp === 4 && c.whatsapp_apuntes === 6 && c.correos === 5 && c.correos_apuntes === 5)
    ok('respuestas y citas agendadas', c.respuestas === 2 && c.citas_agendadas === 1)
    ok('sin llamadas no hay tasa (null, no 0 %)', cifrasDe(total()).tasa_de_contacto_pct === null)

    const igual = cambiosDe(total({ llamadas: 10 }), total({ llamadas: 10 }))
    ok('mismas cifras: «igual»', igual.llamadas_hechas === 'igual')
    const sinBase = cambiosDe(total({ llamadas: 10 }), null)
    ok('sin referencia con actividad: «sin referencia»', sinBase.llamadas_hechas === 'sin referencia')
    ok('sin referencia y sin actividad: «igual»', cambiosDe(total(), null).llamadas_hechas === 'igual')
    const sube = cambiosDe(total({ llamadas: 20 }), total({ llamadas: 10 }))
    ok('el doble: «+100 %»', /\+100/.test(sube.llamadas_hechas))
    ok('resumenCorto solo enseña lo que no es cero', JSON.stringify(Object.keys(resumenCorto(total({ llamadas: 3, citas: 1 })))) === JSON.stringify(['llamadas_hechas', 'citas_agendadas']))
  }

  console.log('\n=== el estado de Rinkel de cada comercial ===')
  {
    const vinculo = (e: Partial<VinculoDeRinkel> = {}): VinculoDeRinkel => ({ user_id: 'x', rinkel_usuario: 'x', ultimo_sync_at: new Date(AHORA - 10 * 60_000).toISOString(), ultimo_intento_at: null, ultimo_error: null, historico_completo: true, ...e })
    ok('sin vínculo: no cuenta y se dice', estadoDeRinkel(undefined, AHORA).vinculado === false && /no cuentan/.test(estadoDeRinkel(undefined, AHORA).aviso ?? ''))
    ok('al día: sin aviso', estadoDeRinkel(vinculo(), AHORA).aviso === null)
    ok('3 horas sin leer: avisa de lo atrasado', /3 h/.test(estadoDeRinkel(vinculo({ ultimo_sync_at: new Date(AHORA - 3 * 3_600_000).toISOString() }), AHORA).aviso ?? ''))
    ok('un fallo de lectura avisa', /falló/.test(estadoDeRinkel(vinculo({ ultimo_error: 'Rinkel rechazó la clave' }), AHORA).aviso ?? ''))
    ok('nunca leído, avisa', /Todavía no/.test(estadoDeRinkel(vinculo({ ultimo_sync_at: null }), AHORA).aviso ?? ''))
    ok('el texto del error se corta (no se vuelca)', (estadoDeRinkel(vinculo({ ultimo_error: 'e'.repeat(1000) }), AHORA).error ?? '').length === 200)
  }

  console.log('\n=== el periodo pedido ===')
  {
    const d = periodoDe({}, HOY)
    ok('por defecto, hoy', d.periodo.tipo === 'dia' && d.desde === HOY && d.hasta === HOY && d.etiqueta.length > 0)
    ok('«ayer» y un día con formato', periodoDe({ fecha: 'ayer' }, HOY).desde === '2026-10-26' && periodoDe({ fecha: '2026-10-20' }, HOY).desde === '2026-10-20')
    const s = periodoDe({ periodo: 'semana' }, HOY)
    ok('una semana en curso llega solo hasta hoy', s.desde === '2026-10-26' && s.hasta === HOY && s.laborables === 2)
    const pasada = periodoDe({ periodo: 'semana', fecha: '2026-10-21' }, HOY)
    ok('una semana pasada está entera', pasada.desde === '2026-10-19' && pasada.hasta === '2026-10-25' && pasada.laborables === 5)
    const m = periodoDe({ periodo: 'mes' }, HOY)
    ok('un mes en curso', m.desde === '2026-10-01' && m.hasta === HOY)
    ok('un periodo futuro es un error claro', /todavía no ha empezado/.test(mensajeDe(() => periodoDe({ fecha: '2026-11-15' }, HOY)) ?? ''))
    ok('un periodo desconocido, error con las opciones', /dia, semana, mes/.test(mensajeDe(() => periodoDe({ periodo: 'año' }, HOY)) ?? ''))
  }

  console.log('\n=== el resumen del equipo ===')
  {
    const equipo: Persona[] = [
      { id: ANA, nombre: 'Ana López', email: 'ana@x.es' },
      { id: MAOLI, nombre: 'Maoli Pérez', email: 'maoli@x.es' },
      { id: MFER, nombre: 'María Fernanda Ruiz', email: 'mf@x.es' },
    ]
    const fila = (user: string, dia: string, e: Partial<FilaDiaria>): FilaDiaria => ({ user_id: user, dia, realizadas: 0, intentos: 0, recibidas: 0, contestadas: 0, segundos: 0, conversaciones: 0, whatsapp: 0, whatsapp_apuntes: 0, correos: 0, correos_apuntes: 0, respuestas: 0, citas: 0, ...e })
    const filas: FilaDiaria[] = [
      fila(MAOLI, '2026-10-26', { realizadas: 10, intentos: 12, contestadas: 4, segundos: 600, conversaciones: 1, whatsapp: 2, whatsapp_apuntes: 3, correos: 1, correos_apuntes: 1, respuestas: 1 }),
      fila(MAOLI, '2026-10-27', { realizadas: 20, intentos: 26, recibidas: 1, contestadas: 8, segundos: 1500, conversaciones: 3, whatsapp: 4, whatsapp_apuntes: 6, correos: 5, correos_apuntes: 5, respuestas: 2, citas: 1 }),
      fila(MAOLI, '2026-10-20', { realizadas: 8, intentos: 9, contestadas: 2, segundos: 200 }),
      fila(MAOLI, '2026-10-13', { realizadas: 12, intentos: 14, contestadas: 3, segundos: 300 }),
      fila(MAOLI, '2026-10-06', { realizadas: 10, intentos: 11, contestadas: 3, segundos: 300 }),
      fila(MFER, '2026-10-27', { realizadas: 5, intentos: 5, contestadas: 1, segundos: 100, whatsapp: 1, whatsapp_apuntes: 1 }),
    ]
    const vinculos = new Map<string, VinculoDeRinkel>([
      [MAOLI, { user_id: MAOLI, rinkel_usuario: 'm', ultimo_sync_at: new Date(AHORA - 5 * 60_000).toISOString(), ultimo_intento_at: null, ultimo_error: null, historico_completo: true }],
      [ANA, { user_id: ANA, rinkel_usuario: 'a', ultimo_sync_at: new Date(AHORA - 6 * 3_600_000).toISOString(), ultimo_intento_at: null, ultimo_error: null, historico_completo: true }],
    ])
    const entrada = (p: Record<string, unknown>, desglose = false) => ({ periodo: periodoDe(p, HOY), hoy: HOY, ahora: AHORA, equipo, vinculos, filas, desglose, base: 'https://app.libertyseller.com/' })

    const dia = armarEquipo(entrada({ fecha: HOY })) as any
    ok('el total del equipo suma a todos', dia.equipo.llamadas_hechas === 25 && dia.equipo.intentos === 31 && dia.equipo.citas_agendadas === 1)
    ok('cada comercial lleva sus cifras', dia.comerciales.find((c: any) => c.id === MAOLI).llamadas_hechas === 20 && dia.comerciales.find((c: any) => c.id === MFER).llamadas_hechas === 5)
    ok('conserva el orden del equipo', dia.comerciales.map((c: any) => c.comercial).join('|') === 'Ana López|Maoli Pérez|María Fernanda Ruiz')
    ok('quien no tiene actividad se marca', dia.comerciales.find((c: any) => c.id === ANA).sin_actividad === true && dia.comerciales.find((c: any) => c.id === MAOLI).sin_actividad === false)
    ok('con qué se compara, dicho en una frase', typeof dia.con_que_se_compara === 'string' && dia.con_que_se_compara.length > 0)
    const maoli = dia.comerciales.find((c: any) => c.id === MAOLI)
    ok('la referencia del martes es la media de los martes anteriores: se nota en el cambio', typeof maoli.cambio_frente_a_la_referencia.llamadas_hechas === 'string' && maoli.cambio_frente_a_la_referencia.llamadas_hechas !== 'sin referencia')
    ok('llamadas por día laborable', maoli.llamadas_por_dia_laborable === 20)
    ok('el enlace lleva a su pantalla de Mi rendimiento', maoli.enlace === `https://app.libertyseller.com/dashboard/rendimiento?comercial=${MAOLI}&p=dia&f=${HOY}`)
    const alertas: string[] = dia.alertas
    ok('avisa de quien no tiene Rinkel', alertas.some((a) => /María Fernanda Ruiz: No tiene el Rinkel vinculado/.test(a)))
    ok('avisa de la lectura atrasada', alertas.some((a) => /Ana López: .*6 h/.test(a)))
    ok('avisa de quien tiene Rinkel y no hizo nada, pero no de quien no lo tiene', alertas.some((a) => /Sin actividad registrada.*Ana López/.test(a)) && !alertas.some((a) => /Sin actividad registrada.*María/.test(a)))
    ok('el día en curso se dice', dia.periodo.en_curso === true)
    ok('las reglas de las cifras viajan en la respuesta', Array.isArray(dia.reglas) && dia.reglas.length >= 4)
    ok('el día suelto no lleva titulares ni desglose', dia.titulares === undefined && dia.por_dia === undefined)

    const ayer = armarEquipo(entrada({ fecha: '2026-10-26' })) as any
    ok('un día pasado no está en curso', ayer.periodo.en_curso === false && ayer.equipo.llamadas_hechas === 10)

    const semana = armarEquipo(entrada({ periodo: 'semana' }, true)) as any
    ok('la semana suma lunes y martes', semana.equipo.llamadas_hechas === 35)
    ok('la semana lleva titulares escritos', Array.isArray(semana.titulares))
    ok('el desglose diario lista solo los días con actividad, en orden', semana.por_dia.length === 2 && semana.por_dia[0].dia === '2026-10-26' && semana.por_dia[1].dia === '2026-10-27')
    ok('y dentro, quién hizo qué ese día', semana.por_dia[1].comerciales['Maoli Pérez'].llamadas_hechas === 20 && semana.por_dia[1].comerciales['María Fernanda Ruiz'].llamadas_hechas === 5 && semana.por_dia[1].comerciales['Ana López'] === undefined)
    ok('el nombre del día de la semana', semana.por_dia[0].dia_de_la_semana === 'lunes')
  }

  console.log('\n=== las herramientas, con una base de mentira ===')
  {
    const d = crearDatos()
    const eq = await usar(rendimientoEquipo, d.ctx, { fecha: d.dia })
    ok('rendimiento_equipo suma lo que devuelve la base', eq.equipo.llamadas_hechas === 25 && eq.equipo.citas_agendadas === 1)
    ok('y lista a los tres comerciales por orden de nombre', eq.comerciales.map((c: any) => c.comercial).join('|') === 'Ana López|Maoli Pérez|María Fernanda Ruiz')
    ok('Maoli tiene Rinkel al día, Ana atrasado y María Fernanda ninguno', eq.comerciales[1].rinkel.aviso === null && /6 h/.test(eq.comerciales[0].rinkel.aviso) && eq.comerciales[2].rinkel.vinculado === false)
    ok('pidió la función del resumen y los vínculos, una vez cada uno', d.base.peticiones.filter((x) => x === 'rpc:rendimiento_resumen_diario').length === 1 && d.base.peticiones.filter((x) => x === 'rinkel_vinculos.select').length === 1)

    const otraSemana = await usar(rendimientoEquipo, d.ctx, { periodo: 'semana', fecha: d.dia, desglose_diario: true })
    ok('una semana con desglose', Array.isArray(otraSemana.por_dia) && otraSemana.por_dia.length >= 1)

    const futuro = await fallaCon(rendimientoEquipo, d.ctx, { fecha: sumarDias(d.hoy, 10) })
    ok('un periodo futuro es un error para el modelo', /todavía no ha empezado/.test(futuro ?? ''))

    const sin = crearDatos()
    sin.base.errores.set('profiles', { code: '42P01', message: 'x' })
    ok('si falta una tabla, dice que falta una migración (no un error genérico)', /migración/.test((await fallaCon(rendimientoEquipo, sin.ctx, { fecha: sin.dia })) ?? ''))

    const nueva = crearDatos()
    const sinRpc = crearDatos()
    ;(sinRpc.base.servicio as any).rpc = () => ({ range: async () => ({ data: null, error: { code: 'PGRST202', message: 'x' } }) })
    ok('sin la función de la base, nombra las migraciones 235 y 252', /235 y 252/.test((await fallaCon(rendimientoEquipo, sinRpc.ctx, { fecha: sinRpc.dia })) ?? ''))
    ok('el resto de datos no se toca en lecturas de prueba', nueva.base.peticiones.length === 0)

    const c = await usar(rendimientoComercial, d.ctx, { comercial: 'maoli', fecha: d.dia })
    ok('rendimiento_comercial: sus cifras del día', c.comercial === 'Maoli Pérez' && c.cifras.llamadas_hechas === 20)
    ok('sus llamadas, una a una: 4 salientes y 1 recibida', c.llamadas.salientes === 4 && c.llamadas.recibidas === 1)
    ok('de ellas, cómo acabaron', c.llamadas.contestadas === 2 && c.llamadas.contestador === 1 && c.llamadas.sin_contestar === 1)
    ok('solo una pasa del minuto: la de 2 minutos, con grabación', c.llamadas.conversaciones_de_un_minuto_o_mas === 1 && c.llamadas.con_grabacion === 1)
    ok('la hablada trae lo que se entendió de ella', c.llamadas_con_conversacion_total === 1 && /propuesta/.test(c.llamadas_con_conversacion[0].lo_que_se_entendio.resumen) && c.llamadas_con_conversacion[0].lo_que_se_entendio.interes === 'alto')
    ok('y a quién se llamó, por su nombre', c.llamadas_con_conversacion[0].cliente.startsWith('Lámparas Sol'))
    ok('sus apuntes, cliente a cliente: 3 conversaciones, una con respuesta', c.actividad_por_cliente_total === 3 && c.actividad_por_cliente.some((a: any) => a.el_cliente_contesto === true))
    ok('los comentarios llevan la hora y marcan la respuesta del cliente', c.actividad_por_cliente.some((a: any) => a.comentarios.some((x: string) => /\(respuesta del cliente\)/.test(x))))
    ok('las citas que agendó ese día', c.citas_agendadas.length === 1 && c.citas_agendadas[0].cliente === 'Carlos Sol')
    ok('su jornada: primera y última actividad', c.jornadas.length === 1 && /^\d\d:\d\d$/.test(c.jornadas[0].primera_actividad) && /^\d\d:\d\d$/.test(c.jornadas[0].ultima_actividad))
    ok('una nota avisa si hay más que no cabe', c.nota === null)
    const recortado = await usar(rendimientoComercial, d.ctx, { comercial: 'maoli', fecha: d.dia, max_apuntes: 1 })
    ok('con max_apuntes=1 se corta y lo dice', recortado.actividad_por_cliente.length === 1 && recortado.actividad_por_cliente_total === 3 && /cold_notas/.test(recortado.nota))
    const sinTrans = crearDatos({ sinTablas: ['rinkel_transcripciones'] })
    const c2 = await usar(rendimientoComercial, sinTrans.ctx, { comercial: 'maoli', fecha: sinTrans.dia })
    ok('sin la tabla de transcripciones (244) funciona igual, sin lo entendido', c2.llamadas_con_conversacion[0].lo_que_se_entendio === null)

    ok('un comercial que no existe: el error lista los que hay', /Maoli Pérez/.test((await fallaCon(rendimientoComercial, d.ctx, { comercial: 'pepito' })) ?? ''))
    ok('«mari» es María Fernanda (la única que lo contiene entre comerciales)', (await usar(rendimientoComercial, d.ctx, { comercial: 'fernanda', fecha: d.dia })).comercial === 'María Fernanda Ruiz')
    ok('sin decir quién, error', /Falta/.test((await fallaCon(rendimientoComercial, d.ctx, {})) ?? ''))
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
