import { validarAjustes, validarAjustesDeBuzon } from '@/lib/correo/secuencias/ajustes'
import { AJUSTES_POR_DEFECTO } from '@/lib/correo/secuencias/reglas'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const A = AJUSTES_POR_DEFECTO
const err = (r: ReturnType<typeof validarAjustes>): string => (r.ok ? '' : r.error)

console.log('\n=== lo que se acepta ===')
{
  const r = validarAjustes({ topeHora: 30, huecoGlobalS: 60, pesoMananaPct: 50 }, A)
  ok('números en rango', r.ok && r.cambios.columnas.tope_hora === 30 && r.cambios.columnas.hueco_global_s === 60 && r.cambios.resultado.pesoMananaPct === 50)
  const e = validarAjustes({ modoEnsayo: false }, A)
  ok('quitar el ensayo con el motor apagado no manda nada: no pide confirmación', e.ok && e.cambios.columnas.modo_ensayo === false)
  const rampa = validarAjustes({ rampa: [{ desde: 1, tope: 50 }, { desde: 5, tope: 120 }, { desde: 12, tope: 200 }] }, A)
  ok('una rampa creciente', rampa.ok && (rampa.cambios.columnas.rampa as unknown[]).length === 3)
  const f = validarAjustes({ festivos: ['2026-12-25', '2026-12-08', '2026-12-25'] }, A)
  ok('los festivos se ordenan y no se repiten', f.ok && (f.cambios.columnas.festivos as string[]).join() === '2026-12-08,2026-12-25')
  const v = validarAjustes({ ventanaDesdeMin: 600, ventanaHastaMin: 1020 }, A)
  ok('una ventana de 10 a 17', v.ok && v.cambios.resultado.ventanaDesdeMin === 600 && v.cambios.resultado.ventanaHastaMin === 1020)
}

console.log('\n=== lo que se rechaza, con una frase clara ===')
{
  ok('algo que no es un objeto', !validarAjustes('hola', A).ok && !validarAjustes(null, A).ok && !validarAjustes([], A).ok)
  ok('sin ningún cambio', err(validarAjustes({}, A)).includes('ningún cambio'))
  ok('un booleano que no lo es', err(validarAjustes({ activa: 'si' }, A)).includes('verdadero o falso'))
  ok('un número con decimales', err(validarAjustes({ topeHora: 10.5 }, A)).includes('entero'))
  ok('un número como texto', err(validarAjustes({ topeHora: '25' }, A)).includes('entero'))
  ok('fuera de rango', err(validarAjustes({ topeHora: 0 }, A)).includes('entre 1 y 500') && err(validarAjustes({ huecoGlobalS: 2 }, A)).includes('entre 5 y 3600') && err(validarAjustes({ pesoMananaPct: 101 }, A)).includes('entre 0 y 100'))
  ok('una ventana al revés', err(validarAjustes({ ventanaDesdeMin: 1000, ventanaHastaMin: 900 }, A)).includes('posterior'))
  ok('una ventana que solo mueve una punta y queda al revés', err(validarAjustes({ ventanaDesdeMin: 1100 }, A)).includes('posterior'))
  ok('rampa vacía o enorme', err(validarAjustes({ rampa: [] }, A)).includes('entre 1 y 12') && err(validarAjustes({ rampa: Array.from({ length: 13 }, (_, i) => ({ desde: i + 1, tope: 10 })) }, A)).includes('entre 1 y 12'))
  ok('rampa que no empieza el día 1', err(validarAjustes({ rampa: [{ desde: 2, tope: 10 }] }, A)).includes('día 1'))
  ok('rampa desordenada o con un día repetido', err(validarAjustes({ rampa: [{ desde: 1, tope: 10 }, { desde: 5, tope: 20 }, { desde: 5, tope: 30 }] }, A)).includes('de menor a mayor'))
  ok('un tramo roto', err(validarAjustes({ rampa: [{ desde: 1 }] }, A)).includes('entero') && err(validarAjustes({ rampa: ['x'] }, A)).includes('no se entiende'))
  ok('un tope absurdo', err(validarAjustes({ rampa: [{ desde: 1, tope: 5000 }] }, A)).includes('entre 1 y 1000'))
  ok('festivos que no son fechas', err(validarAjustes({ festivos: ['2026-13-45'] }, A)).includes('fechas válidas') && err(validarAjustes({ festivos: 'navidad' }, A)).includes('no se entiende'))
}

