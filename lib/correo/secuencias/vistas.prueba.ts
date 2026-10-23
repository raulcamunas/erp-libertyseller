import type { DatosBasicosDeLead, ResumenDelFlujo } from '@/lib/correo/secuencias/almacen'
import { instanteDeMadrid } from '@/lib/correo/secuencias/fechas'
import type { EstadoDePaso, InscripcionDelMotor, PasoDelMotor } from '@/lib/correo/secuencias/tipos'
import { armarFlujo, armarHoy, armarItemDeCola, armarProximos, estadoDeSalida, hace, pasoDeCola } from '@/lib/correo/secuencias/vistas'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const AHORA = instanteDeMadrid('2026-11-02', 700) // lunes 2 de noviembre, 11:40
const HOY = '2026-11-02'

const ins = (o: Partial<InscripcionDelMotor> = {}): InscripcionDelMotor => ({
  id: 'i1', secuenciaId: 's', leadId: 'l1', buzonId: 'b1', userId: 'u1', hiloId: null, messageIdInicial: 'p1@x', destinatario: 'ana@tienda.es', asuntoBase: 'Casa Luz', estado: 'activa',
  motivo: null, codigo: null, primerEnvioAt: instanteDeMadrid('2026-10-28', 600), noInteresaEn: null, paradaAt: null, iaModelo: 'gpt-6-luna', creadaAt: instanteDeMadrid('2026-10-28', 600), ...o,
})
const paso = (o: Partial<PasoDelMotor> & { orden: number; estado: EstadoDePaso }): PasoDelMotor => ({
  id: `p${o.orden}${o.estado}${o.inscripcionId ?? 'i1'}`, inscripcionId: 'i1', buzonId: 'b1', dominio: 'tienda.es', asunto: 'Re: Casa Luz', texto: 'x', textoEnviado: null, diasHabiles: o.orden === 0 ? 0 : o.orden === 1 ? 3 : 7,
  objetivoDia: null, programadoAt: null, enviadoAt: null, messageId: null, intentos: 0, siguienteIntentoAt: null, reclamadoAt: null, decision: null, motivo: null, ...o,
})
const lead = (id: string, nombre: string): [string, DatosBasicosDeLead] => [id, { id, nombre, empresa: null, status: 'email_enviado', asignadoA: 'u1' }]

console.log('\n=== cómo se enseña cada correo en el reparto del día ===')
{
  ok('enviado, enviando, pausado y fallido', estadoDeSalida(paso({ orden: 1, estado: 'enviado' })) === 'enviado' && estadoDeSalida(paso({ orden: 1, estado: 'enviando' })) === 'enviando' && estadoDeSalida(paso({ orden: 1, estado: 'pausado' })) === 'pausado' && estadoDeSalida(paso({ orden: 1, estado: 'fallido' })) === 'fallido')
  ok('pendiente normal: programado', estadoDeSalida(paso({ orden: 1, estado: 'pendiente' })) === 'programado')
  ok('pendiente aplazado por el control: aplazado', estadoDeSalida(paso({ orden: 1, estado: 'pendiente', decision: { accion: 'aplazar', motivo: 'x' } })) === 'aplazado')
  ok('pendiente en ensayo: ensayo', estadoDeSalida(paso({ orden: 1, estado: 'pendiente', decision: { accion: 'ensayo' } })) === 'ensayo')
  ok('cancelado y saltado no salen en el reparto', estadoDeSalida(paso({ orden: 1, estado: 'cancelado' })) === null && estadoDeSalida(paso({ orden: 1, estado: 'saltado' })) === null)
}

