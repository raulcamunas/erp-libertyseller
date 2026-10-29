import { ENTRE_LECTURAS_MS, fraseDeBuzonDesconectado, fraseDeContrasenaRechazada, leidoHaceNada } from '@/lib/correo/sincronizar-regla'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const AHORA = Date.parse('2026-10-29T10:00:00.000Z')
const hace = (ms: number) => new Date(AHORA - ms).toISOString()

console.log('\n=== «leído hace nada»: no se vuelve a preguntar al servidor de correo ===')
{
  ok('el tope es de 15 segundos', ENTRE_LECTURAS_MS === 15_000)
  ok('un intento de hace 5 s, con el histórico completo: ya está al día', leidoHaceNada({ historico_completo: true, ultimo_intento_at: hace(5_000) }, AHORA))
  ok('justo en el límite ya toca volver a mirar', !leidoHaceNada({ historico_completo: true, ultimo_intento_at: hace(15_000) }, AHORA) && leidoHaceNada({ historico_completo: true, ultimo_intento_at: hace(14_999) }, AHORA))
  ok('uno de hace 20 s toca', !leidoHaceNada({ historico_completo: true, ultimo_intento_at: hace(20_000) }, AHORA))
  ok('con el histórico a medias nunca cuenta: la importación sigue', !leidoHaceNada({ historico_completo: false, ultimo_intento_at: hace(1_000) }, AHORA))
  ok('nunca intentado: toca', !leidoHaceNada({ historico_completo: true, ultimo_intento_at: null }, AHORA))
  ok('una fecha que no se entiende no bloquea nada', !leidoHaceNada({ historico_completo: true, ultimo_intento_at: 'ayer' }, AHORA))
}

console.log('\n=== lo que se le dice a quien pide la lectura ===')
{
  const dueno = fraseDeContrasenaRechazada(true)
  const otro = fraseDeContrasenaRechazada(false)
  ok('el dueño oye que vuelva a escribir su contraseña', /Vuelve a escribirla/.test(dueno))
  ok('quien supervisa oye que es cosa del dueño, no que la escriba él', /su dueño/i.test(otro) && !/Vuelve a escribirla/.test(otro))
  ok('lo mismo con un buzón desconectado', /Vuelve a conectarlo/.test(fraseDeBuzonDesconectado(true)) && /su dueño/i.test(fraseDeBuzonDesconectado(false)) && !/Vuelve a conectarlo/.test(fraseDeBuzonDesconectado(false)))
  ok('ninguna frase lleva direcciones ni contraseñas', ![dueno, otro, fraseDeBuzonDesconectado(true), fraseDeBuzonDesconectado(false)].some((f) => /@|password/i.test(f)))
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
