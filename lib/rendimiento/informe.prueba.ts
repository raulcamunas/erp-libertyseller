import { indexar, type FilaDiaria } from '@/lib/rendimiento/comparativa'
import {
  METRICAS,
  cambioEnPalabras,
  cambioEnPuntos,
  diasDeSemana,
  etiquetaLargaDeSemana,
  formatoDe,
  franjasDestacadas,
  horarioSemanal,
  intensidadDeCelda,
  kpisDelEquipo,
  listaEnPalabras,
  lunesDeTexto,
  lunesPorDefecto,
  mapaHorario,
  matrizDiaria,
  resultadoDelEquipo,
  resultadoSemanal,
  semanaDe,
  textoDePausa,
  titulares,
  valorDe,
  type PersonaDeInforme,
} from '@/lib/rendimiento/informe'
import { variacion, variacionDePuntos } from '@/lib/rendimiento/comparativa'
import { horaDeMinuto, type EventoDeLinea } from '@/lib/rendimiento/linea'
import { tiempoHablado } from '@/lib/rendimiento/metricas'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const j = (x: unknown) => JSON.stringify(x)

/**
 * EL INFORME SEMANAL.
 *
 * Las semanas: la del 12 al 18 de octubre de 2026 (la anterior) y la del 19 al 25 (la que se revisa). El 25 de octubre
 * cambia la hora en Madrid (acaba el horario de verano): los días son fechas civiles, así que no se nota, y el mapa de
 * franjas horarias sí tiene que acertar la hora de uno y otro lado.
 */
const fila = (user: string, dia: string, p: Partial<FilaDiaria> = {}): FilaDiaria => ({
  user_id: user,
  dia,
  realizadas: 0,
  recibidas: 0,
  contestadas: 0,
  segundos: 0,
  conversaciones: 0,
  whatsapp: 0,
  whatsapp_apuntes: 0,
  correos: 0,
  correos_apuntes: 0,
  respuestas: 0,
  citas: 0,
  ...p,
})

const S1 = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']
const S2 = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']

const filas: FilaDiaria[] = []
// Ana: la semana anterior, 40 llamadas al día; esta, 50, 60, 30, 70 y 40
S1.forEach((d, i) => filas.push(fila('ana', d, { realizadas: 40, contestadas: 12, conversaciones: 4, segundos: 600, whatsapp: 3, whatsapp_apuntes: 5, correos: 2, correos_apuntes: 2, respuestas: 1, citas: i === 2 || i === 4 ? 1 : 0 })))
;[50, 60, 30, 70, 40].forEach((n, i) =>
  filas.push(fila('ana', S2[i], { realizadas: n, contestadas: 15, conversaciones: 5, segundos: 700, whatsapp: 3, whatsapp_apuntes: 4, correos: 2, correos_apuntes: 3, respuestas: 1, citas: i === 2 ? 1 : i === 3 ? 2 : 0 }))
)
// Beto: 20 llamadas al día; esta semana solo lunes, martes y miércoles
S1.forEach((d) => filas.push(fila('beto', d, { realizadas: 20, contestadas: 4, conversaciones: 1, segundos: 200 })))
S2.slice(0, 3).forEach((d) => filas.push(fila('beto', d, { realizadas: 20, contestadas: 5, conversaciones: 1, segundos: 300 })))
// Cris no tiene Rinkel: solo WhatsApp apuntado esta semana
S2.forEach((d) => filas.push(fila('cris', d, { whatsapp: 2, whatsapp_apuntes: 2 })))
// Dani no tiene nada

const ana: PersonaDeInforme = { id: 'ana', nombre: 'Ana López', vinculado: true }
const beto: PersonaDeInforme = { id: 'beto', nombre: 'Beto Gil', vinculado: true }
const cris: PersonaDeInforme = { id: 'cris', nombre: 'Cris Sanz', vinculado: false }
const dani: PersonaDeInforme = { id: 'dani', nombre: 'Dani Ruiz', vinculado: true }
const PERSONAS = [ana, beto, cris, dani]
const porPersona = indexar(filas)

const cerrada = semanaDe('2026-10-19', '2026-10-27')
const enCurso = semanaDe('2026-10-21', '2026-10-21')
const resultados = PERSONAS.map((p) => resultadoSemanal(p, porPersona.get(p.id), cerrada))

