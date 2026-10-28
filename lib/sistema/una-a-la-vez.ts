/**
 * UNA SOLA PASADA A LA VEZ EN ESTE PROCESO, SIN QUE UNA PASADA COLGADA LAS PARE PARA SIEMPRE. PURO: el reloj entra por parámetro. Se comprueba con una-a-la-vez.prueba.ts.
 * =================================================================================================================================================================
 * Las tareas de Rinkel pasan cada minuto (la de transcripción, cada 30 s: scripts/rinkel-transcribir.sh) y una pasada con llamadas largas o con un histórico por importar
 * puede tardar más que eso. Sin esto, la siguiente se le montaría encima: dos lecturas de la misma cuenta, el doble de peticiones a Rinkel y Sistema lleno de pasadas
 * repetidas. (Que dos pasadas no hagan la MISMA llamada ya lo garantiza la reserva del SQL; esto es para que ni siquiera lo intenten.)
 *
 * El servidor es un solo proceso, así que basta una variable del módulo de la ruta. Y lleva su propia caducidad: una pasada que lleva más de `duracionMaximaMs` se da por
 * muerta (se quedó esperando algo que no contestó) y deja pasar a la siguiente, en vez de bloquear la tarea hasta el próximo reinicio sin que nadie se entere. La que se
 * dio por muerta, si algún día termina, no suelta el paso de la que la sustituyó.
 */
export function crearGuardianDePasadas(duracionMaximaMs: number, ahora: () => number = Date.now) {
  let desde: number | null = null
  return {
    /** Una función para soltar el paso al terminar, o null si ya hay una pasada en curso (y no es tan vieja como para darla por muerta) */
    entrar(): (() => void) | null {
      const t = ahora()
      if (desde !== null && t - desde < duracionMaximaMs) return null
      desde = t
      const mia = t
      return () => {
        if (desde === mia) desde = null
      }
    },
  }
}
