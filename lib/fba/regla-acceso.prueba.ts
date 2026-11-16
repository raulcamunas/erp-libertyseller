import { reglaDeAcceso, type AccesoFba } from '@/lib/fba/regla-acceso'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const ver = (x: unknown) => JSON.stringify(x)
const igual = (a: string[] | null, b: string[] | null) => ver(a) === ver(b)

/**
 * CASO 54 (spec remesas-pro §11.8, D27): los 5 casos de acceso. La casilla `remesas` da acceso; el puesto, no.
 */

const ACCESOS: AccesoFba[] = [
  { clienteId: 'opinas', puedeEditar: true },
  { clienteId: 'cobo', puedeEditar: false },
  { clienteId: 'opinas', puedeEditar: false }, // repetida: no se duplica y sigue editable
  { clienteId: '  ', puedeEditar: true }, // vacía: se ignora
]

console.log('\n1. admin que no es CEO')
{
  const r = reglaDeAcceso({ role: 'admin', puesto: null, casillaRemesas: false, accesos: [] })
  ok('todos, edita, agencia, esAdmin', r.clientesPermitidos === null && r.editables === null && r.esAdmin && r.actor === 'agencia', ver(r))
  const conPuesto = reglaDeAcceso({ role: 'admin', puesto: 'gestion_administrativa', casillaRemesas: false, accesos: [] })
  ok('con otro puesto, igual', conPuesto.clientesPermitidos === null && conPuesto.esAdmin, ver(conPuesto))
}

console.log('\n2. CEO (admin con puesto ceo)')
{
  const con = reglaDeAcceso({ role: 'admin', puesto: 'ceo', casillaRemesas: true, accesos: [] })
  ok('con la casilla: todos, edita, agencia, esAdmin', con.clientesPermitidos === null && con.editables === null && con.esAdmin && con.actor === 'agencia', ver(con))
  const sin = reglaDeAcceso({ role: 'admin', puesto: 'ceo', casillaRemesas: false, accesos: [] })
  ok('sin la casilla: nada (lista vacía = 403) y sin poderes de admin', igual(sin.clientesPermitidos, []) && !sin.esAdmin && sin.actor === 'agencia', ver(sin))
}

console.log('\n3. employee con la casilla remesas')
{
  const r = reglaDeAcceso({ role: 'employee', puesto: 'gestion_administrativa', casillaRemesas: true, accesos: [] })
  ok('todos, edita, agencia, esAdmin = false', r.clientesPermitidos === null && r.editables === null && !r.esAdmin && r.actor === 'agencia', ver(r))
  const sinPuesto = reglaDeAcceso({ role: 'employee', puesto: null, casillaRemesas: true, accesos: ACCESOS })
  ok('sin puesto también: decide la casilla', sinPuesto.clientesPermitidos === null && sinPuesto.editables === null, ver(sinPuesto))
}

console.log('\n4. employee sin la casilla')
{
  const r = reglaDeAcceso({ role: 'employee', puesto: null, casillaRemesas: false, accesos: ACCESOS })
  ok('sus fba_accesos, sin repetir', igual(r.clientesPermitidos, ['opinas', 'cobo']), ver(r))
  ok('edita solo donde puede_editar', igual(r.editables, ['opinas']), ver(r))
  ok('agencia, no admin', r.actor === 'agencia' && !r.esAdmin, ver(r))
  const puesto = reglaDeAcceso({ role: 'employee', puesto: 'gestion_administrativa', casillaRemesas: false, accesos: [] })
  ok('el puesto «Gestión Administrativa» NO da acceso', igual(puesto.clientesPermitidos, []), ver(puesto))
}

console.log('\n5. cliente')
{
  const r = reglaDeAcceso({ role: 'cliente', puesto: null, casillaRemesas: false, accesos: ACCESOS })
  ok('sus fba_accesos, actor cliente', igual(r.clientesPermitidos, ['opinas', 'cobo']) && igual(r.editables, ['opinas']) && r.actor === 'cliente' && !r.esAdmin, ver(r))
  const conCasilla = reglaDeAcceso({ role: 'cliente', puesto: null, casillaRemesas: true, accesos: [{ clienteId: 'cobo', puedeEditar: true }] })
  ok('la casilla no le abre todos', igual(conCasilla.clientesPermitidos, ['cobo']) && conCasilla.actor === 'cliente', ver(conCasilla))
  const partner = reglaDeAcceso({ role: 'partner', puesto: null, casillaRemesas: true, accesos: [] })
  ok('otro rol (partner) = de fuera: actor cliente, nada', igual(partner.clientesPermitidos, []) && partner.actor === 'cliente', ver(partner))
  const sinRol = reglaDeAcceso({ role: null, puesto: null, casillaRemesas: true, accesos: [] })
  ok('sin rol: nada', igual(sinRol.clientesPermitidos, []) && sinRol.actor === 'cliente', ver(sinRol))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
