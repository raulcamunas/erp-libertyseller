import { cuandoEs, describirLlamada, fusionarHistorial, grabacionDisponible, type LlamadaDelHistorial } from '@/lib/cold-calling/historial'
import type { ColdLeadNote } from '@/lib/types/cold-leads'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * EL HISTORIAL DE UN LEAD: llamadas de Rinkel y apuntes, en una línea de tiempo.
 *
 * Lo que se vigila: el orden (lo más reciente arriba, y a la misma hora la llamada antes que el apunte), que cada tipo de
 * llamada se cuente con su palabra y su color —un contestador NO es una llamada contestada—, que una grabación caducada no
 * se ofrezca y que los días sean los de Madrid.
 */

const nota = (id: string, cuando: string, extra: Partial<ColdLeadNote> = {}): ColdLeadNote => ({ id, lead_id: 'l1', author_id: 'u1', kind: 'nota', body: 'texto', occurred_at: cuando, created_at: cuando, ...extra })
const llamada = (id: string, fecha: string, extra: Partial<LlamadaDelHistorial> = {}): LlamadaDelHistorial => ({ id, user_id: 'u1', fecha, direccion: 'outbound', duracion_s: 0, estado: 'MISSED', numero: '+34910210465', numero_anonimo: false, grabacion_id: null, grabacion_hasta: null, ...extra })

console.log('\n=== el orden ===')
{
  const h = fusionarHistorial(
    [nota('n1', '2026-10-20T10:00:00.000Z'), nota('n2', '2026-10-22T09:00:00.000Z')],
    [llamada('c1', '2026-10-21T10:00:00.000Z'), llamada('c2', '2026-10-22T09:00:00.000Z')]
  )
  ok('lo más reciente arriba, mezclando llamadas y notas', h.map((x) => x.id).join() === 'c2,n2,c1,n1', h.map((x) => x.id).join())
  ok('a la misma hora, la llamada antes que el apunte que se escribió sobre ella', h[0].tipo === 'llamada' && h[1].tipo === 'nota')
  ok('sin nada, una lista vacía', fusionarHistorial([], []).length === 0)
  ok('solo notas o solo llamadas también', fusionarHistorial([nota('n', '2026-10-20T10:00:00.000Z')], []).length === 1 && fusionarHistorial([], [llamada('c', '2026-10-20T10:00:00.000Z')]).length === 1)
  const a = fusionarHistorial([], [llamada('b', '2026-10-20T10:00:00.000Z'), llamada('a', '2026-10-20T10:00:00.000Z')])
  ok('con todo igual, el orden es estable por id', a.map((x) => x.id).join() === 'a,b')
}

console.log('\n=== cómo se cuenta cada llamada ===')
{
  const saliente = describirLlamada(llamada('x', '2026-10-21T10:00:00.000Z', { estado: 'ANSWERED', duracion_s: 192 }))
  ok('saliente contestada: verde, con la duración', saliente.icono === 'saliente' && saliente.tono === 'verde' && saliente.titulo === 'Llamada saliente' && saliente.resultado === 'contestada · 3:12' && saliente.contestada)

  const contestador = describirLlamada(llamada('x', '2026-10-21T10:00:00.000Z', { estado: 'ANSWERED', duracion_s: 8 }))
  ok('saliente de 8 s: es un contestador, NO una llamada contestada', contestador.icono === 'contestador' && contestador.tono === 'gris' && contestador.resultado === 'contestador · 0:08' && !contestador.contestada)

  const justo = describirLlamada(llamada('x', '2026-10-21T10:00:00.000Z', { estado: 'ANSWERED', duracion_s: 10 }))
  ok('a los 10 s justos ya cuenta como contestada', justo.contestada && justo.resultado === 'contestada · 0:10')

  const sin = describirLlamada(llamada('x', '2026-10-21T10:00:00.000Z', { estado: 'MISSED' }))
  ok('saliente que nadie cogió: sin respuesta, en gris', sin.icono === 'sin_respuesta' && sin.tono === 'gris' && sin.resultado === 'sin respuesta' && !sin.contestada)

  const entrante = describirLlamada(llamada('x', '2026-10-21T10:00:00.000Z', { direccion: 'inbound', estado: 'ANSWERED', duracion_s: 64 }))
  ok('entrante contestada: cian', entrante.icono === 'entrante' && entrante.tono === 'cian' && entrante.titulo === 'Llamada entrante' && entrante.resultado === 'contestada · 1:04')

  const perdida = describirLlamada(llamada('x', '2026-10-21T10:00:00.000Z', { direccion: 'inbound', estado: 'MISSED' }))
  ok('entrante que no se cogió: perdida, en rojo', perdida.icono === 'perdida' && perdida.tono === 'rojo' && perdida.resultado === 'perdida')

  const entranteCorta = describirLlamada(llamada('x', '2026-10-21T10:00:00.000Z', { direccion: 'inbound', estado: 'ANSWERED', duracion_s: 4 }))
  ok('una entrante de 4 s tampoco es una conversación: para quien llamó es una perdida', entranteCorta.icono === 'perdida' && !entranteCorta.contestada)

  ok('el teléfono se lee con espacios', saliente.telefono === '+34 910 21 04 65')
  const oculto = describirLlamada(llamada('x', '2026-10-21T10:00:00.000Z', { numero: null, numero_anonimo: true }))
  const sinNumero = describirLlamada(llamada('x', '2026-10-21T10:00:00.000Z', { numero: null, numero_anonimo: false }))
  ok('un número oculto o ausente no rompe nada', oculto.telefono === 'Número oculto' && sinNumero.telefono === 'Sin número')
}

