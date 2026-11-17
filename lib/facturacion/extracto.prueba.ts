import { conceptoPayset, decidir, fechaPayset, leerExtractoPayset, nombreNormalizado, seParecen, type Contexto, type Linea } from './extracto'

let fallos = 0
const ok = (nombre: string, cond: boolean, extra = '') => {
  if (!cond) fallos++
  console.log(`  ${cond ? 'OK   ' : 'FALLO'} ${nombre}${!cond && extra ? ` → ${extra}` : ''}`)
}

console.log('=== el CSV de Payset ===')
{
  const csv = `﻿Payset ID,Date,Account,Counterparty name,Description,Money in,Money out,Balance
TX-1,"Nov 10, 2026",MT63CFTE28004000000000007017942,"GFY LOGISTIC, S.L.","Incoming transfer; GFY LOGISTIC, S.L.; Tapas Party . Noviembre 2026",261.50,,261.50
TX-2,"Nov 10, 2026",MT63CFTE28004000000000007017942,Pay Set Limited,Fee transfer; Pay Set Limited; Tapas Party . Noviembre 2026 (fee),,2.40,259.10`
  const r = leerExtractoPayset(csv)
  ok('lee las dos filas', r.ok && r.filas.length === 2)
  if (r.ok) {
    ok('entrada en positivo', r.filas[0].importe === 261.5)
    ok('salida en negativo', r.filas[1].importe === -2.4)
    ok('fecha', r.filas[0].fecha === '2026-11-10')
    ok('contraparte con coma', r.filas[0].contraparte === 'GFY LOGISTIC, S.L.')
    ok('concepto sin el tipo ni el nombre', conceptoPayset(r.filas[0]) === 'Tapas Party . Noviembre 2026', conceptoPayset(r.filas[0]))
    ok('saldo', r.filas[1].saldo === 259.1)
  }
  ok('otro CSV: error claro', !leerExtractoPayset('Account name,Date,Amount\nx,2026-01-01,3').ok)
  ok('fechas', fechaPayset('Sep 3, 2026') === '2026-09-03' && fechaPayset('2026-11-02') === '2026-11-02' && fechaPayset('5/11/2026') === '2026-11-05')
}

console.log('\n=== nombres ===')
ok('From y forma jurídica fuera', nombreNormalizado('From GFY LOGISTIC S.L.') === nombreNormalizado('GFY LOGISTIC, S.L.'), nombreNormalizado('From GFY LOGISTIC S.L.'))
ok('se parecen por una palabra con sustancia', seParecen('Tapas Party . Noviembre 2026', 'Tapas Party | Noviembre 2026'))
ok('no se parecen solo por el mes', !seParecen('Enviado por Banco Santander noviembre', 'Eduardo | Noviembre 2026'))