console.log('\n=== la semana ===')
{
  const s = semanaDe('2026-10-21', '2026-10-22')
  ok('la semana del jueves 22: del lunes 19 al domingo 25, siete días', s.lunes === '2026-10-19' && s.domingo === '2026-10-25' && s.dias.length === 7 && s.dias[3] === '2026-10-22', j(s.dias))
  ok('lleva 4 días, no está completa y contiene hoy', s.transcurridos === 4 && !s.completa && s.contieneHoy)
  ok('se compara con el mismo tramo de la semana anterior', s.comparacion?.texto === 'la semana anterior, hasta el jueves' && s.comparacion.bases[0].desde === '2026-10-12' && s.comparacion.bases[0].hasta === '2026-10-15', j(s.comparacion))
  ok('lo que se mide no pasa de hoy', s.comparacion?.actual.desde === '2026-10-19' && s.comparacion.actual.hasta === '2026-10-22')

  ok('una semana que ya acabó está completa, no contiene hoy y se compara con la anterior entera', cerrada.completa && !cerrada.contieneHoy && cerrada.transcurridos === 7 && cerrada.comparacion?.texto === 'la semana anterior' && cerrada.comparacion.bases[0].hasta === '2026-10-18')
  const futura = semanaDe('2026-10-26', '2026-10-22')
  ok('una semana futura no tiene nada que medir ni con qué comparar', futura.transcurridos === 0 && futura.comparacion === null && !futura.completa)
  ok('el domingo cuenta como el último día de la semana: lo mismo ancla cualquier día', semanaDe('2026-10-25', '2026-10-27').lunes === '2026-10-19' && semanaDe('2026-10-19', '2026-10-27').lunes === '2026-10-19')

  ok('por defecto, la última semana completa: el lunes 26 se revisa la del 19', lunesPorDefecto('2026-10-26') === '2026-10-19')
  ok('un domingo la semana todavía no ha acabado: sigue siendo la anterior', lunesPorDefecto('2026-10-25') === '2026-10-12')
  ok('sin pedir nada, o pidiendo algo que no es una fecha, la de por defecto', lunesDeTexto(undefined, '2026-10-27') === '2026-10-19' && lunesDeTexto('basura', '2026-10-27') === '2026-10-19' && lunesDeTexto('2026-02-30', '2026-10-27') === '2026-10-19' && lunesDeTexto(['2026-10-12'], '2026-10-27') === '2026-10-19')
  ok('pidiendo un día cualquiera, el lunes de su semana', lunesDeTexto('2026-10-21', '2026-10-27') === '2026-10-19' && lunesDeTexto('2026-10-18', '2026-10-27') === '2026-10-12')
  ok('pidiendo una semana que no ha empezado, la de esta semana', lunesDeTexto('2026-11-10', '2026-10-27') === '2026-10-26')

  ok('el título largo de la semana', etiquetaLargaDeSemana(cerrada) === 'del 19 al 25 de octubre de 2026', etiquetaLargaDeSemana(cerrada))
  ok('si cruza de mes, dice los dos', etiquetaLargaDeSemana(semanaDe('2026-10-26', '2026-11-05')) === 'del 26 de octubre al 1 de noviembre de 2026')
  ok('y si cruza de año, también el año', etiquetaLargaDeSemana(semanaDe('2026-12-28', '2027-01-10')) === 'del 28 de diciembre de 2026 al 3 de enero de 2027', etiquetaLargaDeSemana(semanaDe('2026-12-28', '2027-01-10')))

  const d = diasDeSemana(enCurso)
  ok('las etiquetas de los días', d[0].etiqueta === 'lun 19' && d[2].etiqueta === 'mié 21' && d[5].etiqueta === 'sáb 24' && d[6].etiqueta === 'dom 25', j(d.map((x) => x.etiqueta)))
  ok('un día futuro, hoy y el fin de semana', !d[2].futuro && d[2].esHoy && d[3].futuro && d[5].finDeSemana && d[6].finDeSemana && !d[4].finDeSemana)
}

