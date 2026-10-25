import { REGLAS_FIJAS } from '@/lib/correo/ia-prompt'
import { cuerpoDelApunteDeWhatsapp, SITUACIONES_DE_WHATSAPP, ETIQUETA_DE_SITUACION } from '@/lib/whatsapp/mensajes'
import {
  COMO_ES_UN_WHATSAPP,
  DESCRIPCION_DEL_MOMENTO,
  CIERRES_DE_MENSAJE,
  ENFOQUES_DE_APERTURA,
  ESQUEMA_DE_WHATSAPP,
  EJEMPLOS_DE_TONO,
  construirEncargoDeWhatsapp,
  construirSistemaDeWhatsapp,
  contextoParaWhatsapp,
  elegirCierre,
  elegirEnfoque,
  enfoqueDelMensaje,
  leerMensajeDeWhatsapp,
  mensajeDeCorreccionDeWhatsapp,
  resumenDeCanales,
  whatsappsAnteriores,
} from '@/lib/whatsapp/ia-prompt'
import { revisarMensajeDeWhatsapp } from '@/lib/whatsapp/ia-revision'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const AHORA = Date.UTC(2026, 9, 25, 10, 0)
const DIA = 86_400_000
const hace = (dias: number) => new Date(AHORA - dias * DIA).toISOString()

const LEAD = {
  store_name: 'www.casaluz.es',
  company: 'CASA LUZ DECORACION SL',
  category: 'Hogar',
  subcategory: 'Decoración',
  ciudad: 'Valencia',
  vende_en_amazon: 'no_vende',
  plataforma: 'Shopify',
  n_productos: 24,
  status: 'no_contesta',
  call_attempts: 2,
  // Lo que NUNCA debe llegar a la IA
  revenue_monthly: 987654,
  ventas_estimadas_usd: 123456,
  email: 'secreto@casaluz.es',
  telefono: '612345678',
}

console.log('\n=== el sistema ===')
{
  const s = construirSistemaDeWhatsapp()
  ok('lleva las reglas que nunca cambian (nada de dinero, no inventar…)', s.includes(REGLAS_FIJAS) && s.includes('NUNCA menciones facturación'))
  ok('dice que es un WhatsApp, corto y sin firma ni enlaces', s.includes('WhatsApp') && s.includes('entre 25 y 60 palabras') && s.includes('sin enlaces') && s.includes('no firmes al final'))
  ok('lleva lo que hace Liberty Seller (la misma fuente que el correo)', s.includes('QUÉ HACE LIBERTY SELLER'))
  ok('lleva ejemplos de tono de empresas inventadas, uno por momento', EJEMPLOS_DE_TONO.includes('[Primer contacto]') && EJEMPLOS_DE_TONO.includes('[Te he llamado y no contesta]') && EJEMPLOS_DE_TONO.includes('[Después de hablar]'))
  ok('y los ejemplos cumplen las reglas que se le piden a la IA (cortos, sin dinero, sin enlaces)', EJEMPLOS_DE_TONO.split('\n').filter((l) => l.startsWith('[')).every((l) => revisarMensajeDeWhatsapp(l.replace(/^\[[^\]]+\]\s*/, '')).length === 0))
  ok('no habla de asunto ni de correo como formato de salida', !/asunto/i.test(COMO_ES_UN_WHATSAPP))
  ok('no ofrece contárselo «por WhatsApp» cuando el mensaje ya va por WhatsApp', s.includes('di «por aquí» (nunca «por WhatsApp»)'))
  ok('prioriza lo que pida el comercial', s.includes('Si el comercial da indicaciones, son lo primero'))
  ok('les habla a ellos en segunda persona del plural y no repite siempre el mismo beneficio', s.includes('«vuestra cerámica»') && s.includes('«sin cargar a vuestro equipo» es solo uno de ellos'))
  ok('no pregunta ni da por hecho si venden en Amazon cuando no consta', s.includes('nunca escribas «si ya vendéis o si todavía no»'))
  ok('un seguimiento por WhatsApp se reconoce en media frase, y la llamada se sitúa como consta', s.includes('reconócelo en media frase') && s.includes('Di CUÁNDO fue una llamada solo como consta') && DESCRIPCION_DEL_MOMENTO.no_contesta.includes('«hace un momento» solo si la llamada es de hoy'))
  ok('el mismo para todos los momentos', construirSistemaDeWhatsapp() === s)
}

