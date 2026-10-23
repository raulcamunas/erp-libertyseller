import { mensajeDeErrorDeAcceso } from '@/lib/inicio/acceso'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== el aviso de un inicio de sesión fallido ===')
{
  ok('credenciales malas', mensajeDeErrorDeAcceso('Invalid login credentials') === 'El email o la contraseña no son correctos.')
  ok('en mayúsculas o con algo más alrededor también', mensajeDeErrorDeAcceso('AuthApiError: INVALID LOGIN CREDENTIALS (400)') === 'El email o la contraseña no son correctos.')
  ok('email sin confirmar', mensajeDeErrorDeAcceso('Email not confirmed') === 'Tu email todavía no está confirmado.')
  ok('demasiados intentos, de las dos maneras en que llega', mensajeDeErrorDeAcceso('Email rate limit exceeded').startsWith('Demasiados intentos') && mensajeDeErrorDeAcceso('Too many requests').startsWith('Demasiados intentos'))
  ok('uno que no se conoce sale tal cual', mensajeDeErrorDeAcceso('Database error saving new user') === 'Database error saving new user')
  ok('sin mensaje, el de siempre', mensajeDeErrorDeAcceso('') === 'Error al iniciar sesión' && mensajeDeErrorDeAcceso(null) === 'Error al iniciar sesión' && mensajeDeErrorDeAcceso(undefined) === 'Error al iniciar sesión')
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
