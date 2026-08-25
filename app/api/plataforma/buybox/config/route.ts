import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { registrarEvento } from '@/lib/plataforma/eventos'
import { contarSkus, guardarConfig, type ConfigBuyBox } from '@/lib/plataforma/buybox/datos'
import { olvidarEntorno } from '@/lib/plataforma/buybox/tarea'
import { conexionesDeCliente, unidadesDe } from '@/lib/plataforma/datos'
import { FALTAN_MIGRACIONES, configPantalla, faltaEsquema } from '@/lib/plataforma/buybox/pantalla'

/**
 * LOS UMBRALES DEL MONITOR DE BUY BOX, POR CLIENTE.
 *
 * SOLO ADMIN. Y aquí importa especialmente: desde este PATCH se decide a qué
 * precio va a proponer bajar el motor en la tienda de un cliente.
 *
 *
 * ============ POR QUÉ CASI TODO PUEDE VOLVER A `null` ============
 *
 * Porque `null` NO es «sin valor»: es «sin decidir», y es un estado legítimo al
 * que hay que poder volver. Si alguien puso un margen mínimo por probar y quiere
 * deshacerlo, tiene que poder dejarlo otra vez sin decidir, y que el motor
 * vuelva a informar sin recomendar. Un formulario que solo admite números
 * convierte una prueba en una decisión permanente.
 *
 * Por eso la lectura del cuerpo distingue tres cosas donde otros distinguen dos:
 * campo ausente (no se toca), campo a `null` (se borra la decisión) y campo con
 * número (se decide).
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const clientId = request.nextUrl.searchParams.get('clientId') ?? ''
    if (!UUID.test(clientId)) return fail(400, 'Elige el cliente')

    return NextResponse.json({ config: await configPantalla(clientId, await skusDe(clientId)) })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES)
    return errorResponse(error, 'Error leyendo la configuración del monitor de Buy Box')
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : ''
    if (!UUID.test(clientId)) return fail(400, 'Elige el cliente')

    const cambios: Partial<Omit<ConfigBuyBox, 'id' | 'clientId' | 'updatedAt'>> = {}

    if ('condicion' in body) {
      const v = texto(body.condicion)
      if (!v) return fail(400, 'La condición vigilada no puede quedarse vacía')
      cambios.condicion = v
    }
    if ('segmento' in body) {
      const v = texto(body.segmento)
      if (!v) return fail(400, 'El segmento de comprador no puede quedarse vacío')
      cambios.segmento = v
    }

    if ('foepRotacionDias' in body) {
      const v = entero(body.foepRotacionDias)
      if (v === null || v < 1 || v > 90) {
        return fail(400, 'La rotación del FOEP va de 1 a 90 días')
      }
      cambios.foepRotacionDias = v
    }
    /**
     * Cada cuánto se le vuelve a pedir el FOEP a un mismo SKU.
     *
     * El suelo son 15 minutos y no es arbitrario: un barrido corto ya son 7, así
     * que por debajo se estaría pidiendo otra vez algo que la pasada anterior
     * todavía está trayendo. El techo son 30 días.
     *
     * Lo caro está aquí: 40 SKU por llamada y una llamada cada treinta segundos
     * son 4.800 SKU a la hora como techo, y ese cupo lo comparten TODOS los
     * países del mismo vendedor. Por eso es por cliente.
     */
    if ('foepCadaMinutos' in body) {
      // `null` NO es «sin valor»: es «calcúlalo tú», y es el estado normal. Se
      // saca de las referencias con stock del cliente al doble de lo que tarda
      // un barrido. Ver cadenciaFoepAutomatica() en buybox/rotacion.ts.
      const v = enteroOpcional(body.foepCadaMinutos)
      if (v !== null && (v < 15 || v > 43_200)) {
        return fail(
          400,
          'Cada cuánto se pide el FOEP va de 15 minutos a 30 días, o vacío para que lo calcule el ERP. ' +
            'Por debajo del cuarto de hora se estaría volviendo a pedir algo que la pasada anterior ' +
            'todavía está trayendo.'
        )
      }
      cambios.foepCadaMinutos = v
    }
    if ('foepMaxPorNoche' in body) {
      const v = enteroOpcional(body.foepMaxPorNoche)
      if (v !== null && v < 1) return fail(400, 'El tope de FOEP por noche tiene que ser al menos 1')
      cambios.foepMaxPorNoche = v
    }
    if ('foepColaActiva' in body) cambios.foepColaActiva = body.foepColaActiva === true
    // Apagarlo se salta la fase más cara del trabajo. Ver ConfigBuyBox.foepActivo.
    if ('foepActivo' in body) cambios.foepActivo = body.foepActivo === true

    if ('ofertasGuardadas' in body) {
      const v = entero(body.ofertasGuardadas)
      if (v === null || v < 0 || v > 50) {
        return fail(400, 'Se pueden guardar entre 0 y 50 ofertas por lectura')
      }
      cambios.ofertasGuardadas = v
    }

    if ('margenMinimoPct' in body) {
      const v = numeroOpcional(body.margenMinimoPct)
      if (v !== null && (v < 0 || v > 100)) return fail(400, 'El margen mínimo va de 0 a 100 %')
      cambios.margenMinimoPct = v
    }
    if ('deltaFoep' in body) {
      const v = numeroOpcional(body.deltaFoep)
      if (v !== null && v < 0) return fail(400, 'El margen de seguridad no puede ser negativo')
      cambios.deltaFoep = v
    }
    if ('deltaFoepTipo' in body) {
      cambios.deltaFoepTipo = body.deltaFoepTipo === 'porcentaje' ? 'porcentaje' : 'absoluto'
    }
    if ('precioSuelo' in body) {
      const v = numeroOpcional(body.precioSuelo)
      if (v !== null && v < 0) return fail(400, 'El precio suelo no puede ser negativo')
      cambios.precioSuelo = v
    }
    if ('precioTecho' in body) {
      const v = numeroOpcional(body.precioTecho)
      if (v !== null && v < 0) return fail(400, 'El precio techo no puede ser negativo')
      cambios.precioTecho = v
    }
    if ('skusExcluidos' in body) {
      cambios.skusExcluidos = Array.isArray(body.skusExcluidos)
        ? [
            ...new Set(
              body.skusExcluidos
                .filter((s): s is string => typeof s === 'string')
                .map((s) => s.trim())
                .filter((s) => s !== '')
            ),
          ]
        : []
    }
    if ('lecturasParaAlertar' in body) {
      const v = entero(body.lecturasParaAlertar)
      if (v === null || v < 1 || v > 20) {
        return fail(400, 'El número de lecturas antes de avisar va de 1 a 20')
      }
      cambios.lecturasParaAlertar = v
    }
    if ('sellersAmazon' in body) {
      cambios.sellersAmazon = mapaSellers(body.sellersAmazon)
    }
    if ('notas' in body) cambios.notas = texto(body.notas)

    /**
     * LA ESCRITURA DE PRECIOS NO SE ENCIENDE DESDE AQUÍ.
     *
     * El campo existe en la tabla porque la ejecución de cambios llegará en A6,
     * con confirmación explícita, registro de auditoría de quién, cuándo, sobre
     * qué SKU y qué contestó Amazon, y confirmación reforzada por encima de N
     * referencias. Encenderla desde un PATCH de configuración se saltaría las
     * tres cosas, así que este campo se ignora a propósito y se dice.
     */
    if ('escrituraAutorizada' in body && body.escrituraAutorizada === true) {
      return fail(
        409,
        'La escritura automática de precios no se activa desde aquí. Este módulo observa y ' +
          'diagnostica: propone precios en simulacro y no envía nada a Amazon. La ejecución de ' +
          'cambios se construye aparte, con confirmación explícita y registro de auditoría.'
      )
    }

    const config = await guardarConfig(clientId, cambios, session.userId)
    // El barrido en marcha guarda la configuración en memoria durante su pasada:
    // sin esto, un cambio de umbral no se vería hasta el trabajo siguiente.
    olvidarEntorno()

    // Constancia de quién movió un umbral que decide precios de tiendas ajenas.
    // Severidad 'info' y con `createdBy`: por el trigger de la 123, lo que lanza
    // una persona NO hace sonar la campana.
    await registrarEvento({
      tipo: 'buybox_config_cambiada',
      severidad: 'info',
      clientId,
      mensaje: `Se ha cambiado la configuración del monitor de Buy Box: ${Object.keys(cambios).join(', ') || 'sin cambios'}.`,
      detalle: cambios,
      createdBy: session.userId,
    })

    return NextResponse.json({
      config: await configPantalla(clientId, await skusDe(clientId)),
      mensaje: 'Configuración guardada.',
      guardado: config.updatedAt,
    })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES)
    return errorResponse(error, 'Error guardando la configuración del monitor de Buy Box')
  }
}