console.log('\n=== lo que la IA sabe del lead ===')
{
  const notas = [
    { kind: 'llamada', body: 'Llamo, no contesta. Probar por la tarde. Su móvil 612345678 y su correo secreto@casaluz.es', occurred_at: hace(1) },
    { kind: 'whatsapp', body: cuerpoDelApunteDeWhatsapp({ numero: '34612345678', texto: 'Hola, soy Raúl de Liberty Seller. Ayudamos a tiendas como Casa Luz a vender en Amazon.' }), occurred_at: hace(3) },
    { kind: 'email', body: 'Correo enviado: Casa Luz en Amazon', occurred_at: hace(5) },
  ]
  const c = contextoParaWhatsapp({ lead: LEAD, notas, llamadas: [], ahora: AHORA })
  ok('lleva los datos de la empresa de la lista blanca', c.includes('www.casaluz.es') && c.includes('CASA LUZ DECORACION SL') && c.includes('Valencia') && c.includes('Hogar / Decoración'), c.slice(0, 300))
  ok('NO lleva facturación ni ventas estimadas', !c.includes('987654') && !c.includes('123456') && !/facturaci|revenue|ventas estimadas/i.test(c))
  ok('NO lleva teléfonos ni correos, ni los de la ficha ni los escritos en una nota', !c.includes('612345678') && !c.includes('secreto@casaluz.es'), c)
  ok('dice qué se le ha escrito ya: un WhatsApp (seguimiento) y un correo', c.includes('LO QUE YA SE LE HA ESCRITO') && c.includes('ya se le ha escrito una vez por aquí') && c.includes('SEGUIMIENTO por WhatsApp') && c.includes('Correo: se le ha escrito una vez'))
  ok('enseña el historial con el WhatsApp como WhatsApp', c.includes('HISTORIAL DE CONTACTO') && /· WhatsApp:/.test(c))
  ok('no habla del primer «correo» como en el cuadro de correo', !c.includes('este sería el primer correo'))

  const sinNada = contextoParaWhatsapp({ lead: LEAD, notas: [], llamadas: [], ahora: AHORA })
  ok('sin historial: primer mensaje por este canal y sin bloques vacíos', sinNada.includes('este es el primer mensaje por este canal') && !sinNada.includes('HISTORIAL DE CONTACTO') && !sinNada.includes('LLAMADAS'))

  const conLlamada = contextoParaWhatsapp({
    lead: { ...LEAD, status: 'programado' },
    notas: [],
    llamadas: [{ fecha: hace(0), direccion: 'outbound', duracion_s: 240, estado: 'ANSWERED', tipo: 'conversacion', resumen: 'Le interesan las fichas; pide que le llamemos el jueves.', siguiente_paso: 'Llamar el jueves por la tarde', interes: 'alto' }],
    ahora: AHORA,
  })
  ok('lleva lo que se habló en la llamada, el interés y el siguiente paso', conLlamada.includes('LO QUE SE HABLÓ EN LAS LLAMADAS') && conLlamada.includes('Le interesan las fichas') && conLlamada.includes('interés del cliente: alto') && conLlamada.includes('Llamar el jueves'))

  const noInteresa = contextoParaWhatsapp({ lead: { ...LEAD, status: 'no_interesa' }, notas: [], llamadas: [], ahora: AHORA })
  ok('un lead marcado «No le interesa» lleva el aviso aparte', noInteresa.includes('AVISOS PARA ESTE MENSAJE') && noInteresa.includes('No le interesa'))
}

console.log('\n=== lo ya escrito por canales ===')
{
  const una = resumenDeCanales([{ kind: 'whatsapp', body: 'x', occurred_at: hace(2) }], AHORA)
  ok('un WhatsApp: «una vez» y hace cuánto', una.length === 1 && una[0].includes('una vez') && una[0].includes('hace 2 días'), JSON.stringify(una))
  const varias = resumenDeCanales([{ kind: 'whatsapp', body: 'x', occurred_at: hace(2) }, { kind: 'whatsapp', body: 'y', occurred_at: hace(9) }], AHORA)
  ok('dos WhatsApp: «2 veces» y el último', varias[0].includes('2 veces') && varias[0].includes('hace 2 días'))
  const respondio = resumenDeCanales([{ kind: 'email', body: 'a', occurred_at: hace(6) }, { kind: 'email', body: 'b', occurred_at: hace(4), es_respuesta: true }], AHORA)
  ok('un correo con respuesta del cliente lo dice', respondio.some((l) => l.includes('Correo') && l.includes('nos ha contestado')), JSON.stringify(respondio))
  const sinRespuesta = resumenDeCanales([{ kind: 'email', body: 'a', occurred_at: hace(6) }], AHORA)
  ok('un correo sin respuesta también', sinRespuesta.some((l) => l.includes('no consta que haya contestado')))
  ok('una nota que no es de WhatsApp ni de correo no cuenta', resumenDeCanales([{ kind: 'nota', body: 'x', occurred_at: hace(1) }], AHORA).length === 1)
}

