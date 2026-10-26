/**
 * LAS PEQUEÑAS CUENTAS DE LA BARRA LATERAL — SOLO CÁLCULO, SIN REACT.
 * ====================================================================
 * Qué entrada del menú está encendida, las letras del avatar y cómo se escribe el número de una insignia. Va aparte del componente (components/layout/AppSidebar.tsx) para
 * poder comprobarlo con barra.prueba.ts sin montar nada.
 */

/** La ruta sin lo que no cuenta: sin `?consulta`, sin `#ancla` y sin barras al final (la raíz se queda como `/`) */
export function limpiarRuta(ruta: string): string {
  const sinResto = (ruta ?? '').split(/[?#]/)[0] ?? ''
  const sinBarras = sinResto.replace(/\/+$/, '')
  return sinBarras === '' ? '/' : sinBarras
}

/**
 * ¿La página en la que se está es la de esta aplicación o cuelga de ella?
 *
 * Con frontera: «/dashboard/commissions» NO es «/dashboard/commissions-shoes-f» (con el `startsWith` de antes las dos entradas se encendían a la vez). Y «/dashboard», que es
 * Inicio, solo es él mismo: todo lo demás cuelga de él y no por eso es Inicio.
 */
export function cuelgaDe(actual: string, rutaDeLaApp: string): boolean {
  const a = limpiarRuta(actual)
  const r = limpiarRuta(rutaDeLaApp)
  if (r === '/dashboard') return a === '/dashboard'
  return a === r || a.startsWith(`${r}/`)
}

/**
 * De todas las rutas del menú, la que corresponde a la página en la que se está: la más larga que coincide, o null si ninguna (la página no está en el menú de esta
 * persona: se enciende nada en vez de otra entrada por parecida).
 */
export function rutaActivaDelMenu(rutas: readonly string[], actual: string): string | null {
  let mejor: string | null = null
  for (const ruta of rutas) {
    if (!cuelgaDe(actual, ruta)) continue
    if (mejor === null || limpiarRuta(ruta).length > limpiarRuta(mejor).length) mejor = ruta
  }
  return mejor
}

const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'do', 'dos', 'van', 'von'])

/**
 * Las letras del avatar: la inicial del nombre y la del último apellido («Raúl Camuñas» → RC; «María de los Ángeles García» → MG). Con una sola palabra, una sola letra. Sin nombre,
 * las de lo que va antes de la @ del correo. Sin nada, `?`.
 */
export function inicialesDe(nombre: string | null | undefined, email: string | null | undefined): string {
  const delNombre = (nombre ?? '').trim()
  const fuente = delNombre !== '' ? delNombre : ((email ?? '').split('@')[0] ?? '').trim()
  const palabras = fuente
    .split(/[\s._-]+/)
    .map((p) => p.replace(/[^\p{L}]/gu, ''))
    .filter((p) => p !== '' && !PARTICULAS.has(p.toLocaleLowerCase('es')))
  if (palabras.length === 0) return '?'
  const primera = palabras[0]!
  const ultima = palabras.length > 1 ? palabras[palabras.length - 1]! : ''
  return (primera.charAt(0) + ultima.charAt(0)).toLocaleUpperCase('es')
}

/**
 * Lo que se escribe dentro de la insignia de una entrada: null si no hay nada que enseñar (sin valor, cero o menos), «9+» con la barra plegada (cabe una cifra), «99+» con la barra
 * abierta, y un texto que no es un número («Nuevo») tal cual con la barra abierta y un punto con la plegada.
 */
export function etiquetaDeInsignia(valor: string | number | null | undefined, plegada: boolean): string | null {
  if (valor === null || valor === undefined) return null
  const texto = String(valor).trim()
  if (texto === '') return null
  const n = Number(texto)
  if (Number.isFinite(n)) {
    if (n <= 0) return null
    const entero = Math.floor(n)
    if (plegada) return entero > 9 ? '9+' : String(entero)
    return entero > 99 ? '99+' : String(entero)
  }
  return plegada ? '•' : texto
}
