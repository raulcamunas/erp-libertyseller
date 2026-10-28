import {
  CAMPOS_DEL_LEAD,
  COLUMNAS_A_LEER,
  avisosDelCorreo,
  avisosDelLead,
  claseDeLlamada,
  contextoParaIa,
  duracionLegible,
  enMinusculas,
  hace,
  msDesdeQueAcabo,
  nombreDeMarcaFiable,
  resumenDeCorreos,
  resumenDeLead,
  resumenDeConversaciones,
  resumenDeLlamadas,
  resumenDeNotas,
  situacionDeCorreos,
  textoParaIa,
  tipoDeLead,
  tramoDeCatalogo,
  type CorreoParaIa,
  type DatosDeLead,
} from '@/lib/correo/ia-contexto'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const AHORA = Date.parse('2026-10-23T12:00:00Z')
const dias = (n: number) => new Date(AHORA - n * 86_400_000).toISOString()

console.log('\n=== LO QUE NUNCA SALE HACIA LA IA ===')
{
  const lead: DatosDeLead = {
    id: 'l1',
    store_name: 'Acme Tienda',
    company: 'Acme Comercial SL',
    category: 'Hogar',
    // Todo lo de abajo NO está en la lista blanca y no puede aparecer en el contexto
    revenue_monthly: 98765,
    ventas_estimadas_usd: 123456,
    cif: 'B12345678',
    directors: 'GARCIA LOPEZ JUAN',
    decisor: 'GARCIA LOPEZ JUAN',
    cargo_decisor: 'Administrador único',
    business_address: 'Calle Mayor 1',
    mercantile_registry: 'Madrid T 123',
    phone: '+34600112233',
    telefonos_extra: '+34911223344',
    email: 'info@acme.es',
    emails_extra: 'ventas@acme.es',
    assigned_to: 'u-secreto',
    nivel: 1,
  }
  const t = contextoParaIa({ lead, notas: [], llamadas: [], correos: [], ahora: AHORA })
  for (const prohibido of ['98765', '98.765', '123456', '123.456', 'B12345678', 'GARCIA', 'Calle Mayor', 'Madrid T', '600112233', '911223344', 'info@acme.es', 'ventas@acme.es', 'u-secreto', 'Administrador único']) {
    ok(`no aparece «${prohibido}»`, !t.includes(prohibido))
  }
  ok('lo que SÍ es de la empresa aparece', t.includes('Acme Tienda') && t.includes('Acme Comercial SL') && t.includes('Hogar'))
  ok('la lista blanca no incluye ninguna columna de dinero ni de contacto', !CAMPOS_DEL_LEAD.some((c) => /revenue|ventas|cif|director|phone|email|decisor|address|registry/.test(c)))
  ok('las columnas que se piden son la lista blanca más los correos (solo para buscar sus conversaciones)', COLUMNAS_A_LEER.split(', ').every((c) => c === 'id' || c === 'email' || c === 'emails_extra' || (CAMPOS_DEL_LEAD as readonly string[]).includes(c)))
  ok('nunca se pide con un asterisco', !COLUMNAS_A_LEER.includes('*'))
}