console.log('\n=== los WhatsApp que ya se escribieron ===')
{
  const lista = whatsappsAnteriores([
    { kind: 'whatsapp', body: cuerpoDelApunteDeWhatsapp({ numero: '34600000000', texto: 'El más antiguo' }), occurred_at: hace(10) },
    { kind: 'nota', body: 'Una nota', occurred_at: hace(1) },
    { kind: 'whatsapp', body: cuerpoDelApunteDeWhatsapp({ numero: '34600000000', texto: 'El más reciente' }), occurred_at: hace(2) },
    { kind: 'whatsapp', body: 'Escrito a mano', occurred_at: hace(5) },
  ])
  ok('salen sin la cabecera, el más reciente primero, y solo los de WhatsApp', JSON.stringify(lista) === JSON.stringify(['El más reciente', 'Escrito a mano', 'El más antiguo']), JSON.stringify(lista))
  const muchas = Array.from({ length: 9 }, (_, i) => ({ kind: 'whatsapp', body: `Mensaje ${i}`, occurred_at: hace(i) }))
  ok('como mucho cinco', whatsappsAnteriores(muchas).length === 5 && whatsappsAnteriores(muchas, 2).length === 2)
}

console.log('\n=== el encargo ===')
{
  const base = { contexto: 'CONTEXTO DE PRUEBA', miNombre: 'Raúl', empresa: 'Casa Luz', indicaciones: null, anterior: null }
  for (const s of SITUACIONES_DE_WHATSAPP) {
    const e = construirEncargoDeWhatsapp({ ...base, situacion: s })
    ok(`${ETIQUETA_DE_SITUACION[s]}: dice el momento y lo que se espera`, e.usuario.includes(`EL MOMENTO: ${ETIQUETA_DE_SITUACION[s]}`) && e.usuario.includes(DESCRIPCION_DEL_MOMENTO[s]))
  }
  const e = construirEncargoDeWhatsapp({ ...base, situacion: 'no_contesta' })
  ok('lleva el contexto y el sistema', e.usuario.includes('CONTEXTO DE PRUEBA') && e.system === construirSistemaDeWhatsapp())
  ok('dice cómo se llama quien escribe y cómo llamar a la empresa', e.usuario.includes('se llama Raúl') && e.usuario.includes('«Casa Luz»') && e.usuario.includes('no firmes al final'))
  ok('sin indicaciones lo dice', e.usuario.includes('INDICACIONES DEL COMERCIAL PARA ESTE MENSAJE\nNinguna.'))
  ok('termina pidiendo el formato', e.usuario.trim().endsWith('Devuelve el mensaje en el formato pedido.'))

  const sinNombre = construirEncargoDeWhatsapp({ ...base, situacion: 'primer_contacto', miNombre: '  ', empresa: null })
  ok('sin nombre no se inventa uno, y sin empresa habla de «vuestra tienda»', sinNombre.usuario.includes('No consta el nombre de quien escribe') && sinNombre.usuario.includes('del equipo de Liberty Seller') && sinNombre.usuario.includes('«vuestra tienda»'))

  const cambiar = construirEncargoDeWhatsapp({ ...base, situacion: 'tras_hablar', anterior: 'Hola, soy Raúl. ¿Hablamos?', indicaciones: 'Más corto' })
  ok('con un mensaje anterior y una indicación, los lleva', cambiar.usuario.includes('MENSAJE ANTERIOR') && cambiar.usuario.includes('Hola, soy Raúl. ¿Hablamos?') && cambiar.usuario.includes('Más corto'))
  const mejorar = construirEncargoDeWhatsapp({ ...base, situacion: 'tras_hablar', anterior: 'Hola, soy Raúl. ¿Hablamos?' })
  ok('con un mensaje anterior y sin indicaciones, pide mejorarlo sin cambiar lo que dice', mejorar.usuario.includes('mejora el mensaje anterior'))

  const largo = construirEncargoDeWhatsapp({ ...base, situacion: 'tras_hablar', anterior: 'a'.repeat(5000), indicaciones: 'b'.repeat(5000) })
  ok('el texto libre se recorta (anterior 1.200, indicaciones 300)', !largo.usuario.includes('a'.repeat(1201)) && largo.usuario.includes('a'.repeat(1200)) && !largo.usuario.includes('b'.repeat(301)) && largo.usuario.includes('b'.repeat(300)))

  const conEnfoque = construirEncargoDeWhatsapp({ ...base, situacion: 'primer_contacto', enfoque: elegirEnfoque(0) })
  ok('con un enfoque lo lleva, en su propio bloque', conEnfoque.usuario.includes('FORMA DE ESTE MENSAJE') && conEnfoque.usuario.includes(ENFOQUES_DE_APERTURA[0]))
  ok('sin enfoque no hay bloque', !e.usuario.includes('FORMA DE ESTE MENSAJE'))
  ok('si hay un mensaje que cambiar, manda lo que pide el comercial y el enfoque sobra', !construirEncargoDeWhatsapp({ ...base, situacion: 'primer_contacto', enfoque: elegirEnfoque(0), anterior: 'Hola, soy Raúl. ¿Hablamos?' }).usuario.includes('FORMA DE ESTE MENSAJE'))
  ok('el enfoque sale de la lista para cualquier número entre 0 y 1, incluso fuera de rango', [0, 0.2, 0.5, 0.99, 1, -3, 7].every((n) => ENFOQUES_DE_APERTURA.includes(elegirEnfoque(n))) && new Set([0, 0.25, 0.45, 0.65, 0.85].map(elegirEnfoque)).size === ENFOQUES_DE_APERTURA.length)

  ok('el cierre sale de la lista para cualquier número entre 0 y 1, incluso fuera de rango, y salen todos', [0, 0.2, 0.5, 0.99, 1, -3, 7].every((n) => CIERRES_DE_MENSAJE.includes(elegirCierre(n))) && new Set([0, 0.25, 0.45, 0.65, 0.85].map(elegirCierre)).size === CIERRES_DE_MENSAJE.length)

  const aleatorios = (...xs: number[]) => {
    let i = 0
    return () => xs[i++ % xs.length]
  }
  const frio = enfoqueDelMensaje({ situacion: 'primer_contacto', pideAlgo: false, aleatorio: aleatorios(0, 0.5) })
  ok('en un primer contacto lleva cómo empezar y cómo cerrar, cada uno con su número', frio === `${elegirEnfoque(0)} ${elegirCierre(0.5)}`, String(frio))
  ok('en «te he llamado y no contesta» también', enfoqueDelMensaje({ situacion: 'no_contesta', pideAlgo: false, aleatorio: Math.random })?.includes('Cierra') === true)
  ok('después de hablar NO: se apoya en lo hablado y en lo acordado', enfoqueDelMensaje({ situacion: 'tras_hablar', pideAlgo: false, aleatorio: Math.random }) === null)
  ok('si el comercial pide algo (indicaciones o un mensaje que cambiar), manda lo suyo', enfoqueDelMensaje({ situacion: 'primer_contacto', pideAlgo: true, aleatorio: Math.random }) === null)
  ok('con números distintos salen formas distintas', new Set([0, 0.3, 0.6, 0.9].map((n) => enfoqueDelMensaje({ situacion: 'no_contesta', pideAlgo: false, aleatorio: () => n }))).size === 4)
  const completo = construirEncargoDeWhatsapp({ ...base, situacion: 'no_contesta', enfoque: frio })
  ok('el encargo lleva las dos indicaciones en el bloque de la forma del mensaje', completo.usuario.includes('FORMA DE ESTE MENSAJE') && completo.usuario.includes(elegirEnfoque(0)) && completo.usuario.includes(elegirCierre(0.5)))

  const ya = construirEncargoDeWhatsapp({ ...base, situacion: 'no_contesta', yaEscritos: ['Hola, soy Raúl de Liberty Seller.\n\n¿Hablamos?', '', 'Otro', 'Otro más', 'Uno de más'] })
  ok('lleva lo ya escrito por WhatsApp (tres como mucho, en una línea cada uno)', ya.usuario.includes('LO QUE YA SE LE ESCRIBIÓ POR WHATSAPP') && ya.usuario.includes('- Hola, soy Raúl de Liberty Seller. ¿Hablamos?') && !ya.usuario.includes('Uno de más') && ya.usuario.includes('- Otro más'))
  const conDatos = construirEncargoDeWhatsapp({ ...base, situacion: 'no_contesta', yaEscritos: ['Hola, llámame al 612 34 56 78 o escribe a raul@libertyseller.com'] })
  ok('lo ya escrito sale sin teléfonos ni correos', !conDatos.usuario.includes('612 34 56 78') && !conDatos.usuario.includes('raul@libertyseller.com') && conDatos.usuario.includes('- Hola, llámame al'), conDatos.usuario)
  ok('sin nada ya escrito, no lleva ese bloque', !e.usuario.includes('LO QUE YA SE LE ESCRIBIÓ POR WHATSAPP'))
}

