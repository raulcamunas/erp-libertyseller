import { vistaDesdeUrl, seccionDeRemesa } from '@/lib/fba/vista-url'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const ver = (x: unknown) => JSON.stringify(x)

/**
 * CASO 55 (spec remesas-pro §11.8): la URL abre la pantalla correcta, y los enlaces viejos de las alertas,
 * la campana y los correos siguen llevando donde llevaban.
 */

console.log('\nSin nada')
{
  const a = vistaDesdeUrl({}, 'agencia')
  ok('agencia → hoy', a.vista === 'hoy' && a.abrirIa === false && a.seccion === undefined, ver(a))
  const c = vistaDesdeUrl({}, 'cliente')
  ok('cliente externo → su vista cliente (resumen, «Mi stock»)', c.vista === 'cliente' && c.seccion === 'resumen', ver(c))
  const vacio = vistaDesdeUrl({ vista: '  ', cliente: '' }, 'agencia')
  ok('parámetros vacíos cuentan como que no están', vacio.vista === 'hoy' && vacio.clienteId === undefined, ver(vacio))
}

console.log('\n?cliente= sin vista (como hoy)')
{
  const r = vistaDesdeUrl({ cliente: 'X' }, 'agencia')
  ok('cliente/envios con su id', r.vista === 'cliente' && r.seccion === 'envios' && r.clienteId === 'X', ver(r))
  const c = vistaDesdeUrl({ cliente: 'X' }, 'cliente')
  ok('igual para el cliente externo', c.vista === 'cliente' && c.seccion === 'envios' && c.clienteId === 'X', ver(c))
  const s = vistaDesdeUrl({ cliente: 'X', seccion: 'ventas' }, 'agencia')
  ok('con ?seccion= válida, esa', s.vista === 'cliente' && s.seccion === 'ventas', ver(s))
  const arr = vistaDesdeUrl({ cliente: ['X', 'Y'] }, 'agencia')
  ok('parámetro repetido: el primero', arr.clienteId === 'X', ver(arr))
}

console.log('\n?ia=1')
{
  const r = vistaDesdeUrl({ cliente: 'X', ia: '1' }, 'agencia')
  ok('agencia: cliente del enlace y abre la propuesta a medida', r.vista === 'cliente' && r.clienteId === 'X' && r.abrirIa === true && r.seccion === 'propuestas', ver(r))
  const viejo = vistaDesdeUrl({ cliente: 'X', ia: '1', vista: 'envios' }, 'agencia')
  ok('gana a ?vista= vieja', viejo.vista === 'cliente' && viejo.abrirIa === true, ver(viejo))
  const c = vistaDesdeUrl({ cliente: 'X', ia: '1' }, 'cliente')
  ok('cliente externo: no se abre la IA', c.vista === 'cliente' && c.abrirIa === false, ver(c))
  const otro = vistaDesdeUrl({ cliente: 'X', ia: 'si' }, 'agencia')
  ok('solo ia=1 abre la IA', otro.abrirIa === false, ver(otro))
}

console.log('\n?remesa= sin vista')
{
  const prop = vistaDesdeUrl({ cliente: 'X', remesa: 'R' }, 'agencia', 'encajando')
  ok('propuesta (encajando) → propuestas', prop.vista === 'cliente' && prop.seccion === 'propuestas' && prop.remesaId === 'R' && prop.clienteId === 'X', ver(prop))
  const borr = vistaDesdeUrl({ remesa: 'R' }, 'agencia', 'borrador')
  ok('borrador → propuestas', borr.seccion === 'propuestas', ver(borr))
  const env = vistaDesdeUrl({ cliente: 'X', remesa: 'R' }, 'agencia', 'enviada')
  ok('enviada → envios', env.seccion === 'envios' && env.remesaId === 'R', ver(env))
  const cerr = vistaDesdeUrl({ remesa: 'R' }, 'cliente', 'cerrada')
  ok('cerrada → envios (también el cliente)', cerr.vista === 'cliente' && cerr.seccion === 'envios', ver(cerr))
  const nose = vistaDesdeUrl({ remesa: 'R' }, 'agencia')
  ok('sin saber el estado → envios', nose.seccion === 'envios', ver(nose))
  const conVista = vistaDesdeUrl({ remesa: 'R', vista: 'propuestas' }, 'agencia', 'enviada')
  ok('con ?vista= vieja manda la vista', conVista.seccion === 'propuestas' && conVista.remesaId === 'R', ver(conVista))
  ok('seccionDeRemesa(lista) = propuestas', seccionDeRemesa('lista') === 'propuestas')
  ok('seccionDeRemesa(null) = envios', seccionDeRemesa(null) === 'envios')
}

