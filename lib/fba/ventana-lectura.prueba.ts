import { MAXIMO_HISTORICO_DIAS, desdeCuandoLeer, desdeParaLeerAhora } from '@/lib/fba/ventana-lectura'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * DESDE QUÉ DÍA SE LEE EL LIBRO MAYOR.
 *
 * Lo de siempre (la pasada de la noche) no puede cambiar. Lo nuevo es la lectura a mano de un
 * envío: traer de Amazon un envío de julio a una cuenta que ya se leía cada noche dejaba sus
 * ventas fuera para siempre, porque la pasada solo relee 14 días hacia atrás.
 */

const dia = (d: Date) => d.toISOString().slice(0, 10)
const hoy = new Date('2026-10-20T11:30:00Z')

console.log('\n=== lo de siempre: desdeCuandoLeer (no cambia) ===')
{
  ok('sin lectura previa ni remesas: 90 días atrás', dia(desdeCuandoLeer(null, hoy)) === '2026-07-22', dia(desdeCuandoLeer(null, hoy)))
  ok('sin lectura previa y con una remesa más antigua: un día antes de ella', dia(desdeCuandoLeer(null, hoy, '2026-05-03')) === '2026-05-02', dia(desdeCuandoLeer(null, hoy, '2026-05-03')))
  ok('con una remesa más reciente que 90 días, manda el trimestre', dia(desdeCuandoLeer(null, hoy, '2026-10-01')) === '2026-07-22')
  ok('con lectura previa: 14 días antes de donde se quedó', dia(desdeCuandoLeer('2026-10-19', hoy)) === '2026-10-05', dia(desdeCuandoLeer('2026-10-19', hoy)))
  ok('con lectura previa la remesa antigua ya no cuenta', dia(desdeCuandoLeer('2026-10-19', hoy, '2026-05-03')) === '2026-10-05')
  ok('nunca más atrás de lo que Amazon conserva', desdeCuandoLeer(null, hoy, '2020-01-01').getTime() >= hoy.getTime() - MAXIMO_HISTORICO_DIAS * 86_400_000 - 1)
}

console.log('\n=== lo nuevo: la lectura a mano de un envío ===')
{
  // El caso de Portico: tres envíos de julio traídos hoy a una cuenta que nunca se había leído
  const portico = desdeParaLeerAhora(null, hoy, '2026-07-13', ['2026-07-13', '2026-07-20', '2026-08-07'])
  ok('primera lectura: desde la remesa más antigua MENOS el colchón de 7 días (la fecha la puso una persona)', dia(portico) === '2026-07-06', dia(portico))
  ok('y cubre la creación del envío más antiguo aunque la fecha escrita se pasara unos días', portico.getTime() <= Date.parse('2026-07-08T00:00:00Z'))

  // Una cuenta que ya se leía cada noche y a la que se trae un envío antiguo
  const cuentaAlDia = desdeParaLeerAhora('2026-10-19', hoy, '2026-05-03', ['2026-07-20'])
  ok('cuenta ya leída: se estira hasta el envío sin llegada, con colchón', dia(cuentaAlDia) === '2026-07-13', dia(cuentaAlDia))

  const sinPendientes = desdeParaLeerAhora('2026-10-19', hoy, '2026-05-03', [])
  ok('sin envíos pendientes de llegada, lo mismo que la pasada normal', dia(sinPendientes) === dia(desdeCuandoLeer('2026-10-19', hoy)), dia(sinPendientes))

  const pendienteReciente = desdeParaLeerAhora('2026-10-19', hoy, null, ['2026-10-15'])
  ok('un envío pendiente RECIENTE no acorta ni cambia la ventana normal', dia(pendienteReciente) === '2026-10-05', dia(pendienteReciente))

  const variasPendientes = desdeParaLeerAhora('2026-10-19', hoy, null, ['2026-09-01', '2026-08-10', '2026-10-10'])
  ok('con varios pendientes manda el más antiguo', dia(variasPendientes) === '2026-08-03', dia(variasPendientes))

  ok('nunca empieza DESPUÉS de lo que leería la pasada normal', desdeParaLeerAhora('2026-10-19', hoy, null, ['2026-10-19']).getTime() <= desdeCuandoLeer('2026-10-19', hoy).getTime())
  ok('una fecha ilegible se ignora, no rompe la lectura', dia(desdeParaLeerAhora('2026-10-19', hoy, null, ['no es una fecha', ''])) === '2026-10-05')

  const antiquisimo = desdeParaLeerAhora('2026-10-19', hoy, null, ['2019-01-01'])
  ok('tope: no pide más atrás de lo que Amazon conserva', antiquisimo.getTime() >= hoy.getTime() - MAXIMO_HISTORICO_DIAS * 86_400_000 - 1 && dia(antiquisimo) === dia(new Date(hoy.getTime() - MAXIMO_HISTORICO_DIAS * 86_400_000)), dia(antiquisimo))

  const primeraSinRemesas = desdeParaLeerAhora(null, hoy, null, [])
  ok('primera lectura de una cuenta sin remesas: el trimestre de siempre', dia(primeraSinRemesas) === '2026-07-22', dia(primeraSinRemesas))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
