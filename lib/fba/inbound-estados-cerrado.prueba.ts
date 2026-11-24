import { seguirCerrado } from '@/lib/fba/inbound-estados'

let fallos = 0
const ok = (n: string, bien: boolean) => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}`)
}
const ahora = new Date('2026-11-24T10:00:00Z')
console.log('\n=== Un envío cerrado se sigue mirando mientras Amazon concilia (FBA15MS4X7Q2) ===')
ok('cerrado hace 2 días con 202 de menos y sin mirar en 6 h: se mira', seguirCerrado({ enviadas: 1757, recibidas: 1555, cerradoDesde: '2026-11-22T06:08:00Z', seguimientoAt: '2026-11-24T03:00:00Z', ahora }))
ok('completo: no', !seguirCerrado({ enviadas: 100, recibidas: 100, cerradoDesde: '2026-11-22T06:08:00Z', seguimientoAt: null, ahora }))
ok('con más recibidas que enviadas: no', !seguirCerrado({ enviadas: 100, recibidas: 104, cerradoDesde: '2026-11-22T06:08:00Z', seguimientoAt: null, ahora }))
ok('cerrado hace más de 60 días (fuera de plazo para reclamar): no', !seguirCerrado({ enviadas: 100, recibidas: 90, cerradoDesde: '2026-09-20T00:00:00Z', seguimientoAt: null, ahora }))
ok('mirado hace 2 horas: espera a las 6', !seguirCerrado({ enviadas: 100, recibidas: 90, cerradoDesde: '2026-11-22T06:08:00Z', seguimientoAt: '2026-11-24T08:00:00Z', ahora }))
ok('sin fecha de cierre apuntada (remesa vieja): no se mira cada 6 h para siempre', !seguirCerrado({ enviadas: 100, recibidas: 90, cerradoDesde: null, seguimientoAt: null, ahora }))
console.log(fallos === 0 ? '\nTODO OK\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