console.log('\n?envio=')
{
  const r = vistaDesdeUrl({ vista: 'plan', envio: 'E', cliente: 'X' }, 'agencia')
  ok('plan con el envío abierto (enlace de la campana)', r.vista === 'plan' && r.envioId === 'E' && r.clienteId === 'X', ver(r))
  const sin = vistaDesdeUrl({ envio: 'E' }, 'agencia')
  ok('sin vista también va al plan', sin.vista === 'plan' && sin.envioId === 'E', ver(sin))
  const otra = vistaDesdeUrl({ vista: 'hoy', envio: 'E' }, 'agencia')
  ok('el envío gana a otra vista', otra.vista === 'plan' && otra.envioId === 'E', ver(otra))
  const c = vistaDesdeUrl({ vista: 'plan', envio: 'E', cliente: 'X' }, 'cliente')
  ok('cliente externo: no hay plan ni envío', c.vista === 'cliente' && c.envioId === undefined, ver(c))
}

console.log('\nEnlaces viejos (§1.2)')
{
  const casos: Array<[string, string, string]> = [
    ['envios', 'cliente', 'envios'],
    ['propuestas', 'cliente', 'propuestas'],
    ['inventario', 'cliente', 'stock'],
    ['base', 'cliente', 'base'],
  ]
  for (const [vieja, vista, seccion] of casos) {
    const r = vistaDesdeUrl({ vista: vieja, cliente: 'X' }, 'agencia')
    ok(`?vista=${vieja} → ${vista}&seccion=${seccion}`, r.vista === vista && r.seccion === seccion && r.clienteId === 'X', ver(r))
  }
  const f = vistaDesdeUrl({ vista: 'fases' }, 'agencia')
  ok('?vista=fases → tablero&modo=fases', f.vista === 'tablero' && f.modo === 'fases', ver(f))
  const fc = vistaDesdeUrl({ vista: 'fases' }, 'cliente')
  ok('cliente externo: tablero reducido, sin fases', fc.vista === 'tablero' && fc.modo === undefined, ver(fc))
}

console.log('\nVistas de ahora')
{
  for (const v of ['hoy', 'plan', 'tablero', 'alertas'] as const) {
    const r = vistaDesdeUrl({ vista: v }, 'agencia')
    ok(`agencia ?vista=${v}`, r.vista === v && r.seccion === undefined, ver(r))
  }
  const t = vistaDesdeUrl({ vista: 'tablero', modo: 'fases' }, 'agencia')
  ok('tablero&modo=fases', t.vista === 'tablero' && t.modo === 'fases', ver(t))
  const cl = vistaDesdeUrl({ vista: 'cliente', cliente: 'X' }, 'agencia')
  ok('?vista=cliente sin sección → resumen', cl.vista === 'cliente' && cl.seccion === 'resumen', ver(cl))
  const mala = vistaDesdeUrl({ vista: 'cliente', seccion: 'nada' }, 'agencia')
  ok('sección que no existe → resumen', mala.seccion === 'resumen', ver(mala))
  const rara = vistaDesdeUrl({ vista: 'loquesea' }, 'agencia')
  ok('vista que no existe → hoy', rara.vista === 'hoy', ver(rara))
  const rep = vistaDesdeUrl({ vista: 'cliente', seccion: 'reposicion', cliente: 'X' }, 'agencia')
  ok('agencia abre reposicion', rep.seccion === 'reposicion', ver(rep))
}

console.log('\nEl cliente externo no abre lo de agencia')
{
  for (const v of ['hoy', 'plan', 'alertas']) {
    const r = vistaDesdeUrl({ vista: v, cliente: 'X' }, 'cliente')
    ok(`?vista=${v} → cliente`, r.vista === 'cliente' && r.seccion === 'resumen' && r.clienteId === 'X', ver(r))
  }
  const rep = vistaDesdeUrl({ vista: 'cliente', seccion: 'reposicion' }, 'cliente')
  ok('sección reposicion → resumen', rep.vista === 'cliente' && rep.seccion === 'resumen', ver(rep))
  const sinVista = vistaDesdeUrl({ seccion: 'reposicion', cliente: 'X' }, 'cliente')
  ok('reposicion sin vista → resumen', sinVista.seccion === 'resumen', ver(sinVista))
  const t = vistaDesdeUrl({ vista: 'tablero', modo: 'fases' }, 'cliente')
  ok('tablero reducido (D39), sin fases', t.vista === 'tablero' && t.modo === undefined, ver(t))
  const lotes = vistaDesdeUrl({ vista: 'cliente', seccion: 'lotes' }, 'cliente')
  ok('sus secciones sí (lotes)', lotes.seccion === 'lotes', ver(lotes))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