console.log('\n=== resumenDeLead ===')
{
  const l = resumenDeLead(
    {
      store_name: 'KOSKA',
      company: 'KOSKA',
      tipo_lead: 'tienda_online',
      vende_en_amazon: 'no_vende',
      amazon_start: '2024-11-26',
      category: 'Mascotas',
      subcategory: 'Mascotas',
      ciudad: 'MÁLAGA',
      province: 'Europe',
      plataforma: 'Shopify',
      n_productos: 6,
      anos_tienda: 3.4,
      web: 'https://koska.es',
      tipo_empresa: 'autonomo',
      status: 'no_contesta',
      call_attempts: 4,
      last_contacted_at: dias(10),
      follow_up: 'Pide que le llamemos al 600 11 22 33 o a ana@koska.es',
    },
    AHORA
  ).join('\n')
  ok('no repite la razón social si es igual al nombre', !l.includes('Razón social'))
  ok('no repite la categoría si la subcategoría es la misma', (l.match(/Mascotas/g) ?? []).length === 1, l)
  ok('«Europe» no es una ubicación y las mayúsculas del registro se bajan', l.includes('Ubicación: Málaga') && !l.includes('Europe'), l)
  ok('«no vende» se dice claro', l.includes('hemos comprobado que todavía NO vende en Amazon'))
  ok('«Vende desde» es solo el año', l.includes('Vende en Amazon desde: 2024') && !l.includes('11-26'))
  ok('el catálogo va en palabras, sin la cifra', l.includes('pocos productos') && !/\b6\b/.test(l.split('Catálogo')[1]?.split('\n')[0] ?? ''), l)
  ok('la antigüedad va redondeada', l.includes('unos 3 años'))
  ok('un autónomo se dice', l.includes('autónomo'))
  ok('el estado se explica', l.includes('no contesta: se le ha llamado y no ha cogido'))
  ok('el último contacto va en relativo', l.includes('hace 10 días'))
  ok('la nota del comercial entra SIN teléfonos ni correos', l.includes('Pide que le llamemos') && !l.includes('600 11 22 33') && !l.includes('ana@koska.es') && l.includes('<teléfono>') && l.includes('<correo>'), l)

  const dudoso = resumenDeLead({ store_name: 'X', vende_en_amazon: 'sin_comprobar' }, AHORA).join('\n')
  ok('sin saber de qué lista es y sin comprobar, se dice «no consta» y que no se pregunte', dudoso.includes('no consta si vende en Amazon') && dudoso.includes('ni lo preguntes'))
  // Las tiendas de las listas «No Amazon» (tipo_lead = tienda_online) no venden en Amazon aunque nadie lo haya comprobado una por una
  const tienda = resumenDeLead({ store_name: 'X', tipo_lead: 'tienda_online', vende_en_amazon: 'sin_comprobar' }, AHORA).join('\n')
  ok('una tienda online sin comprobar se trata como una que TODAVÍA NO está en Amazon (no como «no consta»)', tienda.includes('NO venden en Amazon') && tienda.includes('todavía NO está allí') && !tienda.includes('no consta si vende'), tienda)
  ok('y se dice que no se había comprobado una por una, para que no lo afirme como un dato', tienda.includes('no se ha comprobado una por una'))
  const verificada = resumenDeLead({ store_name: 'X', tipo_lead: 'tienda_online', vende_en_amazon: 'vende' }, AHORA).join('\n')
  ok('una tienda online que SÍ se comprobó que vende, vende', verificada.includes('ya vende en Amazon') && !verificada.includes('NO venden en Amazon'))
  const seller = resumenDeLead({ store_name: 'X', tipo_lead: 'seller_amazon', vende_en_amazon: 'sin_comprobar' }, AHORA).join('\n')
  ok('un seller de Amazon ya vende aunque no esté «comprobado»', seller.includes('ya vende en Amazon'))
  ok('un lead sin datos solo trae lo que hay', resumenDeLead({}, AHORA).length >= 1 && !resumenDeLead({}, AHORA).join('').includes('null'))
}

console.log('\n=== tipoDeLead, tramoDeCatalogo, enMinusculas ===')
ok('un seller es para optimizar', tipoDeLead({ tipo_lead: 'seller_amazon', vende_en_amazon: 'vende' }) === 'optimizar')
ok('una tienda que vende también', tipoDeLead({ tipo_lead: 'tienda_online', vende_en_amazon: 'vende' }) === 'optimizar')
ok('una tienda que no vende es para entrar', tipoDeLead({ tipo_lead: 'tienda_online', vende_en_amazon: 'no_vende' }) === 'entrar')
ok('una tienda sin comprobar es para entrar', tipoDeLead({ tipo_lead: 'tienda_online', vende_en_amazon: 'sin_comprobar' }) === 'entrar')
ok('tramos del catálogo', tramoDeCatalogo(6).includes('menos de diez') && tramoDeCatalogo(38).includes('decenas') && tramoDeCatalogo(120).includes('centenar') && tramoDeCatalogo(900).includes('cientos') && tramoDeCatalogo(4000).includes('mil'))
ok('MÁLAGA -> Málaga', enMinusculas('MÁLAGA') === 'Málaga')
ok('SAN JUAN-DE LUZ -> San Juan-De Luz', enMinusculas('SAN JUAN-DE LUZ') === 'San Juan-De Luz')
ok('«Barcelona» se queda', enMinusculas('Barcelona') === 'Barcelona')

