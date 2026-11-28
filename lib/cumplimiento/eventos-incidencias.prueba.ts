import { eventosDeIncidencias } from './eventos-incidencias'
import type { Incidencia } from './tipos'

let fallos = 0
const ok = (n: string, c: boolean, x?: unknown) => (c ? console.log('✓', n) : (fallos++, console.error('✗', n, x ?? '')))
const inc = (codigo: string, gravedad: Incidencia['gravedad'], desde: string): Incidencia => ({ codigo, gravedad, mensaje: `m${codigo}`, atributos: [], categorias: [], acciones: [], exencion: null, tema: 'otros' as Incidencia['tema'], desde })
const ahora = new Date('2026-11-28T12:00:00Z')
const previas = new Map([['A', [inc('1', 'error', '2026-11-27T12:00:00Z'), inc('9', 'aviso', '2026-11-20T00:00:00Z')]]])
const ev = eventosDeIncidencias(
  [
    { sku: 'A', con_stock: true, incidencias: [inc('2', 'error', '2026-11-28T12:00:00Z'), inc('9', 'aviso', '2026-11-20T00:00:00Z')] },
    { sku: 'B', con_stock: false, incidencias: [inc('3', 'error', '2026-11-28T12:00:00Z')] },
    { sku: 'N', con_stock: false, incidencias: [inc('4', 'error', '2026-11-28T12:00:00Z')] },
  ],
  previas,
  (sku) => sku !== 'N',
  ahora,
)
ok('se cierra la 1 tras 24 h', ev.some((e) => e.sku === 'A' && e.codigo === '1' && e.evento === 'cerrada' && e.horas === 24), ev)
ok('se abre la 2', ev.some((e) => e.sku === 'A' && e.codigo === '2' && e.evento === 'abierta' && e.con_stock))
ok('B limpio antes: se abre la 3', ev.some((e) => e.sku === 'B' && e.codigo === '3' && e.evento === 'abierta'))
ok('los avisos no cuentan', !ev.some((e) => e.codigo === '9'))
ok('primera revisión: nada', !ev.some((e) => e.sku === 'N'))
ok('total 3', ev.length === 3, ev.length)
if (fallos) process.exit(1)