console.log('\n=== las cifras ===')
{
  ok('hay ocho cifras, cada una con su nombre', METRICAS.length === 8 && new Set(METRICAS.map((m) => m.id)).size === 8)
  const t = resultados[0].actual
  ok('cada cifra sale de su campo', valorDe(t, 'llamadas') === 250 && valorDe(t, 'contestadas') === 75 && valorDe(t, 'conversaciones') === 25 && valorDe(t, 'tiempo') === 3500 && valorDe(t, 'whatsapp') === 15 && valorDe(t, 'correos') === 10 && valorDe(t, 'respuestas') === 5 && valorDe(t, 'citas') === 3, j(t))
  ok('el tiempo se escribe en horas y minutos; lo demás, en números', formatoDe('tiempo', 3900) === '1 h 05 min' && formatoDe('llamadas', 1234.4) === '1234' && formatoDe('citas', 3) === '3')

  const [rAna, rBeto, rCris, rDani] = resultados
  ok('Ana: 250 llamadas esta semana contra 200 la anterior', rAna.actual.llamadas === 250 && rAna.base?.llamadas === 200)
  ok('sus siete días: 50 el lunes, nada el fin de semana, y los de la anterior al lado', rAna.dias.map((x) => x.llamadas).join() === '50,60,30,70,40,0,0' && rAna.anteriores.map((x) => x.llamadas).join() === '40,40,40,40,40,0,0')
  ok('quien no tenía nada la semana anterior no tiene referencia', rCris.base === null && rDani.base === null && rBeto.base?.llamadas === 100)
  const equipo = resultadoDelEquipo(resultados)
  ok('el equipo es la suma de todos: 310 llamadas contra 300', equipo.actual.llamadas === 310 && equipo.base?.llamadas === 300, j(equipo.actual))
  ok('y sus días: 70 el lunes (50 + 20)', equipo.dias[0].llamadas === 70 && equipo.dias.map((x) => x.llamadas).join() === '70,80,50,70,40,0,0', j(equipo.dias.map((x) => x.llamadas)))
  ok('si nadie tiene referencia, el equipo tampoco', resultadoDelEquipo([rCris, rDani]).base === null)

  const parcial = PERSONAS.map((p) => resultadoSemanal(p, porPersona.get(p.id), enCurso))
  ok('a mitad de semana se mide hasta hoy y se compara con el mismo tramo: Ana, 140 contra 120', parcial[0].actual.llamadas === 140 && parcial[0].base?.llamadas === 120, j([parcial[0].actual.llamadas, parcial[0].base?.llamadas]))
  ok('los días que no han llegado salen vacíos', parcial[0].dias.map((x) => x.llamadas).join() === '50,60,30,0,0,0,0')
}

console.log('\n=== la matriz persona × día ===')
{
  const m = matrizDiaria(resultados, cerrada, 'llamadas')
  ok('una fila por persona, en el orden que se pasa, con siete celdas', m.filas.map((f) => f.persona.id).join() === 'ana,beto,cris,dani' && m.filas.every((f) => f.celdas.length === 7))
  const f = m.filas[0]
  ok('Ana: 50 el lunes y 40 el lunes anterior', f.celdas[0].valor === 50 && f.celdas[0].anterior === 40 && f.celdas[0].dia === '2026-10-19')
  ok('su total, su referencia y su cambio: 250 contra 200, +25 %', f.total === 250 && f.totalBase === 200 && f.cambio.sentido === 'sube' && f.cambio.texto === '+25 %', j(f.cambio))
  const b = m.filas[1]
  ok('Beto: 60 contra 100, −40 %; el jueves y el viernes son cero, no vacío', b.total === 60 && b.cambio.texto === '−40 %' && b.celdas[3].valor === 0 && b.celdas[4].valor === 0, j(b.cambio))
  ok('quien no tenía referencia ni llamadas: ni sube ni baja', m.filas[2].totalBase === null && m.filas[2].cambio.sentido === 'igual')
  ok('la fila del equipo suma cada día', m.porDia.map((c) => c.valor).join() === '70,80,50,70,40,0,0' && m.porDia[0].anterior === 60, j(m.porDia.map((c) => c.valor)))
  ok('el total del equipo: 310 contra 300, +3 %', m.total === 310 && m.totalBase === 300 && m.cambio.texto === '+3 %', j(m.cambio))
  ok('el máximo de una celda de persona es lo que pinta de más oscuro: 70', m.maximo === 70)

  const parcial = PERSONAS.map((p) => resultadoSemanal(p, porPersona.get(p.id), enCurso))
  const mp = matrizDiaria(parcial, enCurso, 'llamadas')
  ok('los días que todavía no han llegado son nulos (no ceros): no hay nada que comparar', mp.filas[0].celdas.map((c) => c.valor).join() === '50,60,30,,,,' && mp.filas[0].celdas[3].anterior === null, j(mp.filas[0].celdas.map((c) => c.valor)))
  ok('y el equipo igual', mp.porDia[3].valor === null && mp.porDia[2].valor === 50)

  const t = matrizDiaria(resultados, cerrada, 'tiempo')
  ok('con otra cifra, otros números: el tiempo de Ana', t.filas[0].total === 3500 && t.metrica === 'tiempo' && t.filas[0].celdas[0].valor === 700)
  const c = matrizDiaria(resultados, cerrada, 'citas')
  ok('las citas: Ana, 3 contra 2; el equipo, 3 contra 2 (+1)', c.filas[0].total === 3 && c.total === 3 && c.totalBase === 2 && c.cambio.texto === '+1', j(c.cambio))
  ok('sin nadie, una matriz vacía', matrizDiaria([], cerrada, 'llamadas').filas.length === 0 && matrizDiaria([], cerrada, 'llamadas').maximo === 0)
}

