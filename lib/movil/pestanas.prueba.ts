import { elegirPestanas, ORDEN_POR_DEFECTO } from '@/lib/movil/pestanas'
import type { Uso } from '@/lib/movil/uso'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const T0 = Date.UTC(2026, 10, 1)
const j = (x: unknown) => JSON.stringify(x)
const ADMIN = ['home', 'web-leads', 'agenda', 'crm', 'cold-calling', 'rendimiento', 'correo', 'facturacion', 'remesas', 'chat', 'tareas-clientes']

console.log('\n=== sin historial ===')
{
  const r = elegirPestanas({ visibles: ADMIN, uso: {}, fijadas: [], rol: 'admin', ahora: T0 })
  ok('el orden de siempre', j(r) === j(['cold-calling', 'correo', 'agenda', 'chat']), j(r))
  const emp = elegirPestanas({ visibles: ['home', 'horas', 'vacaciones', 'correo'], uso: {}, fijadas: [], rol: 'employee', ahora: T0 })
  ok('cruzado con lo que ve, y después el orden del menú', j(emp) === j(['correo', 'horas', 'vacaciones']), j(emp))
  ok('nunca Inicio', !elegirPestanas({ visibles: ['home', 'a'], uso: {}, fijadas: ['home'], rol: 'employee', ahora: T0 }).includes('home'))
  ok('si ve menos de tres, las que haya', j(elegirPestanas({ visibles: ['home', 'horas'], uso: {}, fijadas: [], rol: 'employee', ahora: T0 })) === j(['horas']))
  ok('un cliente no tiene barra', elegirPestanas({ visibles: ['remesas'], uso: {}, fijadas: [], rol: 'cliente', ahora: T0 }).length === 0)
  ok('el orden por defecto empieza por Cold Calling', ORDEN_POR_DEFECTO[0] === 'cold-calling')
}

console.log('\n=== con uso y fijadas ===')
{
  const uso: Uso = { facturacion: { n: 9, t: T0 }, remesas: { n: 4, t: T0 }, crm: { n: 1, t: T0 } }
  ok('las más usadas', j(elegirPestanas({ visibles: ADMIN, uso, fijadas: [], rol: 'admin', ahora: T0 })) === j(['facturacion', 'remesas', 'crm', 'cold-calling']))
  ok('las fijadas mandan', j(elegirPestanas({ visibles: ADMIN, uso, fijadas: ['chat'], rol: 'admin', ahora: T0 })) === j(['chat', 'facturacion', 'remesas', 'crm']))
  ok('una fijada que ya no ve no cuenta', j(elegirPestanas({ visibles: ADMIN, uso, fijadas: ['tesoreria'], rol: 'admin', ahora: T0 })) === j(['facturacion', 'remesas', 'crm', 'cold-calling']))
  const pocas: Uso = { remesas: { n: 2, t: T0 } }
  ok('si hay poco uso se completa con el orden de siempre', j(elegirPestanas({ visibles: ADMIN, uso: pocas, fijadas: [], rol: 'admin', ahora: T0 })) === j(['remesas', 'cold-calling', 'correo', 'agenda']))
}

console.log('\n=== congeladas durante la sesión ===')
{
  const uso: Uso = { facturacion: { n: 9, t: T0 } }
  ok('se respetan aunque el uso diga otra cosa', j(elegirPestanas({ visibles: ADMIN, uso, fijadas: [], rol: 'admin', ahora: T0, congeladas: ['correo', 'agenda', 'crm', 'chat'] })) === j(['correo', 'agenda', 'crm', 'chat']))
  ok('si una ya no se ve, se recalcula', j(elegirPestanas({ visibles: ADMIN, uso, fijadas: [], rol: 'admin', ahora: T0, congeladas: ['correo', 'agenda', 'tesoreria', 'chat'] })) === j(['facturacion', 'cold-calling', 'correo', 'agenda']))
  ok('si falta una fijada, se recalcula', elegirPestanas({ visibles: ADMIN, uso, fijadas: ['chat'], rol: 'admin', ahora: T0, congeladas: ['correo', 'agenda', 'crm', 'remesas'] })[0] === 'chat')
  ok('si son de menos (aún cargaban los permisos), se recalcula', elegirPestanas({ visibles: ADMIN, uso: {}, fijadas: [], rol: 'admin', ahora: T0, congeladas: ['correo'] }).length === 4)
  ok('con repetidas, se recalcula', j(elegirPestanas({ visibles: ADMIN, uso: {}, fijadas: [], rol: 'admin', ahora: T0, congeladas: ['correo', 'correo', 'crm', 'chat'] })) === j(['cold-calling', 'correo', 'agenda', 'chat']))
}

console.log('\n=== a medida ===')
{
  const uso: Uso = { facturacion: { n: 9, t: T0 } }
  ok('solo las mías: exactamente las elegidas, en su orden', j(elegirPestanas({ visibles: ADMIN, uso, fijadas: ['crm', 'chat'], rol: 'admin', ahora: T0, soloFijadas: true })) === j(['crm', 'chat']))
  ok('reordenar las fijadas cambia la barra congelada', j(elegirPestanas({ visibles: ADMIN, uso, fijadas: ['chat', 'crm'], rol: 'admin', ahora: T0, congeladas: ['crm', 'chat', 'facturacion', 'correo'] }).slice(0, 2)) === j(['chat', 'crm']))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
