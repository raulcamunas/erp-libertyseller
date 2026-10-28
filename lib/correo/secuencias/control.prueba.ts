import { decidirSalida, esNotaEscrita, type HechosDeSalida, type LlamadaParaControl, type NotaParaControl } from '@/lib/correo/secuencias/control'
import { instanteDeMadrid } from '@/lib/correo/secuencias/fechas'
import type { EntranteParaControl } from '@/lib/correo/secuencias/respuestas'
import { AJUSTES_POR_DEFECTO } from '@/lib/correo/secuencias/reglas'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

// Miércoles 28 de octubre de 2026, 11:00 en Madrid. El primer correo salió el viernes 23 a las 12:00
const AHORA = instanteDeMadrid('2026-10-28', 660)
const PRIMERO = instanteDeMadrid('2026-10-23', 720)
const min = (n: number) => n * 60_000

function hechos(cambios: Partial<HechosDeSalida> = {}): HechosDeSalida {
  return {
    ahora: AHORA,
    ajustes: { ...AJUSTES_POR_DEFECTO, festivos: [] },
    buzon: { participa: true, pausadoHasta: null, conectado: true, credencialesInvalidas: false, ultimoSyncAt: AHORA - min(1) },
    carga: { enviadosHoy: 10, topeHoy: 70, enviadosUltimaHora: 2, ultimoEnvioDelBuzonAt: null, ultimoEnvioDelSistemaAt: null },
    inscripcion: { destinatario: 'ana@tienda.es', hiloId: 'hilo-1', primerEnvioAt: PRIMERO, ultimoEnvioAt: PRIMERO, userId: 'u1' },
    lead: { status: 'email_enviado', asignadoA: 'u1' },
    entrantes: [],
    llamadas: [],
    notas: [],
    ...cambios,
  }
}
const entrante = (o: Partial<EntranteParaControl>): EntranteParaControl => ({ id: 'm', hiloId: null, deDireccion: 'ana@tienda.es', asunto: 'Re: hola', texto: 'Gracias', fecha: PRIMERO + min(60), automatico: false, ...o })
const llamada = (o: Partial<LlamadaParaControl>): LlamadaParaControl => ({ fecha: AHORA - 2 * 86_400_000, duracionS: 120, estado: 'ANSWERED', tipoDeConversacion: null, ...o })
const nota = (o: Partial<NotaParaControl>): NotaParaControl => ({ fecha: AHORA - 86_400_000, tipo: 'nota', esRespuesta: false, cuerpo: 'Habló el socio', ...o })

const parada = (h: HechosDeSalida) => {
  const d = decidirSalida(h)
  return d.accion === 'parar' ? d : null
}
const aplazo = (h: HechosDeSalida) => {
  const d = decidirSalida(h)
  return d.accion === 'aplazar' ? d : null
}

console.log('\n=== todo en orden: sale ===')
{
  const d = decidirSalida(hechos())
  ok('sin nada escrito ni nuevo, sale tal cual y sin pasar por la IA', d.accion === 'enviar' && !d.revisarConIa && d.notasNuevas.length === 0)
}

