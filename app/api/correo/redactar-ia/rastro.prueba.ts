import { ACCESOS_RECIENTES, registrarAcceso } from '@/lib/correo/quien-servidor'
import { SIN_RASTRO_NO_SE_REDACTA, leerConRastro } from './rastro'

/**
 * PRUEBA DEL RASTRO DE «REDACTAR CON IA» DESDE UN BUZÓN AJENO: quien no es el dueño deja la fila 'busqueda' ANTES de que la IA lea los correos del
 * lead en ese buzón; si la fila no se puede escribir, no se lee nada. Usa el registrarAcceso de verdad contra un cliente falso de Supabase.
 * Uso: npx tsx app/api/correo/redactar-ia/rastro.prueba.ts
 */

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

type Fila = Record<string, unknown>

function clienteFalso(opciones: { falla: boolean }) {
  const insertadas: Fila[] = []
  const orden: string[] = []
  const cliente = {
    from: (tabla: string) => ({
      insert: async (fila: Fila) => {
        orden.push(`insert:${tabla}`)
        if (opciones.falla) return { data: null, error: { code: '42501', message: 'permiso denegado' } }
        insertadas.push({ tabla, ...fila })
        return { data: null, error: null }
      },
    }),
  }
  return { cliente: cliente as unknown as Parameters<typeof registrarAcceso>[0], insertadas, orden }
}

const QUIEN = { userId: '11111111-1111-4111-8111-111111111111', nombre: 'Patricia' }
const BUZON = '22222222-2222-4222-8222-222222222222'

async function main() {
  console.log('Rastro de «Redactar con IA» desde un buzón ajeno')

  // 1. Patricia con daniela@ asignado: deja la fila 'busqueda' ANTES de leer los correos del lead
  {
    ACCESOS_RECIENTES.clear()
    const base = clienteFalso({ falla: false })
    const r = await leerConRastro({
      porSupervision: true,
      anotar: () => registrarAcceso(base.cliente, QUIEN, BUZON, 'busqueda', null),
      leer: async () => {
        base.orden.push('leer')
        return ['correo']
      },
    })
    ok('se redacta', r.ok)
    ok('queda la fila en correo_accesos, con quién, qué buzón y «busqueda»', base.insertadas.length === 1 && base.insertadas[0].tabla === 'correo_accesos' && base.insertadas[0].usuario_id === QUIEN.userId && base.insertadas[0].buzon_id === BUZON && base.insertadas[0].accion === 'busqueda', JSON.stringify(base.insertadas))
    ok('el rastro va ANTES de leer', base.orden.join(',') === 'insert:correo_accesos,leer', base.orden.join(','))
  }

  // 2. correo_accesos caído: no se lee nada y la ruta contesta 500
  {
    ACCESOS_RECIENTES.clear()
    const base = clienteFalso({ falla: true })
    let lecturas = 0
    let apuntados = 0
    const r = await leerConRastro({
      porSupervision: true,
      anotar: () => registrarAcceso(base.cliente, QUIEN, BUZON, 'busqueda', null),
      leer: async () => {
        lecturas++
        return []
      },
      alFallar: () => apuntados++,
    })
    ok('sin rastro no se leen los correos del buzón ajeno', lecturas === 0)
    ok('y contesta 500 con su frase', !r.ok && r.estado === 500 && r.mensaje === SIN_RASTRO_NO_SE_REDACTA)
    ok('el fallo se apunta', apuntados === 1)
  }

  // 3. La dueña: su buzón, sin rastro
  {
    const base = clienteFalso({ falla: true })
    const r = await leerConRastro({ porSupervision: false, anotar: () => registrarAcceso(base.cliente, QUIEN, BUZON, 'busqueda', null), leer: async () => 1 })
    ok('la dueña lee sin dejar rastro (aunque correo_accesos esté caído)', r.ok && base.orden.length === 0)
  }

  console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
  process.exit(fallos === 0 ? 0 : 1)
}

void main()
