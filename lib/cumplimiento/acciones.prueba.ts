import { ACCIONES, accionDe, agruparEnTareas, ayudaDe, clasificar, mapaDeTareas, plazoDe, tareasConRecuentos, type CodigoAgrupable } from '@/lib/cumplimiento/acciones'
import { normalizarIncidencias } from '@/lib/cumplimiento/incidencias'

/**
 * Pruebas de lib/cumplimiento/acciones.ts: de cada incidencia a «qué hay que hacer», y la agrupación de la pestaña «Hoy».
 * Se ejecuta con `npx tsx lib/cumplimiento/acciones.prueba.ts`. Los mensajes son REALES (14 nov 2026), recortados.
 */

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const AHORA = new Date('2026-11-14T10:00:00Z')
const una = (x: unknown) => ({ ...normalizarIncidencias([x])[0], desde: '2026-10-01T00:00:00.000Z' })

console.log('\n=== cada incidencia, a su acción ===')
{
  const marca = una({ code: '18299', severity: 'ERROR', message: 'Necesitas autorización para publicar productos de esta marca.', categories: ['QUALIFICATION_REQUIRED', 'LISTING'], enforcements: { actions: [{ action: 'LISTING_SUPPRESSED' }], exemption: { status: 'NOT_EXEMPT' } } })
  const c = clasificar(marca, AHORA)
  ok('aprobación de marca: bloquea y «pedir la aprobación»', c.nivel === 'bloquea' && c.accion === 'aprobacion-marca', JSON.stringify(c))

  const rap = una({ code: '100530', severity: 'WARNING', message: 'Para vender este producto en las tiendas de Amazon, debes obtener la información de una RER para cumplir la normativa de responsabilidad ampliada del productor (RAP). Si no se facilitas esta información antes del 2026-08-12T00:00:00.000Z, podría retirarse esta oferta.', categories: ['LISTING'] })
  ok('RAP con plazo: normativa y «registrar la RAP»', JSON.stringify(clasificar(rap, AHORA)) === JSON.stringify({ nivel: 'normativa', accion: 'rap' }))

  const rapBloquea = una({ code: '100632', severity: 'ERROR', message: 'Para vender este producto en las tiendas de Amazon, debes obtener la información de una RER para cumplir la normativa de responsabilidad ampliada del productor (RAP).', categories: ['QUALIFICATION_REQUIRED', 'LISTING'], enforcements: { actions: [{ action: 'LISTING_SUPPRESSED' }] } })
  ok('RAP que ya oculta: bloquea, misma acción', JSON.stringify(clasificar(rapBloquea, AHORA)) === JSON.stringify({ nivel: 'bloquea', accion: 'rap' }))

  const pausa = una({ code: '18940', severity: 'ERROR', message: 'Tu oferta está en pausa porque cancelaste varios pedidos de clientes.', categories: ['LISTING'], enforcements: { actions: [{ action: 'LISTING_SUPPRESSED' }] } })
  ok('oferta en pausa', clasificar(pausa, AHORA).accion === 'oferta-en-pausa')

  const recom = una({ code: '18448', severity: 'WARNING', message: 'A tu envío le faltan algunos atributos clave: occasion_type. La falta de estos atributos no impide que tu producto aparezca en Amazon.', attributeNames: ['occasion_type'], categories: ['MISSING_ATTRIBUTE'] })
  ok('18448: menor, en «recomendaciones»', JSON.stringify(clasificar(recom, AHORA)) === JSON.stringify({ nivel: 'menor', accion: 'menor-recomendacion' }))

  const rechazado = una({ code: '90244', severity: 'ERROR', message: 'No podemos aceptar desconhecido_modificador que has introducido para Duración.', attributeNames: ['duration'], categories: ['INVALID_ATTRIBUTE'] })
  ok('valor rechazado: menor, en «cambios rechazados»', clasificar(rechazado, AHORA).accion === 'menor-envio-rechazado')

  ok('código desconocido que oculta y es de imágenes: imagen principal', accionDe({ codigo: 'nuevo', tema: 'imagenes' }, 'bloquea') === 'imagen-principal')
  ok('código desconocido de imágenes que no oculta: imágenes que no se ven', accionDe({ codigo: 'nuevo', tema: 'imagenes' }, 'afecta') === 'imagenes-no-se-ven')
  ok('código desconocido de normativa sin ocultar: otra obligación legal', accionDe({ codigo: 'nuevo', tema: 'normativa' }, 'normativa') === 'normativa-otros')
  ok('código desconocido que oculta sin tema conocido: listing oculto', accionDe({ codigo: 'nuevo', tema: 'otros' }, 'bloquea') === 'oculto-otros')
  ok('un menor va a los menores aunque su código tenga acción', accionDe({ codigo: '18299', tema: 'aprobacion' }, 'menor') === 'menor-recomendacion')
  ok('todas las acciones tienen título, porqué y pasos', Object.values(ACCIONES).every((a) => a.titulo && a.porque && a.pasos.length > 0))
}

