import { BRIEFING_DE_EJEMPLO } from '@/lib/briefing/ejemplo'
import { LIMITES, claveDeUnPunto, diaEnElTexto, etiquetaDelDia, huellaCorta, normalizarBriefing, resolverDia, resumenDelBriefing } from '@/lib/briefing/esquema'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const j = (x: unknown) => JSON.stringify(x)
const copia = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T
const bueno = () => {
  const r = normalizarBriefing(copia(BRIEFING_DE_EJEMPLO))
  if (!r.ok) throw new Error(`el ejemplo no vale: ${r.error}`)
  return r
}

console.log('\n=== el briefing de siempre se lee entero ===')
{
  const r = bueno()
  const b = r.briefing
  ok('sin avisos: el ejemplo ya viene limpio', r.avisos.length === 0, j(r.avisos))
  ok('el titular y las etiquetas de fecha se conservan', b.titular === BRIEFING_DE_EJEMPLO.titular && b.fecha_label === 'Martes 27 de octubre de 2026' && b.actualizado === '27/10 · 07:40')
  ok('la agenda, «Revisa hoy» y el correo, con sus elementos', b.agenda.length === 2 && b.revisar.length === 4 && b.correo.length === 2)
  ok('los comerciales: totales, notas, lectura, alertas y personas en su orden', b.comerciales?.totales.llamadas === 90 && b.comerciales.personas.map((p) => p.nombre).join() === 'Lucía,Mateo,Irene' && b.comerciales.alertas.length === 2 && b.comerciales.kpi_nota_citas === 'Ninguna esta semana')
  ok('un número que falta sigue siendo null: nunca se inventa un cero', b.comerciales?.personas[0].llamadas === null && b.comerciales.personas[2].citas === 0)
  ok('el equipo de cuentas con sus tres listas y quién no tiene briefing', b.equipo?.personas[0].hecho.length === 2 && b.equipo.personas[0].bloqueos[0] === 'Nube: sin stock' && b.equipo.sin_briefing[0].nombre === 'Nuria')
  ok('las tareas: totales, comentarios (con «pide»), en revisión, destacadas y pendientes por cliente', b.tareas?.totales.en_progreso === 60 && b.tareas.comentarios[0].pide === false && b.tareas.en_revision[0].checklist === '5/8' && b.tareas.destacadas[0].texto.includes('sin avance') && b.tareas.por_cliente[0].cliente === 'Nube')
  ok('el pie', b.pie.startsWith('Fuentes:'))
  ok('limpiar dos veces da lo mismo (no se estropea al volver a pasar por aquí)', j(normalizarBriefing(copia(b)).ok ? (normalizarBriefing(copia(b)) as { briefing: unknown }).briefing : null) === j(b))
  ok('acepta también el texto JSON (un modelo a veces manda uno y a veces otro)', (() => { const x = normalizarBriefing(JSON.stringify(BRIEFING_DE_EJEMPLO)); return x.ok && x.briefing.titular === b.titular })())
}

