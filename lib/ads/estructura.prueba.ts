import { nombreDeCampana, planDeEstructura, repartoDePresupuesto, resumenDesdeTitulo, resumenNormalizado, ROLES_DE_ARRANQUE, yaExistentes } from './estructura'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** ESTRUCTURA DE CAMPAÑAS. Lo que duele si falla: un nombre que no filtra (rompe la auditoría), un presupuesto que no suma o crear dos veces lo mismo */

const producto = { asin: 'B0H5F7RJ5F', sku: 'HATBOX-COWBOY', resumen: 'HAT BOX' }

console.log('\n=== nomenclatura del SOP ===')
{
  ok('ASIN | SKU | RESUMEN | ESTRATEGIA', nombreDeCampana(producto, 'AUTO RADAR') === 'B0H5F7RJ5F | HATBOX-COWBOY | HAT BOX | AUTO RADAR')
  ok('la Exacta lleva su barra: MANUAL EXACTA / DOMINIO', nombreDeCampana(producto, 'MANUAL EXACTA / DOMINIO') === 'B0H5F7RJ5F | HATBOX-COWBOY | HAT BOX | MANUAL EXACTA / DOMINIO')
  ok('espacios sobrantes no entran en el nombre', nombreDeCampana({ asin: ' B0H5F7RJ5F ', sku: ' X ', resumen: ' HAT BOX ' }, 'ATAQUE ASIN') === 'B0H5F7RJ5F | X | HAT BOX | ATAQUE ASIN')
}

console.log('\n=== resumen desde el título ===')
{
  ok('mayúsculas, sin tildes ni palabras vacías', resumenDesdeTitulo('Sombrerera de viaje para sombreros vaquero, con asa') === 'SOMBRERERA VIAJE SOMBREROS', resumenDesdeTitulo('Sombrerera de viaje para sombreros vaquero, con asa'))
  ok('máximo 3 palabras', resumenDesdeTitulo('Caja Madera Grande Decorativa Regalo').split(' ').length === 3)
  ok('sin título → vacío', resumenDesdeTitulo(null) === '' && resumenDesdeTitulo('') === '')
  ok('nunca pasa del máximo de caracteres', resumenDesdeTitulo('Supercalifragilisticoespialidoso Anticonstitucionalmente Extraordinario', 3, 20).length <= 20)
  ok('normalizado: quita «|», saltos y mayúsculas', resumenNormalizado(' hat | box\n') === 'HAT BOX')
}

console.log('\n=== reparto del presupuesto ===')
{
  const r = repartoDePresupuesto(20, ROLES_DE_ARRANQUE)!
  ok('suma EXACTAMENTE el total pedido', Math.abs(r.reduce((a, f) => a + f.presupuesto, 0) - 20) < 1e-9, JSON.stringify(r))
  const por = Object.fromEntries(r.map((f) => [f.rol, f.presupuesto]))
  ok('AMPLIA es la que más recibe y ATAQUE la que menos', por['MANUAL AMPLIA'] > por['MANUAL EXACTA / DOMINIO'] && por['ATAQUE ASIN'] < por['AUTO RADAR'], JSON.stringify(por))
  ok('proporciones del SOP normalizadas a las 4: AMPLIA 41,18 %', r.find((f) => f.rol === 'MANUAL AMPLIA')?.pct === 41.18)
  ok('presupuesto que no da para 1 por campaña → null', repartoDePresupuesto(3, ROLES_DE_ARRANQUE) === null)
  ok('con justo 4 € cada una recibe 1', repartoDePresupuesto(4, ROLES_DE_ARRANQUE)?.every((f) => f.presupuesto === 1) === true)
  ok('total 0 o sin roles → null', repartoDePresupuesto(0, ROLES_DE_ARRANQUE) === null && repartoDePresupuesto(10, []) === null)
  for (const total of [4, 5, 7.5, 13.33, 20, 33.3, 100, 250.55]) {
    const x = repartoDePresupuesto(total, ROLES_DE_ARRANQUE)
    ok(`para ${total} la suma cuadra y ninguna baja de 1`, !!x && Math.abs(x.reduce((a, f) => a + f.presupuesto, 0) - total) < 0.005 && x.every((f) => f.presupuesto >= 1), JSON.stringify(x))
  }
  const cinco = repartoDePresupuesto(30, ['AUTO RADAR', 'MANUAL AMPLIA', 'MANUAL EXACTA / DOMINIO', 'MANUAL EXACTA / ESTABILIDAD', 'ATAQUE ASIN'])!
  ok('con las 5, la Exacta se parte en 15 + 10', cinco.find((f) => f.rol === 'MANUAL EXACTA / DOMINIO')!.pct > cinco.find((f) => f.rol === 'MANUAL EXACTA / ESTABILIDAD')!.pct)
}

