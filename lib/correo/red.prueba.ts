import { esIpInterna, resolverPublico } from '@/lib/correo/red'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** RED: qué direcciones se aceptan como servidor de correo de un tercero. */

const internas = [
  '127.0.0.1', '127.1.2.3', '0.0.0.0', '10.0.0.5', '10.255.255.255', '172.16.0.1', '172.31.255.254', '192.168.1.1', '169.254.169.254',
  '100.64.0.1', '100.127.255.255', '198.18.0.1', '192.0.2.1', '198.51.100.7', '203.0.113.9', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
  '::', '::1', 'fc00::1', 'fd12:3456:789a::1', 'fe80::1', 'fe80::1%eth0', 'fec0::1', 'ff02::1', '2001:db8::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2',
  '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', '::ffff:7f00:1', '64:ff9b::7f00:1', '64:ff9b::a00:1', '2002:7f00:1::1', '2002:a00:1::',
  'nada', '', '999.1.1.1', '1.2.3', '1.2.3.4.5',
]
for (const ip of internas) ok(`interna: ${ip || '(vacía)'}`, esIpInterna(ip))

const publicas = [
  '8.8.8.8', '1.1.1.1', '34.117.59.81', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '169.253.1.1', '192.167.1.1', '198.17.255.255', '198.20.0.1',
  '223.255.255.255', '2606:4700:4700::1111', '2a00:1450:4003:80f::200e', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::1',
]
for (const ip of publicas) ok(`pública: ${ip}`, !esIpInterna(ip))

async function main() {
  const falso = (respuestas: Record<string, Array<{ address: string; family: number }>>) =>
    (async (host: string) => {
      const r = respuestas[host]
      if (!r) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })
      return r
    }) as unknown as typeof import('node:dns').promises.lookup

  const r1 = await resolverPublico('imap.bueno.es', falso({ 'imap.bueno.es': [{ address: '203.0.114.9', family: 4 }, { address: '2606:4700::1', family: 6 }] }))
  ok('un servidor público: devuelve la IPv4', r1.ok && r1.ip === '203.0.114.9', JSON.stringify(r1))

  const r2 = await resolverPublico('imap.solo6.es', falso({ 'imap.solo6.es': [{ address: '2606:4700::1', family: 6 }] }))
  ok('solo IPv6 pública: la usa', r2.ok && r2.ip === '2606:4700::1', JSON.stringify(r2))

  const r3 = await resolverPublico('interno.es', falso({ 'interno.es': [{ address: '10.0.0.7', family: 4 }] }))
  ok('apunta a una red privada: no', !r3.ok && r3.motivo === 'interna', JSON.stringify(r3))

  const r4 = await resolverPublico('mezcla.es', falso({ 'mezcla.es': [{ address: '203.0.114.9', family: 4 }, { address: '127.0.0.1', family: 4 }] }))
  ok('una pública y una interna: no (podría usarse la interna)', !r4.ok && r4.motivo === 'interna', JSON.stringify(r4))

  const r5 = await resolverPublico('metadatos.es', falso({ 'metadatos.es': [{ address: '169.254.169.254', family: 4 }] }))
  ok('servicio de metadatos de la nube: no', !r5.ok && r5.motivo === 'interna', JSON.stringify(r5))

  const r6 = await resolverPublico('no-existe.es', falso({}))
  ok('no resuelve', !r6.ok && r6.motivo === 'no_resuelve', JSON.stringify(r6))

  const r7 = await resolverPublico('vacio.es', falso({ 'vacio.es': [] }))
  ok('sin direcciones', !r7.ok && r7.motivo === 'no_resuelve', JSON.stringify(r7))

  console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
  process.exit(fallos === 0 ? 0 : 1)
}

main()
