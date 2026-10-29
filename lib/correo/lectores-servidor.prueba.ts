import { crearBaseFalsa } from '@/lib/mcp/comercial/base-falsa'
import { decidirAcceso } from '@/lib/correo/acceso'
import {
  FALTA_MIGRACION_BLOQUEOS,
  FALTA_MIGRACION_LECTORES,
  FaltaMigracionDeBloqueos,
  FaltaMigracionDeLectores,
  buzonesBloqueadosA,
  buzonesConcedidosA,
  cambiarLectores,
  leerDatosDeLaMatriz,
} from '@/lib/correo/lectores-servidor'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ANA = id(1), BEA = id(2), CONTA = id(3), RAUL = id(4), JHANNA = id(5), SOCIO = id(6)
const B_ANA = id(101), B_BEA = id(102), B_CONTA = id(103), B_RAUL = id(104)

const datos = () => ({
  profiles: [
    { id: ANA, full_name: 'Ana', email: 'ana@l.es', role: 'employee', is_comercial: true, puesto: 'comercial' },
    { id: BEA, full_name: 'Bea', email: 'bea@l.es', role: 'employee', is_comercial: true, puesto: 'comercial' },
    { id: CONTA, full_name: 'Conta', email: 'conta@l.es', role: 'employee', is_comercial: false, puesto: 'gestion_administrativa' },
    { id: RAUL, full_name: 'Raúl', email: 'raul@l.es', role: 'admin', is_comercial: false, puesto: null },
    { id: JHANNA, full_name: 'Jhanna', email: 'jhanna@l.es', role: 'employee', is_comercial: false, puesto: 'manager_comercial' },
    { id: SOCIO, full_name: 'Socio', email: 'socio@l.es', role: 'partner', is_comercial: false, puesto: null },
  ],
  correo_buzones: [
    { id: B_ANA, user_id: ANA, direccion: 'ana@l.es', nombre: null },
    { id: B_BEA, user_id: BEA, direccion: 'bea@l.es', nombre: null },
    { id: B_CONTA, user_id: CONTA, direccion: 'conta@l.es', nombre: null },
    { id: B_RAUL, user_id: RAUL, direccion: 'raul@l.es', nombre: null },
  ],
  user_app_permissions: [
    { user_id: JHANNA, app_id: 'correo', can_access: true },
    { user_id: CONTA, app_id: 'correo', can_access: true },
    { user_id: ANA, app_id: 'correo', can_access: true },
    { user_id: BEA, app_id: 'correo', can_access: true },
  ],
  correo_buzon_lectores: [] as Array<Record<string, unknown>>,
  correo_buzon_lectores_historial: [] as Array<Record<string, unknown>>,
  correo_buzon_bloqueos: [] as Array<Record<string, unknown>>,
})
const nueva = (extra: Record<string, unknown[] | null> = {}) =>
  crearBaseFalsa({ ...datos(), ...extra } as never, { unicos: { correo_buzon_lectores: ['buzon_id', 'lector_id'], correo_buzon_bloqueos: ['buzon_id', 'lector_id'] } })

