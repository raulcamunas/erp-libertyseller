import { cargaDePush, categoriaValida, esDispositivoMuerto, esReciente, leToca, nombreDeDispositivo, suscripcionValida, urlDeAviso, VENTANA_DE_ENVIO_MS } from '@/lib/push/aviso'

let fallos = 0
let comprobaciones = 0
function igual(nombre: string, real: unknown, esperado: unknown) {
  comprobaciones += 1
  const a = JSON.stringify(real)
  const b = JSON.stringify(esperado)
  const bien = a === b
  if (!bien) fallos += 1
  console.log(`  ${bien ? 'OK  ' : 'MAL '}  ${nombre}${bien ? '' : ` → ${a}, esperaba ${b}`}`)
}
const C = '11111111-1111-4111-8111-111111111111'
const T = '22222222-2222-4222-8222-222222222222'
const n = (type: string, datos: unknown = null, extra: object = {}) => ({ type, datos, related_client_id: null, ...extra })

igual('una tarea abre su tablero con la tarea', urlDeAviso(n('task_assigned', { app: 'tareas-clientes', clienteId: C, tareaId: T })), `/dashboard/tareas-clientes/${C}?tarea=${T}`)
igual('sin tarea, el cliente', urlDeAviso(n('task_updated', { app: 'tareas-clientes', clienteId: C })), `/dashboard/tareas-clientes/${C}`)
igual('un id raro no se mete en la dirección', urlDeAviso(n('task_updated', { app: 'tareas-clientes', clienteId: '../x', tareaId: T })), '/dashboard/tareas-clientes/mi-dia')
igual('el resto de tipos como la campana', [urlDeAviso(n('web_lead')), urlDeAviso(n('freno_stock')), urlDeAviso(n('alarma_correo')), urlDeAviso(n('fba_alerta')), urlDeAviso(n('otro'))], ['/dashboard/web-leads', '/dashboard/amazon-api', '/dashboard/correo', '/dashboard/remesas/alertas', '/dashboard'])
igual('con cliente de CRM', urlDeAviso(n('otro', null, { related_client_id: 'abc' })), '/dashboard/clients/abc')

igual('«tareas» solo deja pasar lo de tareas', [leToca('tareas', n('task_assigned')), leToca('tareas', n('otro', { app: 'tareas-clientes' })), leToca('tareas', n('correo_nuevo')), leToca('todo', n('correo_nuevo'))], [true, true, false, true])
igual('categoría desconocida = tareas', [categoriaValida('todo'), categoriaValida('x'), categoriaValida(undefined)], ['todo', 'tareas', 'tareas'])

const c = cargaDePush({ id: 'a1', type: 'mention', title: 'x'.repeat(200), message: 'y'.repeat(400), datos: { app: 'tareas-clientes', clienteId: C }, read: false, created_at: '2026-11-08T10:00:00Z' })
igual('el texto se recorta y la etiqueta es la dirección a la que lleva', [c.titulo.length, c.cuerpo.length, c.etiqueta === c.url, c.url], [80, 160, true, `/dashboard/tareas-clientes/${C}`])
igual('sin título, el nombre de la app', cargaDePush({ id: 'a2', type: 'x', title: '  ', message: null, datos: null, read: false, created_at: '' }).titulo, 'Liberty Seller Hub')

const ahora = Date.parse('2026-11-08T10:30:00Z')
igual('solo avisos recientes', [esReciente({ created_at: '2026-11-08T10:25:00Z' }, ahora), esReciente({ created_at: new Date(ahora - VENTANA_DE_ENVIO_MS - 1000).toISOString() }, ahora)], [true, false])

const ok = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } }
igual('suscripción buena', suscripcionValida(ok), ok)
igual('suscripciones malas', [suscripcionValida(null), suscripcionValida({ ...ok, endpoint: 'http://x.es' }), suscripcionValida({ ...ok, keys: { p256dh: 'no valido!', auth: 'tBHItJI5svbpez7KI4CCXg' } }), suscripcionValida({ endpoint: ok.endpoint }), suscripcionValida({ ...ok, endpoint: `https://x.es/${'a'.repeat(1100)}` })], [null, null, null, null, null])
igual('dispositivo muerto', [esDispositivoMuerto(410), esDispositivoMuerto(404), esDispositivoMuerto(500), esDispositivoMuerto(undefined)], [true, true, false, false])
igual('nombre del dispositivo', [nombreDeDispositivo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Safari/604.1'), nombreDeDispositivo('Mozilla/5.0 (Windows NT 10) Chrome/120 Safari/537'), nombreDeDispositivo(null)], ['iPhone · Safari', 'Windows · Chrome', 'Dispositivo'])

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