console.log('\n=== el reparto del día ===')
{
  const pasos = [
    paso({ orden: 1, estado: 'enviado', programadoAt: instanteDeMadrid(HOY, 560), enviadoAt: instanteDeMadrid(HOY, 561) }),
    paso({ orden: 2, estado: 'pendiente', inscripcionId: 'i2', programadoAt: instanteDeMadrid(HOY, 900) }),
    paso({ orden: 1, estado: 'pendiente', inscripcionId: 'i3', buzonId: 'b2', programadoAt: instanteDeMadrid(HOY, 800) }),
    paso({ orden: 1, estado: 'cancelado', inscripcionId: 'i4', programadoAt: instanteDeMadrid(HOY, 700) }),
    // de otro día: no sale
    paso({ orden: 1, estado: 'pendiente', inscripcionId: 'i5', programadoAt: instanteDeMadrid('2026-11-03', 700) }),
  ]
  const inscripciones = new Map([['i1', ins()], ['i2', ins({ id: 'i2', leadId: 'l2' })], ['i3', ins({ id: 'i3', leadId: 'l3', buzonId: 'b2' })]])
  const t = armarHoy({
    dia: HOY,
    ventana: { desdeMin: 540, hastaMin: 1080 },
    buzones: [
      { id: 'b1', direccion: 'ana@libertyseller.es', nombre: 'Ana', propietario: { id: 'u1', nombre: 'Ana López' }, esMio: true },
      { id: 'b2', direccion: 'alejandro@libertyseller.es', nombre: 'Alejandro', propietario: { id: 'u2', nombre: 'Alejandro' }, esMio: false },
    ],
    pasos,
    inscripciones,
    totalDeSeguimientos: new Map([['i1', 2], ['i2', 2], ['i3', 2]]),
    leads: new Map([lead('l1', 'Casa Luz'), lead('l2', 'Muebles Sol'), lead('l3', 'Tienda Mar')]),
    salientes: [
      { buzonId: 'b1', dia: HOY, hora: 10, total: 12, automaticos: 1 },
      { buzonId: 'b1', dia: HOY, hora: 11, total: 8, automaticos: 0 },
      { buzonId: 'b1', dia: '2026-11-01', hora: 10, total: 99, automaticos: 0 },
      { buzonId: 'b2', dia: HOY, hora: 10, total: 5, automaticos: 0 },
    ],
    topes: new Map([['b1', 70], ['b2', 40]]),
  })
  const [ana, ale] = t.carriles
  ok('un carril por buzón, con su dueño y si es mío', t.carriles.length === 2 && ana.propietario === 'Ana López' && ana.esMio && !ale.esMio)
  ok('los puntos del carril, ordenados por hora, con el nombre del lead y «1 de 2»', ana.puntos.length === 2 && ana.puntos[0].lead === 'Casa Luz' && ana.puntos[0].estado === 'enviado' && ana.puntos[1].estado === 'programado' && ana.puntos[0].en < ana.puntos[1].en && ana.puntos[0].de === 2)
  ok('el enviado se coloca donde salió, no donde estaba programado', ana.puntos[0].en === instanteDeMadrid(HOY, 561))
  ok('lo cancelado y lo de otros días no salen', ale.puntos.length === 1 && ale.puntos[0].lead === 'Tienda Mar')
  ok('lo que mandó la persona a mano, por hora (sin los automáticos)', ana.manual[10] === 11 && ana.manual[11] === 8 && ana.manualHoy === 19 && ale.manualHoy === 5)
  ok('y de otro día no cuenta', ana.manual.reduce((s, n) => s + n, 0) === 19)
  ok('cuántos enviados y cuántos por salir, y el tope', ana.enviadosHoy === 1 && ana.programadosHoy === 1 && ana.topeHoy === 70 && ale.topeHoy === 40)
}