console.log('\n=== leer lo que devuelve la IA ===')
{
  const bueno = JSON.stringify({ mensaje: 'Hola, soy Raúl de Liberty Seller. Estuve viendo vuestra tienda y creo que en Amazon hay un hueco. ¿Hablamos diez minutos?', base: 'Que vende decoración y todavía no está en Amazon' })
  const l = leerMensajeDeWhatsapp(bueno)
  ok('lee el mensaje y en qué se ha apoyado', l?.mensaje.startsWith('Hola, soy Raúl') === true && l.base === 'Que vende decoración y todavía no está en Amazon', JSON.stringify(l))
  ok('limpia lo que cuela: negritas, comillas y despedida', leerMensajeDeWhatsapp(JSON.stringify({ mensaje: '"Hola, soy **Raúl** de Liberty Seller. ¿Hablamos un momento?\n\nUn saludo,"', base: 'x' }))?.mensaje === 'Hola, soy Raúl de Liberty Seller. ¿Hablamos un momento?')
  ok('sin «base», la pone la lectura', leerMensajeDeWhatsapp(JSON.stringify({ mensaje: 'Hola, soy Raúl de Liberty Seller. ¿Hablamos un momento?', base: '   ' }))?.base === 'Nada concreto: no había datos')
  ok('la «base» se recorta a una línea', (leerMensajeDeWhatsapp(JSON.stringify({ mensaje: 'Hola, soy Raúl de Liberty Seller. ¿Hablamos un momento?', base: `una\n\nlínea ${'x'.repeat(500)}` }))?.base.length ?? 0) <= 240)
  ok('lo que no es JSON, no', leerMensajeDeWhatsapp('hola') === null && leerMensajeDeWhatsapp('') === null && leerMensajeDeWhatsapp(null) === null && leerMensajeDeWhatsapp(undefined) === null)
  ok('faltan campos o son de otro tipo, no', leerMensajeDeWhatsapp('{"mensaje":"Hola, soy Raúl de Liberty Seller. ¿Hablamos?"}') === null && leerMensajeDeWhatsapp('{"mensaje":5,"base":"x"}') === null)
  ok('demasiado corto o demasiado largo, no', leerMensajeDeWhatsapp(JSON.stringify({ mensaje: 'Hola', base: 'x' })) === null && leerMensajeDeWhatsapp(JSON.stringify({ mensaje: 'a'.repeat(1500), base: 'x' })) === null)
  ok('el esquema es estricto y pide las dos cosas', ESQUEMA_DE_WHATSAPP.additionalProperties === false && ESQUEMA_DE_WHATSAPP.required.join() === 'mensaje,base')
}

console.log('\n=== la corrección ===')
{
  const m = mensajeDeCorreccionDeWhatsapp(['dinero', 'enlace'])
  ok('dice por qué no vale cada cosa y pide el mismo formato', m.includes('facturación') && m.includes('enlace') && m.includes('mismo formato'), m)
  ok('hay frase para cada problema', (['dinero', 'hueco', 'largo', 'corto', 'enlace', 'repite'] as const).every((p) => mensajeDeCorreccionDeWhatsapp([p]).length > 60))
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
