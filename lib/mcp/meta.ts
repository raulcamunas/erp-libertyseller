/**
 * LOS METADATOS QUE HACEN QUE CLAUDE SEPA INICIAR SESIÓN.
 * PURO. Se prueba en meta.prueba.ts.
 *
 * Cuando Claude llama al conector sin token recibe un 401 con la dirección de un
 * documento (los «metadatos del recurso protegido», RFC 9728). Ese documento dice
 * quién es el servidor de autorización —aquí, Supabase Auth— y es lo que lleva a
 * Claude a abrir el inicio de sesión en el navegador.
 *
 * Tres requisitos de Claude que no son opcionales:
 *
 *   · El 401 TIENE que llevar `WWW-Authenticate: Bearer resource_metadata="…"`. Si
 *     el aviso va en una respuesta 200, Claude lo ignora.
 *   · `resource` tiene que ser IDÉNTICO a la dirección que se escribe al añadir el
 *     conector, ruta incluida y sin barra final.
 *   · Solo se mira el PRIMER servidor de `authorization_servers`.
 *
 * La dirección pública sale de `urlBaseApp()` (decidida por el servidor) y no de
 * las cabeceras de la petición: lo explica lib/url-app.ts, que ya costó un SSRF.
 */

export const RUTA_MCP = '/api/mcp'
export const RUTA_METADATOS = '/api/mcp/metadata'

export function urlRecurso(base: string): string {
  return `${base.replace(/\/+$/, '')}${RUTA_MCP}`
}

export function urlMetadatos(base: string): string {
  return `${base.replace(/\/+$/, '')}${RUTA_METADATOS}`
}

/** El servidor de autorización es Supabase Auth del propio proyecto */
export function emisorSupabase(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`
}

export function metadatosRecurso(base: string, supabaseUrl: string) {
  return {
    resource: urlRecurso(base),
    authorization_servers: [emisorSupabase(supabaseUrl)],
    bearer_methods_supported: ['header'],
    // Lo que Supabase entiende por «scope» es información de OIDC, no permisos: lo
    // que se puede hacer lo decide el rol del perfil, en cada llamada.
    scopes_supported: ['openid', 'email', 'profile'],
    resource_name: 'ERP de Liberty Seller (solo equipo)',
  }
}

/**
 * El aviso del 401. `invalido` = el token venía y no valía: el RFC 6750 pide
 * decirlo, y es lo que hace que Claude renueve el token en vez de quedarse parado.
 */
export function avisoDeAutenticacion(base: string, invalido: boolean): string {
  const partes = [`resource_metadata="${urlMetadatos(base)}"`]
  if (invalido) partes.push('error="invalid_token"', 'error_description="El token no es válido o ha caducado"')
  return `Bearer ${partes.join(', ')}`
}
