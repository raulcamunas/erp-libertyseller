import { elegirMiBuzon } from '@/lib/correo/mi-buzon'
import type { BuzonVisible } from '@/lib/correo/tipos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const buzon = (id: string, extra: Partial<BuzonVisible> = {}): BuzonVisible => ({
  id,
  direccion: `${id}@agencia.es`,
  nombre: id,
  proveedor: 'hostinger',
  propietario: { id: `u-${id}`, nombre: id },
  esMio: true,
  conectado: true,
  credencialesInvalidas: false,
  ultimoSyncAt: null,
  ultimoError: null,
  historicoCompleto: true,
  desdeFecha: '2026-08-01T00:00:00Z',
  firma: null,
  resumen: { hilos: 0, hilosSinLeer: 0, sinLeer: 0, esperandoRespuesta: 0, ultimoMensajeAt: null },
  ...extra,
})

console.log('\n=== elegirMiBuzon ===')
{
  const r = elegirMiBuzon([buzon('ana')])
  ok('mi buzón conectado: listo', r.tipo === 'listo' && r.buzon.id === 'ana')
  ok('sin ningún buzón: sin-buzon', elegirMiBuzon([]).tipo === 'sin-buzon')
  const ajenos = elegirMiBuzon([buzon('luis', { esMio: false }), buzon('eva', { esMio: false })])
  ok('quien supervisa ve los de otros pero NUNCA escribe desde ellos', ajenos.tipo === 'sin-buzon')
  const mezcla = elegirMiBuzon([buzon('luis', { esMio: false }), buzon('ana'), buzon('eva', { esMio: false })])
  ok('entre los de otros, elige el propio', mezcla.tipo === 'listo' && mezcla.buzon.id === 'ana')
  const sinConectar = elegirMiBuzon([buzon('ana', { conectado: false })])
  ok('uno propio sin contraseña guardada: sin-buzon', sinConectar.tipo === 'sin-buzon')
  const roto = elegirMiBuzon([buzon('ana', { credencialesInvalidas: true })])
  ok('uno propio con la contraseña rechazada: credenciales, con su dirección', roto.tipo === 'credenciales' && roto.direccion === 'ana@agencia.es')
  const unoBuenoYUnoRoto = elegirMiBuzon([buzon('ana', { credencialesInvalidas: true }), buzon('ana2')])
  ok('si hay uno bueno y otro roto, gana el bueno', unoBuenoYUnoRoto.tipo === 'listo' && unoBuenoYUnoRoto.buzon.id === 'ana2')
  const conFirma = elegirMiBuzon([buzon('ana', { firma: 'Ana\nLiberty Seller' })])
  ok('lleva la firma del buzón', conFirma.tipo === 'listo' && conFirma.buzon.firma === 'Ana\nLiberty Seller')
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
