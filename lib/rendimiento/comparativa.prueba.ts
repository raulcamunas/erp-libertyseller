import {
  baseDe,
  contacto,
  hayActividad,
  indexar,
  llamadasPorDiaLaborable,
  promediar,
  resultadoDePersona,
  seriesDeCifras,
  sumarTotales,
  tendenciaDe,
  totalesDeRango,
  totalesVacios,
  tramosDeComparacion,
  variacion,
  variacionDePuntos,
  ventanaDeDatos,
  type FilaDiaria,
} from '@/lib/rendimiento/comparativa'
import { diasDelRango, etiquetaDeRango, type Periodo } from '@/lib/rendimiento/periodos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const j = (x: unknown) => JSON.stringify(x)

/**
 * COMPARAR PERIODOS.
 *
 * Calendario de referencia, octubre de 2026: el 1 es jueves, el 19 es lunes, el 22 es jueves (HOY) y el 25 domingo.
 */
const HOY = '2026-10-22'
const MAOLI = 'u-maoli'
const DANIELA = 'u-daniela'

const fila = (user_id: string, dia: string, extra: Partial<FilaDiaria> = {}): FilaDiaria => ({
  user_id,
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
  ...extra,
})

const dia = (ancla: string): Periodo => ({ tipo: 'dia', ancla })
const semana = (ancla: string): Periodo => ({ tipo: 'semana', ancla })
const mes = (ancla: string): Periodo => ({ tipo: 'mes', ancla })

console.log('\n=== sumar las filas de un rango ===')
{
  const filas = [
    fila(MAOLI, '2026-10-20', { realizadas: 50, contestadas: 20, conversaciones: 6, segundos: 1500, whatsapp: 2, whatsapp_apuntes: 5 }),
    fila(MAOLI, '2026-10-21', { realizadas: 52, contestadas: 34, conversaciones: 9, segundos: 1460, correos: 3, correos_apuntes: 4, respuestas: 1, citas: 1 }),
    fila(DANIELA, '2026-10-21', { realizadas: 11 }),
    fila(MAOLI, '2026-10-26', { realizadas: 40 }),
  ]
  const porPersona = indexar(filas)
  const t = totalesDeRango(porPersona.get(MAOLI), { desde: '2026-10-19', hasta: '2026-10-25' })
  ok('la semana de Maoli: 102 llamadas, 54 contestadas y 15 conversaciones', t.llamadas === 102 && t.contestadas === 54 && t.conversaciones === 15, j(t))
  ok('con sus conversaciones de WhatsApp y de correo, y lo apuntado', t.whatsapp === 2 && t.whatsappApuntes === 5 && t.correos === 3 && t.correosApuntes === 4 && t.respuestas === 1 && t.citas === 1)
  ok('un día fuera del rango no entra (el 26)', t.llamadas === 102)
  ok('lo de Daniela no se mezcla con lo de Maoli', totalesDeRango(porPersona.get(DANIELA), { desde: '2026-10-19', hasta: '2026-10-25' }).llamadas === 11)
  ok('una persona sin filas, todo a cero y sin romper nada', j(totalesDeRango(porPersona.get('nadie'), { desde: '2026-10-19', hasta: '2026-10-25' })) === j(totalesVacios()))
  ok('contacto: contestadas entre hechas', Math.abs(contacto(t) - 54 / 102) < 1e-9 && contacto(totalesVacios()) === 0)
  ok('hayActividad', hayActividad(t) && !hayActividad(totalesVacios()))
  const dos = sumarTotales([t, totalesDeRango(porPersona.get(DANIELA), { desde: '2026-10-19', hasta: '2026-10-25' })])
  ok('la suma del equipo', dos.llamadas === 113)
  ok('la media de dos', promediar([t, totalesVacios()]).llamadas === 51 && promediar([]).llamadas === 0)
}

