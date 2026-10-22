import { leerBuzon, MENSAJE_MAX_BYTES } from '@/lib/correo/sincronizar'
import { BaseFalsa, ServidorFalso, crudo, type CarpetaEnServidor } from '@/lib/correo/pruebas-comunes'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const igual = (n: string, real: unknown, esperado: unknown) => ok(n, JSON.stringify(real) === JSON.stringify(esperado), `real ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`)

/**
 * LEER UN BUZÓN: servidor IMAP falso + base falsa en memoria.
 *
 * Los correos de abajo cuentan una conversación comercial de verdad: Ana (la comercial) escribe a Carmen, Carmen contesta,
 * y llega ruido (un aviso de Amazon, una respuesta sin cabeceras de hilo).
 */

const T = (s: string) => new Date(s)
const ANA = 'Ana <ana@liberty.test>'
const CARMEN = 'Carmen Ruiz <carmen@cliente.test>'

function servidorBase(): ServidorFalso {
  const entrada: CarpetaEnServidor = {
    path: 'INBOX',
    uidValidity: 100,
    mensajes: [
      // La RESPUESTA tiene un UID MENOR que lo que se importa primero? No: el UID más alto es el más reciente
      { uid: 1, fecha: T('2026-10-20T09:00:00Z'), flags: ['\\Seen'], fuente: crudo({ id: 'r1@cliente.test', de: CARMEN, para: ANA, asunto: 'Re: Propuesta de Amazon', fecha: '2026-10-20T09:00:00Z', enRespuestaA: 'p1@liberty.test', referencias: ['p1@liberty.test'] }) },
      { uid: 2, fecha: T('2026-10-21T08:00:00Z'), flags: [], fuente: crudo({ id: 'r2@cliente.test', de: CARMEN, para: ANA, asunto: 'Re: Propuesta de Amazon', fecha: '2026-10-21T08:00:00Z', enRespuestaA: 'p2@liberty.test', referencias: ['p1@liberty.test', 'r1@cliente.test', 'p2@liberty.test'] }) },
      { uid: 3, fecha: T('2026-10-21T09:00:00Z'), flags: [], fuente: crudo({ id: 'aviso@amazon.test', de: 'Amazon <no-reply@amazon.test>', para: ANA, asunto: 'Tu cuenta de vendedor', fecha: '2026-10-21T09:00:00Z' }) },
    ],
  }
  const enviados: CarpetaEnServidor = {
    path: 'INBOX.Sent',
    specialUse: '\\Sent',
    uidValidity: 200,
    mensajes: [
      { uid: 1, fecha: T('2026-10-19T10:00:00Z'), flags: ['\\Seen'], fuente: crudo({ id: 'p1@liberty.test', de: ANA, para: CARMEN, asunto: 'Propuesta de Amazon', fecha: '2026-10-19T10:00:00Z' }) },
      { uid: 2, fecha: T('2026-10-20T10:00:00Z'), flags: ['\\Seen'], fuente: crudo({ id: 'p2@liberty.test', de: ANA, para: CARMEN, asunto: 'Re: Propuesta de Amazon', fecha: '2026-10-20T10:00:00Z', enRespuestaA: 'r1@cliente.test', referencias: ['p1@liberty.test', 'r1@cliente.test'] }) },
    ],
  }
  return new ServidorFalso([entrada, enviados, { path: 'INBOX.Trash', specialUse: '\\Trash', uidValidity: 300, mensajes: [{ uid: 1, fecha: T('2026-10-21T00:00:00Z'), flags: [], fuente: crudo({ id: 'basura@x.test', de: 'x@x.test', para: ANA, asunto: 'Basura', fecha: '2026-10-21T00:00:00Z' }) }] }])
}

async function leer(servidor: ServidorFalso, base: BaseFalsa, presupuestoMs = 60_000) {
  return leerBuzon(servidor.cliente(), base, base.buzon, { presupuestoMs })
}

