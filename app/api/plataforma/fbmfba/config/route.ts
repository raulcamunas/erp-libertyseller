import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { configDeCliente, guardarConfig, type PatchConfigA4 } from '@/lib/plataforma/fbmfba/datos'
import { FALTAN_MIGRACIONES_A4, faltaEsquema } from '@/lib/plataforma/fbmfba/pantalla'

/**
 * LOS UMBRALES DEL ANÁLISIS FBM → FBA DE UN CLIENTE.
 *
 * SOLO ADMIN, y un cliente por petición. Estos números deciden si se le propone
 * a un vendedor meter mercancía suya en un almacén de Amazon, del que sacarla
 * cuesta dinero.
 *
 *
 * ============ `null` SE GUARDA. NO SE IGNORA. ============
 *
 * Es la regla que hace que este módulo sea honesto. Todo lo de negocio nace en
 * `null` y `null` significa NO RECOMENDAR: mientras falte, el motor informa y no
 * recomienda. Y borrar un umbral —«ya no quiero que el ranking descarte a
 * nadie»— es una decisión tan legítima como ponerlo, así que una clave que llega
 * con `null` se escribe como `null`. Un guardado que solo sabe escribir números
 * convierte esa decisión en imposible.
 *
 * Lo que NO se acepta es un número que no se pueda defender: los rangos de abajo
 * son los mismos que las restricciones de la migración 129, para que un error de
 * tecleo se conteste con una frase y no con un fallo de Postgres.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const clientId = request.nextUrl.searchParams.get('clientId') ?? ''
    if (!UUID.test(clientId)) return fail(400, 'Elige el cliente')

    return NextResponse.json({ config: await configDeCliente(clientId) })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES_A4)
    return errorResponse(error, 'Error leyendo los umbrales del análisis FBM → FBA')
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const cuerpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!cuerpo) return fail(400, 'No ha llegado nada que guardar')

    const clientId = typeof cuerpo.clientId === 'string' ? cuerpo.clientId : ''
    if (!UUID.test(clientId)) return fail(400, 'Elige el cliente')

    const patch: PatchConfigA4 = {}
    const fallos: string[] = []

    if ('colchonMargenPct' in cuerpo) {
      const v = numero(cuerpo.colchonMargenPct, fallos, 'El colchón de margen', 0, 100)
      if (v !== undefined) patch.colchonMargenPct = v
    }
    if ('mejoraMinimaPuntos' in cuerpo) {
      const v = numero(cuerpo.mejoraMinimaPuntos, fallos, 'La mejora mínima', 0, 100)
      if (v !== undefined) patch.mejoraMinimaPuntos = v
    }
    if ('rotacionMinimaUnidades' in cuerpo) {
      const v = numero(cuerpo.rotacionMinimaUnidades, fallos, 'La rotación mínima', 0, 1000000)
      if (v !== undefined) patch.rotacionMinimaUnidades = v === null ? null : Math.round(v)
    }
    if ('bsrMaximo' in cuerpo) {
      const v = numero(cuerpo.bsrMaximo, fallos, 'El ranking máximo', 1, 100000000)
      if (v !== undefined) patch.bsrMaximo = v === null ? null : Math.round(v)
    }
    if ('rotacionVentanaDias' in cuerpo) {
      const v = numero(cuerpo.rotacionVentanaDias, fallos, 'La ventana de rotación', 1, 365)
      if (v !== undefined && v !== null) patch.rotacionVentanaDias = Math.round(v)
    }
    if ('toleranciaTarifaPct' in cuerpo) {
      const v = numero(cuerpo.toleranciaTarifaPct, fallos, 'La tolerancia de la tarifa', 0, 50)
      if (v !== undefined && v !== null) patch.toleranciaTarifaPct = v
    }
    if ('exigirDimensionesFiables' in cuerpo) {
      patch.exigirDimensionesFiables = cuerpo.exigirDimensionesFiables === true
    }
    if ('notas' in cuerpo) {
      patch.notas =
        typeof cuerpo.notas === 'string' && cuerpo.notas.trim() !== ''
          ? cuerpo.notas.trim().slice(0, 2000)
          : null
    }

    if (fallos.length > 0) return fail(400, fallos.join(' '))
    if (Object.keys(patch).length === 0) return fail(400, 'No hay ningún cambio que guardar')

    const config = await guardarConfig(clientId, patch, session.userId)
    return NextResponse.json({
      config,
      mensaje:
        config.colchonMargenPct === null || config.mejoraMinimaPuntos === null
          ? 'Guardado. Mientras falte el colchón de margen o la mejora mínima, el análisis informa pero no recomienda.'
          : 'Guardado. El análisis ya puede dar veredicto con estos umbrales.',
    })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES_A4)
    return errorResponse(error, 'Error guardando los umbrales del análisis FBM → FBA')
  }
}

/**
 * Un número del cuerpo.
 *
 * Devuelve `undefined` cuando el valor no vale —y añade el porqué a `fallos`—,
 * `null` cuando el usuario ha borrado el campo a propósito, y el número cuando
 * lo hay. Los tres casos son distintos: convertir el tercero y el segundo en el
 * mismo es lo que impide borrar un umbral.
 */
function numero(
  valor: unknown,
  fallos: string[],
  nombre: string,
  min: number,
  max: number
): number | null | undefined {
  if (valor === null || valor === '' || valor === undefined) return null
  const n = typeof valor === 'number' ? valor : Number(valor)
  if (!Number.isFinite(n)) {
    fallos.push(`${nombre} tiene que ser un número.`)
    return undefined
  }
  if (n < min || n > max) {
    fallos.push(`${nombre} tiene que estar entre ${min} y ${max}.`)
    return undefined
  }
  return n
}