console.log('\n=== las cifras grandes del equipo ===')
{
  const k = kpisDelEquipo(resultados, cerrada)
  ok('ocho cifras en su orden', k.map((x) => x.id).join() === 'llamadas,contacto,conversaciones,tiempo,whatsapp,correos,respuestas,citas', k.map((x) => x.id).join())
  ok('llamadas: 310, a 155 por persona que llamó (dos personas), +3 %', k[0].valor === '310' && k[0].detalle === '155 por persona' && k[0].cambio.texto === '+3 %', j([k[0].valor, k[0].detalle, k[0].cambio]))
  ok('contacto: 90 contestadas de 310 = 29 %', k[1].valor === '29 %' && k[1].detalle === '90 contestadas de 310' && k[1].metrica === 'contestadas', j(k[1]))
  ok('el cambio del contacto es en puntos', k[1].cambio.texto.endsWith('pts'), k[1].cambio.texto)
  ok('conversaciones, tiempo y mensajes', k[2].valor === '28' && k[3].valor === tiempoHablado(4400) && k[4].valor === '25' && k[5].valor === '10' && k[6].valor === '5' && k[7].valor === '3', j(k.map((x) => x.valor)))
  ok('WhatsApp dice cuántos apuntes hubo', k[4].detalle.includes('apuntes') && k[4].detalle === 'Clientes distintos · 30 apuntes', k[4].detalle)
  ok('citas: 3 contra 2, +1', k[7].cambio.texto === '+1' && k[7].cambio.sentido === 'sube')
  ok('cada cifra lleva sus siete días y los de la anterior, para dibujar las barras', k[0].diario.join() === '70,80,50,70,40,0,0' && k[0].diarioAnterior.join() === '60,60,60,60,60,0,0', j(k[0].diario))
  ok('pulsar una cifra enseña su fila de la matriz', k.every((x) => METRICAS.some((m) => m.id === x.metrica)))

  const parcial = PERSONAS.map((p) => resultadoSemanal(p, porPersona.get(p.id), enCurso))
  const kp = kpisDelEquipo(parcial, enCurso)
  ok('a mitad de semana los días que faltan no cuentan como cero', kp[0].diario.join() === '70,80,50,,,,' && kp[0].diarioAnterior.join() === '60,60,60,,,,', j(kp[0].diario))
  const vacio = kpisDelEquipo([resultadoSemanal(dani, undefined, cerrada)], cerrada)
  ok('sin llamadas: un guion, no un 0 % inventado', vacio[0].valor === '0' && vacio[0].detalle === 'Ninguna llamada' && vacio[1].valor === '—')
}

