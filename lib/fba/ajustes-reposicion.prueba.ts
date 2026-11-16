import { AJUSTES_DE_PARTIDA, ajustesDesdeFila, esCampanaValida, validarAjustes } from './ajustes-reposicion'
import type { MedidasCliente } from './plan-tipos'

let fallos = 0
const ok = (n: string, real: unknown, esp: unknown) => {
  const bien = JSON.stringify(real) === JSON.stringify(esp)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK  ' : 'FALLA'} ${n}${bien ? '' : ` -> esperado ${JSON.stringify(esp)}, real ${JSON.stringify(real)}`}`)
}

const sinMedidas: MedidasCliente = { transporteMediano: null, recepcionP75: null, enviosMedidos: 0, cadenciaDias: null, tamanoTipico: null }
const medido = (cadenciaDias: number | null, tamanoTipico: number | null): MedidasCliente =>
  ({ transporteMediano: 16, recepcionP75: 11, enviosMedidos: 6, cadenciaDias, tamanoTipico })

console.log('\n=== VALORES DE PARTIDA ===')
ok('partida = 45/90/null/3/30/7/null/1,8/null/null/true/true', [
  AJUSTES_DE_PARTIDA.coberturaObjetivo, AJUSTES_DE_PARTIDA.coberturaMaxima, AJUSTES_DE_PARTIDA.multiploCaja,
  AJUSTES_DE_PARTIDA.minLinea, AJUSTES_DE_PARTIDA.minEnvio, AJUSTES_DE_PARTIDA.ventanaAgrupacion,
  AJUSTES_DE_PARTIDA.capacidadUnidades, AJUSTES_DE_PARTIDA.topeEstacional, AJUSTES_DE_PARTIDA.campanaHasta,
  AJUSTES_DE_PARTIDA.transporteUrgenteDias, AJUSTES_DE_PARTIDA.activo, AJUSTES_DE_PARTIDA.avisarChat,
], [45, 90, null, 3, 30, 7, null, 1.8, null, null, true, true])

console.log('\n=== FILA NULL ===')
ok('fila null y sin medidas = partida', ajustesDesdeFila(null, null), AJUSTES_DE_PARTIDA)
ok('fila null y medidas vacías = partida', ajustesDesdeFila(null, sinMedidas), AJUSTES_DE_PARTIDA)

console.log('\n=== FILA PARCIAL ===')
{
  const a = ajustesDesdeFila({ client_id: 'c', cobertura_objetivo_dias: 60, multiplo_caja: 18, tope_estacional: '3.50', planificador_activo: false }, null)
  ok('cobertura objetivo manual', a.coberturaObjetivo, 60)
  ok('la máxima sigue de partida', a.coberturaMaxima, 90)
  ok('caja manual', a.multiploCaja, 18)
  ok('tope estacional llega como texto', a.topeEstacional, 3.5)
  ok('planificador apagado', a.activo, false)
  ok('avisar sigue de partida', a.avisarChat, true)
  ok('mínimo por línea de partida', a.minLinea, 3)
  ok('origen todo de partida', a.origen, { minEnvio: 'partida', ventanaAgrupacion: 'partida' })
}
{
  const a = ajustesDesdeFila({ cobertura_objetivo_dias: 120 }, null)
  ok('objetivo 120 sin máxima: la máxima sube a 120', a.coberturaMaxima, 120)
  const b = ajustesDesdeFila({ cobertura_objetivo_dias: null, cobertura_max_dias: null, campana_hasta: '12-18' }, null)
  ok('NULL en la fila = partida', [b.coberturaObjetivo, b.coberturaMaxima], [45, 90])
  ok('campaña bien escrita', b.campanaHasta, '12-18')
}

console.log('\n=== VALORES MEDIDOS (D14) ===')
{
  const a = ajustesDesdeFila(null, medido(9, 110))
  ok('ventana = cadencia de 9 días', a.ventanaAgrupacion, 9)
  ok('mínimo por envío = 40 % de 110 = 44', a.minEnvio, 44)
  ok('origen medido', a.origen, { minEnvio: 'medido', ventanaAgrupacion: 'medido' })
}
ok('cadencia de 1 día se acota a 3', ajustesDesdeFila(null, medido(1, null)).ventanaAgrupacion, 3)
ok('cadencia de 45 días se acota a 30', ajustesDesdeFila(null, medido(45, null)).ventanaAgrupacion, 30)
ok('cadencia 12,6 se redondea a 13', ajustesDesdeFila(null, medido(12.6, null)).ventanaAgrupacion, 13)
ok('tamaño típico 1 → mínimo 1 (no 0)', ajustesDesdeFila(null, medido(null, 1)).minEnvio, 1)
ok('tamaño típico 0 → de partida', ajustesDesdeFila(null, medido(null, 0)).origen.minEnvio, 'partida')
{
  const a = ajustesDesdeFila({ ventana_agrupacion_dias: 0, min_unidades_envio: 100 }, medido(9, 110))
  ok('lo manual gana a lo medido (ventana 0 = no agrupar)', [a.ventanaAgrupacion, a.minEnvio], [0, 100])
  ok('origen manual', a.origen, { minEnvio: 'manual', ventanaAgrupacion: 'manual' })
}
{
  const a = ajustesDesdeFila({ min_unidades_envio: 50 }, medido(9, 110))
  ok('mezcla: mínimo manual y ventana medida', a.origen, { minEnvio: 'manual', ventanaAgrupacion: 'medido' })
}

