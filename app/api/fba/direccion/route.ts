import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { puedeEditar, requireFbaAccess } from '@/lib/fba/acceso'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * DESDE DÓNDE ENVÍA CADA CLIENTE.
 *
 * Amazon la exige para crear el plan y NO la da por API: la única operación con
 * dirección del modelo es para cambiarla, no para leer las guardadas. En Seller
 * Central te la rellena la interfaz desde tu libreta, pero esa libreta no está
 * expuesta. Así que se guarda aquí, una vez por cliente.
 *
 * Puede rellenarla el propio cliente si tiene permiso de edición: es su almacén,
 * él sabe el código postal, y el día que se mude no tiene que pedírnoslo.
 */
export const dynamic = 'force-dynamic'

/** Los que Amazon no perdona */
const OBLIGATORIOS = ['nombre', 'empresa', 'linea1', 'ciudad', 'provincia', 'codigoPostal', 'pais', 'telefono', 'email'] as const

const COLUMNA: Record<string, string> = {
  nombre: 'nombre',
  empresa: 'empresa',
  linea1: 'linea1',
  linea2: 'linea2',
  ciudad: 'ciudad',
  provincia: 'provincia',
  codigoPostal: 'codigo_postal',
  pais: 'pais',
  telefono: 'telefono',
  email: 'email',
}

export async function GET(request: NextRequest) {
  try {
    const clienteId = request.nextUrl.searchParams.get('cliente') ?? ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const sesion = await requireFbaAccess('ver', clienteId)
    if (sesion instanceof NextResponse) return sesion

    const service = createServiceClient()
    const { data } = await service
      .from('fba_direcciones')
      .select('*')
      .eq('client_id', clienteId)
      .maybeSingle()

    if (!data) return NextResponse.json({ direccion: null })

    const d = data as Record<string, string | null>
    return NextResponse.json({
      direccion: {
        nombre: d.nombre,
        empresa: d.empresa,
        linea1: d.linea1,
        linea2: d.linea2,
        ciudad: d.ciudad,
        provincia: d.provincia,
        codigoPostal: d.codigo_postal,
        pais: d.pais,
        telefono: d.telefono,
        email: d.email,
      },
    })
  } catch (error) {
    return errorResponse(error, 'No se ha podido leer la dirección')
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const clienteId = typeof body.cliente === 'string' ? body.cliente : ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const sesion = await requireFbaAccess('editar', clienteId)
    if (sesion instanceof NextResponse) return sesion
    if (!puedeEditar(sesion, clienteId)) return fail(404, 'Ese cliente no existe')

    const fila: Record<string, string | null> = { client_id: clienteId }

    for (const campo of OBLIGATORIOS) {
      const v = typeof body[campo] === 'string' ? (body[campo] as string).trim() : ''
      if (!v) return fail(400, `Falta «${campo}». Amazon no acepta la dirección sin él`)
      fila[COLUMNA[campo]] = v.slice(0, 200)
    }
    fila.linea2 = typeof body.linea2 === 'string' && body.linea2.trim() ? body.linea2.trim().slice(0, 200) : null

    /**
     * EL PAÍS EN DOS LETRAS Y LA PROVINCIA EN CÓDIGO.
     *
     * Amazon quiere ISO de dos letras para el país («ES», no «España») y el
     * código de provincia, no el nombre. Si va mal, el plan se rechaza con un
     * mensaje que no señala a la causa y se pierde media tarde buscándolo.
     * Mejor pararlo aquí, donde se puede explicar.
     */
    const pais = (fila.pais ?? '').toUpperCase()
    if (!/^[A-Z]{2}$/.test(pais)) {
      return fail(400, 'El país va en dos letras: ES para España, FR para Francia, PT para Portugal')
    }
    fila.pais = pais
    fila.provincia = (fila.provincia ?? '').toUpperCase()

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fila.email ?? '')) {
      return fail(400, 'Ese correo no parece válido')
    }
    // Amazon rechaza teléfonos con letras. Se limpian espacios y guiones, que
    // son lo normal al copiar de una ficha, y se comprueba lo que queda.
    const telefono = (fila.telefono ?? '').replace(/[\s.-]/g, '')
    if (!/^\+?\d{6,20}$/.test(telefono)) {
      return fail(400, 'El teléfono solo puede llevar números, y puede empezar por +')
    }
    fila.telefono = telefono

    const service = createServiceClient()
    const { error } = await service
      .from('fba_direcciones')
      .upsert({ ...fila, updated_at: new Date().toISOString() }, { onConflict: 'client_id' })
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error, 'No se ha podido guardar la dirección')
  }
}