console.log('\n=== las frases del cambio ===')
{
  const c = 'la semana anterior'
  ok('subir en tanto por ciento', cambioEnPalabras(variacion(250, 200), c) === 'un 25 % más que la semana anterior')
  ok('bajar en tanto por ciento', cambioEnPalabras(variacion(60, 100), c) === 'un 40 % menos que la semana anterior')
  ok('con una referencia pequeña, en unidades', cambioEnPalabras(variacion(2, 5), c) === '3 menos que la semana anterior' && cambioEnPalabras(variacion(8, 5), c) === '3 más que la semana anterior')
  ok('lo que no ha cambiado', cambioEnPalabras(variacion(100, 101), c) === 'igual que la semana anterior')
  ok('sin referencia no se inventa nada', cambioEnPalabras(variacion(10, null), c) === '' && cambioEnPuntos(variacionDePuntos(0.3, null), c) === '')
  ok('los puntos del contacto', cambioEnPuntos(variacionDePuntos(0.30, 0.25), c) === '5 puntos más que la semana anterior' && cambioEnPuntos(variacionDePuntos(0.30, 0.29), c) === '1 punto más que la semana anterior' && cambioEnPuntos(variacionDePuntos(0.20, 0.22), c) === '2 puntos menos que la semana anterior' && cambioEnPuntos(variacionDePuntos(0.30, 0.304), c) === 'igual que la semana anterior')
  ok('las listas', listaEnPalabras([]) === '' && listaEnPalabras(['A']) === 'A' && listaEnPalabras(['A', 'B']) === 'A y B' && listaEnPalabras(['A', 'B', 'C']) === 'A, B y C')
}

console.log('\n=== los titulares ===')
{
  const t = titulares(resultados, cerrada)
  const hay = (texto: string, tipo?: string) => t.some((x) => x.texto === texto && (tipo === undefined || x.tipo === tipo))
  const textos = t.map((x) => `${x.tipo}: ${x.texto}`).join('\n')
  ok('lo primero, las llamadas del equipo y su cambio', t[0].texto === 'El equipo hizo 310 llamadas, un 3 % más que la semana anterior.' && t[0].tipo === 'bien', textos)
  ok('cuántas se contestaron, en puntos', t.some((x) => x.texto.startsWith('Se contestó el 29 % de las llamadas, 2 puntos más que la semana anterior')), textos)
  ok('lo hablado', hay('Hubo 28 conversaciones de más de un minuto y 1 h 13 min al teléfono.', 'info'), textos)
  ok('lo conseguido: citas y respuestas', hay('Se agendaron 3 citas (1 más que la semana anterior); 5 clientes contestaron.', 'bien'), textos)
  ok('quién más llamó', hay('Quien más llamó fue Ana López, con 250 llamadas.'), textos)
  ok('la mejor tasa de contacto, solo entre quien llamó lo bastante (Ana 30 %, Beto 25 %)', hay('La mejor tasa de contacto fue la de Ana López: 30 % de 250 llamadas.'), textos)
  ok('quien ha subido mucho el ritmo', hay('Ana subió un 25 % sus llamadas (de 200 a 250).', 'bien'), textos)
  ok('y quien lo ha bajado', hay('Beto bajó un 40 % sus llamadas (de 100 a 60).', 'aviso'), textos)
  ok('el día más flojo, frente a la media', hay('El día más flojo fue el viernes: 40 llamadas, un 35 % menos que la media de la semana.', 'aviso'), textos)
  ok('y el mejor', hay('El mejor día fue el martes: 80 llamadas, un 29 % más que la media de la semana.', 'info'), textos)
  ok('quién no tiene Rinkel', hay('Cris Sanz no tiene Rinkel vinculado: sus llamadas no se cuentan.', 'aviso'), textos)
  ok('quién no ha registrado nada (y no se repite con quien no tiene Rinkel)', hay('Dani Ruiz no registró nada en toda la semana.', 'aviso') && !t.some((x) => x.texto.includes('Cris Sanz no registró')), textos)
  ok('los días en blanco de quien sí trabajó', hay('Beto no registró actividad el jueves y el viernes.', 'info'), textos)
  ok('de quien no tiene Rinkel no se dice que le falten días: sin llamadas no se sabe', !t.some((x) => x.texto.startsWith('Cris no registró')))

  const parcial = PERSONAS.map((p) => resultadoSemanal(p, porPersona.get(p.id), enCurso))
  const tp = titulares(parcial, enCurso)
  ok('a mitad de semana se dice que «lleva» y con qué tramo se compara', tp[0].texto === 'El equipo lleva 200 llamadas, un 11 % más que en los mismos días de la semana anterior. Hoy todavía no ha acabado.' && tp[0].tipo === 'bien', tp[0].texto)
  ok('y los puntos del contacto, con el mismo tramo', tp.some((x) => x.texto.startsWith('Se contestó el') && x.texto.endsWith('que en los mismos días de la semana anterior.')), tp.map((x) => x.texto).join(' | '))
  ok('hoy no cuenta como día en blanco ni como el más flojo (el día no ha acabado)', !tp.some((x) => x.texto.startsWith('Beto no registró actividad')) && !tp.some((x) => x.texto.includes('día más flojo')), tp.map((x) => x.texto).join(' | '))
  const lunesVacio = titulares(
    [resultadoSemanal(dani, undefined, enCurso)],
    enCurso
  )
  ok('quien no ha registrado nada, en una semana en curso, «no ha registrado nada en lo que va de semana»', lunesVacio.some((x) => x.texto === 'Dani Ruiz no ha registrado nada en lo que va de semana.') && lunesVacio[0].texto === 'El equipo todavía no ha hecho ninguna llamada.', j(lunesVacio))
  ok('«ninguna cita, igual que la semana anterior» no se dice: se dice solo «ninguna cita»', titulares([resultados[1]], cerrada).every((x) => !x.texto.includes('ninguna cita (igual')))

  const nada = titulares([resultadoSemanal(dani, undefined, cerrada)], cerrada)
  ok('una semana sin ninguna llamada lo dice', nada[0].texto === 'El equipo no hizo ninguna llamada.' && nada[0].tipo === 'aviso', j(nada))
  ok('una semana que ni ha empezado no inventa titulares de rendimiento', !titulares(PERSONAS.map((p) => resultadoSemanal(p, porPersona.get(p.id), semanaDe('2026-10-26', '2026-10-22'))), semanaDe('2026-10-26', '2026-10-22')).some((x) => x.texto.startsWith('El equipo')))
  ok('con una sola persona no hay «quien más llamó»', !titulares([resultados[0]], cerrada).some((x) => x.texto.startsWith('Quien más llamó')))
}

