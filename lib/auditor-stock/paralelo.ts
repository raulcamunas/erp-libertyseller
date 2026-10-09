/**
 * LEER TRAMOS EN PARALELO, CON RELOJ Y CON FRENO.
 * ===============================================
 * PURA: no sabe nada de Amazon. Recibe «lee el tramo N» y se encarga de repartir
 * el trabajo, mirar el reloj y parar cuando toca. Se prueba entera, con lecturas
 * simuladas, en lib/auditor-stock/paralelo.prueba.ts.
 *
 * Existe aparte de auditar.ts porque es la parte donde se esconden los fallos, y
 * con Amazon por medio no hay forma de probarla: una auditoría real son 700
 * llamadas y solo se puede lanzar en producción.
 *
 *
 * ============ LAS CUATRO REGLAS ============
 *
 *   1. A LO SUMO `concurrencia` TRAMOS EN VUELO. Más no, aunque queden muchos.
 *
 *   2. EL RELOJ SE MIRA ANTES DE COGER CADA TRAMO, no durante. Los que ya están
 *      en vuelo terminan —son unas pocas llamadas— y no se empieza ninguno nuevo
 *      pasado el límite. Cortar una lectura a la mitad dejaría un tramo del que
 *      no se sabe qué se leyó.
 *
 *   3. UN FALLO PARA A TODOS. Si la autorización ya no vale, seguir con los demás
 *      tramos son cientos de errores idénticos y cientos de canjes de token
 *      fallidos. Lo ya leído se conserva.
 *
 *   4. LOS TRAMOS NO ACABAN EN ORDEN, y el resultado lo dice: `hechos` es la
 *      lista de los que terminaron, no «hasta el N». Quien cuente lo leído tiene
 *      que sumar esos y no asumir un prefijo.
 */

export interface OpcionesLectura {
  /** Cuántos tramos a la vez */
  concurrencia: number
  /** Cuánto tiempo se deja empezar tramos nuevos, en ms desde `inicio` */
  limiteMs: number
  /** Cuándo empezó todo. Por defecto, ahora */
  inicio?: number
  /** Para probar sin esperar de verdad */
  ahora?: () => number
  /** Cómo se convierte un fallo en el texto que se guarda */
  mensajeDe?: (e: unknown) => string
}

export interface ResultadoLectura {
  /** Posiciones de los tramos que terminaron bien, en el orden en que acabaron */
  hechos: number[]
  /** Se dejó de empezar tramos por falta de tiempo */
  sinTiempo: boolean
  /** El primer fallo, si lo hubo */
  fallo: string | null
}

export async function leerTramos(
  total: number,
  leer: (idx: number) => Promise<void>,
  opciones: OpcionesLectura
): Promise<ResultadoLectura> {
  const ahora = opciones.ahora ?? Date.now
  const inicio = opciones.inicio ?? ahora()
  const mensajeDe =
    opciones.mensajeDe ?? ((e: unknown) => (e instanceof Error ? e.message : 'Error desconocido'))

  const r: ResultadoLectura = { hechos: [], sinTiempo: false, fallo: null }
  let siguiente = 0
  let parar = false

  const trabajador = async () => {
    for (;;) {
      if (parar) return
      if (ahora() - inicio > opciones.limiteMs) {
        r.sinTiempo = true
        return
      }
      const idx = siguiente++
      if (idx >= total) return
      try {
        await leer(idx)
        r.hechos.push(idx)
      } catch (e) {
        if (r.fallo === null) r.fallo = mensajeDe(e)
        parar = true
        return
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, opciones.concurrencia) }, trabajador))

  // Un trabajador que vio el reloj pasado marca `sinTiempo` aunque ya no
  // quedara nada por empezar. Solo cuenta si de verdad se quedó trabajo sin leer.
  if (r.sinTiempo && r.hechos.length >= total) r.sinTiempo = false
  return r
}
