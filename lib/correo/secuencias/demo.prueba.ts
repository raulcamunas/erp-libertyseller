import { revisarBorrador } from '@/lib/correo/ia-prompt'
import { DIAS_MAXIMOS_DE_LA_DEMO, demostracion, diaHabilRelativo, momentoDeLaDemo, olvidarDemostraciones } from '@/lib/correo/secuencias/demo'
import { COMERCIALES_DE_DEMO, PERSONAS_DE_DEMO } from '@/lib/correo/secuencias/demo-personas'
import { TEXTOS_DE_DEMO } from '@/lib/correo/secuencias/demo-textos'
import { diaDeMadrid, instanteDeMadrid, partesDeMadrid } from '@/lib/correo/secuencias/fechas'
import { revisarSeguimiento } from '@/lib/correo/secuencias/revision'
import { colaDeSecuencias, detalleDeSecuencia, tablero } from '@/lib/correo/secuencias/servidor'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** Un lunes a media mañana: el 26 de octubre de 2026 */
const LUNES = instanteDeMadrid('2026-10-26', 10 * 60)

async function main() {
  console.log('\n=== el calendario ===')
  {
    ok('un día hábil hacia atrás salta el fin de semana: el viernes anterior a un lunes', diaHabilRelativo('2026-10-26', -1) === '2026-10-23')
    ok('nueve hacia atrás desde el lunes 26: el martes 13 (dos semanas menos un día)', diaHabilRelativo('2026-10-26', -9) === '2026-10-13', diaHabilRelativo('2026-10-26', -9))
    ok('tres hacia delante desde el lunes: el jueves', diaHabilRelativo('2026-10-26', 3) === '2026-10-29')
    ok('cero desde un sábado es el viernes anterior', diaHabilRelativo('2026-10-24', 0) === '2026-10-23')
    const lunes = momentoDeLaDemo(LUNES)
    ok('«hoy» en un día hábil es ese día, a las 14:00', lunes.dia === '2026-10-26' && lunes.minutos === 14 * 60)
    const sabado = momentoDeLaDemo(instanteDeMadrid('2026-10-24', 3 * 60))
    ok('un sábado de madrugada, la demostración está en el viernes a las 14:00', sabado.dia === '2026-10-23' && sabado.minutos === 14 * 60, JSON.stringify(sabado))
  }

  console.log('\n=== los textos que escribió la IA ===')
  {
    ok('hay textos de las doce personas, y cada una trae los dos borradores', PERSONAS_DE_DEMO.length === 12 && PERSONAS_DE_DEMO.every((p) => TEXTOS_DE_DEMO[p.id]?.borradores.length === 2))
    const todos = Object.entries(TEXTOS_DE_DEMO).flatMap(([id, t]) => [
      { id, que: 'primero', texto: t.primero.texto, asunto: t.primero.asunto },
      ...t.borradores.map((x, i) => ({ id, que: `borrador ${i + 1}`, texto: x, asunto: '' })),
      ...Object.entries(t.medida).flatMap(([n, m]) => (m && m.decision === 'escribir' ? [{ id, que: `a medida ${n}`, texto: m.texto, asunto: '' }] : [])),
    ])
    ok('ningún texto lleva letras de otro alfabeto (la IA coló una palabra en hebreo en una de las pruebas)', todos.every((x) => !/[^\x00-\x7F -ÿ‐-‧«»€]/.test(`${x.asunto}${x.texto}`)), todos.find((x) => /[^\x00-\x7F -ÿ‐-‧«»€]/.test(x.texto))?.id)
    ok('ninguno habla de dinero ni deja huecos por rellenar', todos.every((x) => !revisarSeguimiento(x.texto).some((p) => p === 'dinero' || p === 'hueco')), todos.find((x) => revisarSeguimiento(x.texto).some((p) => p === 'dinero' || p === 'hueco'))?.id)
    ok('los seguimientos tienen un tamaño de seguimiento', todos.filter((x) => x.que !== 'primero').every((x) => !revisarSeguimiento(x.texto).some((p) => p === 'largo' || p === 'corto')))
    ok('y los primeros correos pasan la misma revisión que un borrador de verdad', Object.values(TEXTOS_DE_DEMO).every((t) => revisarBorrador({ asunto: t.primero.asunto, texto: t.primero.texto, angulo: 'entrar_en_amazon' }).length === 0))
    ok('las direcciones de las tiendas llevan «-demo» y ningún nombre real', PERSONAS_DE_DEMO.every((p) => /-demo\.es$/.test(p.email)) && !JSON.stringify([COMERCIALES_DE_DEMO, PERSONAS_DE_DEMO]).match(/Jhanna|Daniela|María Fernanda|Maoli|Alejandro|Raúl/))
  }

  console.log('\n=== el mundo de hoy ===')
  olvidarDemostraciones()
  const t0 = Date.now()
  const hoy = await demostracion({ dias: 0, real: LUNES })
  const ms = Date.now() - t0
  ok('se construye deprisa (cada petición de la pantalla lo reutiliza)', ms < 3000, `${ms} ms`)
  ok('es el lunes 26 a las 14:00 de Madrid, y quien mira es un administrador', hoy.dia === '2026-10-26' && partesDeMadrid(hoy.ahora).minutos === 14 * 60 && hoy.quien.role === 'admin' && hoy.dias === 0)
  const t = await tablero(hoy.almacen, hoy.quien, { ahora: hoy.ahora })
  if (!t.disponible) throw new Error('El tablero de la demostración no está disponible')
  ok('el motor está en marcha y de verdad (no en ensayo)', t.ajustes.activa && !t.ajustes.modoEnsayo && t.puedeAdministrar)
  ok('dos buzones, de dos comerciales inventados', t.buzones.length === 2 && t.buzones.map((b) => b.propietario.nombre).sort().join() === 'Lucía,Marcos', JSON.stringify(t.buzones.map((b) => b.propietario.nombre)))
  ok('cada buzón trabaja a diario: correos a mano y los automáticos de hoy, dentro del tope', t.buzones.every((b) => b.enviadosHoy > 0 && b.enviadosHoy <= b.topeHoy && b.manualHoy > 0), JSON.stringify(t.buzones.map((b) => [b.enviadosHoy, b.topeHoy])))
  ok('el estado de las doce: 7 en marcha, 1 en pausa, 2 han contestado, 1 rebotó y 1 completó (Cerámica)', t.conteos.activa === 7 && t.conteos.pausada === 1 && t.conteos.respondida === 2 && t.conteos.parada === 1 && t.conteos.completada === 1 && t.conteos.cancelada === 0, JSON.stringify(t.conteos))
  ok('la IA ha leído las dos respuestas (un «interesado» y un «no»)', t.respuestas.total === 2 && t.respuestas.porClase.some((c) => c.clase === 'interesado') && t.respuestas.porClase.some((c) => c.clase === 'no_interesa'))
  ok('la salud está en orden: sin alarmas', t.salud.nivel === 'ok' && t.salud.alarmas.length === 0, `${t.salud.nivel} ${t.salud.alarmas.map((a) => a.titulo).join(',')}`)
  ok('hay próximos días con correos programados', t.proximos.reduce((s, d) => s + d.total, 0) >= 8)

  const cola = await colaDeSecuencias(hoy.almacen, hoy.quien, { grupo: 'todas', limite: 50 })
  const de = (nombre: string) => cola.items.find((i) => i.lead.nombre === nombre)
  ok('doce personas en la cola, todas con una dirección «-demo»', cola.total === 12 && cola.items.every((i) => /-demo\.es$/.test(i.destinatario)), String(cola.total))
  ok('Ferretería Ortega: la IA pausó su seguimiento porque pidió esperar a después de Reyes', de('Ferretería Ortega')?.estado === 'pausada' && /Reyes/.test(de('Ferretería Ortega')?.motivo ?? ''), JSON.stringify(de('Ferretería Ortega')?.motivo))
  ok('Deportes Peña contestó que no, y Audiomax que sí', de('Deportes Peña')?.estado === 'respondida' && de('Audiomax')?.estado === 'respondida')
  ok('Bicis Norte: el correo rebotó', de('Bicis Norte')?.estado === 'parada' && /rebot/.test(de('Bicis Norte')?.motivo ?? ''))
  ok('Cerámica Mediterránea ya recibió los tres correos', de('Cerámica Mediterránea')?.estado === 'completada')

  const casaLuz = await detalleDeSecuencia(hoy.almacen, hoy.quien, de('Casa Luz Decoración')!.id)
  const s1 = casaLuz?.pasos.find((p) => p.orden === 1)
  ok('Casa Luz: su primer seguimiento lo escribió la IA justo antes de enviarlo, mencionando la llamada', s1?.estado === 'enviado' && s1.adaptado === true && /llamarte/.test(s1.textoEnviado ?? ''), s1?.textoEnviado?.slice(0, 80))
  ok('y se conserva el borrador original, distinto de lo que salió', Boolean(s1 && s1.texto !== s1.textoEnviado && s1.texto === TEXTOS_DE_DEMO.casaluz.borradores[0]))
  ok('el rastro cuenta lo que pasó', (casaLuz?.eventos ?? []).some((e) => e.tipo === 'adaptado') && (casaLuz?.eventos ?? []).some((e) => e.tipo === 'enviado'))
  const audiomax = await detalleDeSecuencia(hoy.almacen, hoy.quien, de('Audiomax')!.id)
  ok('Audiomax: la tarjeta de lectura dice lo que entendió la IA', audiomax?.respuesta?.clase === 'interesado' && /llamen mañana/.test(audiomax.respuesta.resumen ?? ''), JSON.stringify(audiomax?.respuesta?.clase))
  ok('el administrador puede actuar pero no editar el texto (es del dueño del buzón)', audiomax?.permisos.puedeAdministrar === true && audiomax.permisos.puedeEditar === false)

  console.log('\n=== avanzar el reloj ===')
  const ids = new Map(cola.items.map((i) => [i.lead.nombre, i.id]))
  const mismo = await demostracion({ dias: 0, real: LUNES + 60_000 })
  ok('pedirla otra vez enseguida da el MISMO mundo (no se rehace)', mismo === hoy)
  const tres = await demostracion({ dias: 3, real: LUNES })
  const colaTres = await colaDeSecuencias(tres.almacen, tres.quien, { grupo: 'todas', limite: 50 })
  ok('con +3 días el reloj marca el jueves a las 14:00', diaDeMadrid(tres.ahora) === '2026-10-29' && partesDeMadrid(tres.ahora).minutos === 14 * 60 && tres.dias === 3)
  ok('las mismas doce personas conservan su identificador (un detalle abierto sobrevive al cambiar el reloj)', colaTres.items.length === 12 && colaTres.items.every((i) => ids.get(i.lead.nombre) === i.id))
  const tabTres = await tablero(tres.almacen, tres.quien, { ahora: tres.ahora })
  if (!tabTres.disponible) throw new Error('no disponible')
  ok('han seguido pasando cosas: más completadas y una respuesta más (Librería Atlas pide que le escriban en enero)', tabTres.conteos.completada > t.conteos.completada && tabTres.conteos.respondida === 3 && tabTres.respuestas.total === 3, JSON.stringify(tabTres.conteos))

  const siete = await demostracion({ dias: DIAS_MAXIMOS_DE_LA_DEMO, real: LUNES })
  const colaSiete = await colaDeSecuencias(siete.almacen, siete.quien, { grupo: 'todas', limite: 50 })
  const deSiete = (nombre: string) => colaSiete.items.find((i) => i.lead.nombre === nombre)
  ok('con +7 días Cerámica, que no contestó, se cierra sin respuesta', deSiete('Cerámica Mediterránea')?.estado === 'sin_respuesta')
  const atlas = await detalleDeSecuencia(siete.almacen, siete.quien, deSiete('Librería Atlas')!.id)
  ok('Librería Atlas: «escríbeme en enero» programó la rellamada', atlas?.respuesta?.clase === 'mas_tarde' && atlas.respuesta.accion === 'rellamar', JSON.stringify(atlas?.respuesta))
  ok('Cosmética Natural contestó pidiendo información', deSiete('Cosmética Natural')?.estado === 'respondida')
  const tabSiete = await tablero(siete.almacen, siete.quien, { ahora: siete.ahora })
  ok('y la salud sigue en orden', tabSiete.disponible && tabSiete.salud.nivel === 'ok')

  ok('más días de los que se pueden son los máximos, y un número raro es hoy', (await demostracion({ dias: 99, real: LUNES })) === siete && (await demostracion({ dias: -4, real: LUNES })) === hoy && (await demostracion({ dias: Number.NaN, real: LUNES })) === hoy)
  const otroDia = await demostracion({ dias: 0, real: instanteDeMadrid('2026-11-03', 9 * 60) })
  ok('otro día es otro mundo', otroDia !== hoy && otroDia.dia === '2026-11-03')
  ok('un sábado se ve igual de vivo: el mundo es el del viernes', (await demostracion({ dias: 0, real: instanteDeMadrid('2026-10-24', 11 * 60) })).dia === '2026-10-23')

  console.log('\n=== el mismo mundo, dos veces ===')
  olvidarDemostraciones()
  const otra = await demostracion({ dias: 0, real: LUNES })
  const colaOtra = await colaDeSecuencias(otra.almacen, otra.quien, { grupo: 'todas', limite: 50 })
  ok('rehecho desde cero sale igual: mismos identificadores, mismos estados y mismas horas', otra !== hoy && JSON.stringify(colaOtra.items.map((i) => [i.id, i.estado, i.siguiente?.en ?? null])) === JSON.stringify(cola.items.map((i) => [i.id, i.estado, i.siguiente?.en ?? null])))

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
