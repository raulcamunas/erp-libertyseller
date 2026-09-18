/**
 * EL DÍA DE HOY EN ESPAÑA, NO EN EL SERVIDOR.
 *
 * El contenedor va en UTC. Entre medianoche y las dos de la mañana en verano,
 * `new Date().toISOString()` devuelve AYER para quien está en España — y ahí se
 * calculan velocidades de venta y fechas de agotamiento que saldrían con un día
 * de desfase justo en el cambio de mes, que es cuando se miran los números.
 *
 * Se usa Intl y no una resta de horas fija porque el cambio de hora existe: en
 * marzo y en octubre una constante de +1 o +2 se equivoca durante semanas.
 */
export function diaEnEspana(momento: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(momento)
  // en-CA da YYYY-MM-DD, que es justo lo que se guarda en la base
  return partes
}