console.log('\n=== el mapa de franjas horarias ===')
{
  const llamada = (fecha: string, extra: Partial<{ direccion: string; estado: string; duracion_s: number }> = {}) => ({ fecha, direccion: 'outbound', estado: 'ANSWERED', duracion_s: 90, ...extra })
  const semana = cerrada.dias
  const m = mapaHorario(
    [
      llamada('2026-10-21T07:30:00Z'), // 09:30 en Madrid (UTC+2)
      llamada('2026-10-21T07:50:00Z', { estado: 'NO_ANSWER', duracion_s: 0 }),
      llamada('2026-10-21T08:10:00Z', { duracion_s: 4 }), // contestador: hecha pero no contestada
      llamada('2026-10-21T08:10:00Z', { direccion: 'inbound' }), // una recibida no es una llamada hecha
      llamada('2026-10-18T08:10:00Z'), // otra semana
      llamada('2026-10-25T07:30:00Z'), // 08:30 en Madrid: ya es UTC+1 (cambio de hora ese día)
      llamada('2026-10-23T20:15:00Z'), // 22:15: fuera del horario normal
    ],
    semana
  )
  ok('de 8 a 22: se amplía a lo que haya fuera de 9 a 18', m.horas[0] === 8 && m.horas[m.horas.length - 1] === 22 && m.horas.length === 15, j(m.horas))
  const miercoles = m.filas.find((f) => f.dia === '2026-10-21')!
  ok('9:30 hora de Madrid cae en la columna de las 9: 2 hechas (la de las 9:50 también), 1 contestada', miercoles.celdas[m.horas.indexOf(9)].hechas === 2 && miercoles.celdas[m.horas.indexOf(9)].contestadas === 1, j(miercoles.celdas[m.horas.indexOf(9)]))
  ok('10:10 es un contestador: hecha y no contestada', miercoles.celdas[m.horas.indexOf(10)].hechas === 1 && miercoles.celdas[m.horas.indexOf(10)].contestadas === 0)
  ok('la recibida y la de otra semana no cuentan', miercoles.total === 3 && m.total === 5, j([miercoles.total, m.total]))
  const domingo = m.filas.find((f) => f.dia === '2026-10-25')!
  ok('con el cambio de hora, 07:30 UTC del domingo 25 son las 8:30', domingo.celdas[m.horas.indexOf(8)].hechas === 1)
  ok('el máximo, para pintar', m.maximo === 2)
  ok('siete filas, una por día', m.filas.length === 7 && m.filas.every((f) => f.celdas.length === m.horas.length))
  ok('sin llamadas, de 9 a 18 y todo a cero', mapaHorario([], semana).horas.length === 10 && mapaHorario([], semana).total === 0 && mapaHorario([], semana).maximo === 0)

  const grande = mapaHorario(
    [
      ...Array.from({ length: 12 }, (_, i) => llamada('2026-10-20T09:00:00Z', { estado: i < 3 ? 'ANSWERED' : 'NO_ANSWER', duracion_s: i < 3 ? 80 : 0 })), // 11:00 Madrid: 12 hechas, 3 contestadas (25 %)
      ...Array.from({ length: 10 }, (_, i) => llamada('2026-10-21T10:00:00Z', { estado: i < 6 ? 'ANSWERED' : 'NO_ANSWER', duracion_s: i < 6 ? 80 : 0 })), // 12:00: 10 hechas, 6 contestadas (60 %)
      ...Array.from({ length: 3 }, () => llamada('2026-10-22T11:00:00Z')), // 13:00: 3 hechas, todas contestadas, pero son pocas
    ],
    semana
  )
  const f = franjasDestacadas(grande)
  ok('la franja con más llamadas: las 11 (12)', f.masLlamadas?.hora === 11 && f.masLlamadas.hechas === 12, j(f.masLlamadas))
  ok('la que más contesta: las 12 (60 %), y no las 13, que tienen un 100 % con tres llamadas', f.masContacto?.hora === 12 && Math.round((f.masContacto?.tasa ?? 0) * 100) === 60, j(f.masContacto))
  ok('sin llamadas suficientes no hay franja de contacto, y sin llamadas no hay nada', franjasDestacadas(grande, 50).masContacto === null && franjasDestacadas(mapaHorario([], semana)).masLlamadas === null)

  ok('la intensidad de color', intensidadDeCelda(0, 10) === 0 && intensidadDeCelda(1, 10) === 1 && intensidadDeCelda(3, 10) === 2 && intensidadDeCelda(6, 10) === 3 && intensidadDeCelda(8, 10) === 4 && intensidadDeCelda(10, 10) === 4 && intensidadDeCelda(5, 0) === 0)
}