console.log('\n=== con qué se compara cada periodo ===')
{
  const d = tramosDeComparacion(dia('2026-10-22'), HOY)!
  ok('un jueves se compara con los cuatro jueves anteriores', j(d.bases.map((b) => b.desde)) === j(['2026-10-15', '2026-10-08', '2026-10-01', '2026-09-24']) && d.texto === 'la media de los jueves anteriores (hoy todavía no ha acabado)', j(d))
  ok('si no es hoy, sin la aclaración', tramosDeComparacion(dia('2026-10-15'), HOY)!.texto === 'la media de los jueves anteriores')
  ok('y el día en sí', j(d.actual) === j({ desde: '2026-10-22', hasta: '2026-10-22' }))
  ok('un sábado, con los sábados', tramosDeComparacion(dia('2026-10-17'), HOY)!.texto === 'la media de los sábados anteriores')
  ok('un día del futuro no tiene nada que medir', tramosDeComparacion(dia('2026-10-23'), HOY) === null)

  const s = tramosDeComparacion(semana('2026-10-22'), HOY)!
  ok('la semana en curso (4 días) se compara con los 4 primeros de la anterior', j(s.actual) === j({ desde: '2026-10-19', hasta: '2026-10-22' }) && j(s.bases) === j([{ desde: '2026-10-12', hasta: '2026-10-15' }]) && s.texto === 'la semana anterior, hasta el jueves', j(s))
  const sPasada = tramosDeComparacion(semana('2026-10-14'), HOY)!
  ok('una semana ya cerrada, con la anterior ENTERA', j(sPasada.actual) === j({ desde: '2026-10-12', hasta: '2026-10-18' }) && j(sPasada.bases) === j([{ desde: '2026-10-05', hasta: '2026-10-11' }]) && sPasada.texto === 'la semana anterior')
  ok('el domingo la semana en curso ya está entera', j(tramosDeComparacion(semana('2026-10-22'), '2026-10-25')!.bases) === j([{ desde: '2026-10-12', hasta: '2026-10-18' }]))
  ok('una semana futura no existe', tramosDeComparacion(semana('2026-10-26'), HOY) === null)

  const m = tramosDeComparacion(mes('2026-10-05'), HOY)!
  ok('el mes en curso (22 días) se compara con los 22 primeros del anterior', j(m.actual) === j({ desde: '2026-10-01', hasta: '2026-10-22' }) && j(m.bases) === j([{ desde: '2026-09-01', hasta: '2026-09-22' }]) && m.texto === 'el mes anterior, hasta el día 22', j(m))
  const mCerrado = tramosDeComparacion(mes('2026-09-05'), HOY)!
  ok('un mes cerrado, con el anterior entero (agosto tiene 31 días, septiembre 30)', j(mCerrado.actual) === j({ desde: '2026-09-01', hasta: '2026-09-30' }) && j(mCerrado.bases) === j([{ desde: '2026-08-01', hasta: '2026-08-31' }]) && mCerrado.texto === 'el mes anterior', j(mCerrado))
  const mCorto = tramosDeComparacion(mes('2026-03-05'), '2026-03-30')!
  ok('si el mes anterior fue más corto (febrero), se compara con todo él', j(mCorto.bases) === j([{ desde: '2026-02-01', hasta: '2026-02-28' }]) && mCorto.texto === 'el mes anterior', j(mCorto))
  ok('en enero el mes anterior es diciembre del año anterior', j(tramosDeComparacion(mes('2026-01-10'), '2026-01-10')!.bases) === j([{ desde: '2025-12-01', hasta: '2025-12-10' }]))
}

