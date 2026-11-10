import { estaVivo, ordenarColumnas, ordenarTarjetas, type ColumnaTablero, type TarjetaTablero } from './tablero'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const t = (id: string, o: Partial<TarjetaTablero> = {}): TarjetaTablero => ({ id, nombre: id, fechaEnvio: '2026-10-01', referenciaEnvio: `FBA${id}`, estadoAmazon: 'RECEIVING', seguimientoError: null, quedan: 10, enviadas: 20, vendidas: 10, noLlegaron: 0, referencias: 3, cobertura: null, chispa: [], ...o })
const col = (nombre: string, tarjetas: TarjetaTablero[], propuestas = 0): ColumnaTablero => ({ clienteId: nombre, nombre, puedeEditar: true, tarjetas, propuestas })

console.log('\n=== tarjetas ===')
{
  const r = ordenarTarjetas([t('a', { fechaEnvio: '2026-10-30' }), t('b', { fechaEnvio: '2026-09-01', cobertura: 5 }), t('c', { fechaEnvio: '2026-10-10', cobertura: 3 }), t('d', { fechaEnvio: '2026-10-20' })])
  ok('primero las que se agotan antes, luego por fecha', r.map((x) => x.id).join() === 'c,b,a,d', r.map((x) => x.id).join())
  ok('una agotada con cobertura baja no cuenta como urgente', ordenarTarjetas([t('x', { quedan: 0, cobertura: 1, fechaEnvio: '2026-01-01' }), t('y', { fechaEnvio: '2026-02-01' })])[0].id === 'y')
  ok('vivo = le queda mercancía', estaVivo(t('v')) && !estaVivo(t('w', { quedan: 0 })))
}

console.log('\n=== columnas ===')
{
  const r = ordenarColumnas([col('Zeta', []), col('Beta', [t('1', { quedan: 0 })]), col('Alfa', [t('2')]), col('Gamma', [], 2)])
  ok('con algo vivo o en marcha primero, por nombre; las vacías o agotadas, después', r.map((c) => c.nombre).join() === 'Alfa,Gamma,Beta,Zeta', r.map((c) => c.nombre).join())
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS de ${comprobaciones} comprobaciones\n`)
if (fallos > 0) process.exit(1)