console.log('\n=== FILA CON VALORES FUERA DE RANGO (se acotan al leer) ===')
{
  const a = ajustesDesdeFila({ cobertura_objetivo_dias: 999, multiplo_caja: 0, tope_estacional: 20, campana_hasta: '13-01' }, null)
  ok('objetivo 999 → 180', a.coberturaObjetivo, 180)
  ok('máxima sube con la objetivo', a.coberturaMaxima, 180)
  ok('caja 0 → 1', a.multiploCaja, 1)
  ok('tope 20 → 8', a.topeEstacional, 8)
  ok('campaña mal escrita en la fila → null', a.campanaHasta, null)
}

console.log('\n=== FIN DE CAMPAÑA ===')
ok('12-18 vale', esCampanaValida('12-18'), true)
ok('02-29 vale', esCampanaValida('02-29'), true)
ok('02-30 no', esCampanaValida('02-30'), false)
ok('04-31 no', esCampanaValida('04-31'), false)
ok('12/18 no', esCampanaValida('12/18'), false)
ok('1-5 no', esCampanaValida('1-5'), false)

console.log('\n=== VALIDAR EL PUT ===')
{
  const r = validarAjustes({ coberturaObjetivo: 60, topeEstacional: '2,5', campanaHasta: '12-18', avisarChat: false })
  ok('parcial correcto', r, {
    ok: true,
    cambios: { cobertura_objetivo_dias: 60, tope_estacional: 2.5, campana_hasta: '12-18', avisar_chat: false },
    avisos: [],
  })
}
{
  const r = validarAjustes({ cobertura_max_dias: 400, multiploCaja: 12.4, ventanaAgrupacion: -3, topeEstacional: 1.234 })
  ok('acota a los CHECK', r.ok && r.cambios, { cobertura_max_dias: 365, multiplo_caja: 12, ventana_agrupacion_dias: 0, tope_estacional: 1.23 })
  ok('avisa de lo acotado (2)', r.ok && r.avisos.length, 2)
}
{
  const r = validarAjustes({ minEnvio: null, campanaHasta: '', capacidadUnidades: '' })
  ok('null y vacío vuelven a NULL', r.ok && r.cambios, { min_unidades_envio: null, campana_hasta: null, capacidad_unidades: null })
}
{
  const r = validarAjustes({ campanaHasta: '18-12' })
  ok('campaña 18-12 es error', r.ok, false)
  ok('el error lo dice', !r.ok && r.errores[0].includes('12-18'), true)
}
ok('campaña 02-30 es error', validarAjustes({ campanaHasta: '02-30' }).ok, false)
ok('campaña como número es error', validarAjustes({ campanaHasta: 1218 }).ok, false)
ok('texto en un número es error', validarAjustes({ coberturaObjetivo: 'mucho' }).ok, false)
ok('activo null es error', validarAjustes({ activo: null }).ok, false)
ok('activo "true" (texto) es error', validarAjustes({ activo: 'true' }).ok, false)
ok('cuerpo vacío es error', validarAjustes({}).ok, false)
ok('cuerpo null es error', validarAjustes(null).ok, false)
ok('lista es error', validarAjustes([1, 2]).ok, false)
ok('máxima < objetivo en el mismo PUT es error', validarAjustes({ coberturaObjetivo: 90, coberturaMaxima: 60 }).ok, false)
ok('máxima < objetivo guardada es error', validarAjustes({ coberturaMaxima: 60 }, { cobertura_objetivo_dias: 90 }).ok, false)
ok('subir la objetivo sin máxima guardada vale', validarAjustes({ coberturaObjetivo: 120 }, { cobertura_max_dias: null }).ok, true)
ok('mismo campo con dos nombres es error', validarAjustes({ minLinea: 3, min_unidades_linea: 4 }).ok, false)
{
  const r = validarAjustes({ clienteId: 'x', inventado: 3, minLinea: 5 })
  ok('clave desconocida se ignora con aviso; clienteId en silencio', r.ok && [r.cambios, r.avisos.length], [{ min_unidades_linea: 5 }, 1])
}

console.log(fallos === 0 ? '\n  TODO CORRECTO\n' : `\n  ${fallos} FALLOS\n`)
process.exit(fallos === 0 ? 0 : 1)
