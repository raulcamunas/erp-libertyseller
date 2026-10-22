import { simpleParser } from 'mailparser'
import { ErrorDeCorreo } from '@/lib/correo/conexion'
import {
  MAX_ADJUNTOS,
  MAX_BYTES_ADJUNTOS,
  MAX_DESTINATARIOS,
  comprobarEntrada,
  componerCorreo,
  enviarCorreo,
  type CopiaEnEnviados,
  type DepsDeEnvio,
  type EntradaDeEnvio,
} from '@/lib/correo/enviar'
import { leerBuzon } from '@/lib/correo/sincronizar'
import { BaseFalsa, ServidorFalso, crudo } from '@/lib/correo/pruebas-comunes'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const igual = (n: string, real: unknown, esperado: unknown) => ok(n, JSON.stringify(real) === JSON.stringify(esperado), `real ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`)

/** ENVIAR: componer, mandar por SMTP, copiar a Enviados y guardar en su hilo. Con un transporte y una base falsos. */

const AHORA = new Date('2026-10-22T10:00:00Z')
const CARMEN = { nombre: 'Carmen Ruiz', direccion: 'carmen@cliente.test' }
const LUIS = { nombre: '', direccion: 'luis@otro.test' }

interface Envio {
  sobre: { from: string; to: string[] }
  crudo: Buffer
}

function transporteFalso(opciones: { aceptados?: string[]; rechazados?: string[]; falla?: unknown } = {}) {
  const enviados: Envio[] = []
  return {
    enviados,
    transporte: {
      async sendMail(m: { envelope: { from: string; to: string[] }; raw: Buffer }) {
        if (opciones.falla) throw opciones.falla
        enviados.push({ sobre: m.envelope, crudo: m.raw })
        return { accepted: opciones.aceptados ?? m.envelope.to, rejected: opciones.rechazados ?? [] }
      },
    },
  }
}

function deps(base: BaseFalsa, t: ReturnType<typeof transporteFalso>, copia: CopiaEnEnviados | null | Error): DepsDeEnvio {
  return {
    almacen: base,
    transporte: t.transporte as unknown as DepsDeEnvio['transporte'],
    copiarAEnviados: async () => {
      if (copia instanceof Error) throw copia
      return copia
    },
  }
}

const entradaBase = (extra: Partial<EntradaDeEnvio> = {}): EntradaDeEnvio => ({ para: [CARMEN], cc: [], asunto: 'Propuesta de Amazon', texto: 'Hola Carmen,\nte paso la propuesta.\n\nUn saludo', ...extra })