console.log('\n=== la referencia de una persona ===')
{
  // Cuatro jueves anteriores; la media cuenta solo los que tuvieron actividad
  const filas = [
    fila(MAOLI, '2026-10-15', { realizadas: 40, contestadas: 10 }),
    fila(MAOLI, '2026-10-08', { realizadas: 60, contestadas: 20 }),
    // el 1 de octubre y el 24 de septiembre, sin filas: vacaciones
    fila(MAOLI, '2026-10-22', { realizadas: 52 }),
  ]
  const porDia = indexar(filas).get(MAOLI)
  const c = tramosDeComparacion(dia('2026-10-22'), HOY)!
  const base = baseDe(porDia, c)!
  ok('la media de los jueves CON actividad: (40 + 60) / 2 = 50, no 25', base.llamadas === 50 && base.contestadas === 15, j(base))
  ok('sin actividad en ninguno, no hay referencia', baseDe(indexar([fila(MAOLI, '2026-10-22', { realizadas: 5 })]).get(MAOLI), c) === null)
  ok('una persona que no existe no tiene referencia', baseDe(undefined, c) === null)

  const sem = tramosDeComparacion(semana('2026-10-22'), HOY)!
  const filasSemana = [fila(MAOLI, '2026-10-12', { realizadas: 50 }), fila(MAOLI, '2026-10-14', { realizadas: 50 }), fila(MAOLI, '2026-10-16', { realizadas: 999 })]
  ok('la semana en curso se compara con el MISMO tramo (lun-jue) de la anterior: 100, no 1.099', baseDe(indexar(filasSemana).get(MAOLI), sem)!.llamadas === 100)
  ok('y si en ese tramo no hubo nada, no hay referencia', baseDe(indexar([fila(MAOLI, '2026-10-16', { realizadas: 30 })]).get(MAOLI), sem) === null)
}

console.log('\n=== cuánto ha cambiado ===')
{
  const v = (a: number, b: number | null) => variacion(a, b)
  ok('de 100 a 112: sube un 12 %', v(112, 100).sentido === 'sube' && v(112, 100).texto === '+12 %')
  ok('de 100 a 92: baja un 8 %, con el signo menos de verdad', v(92, 100).sentido === 'baja' && v(92, 100).texto === '−8 %')
  ok('un 2 % es ruido: igual', v(102, 100).sentido === 'igual' && v(98, 100).texto === 'igual')
  ok('justo un 3 % ya es cambio', v(103, 100).sentido === 'sube' && v(97, 100).sentido === 'baja')
  ok('con referencias pequeñas se dice la diferencia, no un porcentaje: de 5 a 8, +3; de 5 a 3, −2', v(8, 5).texto === '+3' && v(3, 5).texto === '−2')
  ok('de 2,5 a 2,6 es igual', v(2.6, 2.5).sentido === 'igual')
  ok('de 10 a 15 ya es un porcentaje: +50 %', v(15, 10).texto === '+50 %')
  ok('sin referencia pero con algo: «sin referencia», no un infinito', v(7, null).sentido === 'sinBase' && v(7, 0).texto === 'sin referencia')
  ok('sin referencia y sin nada: igual', v(0, null).sentido === 'igual' && v(0, 0).sentido === 'igual')
  ok('una persona que llamó 0 contra una referencia de 40: −100 %', v(0, 40).texto === '−100 %')
  ok('los puntos del porcentaje de contacto: 34 % contra 36 % son −2 pts', variacionDePuntos(0.34, 0.36).texto === '−2 pts' && variacionDePuntos(0.4, 0.34).texto === '+6 pts')
  ok('menos de un punto es igual, y sin referencia se dice', variacionDePuntos(0.345, 0.34).sentido === 'igual' && variacionDePuntos(0.3, null).sentido === 'sinBase')
}

console.log('\n=== lo que hay que pedir a la base ===')
{
  const d = ventanaDeDatos(dia('2026-10-22'))
  ok('un día: él y las cuatro semanas anteriores (29 días)', d.desde === '2026-09-24' && d.hasta === '2026-10-22' && diasDelRango(d).length === 29)
  const s = ventanaDeDatos(semana('2026-10-22'))
  ok('una semana: ella y las tres anteriores (28 días, de lunes a domingo)', s.desde === '2026-09-28' && s.hasta === '2026-10-25' && diasDelRango(s).length === 28)
  const m = ventanaDeDatos(mes('2026-10-22'))
  ok('un mes: él y los tres anteriores, de julio a octubre', m.desde === '2026-07-01' && m.hasta === '2026-10-31' && diasDelRango(m).length === 123)
  ok('ninguna pasa de lo que acepta la función de la base (400 días)', diasDelRango(m).length <= 400)
  ok('la comparación siempre cabe en la ventana: el día más antiguo que hace falta', tramosDeComparacion(dia('2026-10-22'), HOY)!.bases.every((b) => b.desde >= d.desde) && tramosDeComparacion(semana('2026-10-22'), HOY)!.bases.every((b) => b.desde >= s.desde) && tramosDeComparacion(mes('2026-10-22'), HOY)!.bases.every((b) => b.desde >= m.desde))
}