console.log('\n=== el plan de 4 campañas ===')
{
  const r = planDeEstructura(producto, { presupuestoDiario: 20, pujaBase: 0.8 })
  ok('sale ok con 4 campañas', r.ok && r.campanas.length === 4)
  if (r.ok) {
    ok('en el orden del embudo', r.campanas.map((c) => c.rol).join(',') === 'AUTO RADAR,MANUAL AMPLIA,MANUAL EXACTA / DOMINIO,ATAQUE ASIN', r.campanas.map((c) => c.rol).join(','))
    ok('NO incluye ESTABILIDAD el día 1', !r.campanas.some((c) => c.rol === 'MANUAL EXACTA / ESTABILIDAD'))
    ok('todas con puja dinámica «solo reducir»', r.campanas.every((c) => c.estrategiaPuja === 'LEGACY_FOR_SALES'))
    const auto = r.campanas.find((c) => c.rol === 'AUTO RADAR')!
    ok('la automática es AUTO y las demás MANUAL', auto.targetingType === 'AUTO' && r.campanas.filter((c) => c.rol !== 'AUTO RADAR').every((c) => c.targetingType === 'MANUAL'))
    ok('Automática: complementarios apagado, sustitutos −15 %', auto.targetsAuto?.find((t) => t.tipo === 'ASIN_ACCESSORY_RELATED')?.activo === false && auto.targetsAuto?.find((t) => t.tipo === 'ASIN_SUBSTITUTE_RELATED')?.factorDePuja === 0.85)
    ok('Automática: las otras tres encendidas', auto.targetsAuto?.filter((t) => t.activo).length === 3)
    ok('Top of Search: 0 % salvo Dominio (15 %)', r.campanas.every((c) => (c.rol === 'MANUAL EXACTA / DOMINIO' ? c.topBusquedasPct === 15 : c.topBusquedasPct === 0)))
    const dom = r.campanas.find((c) => c.rol === 'MANUAL EXACTA / DOMINIO')!
    const ata = r.campanas.find((c) => c.rol === 'ATAQUE ASIN')!
    ok('pujas: Dominio por encima de la base y Ataque por debajo', dom.pujaBase > 0.8 && ata.pujaBase < 0.8, `${dom.pujaBase} / ${ata.pujaBase}`)
    ok('la suma de presupuestos es el total', Math.abs(r.campanas.reduce((a, c) => a + c.presupuestoDiario, 0) - 20) < 1e-9)
    ok('cada nombre sigue la nomenclatura', r.campanas.every((c) => c.nombre.startsWith('B0H5F7RJ5F | HATBOX-COWBOY | HAT BOX | ')))
  }
}

console.log('\n=== lo que se rechaza ANTES de tocar la cuenta ===')
{
  ok('presupuesto de 3 para 4 campañas', !planDeEstructura(producto, { presupuestoDiario: 3, pujaBase: 0.8 }).ok)
  ok('puja por debajo del mínimo de Amazon', !planDeEstructura(producto, { presupuestoDiario: 20, pujaBase: 0.01 }).ok)
  ok('resumen con «|»', !planDeEstructura({ ...producto, resumen: 'A | B' }, { presupuestoDiario: 20, pujaBase: 0.8 }).ok)
  ok('falta el SKU', !planDeEstructura({ ...producto, sku: ' ' }, { presupuestoDiario: 20, pujaBase: 0.8 }).ok)
  const largo = planDeEstructura({ ...producto, resumen: 'X'.repeat(120) }, { presupuestoDiario: 20, pujaBase: 0.8 })
  ok('nombre de más de 128 caracteres', !largo.ok && /128/.test(largo.error))
}

console.log('\n=== no crear dos veces lo mismo ===')
{
  const r = planDeEstructura(producto, { presupuestoDiario: 20, pujaBase: 0.8 })
  if (r.ok) {
    const ya = yaExistentes(r.campanas, ['otra campaña', 'b0h5f7rj5f | hatbox-cowboy | hat box | auto radar', 'B0H5F7RJ5F  |  HATBOX-COWBOY | HAT BOX | ATAQUE ASIN'])
    ok('detecta las existentes sin importar mayúsculas ni espacios', ya.size === 2 && ya.has('AUTO RADAR') && ya.has('ATAQUE ASIN'), [...ya].join(','))
    ok('si no hay ninguna, vacío', yaExistentes(r.campanas, []).size === 0)
  }
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
