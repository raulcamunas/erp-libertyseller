import { capacidadDelDia, constructorDeCapacidad, manualEsperado, type SalientesPorHora } from '@/lib/correo/secuencias/capacidad'
import { instanteDeMadrid } from '@/lib/correo/secuencias/fechas'
import { RAMPA_POR_DEFECTO } from '@/lib/correo/secuencias/reglas'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== la cuenta de un día ===')
{
  const base = { tope: 70, manualHecho: 0, manualEsperado: 0, automaticosHechos: 0, automaticosProgramados: 0 }
  ok('un día vacío cabe el tope entero', capacidadDelDia(base) === 70)
  ok('lo que la persona manda a mano se resta', capacidadDelDia({ ...base, manualEsperado: 30 }) === 40)
  ok('lo que ya salió de secuencias y lo programado también', capacidadDelDia({ ...base, manualEsperado: 30, automaticosHechos: 5, automaticosProgramados: 10 }) === 25)
  ok('si ha mandado más a mano de lo esperado, manda lo real', capacidadDelDia({ ...base, manualEsperado: 30, manualHecho: 45 }) === 25)
  ok('si ha mandado menos de lo esperado, se reserva lo esperado', capacidadDelDia({ ...base, manualEsperado: 30, manualHecho: 10 }) === 40)
  ok('nunca sale negativo', capacidadDelDia({ ...base, manualHecho: 90 }) === 0)
}

console.log('\n=== lo que suele mandar a mano ===')
{
  // hoy es miércoles 28 de octubre de 2026: sus 5 días hábiles anteriores son mar 27, lun 26, vie 23, jue 22, mié 21
  const hist = (valores: Record<string, number>) => new Map(Object.entries(valores))
  ok('sin historial, cero', manualEsperado(new Map(), '2026-10-28', []) === 0)
  ok('constante: esa cifra', manualEsperado(hist({ '2026-10-27': 40, '2026-10-26': 40, '2026-10-23': 40, '2026-10-22': 40, '2026-10-21': 40 }), '2026-10-28', []) === 40)
  ok('si va a más, pesa el último día (la media se queda corta)', manualEsperado(hist({ '2026-10-27': 50, '2026-10-26': 40, '2026-10-23': 30, '2026-10-22': 20, '2026-10-21': 10 }), '2026-10-28', []) === 50)
  ok('si va a menos, pesa la media', manualEsperado(hist({ '2026-10-27': 10, '2026-10-26': 20, '2026-10-23': 30, '2026-10-22': 40, '2026-10-21': 50 }), '2026-10-28', []) === 30)
  ok('el fin de semana no cuenta como un cero', manualEsperado(hist({ '2026-10-27': 20, '2026-10-26': 20, '2026-10-24': 0, '2026-10-25': 0, '2026-10-23': 20, '2026-10-22': 20, '2026-10-21': 20 }), '2026-10-28', []) === 20)
  ok('un día hábil sin envíos sí cuenta como cero', manualEsperado(hist({ '2026-10-27': 50 }), '2026-10-28', []) === 50 && manualEsperado(hist({ '2026-10-23': 50 }), '2026-10-28', []) === 10)
  ok('un festivo tampoco cuenta', manualEsperado(hist({ '2026-10-27': 20, '2026-10-26': 20, '2026-10-23': 20, '2026-10-22': 20, '2026-10-21': 20 }), '2026-10-28', ['2026-10-26']) === 20)
  ok('hoy no entra en su propia estimación', manualEsperado(hist({ '2026-10-28': 500 }), '2026-10-28', []) === 0)
}

console.log('\n=== la función que usa el planificador ===')
{
  const ahora = instanteDeMadrid('2026-10-28', 600)
  const B1 = 'buzon-1'
  const B2 = 'buzon-2'
  const fila = (buzonId: string, dia: string, hora: number, total: number, automaticos = 0): SalientesPorHora => ({ buzonId, dia, hora, total, automaticos })
  const buzones = new Map([
    [B1, { rampaInicio: '2026-10-20', topeFijo: null }],
    [B2, { rampaInicio: null, topeFijo: 25 }],
  ])
  // B1 lleva funcionando desde el 20 de oct: el 28 es su día hábil 7 -> tope 70. Mandó a mano 30 al día los últimos días
  const salientes = [
    fila(B1, '2026-10-27', 10, 20), fila(B1, '2026-10-27', 11, 10),
    fila(B1, '2026-10-26', 10, 30), fila(B1, '2026-10-23', 10, 30), fila(B1, '2026-10-22', 10, 30), fila(B1, '2026-10-21', 10, 30),
    // hoy: 12 a mano y 3 automáticos
    fila(B1, '2026-10-28', 9, 8, 1), fila(B1, '2026-10-28', 10, 7, 2),
  ]
  const programados = [
    { buzonId: B1, en: instanteDeMadrid('2026-10-28', 800) },
    { buzonId: B1, en: instanteDeMadrid('2026-10-29', 600) },
    { buzonId: B1, en: instanteDeMadrid('2026-10-29', 700) },
  ]
  const capacidad = constructorDeCapacidad({ buzones, rampa: RAMPA_POR_DEFECTO, festivos: [], salientes, programados, ahora })

  ok('hoy: 70 − 30 que suele mandar a mano − 3 automáticos ya salidos − 1 programado = 36', capacidad(B1, '2026-10-28') === 36, String(capacidad(B1, '2026-10-28')))
  // mañana es su octavo día hábil de funcionamiento: sube al tercer tramo de la rampa (100)
  ok('mañana (su octavo día, tope 100): 100 − 30 − 2 programados = 68', capacidad(B1, '2026-10-29') === 68, String(capacidad(B1, '2026-10-29')))
  ok('pasado mañana, sin nada programado: 100 − 30 = 70', capacidad(B1, '2026-10-30') === 70, String(capacidad(B1, '2026-10-30')))
  ok('un buzón con tope fijo usa su tope: 25 − 0', capacidad(B2, '2026-10-29') === 25)
  ok('un buzón sin historial ni programados cabe entero', capacidad(B2, '2026-10-28') === 25)
  ok('un buzón desconocido no recibe nada', capacidad('otro', '2026-10-29') === 0)
  const alLimite = constructorDeCapacidad({
    buzones, rampa: RAMPA_POR_DEFECTO, festivos: [], salientes: [fila(B1, '2026-10-28', 9, 80)], programados: [], ahora,
  })
  ok('si a mano ya ha pasado del tope, hoy no cabe nada', alLimite(B1, '2026-10-28') === 0)
  ok('y mañana sigue contando con lo que suele mandar a mano (la estimación coge el día de hoy en el historial solo después)', alLimite(B1, '2026-10-29') === 100)
  // el cuarto día de funcionamiento sube a 70: antes de eso el tope es 40
  const nuevo = constructorDeCapacidad({ buzones: new Map([[B1, { rampaInicio: '2026-10-27', topeFijo: null }]]), rampa: RAMPA_POR_DEFECTO, festivos: [], salientes: [], programados: [], ahora })
  ok('un buzón que empezó ayer tiene el tope del primer tramo (40) hoy y mañana', nuevo(B1, '2026-10-28') === 40 && nuevo(B1, '2026-10-29') === 40)
  ok('y a partir de su cuarto día hábil, el segundo tramo (70)', nuevo(B1, '2026-11-02') === 70)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