console.log('\n=== hace() y duracionLegible() ===')
ok('hoy', hace(dias(0), AHORA) === 'hoy')
ok('ayer', hace(dias(1), AHORA) === 'ayer')
ok('hace 5 días', hace(dias(5), AHORA) === 'hace 5 días')
ok('hace 3 semanas', hace(dias(21), AHORA) === 'hace 3 semanas')
ok('hace 4 meses', hace(dias(120), AHORA) === 'hace 4 meses')
ok('una fecha mala no rompe', hace('no es fecha', AHORA) === 'en una fecha desconocida')
ok('duración de 38 s', duracionLegible(38) === '38 s')
ok('duración de 3 min 12 s', duracionLegible(192) === '3 min 12 s')
ok('duración de 1 min 05 s', duracionLegible(65) === '1 min 05 s')

console.log('\n=== notas, llamadas y correos ===')
{
  const notas = Array.from({ length: 14 }, (_, i) => ({ kind: i % 2 ? 'llamada' : 'nota', body: `Apunte número ${i} ${'x'.repeat(400)}`, occurred_at: dias(i), es_respuesta: i === 0 }))
  const r = resumenDeNotas(notas, AHORA)
  ok('como mucho 10 apuntes, el más reciente primero', r.length === 10 && r[0].includes('hoy') && r[0].includes('Apunte número 0'))
  ok('cada apunte va recortado', r.every((x) => x.length < 340))
  ok('lo que escribió el cliente se marca', r[0].includes('lo escribió el cliente'))
  ok('un apunte vacío no entra', resumenDeNotas([{ kind: 'nota', body: '   ', occurred_at: dias(0) }], AHORA).length === 0)
  ok('el texto de una persona va sin correos ni teléfonos', textoParaIa('Escribe a x@y.es o llama al 600 11 22 33', 200) === 'Escribe a <correo> o llama al <teléfono>')
}
{
  const ll = [
    { fecha: dias(10), direccion: 'outbound', duracion_s: 120, estado: 'ANSWERED', tipo: 'conversacion' },
    { fecha: dias(3), direccion: 'outbound', duracion_s: 8, estado: 'ANSWERED' },
    { fecha: dias(2), direccion: 'outbound', duracion_s: 0, estado: 'MISSED' },
  ]
  const r = resumenDeLlamadas(ll, AHORA).join('\n')
  ok('cuenta las llamadas, y solo cuenta como conversación la CONFIRMADA por la transcripción', r.includes('3 llamadas registradas (3 nuestras): 1 con conversación; 2 sin conversación (buzón de voz, no cogieron o colgaron)'), r)
  ok('la última, sin conversación', r.includes('La última, hace 2 días: no la cogieron'))
  ok('la conversación más larga', r.includes('2 min 00 s'))
  ok('sin llamadas, nada', resumenDeLlamadas([], AHORA).length === 0)
}