console.log('\n=== lo escrito en la ficha ===')
{
  const conNota = decidirSalida(hechos({ notas: [nota({})] }))
  ok('una nota escrita después del último correo manda a la IA', conNota.accion === 'enviar' && conNota.revisarConIa && conNota.notasNuevas.length === 1)
  ok('una anterior al último correo ya no cuenta', decidirSalida(hechos({ notas: [nota({ fecha: PRIMERO - min(10) })] })).accion === 'enviar' && !(decidirSalida(hechos({ notas: [nota({ fecha: PRIMERO - min(10) })] })) as { revisarConIa: boolean }).revisarConIa)
  const registro = decidirSalida(hechos({ notas: [nota({ tipo: 'email', cuerpo: 'Correo enviado a ana@tienda.es' })] }))
  ok('el registro de un correo que SALIÓ no cuenta como algo escrito', registro.accion === 'enviar' && !registro.revisarConIa)
  const respuesta = decidirSalida(hechos({ notas: [nota({ tipo: 'email', esRespuesta: true, cuerpo: 'Me interesa' })] }))
  ok('pero una respuesta del cliente apuntada sí', respuesta.accion === 'enviar' && respuesta.revisarConIa)
  ok('una nota en blanco no cuenta', !esNotaEscrita(nota({ cuerpo: '   ' })) && esNotaEscrita(nota({ tipo: 'whatsapp' })) && esNotaEscrita(nota({ tipo: 'llamada' })))
  const segundo = decidirSalida(hechos({ inscripcion: { ...hechos().inscripcion, ultimoEnvioAt: AHORA - 86_400_000 * 2 }, notas: [nota({ fecha: AHORA - 86_400_000 })] }))
  ok('se mira desde el ÚLTIMO envío de la secuencia, no desde el primero', segundo.accion === 'enviar' && segundo.revisarConIa)
}

console.log('\n=== cuándo se para ===')
{
  ok('el lead ya no existe', parada(hechos({ lead: null }))?.codigo === 'lead_borrado')
  const contesta = parada(hechos({ entrantes: [entrante({})] }))
  ok('el lead contesta: respondida', contesta?.estado === 'respondida' && contesta.codigo === 'respuesta')
  ok('contesta otra persona de su empresa', parada(hechos({ entrantes: [entrante({ deDireccion: 'info@tienda.es' })] }))?.codigo === 'respuesta')
  const rebote = parada(hechos({ entrantes: [entrante({ automatico: true, deDireccion: 'mailer-daemon@x.com', asunto: 'Undelivered Mail Returned to Sender', texto: 'ana@tienda.es 550 5.1.1 user unknown' })] }))
  ok('rebota: parada y la dirección queda como mala', rebote?.estado === 'parada' && rebote.codigo === 'rebote' && rebote.direccionMala === true)
  ok('pasa a otro comercial', parada(hechos({ lead: { status: 'email_enviado', asignadoA: 'u2' } }))?.codigo === 'lead_reasignado')
  ok('sin asignar no es un cambio de dueño', decidirSalida(hechos({ lead: { status: 'email_enviado', asignadoA: null } })).accion === 'enviar')
  ok('«No interesa»', parada(hechos({ lead: { status: 'no_interesa', asignadoA: 'u1' } }))?.codigo === 'lead_no_interesa')
  ok('«Cita agendada»', parada(hechos({ lead: { status: 'cita_cualificada', asignadoA: 'u1' } }))?.codigo === 'lead_cita')
  ok('«En seguimiento»', parada(hechos({ lead: { status: 'seguimiento', asignadoA: 'u1' } }))?.codigo === 'lead_en_seguimiento')
  for (const estado of ['pendiente', 'no_contesta', 'programado', 'email_enviado']) ok(`con el lead en «${estado}» sigue`, decidirSalida(hechos({ lead: { status: estado, asignadoA: 'u1' } })).accion === 'enviar')
  ok('un estado raro del lead no rompe nada', decidirSalida(hechos({ lead: { status: 'constructor', asignadoA: 'u1' } })).accion === 'enviar')
}

