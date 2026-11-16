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
  cargarReglaEnBloque,
  leerDatosDeLaMatriz,
} from '@/lib/correo/lectores-servidor'
import { QUITALO_EN_ASIGNACIONES } from '@/lib/correo/lectores'

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
  correo_buzon_asignaciones: [] as Array<Record<string, unknown>>,
})
const nueva = (extra: Record<string, unknown[] | null> = {}, columnas?: Record<string, readonly string[]>) =>
  crearBaseFalsa({ ...datos(), ...extra } as never, { unicos: { correo_buzon_lectores: ['buzon_id', 'lector_id'], correo_buzon_bloqueos: ['buzon_id', 'lector_id'], correo_buzon_asignaciones: ['buzon_id', 'persona_id'] }, columnas })
const HISTORIAL_SIN_318 = ['id', 'buzon_id', 'buzon_direccion', 'lector_id', 'lector_nombre', 'accion', 'hecho_por', 'hecho_por_nombre', 'hecho_at']

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

  console.log('\n=== asignaciones en la matriz (migración 318) ===')
  {
    const sin = await leerDatosDeLaMatriz(nueva({ correo_buzon_asignaciones: null }, { correo_buzon_lectores_historial: HISTORIAL_SIN_318 }).servicio)
    ok('sin la 318 la matriz sale igual, sin asignaciones, y lo dice', sin.asignacionesDisponibles === false && (sin.asignaciones ?? []).length === 0 && sin.matriz.filas.length === 4)
    const b = nueva(
      {
        correo_buzon_asignaciones: [{ buzon_id: B_ANA, persona_id: JHANNA, puede_responder: true, asignado_por: RAUL, asignado_at: '2026-11-16T10:00:00.000Z' }],
        correo_buzon_lectores_historial: [{ accion: 'asignado', buzon_direccion: 'ana@l.es', lector_nombre: 'Jhanna', hecho_por_nombre: 'Raúl', hecho_at: '2026-11-16T10:00:00.000Z', detalle: 'responde' }],
      },
    )
    const d = await leerDatosDeLaMatriz(b.servicio)
    const j = d.matriz.filas.find((f) => f.persona.id === JHANNA)!
    ok('la celda de Jhanna en el de Ana sale «asignado» con respuesta', j.celdas[B_ANA].via === 'asignado' && j.celdas[B_ANA].puedeResponder === true && d.asignacionesDisponibles === true && d.asignaciones?.length === 1)
    ok('el historial trae la acción nueva y su detalle', d.recientes[0].accion === 'asignado' && d.recientes[0].detalle === 'responde')
    const viejo = await leerDatosDeLaMatriz(nueva({ correo_buzon_lectores_historial: [{ accion: 'concedido', buzon_direccion: 'ana@l.es', lector_nombre: 'Jhanna', hecho_por_nombre: 'Raúl', hecho_at: '2026-10-27T10:00:00.000Z' }] }, { correo_buzon_lectores_historial: HISTORIAL_SIN_318 }).servicio)
    ok('sin la columna detalle (318 sin lanzar) el historial se lee igual, con detalle null', viejo.recientes.length === 1 && viejo.recientes[0].detalle === null)
    const rota = nueva()
    rota.errores.set('correo_buzon_asignaciones', { code: 'XX000', message: 'rota' })
    ok('un fallo de verdad al leer las asignaciones no se esconde', (await leerDatosDeLaMatriz(rota.servicio).catch((e) => e)) instanceof Error)
  }

  console.log('\n=== «No ve» sobre una asignación: se quita en Asignaciones ===')
  {
    const b = nueva({ correo_buzon_asignaciones: [{ buzon_id: B_ANA, persona_id: JHANNA, puede_responder: true }] })
    const r = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: B_ANA, leer: false }, { buzonId: B_BEA, leer: true }] })
    ok('400 «Quítalo en Asignaciones» y no se toca nada', !r.ok && r.estado === 400 && r.error === QUITALO_EN_ASIGNACIONES && b.tablas.get('correo_buzon_lectores')!.length === 0 && b.tablas.get('correo_buzon_asignaciones')!.length === 1)
    const c = nueva({
      correo_buzon_asignaciones: [{ buzon_id: B_ANA, persona_id: JHANNA, puede_responder: true }],
      correo_buzon_lectores: [{ buzon_id: B_ANA, lector_id: JHANNA, concedido_por: RAUL, concedido_at: '2026-10-27T10:00:00.000Z' }],
    })
    const r2 = await cambiarLectores(c.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: B_ANA, leer: false }] })
    ok('si además estaba abierto a mano, quitar cierra lo abierto a mano y la asignación sigue', r2.ok && r2.quitados === 1 && c.tablas.get('correo_buzon_asignaciones')!.length === 1)
    const sin318 = await cambiarLectores(nueva({ correo_buzon_asignaciones: null }).servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: B_ANA, leer: false }] })
    ok('sin la 318, quitar funciona como siempre', sin318.ok && sin318.quitados === 0)
  }

  console.log('\n=== bloquear a quien lo tiene asignado: primero se desasigna ===')
  {
    const b = nueva({ correo_buzon_asignaciones: [{ buzon_id: B_ANA, persona_id: JHANNA, puede_responder: true }, { buzon_id: B_BEA, persona_id: JHANNA, puede_responder: false }] })
    const r = await cambiarLectores(b.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: B_ANA, bloquear: true }] })
    ok('se bloquea y se cuenta la asignación quitada', r.ok && r.bloqueados === 1 && r.desasignados === 1)
    ok('la asignación de ese buzón desaparece; la otra sigue', b.tablas.get('correo_buzon_asignaciones')!.length === 1 && b.tablas.get('correo_buzon_asignaciones')![0].buzon_id === B_BEA)
    const h = b.tablas.get('correo_buzon_lectores_historial')!.map((x) => x.accion)
    ok('el historial dice primero «desasignado» y luego «bloqueado»', h.join() === 'desasignado,bloqueado', h.join())
    const orden = b.peticiones.filter((x) => x === 'correo_buzon_asignaciones.delete' || x === 'correo_buzon_bloqueos.insert')
    ok('y en la base, primero se quita la asignación', orden.join() === 'correo_buzon_asignaciones.delete,correo_buzon_bloqueos.insert', orden.join())

    const c = nueva({ correo_buzon_asignaciones: [{ buzon_id: B_ANA, persona_id: JHANNA, puede_responder: true }] })
    c.errores.set('correo_buzon_lectores_historial', { code: 'XX000', message: 'rota' })
    const r2 = await cambiarLectores(c.servicio, { id: RAUL, nombre: 'Raúl' }, { lectorId: JHANNA, cambios: [{ buzonId: B_ANA, bloquear: true }] })
    ok('quitar la asignación y bloquear se hacen aunque falle el rastro (es lo que QUITA acceso)', r2.ok && c.tablas.get('correo_buzon_asignaciones')!.length === 0 && c.tablas.get('correo_buzon_bloqueos')!.length === 1)
  }

  console.log('\n=== la regla de todo el equipo, en bloque ===')
  {
    const b = nueva({
      user_app_permissions: [
        ...datos().user_app_permissions,
        { user_id: JHANNA, app_id: 'correo-supervision', can_access: true },
        { user_id: BEA, app_id: 'equipo-comercial', can_access: true },
        { user_id: SOCIO, app_id: 'correo', can_access: true },
      ],
      correo_buzon_lectores: [{ buzon_id: B_RAUL, lector_id: ANA, concedido_por: RAUL, concedido_at: '2026-10-27T10:00:00.000Z' }],
      correo_buzon_bloqueos: [{ buzon_id: B_CONTA, lector_id: JHANNA, bloqueado_por: RAUL, bloqueado_at: '2026-10-29T09:00:00.000Z' }],
      correo_buzon_asignaciones: [
        { buzon_id: B_ANA, persona_id: CONTA, puede_responder: true },
        { buzon_id: B_BEA, persona_id: RAUL, puede_responder: true },
        { buzon_id: B_ANA, persona_id: SOCIO, puede_responder: true },
      ],
    })
    const antes = b.peticiones.length
    const regla = await cargarReglaEnBloque(b.servicio)
    ok('se carga en 5 consultas como mucho', b.peticiones.length - antes <= 5, String(b.peticiones.length - antes))
    const buzon = (id: string, user_id: string) => ({ id, user_id })
    const ev = (p: string, bz: { id: string; user_id: string }, m: 'leer' | 'responder' | 'escribir' | 'administrar') => regla.evaluar(p, bz, m)
    ok('el dueño lee y responde el suyo', (() => { const d = ev(ANA, buzon(B_ANA, ANA), 'responder'); return d.ok && d.esDueno })())
    ok('la asignada con respuesta lee y responde, y es «asignado»', (() => { const d = ev(CONTA, buzon(B_ANA, ANA), 'responder'); return d.ok && d.asignado && d.puedeResponder && d.porSupervision })())
    ok('pero no configura el buzón', !ev(CONTA, buzon(B_ANA, ANA), 'escribir').ok)
    ok('un administrador lee todo y responde solo lo que se ha asignado', ev(RAUL, buzon(B_ANA, ANA), 'leer').ok && !ev(RAUL, buzon(B_ANA, ANA), 'responder').ok && ev(RAUL, buzon(B_BEA, BEA), 'responder').ok)
    ok('la supervisión del correo lee los del equipo, no el de un administrador, y no el que tiene bloqueado', ev(JHANNA, buzon(B_ANA, ANA), 'leer').ok && !ev(JHANNA, buzon(B_RAUL, RAUL), 'leer').ok && !ev(JHANNA, buzon(B_CONTA, CONTA), 'leer').ok)
    ok('la supervisión comercial lee los comerciales y no el administrativo', ev(BEA, buzon(B_ANA, ANA), 'leer').ok && !ev(BEA, buzon(B_CONTA, CONTA), 'leer').ok)
    ok('lo abierto a mano también cuenta', ev(ANA, buzon(B_RAUL, RAUL), 'leer').ok)
    ok('un partner no entra ni con una asignación colada', !ev(SOCIO, buzon(B_ANA, ANA), 'leer').ok)
    ok('quien no tiene perfil solo lee lo suyo (nada aquí)', !ev(id(999), buzon(B_ANA, ANA), 'leer').ok)
    const p = (x: string) => regla.persona(x)
    ok('la app Correo: con la casilla, o administrador; un partner nunca', p(ANA)?.appCorreo === true && p(RAUL)?.appCorreo === true && p(SOCIO)?.appCorreo === false && p(JHANNA)?.appCorreo === true)
    ok('sin poder leer Auth, todos activos', p(ANA)?.activo === true && regla.personas.length === 6)
    ok('y el nombre', p(JHANNA)?.nombre === 'Jhanna' && p(id(999)) === undefined)

    // Con Auth: quien tiene banned_until en el futuro, desactivado
    const conAuth = nueva()
    ;(conAuth.servicio as unknown as { auth: unknown }).auth = { admin: { listUsers: async () => ({ data: { users: [{ id: BEA, banned_until: '2999-01-01T00:00:00Z' }, { id: ANA, banned_until: '2000-01-01T00:00:00Z' }] }, error: null }) } }
    const r2 = await cargarReglaEnBloque(conAuth.servicio)
    ok('Auth dice quién está desactivado (un bloqueo pasado no cuenta)', r2.persona(BEA)?.activo === false && r2.persona(ANA)?.activo === true)

    const sin = await cargarReglaEnBloque(nueva({ correo_buzon_asignaciones: null, correo_buzon_bloqueos: null, correo_buzon_lectores: null }).servicio)
    ok('sin las migraciones 255, 260 y 318 se carga igual (tablas vacías)', sin.evaluar(ANA, buzon(B_ANA, ANA), 'leer').ok && !sin.evaluar(CONTA, buzon(B_ANA, ANA), 'leer').ok)
    const rota = nueva()
    rota.errores.set('correo_buzon_bloqueos', { code: 'XX000', message: 'rota' })
    ok('un fallo de verdad en los bloqueos se propaga (no se abre lo que no se pudo comprobar)', (await cargarReglaEnBloque(rota.servicio).catch((e) => e)) instanceof Error)
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}
void main()