console.log('\n=== una llamada «contestada» NO es una conversación hasta que la transcripción lo confirma ===')
{
  ok('transcrita como conversación', claseDeLlamada({ estado: 'ANSWERED', duracion_s: 90, tipo: 'conversacion' }) === 'conversacion')
  ok('transcrita como buzón de voz: Rinkel la da por contestada y NO es una conversación', claseDeLlamada({ estado: 'ANSWERED', duracion_s: 95, tipo: 'buzon_de_voz' }) === 'buzon')
  ok('transcrita sin contenido', claseDeLlamada({ estado: 'ANSWERED', duracion_s: 45, tipo: 'sin_contenido' }) === 'sin_contenido')
  ok('contestada y larga pero sin transcripción: SIN COMPROBAR (no se puede afirmar que se habló)', claseDeLlamada({ estado: 'ANSWERED', duracion_s: 95 }) === 'sin_comprobar' && claseDeLlamada({ estado: 'ANSWERED', duracion_s: 95, tipo: null }) === 'sin_comprobar')
  ok('contestada y de menos de 20 s: descolgaron y colgaron', claseDeLlamada({ estado: 'ANSWERED', duracion_s: 6 }) === 'colgaron')
  ok('perdida: no la cogieron', claseDeLlamada({ estado: 'MISSED', duracion_s: 40 }) === 'no_cogieron' && claseDeLlamada({ estado: 'NOANSWER', duracion_s: 0 }) === 'no_cogieron')
  ok('msDesdeQueAcabo cuenta desde el FINAL de la llamada', msDesdeQueAcabo({ fecha: new Date(AHORA - 5 * 60_000).toISOString(), duracion_s: 120 }, AHORA) === 3 * 60_000)
  ok('una fecha mala nunca «acaba de terminar»', msDesdeQueAcabo({ fecha: 'mañana', duracion_s: 10 }, AHORA) === Number.POSITIVE_INFINITY)

  const buzon = [{ fecha: dias(0), direccion: 'outbound', duracion_s: 95, estado: 'ANSWERED', tipo: 'buzon_de_voz', resumen: 'Contestador automático.' }]
  const rb = resumenDeLlamadas(buzon, AHORA).join('\n')
  ok('un buzón de voz de 95 s NO sale como «conversación de 1 min 35 s»', !/conversación de/.test(rb) && rb.includes('NADIE habló con nosotros') && rb.includes('0 con conversación') === false, rb)
  const sinComprobar = [{ fecha: new Date(AHORA - 4 * 60_000).toISOString(), direccion: 'outbound', duracion_s: 60, estado: 'ANSWERED' }]
  const rs = resumenDeLlamadas(sinComprobar, AHORA).join('\n')
  ok('una contestada sin transcripción dice que NO consta si hubo conversación, y que se está transcribiendo si acaba de acabar', rs.includes('NO consta si hubo conversación o saltó un buzón de voz') && rs.includes('la grabación aún se está transcribiendo'), rs)
  const vieja = [{ fecha: dias(40), direccion: 'outbound', duracion_s: 60, estado: 'ANSWERED' }]
  ok('una de hace semanas sin transcripción no dice que «se está transcribiendo»', !resumenDeLlamadas(vieja, AHORA).join('').includes('se está transcribiendo'))
}

console.log('\n=== el nombre de la empresa, solo si es un nombre ===')
{
  ok('un nombre normal se queda', nombreDeMarcaFiable({ store_name: 'Suministros Lavin' }) === 'Suministros Lavin' && nombreDeMarcaFiable({ store_name: 'Tienda Sol' }) === 'Tienda Sol' && nombreDeMarcaFiable({ store_name: 'Cristal Sèvres' }) === 'Cristal Sèvres')
  ok('una dirección web no es un nombre', nombreDeMarcaFiable({ store_name: 'www.candidtails.com' }) === null && nombreDeMarcaFiable({ store_name: 'https://tpb.ro/' }) === null && nombreDeMarcaFiable({ store_name: 'puntojardin.com' }) === null)
  ok('una descripción no es un nombre', nombreDeMarcaFiable({ store_name: 'Tienda para mascotas' }) === null && nombreDeMarcaFiable({ store_name: 'Tienda de Ropa Infantil' }) === null && nombreDeMarcaFiable({ store_name: 'Tienda online' }) === null)
  ok('tres letras o menos, tampoco', nombreDeMarcaFiable({ store_name: 'max' }) === null && nombreDeMarcaFiable({ store_name: 'TPB' }) === null)
  ok('sin nombre, null', nombreDeMarcaFiable({}) === null && nombreDeMarcaFiable({ store_name: '  ' }) === null)
  const malo = resumenDeLead({ store_name: 'Tienda para mascotas', company: 'MASCOTAS PET FOOD S.L.' }, AHORA).join('\n')
  ok('si no es un nombre, el contexto lo dice y no lo ofrece como nombre', malo.includes('no consta un nombre de marca fiable') && malo.includes('«Tienda para mascotas»') && !malo.includes('Nombre comercial: Tienda para mascotas') && malo.includes('Razón social: MASCOTAS PET FOOD S.L.'), malo)
  const bueno = resumenDeLead({ store_name: 'Suministros Lavin' }, AHORA).join('\n')
  ok('si lo es, sale tal cual', bueno.includes('Nombre comercial: Suministros Lavin') && !bueno.includes('no consta un nombre'))
}

