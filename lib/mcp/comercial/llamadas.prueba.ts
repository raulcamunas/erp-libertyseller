import { sumarDias } from '@/lib/rendimiento/dia'
import { ANA, L_SOL, LL_CADUCADA, LL_CORTA, LL_CONTESTADOR, LL_DE_ANA, LL_HABLADA, LL_PERDIDA, LL_SIN_CONTESTAR, LL_VIEJA, MAOLI, a, crearDatos, fallaCon, usar, uuid } from './datos-de-pruebas'
import { armarTexto, coldLlamadas, coldTranscripcion, cumpleResultado, digitosParaBuscar, motivoSinTranscripcion, resumenDeLlamadas, type LlamadaLeida } from './llamadas'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const llamada = (e: Partial<LlamadaLeida> = {}): LlamadaLeida => ({ id: 'x', user_id: MAOLI, lead_id: null, fecha: '2026-10-27T10:00:00.000Z', direccion: 'outbound', estado: 'ANSWERED', duracion_s: 120, numero: '+34600112233', numero_anonimo: false, grabacion_id: null, grabacion_hasta: null, ...e })

async function main() {
  console.log('\n=== qué es cada resultado (las reglas de Mi rendimiento) ===')
  {
    ok('conversación: contestada de 60 s o más', cumpleResultado(llamada({ duracion_s: 60 }), 'conversaciones') && !cumpleResultado(llamada({ duracion_s: 59 }), 'conversaciones'))
    ok('contestada: 10 s o más', cumpleResultado(llamada({ duracion_s: 10 }), 'contestadas') && !cumpleResultado(llamada({ duracion_s: 9 }), 'contestadas'))
    ok('contestador: contestada de menos de 10 s', cumpleResultado(llamada({ duracion_s: 4 }), 'contestador') && !cumpleResultado(llamada({ duracion_s: 40 }), 'contestador'))
    ok('sin contestar: solo las salientes que no se cogieron', cumpleResultado(llamada({ estado: 'MISSED', duracion_s: 0 }), 'sin_contestar') && !cumpleResultado(llamada({ estado: 'MISSED', duracion_s: 0, direccion: 'inbound' }), 'sin_contestar') && !cumpleResultado(llamada({ duracion_s: 3 }), 'sin_contestar'))
    ok('perdidas: solo las recibidas que no se cogieron', cumpleResultado(llamada({ estado: 'MISSED', duracion_s: 0, direccion: 'inbound' }), 'perdidas') && !cumpleResultado(llamada({ estado: 'MISSED', duracion_s: 0 }), 'perdidas'))
    ok('todas', cumpleResultado(llamada({ estado: 'MISSED', duracion_s: 0 }), 'todas'))
    ok('los dígitos para buscar: sin prefijo y sin espacios', digitosParaBuscar('+34 600 11 22 33') === '600112233' && digitosParaBuscar('600112233') === '600112233' && digitosParaBuscar('6001') === '6001')
  }

  console.log('\n=== por qué una llamada no tiene transcripción ===')
  {
    const ahora = Date.parse('2026-10-27T12:00:00.000Z')
    const base = { grabacion_id: 'r', grabacion_hasta: '2026-12-01T00:00:00.000Z', estado: 'ANSWERED', duracion_s: 120, lead_id: 'l' }
    ok('sin grabación', /no tiene grabación/.test(motivoSinTranscripcion({ ...base, grabacion_id: null }, ahora)))
    ok('grabación caducada', /caducó/.test(motivoSinTranscripcion({ ...base, grabacion_hasta: '2026-10-01T00:00:00.000Z' }, ahora)))
    ok('demasiado corta o sin contestar', /20 segundos/.test(motivoSinTranscripcion({ ...base, duracion_s: 12 }, ahora)) && /20 segundos/.test(motivoSinTranscripcion({ ...base, estado: 'MISSED' }, ahora)))
    ok('sin lead enlazado', /enlazada con ningún lead/.test(motivoSinTranscripcion({ ...base, lead_id: null }, ahora)))
    ok('si cumple todo, es que todavía no ha tocado', /Todavía no está transcrita/.test(motivoSinTranscripcion(base, ahora)))
  }

  console.log('\n=== la conversación entera, con tope ===')
  {
    const turnos = [
      { quien: 'comercial', texto: 'a'.repeat(100) },
      { quien: 'cliente', texto: 'b'.repeat(100) },
      { quien: 'comercial', texto: 'c'.repeat(100) },
    ]
    const entera = armarTexto({ turnos, transcripcion: 'texto corrido' }, 1000) as any
    ok('por turnos, con «Comercial» y «Cliente»', entera.turnos.length === 3 && entera.turnos[0].quien === 'Comercial' && entera.turnos[1].quien === 'Cliente' && entera.recortada === null && entera.caracteres === 300)
    const corta = armarTexto({ turnos, transcripcion: null }, 150) as any
    ok('con tope, corta a mitad de un turno y lo dice con las cifras', corta.turnos.length === 2 && corta.turnos[1].texto.endsWith('…') && /de 300 caracteres/.test(corta.recortada))
    const justo = armarTexto({ turnos, transcripcion: null }, 200) as any
    ok('con un tope que cae justo al final de un turno, no inventa más', justo.turnos.length === 2 && justo.turnos[1].texto.length === 100)
    const corrida = armarTexto({ turnos: null, transcripcion: 'Hola. '.repeat(100) }, 100) as any
    ok('sin turnos, texto corrido recortado', corrida.forma.startsWith('texto corrido') && corrida.recortada !== null && corrida.texto.endsWith('…'))
    const vacios = armarTexto({ turnos: [], transcripcion: 'solo texto' }, 100) as any
    ok('turnos vacíos: texto corrido', vacios.texto === 'solo texto')
    const raros = armarTexto({ turnos: [{ quien: 'robot', texto: 'hola' }, { quien: 'cliente', texto: '   ' }, null as never], transcripcion: null }, 100) as any
    ok('un autor desconocido sale tal cual; los turnos vacíos o rotos no salen', raros.turnos.length === 1 && raros.turnos[0].quien === 'robot')
  }

  console.log('\n=== los totales de una lista de llamadas ===')
  {
    const lista = [
      llamada({ id: '1', duracion_s: 120, grabacion_id: 'r' }),
      llamada({ id: '2', duracion_s: 4 }),
      llamada({ id: '3', estado: 'MISSED', duracion_s: 0 }),
      llamada({ id: '4', estado: 'MISSED', duracion_s: 0, direccion: 'inbound' }),
      llamada({ id: '5', duracion_s: 30, direccion: 'inbound' }),
    ]
    const r = resumenDeLlamadas(lista, new Set(['1'])) as any
    ok('salientes y recibidas', r.llamadas === 5 && r.salientes === 3 && r.recibidas === 2)
    ok('contestadas, conversaciones y contestador', r.contestadas === 2 && r.conversaciones_de_un_minuto_o_mas === 1 && r.contestador === 1)
    ok('sin contestar y perdidas', r.salientes_sin_contestar === 1 && r.perdidas_recibidas === 1)
    ok('minutos al teléfono: solo las contestadas', r.minutos_al_telefono === 2.5)
    ok('con grabación y transcritas', r.con_grabacion === 1 && r.transcritas === 1)
  }

  console.log('\n=== cold_llamadas ===')
  {
    const d = crearDatos()
    const r = await usar(coldLlamadas, d.ctx)
    ok('sin fechas: los últimos 7 días (7 llamadas; la de hace 20 días no)', r.resumen.llamadas === 7 && !r.llamadas.some((l: any) => l.llamada_id === LL_VIEJA))
    ok('los totales de todo lo filtrado', r.resumen.salientes === 6 && r.resumen.recibidas === 1 && r.resumen.contestadas === 4 && r.resumen.conversaciones_de_un_minuto_o_mas === 3 && r.resumen.contestador === 1 && r.resumen.salientes_sin_contestar === 1 && r.resumen.perdidas_recibidas === 1)
    ok('minutos al teléfono, grabaciones y transcripciones', r.resumen.minutos_al_telefono === 9.3 && r.resumen.con_grabacion === 2 && r.resumen.transcritas === 1)
    ok('de la más reciente a la más antigua', r.llamadas.every((l: any, i: number) => i === 0 || r.llamadas[i - 1].cuando >= l.cuando))
    const hablada = r.llamadas.find((l: any) => l.llamada_id === LL_HABLADA)
    ok('la hablada: comercial, lead, teléfono legible, minutos y resultado', hablada.comercial === 'Maoli Pérez' && hablada.cliente === 'Lámparas Sol (Lámparas Sol SL)' && hablada.lead_id === L_SOL && hablada.telefono === '+34 600 11 22 33' && hablada.minutos === 2 && hablada.resultado === 'conversación' && hablada.sentido === 'saliente')
    ok('con grabación y lo entendido', hablada.grabacion === 'sí' && hablada.transcripcion.estado === 'hecha' && hablada.transcripcion.interes === 'Interés alto')
    const caducada = r.llamadas.find((l: any) => l.llamada_id === LL_CADUCADA)
    ok('la de grabación caducada lo dice y su transcripción falló', /caducada/.test(caducada.grabacion) && caducada.transcripcion.estado === 'fallida')
    const ana = r.llamadas.find((l: any) => l.llamada_id === LL_DE_ANA)
    ok('un número oculto no se inventa', ana.cliente === 'número oculto' && ana.telefono === null && ana.comercial === 'Ana López')
    ok('la perdida es recibida', r.llamadas.find((l: any) => l.llamada_id === LL_PERDIDA).sentido === 'recibida' && r.llamadas.find((l: any) => l.llamada_id === LL_PERDIDA).resultado === 'perdida')
    ok('contestador y sin contestar', r.llamadas.find((l: any) => l.llamada_id === LL_CONTESTADOR).resultado === 'contestador' && r.llamadas.find((l: any) => l.llamada_id === LL_SIN_CONTESTAR).resultado === 'sin contestar')
    ok('contestada corta', r.llamadas.find((l: any) => l.llamada_id === LL_CORTA).resultado === 'contestada (corta)')

    ok('por comercial', (await usar(coldLlamadas, d.ctx, { comercial: 'maoli' })).resumen.llamadas === 6 && (await usar(coldLlamadas, d.ctx, { comercial: 'ana' })).resumen.llamadas === 1)
    ok('por sentido', (await usar(coldLlamadas, d.ctx, { sentido: 'recibidas' })).resumen.llamadas === 1 && (await usar(coldLlamadas, d.ctx, { sentido: 'salientes' })).resumen.llamadas === 6)
    for (const [resultado, n] of [['conversaciones', 3], ['contestadas', 4], ['contestador', 1], ['sin_contestar', 1], ['perdidas', 1]] as const) {
      ok(`por resultado «${resultado}»: ${n}`, (await usar(coldLlamadas, d.ctx, { resultado })).resumen.llamadas === n)
    }
    ok('solo con grabación', (await usar(coldLlamadas, d.ctx, { con_grabacion: true })).resumen.llamadas === 2)
    ok('solo transcritas', (await usar(coldLlamadas, d.ctx, { con_transcripcion: true })).llamadas.map((l: any) => l.llamada_id).join() === LL_HABLADA)
    ok('por lead (nombre): las de los dos «Lámparas Sol»', (await usar(coldLlamadas, d.ctx, { lead: 'Lámparas Sol' })).resumen.llamadas === 2)
    ok('por lead (id)', (await usar(coldLlamadas, d.ctx, { lead: L_SOL })).llamadas.map((l: any) => l.llamada_id).join() === LL_HABLADA)
    ok('por teléfono, con o sin prefijo y espacios', (await usar(coldLlamadas, d.ctx, { telefono: '611223344' })).resumen.llamadas === 2 && (await usar(coldLlamadas, d.ctx, { telefono: '+34 611 22 33 44' })).resumen.llamadas === 2)
    ok('por días: con 30 días se ve la vieja', (await usar(coldLlamadas, d.ctx, { desde: sumarDias(d.hoy, -30), comercial: 'maoli' })).llamadas.some((l: any) => l.llamada_id === LL_VIEJA))

    const p0 = await usar(coldLlamadas, d.ctx, { limite: 3 })
    const p2 = await usar(coldLlamadas, d.ctx, { limite: 3, pagina: 2 })
    ok('paginación', p0.llamadas.length === 3 && p0.hay_mas && p0.siguiente_pagina === 1 && p2.llamadas.length === 1 && !p2.hay_mas && p0.total === 7)
    ok('los totales no dependen de la página', p0.resumen.llamadas === 7 && p2.resumen.llamadas === 7)

    ok('un rango de más de 31 días sin filtrar, error que dice el máximo', /31/.test((await fallaCon(coldLlamadas, d.ctx, { desde: sumarDias(d.hoy, -60) })) ?? ''))
    ok('con comercial se permiten hasta 92', (await fallaCon(coldLlamadas, d.ctx, { desde: sumarDias(d.hoy, -60), comercial: 'maoli' })) === null)
    ok('un teléfono con menos de 4 dígitos, error', /4 dígitos/.test((await fallaCon(coldLlamadas, d.ctx, { telefono: '12' })) ?? ''))
    ok('un resultado inválido, error con las opciones', /conversaciones/.test((await fallaCon(coldLlamadas, d.ctx, { resultado: 'xx' })) ?? ''))
    ok('un lead que no existe, error', /No hay ningún lead/.test((await fallaCon(coldLlamadas, d.ctx, { lead: 'zzzzzz' })) ?? ''))

    const sin = crearDatos({ sinTablas: ['rinkel_transcripciones'] })
    const s = await usar(coldLlamadas, sin.ctx)
    ok('sin las transcripciones (244) se listan igual, sin nada transcrito', s.resumen.llamadas === 7 && s.resumen.transcritas === 0)
    const sinL = crearDatos({ sinTablas: ['rinkel_llamadas'] })
    ok('sin la tabla de llamadas, dice que falta una migración', /migración/.test((await fallaCon(coldLlamadas, sinL.ctx)) ?? ''))
    ok('es solo lectura', d.base.peticiones.every((x) => x.endsWith('.select')))
  }

  console.log('\n=== cold_transcripcion ===')
  {
    const d = crearDatos()
    const t = await usar(coldTranscripcion, d.ctx, { llamada_id: LL_HABLADA })
    ok('la cabecera: cuándo, quién, a quién, cuánto', t.comercial === 'Maoli Pérez' && t.cliente === 'Lámparas Sol (Lámparas Sol SL)' && t.minutos === 2 && t.resultado === 'conversación')
    ok('resumen, interés y siguiente paso', t.estado === 'hecha' && t.tipo === 'conversacion' && t.interes === 'Interés alto' && /propuesta/.test(t.resumen) && t.siguiente_paso === 'Enviar propuesta antes del viernes')
    ok('los momentos clave con «Comercial» y «Cliente»', t.momentos_clave.length === 2 && t.momentos_clave[0].quien === 'Comercial' && t.momentos_clave[1].quien === 'Cliente')
    ok('la conversación por turnos', t.conversacion.turnos.length === 3 && t.conversacion.turnos[0].quien === 'Comercial' && /Lámparas Sol/.test(t.conversacion.turnos[0].texto))
    ok('sin cortar si cabe', t.conversacion.recortada === null)

    const fallida = await usar(coldTranscripcion, d.ctx, { llamada_id: LL_CADUCADA })
    ok('una transcripción fallida lo dice, con el motivo', fallida.transcripcion === null && fallida.estado === 'fallida' && /falló/.test(fallida.por_que) && /grabación/.test(fallida.por_que))
    const sinGrabar = await usar(coldTranscripcion, d.ctx, { llamada_id: LL_CORTA })
    ok('una llamada sin grabación dice por qué no hay nada', sinGrabar.transcripcion === null && sinGrabar.estado === 'sin transcribir' && /no tiene grabación/.test(sinGrabar.por_que))

    // Una llamada que cumple todo y todavía no se ha transcrito
    const nueva = crearDatos()
    const id = uuid('c', 50)
    nueva.base.tablas.get('rinkel_llamadas')!.push({ id, user_id: MAOLI, rinkel_id: 'rk-50', fecha: a(nueva.dia, '09:00'), direccion: 'outbound', estado: 'ANSWERED', duracion_s: 200, lead_id: L_SOL, numero: '+34600112233', numero_anonimo: false, grabacion_id: 'rec-50', grabacion_hasta: new Date(Date.now() + 86_400_000).toISOString() })
    const pendiente = await usar(coldTranscripcion, nueva.ctx, { llamada_id: id })
    ok('una que cumple todo: «todavía no está transcrita»', /Todavía no está transcrita/.test(pendiente.por_que))
    nueva.base.tablas.get('rinkel_transcripciones')!.push({ llamada_id: id, user_id: MAOLI, estado: 'procesando', motivo: null })
    ok('una que se está haciendo, también lo dice', /ahora mismo/.test((await usar(coldTranscripcion, nueva.ctx, { llamada_id: id })).por_que))

    const sin253 = crearDatos({ columnas: { rinkel_transcripciones: ['llamada_id', 'user_id', 'estado', 'motivo', 'tipo', 'resumen', 'linea', 'siguiente_paso', 'interes', 'transcripcion', 'idioma', 'segundos_audio'] } })
    const corrida = await usar(coldTranscripcion, sin253.ctx, { llamada_id: LL_HABLADA })
    ok('sin la migración 253 (turnos), la lee igual como texto corrido', corrida.estado === 'hecha' && corrida.conversacion.forma.startsWith('texto corrido') && /Lámparas Sol/.test(corrida.conversacion.texto))

    const sin244 = crearDatos({ sinTablas: ['rinkel_transcripciones'] })
    const nada = await usar(coldTranscripcion, sin244.ctx, { llamada_id: LL_HABLADA })
    ok('sin la tabla de transcripciones (244), no es un error: no hay transcripción', nada.transcripcion === null && nada.estado === 'sin transcribir')

    ok('un id que no es un id, error', /formato/.test((await fallaCon(coldTranscripcion, d.ctx, { llamada_id: '123' })) ?? ''))
    ok('un id que no existe, error', /No existe ninguna llamada/.test((await fallaCon(coldTranscripcion, d.ctx, { llamada_id: uuid('c', 999) })) ?? ''))
    ok('sin id, error', /Falta/.test((await fallaCon(coldTranscripcion, d.ctx, {})) ?? ''))
    ok('un tope fuera de rango, error', /entre 500 y 40000/.test((await fallaCon(coldTranscripcion, d.ctx, { llamada_id: LL_HABLADA, max_caracteres: 10 })) ?? ''))
    ok('la llamada de otra persona se lee igual (el conector es de administradores)', (await usar(coldTranscripcion, d.ctx, { llamada_id: LL_DE_ANA })).comercial === 'Ana López' && ANA.length > 0)
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
