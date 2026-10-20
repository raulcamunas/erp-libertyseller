/**
 * Lo que se dice cuando la respuesta NO es el JSON de nuestra ruta: no la ha dado la ruta, sino lo que
 * hay delante —el servidor que se está reiniciando, un proxy—. Con el código se sabe qué fue sin abrir
 * las herramientas del navegador; un «no se ha podido» a secas no distingue un reinicio de un fallo.
 */
export const sinRespuestaDe = (que: string, estado: number) =>
  estado === 502 || estado === 503 || estado === 504
    ? `El servidor no ha contestado (código ${estado}). Suele pasar justo cuando la aplicación se está actualizando: espera un minuto y vuelve a probar.`
    : `${que} (código ${estado}).`