console.log('\n=== lo que sobra o falta ===')
{
  const sin = (cambios: Record<string, unknown>) => normalizarBriefing({ ...copia(BRIEFING_DE_EJEMPLO), ...cambios })
  const nada = normalizarBriefing({ titular: 'Solo el titular' })
  ok('con solo el titular vale: las secciones que no vienen quedan vacías o null', nada.ok && nada.briefing.revisar.length === 0 && nada.briefing.comerciales === null && nada.briefing.equipo === null && nada.briefing.tareas === null && nada.briefing.correo.length === 0 && nada.briefing.agenda.length === 0)
  const falta = normalizarBriefing({ ...copia(BRIEFING_DE_EJEMPLO), titular: '' })
  ok('sin titular no vale, y lo dice con una frase', !falta.ok && /titular/i.test(falta.error), j(falta))
  ok('un texto que no es JSON no vale', !normalizarBriefing('esto no es json').ok && !normalizarBriefing(null).ok && !normalizarBriefing([]).ok && !normalizarBriefing(42).ok)
  const rara = sin({ intruso: 'x', revisar: [{ titulo: 'Un punto', area: 'A', nivel: 'urgentísima', otraCosa: 'y' }, 'no soy un objeto', { titulo: '' }, null] })
  ok('lo que no es un punto, o no tiene título, se salta; las claves desconocidas se tiran', rara.ok && rara.briefing.revisar.length === 1 && !('intruso' in rara.briefing) && !('otraCosa' in (rara.briefing.revisar[0] as object)))
  ok('un nivel que no es «alta» es «media»', rara.ok && rara.briefing.revisar[0].nivel === 'media')
  const secciones = sin({ comerciales: 'no soy un objeto', equipo: [], tareas: 7 })
  ok('una sección que no es un objeto es como si no viniera', secciones.ok && secciones.briefing.comerciales === null && secciones.briefing.equipo === null && secciones.briefing.tareas === null)
  const numeros = sin({ comerciales: { totales: { llamadas: '37', whatsapps: '3,5', respuestas: 'muchas', citas: Infinity }, personas: [{ nombre: 'Ana', llamadas: '12', whatsapps: NaN, respuestas: null }] } })
  ok('un número escrito como texto se lee; uno que no lo es, null', numeros.ok && numeros.briefing.comerciales?.totales.llamadas === 37 && numeros.briefing.comerciales.totales.whatsapps === 3.5 && numeros.briefing.comerciales.totales.respuestas === null && numeros.briefing.comerciales.totales.citas === null && numeros.briefing.comerciales.personas[0].llamadas === 12 && numeros.briefing.comerciales.personas[0].whatsapps === null)
}

console.log('\n=== textos y enlaces limpios ===')
{
  const largo = 'x'.repeat(2000)
  const r = normalizarBriefing({ titular: largo, revisar: [{ titulo: 'T', area: 'A', texto: largo, fuente: largo }], correo: [{ titulo: 'C', texto: largo }] })
  ok('un texto larguísimo se recorta con «…» y se avisa', r.ok && r.briefing.titular.length === LIMITES.titular && r.briefing.titular.endsWith('…') && r.briefing.revisar[0].texto.length === LIMITES.texto && r.avisos.some((a) => /recortado/.test(a)), j(r.ok ? r.avisos : r))
  const sucio = normalizarBriefing({ titular: '  Hola\u0000 \n\n  mundo\t\tfeliz  ', revisar: [{ titulo: 'Línea 1\r\nLínea 2', area: 'A' }] })
  ok('los caracteres de control se quitan y los saltos de línea pasan a espacios', sucio.ok && sucio.briefing.titular === 'Hola mundo feliz' && sucio.briefing.revisar[0].titulo === 'Línea 1 Línea 2', j(sucio.ok ? sucio.briefing.titular : ''))
  const html = normalizarBriefing({ titular: '<script>alert(1)</script> Importante' })
  ok('el HTML se guarda como texto (la pantalla lo escribe como texto, nunca como HTML)', html.ok && html.briefing.titular === '<script>alert(1)</script> Importante')
  const urls = normalizarBriefing({
    titular: 'T',
    revisar: [
      { titulo: 'a', area: 'A', url: 'https://mail.google.com/mail/#all/abc' },
      { titulo: 'b', area: 'A', url: 'http://inseguro.test/x' },
      { titulo: 'c', area: 'A', url: 'javascript:alert(1)' },
      { titulo: 'd', area: 'A', url: 'data:text/html,<b>x</b>' },
      { titulo: 'e', area: 'A', url: 'https://' },
      { titulo: 'f', area: 'A', url: '' },
      { titulo: 'g', area: 'A' },
    ],
  })
  ok('solo valen los enlaces https; los demás pasan a null y se cuentan', urls.ok && urls.briefing.revisar.map((x) => x.url === null).join() === 'false,true,true,true,true,true,true' && urls.avisos.some((a) => /enlaces que no eran https/.test(a)), j(urls.ok ? urls.briefing.revisar.map((x) => x.url) : urls))
  ok('el enlace bueno se guarda tal cual, sin retocarlo', urls.ok && urls.briefing.revisar[0].url === 'https://mail.google.com/mail/#all/abc')
}

