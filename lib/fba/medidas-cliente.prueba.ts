import { cajaDeducida, medirCadencia, medirRecepcion, medirTransporte, mercadoDeRemesa } from './medidas-cliente'

let fallos = 0
const ok = (n: string, real: unknown, esp: unknown) => {
  const bien = JSON.stringify(real) === JSON.stringify(esp)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK  ' : 'FALLA'} ${n}${bien ? '' : ` -> esperado ${JSON.stringify(esp)}, real ${JSON.stringify(real)}`}`)
}

const HOY = '2026-11-15'

console.log('\n=== RECEPCIÓN (del primer Receipt al 90 %, p75 de los 6 últimos) ===')
{
  // Creative Toys: +17, +31, +11 y +10 días → p75 (interpolado) = 17 + 0,25 × 14 = 20,5 → 21
  const env = (inicio: string, dias: number) => {
    const fin = new Date(Date.parse(`${inicio}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10)
    return { enviadas: 100, receipts: [{ fecha: inicio, cantidad: 40 }, { fecha: fin, cantidad: 55 }] }
  }
  const envios = [env('2026-06-01', 17), env('2026-07-01', 31), env('2026-08-01', 11), env('2026-09-01', 10)]
  ok('Creative Toys 17, 31, 11, 10 → 21', medirRecepcion(envios, HOY), 21)
  ok('solo los 6 más recientes (uno viejo de 90 días no cuenta)', medirRecepcion([env('2025-01-01', 90), ...envios, env('2026-10-01', 12), env('2026-10-15', 12)], HOY), 16)
  ok('sin llegar al 90 % no se mide', medirRecepcion([{ enviadas: 100, receipts: [{ fecha: '2026-10-01', cantidad: 50 }] }], HOY), null)
  ok('sin Receipts → null', medirRecepcion([{ enviadas: 30, receipts: [] }], HOY), null)
  ok('todo el mismo día → 0', medirRecepcion([{ enviadas: 30, receipts: [{ fecha: '2026-10-01', cantidad: 30 }] }], HOY), 0)
  ok('lo de después de hoy no cuenta', medirRecepcion([{ enviadas: 30, receipts: [{ fecha: '2026-11-10', cantidad: 10 }, { fecha: '2026-11-20', cantidad: 20 }] }], HOY), null)
}

console.log('\n=== TRANSPORTE (envío → primer Receipt) ===')
ok('mediana 6, 16, 20 → 16', medirTransporte([
  { fechaEnvio: '2026-10-01', primerReceipt: '2026-10-07' },
  { fechaEnvio: '2026-09-01', primerReceipt: '2026-09-17' },
  { fechaEnvio: '2026-08-01', primerReceipt: '2026-08-21' },
  { fechaEnvio: '2026-07-01', primerReceipt: null },
]), 16)
ok('negativos fuera; sin nada → null', medirTransporte([{ fechaEnvio: '2026-10-10', primerReceipt: '2026-10-01' }]), null)

console.log('\n=== 50 · CADENCIA ===')
ok('6, 21, 29 oct y 13 nov, 100-126 ud → ~13 días y ~110 ud', medirCadencia([
  { fechaEnvio: '2026-10-06', unidades: 100 },
  { fechaEnvio: '2026-10-21', unidades: 105 },
  { fechaEnvio: '2026-10-29', unidades: 115 },
  { fechaEnvio: '2026-11-13', unidades: 126 },
]), { cadenciaDias: 13, tamanoTipico: 110 })
ok('dos números de Amazon el mismo día son un envío', medirCadencia([
  { fechaEnvio: '2026-10-01', unidades: 60 }, { fechaEnvio: '2026-10-01', unidades: 50 },
  { fechaEnvio: '2026-10-11', unidades: 110 }, { fechaEnvio: '2026-10-21', unidades: 110 },
]), { cadenciaDias: 10, tamanoTipico: 110 })
ok('una pausa de verano (> 3 × mediana) no es la cadencia', medirCadencia([
  { fechaEnvio: '2026-05-01', unidades: 50 }, { fechaEnvio: '2026-09-01', unidades: 50 },
  { fechaEnvio: '2026-09-10', unidades: 50 }, { fechaEnvio: '2026-09-20', unidades: 50 }, { fechaEnvio: '2026-09-30', unidades: 50 },
]), { cadenciaDias: 10, tamanoTipico: 50 })
ok('solo las 8 últimas', medirCadencia([
  { fechaEnvio: '2025-01-01', unidades: 999 },
  ...Array.from({ length: 8 }, (_, i) => ({ fechaEnvio: `2026-10-${String(1 + i * 3).padStart(2, '0')}`, unidades: 30 })),
]), { cadenciaDias: 3, tamanoTipico: 30 })
ok('un solo envío: sin cadencia, con tamaño', medirCadencia([{ fechaEnvio: '2026-10-01', unidades: 80 }]), { cadenciaDias: null, tamanoTipico: 80 })
ok('nada → nulls', medirCadencia([]), { cadenciaDias: null, tamanoTipico: null })

console.log('\n=== 49 · CAJA DEDUCIDA ===')
ok('90, 180, 270 → 90', cajaDeducida([90, 180, 270]), 90)
ok('18, 36 → 18', cajaDeducida([18, 36]), 18)
ok('7, 11 → null', cajaDeducida([7, 11]), null)
ok('una sola cantidad → null', cajaDeducida([48]), null)
ok('MCD 4 (< 6) → null', cajaDeducida([12, 16]), null)
ok('una remesa de 7 contradice la caja de 90 (es menor): en la duda, null', cajaDeducida([90, 180, 270, 7]), null)
ok('divide al 80 % y no pasa de la menor → 24', cajaDeducida([24, 48, 72, 96, 100]), 24)
ok('Opinas W6-WW4G-JIR0: 49, 98, 15, 34 → null (no hay caja de 49)', cajaDeducida([49, 98, 15, 34]), null)
ok('Opinas 80-HGPJ-1F82: 25, 162, 25, 50, 100, 74 → null', cajaDeducida([25, 162, 25, 50, 100, 74]), null)
ok('la del encaje manda', cajaDeducida([90, 180], 12), 12)
ok('encaje no válido → se deduce', cajaDeducida([90, 180], 0), 90)
ok('se repite en 2 envíos iguales', cajaDeducida([50, 50]), 50)

console.log('\n=== 59 · MERCADO DE LA REMESA ===')
ok('Portico (NA, sin enviadas) → Estados Unidos', mercadoDeRemesa(null, 'na'), 'ATVPDKIKX0DER')
ok('UE sin enviadas → España', mercadoDeRemesa(null, 'eu'), 'A1RKKUPIHCS9HS')
ok('la última enviada manda (aunque la lectura sea APJ6)', mercadoDeRemesa('A13V1IB3VIYZZH', 'eu'), 'A13V1IB3VIYZZH')
ok('sin nada → España', mercadoDeRemesa(null, null), 'A1RKKUPIHCS9HS')
ok('vacía → la región', mercadoDeRemesa('  ', 'na'), 'ATVPDKIKX0DER')

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
if (fallos > 0) process.exit(1)
