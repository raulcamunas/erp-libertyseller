import { ceoSinCasilla } from './acceso'

let fallos = 0
const ok = (n: string, bien: boolean) => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}`)
}
const con = new Set(['marketing-test'])
const sin = new Set<string>()
console.log('\n=== CEO y Marketing Test ===')
ok('administrador a secas: nunca cerrado, tenga o no casilla', !ceoSinCasilla('admin', null, sin) && !ceoSinCasilla('admin', 'comercial', sin))
ok('CEO sin casilla: cerrado', ceoSinCasilla('admin', 'ceo', sin))
ok('CEO con casilla: abierto', !ceoSinCasilla('admin', 'ceo', con))
ok('puesto «ceo» sin ser admin no es un CEO (esto no abre nada, lo cierra el rol)', !ceoSinCasilla('employee', 'ceo', sin))
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