console.log('\n=== las llamadas ===')
{
  ok('una conversación por teléfono para la secuencia', parada(hechos({ llamadas: [llamada({ tipoDeConversacion: 'conversacion', duracionS: 90 })] }))?.codigo === 'conversacion_por_telefono')
  ok('una contestada de 2 minutos sin transcripción todavía, también', parada(hechos({ llamadas: [llamada({ duracionS: 120, tipoDeConversacion: null })] }))?.codigo === 'conversacion_por_telefono')
  ok('una contestada de 40 segundos sin transcripción no se da por conversación', decidirSalida(hechos({ llamadas: [llamada({ duracionS: 40, tipoDeConversacion: null })] })).accion === 'enviar')
  ok('un buzón de voz (aunque dure) no cuenta', decidirSalida(hechos({ llamadas: [llamada({ duracionS: 45, tipoDeConversacion: 'buzon_de_voz' })] })).accion === 'enviar')
  ok('ni una sin contenido', decidirSalida(hechos({ llamadas: [llamada({ duracionS: 90, tipoDeConversacion: 'sin_contenido' })] })).accion === 'enviar')
  ok('ni una que no contestó nadie', decidirSalida(hechos({ llamadas: [llamada({ estado: 'NOANSWER', duracionS: 0 })] })).accion === 'enviar')
  ok('ni una contestada de 15 segundos', decidirSalida(hechos({ llamadas: [llamada({ duracionS: 15 })] })).accion === 'enviar')
  ok('ni una conversación ANTERIOR al primer correo', decidirSalida(hechos({ llamadas: [llamada({ fecha: PRIMERO - 86_400_000, tipoDeConversacion: 'conversacion' })] })).accion === 'enviar')
}

