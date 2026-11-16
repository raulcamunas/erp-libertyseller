import {
  accionDeHistorial,
  armarVistaDeAsignaciones,
  efectosDeAsignar,
  ordenDeCambio,
  personasParaAsignar,
  validarPeticionDeAsignacion,
} from '@/lib/correo/asignaciones'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const igual = (n: string, real: unknown, esperado: unknown) => ok(n, JSON.stringify(real) === JSON.stringify(esperado), `${JSON.stringify(real)} (esperaba ${JSON.stringify(esperado)})`)

const B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const P = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

console.log('\n1. Validar la petición')
{
  igual('buena (ids en minúsculas)', validarPeticionDeAsignacion({ buzonId: B.toUpperCase(), personaId: P, accion: 'asignar' }), {
    ok: true,
    peticion: { buzonId: B, personaId: P, accion: 'asignar' },
  })
  for (const accion of ['quitar', 'responde', 'solo_avisos']) ok(`acción ${accion}`, validarPeticionDeAsignacion({ buzonId: B, personaId: P, accion }).ok)
  ok('acción inventada', !validarPeticionDeAsignacion({ buzonId: B, personaId: P, accion: 'leer' }).ok)
  ok('sin buzón', !validarPeticionDeAsignacion({ personaId: P, accion: 'asignar' }).ok)
  ok('persona que no es un UUID', !validarPeticionDeAsignacion({ buzonId: B, personaId: 'raul', accion: 'asignar' }).ok)
  ok('sin cuerpo', !validarPeticionDeAsignacion(null).ok)
}

console.log('\n2. A quién se puede asignar')
{
  const base = { esPartner: false, esDueno: false, tieneBloqueo: false, buzonDeOtroAdmin: false }
  igual('un admin que se lo asigna a sí mismo: sí, sin avisarse', efectosDeAsignar({ ...base, role: 'admin', aUnoMismo: true }), {
    ok: true,
    efectos: { quitarBloqueo: false, avisarPersona: false, avisarDueno: true, pedirConfirmacion: false },
  })
  igual('un employee: sí, avisando a la persona y al dueño', efectosDeAsignar({ ...base, role: 'employee' }), {
    ok: true,
    efectos: { quitarBloqueo: false, avisarPersona: true, avisarDueno: true, pedirConfirmacion: false },
  })
  const partner = efectosDeAsignar({ ...base, role: 'partner', esPartner: true })
  ok('un partner: 400', !partner.ok && partner.estado === 400)
  const partnerSoloRole = efectosDeAsignar({ ...base, role: 'partner' })
  ok('un partner (solo por el role): 400', !partnerSoloRole.ok && partnerSoloRole.estado === 400)
  const dueno = efectosDeAsignar({ ...base, role: 'employee', esDueno: true })
  ok('el dueño: 400', !dueno.ok && dueno.estado === 400)
  const raro = efectosDeAsignar({ ...base, role: null })
  ok('sin role: 400', !raro.ok && raro.estado === 400)
  const bloqueado = efectosDeAsignar({ ...base, role: 'employee', tieneBloqueo: true })
  ok('con el buzón bloqueado: asignar quita el bloqueo', bloqueado.ok && bloqueado.efectos.quitarBloqueo)
  const deAdmin = efectosDeAsignar({ ...base, role: 'employee', buzonDeOtroAdmin: true })
  ok('buzón de otro administrador: pide confirmación', deAdmin.ok && deAdmin.efectos.pedirConfirmacion)
  const suyo = efectosDeAsignar({ ...base, role: 'employee', asignaElDueno: true })
  ok('un admin que asigna su propio buzón no se avisa a sí mismo como dueño', suyo.ok && !suyo.efectos.avisarDueno)
}

console.log('\n3. Orden de cada acción')
{
  igual('asignar: da (historial primero)', ordenDeCambio('asignar'), 'da')
  igual('responde: da (historial primero)', ordenDeCambio('responde'), 'da')
  igual('solo_avisos: quita (aplicar primero)', ordenDeCambio('solo_avisos'), 'quita')
  igual('quitar: quita (aplicar primero)', ordenDeCambio('quitar'), 'quita')
  igual(
    'lo que queda en el historial',
    (['asignar', 'quitar', 'responde', 'solo_avisos'] as const).map(accionDeHistorial),
    ['asignado', 'desasignado', 'responde', 'solo_avisos'],
  )
}

console.log('\n4. La vista de Asignaciones')
{
  const vista = armarVistaDeAsignaciones({
    yoId: 'raul',
    buzones: [
      { id: 'b-stock', direccion: 'stock@liberty.es', dueno: { id: 'raul', nombre: 'Raúl', role: 'admin' } },
      { id: 'b-daniela', direccion: 'daniela@liberty.es', nombre: 'Daniela', dueno: { id: 'daniela', nombre: 'Daniela Ruiz', role: 'employee', puesto: 'comercial' } },
    ],
    asignaciones: [
      { buzon_id: 'b-daniela', persona_id: 'patricia', puede_responder: true, asignado_por: 'raul', asignado_at: '2026-11-15T10:00:00Z' },
      { buzon_id: 'b-daniela', persona_id: 'jhanna', puede_responder: false, asignado_por: null, asignado_at: '2026-11-14T10:00:00Z' },
    ],
    personas: [
      { id: 'patricia', nombre: 'Patricia', role: 'employee' },
      { id: 'jhanna', nombre: 'Jhanna', role: 'employee' },
      { id: 'raul', nombre: 'Raúl', role: 'admin' },
      { id: 'daniela', nombre: 'Daniela Ruiz', role: 'employee' },
      { id: 'socio', nombre: 'Socio', role: 'partner' },
      { id: 'baja', nombre: 'Antigua', role: 'employee', activo: false },
      { id: 'sincorreo', nombre: 'Sin correo', role: 'employee', tieneCorreo: false },
    ],
    bloqueos: [{ buzonId: 'b-daniela', lectorId: 'jhanna' }],
    cambios: [{ accion: 'asignado' }],
  })
  igual('buzones por dirección', vista.buzones.map((b) => b.direccion), ['daniela@liberty.es', 'stock@liberty.es'])
  igual('el de otro admin se marca', vista.buzones.map((b) => b.deAdmin), [false, true])
  igual(
    'asignaciones por nombre, con quién las hizo',
    vista.buzones[0].asignaciones.map((a) => [a.nombre, a.puedeResponder, a.asignadoPor]),
    [
      ['Jhanna', false, null],
      ['Patricia', true, 'Raúl'],
    ],
  )
  igual('personas: Yo arriba, sin partners, bajas ni sin app de Correo', vista.personas.map((p) => p.nombre), ['Raúl', 'Daniela Ruiz', 'Jhanna', 'Patricia'])
  igual('bloqueados por persona', vista.personas.find((p) => p.id === 'jhanna')?.bloqueados, ['b-daniela'])
  igual('los cambios pasan tal cual', vista.cambios, [{ accion: 'asignado' }])
  igual('selector de daniela@: sin la dueña ni quien ya lo tiene; Yo arriba', personasParaAsignar(vista, 'b-daniela').map((p) => p.id), ['raul'])
  igual('selector de stock@ (mío): sin mí', personasParaAsignar(vista, 'b-stock').map((p) => p.id), ['daniela', 'jhanna', 'patricia'])
}

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
