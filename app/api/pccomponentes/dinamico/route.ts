import { NextResponse, type NextRequest } from 'next/server'
import { fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { faltaConfigurarPcc } from '@/lib/pccomponentes/mirakl'
import { FaltaMigracion321, guardarConfig, leerConfig, pasadaSiToca, ultimosCambios, type ConfigDinamica } from '@/lib/pccomponentes/dinamico-servidor'

/**
 * PRECIOS DINÁMICOS DE PCCOMPONENTES: LA PANTALLA. Solo administradores.
 *
 *   GET                         configuración, resumen de la última pasada y los últimos cambios
 *   POST {accion:'guardar',...} cambia la configuración (encendido, ensayo, cada cuánto, céntimos, márgenes, subir)
 *   POST {accion:'probar'}      una pasada ahora mismo, SIEMPRE en ensayo (no toca la tienda)
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const responder = (e: unknown) => (e instanceof FaltaMigracion321 ? fail(503, e.message) : fail(500, e instanceof Error ? e.message : 'Error'))

export async function GET() {
  const sesion = await requireAmazonAdmin()
  if (sesion instanceof NextResponse) return sesion
  try {
    const [config, cambios] = await Promise.all([leerConfig(), ultimosCambios(300)])
    return NextResponse.json({ config, cambios })
  } catch (e) {
    return responder(e)
  }
}

export async function POST(request: NextRequest) {
  const sesion = await requireAmazonAdmin()
  if (sesion instanceof NextResponse) return sesion
  const c = (await request.json().catch(() => ({}))) as Record<string, unknown>
  try {
    if (c.accion === 'probar') {
      const falta = faltaConfigurarPcc()
      if (falta) return fail(503, falta)
      return NextResponse.json({ resumen: await pasadaSiToca({ forzar: true, forzarEnsayo: true }) })
    }
    if (c.accion === 'guardar') {
      const cambios: Partial<ConfigDinamica> = {}
      if (typeof c.activo === 'boolean') cambios.activo = c.activo
      if (typeof c.ensayo === 'boolean') cambios.ensayo = c.ensayo
      if (typeof c.subir === 'boolean') cambios.subir = c.subir
      const num = (k: string, min: number, max: number) => {
        const v = Number(c[k])
        if (c[k] === undefined) return undefined
        if (!Number.isFinite(v) || v < min || v > max) throw new Error(`Valor no válido en ${k}`)
        return v
      }
      const cada = num('cada_minutos', 5, 1440)
      const cent = num('centimos', 0.01, 5)
      const lim = num('limite_coste', 1, 100000)
      const mb = num('margen_bajo', 0, 0.79)
      const ma = num('margen_alto', 0, 0.79)
      if (cada !== undefined) cambios.cada_minutos = Math.round(cada)
      if (cent !== undefined) cambios.centimos = Math.round(cent * 100) / 100
      if (lim !== undefined) cambios.limite_coste = lim
      if (mb !== undefined) cambios.margen_bajo = mb
      if (ma !== undefined) cambios.margen_alto = ma
      return NextResponse.json({ config: await guardarConfig(cambios, sesion.userId) })
    }
    return fail(400, 'Acción desconocida')
  } catch (e) {
    return responder(e)
  }
}
