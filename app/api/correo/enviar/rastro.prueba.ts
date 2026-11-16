import { registrarAcceso } from '@/lib/correo/quien-servidor'
import { SIN_RASTRO_NO_SALE, enviarConRastro } from './rastro'

/**
 * PRUEBA DEL RASTRO DE ENVÍO (spec 9.1): quien no es el dueño deja la fila 'envio' ANTES de enviar; si la fila no se puede escribir, 0 envíos SMTP.
 * Usa el registrarAcceso de verdad contra un cliente falso de Supabase.
 * Uso: npx tsx app/api/correo/enviar/rastro.prueba.ts
 */

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

type Fila = Record<string, unknown>

/** Solo lo que usa registrarAcceso: from('correo_accesos').insert(fila) */
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
const HILO = '33333333-3333-4333-8333-333333333333'

async function main() {
  console.log('Rastro de envío desde un buzón ajeno')

  // 1. Asignado con respuesta y correo_accesos caído: el correo NO sale
  {
    const base = clienteFalso({ falla: true })
    let envios = 0
    let fallosApuntados = 0
    const r = await enviarConRastro({
      esDueno: false,
      anotar: () => registrarAcceso(base.cliente, QUIEN, BUZON, 'envio', { id: HILO, asunto: 'Re: presupuesto' }, { sinCache: true }),
      enviar: async () => {
        envios++
        return 'enviado'
      },
      alFallar: () => fallosApuntados++,
    })
    ok('fallo del rastro → 0 envíos SMTP', envios === 0, `envíos: ${envios}`)
    ok('fallo del rastro → 500 con la frase fija', !r.ok && r.estado === 500 && r.mensaje === SIN_RASTRO_NO_SALE)
    ok('fallo del rastro → se apunta el error', fallosApuntados === 1)
    ok('se intentó escribir el rastro', base.orden.join(',') === 'insert:correo_accesos', base.orden.join(','))
  }

  // 2. Asignado con respuesta y rastro bien: primero la fila, luego el envío; una fila por envío (sin caché)
  {
    const base = clienteFalso({ falla: false })
    let envios = 0
    for (let i = 0; i < 2; i++) {
      const r = await enviarConRastro({
        esDueno: false,
        anotar: () => registrarAcceso(base.cliente, QUIEN, BUZON, 'envio', { id: HILO, asunto: 'Re: presupuesto' }, { sinCache: true }),
        enviar: async () => {
          base.orden.push('smtp')
          envios++
          return 'enviado'
        },
      })
      ok(`envío ${i + 1}: sale`, r.ok && r.resultado === 'enviado')
    }
    ok('dos envíos → dos envíos SMTP', envios === 2)
    ok('dos envíos → dos filas de rastro (sin caché)', base.insertadas.length === 2, String(base.insertadas.length))
    ok('el rastro va ANTES del envío', base.orden.join(',') === 'insert:correo_accesos,smtp,insert:correo_accesos,smtp', base.orden.join(','))
    const f = base.insertadas[0]
    ok('la fila es accion=envio con el hilo y el asunto', f?.accion === 'envio' && f?.hilo_id === HILO && f?.asunto === 'Re: presupuesto' && f?.buzon_id === BUZON && f?.usuario_id === QUIEN.userId)
  }

  // 3. Un correo nuevo (sin hilo) desde un buzón asignado: hilo_id null
  {
    const base = clienteFalso({ falla: false })
    await enviarConRastro({
      esDueno: false,
      anotar: () => registrarAcceso(base.cliente, QUIEN, BUZON, 'envio', { id: null, asunto: 'Hola' }, { sinCache: true }),
      enviar: async () => 'enviado',
    })
    ok('correo nuevo → hilo_id null', base.insertadas[0]?.hilo_id === null && base.insertadas[0]?.asunto === 'Hola')
  }

  // 4. El dueño no deja rastro (aunque correo_accesos esté caído, su correo sale)
  {
    const base = clienteFalso({ falla: true })
    let envios = 0
    const r = await enviarConRastro({
      esDueno: true,
      anotar: () => registrarAcceso(base.cliente, QUIEN, BUZON, 'envio', { id: null, asunto: 'x' }, { sinCache: true }),
      enviar: async () => {
        envios++
        return 'enviado'
      },
    })
    ok('dueño → sale sin rastro', r.ok && envios === 1 && base.orden.length === 0)
  }

  console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones bien`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