/**
 * LOS SKU SOBRE LOS QUE TRABAJA EL MONITOR, para poder decir lo que cuesta.
 *
 * `soloConStock` Y NO `soloActivos`, y este es justo el fallo que hubo aquí: el
 * ámbito del trabajo pasó a ser «todo lo que tenga existencias» y este recuento
 * se quedó contando «lo que está en seguimiento». En un cliente con el criterio
 * de seguimiento a cero —FBA marcado y catálogo FBM, que es el caso de la
 * cartera— el resultado era CERO, y con cero la cadencia automática se iba al
 * máximo y la pantalla decía «no hay ninguna referencia con stock» teniendo
 * medio catálogo con existencias.
 *
 * El motor nunca se equivocó: relojFoep() en buybox/tarea.ts cuenta con el
 * ámbito de verdad. Se equivocaba LA PANTALLA, que es peor de lo que suena —es
 * la que se mira para decidir.
 *
 * Se cuenta en TODOS los países del cliente: el cupo del FOEP es por cuenta de
 * vendedor y todos comen del mismo plato.
 */
async function skusDe(clientId: string): Promise<number> {
  const conexiones = await conexionesDeCliente(clientId)
  const unidades = unidadesDe(conexiones)
  const cuentas = await Promise.all(unidades.map((u) => contarSkus(u, { soloConStock: true })))
  return cuentas.reduce((suma, n) => suma + n, 0)
}

function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const limpio = valor.trim()
  return limpio === '' ? null : limpio
}

/** null explícito = «sin decidir». undefined y basura = error de quien llama */
function numeroOpcional(valor: unknown): number | null {
  if (valor === null || valor === '' || valor === undefined) return null
  const n = Number(valor)
  return Number.isFinite(n) ? n : null
}

function enteroOpcional(valor: unknown): number | null {
  const n = numeroOpcional(valor)
  return n === null ? null : Math.round(n)
}

function entero(valor: unknown): number | null {
  const n = numeroOpcional(valor)
  return n === null ? null : Math.round(n)
}

function mapaSellers(valor: unknown): Record<string, string[]> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return {}
  const salida: Record<string, string[]> = {}
  for (const [clave, lista] of Object.entries(valor as Record<string, unknown>)) {
    if (!Array.isArray(lista)) continue
    const limpios = [
      ...new Set(
        lista
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.trim())
          .filter((v) => v !== '')
      ),
    ]
    if (limpios.length > 0) salida[clave.trim()] = limpios
  }
  return salida
}