async function main() {
  console.log('primera lectura: una conversación en tres sitios')
  {
    const servidor = servidorBase()
    const base = new BaseFalsa()
    const r = await leer(servidor, base)
    igual('importa los cinco mensajes de Entrada y Enviados', r.importados, 5)
    igual('completo', [r.completo, r.quedan], [true, 0])
    igual('dos carpetas leídas, la papelera no', r.carpetas.map((c) => c.ruta), ['INBOX', 'INBOX.Sent'])
    const hilos = base.hilosConMensajes()
    igual('DOS hilos: la conversación y el aviso', hilos.length, 2)
    const conversacion = hilos.find((h) => h.mensajes === 4)
    ok('la conversación junta los cuatro mensajes aunque la respuesta llegó antes que el original', !!conversacion, JSON.stringify(hilos.map((h) => [h.asunto, h.mensajes])))
    igual('con el asunto del primero', conversacion?.asunto, 'Propuesta de Amazon')
    igual('dos entrantes y dos salientes', [conversacion?.entrantes, conversacion?.salientes], [2, 2])
    igual('uno sin leer (el UID 2)', conversacion?.no_leidos, 1)
    igual('espera respuesta: el último lo escribió Carmen', conversacion?.ultimo_es_entrante, true)
    igual('participantes sin la propia dirección', conversacion?.participantes, ['carmen@cliente.test'])
    const aviso = hilos.find((h) => h.mensajes === 1)
    igual('el aviso de Amazon es automático', aviso?.automatico, true)
    igual('y no espera respuesta', aviso?.ultimo_es_entrante, false)
    ok('la lectura NO escribe nada en el servidor', !servidor.huboEscrituras(), servidor.ordenes.join(' | '))
    ok('las carpetas se abren en solo lectura', servidor.ordenes.filter((o) => o.startsWith('EXAMINE')).length === 2 && !servidor.ordenes.some((o) => o.startsWith('SELECT')), servidor.ordenes.join(' | '))
    igual('guarda el UIDVALIDITY de cada carpeta', base.carpetas.map((c) => [c.rol, c.uidvalidity]), [['entrada', 100], ['enviados', 200]])
    ok('los de Entrada son entrantes y los de Enviados salientes', base.mensajes.filter((m) => m.direccion === 'saliente').length === 2 && base.mensajes.filter((m) => m.direccion === 'entrante').length === 3)
    ok('lo enviado cuenta como leído', base.mensajes.filter((m) => m.direccion === 'saliente').every((m) => m.leido))
    ok('la bandera de leído del servidor se respeta', base.mensajes.find((m) => m.uid === 1 && m.direccion === 'entrante')?.leido === true && base.mensajes.find((m) => m.uid === 2 && m.direccion === 'entrante')?.leido === false)
    ok('las respuestas llevan sus cabeceras de hilo guardadas', base.mensajes.some((m) => m.en_respuesta_a === 'p1@liberty.test' && m.referencias.includes('p1@liberty.test')))
  }

  console.log('segunda lectura: no hay nada nuevo')
  {
    const servidor = servidorBase()
    const base = new BaseFalsa()
    await leer(servidor, base)
    const antes = base.mensajes.length
    const r = await leer(servidor, base)
    igual('no importa nada', r.importados, 0)
    igual('no duplica', base.mensajes.length, antes)
  }

  console.log('llega un correo nuevo')
  {
    const servidor = servidorBase()
    const base = new BaseFalsa()
    await leer(servidor, base)
    servidor.añadir('INBOX', { fecha: T('2026-10-22T07:00:00Z'), flags: [], fuente: crudo({ id: 'r3@cliente.test', de: CARMEN, para: ANA, asunto: 'Re: Propuesta de Amazon', fecha: '2026-10-22T07:00:00Z', enRespuestaA: 'p2@liberty.test', referencias: ['p1@liberty.test', 'p2@liberty.test'] }) })
    const r = await leer(servidor, base)
    igual('importa solo el nuevo', r.importados, 1)
    const hilo = base.hilosConMensajes().find((h) => h.mensajes === 5)
    ok('cae en la conversación', !!hilo)
    igual('y ahora sí espera respuesta', hilo?.ultimo_es_entrante, true)
    igual('con dos sin leer', hilo?.no_leidos, 2)
  }

  console.log('lo ya leído en otro sitio se actualiza')
  {
    const servidor = servidorBase()
    const base = new BaseFalsa()
    await leer(servidor, base)
    servidor.carpeta('INBOX').mensajes.find((m) => m.uid === 2)!.flags.push('\\Seen')
    await leer(servidor, base)
    ok('el mensaje pasa a leído', base.mensajes.find((m) => m.uid === 2 && m.direccion === 'entrante')?.leido === true)
    igual('y el hilo se recalcula', base.hilosConMensajes().find((h) => h.mensajes === 4)?.no_leidos, 0)
  }

  console.log('sin tiempo: se importa lo más reciente y la siguiente pasada sigue')
  {
    const servidor = servidorBase()
    const base = new BaseFalsa()
    let reloj = 1_000_000
    const lento = new Proxy(servidor.cliente(), {
      get(objetivo, propiedad, receptor) {
        const valor = Reflect.get(objetivo, propiedad, receptor)
        if (propiedad === 'getMailboxLock') return async (...args: unknown[]) => { reloj += 5_000; return (valor as (...a: unknown[]) => Promise<unknown>).apply(objetivo, args) }
        return typeof valor === 'function' ? valor.bind(objetivo) : valor
      },
    })
    const r1 = await leerBuzon(lento, base, base.buzon, { presupuestoMs: 3_000, ahora: () => reloj })
    ok('la primera pasada no termina', !r1.completo, JSON.stringify(r1))
    const r2 = await leerBuzon(servidor.cliente(), base, base.buzon, { presupuestoMs: 60_000 })
    ok('la siguiente completa', r2.completo, JSON.stringify(r2))
    igual('al final están los cinco, sin repetir', base.mensajes.length, 5)
  }

  console.log('lo más reciente va primero')
  {
    const servidor = servidorBase()
    const base = new BaseFalsa()
    await leer(servidor, base)
    const insertados = base.mensajes.filter((m) => m.direccion === 'entrante').map((m) => m.uid)
    igual('en Entrada se guarda del UID más alto al más bajo', insertados, [3, 2, 1])
  }

  console.log('el servidor cambia el UIDVALIDITY')
  {
    const servidor = servidorBase()
    const base = new BaseFalsa()
    await leer(servidor, base)
    const antes = base.mensajes.length
    // El buzón se restaura: otro UIDVALIDITY y los mismos mensajes con UID nuevos
    const entrada = servidor.carpeta('INBOX')
    entrada.uidValidity = 999
    entrada.mensajes.forEach((m) => (m.uid += 100))
    const r = await leer(servidor, base)
    igual('no duplica nada', base.mensajes.length, antes)
    igual('no importa mensajes nuevos', r.importados, 0)
    ok('los mensajes quedan con sus UID nuevos', base.mensajes.filter((m) => m.direccion === 'entrante').every((m) => (m.uid ?? 0) > 100), JSON.stringify(base.mensajes.filter((m) => m.direccion === 'entrante').map((m) => m.uid)))
    igual('se anota el UIDVALIDITY nuevo', base.carpetas.find((c) => c.rol === 'entrada')?.uidvalidity, 999)
  }

  console.log('un correo enviado desde el ERP que el servidor no confirmó')
  {
    const servidor = servidorBase()
    const base = new BaseFalsa()
    await leer(servidor, base)
    // El ERP envió «p3» y lo guardó sin UID
    const enviados = base.carpetas.find((c) => c.rol === 'enviados')!
    const hilo = base.hilosConMensajes()[0]
    base.mensajes.push({ id: 'huerfano', buzon_id: base.buzon.id, hilo_id: hilo.id, carpeta_id: enviados.id, uid: null, message_id: 'p3@liberty.test', en_respuesta_a: null, referencias: [], direccion: 'saliente', de_nombre: 'Ana', de_direccion: 'ana@liberty.test', para: [], cc: [], destinatarios: '', responder_a: [], automatico: false, asunto: 'Enviado desde el ERP', fecha: '2026-10-22T08:00:00.000Z', texto: 'x', html: null, vista_previa: 'x', leido: true, adjuntos: [], tamano: 1 })
    const total = base.mensajes.length
    // Aparece en la carpeta Enviados del servidor
    servidor.añadir('INBOX.Sent', { fecha: T('2026-10-22T08:00:00Z'), flags: ['\\Seen'], fuente: crudo({ id: 'p3@liberty.test', de: ANA, para: CARMEN, asunto: 'Enviado desde el ERP', fecha: '2026-10-22T08:00:00Z' }) })
    const r = await leer(servidor, base)
    igual('no se guarda otra copia', base.mensajes.length, total)
    igual('no cuenta como importado', r.importados, 0)
    igual('se le pone su UID', base.mensajes.find((m) => m.id === 'huerfano')?.uid, 3)
  }

  console.log('respuestas sin cabeceras de hilo: por el asunto')
  {
    const servidor = new ServidorFalso([
      {
        path: 'INBOX',
        uidValidity: 1,
        mensajes: [
          { uid: 1, fecha: T('2026-10-10T09:00:00Z'), flags: [], fuente: crudo({ id: null, de: CARMEN, para: ANA, asunto: 'Presupuesto web', fecha: '2026-10-10T09:00:00Z' }) },
          { uid: 2, fecha: T('2026-10-12T09:00:00Z'), flags: [], fuente: crudo({ id: null, de: CARMEN, para: ANA, asunto: 'RE: Presupuesto web', fecha: '2026-10-12T09:00:00Z' }) },
          // Mismo asunto pero OTRA persona: no es la misma conversación
          { uid: 3, fecha: T('2026-10-12T10:00:00Z'), flags: [], fuente: crudo({ id: null, de: 'Pedro <pedro@otro.test>', para: ANA, asunto: 'Presupuesto web', fecha: '2026-10-12T10:00:00Z' }) },
          // Mismo asunto y persona pero seis meses después: tampoco
          { uid: 4, fecha: T('2026-04-12T10:00:00Z'), flags: [], fuente: crudo({ id: null, de: CARMEN, para: ANA, asunto: 'Presupuesto web', fecha: '2026-04-12T10:00:00Z' }) },
        ],
      },
    ])
    const base = new BaseFalsa({ desde_fecha: '2026-01-01T00:00:00.000Z' })
    await leer(servidor, base)
    const hilos = base.hilosConMensajes()
    igual('tres hilos', hilos.length, 3)
    igual('el de Carmen en octubre junta dos', hilos.map((h) => h.mensajes).sort(), [1, 1, 2])
  }

  console.log('avisos automáticos del mismo remitente: cada uno el suyo')
  {
    const aviso = (uid: number, fecha: string) => ({ uid, fecha: T(fecha), flags: [], fuente: crudo({ id: `a${uid}@amazon.test`, de: 'Amazon <no-reply@amazon.test>', para: ANA, asunto: 'Resumen diario de ventas', fecha }) })
    const servidor = new ServidorFalso([{ path: 'INBOX', uidValidity: 1, mensajes: [aviso(1, '2026-10-10T09:00:00Z'), aviso(2, '2026-10-11T09:00:00Z'), aviso(3, '2026-10-12T09:00:00Z')] }])
    const base = new BaseFalsa()
    await leer(servidor, base)
    igual('tres hilos, no uno de tres', base.hilosConMensajes().map((h) => h.mensajes), [1, 1, 1])
  }

  console.log('un correo que une dos conversaciones')
  {
    const servidor = new ServidorFalso([
      {
        path: 'INBOX',
        uidValidity: 1,
        mensajes: [
          // Se importa del UID más alto al más bajo: A y B se colocan primero (cada uno en su hilo) y C, que tiene el UID
          // más bajo, llega el último y demuestra que eran la misma conversación
          { uid: 3, fecha: T('2026-10-10T09:00:00Z'), flags: [], fuente: crudo({ id: 'a@x.test', de: CARMEN, para: ANA, asunto: 'Tema A', fecha: '2026-10-10T09:00:00Z' }) },
          { uid: 2, fecha: T('2026-10-11T09:00:00Z'), flags: [], fuente: crudo({ id: 'b@x.test', de: 'Luis <luis@otro.test>', para: ANA, asunto: 'Tema B', fecha: '2026-10-11T09:00:00Z' }) },
          { uid: 1, fecha: T('2026-10-12T09:00:00Z'), flags: [], fuente: crudo({ id: 'c@x.test', de: CARMEN, para: ANA, cc: 'luis@otro.test', asunto: 'Juntos', fecha: '2026-10-12T09:00:00Z', enRespuestaA: 'b@x.test', referencias: ['a@x.test', 'b@x.test'] }) },
        ],
      },
    ])
    const base = new BaseFalsa()
    await leer(servidor, base)
    igual('queda un solo hilo con los tres', base.hilosConMensajes().map((h) => h.mensajes), [3])
    ok('se ha fusionado', base.llamadas.some((l) => l.startsWith('fusionarHilos')))
    igual('y los hilos vacíos desaparecen', base.hilos.length, 1)
  }

  console.log('un mensaje enorme no se trae entero')
  {
    const servidor = servidorBase()
    servidor.añadir('INBOX', { fecha: T('2026-10-22T06:00:00Z'), flags: [], tamano: MENSAJE_MAX_BYTES + 1, fuente: crudo({ id: 'video@x.test', de: CARMEN, para: ANA, asunto: 'Vídeo del producto', fecha: '2026-10-22T06:00:00Z', cuerpo: 'esto no debería leerse' }) })
    const base = new BaseFalsa()
    await leer(servidor, base)
    const m = base.mensajes.find((x) => x.message_id === 'video@x.test')
    ok('se guarda', !!m)
    ok('con un aviso en vez del contenido', !!m && m.texto.includes('no se ha traído al ERP') && !m.texto.includes('esto no debería leerse'), m?.texto)
    igual('pero con su asunto', m?.asunto, 'Vídeo del producto')
    ok('se pidieron solo sus cabeceras', servidor.ordenes.includes('FETCHONE headers'))
  }

  console.log('un correo que no se puede leer no bloquea la lectura')
  {
    const servidor = servidorBase()
    // Sin cuerpo: el servidor no devuelve el source de este UID
    servidor.carpeta('INBOX').mensajes.push({ uid: 9, fecha: T('2026-10-22T05:00:00Z'), flags: [], fuente: Buffer.from('') })
    const original = servidor.cliente
    const base = new BaseFalsa()
    const r = await leer(servidor, base)
    igual('se importan los demás', r.importados >= 5, true)
    void original
    ok('y el roto queda con un aviso', base.mensajes.some((m) => m.uid === 9), JSON.stringify(base.mensajes.map((m) => m.uid)))
  }

  console.log('carpetas')
  {
    const sinEnviados = new ServidorFalso([{ path: 'INBOX', uidValidity: 1, mensajes: [{ uid: 1, fecha: T('2026-10-20T09:00:00Z'), flags: [], fuente: crudo({ id: 'a@x.test', de: CARMEN, para: ANA, asunto: 'Hola', fecha: '2026-10-20T09:00:00Z' }) }] }])
    const base = new BaseFalsa()
    const r = await leer(sinEnviados, base)
    igual('sin carpeta de Enviados solo se lee la Entrada', r.carpetas.map((c) => c.rol), ['entrada'])
    igual('y se completa', r.completo, true)

    // La carpeta existe en la lista pero al abrirla el servidor dice que no
    const fantasma = servidorBase()
    fantasma.carpetas = fantasma.carpetas.filter((c) => c.path !== 'INBOX.Sent')
    const base2 = new BaseFalsa()
    const original = fantasma.cliente()
    const conFantasma = new Proxy(original, {
      get(objetivo, propiedad, receptor) {
        const valor = Reflect.get(objetivo, propiedad, receptor)
        if (propiedad === 'list') return async () => [{ path: 'INBOX', name: 'INBOX', delimiter: '.', flags: new Set<string>() }, { path: 'Sent', name: 'Sent', delimiter: '.', flags: new Set<string>(), specialUse: '\\Sent' }]
        return typeof valor === 'function' ? valor.bind(objetivo) : valor
      },
    })
    const r2 = await leerBuzon(conFantasma, base2, base2.buzon, { presupuestoMs: 60_000 })
    igual('una carpeta que el servidor dice que no existe se salta', r2.carpetas.map((c) => [c.rol, c.quedan]), [['entrada', 0], ['enviados', 0]])
    igual('y la Entrada se importa igual', r2.importados, 3)
  }

  console.log('fecha de corte')
  {
    const servidor = servidorBase()
    const base = new BaseFalsa({ desde_fecha: '2026-10-21T00:00:00.000Z' })
    const r = await leer(servidor, base)
    igual('solo entra lo posterior a la fecha elegida', r.importados, 2)
  }

  console.log('un fallo del servidor a mitad deja lo hecho')
  {
    const servidor = servidorBase()
    const base = new BaseFalsa()
    servidor.fallarEnFetch = true
    let error: unknown = null
    try {
      await leer(servidor, base)
    } catch (e) {
      error = e
    }
    ok('la lectura lanza el error', error !== null)
    servidor.fallarEnFetch = false
    const r = await leer(servidor, base)
    igual('la siguiente lo recupera todo', [r.importados, base.mensajes.length], [5, 5])
  }

  console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('ERROR', e)
  process.exit(1)
})