console.log('\n=== lo que se saca del mensaje ===')
ok('el plazo de la RAP', plazoDe('Si no se facilitas esta información antes del 2026-08-12T00:00:00.000Z, podría retirarse') === '2026-08-12')
ok('«como máximo el»', plazoDe('De no presentar estos documentos como máximo el 2026-05-30T19:56:22.342Z, es posible') === '2026-05-30')
ok('sin fecha (el 100914 llega con «antes del ,»)', plazoDe('Si no facilitas esta información antes del , podría retirarse') === null)
ok('la ayuda de Seller Central', ayudaDe('Más información en https://sellercentral.amazon.de/help/hub/reference/GYDCAK9ZR6VJH2x3') === 'https://sellercentral.amazon.de/help/hub/reference/GYDCAK9ZR6VJH2x3')
ok('el formulario de aprobación de marca', ayudaDe('Completa el formulario en https://sellercentral.amazon.com/hz/approvalrequest?restrictionScope=CONTRIBUTION&brandName=MUNICH para continuar.')?.startsWith('https://sellercentral.amazon.com/hz/approvalrequest') === true)
ok('un enlace de fuera de Amazon NO', ayudaDe('Mira https://sellercentral.amazon.es.malo.com/help/x') === null && ayudaDe('No podemos acceder a http://clacclac.cc/uploads/-1') === null)
ok('un enlace de Amazon que no es de ayuda NO', ayudaDe('Ve a https://sellercentral.amazon.fr/manage-your-brands?brandName=ATOM para conectar tu marca') === null)
ok('un enlace partido al final de un mensaje recortado NO', ayudaDe('x'.repeat(580) + ' https://sellercentral.amazon.es/help/hub/refer') === null)

