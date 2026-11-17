import { decidirPrecio } from './dinamico'

let fallos = 0
const ok = (n: string, c: boolean, extra = '') => {
  if (!c) fallos++
  console.log(`  ${c ? 'OK   ' : 'FALLO'} ${n}${!c && extra ? ` → ${extra}` : ''}`)
}
const R = (total: number, tienda = 'X') => ({ tienda, precio: total, total })
const base = { centimos: 0.05, subir: true }

const a = decidirPrecio({ ...base, precio: 75, total: 75, rivales: [R(71.95, 'VISO'), R(80)], minimo: 69.96 })
ok('baja 5 céntimos por debajo del más barato', a.precio === 71.9 && a.motivo === 'bajar_bajo_rival', JSON.stringify(a))

const b = decidirPrecio({ ...base, precio: 65, total: 65, rivales: [R(71.95)], minimo: 60 })
ok('si somos los más baratos, sube hasta 5 cént. bajo el siguiente', b.precio === 71.9 && b.motivo === 'subir_bajo_siguiente', JSON.stringify(b))

const c = decidirPrecio({ ...base, subir: false, precio: 65, total: 65, rivales: [R(71.95)], minimo: 60 })
ok('sin «subir», se queda', c.precio === null)

const d = decidirPrecio({ ...base, precio: 80, total: 80, rivales: [R(60)], minimo: 69.96 })
ok('nunca por debajo del mínimo', d.precio === 69.96 && d.motivo === 'al_minimo_rival_mas_barato', JSON.stringify(d))

const e = decidirPrecio({ ...base, precio: 50, total: 50, rivales: [], minimo: 69.96 })
ok('sin rivales y por debajo del mínimo: sube al mínimo', e.precio === 69.96 && e.motivo === 'subir_al_minimo')

ok('sin rivales y bien: no se toca', decidirPrecio({ ...base, precio: 80, total: 80, rivales: [], minimo: 70 }).precio === null)
ok('sin coste: no se toca', decidirPrecio({ ...base, precio: 80, total: 80, rivales: [R(70)], minimo: null }).precio === null)
ok('ya está 5 cént. por debajo: no se toca', decidirPrecio({ ...base, precio: 71.9, total: 71.9, rivales: [R(71.95)], minimo: 60 }).motivo === 'ya_esta')

// Envío: nuestro total lleva 4,90 € de envío; el rival lo tiene incluido
const f = decidirPrecio({ ...base, precio: 40, total: 44.9, rivales: [{ tienda: 'Y', precio: 43, total: 43 }], minimo: 30 })
ok('compara el total con envío: para quedar a 42,95 € de total, el precio es 38,05 €', f.precio === 38.05, JSON.stringify(f))

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
