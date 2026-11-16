/** Pruebas del turno de los informes: `npx tsx lib/analisis-amazon/turnos.prueba.ts` */
import { comercialDe, cumplimientoDelTurno, estadoDelTurno, hechosDelTurno, idPorNombre, normalizarNombre, ORDEN_DE_COMERCIALES, Repartidor, RESTO, simularTurnos, trasHecho, type EstadoDelTurno } from './turnos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const [A, M, D, J, N] = ORDEN_DE_COMERCIALES.map((c) => c.id)
const nombreDe = new Map<string, string>(ORDEN_DE_COMERCIALES.map((c) => [c.id, c.nombre[0]]))
nombreDe.set(RESTO, 'R')
type E = { lead: string; c: string | null }
const id = (v: E) => v.c
const am = (c: string | null, n: number, p = 'a'): E[] => Array.from({ length: n }, (_, i) => ({ lead: `${p}-${c ?? 'x'}-${i}`, c }))
const vacio: EstadoDelTurno = { ultimoGrupo: null, ultimoTipoPor: new Map() }
const tira = (xs: Array<{ grupo: string; tipo: string }>) => xs.map((x) => `${nombreDe.get(x.grupo)}${x.tipo === 'amazon' ? 'a' : 's'}`).join(' ')

console.log('\n=== nombres ===')
ok('normalizar', normalizarNombre('  JOSÉ García ') === 'jose' && normalizarNombre(null) === '')
const perfiles = [
  { id: 'd1', full_name: 'Daniela' },
  { id: 'd2', full_name: 'Daniella ' },
  { id: 'j1', full_name: 'José' },
  { id: 'x1', full_name: 'Ana López' },
  { id: 'x2', full_name: 'Ana Ruiz' },
]
const mapa = idPorNombre(perfiles)
ok('exacto: Daniela', mapa.get('daniela') === 'd1')
ok('«Daniella» no casa con «Daniela»', comercialDe({ comercial: 'Daniella' }, mapa) === 'd2' && comercialDe({ comercial: 'Daniela' }, mapa) === 'd1')
ok('sin tilde casa', comercialDe({ comercial: 'Jose' }, mapa) === 'j1')
ok('ambiguo → null', comercialDe({ comercial: 'Ana' }, mapa) === null)
ok('el id manda sobre el nombre', comercialDe({ comercial: 'José', comercialId: 'zz' }, mapa) === 'zz')
ok('sin comercial → null', comercialDe({}, mapa) === null)

console.log('\n=== orden A → M → D → J → N ===')
// Como hoy: Naomi no tiene Amazon, Maoli no tiene sin Amazon
const pendAm = [...am(A, 5), ...am(D, 5), ...am(J, 5), ...am(M, 5)]
const pendSin = [...am(D, 5, 's'), ...am(N, 5, 's'), ...am(A, 5, 's'), ...am(J, 5, 's'), ...am(null, 5, 's')]
const t1 = simularTurnos(pendAm, pendSin, id, vacio, 10)
ok('empieza por Alejandro y sigue el orden', tira(t1) === 'Aa Ma Da Ja Ns As Ma Ds Js Ns', tira(t1))
ok('se salta a quien no le queda de un tipo (Naomi solo sin, Maoli solo Amazon)', t1.filter((x) => x.grupo === N).every((x) => x.tipo === 'sin') && t1.filter((x) => x.grupo === M).every((x) => x.tipo === 'amazon'))

const tras = estadoDelTurno([{ comercialId: D, tipo: 'sin' }, { comercialId: M, tipo: 'amazon' }, { comercialId: A, tipo: 'sin' }])
const t2 = simularTurnos(pendAm, pendSin, id, tras, 3)
ok('reanuda tras el último (Daniela → José)', tira(t2) === 'Ja Ns Aa', tira(t2))
ok('alterna el tipo por persona (Alejandro hizo sin → ahora Amazon)', t2[2].grupo === A && t2[2].tipo === 'amazon')

const deResto = estadoDelTurno([{ comercialId: 'yarima', tipo: 'sin' }])
ok('si el último fue del resto, empieza por el primero', simularTurnos(pendAm, pendSin, id, deResto, 1)[0].grupo === A)

console.log('\n=== se salta a quien no le queda nada ===')
const soloAD = simularTurnos(am(A, 2), am(D, 3, 's'), id, vacio, 6)
ok('Alejandro y Daniela, y al acabarse Alejandro solo Daniela', tira(soloAD) === 'Aa Ds Aa Ds Ds', tira(soloAD))

console.log('\n=== prioridad interna intacta ===')
const colaA = [{ lead: 'sin-contactar', c: A }, { lead: 'fase2', c: A }, { lead: 'no-interesa', c: A }]
const t3 = simularTurnos(colaA, [], id, vacio, 3)
ok('dentro de cada comercial, el orden del fichero', t3.map((x) => (x.v as E).lead).join(',') === 'sin-contactar,fase2,no-interesa')

