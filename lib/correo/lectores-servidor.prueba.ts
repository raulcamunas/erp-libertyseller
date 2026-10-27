import { crearBaseFalsa } from '@/lib/mcp/comercial/base-falsa'
import { decidirAcceso } from '@/lib/correo/acceso'
import { FALTA_MIGRACION_LECTORES, FaltaMigracionDeLectores, buzonesConcedidosA, cambiarLectores, leerDatosDeLaMatriz } from '@/lib/correo/lectores-servidor'

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
    { id: ANA, full_name: 'Ana', email: 'ana@l.es', role: 'employee', is_comercial: true },
    { id: BEA, full_name: 'Bea', email: 'bea@l.es', role: 'employee', is_comercial: true },
    { id: CONTA, full_name: 'Conta', email: 'conta@l.es', role: 'employee', is_comercial: false },
    { id: RAUL, full_name: 'Raúl', email: 'raul@l.es', role: 'admin', is_comercial: false },
    { id: JHANNA, full_name: 'Jhanna', email: 'jhanna@l.es', role: 'employee', is_comercial: false },
    { id: SOCIO, full_name: 'Socio', email: 'socio@l.es', role: 'partner', is_comercial: false },
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
})
const nueva = (extra: Record<string, unknown[] | null> = {}) => crearBaseFalsa({ ...datos(), ...extra } as never, { unicos: { correo_buzon_lectores: ['buzon_id', 'lector_id'] } })

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
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}
void main()