console.log('\n=== el horario de cada persona ===')
{
  const ev = (minuto: number): EventoDeLinea => ({ id: `e${minuto}`, carril: 'llamadas', minuto, hora: horaDeMinuto(minuto), titulo: '', detalle: '', estilo: 'normal' })
  const dias = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']
  const eventos = new Map<string, EventoDeLinea[]>([
    ['2026-10-19', [550, 570, 600, 650, 700, 730].map(ev)], // de 9:10 a 12:10; el hueco más largo es de 50 min
    ['2026-10-20', [570, 580, 800, 1080, 1090].map(ev)], // de 9:30 a 18:10; entre 13:20 y 18:00 hay 280 min
    ['2026-10-21', [1320, 1325].map(ev)], // dos apuntes a las diez de la noche: no es una jornada
  ])
  const h = horarioSemanal(eventos, dias)
  ok('el primero y el último de cada día', h.dias[0].primera === '09:10' && h.dias[0].ultima === '12:10' && h.dias[1].primera === '09:30' && h.dias[1].ultima === '18:10', j(h.dias.map((d) => [d.primera, d.ultima])))
  ok('el hueco más largo de cada día, en minutos', h.dias[0].pausaMasLarga === 50 && h.dias[1].pausaMasLarga === 280 && h.dias[2].pausaMasLarga === 0, j(h.dias.map((d) => d.pausaMasLarga)))
  ok('un día sin nada no tiene horas', h.dias[3].primera === null && h.dias[3].ultima === null && h.dias[3].eventos === 0)
  ok('la hora media de empezar y acabar solo cuenta jornadas de verdad (5 apuntes o más): 9:10 y 9:30 = 9:20; 12:10 y 18:10 = 15:10', h.inicioMedio === '09:20' && h.finMedio === '15:10' && h.diasConActividad === 2, j([h.inicioMedio, h.finMedio, h.diasConActividad]))
  const nadie = horarioSemanal(new Map(), dias)
  ok('sin jornadas, sin media', nadie.inicioMedio === null && nadie.finMedio === null && nadie.diasConActividad === 0)
  ok('el texto del hueco', textoDePausa(0) === '—' && textoDePausa(65) === '1 h 05 min' && textoDePausa(40) === '40 min')
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