console.log('\n=== la grabación ===')
{
  const ahora = Date.parse('2026-10-22T12:00:00.000Z')
  ok('sin grabación no se ofrece', !grabacionDisponible(llamada('x', '2026-10-21T10:00:00.000Z'), ahora))
  ok('con grabación y sin fecha de caducidad, sí', grabacionDisponible(llamada('x', '2026-10-21T10:00:00.000Z', { grabacion_id: 'r1' }), ahora))
  ok('con grabación que caduca más adelante, sí', grabacionDisponible(llamada('x', '2026-10-21T10:00:00.000Z', { grabacion_id: 'r1', grabacion_hasta: '2027-01-19T00:00:00.000Z' }), ahora))
  ok('caducada (Rinkel las guarda 90 días): no', !grabacionDisponible(llamada('x', '2026-05-01T10:00:00.000Z', { grabacion_id: 'r1', grabacion_hasta: '2026-07-30T00:00:00.000Z' }), ahora))
}

console.log('\n=== cuándo pasó, en días de Madrid ===')
{
  const ahora = new Date('2026-10-22T12:00:00.000Z') // las 14:00 del jueves 22 en Madrid (verano)
  ok('hoy', cuandoEs('2026-10-22T09:42:00.000Z', ahora) === 'hoy 11:42', cuandoEs('2026-10-22T09:42:00.000Z', ahora))
  ok('ayer', cuandoEs('2026-10-21T15:20:00.000Z', ahora) === 'ayer 17:20')
  ok('antes de ayer: día de la semana, número y mes', cuandoEs('2026-10-19T08:05:00.000Z', ahora) === 'lun 19 oct · 10:05', cuandoEs('2026-10-19T08:05:00.000Z', ahora))
  ok('de otro año: con el año', cuandoEs('2025-12-31T09:00:00.000Z', ahora) === '31 dic 2025 · 10:00', cuandoEs('2025-12-31T09:00:00.000Z', ahora))
  // 22:30 UTC del 21 son las 00:30 del 22 en Madrid: es HOY, no ayer
  ok('la de las 00:30 de Madrid es de ese día aunque en UTC sea la del anterior', cuandoEs('2026-10-21T22:30:00.000Z', ahora) === 'hoy 00:30', cuandoEs('2026-10-21T22:30:00.000Z', ahora))
  // El cambio de hora de octubre (25 de octubre de 2026): las 03:00 pasan a ser las 02:00
  const despues = new Date('2026-10-26T12:00:00.000Z')
  ok('el domingo del cambio de hora se escribe bien', cuandoEs('2026-10-25T10:00:00.000Z', despues) === 'ayer 11:00', cuandoEs('2026-10-25T10:00:00.000Z', despues))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
