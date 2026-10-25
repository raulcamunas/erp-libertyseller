import {
  CAMPOS_DEL_LEAD,
  COLUMNAS_A_LEER,
  avisosDelLead,
  contextoParaIa,
  duracionLegible,
  enMinusculas,
  hace,
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

  const dudoso = resumenDeLead({ store_name: 'X', tipo_lead: 'tienda_online', vende_en_amazon: 'sin_comprobar' }, AHORA).join('\n')
  ok('si no se ha comprobado, se dice «no consta» y que no se pregunte', dudoso.includes('no consta si vende en Amazon') && dudoso.includes('ni lo preguntes'))
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
    { fecha: dias(10), direccion: 'outbound', duracion_s: 120, estado: 'ANSWERED' },
    { fecha: dias(3), direccion: 'outbound', duracion_s: 8, estado: 'ANSWERED' },
    { fecha: dias(2), direccion: 'outbound', duracion_s: 0, estado: 'MISSED' },
  ]
  const r = resumenDeLlamadas(ll, AHORA).join('\n')
  ok('cuenta las llamadas y las conversaciones (más de 20 s)', r.includes('3 llamadas registradas (3 nuestras), 1 con conversación'), r)
  ok('la última, sin conversación', r.includes('La última, hace 2 días: no se llegó a hablar'))
  ok('la conversación más larga', r.includes('2 min 00 s'))
  ok('sin llamadas, nada', resumenDeLlamadas([], AHORA).length === 0)
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
  ok('cita cualificada: confirmarla, no vender desde cero', /confirmarla o prepararla/.test(avisosDelLead({ status: 'cita_cualificada' }).join('')))
  const t = contextoParaIa({ lead: { store_name: 'Acme', status: 'no_interesa' }, notas: [], llamadas: [], correos: [], ahora: AHORA })
  ok('los avisos van en su propio bloque, justo tras los datos', t.indexOf('AVISOS PARA ESTE CORREO') > t.indexOf('DATOS DE LA EMPRESA') && t.indexOf('AVISOS PARA ESTE CORREO') < t.indexOf('CORREOS ANTERIORES'))
  ok('sin avisos no hay bloque', !contextoParaIa({ lead: { store_name: 'Acme', status: 'seguimiento' }, notas: [], llamadas: [], correos: [], ahora: AHORA }).includes('AVISOS PARA ESTE CORREO'))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