console.log('\n=== los topes ===')
{
  const muchos = Array.from({ length: 80 }, (_, i) => ({ titulo: `Punto ${i}`, area: 'A' }))
  const r = normalizarBriefing({ titular: 'T', revisar: muchos, correo: muchos, agenda: muchos })
  ok('una lista que pasa del tope se corta en los primeros, y se avisa', r.ok && r.briefing.revisar.length === LIMITES.revisar && r.briefing.correo.length === LIMITES.correo && r.briefing.agenda.length === LIMITES.agenda && r.avisos.some((a) => /Había demasiados/.test(a)), j(r.ok ? r.avisos : r))
  ok('se quedan los PRIMEROS (la rutina los ordena por importancia)', r.ok && r.briefing.revisar[0].titulo === 'Punto 0' && r.briefing.revisar[LIMITES.revisar - 1].titulo === `Punto ${LIMITES.revisar - 1}`)
  const puntos = normalizarBriefing({ titular: 'T', equipo: { personas: [{ nombre: 'Ana', hecho: Array.from({ length: 30 }, (_, i) => `hecho ${i}`) }] } })
  ok('los puntos de una persona también tienen tope', puntos.ok && puntos.briefing.equipo?.personas[0].hecho.length === LIMITES.puntosPorPersona)
  const enorme = normalizarBriefing({
    titular: 'T',
    tareas: { por_cliente: Array.from({ length: 80 }, (_, i) => ({ cliente: `Cliente ${i}`, pendientes: i, en_revision: 0 })), comentarios: Array.from({ length: 40 }, () => ({ tarea: 'x'.repeat(190), texto: 'y'.repeat(490), cliente: 'z'.repeat(70), autor: 'a'.repeat(70) })), destacadas: Array.from({ length: 40 }, () => ({ tarea: 'x'.repeat(190), texto: 'y'.repeat(490) })), en_revision: Array.from({ length: 40 }, () => ({ tarea: 'x'.repeat(190) })) },
    revisar: Array.from({ length: 30 }, (_, i) => ({ titulo: `t${i}`.padEnd(190, 'q'), area: 'A', texto: 'w'.repeat(490), fuente: 'f'.repeat(190), url: `https://x.test/${'p'.repeat(900)}` })),
    correo: Array.from({ length: 30 }, (_, i) => ({ titulo: `c${i}`.padEnd(190, 'q'), texto: 'w'.repeat(490), url: `https://x.test/${'p'.repeat(900)}` })),
  })
  ok('un briefing de un tamaño absurdo se rechaza con una frase (no se guarda)', !enorme.ok && /demasiado grande/.test(enorme.error), enorme.ok ? 'vale' : enorme.error)
}

console.log('\n=== las claves de lo que se puede marcar como resuelto ===')
{
  const b = bueno().briefing
  ok('cada punto de «Revisa hoy» tiene una clave «r-…» y cada correo una «c-…»', b.revisar.every((x) => /^r-[0-9a-f]{8}$/.test(x.clave)) && b.correo.every((x) => /^c-[0-9a-f]{8}$/.test(x.clave)))
  ok('las claves de un briefing son todas distintas', new Set([...b.revisar, ...b.correo].map((x) => x.clave)).size === b.revisar.length + b.correo.length)
  const otra = normalizarBriefing({ ...copia(BRIEFING_DE_EJEMPLO), titular: 'Otro titular distinto', revisar: [...copia(BRIEFING_DE_EJEMPLO).revisar].reverse() })
  ok('volver a publicar el mismo día (con otro orden u otro titular) da las MISMAS claves: lo marcado sigue marcado', otra.ok && j(otra.briefing.revisar.map((x) => x.clave).sort()) === j(b.revisar.map((x) => x.clave).sort()))
  ok('la clave no cambia por una tilde, una mayúscula o un espacio de más', claveDeUnPunto('r', 'Comercial', 'Nadie registra recap') === claveDeUnPunto('r', ' COMERCIAL ', 'nadie  registra   RECAP!'))
  ok('pero sí por el área o por el título', claveDeUnPunto('r', 'Comercial', 'X') !== claveDeUnPunto('r', 'Entrais', 'X') && claveDeUnPunto('r', 'A', 'Uno') !== claveDeUnPunto('r', 'A', 'Dos'))
  ok('un punto de «Revisa hoy» y un correo con el mismo texto no comparten clave', claveDeUnPunto('r', 'A', 'B') !== claveDeUnPunto('c', 'A', 'B'))
  const iguales = normalizarBriefing({ titular: 'T', revisar: [{ titulo: 'Mismo', area: 'A' }, { titulo: 'Mismo', area: 'A' }, { titulo: 'Mismo', area: 'A' }] })
  ok('dos puntos con el mismo área y título no se pisan: el segundo lleva «-2»; el tercero, «-3»', iguales.ok && iguales.briefing.revisar[1].clave === `${iguales.briefing.revisar[0].clave}-2` && iguales.briefing.revisar[2].clave === `${iguales.briefing.revisar[0].clave}-3`)
  ok('la huella es estable y de 8 cifras', huellaCorta('hola') === huellaCorta('hola') && huellaCorta('hola') !== huellaCorta('Hola') && /^[0-9a-f]{8}$/.test(huellaCorta('')))
}