console.log('\n=== cuándo se aplaza ===')
{
  ok('el buzón no participa', aplazo(hechos({ buzon: { ...hechos().buzon, participa: false } }))?.codigo === 'buzon_fuera_del_motor')
  const pausa = aplazo(hechos({ buzon: { ...hechos().buzon, pausadoHasta: AHORA + min(30) } }))
  ok('el buzón está en pausa: se espera lo que dure', pausa?.codigo === 'buzon_pausado' && pausa.cuando.tipo === 'en' && pausa.cuando.ms === min(30))
  ok('una pausa que ya acabó no frena', decidirSalida(hechos({ buzon: { ...hechos().buzon, pausadoHasta: AHORA - 1000 } })).accion === 'enviar')
  ok('sin conexión o con la contraseña mal', aplazo(hechos({ buzon: { ...hechos().buzon, conectado: false } }))?.codigo === 'buzon_sin_conexion' && aplazo(hechos({ buzon: { ...hechos().buzon, credencialesInvalidas: true } }))?.codigo === 'buzon_sin_conexion')
  for (const [nombre, ahora] of [['antes de las 9', instanteDeMadrid('2026-10-28', 530)], ['a las 18:00', instanteDeMadrid('2026-10-28', 1080)], ['un sábado', instanteDeMadrid('2026-10-31', 700)], ['un domingo', instanteDeMadrid('2026-11-01', 700)]] as const) {
    const a = aplazo(hechos({ ahora, buzon: { ...hechos().buzon, ultimoSyncAt: ahora - min(1) } }))
    ok(`${nombre}: fuera de horario, se replanifica`, a?.codigo === 'fuera_de_ventana' && a.cuando.tipo === 'replanificar' && a.cuando.dias === 0)
  }
  ok('un festivo también', aplazo(hechos({ ajustes: { ...AJUSTES_POR_DEFECTO, festivos: ['2026-10-28'] } }))?.codigo === 'fuera_de_ventana')
  ok('las 17:59 todavía valen', decidirSalida(hechos({ ahora: instanteDeMadrid('2026-10-28', 1079), buzon: { ...hechos().buzon, ultimoSyncAt: instanteDeMadrid('2026-10-28', 1078) } })).accion === 'enviar')
  ok('sin lectura reciente del buzón (hace 10 minutos) no se envía a ciegas', aplazo(hechos({ buzon: { ...hechos().buzon, ultimoSyncAt: AHORA - min(10) } }))?.codigo === 'sin_lectura_reciente')
  ok('ni si nunca se ha leído', aplazo(hechos({ buzon: { ...hechos().buzon, ultimoSyncAt: null } }))?.codigo === 'sin_lectura_reciente')
  const fuera = aplazo(hechos({ entrantes: [entrante({ automatico: true, asunto: 'Respuesta automática: vacaciones' })] }))
  ok('«fuera de oficina»: se espera dos días hábiles', fuera?.codigo === 'fuera_de_oficina' && fuera.cuando.tipo === 'replanificar' && fuera.cuando.dias === 2)
  const blando = aplazo(hechos({ entrantes: [entrante({ automatico: true, deDireccion: 'mailer-daemon@x.com', asunto: 'Delivery Status Notification (Delay)', texto: 'still trying ana@tienda.es' })] }))
  ok('fallo pasajero del destino: mañana', blando?.codigo === 'fallo_pasajero_del_destino' && blando.cuando.tipo === 'replanificar' && blando.cuando.dias === 1)
  const tope = aplazo(hechos({ carga: { ...hechos().carga, enviadosHoy: 70 } }))
  ok('tope del día alcanzado: mañana', tope?.codigo === 'tope_del_dia' && tope.cuando.tipo === 'replanificar' && tope.cuando.dias === 1)
  ok('uno menos que el tope todavía deja enviar', decidirSalida(hechos({ carga: { ...hechos().carga, enviadosHoy: 69 } })).accion === 'enviar')
  const hora = aplazo(hechos({ carga: { ...hechos().carga, enviadosUltimaHora: 25 } }))
  ok('tope de la hora: en 20 minutos', hora?.codigo === 'tope_de_la_hora' && hora.cuando.tipo === 'en' && hora.cuando.ms === min(20))
  const reciente = aplazo(hechos({ carga: { ...hechos().carga, ultimoEnvioDelBuzonAt: AHORA - 30_000 } }))
  ok('el buzón acaba de enviar (hace 30 s): se espera lo que falta del hueco de 3 minutos', reciente?.codigo === 'envio_reciente_del_buzon' && reciente.cuando.tipo === 'en' && reciente.cuando.ms === 180_000 - 30_000 + 5_000)
  const delSistema = aplazo(hechos({ carga: { ...hechos().carga, ultimoEnvioDelSistemaAt: AHORA - 10_000 } }))
  ok('el sistema acaba de enviar otro (hace 10 s): lo que falta del hueco de 45 s', delSistema?.codigo === 'envio_reciente_del_sistema' && delSistema.cuando.tipo === 'en' && delSistema.cuando.ms === 45_000 - 10_000 + 5_000)
  ok('hace 4 minutos ya no frena', decidirSalida(hechos({ carga: { ...hechos().carga, ultimoEnvioDelBuzonAt: AHORA - min(4) } })).accion === 'enviar')
  const recienLlamado = aplazo(hechos({ llamadas: [llamada({ fecha: AHORA - min(20), estado: 'NOANSWER', duracionS: 0 })] }))
  ok('se llamó hace 20 minutos (aunque no contestara): una hora de espera', recienLlamado?.codigo === 'llamada_reciente' && recienLlamado.cuando.tipo === 'en' && recienLlamado.cuando.ms === min(60))
}

console.log('\n=== el orden de las cosas ===')
{
  ok('si contesta, se PARA aunque el buzón esté en pausa (no se aplaza)', parada(hechos({ entrantes: [entrante({})], buzon: { ...hechos().buzon, pausadoHasta: AHORA + min(30) } }))?.codigo === 'respuesta')
  ok('si contesta, se PARA aunque sea sábado', parada(hechos({ ahora: instanteDeMadrid('2026-10-31', 700), entrantes: [entrante({})] }))?.codigo === 'respuesta')
  ok('lo de parar se decide aunque la lectura del buzón sea vieja', parada(hechos({ entrantes: [entrante({})], buzon: { ...hechos().buzon, ultimoSyncAt: AHORA - min(60) } }))?.codigo === 'respuesta')
  ok('una respuesta gana a un rebote', parada(hechos({ entrantes: [entrante({ automatico: true, deDireccion: 'mailer-daemon@x.com', asunto: 'Undelivered Mail', texto: 'ana@tienda.es 550 5.1.1' }), entrante({})] }))?.codigo === 'respuesta')
  ok('«No interesa» gana a un tope del día', parada(hechos({ lead: { status: 'no_interesa', asignadoA: 'u1' }, carga: { ...hechos().carga, enviadosHoy: 99 } }))?.codigo === 'lead_no_interesa')
  const esperaYNota = decidirSalida(hechos({ notas: [nota({})], carga: { ...hechos().carga, enviadosHoy: 70 } }))
  ok('si hay que esperar, se espera antes de gastar la IA en leer las notas', esperaYNota.accion === 'aplazar')
}