console.log('\n=== los avisos de este correo: QUÉ PASÓ en las llamadas de las últimas horas ===')
{
  const hace_ = (min: number) => new Date(AHORA - min * 60_000).toISOString()
  const lead = { store_name: 'Acme', status: 'seguimiento' }
  const conv = [{ fecha: hace_(30), direccion: 'outbound', duracion_s: 140, estado: 'ANSWERED', tipo: 'conversacion', resumen: 'Habló con Javier: pide información por correo.', siguiente_paso: 'Enviar información' }]
  const a1 = avisosDelCorreo({ lead, llamadas: conv, notas: [], ahora: AHORA }).join('\n')
  ok('tras una conversación: es la CONTINUACIÓN, cumple el siguiente paso y no vende desde cero', /CONVERSACIÓN/.test(a1) && /CONTINUACIÓN/.test(a1) && /este correo ES esa información/.test(a1) && /sin una presentación larga/.test(a1), a1)
  ok('tras una conversación: saluda con el nombre de pila de quien habló', /saluda con ese nombre/.test(a1))

  const buzon = [{ fecha: hace_(20), direccion: 'outbound', duracion_s: 60, estado: 'ANSWERED', tipo: 'buzon_de_voz', resumen: 'Contestador.' }]
  const a2 = avisosDelCorreo({ lead, llamadas: buzon, notas: [], ahora: AHORA }).join('\n')
  ok('tras un buzón de voz: PROHÍBE decir que se habló y permite decir que se llamó', /NO hubo ninguna conversación/.test(a2) && /NO escribas «hemos hablado»/.test(a2) && /has intentado llamar/.test(a2), a2)
  ok('y no habla de continuar ninguna conversación', !/CONTINUACIÓN/.test(a2))

  const pendiente = [{ fecha: hace_(4), direccion: 'outbound', duracion_s: 120, estado: 'ANSWERED' }]
  const a3 = avisosDelCorreo({ lead, llamadas: pendiente, notas: [], ahora: AHORA }).join('\n')
  ok('una contestada que aún no está transcrita: NO consta que se hablara, y no se afirma', /NO consta que hubiera una conversación/.test(a3) && /NO escribas «hemos hablado»/.test(a3) && /transcribiéndose/.test(a3), a3)

  const noCogio = [{ fecha: hace_(10), direccion: 'outbound', duracion_s: 0, estado: 'MISSED' }]
  ok('si no cogieron: nadie habló', /nadie habló con nosotros/.test(avisosDelCorreo({ lead, llamadas: noCogio, notas: [], ahora: AHORA }).join('')))

  const nota = [{ kind: 'llamada', body: 'Habló con la encargada, quiere ver una propuesta el lunes.', occurred_at: hace_(3), es_respuesta: false }]
  const a4 = avisosDelCorreo({ lead, llamadas: pendiente, notas: nota, ahora: AHORA }).join('\n')
  ok('si el comercial ya apuntó una nota de la llamada, NO se prohíbe hablar de ella (la IA se apoya en la nota)', !/NO consta que hubiera una conversación/.test(a4) && !/NO escribas «hemos hablado»/.test(a4), a4)
  ok('una nota vacía o muy corta no cuenta como nota', /NO consta que hubiera una conversación/.test(avisosDelCorreo({ lead, llamadas: pendiente, notas: [{ kind: 'llamada', body: 'ok', occurred_at: hace_(3) }], ahora: AHORA }).join('')))
  ok('una nota escrita por el cliente tampoco cuenta como apunte del comercial', /NO consta que hubiera una conversación/.test(avisosDelCorreo({ lead, llamadas: pendiente, notas: [{ kind: 'nota', body: 'Respuesta larga del cliente por correo', occurred_at: hace_(3), es_respuesta: true }], ahora: AHORA }).join('')))

  const antigua = [{ fecha: dias(5), direccion: 'outbound', duracion_s: 200, estado: 'ANSWERED', tipo: 'conversacion', resumen: 'Pidió que le escribiéramos.' }]
  const a5 = avisosDelCorreo({ lead, llamadas: antigua, notas: [], ahora: AHORA }).join('\n')
  ok('una conversación de hace días no es «de las últimas horas», pero se recuerda que se cuente CON SU FECHA', !/en las últimas horas/.test(a5) && /di cuándo fue/.test(a5) && /no digas «hoy»/.test(a5), a5)
  ok('sin llamadas no hay avisos de llamadas', avisosDelCorreo({ lead, llamadas: [], notas: [], ahora: AHORA }).length === 0)
  ok('los avisos del lead (no le interesa) se conservan', /dos o tres líneas/.test(avisosDelCorreo({ lead: { status: 'no_interesa' }, llamadas: [], notas: [], ahora: AHORA }).join('')))
  ok('una llamada de hace más de 36 h sin conversación no genera aviso de «nadie habló»', avisosDelCorreo({ lead, llamadas: [{ fecha: dias(3), direccion: 'outbound', duracion_s: 0, estado: 'MISSED' }], notas: [], ahora: AHORA }).length === 0)

  const t = contextoParaIa({ lead: { store_name: 'Acme' }, notas: [], llamadas: buzon, correos: [], ahora: AHORA })
  ok('en el contexto, los avisos van en su bloque y el buzón no sale como conversación', t.includes('AVISOS PARA ESTE CORREO') && t.includes('NO hubo ninguna conversación') && !/conversación de \d/.test(t) && !t.includes('LO QUE SE HABLÓ EN LAS LLAMADAS'), t)
}

