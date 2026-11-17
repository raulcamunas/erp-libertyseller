/**
 * LOS DATOS DE PAGO DE UN EMPLEADO: QUÉ SE PIDE SEGÚN EL PAÍS Y CÓMO SE COMPRUEBA.
 *
 * PURO (lo usan el formulario público, para avisar al escribir, y el servidor, que es quien manda). Se comprueban los dígitos de control que tienen
 * dígito de control —CLABE, IBAN, número de ruta de EE. UU.—: un número mal copiado se para aquí y no en un pago devuelto a fin de mes.
 */

export const TIPOS_DE_CUENTA = ['us', 'mx', 'co', 'iban', 'otro'] as const
export type TipoDeCuenta = (typeof TIPOS_DE_CUENTA)[number]

export const NOMBRE_DEL_TIPO: Record<TipoDeCuenta, string> = {
  us: 'Estados Unidos',
  mx: 'México',
  co: 'Colombia',
  iban: 'Europa (IBAN)',
  otro: 'Otro país',
}

export const MONEDAS_DE_COBRO = ['USD', 'MXN', 'COP', 'EUR', 'otra'] as const

export interface DatosDePago {
  tipo: TipoDeCuenta
  titular: string
  // Dirección del titular
  calle: string
  ciudad: string
  estado: string
  codigoPostal: string
  pais: string
  // Banco
  banco: string
  paisBanco: string
  moneda: string
  swift?: string
  // Según el tipo
  numeroCuenta?: string
  numeroRuta?: string
  tipoCuentaBancaria?: 'corriente' | 'ahorros'
  clabe?: string
  documento?: string
  iban?: string
}

const soloDigitos = (s: unknown) => String(s ?? '').replace(/[\s.-]/g, '')
const texto = (s: unknown, max = 120) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** CLABE: 18 dígitos y el último es de control (pesos 3, 7, 1) */
export function clabeValida(c: string): boolean {
  if (!/^\d{18}$/.test(c)) return false
  const pesos = [3, 7, 1]
  let suma = 0
  for (let i = 0; i < 17; i++) suma += (Number(c[i]) * pesos[i % 3]) % 10
  return (10 - (suma % 10)) % 10 === Number(c[17])
}

/** IBAN: módulo 97 */
export function ibanValido(iban: string): boolean {
  const i = iban.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(i)) return false
  const reordenado = i.slice(4) + i.slice(0, 4)
  let resto = 0
  for (const ch of reordenado) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch
    for (const d of v) resto = (resto * 10 + Number(d)) % 97
  }
  return resto === 1
}

/** Número de ruta (ABA) de EE. UU.: 9 dígitos con su suma de control 3-7-1 */
export function rutaValida(r: string): boolean {
  if (!/^\d{9}$/.test(r)) return false
  const d = r.split('').map(Number)
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0
}

export const swiftValido = (s: string) => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(s)

/** Comprueba y limpia lo que llega del formulario. Los errores van por campo, para enseñarlos al lado de cada uno */
export function validarDatos(entrada: Record<string, unknown>): { ok: true; datos: DatosDePago } | { ok: false; errores: Record<string, string> } {
  const e: Record<string, string> = {}
  const tipo = String(entrada.tipo ?? '') as TipoDeCuenta
  if (!TIPOS_DE_CUENTA.includes(tipo)) e.tipo = 'Elige el país de tu cuenta'

  const d: DatosDePago = {
    tipo,
    titular: texto(entrada.titular),
    calle: texto(entrada.calle, 160),
    ciudad: texto(entrada.ciudad),
    estado: texto(entrada.estado),
    codigoPostal: texto(entrada.codigoPostal, 20),
    pais: texto(entrada.pais, 60),
    banco: texto(entrada.banco),
    paisBanco: texto(entrada.paisBanco, 60),
    moneda: texto(entrada.moneda, 10).toUpperCase(),
  }
  if (d.titular.length < 4 || !d.titular.includes(' ')) e.titular = 'Pon nombre y apellidos, como en el banco'
  if (d.calle.length < 4) e.calle = 'Falta la calle y el número'
  if (d.ciudad.length < 2) e.ciudad = 'Falta la ciudad'
  if (d.codigoPostal.length < 3) e.codigoPostal = 'Falta el código postal'
  if (d.pais.length < 2) e.pais = 'Falta el país'
  if (tipo === 'us' && d.estado.length < 2) e.estado = 'En EE. UU. hace falta el estado'
  if (d.banco.length < 2) e.banco = 'Falta el nombre del banco'
  if (d.paisBanco.length < 2) e.paisBanco = 'Falta el país del banco'
  if (!d.moneda) e.moneda = 'Elige la moneda en la que cobras'

  const swift = soloDigitos(entrada.swift).toUpperCase()
  if (swift) {
    if (swiftValido(swift)) d.swift = swift
    else e.swift = 'El SWIFT/BIC tiene 8 u 11 letras y números (p. ej. BOFAUS3N)'
  }

  if (tipo === 'us') {
    d.numeroRuta = soloDigitos(entrada.numeroRuta)
    d.numeroCuenta = soloDigitos(entrada.numeroCuenta)
    const t = String(entrada.tipoCuentaBancaria ?? '')
    if (!rutaValida(d.numeroRuta)) e.numeroRuta = 'El número de ruta (routing / ABA) tiene 9 dígitos: revísalo'
    if (!/^\d{4,17}$/.test(d.numeroCuenta)) e.numeroCuenta = 'El número de cuenta tiene entre 4 y 17 dígitos'
    if (t === 'corriente' || t === 'ahorros') d.tipoCuentaBancaria = t
    else e.tipoCuentaBancaria = 'Elige corriente (checking) o ahorros (savings)'
  } else if (tipo === 'mx') {
    d.clabe = soloDigitos(entrada.clabe)
    if (!clabeValida(d.clabe)) e.clabe = 'La CLABE tiene 18 dígitos y esta no cuadra: cópiala otra vez de tu banco'
  } else if (tipo === 'co') {
    d.numeroCuenta = soloDigitos(entrada.numeroCuenta)
    d.documento = soloDigitos(entrada.documento)
    const t = String(entrada.tipoCuentaBancaria ?? '')
    if (!/^\d{6,20}$/.test(d.numeroCuenta)) e.numeroCuenta = 'El número de cuenta tiene entre 6 y 20 dígitos'
    if (!/^\d{5,12}$/.test(d.documento)) e.documento = 'Pon tu número de cédula, solo los dígitos'
    if (t === 'corriente' || t === 'ahorros') d.tipoCuentaBancaria = t
    else e.tipoCuentaBancaria = 'Elige ahorros o corriente'
  } else if (tipo === 'iban') {
    d.iban = String(entrada.iban ?? '').replace(/\s+/g, '').toUpperCase()
    if (!ibanValido(d.iban)) e.iban = 'El IBAN no es válido: revisa que esté completo'
  } else if (tipo === 'otro') {
    d.numeroCuenta = String(entrada.numeroCuenta ?? '').replace(/\s+/g, '').toUpperCase().slice(0, 40)
    if (d.numeroCuenta.length < 4) e.numeroCuenta = 'Falta el número de cuenta'
    if (!d.swift) e.swift = 'Para otros países hace falta el SWIFT/BIC del banco'
  }

  return Object.keys(e).length ? { ok: false, errores: e } : { ok: true, datos: d }
}

/** Las 4 últimas cifras de la cuenta, para enseñarla sin enseñarla */
export function cuentaResumida(d: DatosDePago): string {
  const n = d.iban ?? d.clabe ?? d.numeroCuenta ?? ''
  return n ? `…${n.slice(-4)}` : ''
}
