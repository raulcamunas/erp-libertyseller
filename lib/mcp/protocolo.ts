/**
 * EL PROTOCOLO MCP, EN SU VERSIÓN MÍNIMA Y SIN ESTADO.
 * PURO: no sabe nada de Next, de Supabase ni de Amazon. Recibe el texto de un
 * mensaje JSON-RPC y devuelve qué contestar. Se prueba en protocolo.prueba.ts y,
 * contra el cliente oficial del SDK de MCP, en el script de integración.
 *
 *
 * ============ POR QUÉ A MANO Y NO CON EL SDK ============
 *
 * Para un servidor que solo ofrece herramientas y contesta con un JSON por
 * petición, el transporte «Streamable HTTP» son cuatro reglas, y escribirlas aquí
 * evita meter en el repositorio una dependencia más cuyo árbol de ficheros no se
 * puede ni instalar en este Mac (iCloud deja `node_modules` a medias). Lo que sí
 * se hace es comprobarlo contra el cliente OFICIAL del SDK, que es quien manda
 * sobre si esto es MCP de verdad.
 *
 *
 * ============ LAS REGLAS QUE CUMPLE (spec 2025-11-25, transporte Streamable HTTP) ============
 *
 *   · Cada mensaje del cliente llega en un POST propio y es UN solo mensaje.
 *   · Una notificación o una respuesta del cliente se acepta con 202 y SIN cuerpo.
 *   · Una petición se contesta con UN JSON (`application/json`): no se abre ningún
 *     flujo SSE, porque este servidor no manda nada por su cuenta.
 *   · Sin sesión: no se asigna `MCP-Session-Id`. Cada llamada se vale por sí sola.
 *   · Si llega `MCP-Protocol-Version` y no es una versión conocida → 400. Si no
 *     llega, se da por buena la 2025-03-26, como manda la spec.
 *   · En `initialize` se contesta la misma versión si la conocemos, y si no la más
 *     reciente que sabemos: decide el cliente si le vale.
 *
 * Los errores de PROTOCOLO (JSON roto, método que no existe, herramienta que no
 * existe) salen como error JSON-RPC. Los de EJECUCIÓN (un argumento mal puesto, un
 * cliente que no existe) salen como resultado con `isError: true` y un texto en
 * español, que es lo que el modelo lee para corregirse y volver a intentarlo.
 */

/** De la más nueva a la más vieja. La primera es la que se ofrece si el cliente trae otra */
export const VERSIONES_SOPORTADAS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const
export const VERSION_SIN_CABECERA = '2025-03-26'

/** Códigos de JSON-RPC 2.0 */
export const ERR = {
  JSON_ROTO: -32700,
  PETICION_NO_VALIDA: -32600,
  METODO_NO_EXISTE: -32601,
  PARAMETROS_NO_VALIDOS: -32602,
  INTERNO: -32603,
} as const

type Id = string | number | null

