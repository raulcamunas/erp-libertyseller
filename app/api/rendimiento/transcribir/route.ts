import { NextResponse, type NextRequest } from 'next/server'
import { hasTokenKey } from '@/lib/amazon/crypto'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { crearGuardianDePasadas } from '@/lib/sistema/una-a-la-vez'
import { createServiceClient } from '@/lib/supabase/service'
import { resumenDeLaPasada } from '@/lib/transcripcion/motor'
import { ejecutarPasada } from '@/lib/transcripcion/servidor'

/**
 * LA TRANSCRIPCIÓN DE LAS LLAMADAS DE RINKEL.
 *
 * Cada pasada coge las llamadas contestadas que ya tienen grabación y lead y todavía no están transcritas (las más antiguas primero), las
 * pasa a texto y deja en la ficha del lead el resumen, la línea de la conversación y el siguiente paso (lib/transcripcion/motor.ts).
 *
 *   · El reloj lo decide `tocaAhora()` desde la tabla cron_config (1 minuto por defecto, que el script de crond convierte en una pasada cada 30 s) y APAGAR este proceso en Sistema es el interruptor
 *     del gasto: sin pasadas no se manda ni un segundo de audio.
 *   · Una llamada se transcribe UNA vez. Una pasada que se solapa con otra no la repite (el SQL reserva cada llamada).
 *   · Solo LEE de Rinkel (la dirección temporal de la grabación) y no escribe nada en Rinkel.
 *   · Si la cuenta de la IA falla (clave, saldo) o la base no contesta, la pasada FALLA a la vista en Sistema con la frase de por qué, en vez
 *     de acabar «bien» sin hacer nada.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

/** Cuánto puede estar empezando llamadas nuevas. Cada una tarda unos 10 s; la última puede acabar pasados los 150 */
const PRESUPUESTO_MS = 150_000

/**
 * UNA SOLA PASADA A LA VEZ EN ESTE PROCESO (lib/sistema/una-a-la-vez.ts). El script de crond llama cada 30 s (scripts/rinkel-transcribir.sh) y una pasada con llamadas
 * largas puede tardar más: la siguiente no se le monta encima. Una pasada que pasa de 330 s (el maxDuration de la ruta más un margen) se da por muerta.
 */
const guardian = crearGuardianDePasadas(330_000)

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const soltar = guardian.entrar()
  if (!soltar) return NextResponse.json({ ok: true, saltado: 'ya hay una pasada en curso' })
  try {
    if (request.nextUrl.searchParams.get('forzar') !== '1') {
      const veredicto = await tocaAhora('rinkel-transcribir')
      if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
    }

    if (!hasTokenKey()) {
      return NextResponse.json({ ok: true, saltado: 'El servidor no tiene la clave de cifrado' })
    }

    const salida = await conRegistro('rinkel-transcribir', lanzadoPorDe(request.headers), async () => {
      if (!process.env.OPENAI_API_KEY?.trim()) throw new Error('La IA no está configurada en el servidor (falta OPENAI_API_KEY).')
      const resultado = await ejecutarPasada(createServiceClient(), { presupuestoMs: PRESUPUESTO_MS })
      const resumen = resumenDeLaPasada(resultado)
      // Un fallo de la cuenta de la IA o de la base NO es una pasada buena: que la pantalla de Sistema la enseñe en rojo con su motivo
      if (resultado.parada === 'ia_no_disponible' || resultado.parada === 'error') throw new Error(resumen)
      return { ...resultado, resumen }
    })

    return NextResponse.json({ ok: true, ...salida })
  } finally {
    soltar()
  }
}
