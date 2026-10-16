import { avisoDeAutenticacion, metadatosRecurso } from './meta'
import type { ResultadoAuth, UsuarioMcp } from './auth'
import type { Limitador } from './limite'
import { procesarPost, type EntornoMcp } from './protocolo'

/**
 * EL MANEJADOR HTTP DEL CONECTOR.
 *
 * Sin Next: solo usa `Request` y `Response`, que son estándar, así que se puede
 * probar con peticiones de mentira y, con un servidor Node de cinco líneas,
 * contra el cliente oficial de MCP. Las rutas de app/api/mcp solo le ponen las
 * dependencias de verdad.
 *
 *
 * ============ EL ORDEN IMPORTA ============
 *
 *   1. Origen. Si la petición trae `Origin` y no es de Claude ni del propio ERP,
 *      403: es la defensa contra páginas web que intenten usar el conector desde
 *      el navegador de un administrador.
 *   2. Autenticación, ANTES de leer el cuerpo y antes de mirar qué se pide: sin
 *      token, ni siquiera se sabe si el mensaje es un `initialize`.
 *   3. Freno de ritmo, ya con la persona identificada.
 *   4. Tamaño del cuerpo.
 *   5. El protocolo.
 */

/** Un mensaje de MCP de verdad cabe de sobra; esto solo corta lo absurdo */
const MAX_CUERPO = 128 * 1024

export interface DepsManejador<C> {
  baseUrl: () => string
  supabaseUrl: () => string
  autenticar: (authorization: string | null) => Promise<ResultadoAuth>
  limitador: Limitador
  /** Monta el entorno (herramientas) y el contexto de ESTA persona */
  entornoDe: (usuario: UsuarioMcp) => { entorno: EntornoMcp<C>; ctx: C }
  /** Los orígenes de navegador que pueden llamar, además del propio ERP */
  origenesExtra?: readonly string[]
}

const CABECERAS_JSON = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

function json(cuerpo: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { ...CABECERAS_JSON, ...extra } })
}

const errorHttp = (code: number, message: string) => ({ jsonrpc: '2.0', id: null, error: { code, message } })

export function crearManejadorMcp<C>(deps: DepsManejador<C>) {
  const origenPermitido = (origin: string | null): boolean => {
    if (origin === null) return true
    const permitidos = new Set([
      new URL(deps.baseUrl()).origin,
      'https://claude.ai',
      'https://claude.com',
      ...(deps.origenesExtra ?? []),
    ])
    return permitidos.has(origin)
  }

  return {
    async POST(request: Request): Promise<Response> {
      if (!origenPermitido(request.headers.get('origin'))) {
        return json(errorHttp(-32600, 'Origen no permitido.'), 403)
      }

      const auth = await deps.autenticar(request.headers.get('authorization'))
      if (!auth.ok) {
        const extra: Record<string, string> = {}
        if (auth.reto) extra['WWW-Authenticate'] = avisoDeAutenticacion(deps.baseUrl(), auth.tokenInvalido)
        return json(errorHttp(-32600, auth.motivo), auth.status, extra)
      }

      const turno = deps.limitador.permitir(auth.usuario.id)
      if (!turno.ok) {
        return json(
          errorHttp(-32600, 'Demasiadas llamadas seguidas. Espera un momento antes de seguir.'),
          429,
          { 'Retry-After': String(Math.max(1, Math.ceil(turno.esperaMs / 1000))) }
        )
      }

      const declarado = Number(request.headers.get('content-length') ?? '0')
      if (declarado > MAX_CUERPO) return json(errorHttp(-32600, 'El mensaje es demasiado grande.'), 413)
      const cuerpoCrudo = await request.text()
      if (cuerpoCrudo.length > MAX_CUERPO) return json(errorHttp(-32600, 'El mensaje es demasiado grande.'), 413)

      const { entorno, ctx } = deps.entornoDe(auth.usuario)
      const r = await procesarPost({
        cuerpoCrudo,
        cabeceraVersion: request.headers.get('mcp-protocol-version'),
        entorno,
        ctx,
      })
      if (r.cuerpo === undefined) return new Response(null, { status: r.status })
      return json(r.cuerpo, r.status)
    },

    /** No hay flujo SSE que ofrecer: la spec permite decirlo con un 405 */
    GET(): Response {
      return new Response(null, { status: 405, headers: { Allow: 'POST' } })
    },

    /** Sin sesiones no hay nada que cerrar */
    DELETE(): Response {
      return new Response(null, { status: 405, headers: { Allow: 'POST' } })
    },

    /** Los metadatos que lee Claude tras el 401. Son públicos: no llevan nada secreto */
    metadatos(): Response {
      return json(metadatosRecurso(deps.baseUrl(), deps.supabaseUrl()), 200, {
        'Cache-Control': 'public, max-age=300',
      })
    },
  }
}