{
  const ll = [
    { fecha: dias(20), direccion: 'outbound', duracion_s: 300, estado: 'ANSWERED', tipo: 'conversacion', resumen: 'Le contamos cómo trabajamos. Dijo que ya vendían en su web y que Amazon les daba miedo por la logística.', siguiente_paso: 'Mandarle un correo con cómo se gestiona el stock', interes: 'medio' },
    { fecha: dias(6), direccion: 'inbound', duracion_s: 150, estado: 'ANSWERED', tipo: 'conversacion', resumen: 'Nos llamó para preguntar por el plazo. Su socio escribe a ana@x.es o al 600 11 22 33.', siguiente_paso: null, interes: 'alto' },
    { fecha: dias(2), direccion: 'outbound', duracion_s: 12, estado: 'ANSWERED', tipo: 'buzon_de_voz', resumen: 'Dejó un mensaje en el contestador.', siguiente_paso: null, interes: null },
    { fecha: dias(1), direccion: 'outbound', duracion_s: 0, estado: 'NOANSWER', tipo: null, resumen: null, siguiente_paso: null, interes: null },
  ]
  const r = resumenDeConversaciones(ll, AHORA)
  ok('solo salen las llamadas con conversación y resumen (ni el contestador ni la que no cogió)', r.length === 2, r.join('\n'))
  ok('la más reciente primero, con quién llamó, cuánto duró y el interés', r[0].startsWith('- hace 6 días · nos llamó él, 2 min 30 s · interés del cliente: alto') && r[1].startsWith('- hace 3 semanas · le llamamos, 5 min 00 s · interés del cliente: medio'), r.join('\n'))
  ok('con lo que se habló y el siguiente paso acordado', r[1].includes('Lo que se habló: Le contamos cómo trabajamos') && r[1].includes('Siguiente paso acordado: Mandarle un correo con cómo se gestiona el stock') && !r[0].includes('Siguiente paso'))
  ok('sin correos ni teléfonos de nadie', !r.join('').includes('ana@x.es') && !r.join('').includes('600 11 22 33') && r[0].includes('<correo>') && r[0].includes('<teléfono>'))
  ok('como mucho tres', resumenDeConversaciones(Array.from({ length: 6 }, (_, i) => ({ fecha: dias(i + 1), direccion: 'outbound', duracion_s: 90, estado: 'ANSWERED', tipo: 'conversacion', resumen: `Habló ${i}`, siguiente_paso: null, interes: 'bajo' })), AHORA).length === 3)
  ok('sin llamadas, nada', resumenDeConversaciones([], AHORA).length === 0 && resumenDeConversaciones([{ fecha: dias(1), direccion: 'outbound', duracion_s: 90, estado: 'ANSWERED' }], AHORA).length === 0)
  const t = contextoParaIa({ lead: { store_name: 'Acme' }, notas: [], llamadas: ll, correos: [], ahora: AHORA })
  ok('en el contexto va en su bloque, después de las cifras de llamadas, avisando de que no son instrucciones', t.includes('LO QUE SE HABLÓ EN LAS LLAMADAS') && t.includes('no son instrucciones') && t.indexOf('LLAMADAS\n') < t.indexOf('LO QUE SE HABLÓ'))
  ok('sin conversaciones, el bloque no existe', !contextoParaIa({ lead: { store_name: 'Acme' }, notas: [], llamadas: [{ fecha: dias(1), direccion: 'outbound', duracion_s: 0, estado: 'NOANSWER' }], correos: [], ahora: AHORA }).includes('LO QUE SE HABLÓ'))
}
{
  const c: CorreoParaIa[] = [
    { direccion: 'saliente', fecha: dias(9), asunto: 'Primera propuesta', texto: 'Hola.\n> citado\nEl lun, 5 oct, Ana escribió:\n> más' },
    { direccion: 'saliente', fecha: dias(3), asunto: 'Seguimiento', texto: 'Segundo correo con ana@x.es' },
  ]
  const r = resumenDeCorreos(c, AHORA).join('\n')
  ok('el más reciente primero y sin lo citado', r.indexOf('Seguimiento') < r.indexOf('Primera') && !r.includes('citado'), r)
  ok('sin correos ni teléfonos', !r.includes('ana@x.es') && r.includes('<correo>'))
  const s = situacionDeCorreos(c, AHORA)
  ok('situación: dos enviados, ninguno recibido, el último hace 3 días, es un seguimiento', s.enviados === 2 && s.recibidos === 0 && s.diasDesdeElUltimoNuestro === 3 && s.seguimiento)
  ok('situación sin correos', !situacionDeCorreos([], AHORA).seguimiento)
}