export interface EsquemaObjeto {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

export interface ResultadoHerramienta {
  /** Lo que lee el modelo. Texto: es lo único que todos los clientes entienden */
  texto: string
  /** Opcional: el mismo contenido como objeto, para los clientes que lo aprovechan */
  estructurado?: Record<string, unknown>
  /** true = la herramienta no ha podido hacer lo pedido y `texto` dice por qué */
  esError?: boolean
}

export interface Herramienta<C> {
  nombre: string
  titulo: string
  descripcion: string
  esquema: EsquemaObjeto
  /** true = no cambia nada en ningún sitio. Hoy lo son todas */
  soloLectura: boolean
  ejecutar(args: Record<string, unknown>, ctx: C): Promise<ResultadoHerramienta>
}

export interface EntornoMcp<C> {
  nombreServidor: string
  tituloServidor: string
  version: string
  /** Lo que ve el modelo al conectar: reglas de uso, no marketing */
  instrucciones: string
  herramientas: readonly Herramienta<C>[]
  /** Se llama tras cada herramienta, haya salido bien o mal. Nunca debe lanzar */
  alTerminarHerramienta?: (info: { nombre: string; esError: boolean; ms: number; args: Record<string, unknown> }) => void
}

export interface RespuestaProtocolo {
  status: number
  /** undefined = sin cuerpo (202) */
  cuerpo?: unknown
}

const error = (id: Id, code: number, message: string, data?: unknown) => ({
  jsonrpc: '2.0' as const,
  id,
  error: data === undefined ? { code, message } : { code, message, data },
})

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * La versión del protocolo que dice el cliente en la cabecera, validada.
 * null = no la manda. 'invalida' = la manda y no la conocemos.
 */
export function versionDeCabecera(valor: string | null): string | null | 'invalida' {
  if (valor === null || valor.trim() === '') return null
  return (VERSIONES_SOPORTADAS as readonly string[]).includes(valor.trim()) ? valor.trim() : 'invalida'
}

/** La versión que se contesta en `initialize`: la del cliente si la conocemos, y si no la más nueva */
export function negociarVersion(pedida: unknown): string {
  return typeof pedida === 'string' && (VERSIONES_SOPORTADAS as readonly string[]).includes(pedida)
    ? pedida
    : VERSIONES_SOPORTADAS[0]
}

export async function procesarPost<C>(args: {
  cuerpoCrudo: string
  cabeceraVersion: string | null
  entorno: EntornoMcp<C>
  ctx: C
}): Promise<RespuestaProtocolo> {
  const { cuerpoCrudo, cabeceraVersion, entorno, ctx } = args

  let mensaje: unknown
  try {
    mensaje = JSON.parse(cuerpoCrudo)
  } catch {
    return { status: 400, cuerpo: error(null, ERR.JSON_ROTO, 'El cuerpo no es un JSON válido.') }
  }

  // Desde la 2025-06-18 no hay lotes: un mensaje por petición
  if (Array.isArray(mensaje)) {
    return {
      status: 400,
      cuerpo: error(null, ERR.PETICION_NO_VALIDA, 'No se admiten lotes: manda un mensaje JSON-RPC por petición.'),
    }
  }
  if (!esObjeto(mensaje) || mensaje.jsonrpc !== '2.0') {
    return { status: 400, cuerpo: error(null, ERR.PETICION_NO_VALIDA, 'No es un mensaje JSON-RPC 2.0.') }
  }

  const version = versionDeCabecera(cabeceraVersion)
  if (version === 'invalida') {
    return {
      status: 400,
      cuerpo: error(null, ERR.PETICION_NO_VALIDA, 'Versión de protocolo no admitida.', {
        soportadas: VERSIONES_SOPORTADAS,
      }),
    }
  }

  const tieneMetodo = typeof mensaje.method === 'string'
  const tieneId = mensaje.id !== undefined && mensaje.id !== null

  // Una respuesta del cliente (a algo que no hemos pedido nunca) o una notificación
  if (!tieneMetodo || !tieneId) {
    if (!tieneMetodo && !('result' in mensaje) && !('error' in mensaje)) {
      return { status: 400, cuerpo: error(null, ERR.PETICION_NO_VALIDA, 'Mensaje JSON-RPC incompleto.') }
    }
    return { status: 202 }
  }

  const id = mensaje.id as Id
  if (typeof id !== 'string' && typeof id !== 'number') {
    return { status: 400, cuerpo: error(null, ERR.PETICION_NO_VALIDA, 'El id de la petición no es válido.') }
  }
  const metodo = mensaje.method as string
  const params = esObjeto(mensaje.params) ? mensaje.params : {}

  const ok = (result: unknown): RespuestaProtocolo => ({
    status: 200,
    cuerpo: { jsonrpc: '2.0', id, result },
  })
  const fallo = (code: number, message: string, data?: unknown): RespuestaProtocolo => ({
    status: 200,
    cuerpo: error(id, code, message, data),
  })

  switch (metodo) {
    case 'initialize':
      return ok({
        protocolVersion: negociarVersion(params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: entorno.nombreServidor, title: entorno.tituloServidor, version: entorno.version },
        instructions: entorno.instrucciones,
      })

    case 'ping':
      return ok({})

    case 'tools/list':
      return ok({
        tools: entorno.herramientas.map((h) => ({
          name: h.nombre,
          title: h.titulo,
          description: h.descripcion,
          inputSchema: h.esquema,
          annotations: {
            title: h.titulo,
            readOnlyHint: h.soloLectura,
            destructiveHint: false,
            idempotentHint: h.soloLectura,
            // Habla con una base de datos propia, no con el mundo abierto
            openWorldHint: false,
          },
        })),
      })

    case 'tools/call': {
      const nombre = params.name
      if (typeof nombre !== 'string') return fallo(ERR.PARAMETROS_NO_VALIDOS, 'Falta el nombre de la herramienta.')
      const herramienta = entorno.herramientas.find((h) => h.nombre === nombre)
      if (!herramienta) return fallo(ERR.PARAMETROS_NO_VALIDOS, `No existe la herramienta «${nombre}».`)

      const argumentos = params.arguments === undefined ? {} : params.arguments
      if (!esObjeto(argumentos)) {
        return fallo(ERR.PARAMETROS_NO_VALIDOS, 'Los argumentos tienen que ser un objeto.')
      }

      const inicio = Date.now()
      let resultado: ResultadoHerramienta
      try {
        validarContraEsquema(herramienta.esquema, argumentos)
        resultado = await herramienta.ejecutar(argumentos, ctx)
      } catch (e) {
        // Lo que se espera (un argumento mal puesto) trae un mensaje pensado para
        // leerse. Lo inesperado NO se cuenta: un error de base de datos o de red
        // puede llevar dentro nombres de tablas, y esto sale a un modelo.
        if (e instanceof ErrorDeHerramienta) {
          resultado = { texto: e.message, esError: true }
        } else {
          console.error(`[mcp] la herramienta ${nombre} ha fallado:`, e)
          resultado = { texto: 'La herramienta ha fallado por un error interno. Inténtalo de nuevo en un momento.', esError: true }
        }
      }

      try {
        entorno.alTerminarHerramienta?.({
          nombre,
          esError: resultado.esError === true,
          ms: Date.now() - inicio,
          args: argumentos,
        })
      } catch {
        // El registro no puede romper la respuesta
      }

      return ok({
        content: [{ type: 'text', text: resultado.texto }],
        ...(resultado.estructurado ? { structuredContent: resultado.estructurado } : {}),
        isError: resultado.esError === true,
      })
    }

    default:
      return fallo(ERR.METODO_NO_EXISTE, `El método «${metodo}» no existe en este servidor.`)
  }
}

/**
 * Los argumentos que llegan, contra el esquema que se publicó.
 *
 * El esquema es la ÚNICA lista de lo que acepta cada herramienta: lo que no está en
 * `properties` se rechaza (casi siempre es un nombre mal escrito, y callarlo haría
 * que el modelo creyera haber filtrado por algo que se ha ignorado), y lo que está
 * en `required` tiene que venir. Los tipos y los rangos los comprueba cada
 * herramienta con lib/mcp/argumentos.ts.
 */
export function validarContraEsquema(esquema: EsquemaObjeto, args: Record<string, unknown>): void {
  const conocidos = Object.keys(esquema.properties ?? {})
  const raros = Object.keys(args).filter((k) => !conocidos.includes(k))
  if (raros.length > 0) {
    throw new ErrorDeHerramienta(
      `Argumento desconocido: ${raros.map((r) => `«${r}»`).join(', ')}. Los que acepta esta herramienta son: ${
        conocidos.length > 0 ? conocidos.join(', ') : '(ninguno)'
      }.`
    )
  }
  for (const r of esquema.required ?? []) {
    const v = args[r]
    if (v === undefined || v === null || v === '') throw new ErrorDeHerramienta(`Falta el argumento «${r}».`)
  }
}

/**
 * Un fallo de la herramienta CUYO MENSAJE SE PUEDE ENSEÑAR al modelo: un cliente
 * que no existe, un límite fuera de rango, una migración sin lanzar. Cualquier otro
 * error se queda en el log del servidor.
 */
export class ErrorDeHerramienta extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorDeHerramienta'
  }
}
