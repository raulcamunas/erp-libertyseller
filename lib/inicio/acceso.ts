/**
 * EL ERROR DE UN INICIO DE SESIÓN FALLIDO, EN CASTELLANO.
 * =======================================================
 * PURO. Se comprueba con acceso.prueba.ts. Supabase contesta en inglés («Invalid login credentials») y esa frase salía tal cual en el aviso rojo de
 * la pantalla de acceso. Aquí se traducen los tres que se ven de verdad; cualquier otro sale como llegó, porque esconder un error que no se conoce es
 * peor que enseñarlo en inglés.
 */
export function mensajeDeErrorDeAcceso(mensaje: string | null | undefined): string {
  const m = (mensaje ?? '').trim()
  if (!m) return 'Error al iniciar sesión'
  if (/invalid login credentials/i.test(m)) return 'El email o la contraseña no son correctos.'
  if (/email not confirmed/i.test(m)) return 'Tu email todavía no está confirmado.'
  if (/rate limit|too many requests/i.test(m)) return 'Demasiados intentos seguidos. Espera un momento y vuelve a probar.'
  return m
}