console.log('\n=== qué es cada línea ===')
const cuentas = [
  { id: 'pEUR', nombre: 'Payset EUR', moneda: 'EUR', esPayset: true },
  { id: 'pAED', nombre: 'Payset AED', moneda: 'AED', esPayset: true },
  { id: 'pUSD', nombre: 'Payset USD', moneda: 'USD', esPayset: true },
  { id: 'wEUR', nombre: 'Wio EUR', moneda: 'EUR', esPayset: false },
  { id: 'wAED', nombre: 'Wio AED', moneda: 'AED', esPayset: false },
]
const fac = (id: string, numero: string, clienteId: string, cliente: string, saldo: number, fecha = '2026-11-06') => ({ id, numero, clienteId, cliente, moneda: 'EUR', saldo, fecha })
const ctx: Contexto = {
  cuentas,
  cuentaComisiones: 'COM',
  facturas: [
    fac('f1', 'Tapas Party | Noviembre 2026', 'cGFY', 'GFY Logis tic S.L (Jamones Tapas Party + Pokershop)', 261.5),
    fac('f2', 'Eduardo | Noviembre 2026', 'cEDU', 'Eduardo Gómez', 550),
    fac('f3', 'Cobo Family | Noviembre 2026', 'cCOBO', 'Cobo Family', 721.04),
    fac('f4', 'Keslem | Noviembre 2026', 'cKES', 'Keslem', 750),
    fac('f5', 'Solter | Noviembre 2026', 'cSOL', 'Solter', 1900),
  ],
  aprendido: [
    // Como lo deja Zoho tras casar un cobro de Payset: el pagador solo está en la descripción
    { clave: nombreNormalizado('GFY LOGISTIC, S.L. · Tapas Party . Octubre 2026'), clienteId: 'cGFY' },
    { clave: nombreNormalizado('Keslem'), clienteId: 'cKES' },
    { clave: nombreNormalizado('GOMEZ GARRACHON EDUARDO'), clienteId: 'cEDU' },
    { clave: nombreNormalizado('From FEELING STREET S.L.'), clienteId: 'cKES' },
    { clave: nombreNormalizado('Zoho zoho zoho corp'), cuentaGasto: 'IT' },
  ],
  patas: [{ id: 'pata1', cuentaId: 'wAED', fecha: '2026-11-18', importe: 4000 }],
}
const L = (id: string, cuentaId: string, importe: number, payee: string, concepto: string, fecha = '2026-11-17'): Linea => ({ id, cuentaId, moneda: cuentas.find((c) => c.id === cuentaId)!.moneda, fecha, importe: Math.abs(importe), entrada: importe > 0, payee, concepto })
const lineas = [
  L('a', 'pEUR', 261.5, 'GFY LOGISTIC, S.L.', 'Tapas Party . Noviembre 2026'),
  L('b', 'pEUR', -2.4, 'Pay Set Limited', 'Tapas Party . Noviembre 2026 (fee)'),
  L('c', 'pEUR', 261.5, 'GFY LOGISTIC, S.L.', 'Tapas Party . Noviembre 2026'),
  L('d', 'pEUR', 550, 'GOMEZ GARRACHON EDUARDO', 'Enviado por Banco Santander'),
  L('e', 'wEUR', 716.65, '', 'From FEELING STREET S.L.'),
  L('f', 'pEUR', 721.04, 'COBOFAMILY S.L.', 'Factura Noviembre Cobofamily-Liberty Seller'),
  L('g', 'pEUR', 999, 'Desconocido SL', 'algo'),
  L('h', 'wEUR', -200, '', 'EUR to AED', '2026-11-09'),
  L('i', 'wAED', 799.37, '', 'EUR to AED', '2026-11-09'),
  L('j', 'wAED', -1134, '', 'Zoho zoho zoho corp'),
  L('k', 'wAED', -55.89, '', 'Parking'),
  L('l', 'pAED', -4000, 'LIBERTY SELLER MARKETING MANAGEMENT - FZCO', 'Traspaso a Wio'),
  L('m', 'wAED', 4000, '', 'From LIBERTY SELLER MARKETING', '2026-11-19'),
  L('n', 'wAED', -12.11, '', 'Foreign exchange transaction fee'),
]
const acc = decidir(lineas, ctx)
const de = (id: string) => acc.find((a) => ('linea' in a ? a.linea.id === id : a.sale.id === id || a.entra.id === id))
const t = (id: string) => de(id)?.tipo
ok('cobro de Tapas Party por lo aprendido', t('a') === 'cobro' && (de('a') as { factura: { id: string } }).factura.id === 'f1')
ok('comisión de Payset', t('b') === 'gasto' && (de('b') as { cuentaGasto: string }).cuentaGasto === 'COM')
ok('el pago duplicado de Tapas Party se queda para revisar', t('c') === 'revisar', JSON.stringify(de('c')))
ok('Eduardo: lo aprendido manda aunque el concepto no diga su nombre', t('d') === 'cobro')
const swift = de('e') as { tipo: string; comision: number; factura: { id: string } }
ok('Keslem por SWIFT: cobro de la factura entera con la comisión', swift?.tipo === 'cobro' && swift.factura.id === 'f4' && swift.comision === 33.35, JSON.stringify(swift))
ok('Cobo Family sin historial, por el nombre', t('f') === 'cobro')
ok('desconocido: a revisar', t('g') === 'revisar')
const cambio = de('h') as { tipo: string; entra: { id: string } }
ok('EUR to AED en Wio: un cambio con sus dos patas', cambio?.tipo === 'cambio' && cambio.entra.id === 'i')
ok('Zoho: el gasto de la última vez', t('j') === 'gasto' && (de('j') as { cuentaGasto: string }).cuentaGasto === 'IT')
ok('parking nuevo: a revisar', t('k') === 'revisar')
ok('Payset AED a Liberty Seller: envío a Wio AED', t('l') === 'envio' && (de('l') as { destino: { id: string } }).destino.id === 'wAED')
ok('la llegada a Wio se casa con la pata ya apuntada', t('m') === 'casar')
ok('comisión de Wio por tarjeta', t('n') === 'gasto')
ok('cada línea tiene una sola decisión', new Set(acc.flatMap((a) => ('linea' in a ? [a.linea.id] : [a.sale.id, a.entra.id]))).size === lineas.length)
ok('Solter (1.900) no se ha tocado', !acc.some((a) => a.tipo === 'cobro' && a.factura.id === 'f5'))

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
