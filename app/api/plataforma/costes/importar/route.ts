import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, readText, requireAmazonAdmin } from '@/lib/amazon/api'
import { faltaEsquema } from '@/lib/plataforma/pantallas'
import { FALTAN_MIGRACIONES_COSTES } from '@/lib/plataforma/costes/tipos'
import { perfilDe } from '@/lib/plataforma/costes/datos'
import { importarCostes } from '@/lib/plataforma/costes/importar'
import { esFechaIso, hoyIso } from '@/lib/plataforma/costes/vigencia'

/**
 * IMPORTAR UN FICHERO DE COSTES.
 *
 * Solo admin. Multipart, porque lo que sube es el fichero que ha mandado el
 * cliente tal cual: un .xlsx, un .xls o un .csv.
 *
 *
 * ============ NACE EN SIMULACRO ============
 *
 * `modo` por defecto es 'simulacro' y hay que pedir 'aplicado' A CONCIENCIA. El
 * simulacro hace exactamente el mismo trabajo —lee, cruza, planifica— y no
 * escribe ni una fila: devuelve el plan entero para que se pueda mirar antes de
 * tocar los costes de un cliente. Y como el plan sale del mismo camino que la
 * escritura, lo que se ve es lo que va a pasar.
 *
 * EL FICHERO NO SE GUARDA. Se lee en memoria, se procesa y se tira. Lo que queda
 * es la fila de `amazon_costes_importaciones` con su nombre, su tamaño y sus
 * recuentos, que es lo que hace falta para investigar una cifra rara sin montar
 * un almacén de ficheros de clientes que nadie ha pedido.
 */
export const dynamic = 'force-dynamic'

/** 25 MB. Un volcado de tarifas de treinta mil referencias en .xlsx no llega a
    cinco; lo que pasa de aquí es casi siempre un fichero equivocado */
const MAX_BYTES = 25 * 1024 * 1024

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const form = await request.formData().catch(() => null)
    if (!form) return fail(400, 'Manda el fichero como formulario (multipart/form-data)')

    const clientId = String(form.get('clientId') ?? '')
    if (!UUID.test(clientId)) return fail(400, 'Falta el cliente')

    const profileId = String(form.get('profileId') ?? '')
    if (!UUID.test(profileId)) return fail(400, 'Elige con qué perfil se lee el fichero')

    const fichero = form.get('fichero')
    if (!(fichero instanceof File)) return fail(400, 'Falta el fichero')
    if (fichero.size === 0) return fail(400, 'El fichero está vacío')
    if (fichero.size > MAX_BYTES) {
      return fail(
        400,
        `El fichero ocupa ${(fichero.size / 1024 / 1024).toFixed(1)} MB y el tope son 25. ¿Seguro que es el de costes?`
      )
    }

    const perfil = await perfilDe(profileId)
    if (!perfil) return fail(404, 'Ese perfil ya no existe')
    // El perfil trae su propio client_id: se comprueba que es el del cliente que
    // dice la petición. Los dos vienen del navegador, y sin esta comprobación se
    // podrían importar los costes de un cliente contra el catálogo de otro, que
    // es la mezcla que el compromiso ante Amazon prohíbe.
    if (perfil.client_id !== clientId) {
      return fail(400, 'Ese perfil es de otro cliente')
    }

    const validoDesde = String(form.get('validoDesde') ?? '') || hoyIso()
    if (!esFechaIso(validoDesde)) {
      return fail(400, 'La fecha de entrada en vigor tiene que ser AAAA-MM-DD')
    }

    const modo = String(form.get('modo') ?? 'simulacro') === 'aplicado' ? 'aplicado' : 'simulacro'
    const motivo = readText(form.get('motivo'), 500)

    const informe = await importarCostes({
      clientId,
      perfil,
      bytes: await fichero.arrayBuffer(),
      fichero: fichero.name,
      validoDesde,
      modo,
      userId: session.userId,
      motivo,
    })

    return NextResponse.json({ informe })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES_COSTES)
    // Los errores de lectura de fichero (StockSyncError) son `Error` con mensaje
    // en español y salen tal cual en un 400: «la hoja Tarifas no existe, las del
    // fichero son…» se arregla solo. Ver errorResponse().
    return errorResponse(error, 'Error importando los costes')
  }
}