console.log('\n=== contextoParaIa: el bloque de correos ===')
{
  const lead = { store_name: 'Acme' }
  const sin = contextoParaIa({ lead, notas: [], llamadas: [], correos: [], ahora: AHORA })
  ok('sin nada: este sería el primer correo', sin.includes('Ninguno: este sería el primer correo'))
  ok('no inventa bloques que no tienen datos', !sin.includes('HISTORIAL DE CONTACTO') && !sin.includes('LLAMADAS'))

  const apuntado = contextoParaIa({ lead, notas: [{ kind: 'email', body: 'Correo enviado: «Hola»', occurred_at: dias(2) }], llamadas: [], correos: [], ahora: AHORA })
  ok('un correo apuntado en el historial (aunque no esté en el buzón) hace de esto un seguimiento', apuntado.includes('SEGUIMIENTO') && !apuntado.includes('Ninguno: este sería el primer correo'), apuntado)

  const sinRespuesta = contextoParaIa({ lead, notas: [], llamadas: [], correos: [{ direccion: 'saliente', fecha: dias(4), asunto: 'Hola', texto: 'Texto' }], ahora: AHORA })
  ok('un correo nuestro sin respuesta: se dice que NO ha contestado', sinRespuesta.includes('NO ha contestado') && sinRespuesta.includes('hace 4 días'))

  const conRespuesta = contextoParaIa({ lead, notas: [], llamadas: [], correos: [{ direccion: 'saliente', fecha: dias(4), asunto: 'Hola', texto: 'Texto' }, { direccion: 'entrante', fecha: dias(3), asunto: 'Re: Hola', texto: 'Vale' }], ahora: AHORA })
  ok('si ha contestado, se dice', conRespuesta.includes('nos ha contestado una vez') && !conRespuesta.includes('NO ha contestado'))
}

