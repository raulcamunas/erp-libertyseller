import { monthCostForUser, cycleCostForUser, monthCostTotal } from '@/lib/payroll/cost'
import { comisionDeCita, resolveRate, type PayrollRate } from '@/lib/types/payroll'

let fallos = 0
let comprobaciones = 0
function igual(nombre: string, real: unknown, esperado: unknown) {
  comprobaciones += 1
  const bien = real === esperado
  if (!bien) fallos += 1
  console.log(`  ${bien ? 'OK  ' : 'MAL '}  ${nombre}${bien ? '' : ` → ${String(real)}, esperaba ${String(esperado)}`}`)
}

const tarifa = (mes: string, semi: number | null): PayrollRate => ({ id: mes, period_start: `${mes}-01`, user_id: null, hourly_rate: 4, commission_per_appointment: 25, commission_per_semi_qualified: semi, created_at: '', updated_at: '' })
const rates = [tarifa('2026-11', 10), tarifa('2026-10', null)]
const cita = (status: string, dia: string) => ({ comercial_id: 'ana', status, start_time: `${dia}T10:00:00Z` })

igual('una cualificada cobra la comisión del mes', comisionDeCita('qualified', rates, '2026-11-20'), 25)
igual('una semi-cualificada cobra su precio', comisionDeCita('semi_qualified', rates, '2026-11-20'), 10)
igual('un mes con tarifa y sin precio de semi: no cobra', comisionDeCita('semi_qualified', rates, '2026-10-20'), 0)
igual('un mes sin tarifa: la semi no cobra', comisionDeCita('semi_qualified', rates, '2026-09-20'), 0)
igual('un mes sin tarifa: la cualificada cobra la de por defecto', comisionDeCita('qualified', rates, '2026-09-20'), resolveRate(rates, '2026-09-20').commission)

const qualified = [cita('qualified', '2026-11-20'), cita('semi_qualified', '2026-11-21'), cita('semi_qualified', '2026-11-22')]
const mes = monthCostForUser('ana', { month: '2026-11', hours: [], rates, qualified })
igual('el mes suma cada una a su precio', mes.commissions, 45)
igual('y cuenta las tres citas', mes.appointments, 3)
igual('el total del mes usa el mismo cálculo', monthCostTotal({ month: '2026-11', hours: [], rates, qualified }).commissions, 45)
igual('el ciclo 15→14 también', cycleCostForUser('ana', { periodKey: '2026-11-15', hours: [], rates, qualified }).commissions, 45)

console.log(`\n${comprobaciones - fallos}/${comprobaciones} bien`)
if (fallos > 0) process.exit(1)