console.log('\n=== para qué día es ===')
{
  const hoy = '2026-10-27'
  ok('«Martes 27 de octubre de 2026» es el 27 de octubre', diaEnElTexto('Martes 27 de octubre de 2026', hoy) === '2026-10-27')
  ok('sin año, el de hoy', diaEnElTexto('lunes 26 de octubre', hoy) === '2026-10-26')
  ok('con tildes y setiembre', diaEnElTexto('Miércoles 2 de SETIEMBRE de 2026', hoy) === '2026-09-02' && diaEnElTexto('1 de septiembre', hoy) === '2026-09-01')
  ok('un día que no existe, o ninguno, es null', diaEnElTexto('31 de febrero de 2026', hoy) === null && diaEnElTexto('sin fecha', hoy) === null && diaEnElTexto('27 de octubrembre', hoy) === null)
  ok('se escribe como se lee', etiquetaDelDia('2026-10-27') === 'Martes 27 de octubre de 2026' && etiquetaDelDia('2026-01-01') === 'Jueves 1 de enero de 2026')

  const a = resolverDia({ dia: '2026-10-26', fechaLabel: 'Martes 27 de octubre de 2026', hoy })
  ok('si la rutina dice el día, manda lo que dice', a.ok && a.dia === '2026-10-26' && a.origen === 'argumento')
  const b = resolverDia({ fechaLabel: 'Martes 27 de octubre de 2026', hoy })
  ok('si no, el de su etiqueta', b.ok && b.dia === '2026-10-27' && b.origen === 'fecha_label')
  const c = resolverDia({ fechaLabel: '', hoy })
  ok('y si tampoco, hoy', c.ok && c.dia === hoy && c.origen === 'hoy')
  ok('un día mal escrito no vale', !resolverDia({ dia: '27/10/2026', fechaLabel: '', hoy }).ok && !resolverDia({ dia: '2026-02-30', fechaLabel: '', hoy }).ok && !resolverDia({ dia: 20261027, fechaLabel: '', hoy }).ok)
  ok('hasta una semana atrás y un día por delante', resolverDia({ dia: '2026-10-20', fechaLabel: '', hoy }).ok && resolverDia({ dia: '2026-10-28', fechaLabel: '', hoy }).ok)
  const lejos = resolverDia({ dia: '2026-10-19', fechaLabel: '', hoy })
  ok('más atrás, o más adelante, es un error de fecha y se dice', !lejos.ok && /fuera de lo razonable/.test(lejos.error) && !resolverDia({ dia: '2026-10-29', fechaLabel: '', hoy }).ok)
  ok('la etiqueta de un día que no cuadra con hoy también se rechaza (publicar «en septiembre» por error)', !resolverDia({ fechaLabel: 'Lunes 14 de septiembre de 2026', hoy }).ok)
}

console.log('\n=== lo que se le contesta a la rutina ===')
{
  const b = bueno().briefing
  const t = resumenDelBriefing('2026-10-27', b)
  ok('una línea con el día, el titular y qué hay', t.startsWith('Briefing del 2026-10-27') && t.includes(b.titular) && t.includes('4 puntos en «Revisa hoy»') && t.includes('3 comerciales') && t.includes('2 correos'), t)
  const uno = normalizarBriefing({ titular: 'T', revisar: [{ titulo: 'x', area: 'A' }], correo: [{ titulo: 'y' }] })
  ok('en singular cuando es uno', uno.ok && /1 punto en «Revisa hoy»/.test(resumenDelBriefing('2026-10-27', uno.briefing)) && /1 correo\./.test(resumenDelBriefing('2026-10-27', uno.briefing)))
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