console.log('\n=== un aviso solo atrasa una vez, y un correo a mano corta la secuencia ===')
{
  const fuera = entrante({ id: 'ooo-1', automatico: true, asunto: 'Respuesta automática: vacaciones' })
  const primera = aplazo(hechos({ entrantes: [fuera] }))
  ok('el «fuera de oficina» atrasa y apunta qué mensaje fue', primera?.codigo === 'fuera_de_oficina' && primera.ignorar?.[0] === 'ooo-1')
  ok('la segunda vez, con ese mensaje ya apuntado, el seguimiento sale', decidirSalida(hechos({ entrantes: [fuera], entrantesIgnorados: new Set(['ooo-1']) })).accion === 'enviar')
  ok('pero otro aviso distinto sí vuelve a atrasar', aplazo(hechos({ entrantes: [fuera, entrante({ id: 'ooo-2', automatico: true, asunto: 'Out of office', fecha: PRIMERO + min(600) })], entrantesIgnorados: new Set(['ooo-1']) }))?.ignorar?.[0] === 'ooo-2')
  const blando = entrante({ id: 'bb-1', automatico: true, deDireccion: 'mailer-daemon@x.com', asunto: 'Delivery Status Notification (Delay)', texto: 'still trying ana@tienda.es' })
  ok('un fallo pasajero también se apunta', aplazo(hechos({ entrantes: [blando] }))?.ignorar?.[0] === 'bb-1')
  ok('y deja de atrasar cuando ya se tuvo en cuenta', decidirSalida(hechos({ entrantes: [blando], entrantesIgnorados: new Set(['bb-1']) })).accion === 'enviar')
  ok('ignorar un aviso no se traga una respuesta de verdad', parada(hechos({ entrantes: [fuera, entrante({ id: 'resp-1' })], entrantesIgnorados: new Set(['ooo-1']) }))?.codigo === 'respuesta')
  ok('una respuesta que se ignorara por error tampoco: si está en la lista no cuenta, y es lo que se pide', decidirSalida(hechos({ entrantes: [entrante({ id: 'resp-1' })], entrantesIgnorados: new Set(['resp-1']) })).accion === 'enviar')

  const manual = parada(hechos({ correosManuales: [PRESENTADO_DESPUES()] }))
  ok('si el comercial le escribió a mano después del último correo, la secuencia se corta', manual?.codigo === 'correo_manual' && manual.estado === 'parada')
  ok('un correo a mano ANTERIOR al último de la secuencia no la corta', decidirSalida(hechos({ correosManuales: [PRIMERO - min(5)] })).accion === 'enviar')
  ok('sin correos a mano, nada', decidirSalida(hechos({ correosManuales: [] })).accion === 'enviar')
  ok('contestar gana a un correo a mano (es lo primero)', parada(hechos({ correosManuales: [PRESENTADO_DESPUES()], entrantes: [entrante({})] }))?.codigo === 'respuesta')
  ok('un correo a mano corta aunque el buzón esté en pausa o sea de noche', parada(hechos({ correosManuales: [PRESENTADO_DESPUES()], ahora: instanteDeMadrid('2026-10-31', 700), buzon: { ...hechos().buzon, pausadoHasta: AHORA + min(30) } }))?.codigo === 'correo_manual')
}
function PRESENTADO_DESPUES(): number {
  return PRIMERO + min(120)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