console.log('\n=== los próximos días ===')
{
  const ahora = instanteDeMadrid('2026-10-30', 700) // viernes
  const pasos = [
    { buzonId: 'b1', programadoAt: instanteDeMadrid('2026-10-30', 800), estado: 'pendiente' as const },
    { buzonId: 'b1', programadoAt: instanteDeMadrid('2026-11-02', 600), estado: 'pendiente' as const },
    { buzonId: 'b1', programadoAt: instanteDeMadrid('2026-11-02', 700), estado: 'pendiente' as const },
    { buzonId: 'b2', programadoAt: instanteDeMadrid('2026-11-02', 650), estado: 'pendiente' as const },
    { buzonId: 'b1', programadoAt: instanteDeMadrid('2026-11-03', 600), estado: 'cancelado' as const },
    { buzonId: 'b1', programadoAt: null, estado: 'pendiente' as const },
  ]
  const d = armarProximos({ ahora, dias: 4, festivos: [], buzonIds: ['b1', 'b2'], pasos, tope: (_b, dia) => (dia === '2026-10-30' ? 70 : 100), libre: (b, dia) => 100 - pasos.filter((p) => p.buzonId === b && p.programadoAt !== null && p.estado === 'pendiente' && instanteDeMadrid(dia, 0) <= p.programadoAt && p.programadoAt < instanteDeMadrid(dia, 1440)).length })
  ok('cuatro días hábiles: vie 30, lun 2, mar 3, mié 4 (el fin de semana no cuenta)', d.map((x) => x.dia).join() === '2026-10-30,2026-11-02,2026-11-03,2026-11-04')
  ok('el primero es hoy y la etiqueta lo dice', d[0].esHoy && d[0].etiqueta.startsWith('hoy') && !d[1].esHoy)
  ok('cuenta por buzón y por día, sin lo cancelado ni lo que no tiene hora', d[0].total === 1 && d[1].total === 3 && d[1].porBuzon[0].n === 2 && d[1].porBuzon[1].n === 1 && d[2].total === 0)
  ok('con el tope y lo que cabe', d[0].porBuzon[0].tope === 70 && d[1].porBuzon[0].tope === 100 && d[1].porBuzon[0].libre === 98)
  const sab = armarProximos({ ahora: instanteDeMadrid('2026-10-31', 700), dias: 2, festivos: [], buzonIds: ['b1'], pasos: [], tope: () => 50, libre: () => 50 })
  ok('si hoy es sábado, empieza el lunes y no es «hoy»', sab[0].dia === '2026-11-02' && !sab[0].esHoy)
}

console.log('\n=== la cola ===')
{
  const pasos = [
    paso({ orden: 0, estado: 'enviado', programadoAt: null, enviadoAt: instanteDeMadrid('2026-10-28', 600) }),
    paso({ orden: 1, estado: 'enviado', programadoAt: instanteDeMadrid(HOY, 560), enviadoAt: instanteDeMadrid(HOY, 561), textoEnviado: 'adaptado' }),
    paso({ orden: 2, estado: 'pendiente', programadoAt: instanteDeMadrid('2026-11-06', 700), decision: { accion: 'aplazar', codigo: 'tope_del_dia', motivo: 'El buzón ya ha enviado hoy 70 de 70.' } }),
  ]
  const i = armarItemDeCola({ ins: ins(), pasos, lead: { id: 'l1', nombre: 'Casa Luz', empresa: 'CASA LUZ SL', status: 'email_enviado', asignadoA: 'u1' }, propietario: 'Ana López', propio: true })
  ok('el estado en palabras y su tono', i.etiquetaDeEstado === 'En marcha' && i.tono === 'marcha')
  ok('el progreso: 2 de 3 correos han salido', Math.abs(i.progreso - 2 / 3) < 1e-9)
  ok('el siguiente que saldrá y cuándo', i.siguiente?.orden === 2 && i.siguiente.en === instanteDeMadrid('2026-11-06', 700))
  ok('el paso aplazado dice por qué espera', i.pasos[2].esperando?.includes('70 de 70') === true && i.pasos[2].etiqueta === 'Programado')
  ok('el paso adaptado por la IA se nota', i.pasos[1].adaptado && !i.pasos[0].adaptado)
  ok('una en marcha no tiene cierre', i.cierre === null)
  const enEnsayo = pasoDeCola(paso({ orden: 1, estado: 'pendiente', decision: { accion: 'ensayo' } }))
  ok('un paso en ensayo se llama así', enEnsayo.ensayo && enEnsayo.etiqueta === 'Ensayo')
  const completada = armarItemDeCola({ ins: ins({ estado: 'completada', noInteresaEn: instanteDeMadrid('2026-11-17', 570) }), pasos: pasos.map((p) => ({ ...p, estado: 'enviado' as const })), lead: undefined, propietario: 'Ana', propio: false })
  ok('una completada enseña cuándo pasa a «No interesa» y no tiene siguiente', completada.cierre === instanteDeMadrid('2026-11-17', 570) && completada.siguiente === null && completada.progreso === 1 && completada.lead.nombre === 'Lead')
  const respondida = armarItemDeCola({ ins: ins({ estado: 'respondida' }), pasos: pasos.map((p, k) => (k === 2 ? { ...p, estado: 'cancelado' as const } : p)), lead: undefined, propietario: 'Ana', propio: false })
  ok('una respondida no tiene siguiente aunque tenga pasos cancelados', respondida.siguiente === null && respondida.tono === 'bien')
  const pausada = armarItemDeCola({ ins: ins({ estado: 'pausada' }), pasos: [paso({ orden: 0, estado: 'enviado' }), paso({ orden: 1, estado: 'pausado' })], lead: undefined, propietario: 'Ana', propio: false })
  ok('una en pausa señala el correo detenido como el siguiente', pausada.siguiente?.orden === 1 && pausada.etiquetaDeEstado === 'En pausa')
}