console.log('\n=== la tendencia ===')
{
  const etiquetar = etiquetaDeRango
  const filas: FilaDiaria[] = []
  // Semanas anteriores de 250 llamadas (50 por laborable) y la actual de 200 en sus 4 días: no es una caída
  for (const [lunes, total] of [['2026-09-28', 200], ['2026-10-05', 250], ['2026-10-12', 250]] as const) {
    for (let i = 0; i < 5; i++) filas.push(fila(MAOLI, addDias(lunes, i), { realizadas: total / 5 }))
  }
  for (let i = 0; i < 4; i++) filas.push(fila(MAOLI, addDias('2026-10-19', i), { realizadas: 50 }))
  const porDia = indexar(filas).get(MAOLI)

  const t = tendenciaDe(porDia, semana('2026-10-22'), HOY, etiquetar)
  ok('4 puntos, del más antiguo al actual, y solo el último es el actual', t.length === 4 && t.map((p) => p.actual).join() === 'false,false,false,true')
  ok('por día laborable: 40, 50, 50 y 50 (la semana a medias NO parece una caída)', j(t.map((p) => p.valor)) === j([40, 50, 50, 50]), j(t.map((p) => p.valor)))
  ok('con su etiqueta', t[3].etiqueta === '19–25 oct' && t[0].etiqueta === '28 sep – 4 oct', j(t.map((p) => p.etiqueta)))

  const diaFilas = [fila(MAOLI, '2026-10-14', { realizadas: 30 }), fila(MAOLI, '2026-10-16', { realizadas: 45 }), fila(MAOLI, '2026-10-19', { realizadas: 50 }), fila(MAOLI, '2026-10-22', { realizadas: 52 })]
  const td = tendenciaDe(indexar(diaFilas).get(MAOLI), dia('2026-10-22'), HOY, etiquetar)
  ok('un día: sus últimos 7 laborables, sin fines de semana (14, 15, 16, 19, 20, 21 y 22)', td.length === 7 && td[0].etiqueta === '14 oct' && td[6].etiqueta === '22 oct', j(td.map((p) => p.etiqueta)))
  ok('con las llamadas de cada día, y 0 donde no hubo fila', j(td.map((p) => p.valor)) === j([30, 0, 45, 50, 0, 0, 52]), j(td.map((p) => p.valor)))
  ok('solo el día mirado es el actual', td.filter((p) => p.actual).length === 1 && td[6].actual)
  const sabado = tendenciaDe(undefined, dia('2026-10-24'), '2026-10-24', etiquetar)
  ok('mirando un sábado la serie acaba en el viernes anterior', sabado.length === 7 && sabado[6].etiqueta === '23 oct')

  const meses = tendenciaDe(indexar([fila(MAOLI, '2026-09-15', { realizadas: 220 }), fila(MAOLI, '2026-10-05', { realizadas: 100 })]).get(MAOLI), mes('2026-10-22'), HOY, etiquetar)
  ok('un mes: 4 puntos (julio a octubre), por día laborable', meses.length === 4 && Math.abs(meses[2].valor - 220 / 22) < 1e-9 && Math.abs(meses[3].valor - 100 / 16) < 1e-9, j(meses.map((p) => p.valor)))
  ok('llamadas por día laborable: 200 en 4 días = 50; un periodo que no ha empezado, 0', llamadasPorDiaLaborable(200, { desde: '2026-10-19', hasta: '2026-10-25' }, HOY) === 50 && llamadasPorDiaLaborable(200, { desde: '2026-10-26', hasta: '2026-11-01' }, HOY) === 0)
}

