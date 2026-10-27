import { aplanarMenu, armarMenu, grupoDeLaRuta, rutaParaElMenu, type GrupoParaElMenu } from '@/lib/layout/menu'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

interface App {
  id: string
  route: string
}
const app = (id: string): App => ({ id, route: `/dashboard/${id}` })

// El registro de siempre, en su orden
const TODAS = ['home', 'briefing', 'web-leads', 'agenda', 'commissions', 'cold-calling', 'horas', 'rendimiento', 'correo', 'tesoreria', 'empleados', 'entrais-test', 'marketing-ads', 'amazon-api', 'growth', 'remesas', 'telefonos', 'users', 'tax-reports', 'contenido'].map(app)

interface Grupo extends GrupoParaElMenu {
  name: string
}
const GRUPOS: Grupo[] = [
  { id: 'contabilidad', name: 'Contabilidad', apps: ['tesoreria', 'empleados', 'commissions', 'tax-reports'], despuesDe: 'correo' },
  { id: 'herramientas-agencia', name: 'Herramientas Agencia', apps: ['telefonos', 'remesas', 'growth', 'amazon-api', 'marketing-ads', 'entrais-test'], despuesDe: 'correo' },
]

const resumen = (menu: ReturnType<typeof armarMenu<App, Grupo>>) => menu.map((e) => (e.tipo === 'app' ? e.app.id : `[${e.grupo.id}: ${e.apps.map((a) => a.id).join(',')}]`)).join(' · ')
const sin = (...ids: string[]) => TODAS.filter((a) => !ids.includes(a.id))
const solo = (...ids: string[]) => TODAS.filter((a) => ids.includes(a.id))

console.log('\n=== un administrador ve los dos desplegables, detrás de Correo ===')
{
  const m = armarMenu(TODAS, GRUPOS)
  const r = resumen(m)
  ok(
    'el menú queda: lo de siempre, los dos grupos detrás de Correo y lo demás',
    r === 'home · briefing · web-leads · agenda · cold-calling · horas · rendimiento · correo · [contabilidad: tesoreria,empleados,commissions,tax-reports] · [herramientas-agencia: telefonos,remesas,growth,amazon-api,marketing-ads,entrais-test] · users · contenido',
    r
  )
  ok('las aplicaciones de dentro salen en el orden del grupo, no en el del registro', m.find((e) => e.tipo === 'grupo' && e.grupo.id === 'herramientas-agencia') !== undefined && resumen(m).includes('telefonos,remesas,growth,amazon-api,marketing-ads,entrais-test'))
  ok('ninguna aplicación sale dos veces ni se pierde', aplanarMenu(m).length === TODAS.length && new Set(aplanarMenu(m).map((a) => a.id)).size === TODAS.length)
  ok('dos grupos detrás de la misma aplicación se quedan en el orden en que se declaran', r.indexOf('[contabilidad') < r.indexOf('[herramientas-agencia'))
}

console.log('\n=== un grupo con una sola aplicación visible no se despliega ===')
{
  const m = armarMenu(solo('home', 'cold-calling', 'correo', 'tesoreria', 'telefonos'), GRUPOS)
  const r = resumen(m)
  ok('Tesorería sola sale suelta, en su sitio, y Teléfonos también', r === 'home · cold-calling · correo · tesoreria · telefonos', r)
}

console.log('\n=== con dos o más sí ===')
{
  const m = armarMenu(solo('home', 'cold-calling', 'correo', 'tesoreria', 'tax-reports', 'telefonos'), GRUPOS)
  const r = resumen(m)
  ok('Contabilidad con dos sale como grupo detrás de Correo; Teléfonos, suelto', r === 'home · cold-calling · correo · [contabilidad: tesoreria,tax-reports] · telefonos', r)
}

console.log('\n=== sin la aplicación a la que se pega, va donde tocaba a su primera ===')
{
  const m = armarMenu(solo('home', 'cold-calling', 'tesoreria', 'empleados', 'users', 'contenido'), GRUPOS)
  const r = resumen(m)
  ok('sin Correo, el grupo sale donde estaría Tesorería: antes de Gestión de Usuarios', r === 'home · cold-calling · [contabilidad: tesoreria,empleados] · users · contenido', r)
  const m2 = armarMenu(solo('home', 'telefonos', 'remesas', 'users'), GRUPOS)
  ok('y si todo es del grupo, el grupo ocupa su sitio entre lo demás', resumen(m2) === 'home · [herramientas-agencia: telefonos,remesas] · users', resumen(m2))
}

console.log('\n=== sin nada del grupo, el grupo no existe ===')
{
  const m = armarMenu(solo('home', 'cold-calling', 'correo'), GRUPOS)
  ok('ni rastro de los grupos', resumen(m) === 'home · cold-calling · correo')
  ok('un menú vacío es un menú vacío', armarMenu([], GRUPOS).length === 0)
  ok('sin grupos todo sigue como estaba', resumen(armarMenu(TODAS, [])) === TODAS.map((a) => a.id).join(' · '))
}

console.log('\n=== qué grupo contiene la página en la que se está ===')
{
  const m = armarMenu(TODAS, GRUPOS)
  ok('Tesorería está en Contabilidad', grupoDeLaRuta(m, '/dashboard/tesoreria') === 'contabilidad')
  ok('Amazon API, en Herramientas Agencia', grupoDeLaRuta(m, '/dashboard/amazon-api') === 'herramientas-agencia')
  ok('Correo no es de ningún grupo', grupoDeLaRuta(m, '/dashboard/correo') === null)
  ok('sin ruta, ninguno', grupoDeLaRuta(m, null) === null)
  const sola = armarMenu(solo('home', 'tesoreria'), GRUPOS)
  ok('una aplicación que se quedó suelta no cuenta como de un grupo', grupoDeLaRuta(sola, '/dashboard/tesoreria') === null)
}

console.log('\n=== las pantallas que cuelgan de otra ===')
{
  ok('Actividad del equipo enciende Mi rendimiento', rutaParaElMenu('/dashboard/actividad') === '/dashboard/rendimiento')
  ok('también con lo que va detrás y con la dirección completa', rutaParaElMenu('/dashboard/actividad?dia=2026-10-27') === '/dashboard/rendimiento' && rutaParaElMenu('/dashboard/actividad/') === '/dashboard/rendimiento')
  ok('lo demás no cambia', rutaParaElMenu('/dashboard/rendimiento') === '/dashboard/rendimiento' && rutaParaElMenu('/dashboard/actividades') === '/dashboard/actividades' && rutaParaElMenu('/dashboard/correo') === '/dashboard/correo')
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
