import { cuotaOrganica, proponerDefensaOrganica } from './organico-calculo'

let fallos = 0
const ok = (nombre: string, cond: boolean, extra?: unknown) => {
  if (!cond) {
    fallos++
    console.error('✗', nombre, extra ?? '')
  } else console.log('✓', nombre)
}

const c = cuotaOrganica({ clicsTotal: 1000, clicsAsin: 400, comprasAsin: 40 }, { clics: 100, pedidos: 10 })
ok('resta publicidad', c.clicsOrganicos === 300 && c.comprasOrganicas === 30)
ok('nunca negativo', cuotaOrganica({ clicsTotal: 100, clicsAsin: 10, comprasAsin: 1 }, { clics: 50, pedidos: 5 }).clicsOrganicos === 0)

const k = { puja: 1, metricas: { clics: 50, gasto: 30, ventas: 100, pedidos: 4 } } // ACoS 30
const p = { acosObjetivoPct: 30, muestraMinimaClics: 12 }
const r = proponerDefensaOrganica(k, c, p)
ok('baja 15 %', r?.pujaNueva === 0.85, r)
ok('keyword muy barata no', proponerDefensaOrganica({ ...k, metricas: { ...k.metricas, gasto: 10 } }, c, p) === null)
ok('poca cuota no', proponerDefensaOrganica(k, { clicsTotal: 1000, clicsOrganicos: 100, comprasOrganicas: 10 }, p) === null)
ok('pocas compras no', proponerDefensaOrganica(k, { clicsTotal: 1000, clicsOrganicos: 300, comprasOrganicas: 2 }, p) === null)
ok('poca muestra no', proponerDefensaOrganica({ ...k, metricas: { ...k.metricas, clics: 5 } }, c, p) === null)
ok('sin datos no', proponerDefensaOrganica(k, undefined, p) === null)

if (fallos) {
  console.error(`${fallos} fallos`)
  process.exit(1)
}
