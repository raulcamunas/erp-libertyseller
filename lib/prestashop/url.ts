/**
 * LA DIRECCIÓN DE LA TIENDA DE UN CLIENTE.
 * =======================================
 * PURA: no hace ninguna llamada. Se prueba en lib/prestashop/prestashop.prueba.ts.
 *
 * El servidor del ERP va a llamar a una dirección que ESCRIBE UNA PERSONA en una
 * pantalla. Eso es lo que se llama SSRF: si la dirección apuntara a algo de
 * nuestra red interna —localhost, la base de datos, el servicio de metadatos de
 * la nube— el ERP haría la petición desde dentro y devolvería lo que encuentre.
 *
 * Solo la ve un admin, y por eso el riesgo es bajo. Pero la comprobación es de
 * diez líneas y es de las que solo se echan en falta una vez.
 *
 *
 * ============ QUÉ SE ACEPTA ============
 *
 *   · SOLO HTTPS. La clave del Webservice viaja en CADA petición (es el usuario
 *     de la autenticación básica) y por http iría en claro.
 *   · UN NOMBRE DE DOMINIO, nunca una IP: una tienda real tiene dominio, y las IP
 *     literales son exactamente como se cuelan las direcciones internas.
 *   · SIN PUERTO ni credenciales en la dirección.
 *   · Se queda con el ORIGEN y, si lo hay, la carpeta (algunas tiendas viven en
 *     `dominio.com/tienda`), quitando la barra final, `?consulta`, `#ancla` y un
 *     `/api` que se haya copiado de más.
 */

export type UrlTienda = { ok: true; url: string } | { ok: false; motivo: string }

/** Nombres que nunca son una tienda de cara al público */
function esHostInterno(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan') ||
    host.endsWith('.home') ||
    !host.includes('.')
  )
}

export function normalizarUrlTienda(entrada: string): UrlTienda {
  let texto = (entrada ?? '').trim()
  if (texto === '') return { ok: false, motivo: 'Falta la dirección de la tienda.' }

  // Quien pega «mitienda.com/api/» sin el https:// no se equivoca en nada grave.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(texto)) texto = `https://${texto}`

  let u: URL
  try {
    u = new URL(texto)
  } catch {
    return { ok: false, motivo: 'Esa dirección no es válida.' }
  }

  if (u.protocol !== 'https:') {
    return {
      ok: false,
      motivo:
        'Tiene que ser https. La clave del Webservice viaja en cada petición y por http iría en claro.',
    }
  }
  if (u.username || u.password) {
    return { ok: false, motivo: 'La dirección no puede llevar usuario ni contraseña: la clave se pone aparte.' }
  }
  if (u.port) {
    return { ok: false, motivo: 'La dirección no puede llevar puerto.' }
  }

  const host = u.hostname.toLowerCase()
  // Un literal IPv6 llega como «[::1]»; un IPv4, como «127.0.0.1».
  if (host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return { ok: false, motivo: 'Usa el nombre del dominio de la tienda, no una dirección IP.' }
  }
  if (esHostInterno(host)) {
    return { ok: false, motivo: 'Esa dirección no es la de una tienda pública.' }
  }

  // LA CARPETA DE LA TIENDA, y nada de lo que cuelgue de ella.
  //
  // Se corta en el primer trozo que no puede ser parte de la dirección pública:
  // `index.php`, una carpeta que empiece por «admin» (el panel de PrestaShop vive
  // en una carpeta con nombre aleatorio tipo `admin477nh099c`) o un `api` copiado
  // del manual. La razón de que sea necesario es que lo primero que pega quien
  // busca «la dirección de la tienda» es la del navegador mientras está dentro del
  // panel, y eso no es la tienda: es `.../admin477nh099c/index.php/configure/...`.
  const trozos = u.pathname.split('/').filter((t) => t !== '')
  const corte = trozos.findIndex((t) => /^(index\.php|api)$/i.test(t) || /^admin/i.test(t))
  const carpeta = (corte === -1 ? trozos : trozos.slice(0, corte)).join('/')
  return { ok: true, url: `https://${host}${carpeta ? `/${carpeta}` : ''}` }
}

/** La clave del Webservice de PrestaShop: 32 caracteres alfanuméricos, en la práctica */
export function claveValida(clave: string): boolean {
  const c = (clave ?? '').trim()
  return /^[A-Za-z0-9]{16,128}$/.test(c)
}