async function main() {
  console.log('comprobar la entrada')
  igual('una entrada normal', comprobarEntrada(entradaBase()), null)
  igual('sin destinatarios', comprobarEntrada(entradaBase({ para: [] })), 'sin_destinatarios')
  igual('solo con copia no vale', comprobarEntrada(entradaBase({ para: [], cc: [LUIS] })), 'sin_destinatarios')
  igual('demasiados destinatarios', comprobarEntrada(entradaBase({ para: Array.from({ length: MAX_DESTINATARIOS + 1 }, (_, i) => ({ nombre: '', direccion: `a${i}@x.test` })) })), 'demasiados_destinatarios')
  igual('asunto largo', comprobarEntrada(entradaBase({ asunto: 'a'.repeat(501) })), 'asunto_largo')
  igual('texto vacío', comprobarEntrada(entradaBase({ texto: '  \n ' })), 'texto_vacio')
  igual('texto vacío pero con adjunto vale', comprobarEntrada(entradaBase({ texto: '', adjuntos: [{ nombre: 'a.pdf', tipo: 'application/pdf', contenido: Buffer.from('x') }] })), null)
  igual('texto largo', comprobarEntrada(entradaBase({ texto: 'a'.repeat(100_001) })), 'texto_largo')
  igual('demasiados adjuntos', comprobarEntrada(entradaBase({ adjuntos: Array.from({ length: MAX_ADJUNTOS + 1 }, () => ({ nombre: 'a', tipo: 'a/b', contenido: Buffer.from('x') })) })), 'demasiados_adjuntos')
  igual('adjuntos grandes', comprobarEntrada(entradaBase({ adjuntos: [{ nombre: 'a', tipo: 'a/b', contenido: Buffer.alloc(MAX_BYTES_ADJUNTOS + 1) }] })), 'adjuntos_grandes')

  console.log('componer el mensaje')
  {
    const c = await componerCorreo(
      { direccion: 'ana@liberty.test', nombre: 'Ana López' },
      entradaBase({
        cc: [LUIS],
        asunto: 'Propuesta ñandú 🚀',
        respuesta: { messageId: 'r1@cliente.test', referencias: ['p1@liberty.test', 'r1@cliente.test'], cita: { encabezado: 'El lunes, Carmen escribió:', texto: 'Me interesa\n<b>x</b>' } },
        adjuntos: [{ nombre: '../../etc/passwd', tipo: 'application/pdf', contenido: Buffer.from('%PDF-1.4') }],
      }),
      { ahora: AHORA, id: 'fijo-123' }
    )
    igual('Message-ID propio, con el dominio del buzón', c.messageId, 'fijo-123@liberty.test')
    const p = await simpleParser(c.crudo)
    igual('remitente', [p.from?.value[0].name, p.from?.value[0].address], ['Ana López', 'ana@liberty.test'])
    igual('para', (p.to as { value: Array<{ address?: string }> }).value.map((v) => v.address), ['carmen@cliente.test'])
    igual('cc', p.cc && !Array.isArray(p.cc) ? p.cc.value.map((v) => v.address) : null, ['luis@otro.test'])
    igual('asunto con acentos y emoji', p.subject, 'Propuesta ñandú 🚀')
    igual('Message-ID', p.messageId, '<fijo-123@liberty.test>')
    igual('In-Reply-To', p.inReplyTo, '<r1@cliente.test>')
    igual('References sin repetir y con el citado al final', p.references, ['<p1@liberty.test>', '<r1@cliente.test>'])
    igual('fecha', p.date?.toISOString(), AHORA.toISOString())
    ok('lleva texto y HTML', !!p.text && typeof p.html === 'string')
    ok('el texto cita con «> »', (p.text ?? '').includes('> Me interesa'), p.text)
    ok('el HTML escapa lo citado', typeof p.html === 'string' && p.html.includes('&lt;b&gt;x&lt;/b&gt;') && !p.html.includes('<b>x'), String(p.html))
    igual('un adjunto', p.attachments.length, 1)
    igual('con el nombre limpio', p.attachments[0].filename, '_.._etc_passwd')
    ok('no lleva copia oculta', !p.headers.has('bcc'))
    igual('lleva la marca del programa', p.headers.get('x-mailer'), 'Liberty Seller Hub')
  }

  console.log('un asunto o un nombre con saltos de línea no inyectan cabeceras')
  {
    const c = await componerCorreo(
      { direccion: 'ana@liberty.test', nombre: 'Ana\r\nBcc: robado@x.test' },
      entradaBase({ asunto: 'Hola\r\nBcc: robado@x.test', para: [{ nombre: 'Carmen\r\nBcc: otro@x.test', direccion: 'carmen@cliente.test' }] }),
      { ahora: AHORA }
    )
    const p = await simpleParser(c.crudo)
    ok('sin cabecera Bcc', !p.headers.has('bcc'), JSON.stringify([...p.headers.keys()]))
    ok('el crudo no tiene una línea que empiece por Bcc', !/^bcc:/im.test(c.crudo.toString('utf8')))
  }

  console.log('enviar un correo nuevo')
  {
    const base = new BaseFalsa()
    const t = transporteFalso()
    const r = await enviarCorreo(deps(base, t, { ruta: 'INBOX.Sent', uid: 7, uidValidity: 200 }), base.buzon, entradaBase(), { ahora: AHORA, id: 'nuevo-1' })
    igual('sale un correo', t.enviados.length, 1)
    igual('con el sobre correcto', t.enviados[0].sobre, { from: 'ana@liberty.test', to: ['carmen@cliente.test'] })
    igual('se queda con su Message-ID', r.messageId, 'nuevo-1@liberty.test')
    igual('copiado a Enviados', r.copiadoAEnviados, true)
    igual('nadie rechazado', r.rechazados, [])
    igual('un mensaje y un hilo guardados', [base.mensajes.length, base.hilosConMensajes().length], [1, 1])
    const m = base.mensajes[0]
    igual('saliente, leído, con su UID', [m.direccion, m.leido, m.uid], ['saliente', true, 7])
    igual('en la carpeta de Enviados', base.carpetas.map((c) => [c.rol, c.ruta, c.uidvalidity]), [['enviados', 'INBOX.Sent', 200]])
    igual('guardado con su asunto y su texto', [m.asunto, m.texto.startsWith('Hola Carmen')], ['Propuesta de Amazon', true])
    igual('para quién', m.para.map((p) => p.direccion), ['carmen@cliente.test'])
    ok('el hilo no espera respuesta (lo último lo escribimos nosotros)', base.hilosConMensajes()[0].ultimo_es_entrante === false)
  }

  console.log('contestar entra en el hilo de lo contestado')
  {
    const servidor = new ServidorFalso([
      { path: 'INBOX', uidValidity: 100, mensajes: [{ uid: 1, fecha: new Date('2026-10-21T08:00:00Z'), flags: [], fuente: crudo({ id: 'r1@cliente.test', de: 'Carmen Ruiz <carmen@cliente.test>', para: 'ana@liberty.test', asunto: 'Interés', fecha: '2026-10-21T08:00:00Z' }) }] },
    ])
    const base = new BaseFalsa()
    await leerBuzon(servidor.cliente(), base, base.buzon, { presupuestoMs: 60_000 })
    igual('antes de contestar hay un hilo que espera respuesta', [base.hilosConMensajes().length, base.hilosConMensajes()[0].ultimo_es_entrante], [1, true])

    const t = transporteFalso()
    await enviarCorreo(deps(base, t, { ruta: 'INBOX.Sent', uid: 1, uidValidity: 200 }), base.buzon, entradaBase({ asunto: 'Re: Interés', respuesta: { messageId: 'r1@cliente.test', referencias: [], cita: null } }), { ahora: AHORA, id: 'resp-1' })
    igual('sigue habiendo un solo hilo', base.hilosConMensajes().length, 1)
    igual('con los dos mensajes', base.hilosConMensajes()[0].mensajes, 2)
    igual('y ya no espera respuesta', base.hilosConMensajes()[0].ultimo_es_entrante, false)
  }

  console.log('la copia a Enviados falla: el correo ya salió')
  {
    const base = new BaseFalsa()
    const t = transporteFalso()
    const r = await enviarCorreo(deps(base, t, new Error('IMAP caído')), base.buzon, entradaBase(), { ahora: AHORA, id: 'sin-copia' })
    igual('se envía', t.enviados.length, 1)
    igual('se avisa de que no hay copia', r.copiadoAEnviados, false)
    igual('se guarda sin UID', base.mensajes[0].uid, null)
    const sinCopia = await enviarCorreo(deps(base, transporteFalso(), null), base.buzon, entradaBase({ asunto: 'Otro' }), { ahora: AHORA, id: 'sin-copia-2' })
    igual('copia nula también se avisa', sinCopia.copiadoAEnviados, false)
  }

  console.log('el UID de la copia no se fía si el UIDVALIDITY no es el conocido')
  {
    const base = new BaseFalsa()
    await enviarCorreo(deps(base, transporteFalso(), { ruta: 'INBOX.Sent', uid: 5, uidValidity: 200 }), base.buzon, entradaBase({ asunto: 'Uno' }), { ahora: AHORA, id: 'a' })
    await enviarCorreo(deps(base, transporteFalso(), { ruta: 'INBOX.Sent', uid: 6, uidValidity: 999 }), base.buzon, entradaBase({ asunto: 'Dos', para: [LUIS] }), { ahora: AHORA, id: 'b' })
    igual('el primero guarda su UID', base.mensajes.find((m) => m.asunto === 'Uno')?.uid, 5)
    igual('el segundo, con otro UIDVALIDITY, no', base.mensajes.find((m) => m.asunto === 'Dos')?.uid, null)
  }

  console.log('el servidor SMTP falla: no se guarda nada')
  {
    const base = new BaseFalsa()
    const t = transporteFalso({ falla: Object.assign(new Error('Invalid login: 535 5.7.8 password wrong'), { code: 'EAUTH', responseCode: 535 }) })
    let error: unknown = null
    try {
      await enviarCorreo(deps(base, t, null), base.buzon, entradaBase(), { ahora: AHORA })
    } catch (e) {
      error = e
    }
    ok('lanza un ErrorDeCorreo de credenciales', error instanceof ErrorDeCorreo && error.codigo === 'credenciales', String((error as Error)?.message))
    ok('con una frase fija, sin el texto del servidor', error instanceof Error && !error.message.includes('535') && !error.message.includes('Invalid login'), (error as Error)?.message)
    igual('no queda nada guardado', [base.mensajes.length, base.hilos.length], [0, 0])

    const limite = transporteFalso({ falla: Object.assign(new Error('x'), { responseCode: 550, response: '550 5.4.5 Daily user sending quota exceeded' }) })
    let e2: unknown = null
    try {
      await enviarCorreo(deps(base, limite, null), base.buzon, entradaBase(), { ahora: AHORA })
    } catch (e) {
      e2 = e
    }
    ok('un límite de envíos se reconoce', e2 instanceof ErrorDeCorreo && e2.codigo === 'limite', String((e2 as ErrorDeCorreo)?.codigo))

    const todos = transporteFalso({ aceptados: [], rechazados: ['carmen@cliente.test'] })
    let e3: unknown = null
    try {
      await enviarCorreo(deps(base, todos, null), base.buzon, entradaBase(), { ahora: AHORA })
    } catch (e) {
      e3 = e
    }
    ok('si no se acepta a nadie, es un rechazo', e3 instanceof ErrorDeCorreo && e3.codigo === 'rechazado', String((e3 as ErrorDeCorreo)?.codigo))
    igual('y tampoco se guarda', base.mensajes.length, 0)
  }

  console.log('algunos destinatarios rechazados')
  {
    const base = new BaseFalsa()
    const t = transporteFalso({ aceptados: ['carmen@cliente.test'], rechazados: ['luis@otro.test'] })
    const r = await enviarCorreo(deps(base, t, null), base.buzon, entradaBase({ cc: [LUIS] }), { ahora: AHORA, id: 'parcial' })
    igual('se envía y se guarda', base.mensajes.length, 1)
    igual('se avisa de quién no', r.rechazados, ['luis@otro.test'])
  }

  console.log('una entrada inválida no llega a enviar nada')
  {
    const base = new BaseFalsa()
    const t = transporteFalso()
    let error: unknown = null
    try {
      await enviarCorreo(deps(base, t, null), base.buzon, entradaBase({ para: [] }), { ahora: AHORA })
    } catch (e) {
      error = e
    }
    ok('lanza', error instanceof Error)
    igual('y no se envía', t.enviados.length, 0)
  }

  console.log('lo enviado se reconoce al leer la carpeta Enviados')
  {
    const base = new BaseFalsa()
    const t = transporteFalso()
    // Sin confirmación del servidor: se guarda sin UID
    await enviarCorreo(deps(base, t, { ruta: 'INBOX.Sent', uid: null, uidValidity: null }), base.buzon, entradaBase(), { ahora: AHORA, id: 'enviado-erp' })
    igual('sin UID', base.mensajes[0].uid, null)

    // El servidor lo tiene en Enviados con el mismo Message-ID
    const servidor = new ServidorFalso([
      { path: 'INBOX', uidValidity: 100, mensajes: [] },
      { path: 'INBOX.Sent', specialUse: '\\Sent', uidValidity: 200, mensajes: [{ uid: 4, fecha: AHORA, flags: ['\\Seen'], fuente: t.enviados[0].crudo }] },
    ])
    const r = await leerBuzon(servidor.cliente(), base, base.buzon, { presupuestoMs: 60_000 })
    igual('no se guarda otra copia', [base.mensajes.length, r.importados], [1, 0])
    igual('se le pone su UID', base.mensajes[0].uid, 4)
  }

  console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('ERROR', e)
  process.exit(1)
})
