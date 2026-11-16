import { leerPeticionDeHilo, modoDePeticionDeHilo, validarPeticionDeHilo } from '@/lib/correo/peticion-hilo'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const igual = (n: string, real: unknown, esperado: unknown) => ok(n, JSON.stringify(real) === JSON.stringify(esperado), `${JSON.stringify(real)} (esperaba ${JSON.stringify(esperado)})`)

const P = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const no = { esEncargada: false }
const si = { esEncargada: true }
const modo = (campos: Record<string, unknown>, ctx = no) => {
  const r = modoDePeticionDeHilo(campos, ctx)
  return r.ok ? r.modo : 'error'
}

console.log('\n1. Un campo')
{
  igual('silenciado: leer (es personal)', modo({ silenciado: '8h' }), 'leer')
  igual('silenciarRemitente: leer', modo({ silenciarRemitente: 'siempre' }), 'leer')
  igual('leido: responder', modo({ leido: true }), 'responder')
  igual('destacado: responder', modo({ destacado: false }), 'responder')
  igual('asignar: admin-o-responder', modo({ asignar: { personaId: P } }), 'admin-o-responder')
  igual('hecho siendo la encargada: leer', modo({ hecho: true }, si), 'leer')
  igual('hecho sin serlo: responder', modo({ hecho: true }, no), 'responder')
}

console.log('\n2. Varios campos: el más exigente; personal con buzón: error')
{
  igual('{silenciado, leido} → error', modo({ silenciado: '8h', leido: true }), 'error')
  igual('{silenciarRemitente, asignar} → error', modo({ silenciarRemitente: 'quitar', asignar: { personaId: null } }), 'error')
  igual('{silenciado, silenciarRemitente} → leer', modo({ silenciado: '8h', silenciarRemitente: 'semana' }), 'leer')
  igual('{asignar, leido} → responder', modo({ asignar: { personaId: P }, leido: true }), 'responder')
  igual('{asignar, hecho} siendo encargada → admin-o-responder', modo({ asignar: { personaId: P }, hecho: true }, si), 'admin-o-responder')
  igual('{hecho, destacado} siendo encargada → responder', modo({ hecho: true, destacado: true }, si), 'responder')
  igual('nada → error', modo({}), 'error')
  igual('campos a undefined cuentan como ausentes', modo({ leido: undefined, silenciado: '8h' }), 'leer')
}

console.log('\n3. Validar el cuerpo')
{
  igual('bueno, con la nota recortada e id en minúsculas', validarPeticionDeHilo({ asignar: { personaId: P.toUpperCase(), nota: '  llámale  ' }, otro: 1 }), {
    ok: true,
    campos: { asignar: { personaId: P, nota: 'llámale' } },
  })
  ok('desasignar (personaId null)', validarPeticionDeHilo({ asignar: { personaId: null } }).ok)
  ok('leido que no es booleano', !validarPeticionDeHilo({ leido: 'sí' }).ok)
  ok('duración inventada', !validarPeticionDeHilo({ silenciado: '2h' }).ok)
  ok('persona que no es UUID', !validarPeticionDeHilo({ asignar: { personaId: 'ana' } }).ok)
  ok('nota de 281 caracteres', !validarPeticionDeHilo({ asignar: { personaId: P, nota: 'x'.repeat(281) } }).ok)
  ok('sin cuerpo', !validarPeticionDeHilo(null).ok)
  const r = leerPeticionDeHilo({ silenciado: 'manana', leido: true }, no)
  ok('leerPeticionDeHilo: {silenciado, leido} → error 400 (la ruta no llega a marcar leído)', !r.ok)
  const b = leerPeticionDeHilo({ leido: false }, no)
  ok('leerPeticionDeHilo: {leido} → responder', b.ok && b.modo === 'responder')
}

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
