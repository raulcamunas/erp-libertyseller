import { borradorDe } from '@/lib/correo/redactar'
import type { MensajeDeHilo } from '@/lib/correo/tipos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const igual = (n: string, real: unknown, esperado: unknown) => ok(n, JSON.stringify(real) === JSON.stringify(esperado), `real ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`)

/** REDACTAR: el borrador al responder, responder a todos y reenviar. */

const YO = { miDireccion: 'ana@liberty.test', firma: null as string | null }

const mensaje = (extra: Partial<MensajeDeHilo> = {}): MensajeDeHilo => ({
  id: 'm1',
  direccion: 'entrante',
  deNombre: 'Carmen Ruiz',
  deDireccion: 'carmen@cliente.test',
  para: [{ nombre: 'Ana', direccion: 'ana@liberty.test' }],
  cc: [],
  responderA: [],
  asunto: 'Interés en la propuesta',
  fecha: '2026-10-21T08:00:00.000Z',
  texto: 'Hola',
  html: null,
  adjuntos: [],
  leido: true,
  automatico: false,
  messageId: 'm1@cliente.test',
  ...extra,
})

console.log('nuevo')
igual('vacío', borradorDe('nuevo', null, YO), { modo: 'nuevo', para: '', cc: '', asunto: '', texto: '', respondeA: null, conCita: false })
igual('con firma', borradorDe('nuevo', null, { ...YO, firma: 'Ana\nLiberty Seller' }).texto, '\n\nAna\nLiberty Seller')

console.log('responder')
{
  const b = borradorDe('responder', mensaje(), YO)
  igual('a quien lo envió', b.para, 'Carmen Ruiz <carmen@cliente.test>')
  igual('con Re:', b.asunto, 'Re: Interés en la propuesta')
  igual('cuelga del mensaje', [b.respondeA, b.conCita], ['m1', true])
  igual('sin copia', b.cc, '')
}
igual('no apila Re:', borradorDe('responder', mensaje({ asunto: 'Re: Hola' }), YO).asunto, 'Re: Hola')
igual('a Reply-To si lo hay (formulario web)', borradorDe('responder', mensaje({ deNombre: 'Mi Web', deDireccion: 'web@liberty.test', responderA: [{ nombre: 'Lead', direccion: 'lead@tienda.test' }] }), YO).para, 'Lead <lead@tienda.test>')
igual('si lo enviamos nosotros, a sus destinatarios', borradorDe('responder', mensaje({ direccion: 'saliente', deNombre: 'Ana', deDireccion: 'ana@liberty.test', para: [{ nombre: 'Carmen Ruiz', direccion: 'carmen@cliente.test' }] }), YO).para, 'Carmen Ruiz <carmen@cliente.test>')
igual('con firma', borradorDe('responder', mensaje(), { ...YO, firma: 'Ana' }).texto, '\n\nAna')
igual('si Reply-To soy yo, no me escribo a mí', borradorDe('responder', mensaje({ responderA: [{ nombre: '', direccion: 'ana@liberty.test' }] }), YO).para, 'ana@liberty.test')

console.log('responder a todos')
{
  const m = mensaje({
    para: [{ nombre: 'Ana', direccion: 'ana@liberty.test' }, { nombre: 'Bea', direccion: 'bea@liberty.test' }],
    cc: [{ nombre: '', direccion: 'luis@otro.test' }, { nombre: '', direccion: 'carmen@cliente.test' }, { nombre: '', direccion: 'bea@liberty.test' }],
  })
  const b = borradorDe('responder-todos', m, YO)
  igual('Para: quien lo envió', b.para, 'Carmen Ruiz <carmen@cliente.test>')
  igual('Cc: los demás, sin mí, sin repetir y sin quien ya está en Para', b.cc, 'Bea <bea@liberty.test>, luis@otro.test')
}
igual('responder simple no copia a nadie', borradorDe('responder', mensaje({ cc: [{ nombre: '', direccion: 'luis@otro.test' }] }), YO).cc, '')
igual('mayúsculas en mi dirección', borradorDe('responder-todos', mensaje({ para: [{ nombre: '', direccion: 'ana@liberty.test' }, { nombre: '', direccion: 'bea@liberty.test' }] }), { ...YO, miDireccion: 'Ana@Liberty.test' }).cc, 'bea@liberty.test')

console.log('reenviar')
{
  const b = borradorDe('reenviar', mensaje(), YO)
  igual('sin destinatarios', [b.para, b.cc], ['', ''])
  igual('con Fwd:', b.asunto, 'Fwd: Interés en la propuesta')
  igual('cuelga del mensaje para citarlo', [b.respondeA, b.conCita], ['m1', true])
}
igual('no apila Fwd:', borradorDe('reenviar', mensaje({ asunto: 'Fwd: Hola' }), YO).asunto, 'Fwd: Hola')

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