async function main() {
  console.log('\n=== sin la migración nada se rompe ===')
  {
    const b = nueva({ correo_buzon_lectores: null, correo_buzon_lectores_historial: null })
    ok('quien pide no tiene ningún buzón abierto (y no falla)', (await buzonesConcedidosA(b.servicio, JHANNA)).size === 0)
    let capturado: unknown = null
    try {
      await leerDatosDeLaMatriz(b.servicio)
    } catch (e) {
      capturado = e
    }
    ok('la pantalla «Quién ve qué» lo dice con el nombre del fichero', capturado instanceof FaltaMigracionDeLectores && /255_correo_lectores_por_buzon/.test(FALTA_MIGRACION_LECTORES))
    const r = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: B_ANA, leer: true }] }).catch((e) => e)
    ok('y cambiar tampoco rompe: avisa de la migración', r instanceof Error && r instanceof FaltaMigracionDeLectores)
  }

  console.log('\n=== abrir un buzón ===')
  {
    const b = nueva()
    const r = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: B_ANA, leer: true }, { buzonId: B_BEA, leer: true }] })
    ok('se abren dos', r.ok && r.concedidos === 2 && r.quitados === 0 && r.rechazados.length === 0)
    ok('quedan en la tabla con quién los abrió', b.tablas.get('correo_buzon_lectores')!.length === 2 && b.tablas.get('correo_buzon_lectores')!.every((f) => f.concedido_por === RAUL && f.lector_id === JHANNA))
    const h = b.tablas.get('correo_buzon_lectores_historial')!
    ok('y en el historial con los nombres copiados', h.length === 2 && h.every((x) => x.accion === 'concedido' && x.lector_nombre === 'Jhanna' && x.hecho_por_nombre === 'Raúl') && h.map((x) => x.buzon_direccion).sort().join() === 'ana@l.es,bea@l.es')
    const concedidos = await buzonesConcedidosA(b.servicio, JHANNA)
    ok('quien pide lo ve en seguida', concedidos.has(B_ANA) && concedidos.has(B_BEA) && concedidos.size === 2)
    // Y la regla de verdad lo respeta
    const quien = { userId: JHANNA, role: 'employee', tienePermisoEquipo: false, tienePermisoCorreo: false, buzonesConcedidos: concedidos }
    ok('Jhanna lee el de Ana y el de Bea', decidirAcceso(quien, { user_id: ANA, id: B_ANA }, { is_comercial: true, role: 'employee' }, 'leer').ok && decidirAcceso(quien, { user_id: BEA, id: B_BEA }, { is_comercial: true, role: 'employee' }, 'leer').ok)
    ok('pero no el administrativo ni el de Raúl', !decidirAcceso(quien, { user_id: CONTA, id: B_CONTA }, { is_comercial: false, role: 'employee' }, 'leer').ok && !decidirAcceso(quien, { user_id: RAUL, id: B_RAUL }, { is_comercial: false, role: 'admin' }, 'leer').ok)
    const otra = await buzonesConcedidosA(b.servicio, ANA)
    ok('lo de Jhanna no es de nadie más', otra.size === 0)
  }

  console.log('\n=== repetir y cerrar ===')
  {
    const b = nueva()
    await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: B_ANA, leer: true }] })
    const otra = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: B_ANA, leer: true }] })
    ok('abrir uno ya abierto no hace nada ni deja rastro', otra.ok && otra.concedidos === 0 && b.tablas.get('correo_buzon_lectores')!.length === 1 && b.tablas.get('correo_buzon_lectores_historial')!.length === 1)
    const cierra = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: B_ANA, leer: false }, { buzonId: B_BEA, leer: false }] })
    ok('cerrar quita el abierto y no se queja del que no lo estaba', cierra.ok && cierra.quitados === 1 && b.tablas.get('correo_buzon_lectores')!.length === 0)
    const h = b.tablas.get('correo_buzon_lectores_historial')!
    ok('el historial guarda abrir y cerrar', h.length === 2 && h[1].accion === 'quitado')
    ok('y quien pide ya no lo ve', (await buzonesConcedidosA(b.servicio, JHANNA)).size === 0)
  }

  console.log('\n=== lo que no se puede ===')
  {
    const b = nueva()
    const aAdmin = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: RAUL, cambios: [{ buzonId: B_ANA, leer: true }] })
    ok('a un administrador no se le abre nada', !aAdmin.ok && aAdmin.estado === 422)
    const aPartner = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: SOCIO, cambios: [{ buzonId: B_ANA, leer: true }] })
    ok('ni a un partner', !aPartner.ok && aPartner.estado === 422)
    const aNadie = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: id(999), cambios: [{ buzonId: B_ANA, leer: true }] })
    ok('ni a quien no existe', !aNadie.ok && aNadie.estado === 404)
    const suyo = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: ANA, cambios: [{ buzonId: B_ANA, leer: true }, { buzonId: B_BEA, leer: true }] })
    ok('el suyo se rechaza con motivo y el ajeno se abre', suyo.ok && suyo.concedidos === 1 && suyo.rechazados.length === 1 && /propio/.test(suyo.rechazados[0].motivo))
    const inexistente = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: id(777), leer: true }] })
    ok('un buzón que no existe se rechaza', inexistente.ok && inexistente.concedidos === 0 && inexistente.rechazados.length === 1)
    ok('nada de lo rechazado dejó rastro', b.tablas.get('correo_buzon_lectores_historial')!.length === 1)
  }

  console.log('\n=== abrir no se deja sin rastro ===')
  {
    const b = nueva()
    b.errores.set('correo_buzon_lectores_historial', { code: 'XX000', message: 'rota' })
    let fallo: unknown = null
    try {
      await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: B_ANA, leer: true }] })
    } catch (e) {
      fallo = e
    }
    ok('si el rastro no se puede escribir, falla y no queda ningún buzón abierto', fallo instanceof Error && b.tablas.get('correo_buzon_lectores')!.length === 0, String(fallo))
    // Cerrar es al revés: el permiso se quita aunque no se pueda anotar
    const c = nueva({ correo_buzon_lectores: [{ buzon_id: B_ANA, lector_id: JHANNA, concedido_por: RAUL, concedido_at: '2026-10-27T10:00:00.000Z' }] })
    c.errores.set('correo_buzon_lectores_historial', { code: 'XX000', message: 'rota' })
    const r = await cambiarLectores(c.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: B_ANA, leer: false }] })
    ok('cerrar un buzón se hace aunque falle el rastro', r.ok && r.quitados === 1 && c.tablas.get('correo_buzon_lectores')!.length === 0)
  }

  console.log('\n=== la matriz que se enseña ===')
  {
    const b = nueva({
      correo_buzon_lectores: [{ buzon_id: B_ANA, lector_id: JHANNA, concedido_por: RAUL, concedido_at: '2026-10-27T10:00:00.000Z' }],
      correo_buzon_lectores_historial: [{ accion: 'concedido', buzon_direccion: 'ana@l.es', lector_nombre: 'Jhanna', hecho_por_nombre: 'Raúl', hecho_at: '2026-10-27T10:00:00.000Z' }],
    })
    const d = await leerDatosDeLaMatriz(b.servicio)
    ok('las filas son los employees con Correo, sin el administrador ni el partner', d.matriz.filas.map((f) => f.persona.nombre).join() === 'Ana,Bea,Conta,Jhanna', d.matriz.filas.map((f) => f.persona.nombre).join())
    const j = d.matriz.filas.find((f) => f.persona.id === JHANNA)!
    ok('Jhanna tiene abierto el de Ana y nada más', j.celdas[B_ANA].via === 'concedido' && j.celdas[B_BEA].via === 'nada' && j.celdas[B_RAUL].via === 'nada')
    ok('con quién lo abrió y los últimos cambios', d.concesiones[0].por === 'Raúl' && d.recientes.length === 1 && d.recientes[0].lector === 'Jhanna')
    ok('el dueño administrador sale como columna aunque no sea de los employees', d.matriz.buzones.some((x) => x.id === B_RAUL && x.dueno.nombre === 'Raúl' && x.dueno.role === 'admin'))
    ok('cada columna trae el puesto de su dueño (con él se sabe quién es «administrativo»)', d.matriz.buzones.find((x) => x.id === B_CONTA)!.dueno.puesto === 'gestion_administrativa' && d.matriz.buzones.find((x) => x.id === B_ANA)!.dueno.puesto === 'comercial' && d.matriz.buzones.find((x) => x.id === B_RAUL)!.dueno.puesto === null)
  }

  console.log('\n=== sin la migración 260 (bloqueos) nada se rompe ===')
  {
    const b = nueva({ correo_buzon_bloqueos: null })
    ok('quien pide no tiene ningún buzón bloqueado (y no falla)', (await buzonesBloqueadosA(b.servicio, JHANNA)).size === 0)
    const d = await leerDatosDeLaMatriz(b.servicio)
    ok('la matriz sale igual, sin bloqueos, y dice que no se puede bloquear', d.bloqueos.length === 0 && d.bloqueosDisponibles === false && d.matriz.filas.length === 4)
    const abre = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: B_ANA, leer: true }] })
    ok('abrir buzones sigue funcionando sin la 260', abre.ok && abre.concedidos === 1 && abre.bloqueados === 0)
    const r = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: B_CONTA, bloquear: true }] }).catch((e) => e)
    ok('bloquear avisa de la migración, con el nombre del fichero', r instanceof FaltaMigracionDeBloqueos && /260_correo_buzones_bloqueados/.test(FALTA_MIGRACION_BLOQUEOS) && r.message === FALTA_MIGRACION_BLOQUEOS)
    ok('y no deja ningún rastro de lo que no se hizo', b.tablas.get('correo_buzon_lectores_historial')!.every((h) => h.accion !== 'bloqueado'))
  }

  console.log('\n=== un fallo al comprobar los bloqueos NO abre el buzón ===')
  {
    const b = nueva()
    b.errores.set('correo_buzon_bloqueos', { code: 'XX000', message: 'rota' })
    const r = await buzonesBloqueadosA(b.servicio, JHANNA).catch((e) => e)
    ok('si la lectura de los bloqueados falla por otra cosa, se propaga (no se deja leer lo que no se pudo comprobar)', r instanceof Error)
    const d = await leerDatosDeLaMatriz(b.servicio).catch((e) => e)
    ok('y la pantalla también falla en vez de enseñar «sin bloqueos»', d instanceof Error && !(d instanceof FaltaMigracionDeLectores))
  }

  console.log('\n=== bloquear y desbloquear un buzón ===')
  {
    const b = nueva({ user_app_permissions: [...datos().user_app_permissions, { user_id: JHANNA, app_id: 'correo-supervision', can_access: true }] })
    const antes = await buzonesBloqueadosA(b.servicio, JHANNA)
    const quienAntes = { userId: JHANNA, role: 'employee', tienePermisoEquipo: false, tienePermisoCorreo: true, buzonesConcedidos: new Set<string>(), buzonesBloqueados: antes }
    ok('antes: Jhanna, con la supervisión del correo, lee el administrativo', decidirAcceso(quienAntes, { user_id: CONTA, id: B_CONTA }, { is_comercial: false, role: 'employee' }, 'leer').ok)

    const r = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: B_CONTA, bloquear: true }] })
    ok('se bloquea uno', r.ok && r.bloqueados === 1 && r.desbloqueados === 0 && r.concedidos === 0 && r.quitados === 0 && r.rechazados.length === 0)
    const filas = b.tablas.get('correo_buzon_bloqueos')!
    ok('queda en la tabla con quién lo bloqueó', filas.length === 1 && filas[0].buzon_id === B_CONTA && filas[0].lector_id === JHANNA && filas[0].bloqueado_por === RAUL)
    const h = b.tablas.get('correo_buzon_lectores_historial')!
    ok('y en el historial con los nombres copiados', h.length === 1 && h[0].accion === 'bloqueado' && h[0].lector_nombre === 'Jhanna' && h[0].hecho_por_nombre === 'Raúl' && h[0].buzon_direccion === 'conta@l.es')

    const bloqueados = await buzonesBloqueadosA(b.servicio, JHANNA)
    ok('quien pide lo ve en seguida', bloqueados.has(B_CONTA) && bloqueados.size === 1)
    const quien = { ...quienAntes, buzonesBloqueados: bloqueados }
    const d = decidirAcceso(quien, { user_id: CONTA, id: B_CONTA }, { is_comercial: false, role: 'employee' }, 'leer')
    ok('y la regla de verdad ya no la deja leer ese buzón: «no existe»', !d.ok && d.estado === 404)
    ok('pero los otros siguen como estaban', decidirAcceso(quien, { user_id: ANA, id: B_ANA }, { is_comercial: true, role: 'employee' }, 'leer').ok && decidirAcceso(quien, { user_id: BEA, id: B_BEA }, { is_comercial: true, role: 'employee' }, 'leer').ok)
    ok('el bloqueo es de Jhanna: a Ana no le toca', (await buzonesBloqueadosA(b.servicio, ANA)).size === 0)

    const otra = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: B_CONTA, bloquear: true }] })
    ok('bloquear uno ya bloqueado no hace nada ni deja rastro', otra.ok && otra.bloqueados === 0 && b.tablas.get('correo_buzon_bloqueos')!.length === 1 && b.tablas.get('correo_buzon_lectores_historial')!.length === 1)

    const quita = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: B_CONTA, bloquear: false }, { buzonId: B_ANA, bloquear: false }] })
    ok('desbloquear quita el bloqueo y no se queja del que no lo estaba', quita.ok && quita.desbloqueados === 1 && quita.bloqueados === 0 && b.tablas.get('correo_buzon_bloqueos')!.length === 0)
    ok('el historial guarda bloquear y desbloquear', (() => { const x = b.tablas.get('correo_buzon_lectores_historial')!; return x.length === 2 && x[1].accion === 'desbloqueado' })())
    const despues = { ...quienAntes, buzonesBloqueados: await buzonesBloqueadosA(b.servicio, JHANNA) }
    ok('y vuelve a leerlo', decidirAcceso(despues, { user_id: CONTA, id: B_CONTA }, { is_comercial: false, role: 'employee' }, 'leer').ok)
  }

  console.log('\n=== lo que no se puede bloquear ===')
  {
    const b = nueva()
    const aAdmin = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: RAUL, cambios: [{ buzonId: B_ANA, bloquear: true }] })
    ok('a un administrador no se le bloquea nada', !aAdmin.ok && aAdmin.estado === 422)
    const aPartner = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: SOCIO, cambios: [{ buzonId: B_ANA, bloquear: true }] })
    ok('ni a un partner', !aPartner.ok && aPartner.estado === 422)
    const aNadie = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: id(999), cambios: [{ buzonId: B_ANA, bloquear: true }] })
    ok('ni a quien no existe', !aNadie.ok && aNadie.estado === 404)
    const suyo = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: ANA, cambios: [{ buzonId: B_ANA, bloquear: true }, { buzonId: B_BEA, bloquear: true }] })
    ok('el suyo se rechaza con motivo y el ajeno se bloquea', suyo.ok && suyo.bloqueados === 1 && suyo.rechazados.length === 1 && /no se le puede bloquear/.test(suyo.rechazados[0].motivo))
    const inexistente = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: id(777), bloquear: true }] })
    ok('un buzón que no existe se rechaza', inexistente.ok && inexistente.bloqueados === 0 && inexistente.rechazados.length === 1)
    ok('nada de lo rechazado dejó rastro', b.tablas.get('correo_buzon_lectores_historial')!.length === 1 && b.tablas.get('correo_buzon_bloqueos')!.length === 1)
    const deAdmin = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: B_RAUL, bloquear: true }] })
    ok('el buzón de un administrador sí se puede bloquear a una persona (por si se le abrió a mano)', deAdmin.ok && deAdmin.bloqueados === 1)
  }

  console.log('\n=== bloquear y abrir en la misma petición ===')
  {
    const b = nueva()
    const r = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: B_ANA, leer: true }, { buzonId: B_CONTA, bloquear: true }, { buzonId: B_BEA, leer: false }] })
    ok('cada cambio va a lo suyo y se cuenta aparte', r.ok && r.concedidos === 1 && r.bloqueados === 1 && r.quitados === 0 && r.desbloqueados === 0)
    const acciones = b.tablas.get('correo_buzon_lectores_historial')!.map((h) => `${h.accion}:${h.buzon_direccion}`).sort().join()
    ok('el historial tiene los dos', acciones === 'bloqueado:conta@l.es,concedido:ana@l.es', acciones)
  }

  console.log('\n=== el rastro: bloquear no depende de él, desbloquear sí ===')
  {
    const b = nueva()
    b.errores.set('correo_buzon_lectores_historial', { code: 'XX000', message: 'rota' })
    const r = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: B_CONTA, bloquear: true }] })
    ok('bloquear un buzón se hace aunque falle el rastro', r.ok && r.bloqueados === 1 && b.tablas.get('correo_buzon_bloqueos')!.length === 1)

    const c = nueva({ correo_buzon_bloqueos: [{ buzon_id: B_CONTA, lector_id: JHANNA, bloqueado_por: RAUL, bloqueado_at: '2026-10-29T09:00:00.000Z' }] })
    c.errores.set('correo_buzon_lectores_historial', { code: 'XX000', message: 'rota' })
    let fallo: unknown = null
    try {
      await cambiarLectores(c.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: B_CONTA, bloquear: false }] })
    } catch (e) {
      fallo = e
    }
    const filas = c.tablas.get('correo_buzon_bloqueos')!
    ok('si el rastro no se puede escribir, desbloquear falla y el bloqueo sigue donde estaba', fallo instanceof Error && filas.length === 1, String(fallo))
    ok('y con quién y cuándo lo bloqueó, tal como estaba', filas.length === 1 && filas[0].bloqueado_por === RAUL && filas[0].bloqueado_at === '2026-10-29T09:00:00.000Z')
  }

  console.log('\n=== la matriz que se enseña, con bloqueos ===')
  {
    const b = nueva({
      user_app_permissions: [...datos().user_app_permissions, { user_id: JHANNA, app_id: 'correo-supervision', can_access: true }],
      correo_buzon_bloqueos: [{ buzon_id: B_CONTA, lector_id: JHANNA, bloqueado_por: RAUL, bloqueado_at: '2026-10-29T09:00:00.000Z' }],
      correo_buzon_lectores_historial: [{ accion: 'bloqueado', buzon_direccion: 'conta@l.es', lector_nombre: 'Jhanna', hecho_por_nombre: 'Raúl', hecho_at: '2026-10-29T09:00:00.000Z' }],
    })
    const d = await leerDatosDeLaMatriz(b.servicio)
    ok('dice que se puede bloquear y trae el bloqueo con el nombre de quien lo hizo (aunque sea administrador)', d.bloqueosDisponibles && d.bloqueos.length === 1 && d.bloqueos[0].por === 'Raúl' && d.bloqueos[0].buzonId === B_CONTA)
    const j = d.matriz.filas.find((f) => f.persona.id === JHANNA)!
    ok('Jhanna: el administrativo bloqueado (aunque lo vería por su permiso) y los de los comerciales sin bloquear', j.celdas[B_CONTA].bloqueado && j.celdas[B_CONTA].via === 'permiso' && !j.celdas[B_ANA].bloqueado && !j.celdas[B_BEA].bloqueado)
    ok('lee 2 (los comerciales) y tiene 1 bloqueado', j.leidos === 2 && j.bloqueados === 1)
    ok('el historial enseña el bloqueo', d.recientes.length === 1 && d.recientes[0].accion === 'bloqueado' && d.recientes[0].buzon === 'conta@l.es')
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}
void main()