console.log('\n=== el envío real exige confirmación ===')
{
  const enEnsayoYApagado = { ...A, activa: false, modoEnsayo: true }
  ok('encender en ensayo no pide nada (no sale ningún correo)', validarAjustes({ activa: true }, enEnsayoYApagado).ok)
  ok('quitar el ensayo con el motor encendido SIN confirmar se rechaza', err(validarAjustes({ modoEnsayo: false }, { ...A, activa: true, modoEnsayo: true })).includes('confirmarlo'))
  ok('y con confirmación pasa, con un aviso', (() => { const r = validarAjustes({ modoEnsayo: false, confirmarEnvioReal: true }, { ...A, activa: true, modoEnsayo: true }); return r.ok && r.avisos.some((a) => a.includes('envío real')) })())
  ok('encender el motor ya sin ensayo también se rechaza sin confirmar', err(validarAjustes({ activa: true, modoEnsayo: false }, enEnsayoYApagado)).includes('confirmarlo'))
  ok('si ya enviaba de verdad, tocar otros ajustes no lo vuelve a pedir', validarAjustes({ topeHora: 20 }, { ...A, activa: true, modoEnsayo: false }).ok)
  ok('una confirmación que no es «true» no vale', err(validarAjustes({ modoEnsayo: false, confirmarEnvioReal: 'true' }, { ...A, activa: true, modoEnsayo: true })).includes('confirmarlo'))
  ok('apagar el motor nunca pide nada', validarAjustes({ activa: false }, { ...A, activa: true, modoEnsayo: false }).ok)
}

console.log('\n=== avisos ===')
{
  const r = validarAjustes({ rampa: [{ desde: 1, tope: 400 }] }, A)
  ok('un tope por encima de 300 avisa pero guarda', r.ok && r.avisos.some((a) => a.includes('300')))
  const h = validarAjustes({ ventanaDesdeMin: 360, ventanaHastaMin: 1320 }, A)
  ok('un horario muy fuera de lo habitual avisa', h.ok && h.avisos.some((a) => a.includes('habitual')))
}

console.log('\n=== los ajustes de un buzón ===')
{
  const b = validarAjustesDeBuzon({ participa: false, topeDiario: 60, llamadasDesdeMin: 600, llamadasHastaMin: 960 })
  ok('un cambio completo', b.ok && b.cambios.participa === false && b.cambios.topeDiario === 60 && b.cambios.llamadasHastaMin === 960)
  ok('el tope fijo se puede quitar con null', (() => { const r = validarAjustesDeBuzon({ topeDiario: null }); return r.ok && r.cambios.topeDiario === null })())
  ok('quitar la pausa', (() => { const r = validarAjustesDeBuzon({ quitarPausa: true }); return r.ok && r.cambios.quitarPausa === true })())
  ok('no se pausa y despausa a la vez', !validarAjustesDeBuzon({ quitarPausa: true, pausarHastaMañana: true }).ok)
  ok('las horas de llamadas al revés', !validarAjustesDeBuzon({ llamadasDesdeMin: 900, llamadasHastaMin: 800 }).ok)
  ok('un tope fuera de rango o raro', !validarAjustesDeBuzon({ topeDiario: 0 }).ok && !validarAjustesDeBuzon({ topeDiario: 5000 }).ok && !validarAjustesDeBuzon({ topeDiario: 'mucho' }).ok)
  ok('vacío', !validarAjustesDeBuzon({}).ok)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
