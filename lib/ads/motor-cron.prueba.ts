/**
 * Pruebas de generarDelMotor (motor-cron.ts) con las dependencias inyectadas: no toca la base ni Amazon.
 *   npx tsx lib/ads/motor-cron.prueba.ts
 */
import { generarDelMotor, type DependenciasDeGenerar } from './motor-cron'
import type { AjustesDelAgenteParaPujas } from './agente/tipos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const CUENTA = { id: 'perfil-1', conexionId: 'con-1', profileId: 1 }
const AJUSTES = { bloqueadasPorEfecto: ['seg-abierta'] } as unknown as AjustesDelAgenteParaPujas

function deps(x: { ajustesFalla?: boolean; omitido?: string } = {}) {
  const llamadas = { fase3: [] as Array<AjustesDelAgenteParaPujas | undefined>, caducar: 0, marcado: 0 }
  const d: DependenciasDeGenerar = {
    generarPropuestas: async () => ({ nuevas: 2, repetidas: 0, evaluados: 10, sinObjetivo: [], caducadas: 0, ...(x.omitido ? { omitido: x.omitido } : {}) }) as Awaited<ReturnType<DependenciasDeGenerar['generarPropuestas']>>,
    ajustesParaPujas: async () => {
      if (x.ajustesFalla) throw new Error('falla la lectura')
      return AJUSTES
    },
    generarPropuestasDePujaYPresupuesto: async (_c, a) => {
      llamadas.fase3.push(a)
      return { pujas: 3, presupuestos: 0, pausas: 1 }
    },
    caducarPujasViejasDelMotor: async () => {
      llamadas.caducar += 1
      return 0
    },
    marcarGenerado: async () => {
      llamadas.marcado += 1
    },
  }
  return { d, llamadas }
}

async function main() {
  console.log('\n=== generarDelMotor (A24) ===')
  {
    const { d, llamadas } = deps()
    const r = await generarDelMotor(CUENTA, 'agente', d)
    ok('modo agente: la fase 3 recibe los ajustes del agente', llamadas.fase3.length === 1 && llamadas.fase3[0] === AJUSTES)
    ok('… caduca antes las pujas de otra generación', llamadas.caducar === 1)
    ok('… y suma las nuevas de las dos fases', r.nuevas === 6 && r.errores.length === 0, JSON.stringify(r))
  }
  {
    const { d, llamadas } = deps({ ajustesFalla: true })
    const r = await generarDelMotor(CUENTA, 'agente', d)
    ok('modo agente con los ajustes fallando → no genera pujas', llamadas.fase3.length === 0 && r.fase3 === null)
    ok('… y lo dice en errores', r.errores.some((e) => /sin ajustes/.test(e)), JSON.stringify(r.errores))
  }
  {
    const { d, llamadas } = deps()
    await generarDelMotor(CUENTA, 'aprueba', d)
    ok('fuera del modo agente: fase 3 sin ajustes y sin caducar', llamadas.fase3.length === 1 && llamadas.fase3[0] === undefined && llamadas.caducar === 0)
  }
  {
    const { d, llamadas } = deps({ omitido: 'apagado' })
    const r = await generarDelMotor(CUENTA, 'agente', d)
    ok('motor apagado: ni fase 3 ni marca de generado', llamadas.fase3.length === 0 && llamadas.marcado === 0 && r.fase3 === null)
  }

  console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
  process.exit(fallos === 0 ? 0 : 1)
}
void main()