console.log('\n=== el resto, al final ===')
const conResto = simularTurnos([...am('yarima', 2), ...am(A, 1)], [...am('sharon', 2, 's'), ...am(null, 1, 's')], id, vacio, 7)
ok('primero los cinco; luego el resto alternando y en el orden del fichero', tira(conResto) === 'Aa Ra Rs Ra Rs Rs', tira(conResto))
ok('el resto conserva el orden del fichero', (conResto[1].v as E).c === 'yarima' && (conResto[2].v as E).c === 'sharon' && (conResto[4].v as E).c === 'sharon' && (conResto[5].v as E).c === null)

console.log('\n=== colas que se acaban ===')
ok('las dos vacías → null', new Repartidor<E, E>([], [], id).siguiente(vacio) === null)
const r = new Repartidor(am(A, 1), am(J, 1, 's'), id)
const e1 = r.siguiente(vacio)!
r.quitar(e1)
const e2 = r.siguiente(trasHecho(vacio, e1))!
r.quitar(e2)
ok('se acaban y da null', e1.grupo === A && e2.grupo === J && r.siguiente(vacio) === null)

console.log('\n=== un saltado no consume el turno ===')
const r2 = new Repartidor(am(A, 3), am(M, 3), id)
let est = vacio
const x1 = r2.siguiente(est)!
r2.quitar(x1) // saltado: no se llama a trasHecho
const x2 = r2.siguiente(est)!
ok('tras un saltado sigue el mismo comercial con su siguiente', x1.grupo === A && x2.grupo === A && (x2.v as E).lead === `a-${A}-1`)
r2.quitar(x2)
est = trasHecho(est, x2)
ok('tras un hecho pasa al siguiente', r2.siguiente(est)!.grupo === M)

console.log('\n=== empates de tipo ===')
ok('sin tipo previo y con los dos, empieza por Amazon', simularTurnos(am(A, 1), am(A, 1, 's'), id, vacio, 1)[0].tipo === 'amazon')
const t4 = simularTurnos(am(A, 3), am(A, 3, 's'), id, vacio, 4)
ok('una sola persona con las dos colas alterna', tira(t4) === 'Aa As Aa As', tira(t4))

console.log('\n=== el turno sale de la bitácora (comercial de la cola), no del dueño actual ===')
// L2 se hizo en el hueco de Alejandro (la cola decía Alejandro) y luego el lead pasó a Daniela
const informesDB = [
  { comercialId: D, tipo: 'amazon' as const, at: '2026-11-16T10:00:00Z', lead: 'L2' }, // hoy es de Daniela
  { comercialId: N, tipo: 'sin' as const, at: '2026-11-16T09:00:00Z', lead: 'L1' },
  { comercialId: J, tipo: 'sin' as const, at: '2026-11-15T09:00:00Z', lead: 'L0' }, // de antes de la bitácora
]
const bit = [
  { at: '2026-11-16T09:00:01Z', tipo: 'sin' as const, lead: 'L1', comercialId: N, resultado: 'hecho' },
  { at: '2026-11-16T09:30:00Z', tipo: 'amazon' as const, lead: 'LX', comercialId: M, resultado: 'saltado' },
  { at: '2026-11-16T10:00:01Z', tipo: 'amazon' as const, lead: 'L2', comercialId: A, resultado: 'hecho' },
]
const hb = hechosDelTurno(bit, informesDB, 25)
ok('manda la bitácora: el último es de Alejandro, no de Daniela', hb[0].comercialId === A && estadoDelTurno(hb).ultimoGrupo === A, JSON.stringify(hb))
ok('ni saltados ni repetidos; lo anterior a la bitácora, del dueño actual', hb.map((h) => h.lead).join(',') === 'L2,L1,L0' && hb[2].comercialId === J, hb.map((h) => h.lead).join(','))
const sigue = simularTurnos([...am(A, 1), ...am(M, 1), ...am(D, 1), ...am(J, 1)], [], id, estadoDelTurno(hb), 1)
ok('tras Alejandro le toca a Maoli (con assigned_to habría saltado a José)', sigue[0]?.grupo === M)
ok('bitácora vacía (justo tras el despliegue) → dueño actual', hechosDelTurno([], informesDB, 25)[0].comercialId === D && hechosDelTurno([], informesDB, 2).length === 2)

console.log('\n=== cumplimiento ===')
const todos = new Set([A, M, D, J, N])
ok('orden perfecto = 100 %', cumplimientoDelTurno([A, M, D, J, N, A].map((c) => ({ comercialId: c })), todos) === 1)
ok('saltarse a quien no le queda cuenta como bien', cumplimientoDelTurno([A, D, J, N].map((c) => ({ comercialId: c })), new Set([A, D, J, N])) === 1)
ok('el orden viejo (A D J M) no cumple', (cumplimientoDelTurno([A, D, J, M, A].map((c) => ({ comercialId: c })), todos) ?? 1) < 0.5)
ok('menos de dos → null', cumplimientoDelTurno([{ comercialId: A }], todos) === null)

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien')
process.exit(fallos ? 1 : 0)