console.log('\n=== el embudo ===')
{
  const r: ResumenDelFlujo = { total: 100, porEstado: { activa: 40, pausada: 2, respondida: 9, parada: 5, completada: 20, sin_respuesta: 19, cancelada: 5 }, porCodigo: { respuesta: 9, rebote: 3, correo_manual: 2, completada: 20, sin_respuesta: 19, cancelada_por_persona: 5 }, enviados: { '0': 100, '1': 58, '2': 41 }, respuestas: { '0': 4, '1': 3, '2': 2 } }
  const f = armarFlujo(r, 30)
  ok('vivas y respondidas', f.vivas === 42 && f.respondidas === 9)
  ok('la tasa es sobre las secuencias ya terminadas (9 de 58)', f.tasaDeRespuesta !== null && Math.abs(f.tasaDeRespuesta - 9 / 58) < 1e-9)
  ok('el embudo, escalón a escalón', f.embudo.map((x) => `${x.etiqueta}:${x.enviados}/${x.respuestas}`).join() === 'Primer correo:100/4,Seguimiento 1:58/3,Seguimiento 2:41/2')
  ok('los motivos de corte, de más a menos y con su frase (sin los finales normales)', f.motivosDeCorte.map((m) => m.codigo).join() === 'respuesta,cancelada_por_persona,rebote,correo_manual' && f.motivosDeCorte[0].etiqueta === 'El lead contestó')
  const vacio = armarFlujo({ total: 3, porEstado: { activa: 3 }, porCodigo: {}, enviados: {}, respuestas: {} }, 30)
  ok('sin ninguna terminada no hay tasa (no se inventa)', vacio.tasaDeRespuesta === null && vacio.embudo.length === 1)
}

console.log('\n=== «hace…» ===')
{
  const ahora = instanteDeMadrid(HOY, 700)
  ok('hace nada', hace(ahora, ahora - 10_000) === 'ahora mismo')
  ok('minutos', hace(ahora, ahora - 5 * 60_000) === 'hace 5 min')
  ok('horas del mismo día', hace(ahora, ahora - 2 * 3_600_000) === 'hace 2 h')
  ok('ayer, con la hora', hace(ahora, instanteDeMadrid('2026-10-30', 642)) === 'vie 30 oct 10:42', hace(ahora, instanteDeMadrid('2026-10-30', 642)))
  ok('de un día lejano', /^\w{3} \d+ \w{3} \d\d:\d\d$/.test(hace(ahora, instanteDeMadrid('2026-10-20', 600))))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