console.log('\n=== avisosDelLead ===')
{
  ok('un lead normal no lleva avisos', avisosDelLead({ status: 'seguimiento' }).length === 0 && avisosDelLead({}).length === 0)
  ok('«No le interesa»: dos o tres líneas, sin vender', /dos o tres líneas/.test(avisosDelLead({ status: 'no_interesa' }).join('')))
  ok('cita agendada: confirmarla, no vender desde cero', /confirmarla o prepararla/.test(avisosDelLead({ status: 'cita_cualificada' }).join('')))

  // Una tienda de las listas «No Amazon»: la IA escribía como si ya estuviera en Amazon («cómo aparece vuestra marca en la plataforma»)
  const tiendaOnline = avisosDelLead({ tipo_lead: 'tienda_online', vende_en_amazon: 'sin_comprobar', status: 'pendiente' }).join('\n')
  ok('una tienda online sin comprobar lleva el aviso de que NO vende en Amazon todavía', /NO vende en Amazon todavía/.test(tiendaOnline) && /ENTRAR/.test(tiendaOnline), tiendaOnline)
  ok('el aviso prohíbe escribir como si ya estuviera: marca, catálogo, fichas, visibilidad, presencia, en el asunto y el cuerpo', /NUNCA escribas como si ya estuviera/.test(tiendaOnline) && /vuestra marca o vuestro catálogo en Amazon/.test(tiendaOnline) && /fichas/.test(tiendaOnline) && /visibilidad/.test(tiendaOnline) && /presencia/.test(tiendaOnline) && /ni en el asunto ni en el cuerpo/.test(tiendaOnline))
  ok('sin comprobar, pide no afirmarlo como un dato (puede que ya venda)', /No lo afirmes como un dato/.test(tiendaOnline) && !/Lo hemos comprobado/.test(tiendaOnline))
  const noVende = avisosDelLead({ tipo_lead: 'tienda_online', vende_en_amazon: 'no_vende' }).join('\n')
  ok('si SÍ se ha comprobado que no vende, el aviso deja decirlo', /Lo hemos comprobado: puedes decir que todavía no venden/.test(noVende) && !/No lo afirmes como un dato/.test(noVende))
  ok('una tienda online de la que se comprobó que SÍ vende no lleva ese aviso', avisosDelLead({ tipo_lead: 'tienda_online', vende_en_amazon: 'vende' }).length === 0)
  ok('un seller de Amazon no lleva ese aviso (ya vende)', avisosDelLead({ tipo_lead: 'seller_amazon', vende_en_amazon: 'sin_comprobar' }).length === 0)
  ok('un lead sin el dato del tipo no lleva aviso (no se inventa)', avisosDelLead({ vende_en_amazon: 'sin_comprobar' }).length === 0)
  ok('el aviso de la tienda va junto a los demás sin pisarlos (también «No le interesa»)', avisosDelLead({ tipo_lead: 'tienda_online', status: 'no_interesa' }).length === 2)
  const t = contextoParaIa({ lead: { store_name: 'Acme', status: 'no_interesa' }, notas: [], llamadas: [], correos: [], ahora: AHORA })
  ok('los avisos van en su propio bloque, justo tras los datos', t.indexOf('AVISOS PARA ESTE CORREO') > t.indexOf('DATOS DE LA EMPRESA') && t.indexOf('AVISOS PARA ESTE CORREO') < t.indexOf('CORREOS ANTERIORES'))
  ok('sin avisos no hay bloque', !contextoParaIa({ lead: { store_name: 'Acme', status: 'seguimiento' }, notas: [], llamadas: [], correos: [], ahora: AHORA }).includes('AVISOS PARA ESTE CORREO'))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
