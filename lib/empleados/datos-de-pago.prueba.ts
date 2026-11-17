import { clabeValida, cuentaResumida, ibanValido, rutaValida, validarDatos } from './datos-de-pago'

let fallos = 0
const ok = (n: string, c: boolean, extra = '') => {
  if (!c) fallos++
  console.log(`  ${c ? 'OK   ' : 'FALLO'} ${n}${!c && extra ? ` → ${extra}` : ''}`)
}

console.log('=== dígitos de control ===')
// Ejemplos públicos de documentación (no son cuentas de nadie del equipo)
ok('CLABE de ejemplo de Banxico', clabeValida('002010077777777771'))
ok('CLABE con un dígito cambiado', !clabeValida('002010077777777772'))
ok('CLABE corta', !clabeValida('00201007777777777'))
ok('IBAN español de ejemplo', ibanValido('ES91 2100 0418 4502 0005 1332'))
ok('IBAN con un dígito cambiado', !ibanValido('ES91 2100 0418 4502 0005 1333'))
ok('ruta de Bank of America (pública)', rutaValida('026009593'))
ok('ruta inventada', !rutaValida('123456789'))

console.log('\n=== el formulario ===')
const base = { titular: 'Ana Pérez López', calle: 'Calle Mayor 1', ciudad: 'Bogotá', estado: 'Cundinamarca', codigoPostal: '110111', pais: 'Colombia', banco: 'Bancolombia', paisBanco: 'Colombia', moneda: 'cop' }
const co = validarDatos({ ...base, tipo: 'co', numeroCuenta: '123 456 789 01', documento: '1.020.304.050', tipoCuentaBancaria: 'ahorros' })
ok('Colombia completo', co.ok, JSON.stringify(co))
if (co.ok) ok('limpia espacios, puntos y pone la moneda en mayúsculas', co.datos.numeroCuenta === '12345678901' && co.datos.documento === '1020304050' && co.datos.moneda === 'COP')
const us = validarDatos({ ...base, tipo: 'us', estado: '', numeroRuta: '026009593', numeroCuenta: '12345678', tipoCuentaBancaria: 'corriente' })
ok('EE. UU. sin estado: error en el estado', !us.ok && 'estado' in us.errores)
const mx = validarDatos({ ...base, tipo: 'mx', clabe: '002010077777777772' })
ok('CLABE mal copiada: error en la CLABE', !mx.ok && 'clabe' in mx.errores)
const otro = validarDatos({ ...base, tipo: 'otro', numeroCuenta: 'AB1234' })
ok('otro país sin SWIFT: error', !otro.ok && 'swift' in otro.errores)
const sinApellido = validarDatos({ ...base, titular: 'Ana', tipo: 'iban', iban: 'ES9121000418450200051332' })
ok('sin apellidos: error en el titular', !sinApellido.ok && 'titular' in sinApellido.errores)
const iban = validarDatos({ ...base, tipo: 'iban', iban: 'es91 2100 0418 4502 0005 1332', swift: 'caixesbbxxx' })
ok('IBAN y SWIFT en minúsculas se aceptan', iban.ok && iban.datos.iban === 'ES9121000418450200051332' && iban.datos.swift === 'CAIXESBBXXX', JSON.stringify(iban))
if (iban.ok) ok('resumen con las 4 últimas', cuentaResumida(iban.datos) === '…1332')
ok('tipo inventado', !validarDatos({ ...base, tipo: 'xx' }).ok)

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
