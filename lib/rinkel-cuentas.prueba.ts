/** npx tsx lib/rinkel-cuentas.prueba.ts */
import { randomBytes } from 'crypto'
import { cifrarClave, descifrarClave, validarCuenta } from './rinkel-cuentas'

let fallos = 0
const ok = (n: string, a: unknown, b: unknown) => {
  const bien = JSON.stringify(a) === JSON.stringify(b)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK  ' : 'FALLA'} ${n}${bien ? '' : ` -> ${JSON.stringify(a)}`}`)
}

process.env.AMAZON_TOKEN_KEY = randomBytes(32).toString('base64')
const c = cifrarClave('Sup3r-clave/ñ')
ok('cifra y descifra', descifrarClave(c), 'Sup3r-clave/ñ')
ok('el cifrado no lleva la clave', c.includes('Sup3r'), false)
ok('alta sin correo', validarCuenta({ email: 'x' }, true).ok, false)
ok('alta válida', validarCuenta({ email: 'a@b.com', clave: 'x' }, true), { ok: true, email: 'a@b.com', clave: 'x' })
ok('edición sin clave no la toca', 'clave' in (validarCuenta({ notas: 'hola' }, false) as object), false)
ok('clave vacía = quitarla', (validarCuenta({ clave: '' }, false) as { clave?: string }).clave, '')
console.log(fallos ? `\n  ${fallos} FALLOS` : '\n  TODO CORRECTO')
if (fallos) process.exit(1)
