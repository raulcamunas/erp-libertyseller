import { alcanceDelCrm, esClienteVisible } from '@/lib/crm/acceso'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const A = (role: string | null, equipoComercial = false, crmPropios = false) => alcanceDelCrm({ role, equipoComercial, crmPropios })

console.log('\n=== dirección: todo ===')
{
  for (const rol of ['admin', 'partner']) {
    const a = A(rol)
    ok(`${rol}: entra, ve todos y lo puede todo`, a.quien === 'direccion' && a.entra && a.veTodos && a.esDireccion && a.puedeMover && a.puedeVerImportes && a.puedeImportes && a.puedeResultadoDeCita && a.puedeAlta && a.puedeVerLoDeDireccion)
  }
  ok('un permiso suelto no le quita nada a dirección', A('admin', false, true).veTodos && A('admin', true, true).puedeImportes)
}

console.log('\n=== manager (equipo-comercial): ve todos y mueve, sin importes ===')
{
  const a = A('employee', true)
  ok('entra y ve todos los clientes', a.quien === 'manager' && a.entra && a.veTodos && !a.esDireccion)
  ok('mueve de fase, descarta y cierra', a.puedeMover)
  ok('ve los importes (siempre los vio) pero NO los cambia', a.puedeVerImportes && !a.puedeImportes)
  ok('no cualifica citas (genera comisión), ni ve PDFs, notas de Gemini ni coste', !a.puedeResultadoDeCita && !a.puedeVerLoDeDireccion)
  ok('no da de alta clientes', !a.puedeAlta)
  ok('con crm-propios además, sí da de alta (los suyos) y sigue viendo todos', A('employee', true, true).puedeAlta && A('employee', true, true).veTodos && A('employee', true, true).quien === 'manager')
}

console.log('\n=== comercial autónomo (crm-propios): solo los suyos ===')
{
  const a = A('employee', false, true)
  ok('entra, pero NO ve todos', a.quien === 'autonomo' && a.entra && !a.veTodos && !a.esDireccion)
  ok('mueve de fase, descarta, cierra y da de alta los suyos', a.puedeMover && a.puedeAlta)
  ok('no ve ni toca importes', !a.puedeVerImportes && !a.puedeImportes)
  ok('no cualifica citas ni ve lo de dirección (PDFs, bandeja de Gemini, coste del equipo)', !a.puedeResultadoDeCita && !a.puedeVerLoDeDireccion)
}

console.log('\n=== quien no entra ===')
{
  ok('un empleado sin ningún permiso', !A('employee').entra && A('employee').quien === 'nadie' && !A('employee').puedeMover)
  ok('un cliente de fuera, aunque tenga una casilla marcada', !A('cliente', true, true).entra && !A('cliente', true, true).veTodos)
  ok('un rol que no existe o sin cargar', !A('rey', true, true).entra && !A(null, true, true).entra && !A(undefined as unknown as null, true, true).entra)
  ok('quien no entra no puede nada', (() => { const a = A('employee'); return !a.puedeMover && !a.puedeAlta && !a.puedeImportes && !a.puedeVerImportes && !a.puedeResultadoDeCita && !a.puedeVerLoDeDireccion })())
}

console.log('\n=== qué clientes ve cada uno ===')
{
  const YO = '00000000-0000-4000-8000-000000000001'
  const OTRO = '00000000-0000-4000-8000-000000000002'
  const mio = { owner_id: YO }
  const ajeno = { owner_id: OTRO }
  const huerfano = { owner_id: null }
  ok('dirección ve todos, también los sin responsable', esClienteVisible(A('admin'), mio, YO) && esClienteVisible(A('admin'), ajeno, YO) && esClienteVisible(A('admin'), huerfano, YO))
  ok('un manager ve todos', esClienteVisible(A('employee', true), ajeno, YO) && esClienteVisible(A('employee', true), huerfano, YO))
  const aut = A('employee', false, true)
  ok('un autónomo ve el suyo', esClienteVisible(aut, mio, YO))
  ok('y no ve el de otro', !esClienteVisible(aut, ajeno, YO))
  ok('ni uno sin responsable (no es de nadie)', !esClienteVisible(aut, huerfano, YO))
  ok('quien no entra no ve ninguno', !esClienteVisible(A('employee'), mio, YO))
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