console.log('\n=== los últimos días de cada cifra ===')
{
  // Siete laborables hasta el jueves 22: mié 14, jue 15, vie 16, lun 19, mar 20, mié 21 y jue 22
  const filas = [
    fila(MAOLI, '2026-10-14', { realizadas: 10, whatsapp: 1 }),
    fila(MAOLI, '2026-10-16', { realizadas: 30, citas: 2 }),
    fila(MAOLI, '2026-10-19', { realizadas: 40, correos: 3, respuestas: 1 }),
    fila(MAOLI, '2026-10-22', { realizadas: 52, whatsapp: 4 }),
    fila(MAOLI, '2026-10-17', { realizadas: 99 }), // un sábado: no entra
  ]
  const porDia = indexar(filas).get(MAOLI)
  const s = seriesDeCifras(porDia, dia('2026-10-22'), HOY)
  ok('un día: sus siete últimos laborables, del más antiguo al más reciente', s.llamadas.valores.join() === '10,0,30,40,0,0,52', s.llamadas.valores.join())
  ok('con su nombre de día', s.llamadas.etiquetas.join() === 'mié 14,jue 15,vie 16,lun 19,mar 20,mié 21,jue 22', s.llamadas.etiquetas.join())
  ok('cada cifra, la suya', s.whatsapp.valores.join() === '1,0,0,0,0,0,4' && s.correos.valores.join() === '0,0,0,3,0,0,0' && s.respuestas.valores.join() === '0,0,0,1,0,0,0' && s.citas.valores.join() === '0,0,2,0,0,0,0')
  ok('el sábado no cuenta: ni una barra de cero ni sus 99 llamadas', !s.llamadas.valores.includes(99) && s.llamadas.valores.length === 7)
  ok('una semana en curso se mide hasta hoy, no hasta el domingo', seriesDeCifras(porDia, semana('2026-10-20'), HOY).llamadas.etiquetas.join() === s.llamadas.etiquetas.join())
  ok('una semana ya cerrada acaba en su viernes (el domingo no es laborable)', seriesDeCifras(porDia, semana('2026-10-20'), '2026-10-27').llamadas.etiquetas[6] === 'vie 23')
  ok('un mes en curso acaba hoy y uno pasado, en su último día laborable', seriesDeCifras(porDia, mes('2026-10-05'), HOY).llamadas.etiquetas[6] === 'jue 22' && seriesDeCifras(porDia, mes('2026-09-05'), HOY).llamadas.etiquetas[6] === 'mié 30')
  ok('un domingo se queda en el viernes de antes', seriesDeCifras(porDia, dia('2026-10-18'), HOY).llamadas.etiquetas[6] === 'vie 16')
  ok('sin datos, siete ceros', seriesDeCifras(undefined, dia('2026-10-22'), HOY).llamadas.valores.join() === '0,0,0,0,0,0,0')
}

console.log('\n=== la fila de una persona ===')
{
  const filas = [fila(MAOLI, '2026-10-22', { realizadas: 52, contestadas: 34 }), fila(MAOLI, '2026-10-15', { realizadas: 40, contestadas: 20 })]
  const porDia = indexar(filas).get(MAOLI)
  const p = dia('2026-10-22')
  const r = resultadoDePersona(porDia, p, HOY, tramosDeComparacion(p, HOY), etiquetaDeRango)
  ok('lo actual, la referencia y la tendencia', r.actual.llamadas === 52 && r.base?.llamadas === 40 && r.tendencia.length === 7)
  const futuro = resultadoDePersona(porDia, dia('2026-10-23'), HOY, null, etiquetaDeRango)
  ok('un periodo sin nada que medir (futuro) da ceros y sin referencia', futuro.actual.llamadas === 0 && futuro.base === null)
}

function addDias(d: string, n: number): string {
  const [y, m, dd] = d.split('-').map(Number)
  const f = new Date(Date.UTC(y, m - 1, dd + n))
  return `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, '0')}-${String(f.getUTCDate()).padStart(2, '0')}`
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