console.log('\n=== la pestaña «Hoy»: agrupar por lo que hay que hacer ===')
{
  const k = (o: Partial<CodigoAgrupable> & { codigo: string }): CodigoAgrupable => ({ gravedad: 'error', tema: 'otros', mensaje: '', listings: 0, conStock: 0, ocultan: 0, ocultanConStock: null, desde: null, ...o })
  const codigos = [
    k({ codigo: '18299', tema: 'aprobacion', mensaje: 'Necesitas autorización para publicar productos de esta marca.', listings: 100, conStock: 10, ocultan: 100, ocultanConStock: 10, desde: '2026-09-01T00:00:00Z' }),
    k({ codigo: '18304', tema: 'aprobacion', mensaje: 'Necesitas autorización para publicar productos de esta marca.', listings: 20, conStock: 5, ocultan: 20, ocultanConStock: 5, desde: '2026-08-01T00:00:00Z' }),
    k({ codigo: '100530', gravedad: 'aviso', tema: 'normativa', mensaje: 'Si no facilitas esta información antes del 2026-08-12T00:00:00.000Z, podría retirarse', listings: 500, conStock: 50 }),
    k({ codigo: '100529', gravedad: 'aviso', tema: 'normativa', mensaje: 'antes del 2026-01-17T19:34:19.286Z', listings: 30, conStock: 3 }),
    k({ codigo: '18448', gravedad: 'aviso', tema: 'datos', mensaje: 'A tu envío le faltan algunos atributos clave. La falta de estos atributos no impide que tu producto aparezca en Amazon.', listings: 900, conStock: 300 }),
    // Un código que oculta a unos y a otros no (90225 el 14 nov: 11 de 21)
    k({ codigo: '90225', tema: 'datos', mensaje: 'El valor de «Nombre del producto» es más largo que el máximo permitido.', listings: 21, conStock: 2, ocultan: 11, ocultanConStock: 1 }),
  ]
  const t = agruparEnTareas(codigos, AHORA)
  const de = (nivel: string, accion: string) => t.find((x) => x.nivel === nivel && x.accion === accion)
  ok('los dos códigos de la marca son UNA tarea', de('bloquea', 'aprobacion-marca')?.codigos.join() === '18299,18304')
  ok('…con sus cifras sumadas', de('bloquea', 'aprobacion-marca')?.listings === 120 && de('bloquea', 'aprobacion-marca')?.conStock === 15)
  ok('…y el «desde» más antiguo', de('bloquea', 'aprobacion-marca')?.desde === '2026-08-01T00:00:00Z')
  ok('la RAP junta sus dos códigos y se queda el plazo más cercano', de('normativa', 'rap')?.listings === 530 && de('normativa', 'rap')?.plazo === '2026-01-17')
  ok('el código que oculta a medias se parte: 11 bloquean', de('bloquea', 'dato-ficha')?.listings === 11 && de('bloquea', 'dato-ficha')?.conStock === 1)
  ok('…y los otros 10 van por lo que son sin ocultar', de('afecta', 'dato-ficha')?.listings === 10 && de('afecta', 'dato-ficha')?.conStock === 1)
  ok('18448 va a los menores', de('menor', 'menor-recomendacion')?.listings === 900)
  ok('orden: primero lo que bloquea, los menores al final', t[0].nivel === 'bloquea' && t[t.length - 1].nivel === 'menor')
  ok('dentro de «bloquea», lo que tiene más stock primero', t[0].accion === 'aprobacion-marca')
  ok('sin la 306 no se sabe cuántos ocultos tienen stock: se toma el menor de los dos', agruparEnTareas([k({ codigo: '18299', tema: 'aprobacion', listings: 10, conStock: 4, ocultan: 6 })], AHORA)[0].conStock === 4)
  ok('sin nada, nada', agruparEnTareas([], AHORA).length === 0)

  const mapa = mapaDeTareas(codigos, AHORA)
  ok('el mapa para la 306: «b» si oculta, «n» si no', mapa['18299'].b === 'bloquea|aprobacion-marca' && mapa['100530'].n === 'normativa|rap' && mapa['18448'].n === 'menor|menor-recomendacion')
  const exactas = tareasConRecuentos(
    codigos,
    [
      { tarea: 'bloquea|aprobacion-marca', listings: 110, conStock: 14 },
      { tarea: 'normativa|rap', listings: 505, conStock: 51 },
      { tarea: '?|raro', listings: 2, conStock: 0 },
      { tarea: 'menor|menor-recomendacion', listings: 0, conStock: 0 },
    ],
    AHORA
  )
  const ex = (nivel: string, accion: string) => exactas.find((x) => x.nivel === nivel && x.accion === accion)
  ok('con la 306 manda la cifra exacta (listings distintos)', ex('bloquea', 'aprobacion-marca')?.listings === 110 && ex('normativa', 'rap')?.conStock === 51)
  ok('…y conserva el mensaje, los códigos y el plazo', ex('normativa', 'rap')?.plazo === '2026-01-17' && ex('bloquea', 'aprobacion-marca')?.codigos.length === 2)
  ok('una clave rara no se pierde', ex('afecta', 'dato-ficha')?.listings === 2)
  ok('una tarea a cero no sale', !ex('menor', 'menor-recomendacion'))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
