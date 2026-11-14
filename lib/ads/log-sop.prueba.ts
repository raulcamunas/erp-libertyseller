import { aLogSop, fechaSop, textoParaPegar, tipoDeCampanaSop } from './log-sop'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** DEL LOG DEL ERP AL «LOGS MARKETING» DEL SOP: seis columnas, desplegable cerrado, solo lo aceptado y lo que no encaja se dice */

const C = (rol: string) => `B0FMS4L1QR | MONTE 002 - ES | JAMON SERRANO | ${rol}`
const e = (o: Partial<Parameters<typeof aLogSop>[0]>): Parameters<typeof aLogSop>[0] => ({ creadoAt: '2026-11-14T10:00:00Z', entidad: 'keyword', accion: 'cambiar', campo: null, valorAnterior: null, valorNuevo: null, motivo: null, nombreCampana: C('MANUAL AMPLIA'), ok: true, ...o })
const fila = (r: ReturnType<typeof aLogSop>) => ('fila' in r ? r.fila : null)

console.log('\n=== vocabulario ===')
ok('los roles del ERP al «Tipo de Campaña» del SOP', tipoDeCampanaSop(C('MANUAL AMPLIA')) === 'AMPLIA' && tipoDeCampanaSop(C('MANUAL EXACTA / DOMINIO')) === 'EXACTA DOMINIO' && tipoDeCampanaSop(C('AUTO RADAR')) === 'AUTO RADAR' && tipoDeCampanaSop('Campaña vieja') === '')
ok('fecha DD/MM/AAAA en hora de Madrid (las 23:30 UTC del 14 son el 15 en España)', fechaSop('2026-11-14T23:30:00Z') === '15/11/2026', fechaSop('2026-11-14T23:30:00Z'))
{
  const f = fila(aLogSop(e({ entidad: 'negativa', accion: 'negativizar', campo: 'palabra clave negativa exacta', valorNuevo: 'jamon iberico' })))
  ok('negativizar → «Negativizar» con el término', f?.accion === 'Negativizar' && f.keyword === 'jamon iberico' && f.tipoCampana === 'AMPLIA', JSON.stringify(f))
}
{
  const f = fila(aLogSop(e({ accion: 'promover', valorAnterior: 'AUTO RADAR', valorNuevo: 'jamon 7kg → MANUAL EXACTA / ESTABILIDAD', nombreCampana: C('MANUAL EXACTA / ESTABILIDAD') })))
  ok('cosechar → «Pasado a otra campaña», de AUTO RADAR a EXACTA ESTABILIDAD', f?.accion === 'Pasado a otra campaña' && f.keyword === 'jamon 7kg' && f.valorAnterior === 'AUTO RADAR' && f.nuevoValor === 'EXACTA ESTABILIDAD', JSON.stringify(f))
}
{
  const sube = fila(aLogSop(e({ campo: 'puja de «jamon serrano»', valorAnterior: '0,50', valorNuevo: '0,58' })))
  const baja = fila(aLogSop(e({ campo: 'puja', valorAnterior: '0,60', valorNuevo: '0,45', motivo: 'Cambio a mano en «jamón serrano»' })))
  ok('puja que sube → «Subir puja» con la keyword del campo', sube?.accion === 'Subir puja' && sube.keyword === 'jamon serrano', JSON.stringify(sube))
  ok('puja que baja hecha a mano → «Bajar puja» con la keyword del motivo', baja?.accion === 'Bajar puja' && baja.keyword === 'jamón serrano', JSON.stringify(baja))
}
ok('presupuesto → «Subir presupuesto» / «Bajar presupuesto»', fila(aLogSop(e({ entidad: 'campaña', campo: 'presupuesto diario', valorAnterior: '10,00', valorNuevo: '12,00' })))?.accion === 'Subir presupuesto' && fila(aLogSop(e({ entidad: 'campaña', campo: 'presupuesto diario', valorAnterior: '12,00', valorNuevo: '10,00' })))?.accion === 'Bajar presupuesto')
ok('un valor con punto también se entiende (0.62 < 0,70)', fila(aLogSop(e({ campo: 'puja', valorAnterior: '0,70', valorNuevo: '0.62' })))?.accion === 'Bajar puja')
ok('activar → «Reactivación»', fila(aLogSop(e({ accion: 'activar', campo: 'estado de «jamon»', valorAnterior: 'pausada', valorNuevo: 'activa' })))?.accion === 'Reactivación')
ok('crear campaña → «Campaña Nueva Creada» con su nombre', fila(aLogSop(e({ entidad: 'campaña', accion: 'crear', nombreCampana: C('AUTO RADAR') })))?.nuevoValor === C('AUTO RADAR'))

console.log('\n=== lo que se queda fuera ===')
{
  const pausa = aLogSop(e({ accion: 'pausar', campo: 'estado de «jamon»' }))
  ok('pausar NO se fuerza: se dice que no está en el vocabulario', 'fuera' in pausa && /Pausar no está/.test(pausa.fuera))
  ok('lo que Amazon rechazó no se pega', 'fuera' in aLogSop(e({ accion: 'negativizar', valorNuevo: 'x', ok: false })))
  ok('deshacer, tampoco', 'fuera' in aLogSop(e({ campo: 'deshacer' })))
}

console.log('\n=== el texto para pegar ===')
{
  const r = textoParaPegar([
    e({ creadoAt: '2026-11-14T12:00:00Z', entidad: 'negativa', accion: 'negativizar', valorNuevo: 'jamon\tiberico' }),
    e({ creadoAt: '2026-11-13T12:00:00Z', campo: 'puja de «jamon serrano»', valorAnterior: '0,50', valorNuevo: '0,58' }),
    e({ accion: 'pausar', campo: 'estado de «x»' }),
    e({ entidad: 'campaña', accion: 'cambiar', campo: 'modo del motor automático', valorNuevo: 'sugiere' }),
  ])
  const lineas = r.texto.split('\n')
  ok('dos filas, de la más antigua a la más nueva', r.filas === 2 && lineas[0].startsWith('jamon serrano\t') && lineas[1].startsWith('jamon iberico\t'), r.texto)
  ok('seis columnas separadas por tabulador (un tabulador dentro de una celda se limpia)', lineas.every((l) => l.split('\t').length === 6))
  ok('la pausa sale en «fuera» con su motivo; el cambio de modo, ni eso (no es de campaña)', r.fuera.length === 1 && /Pausar/.test(r.fuera[0].motivo), JSON.stringify(r.fuera))
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
