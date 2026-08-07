/**
 * Los ficheros que llegan en un formulario, convertidos a lo que consume el
 * proceso.
 *
 * Está aparte de las rutas porque lo usan tres —probar, simulacro y, cuando
 * llegue, enviar— y porque no depende de Next para nada: solo del File del
 * navegador, que es estándar.
 *
 * VIAJAN COMO FormData Y NO COMO JSON CON base64. Un Excel de 2 MB en base64
 * son 2,7 MB de texto que hay que serializar, mandar y volver a decodificar, y
 * el navegador ya sabe mandar ficheros. Es lo mismo que hace el sincronismo de
 * stock de hoy.
 */

import { StockSyncError } from './engine'
import { MAX_FICHERO_BYTES, type SubidaManual } from './proceso'

/**
 * Extensiones que sabe abrir el motor. Comprobarlo aquí ahorra subir dos megas
 * para que el lector falle después con un mensaje sobre hojas y cabeceras que
 * no tiene nada que ver con el problema real, que es que eso es un PDF.
 */
const ACEPTADAS = ['.xlsx', '.xls', '.csv']

/**
 * El primer fichero del formulario que venga con alguno de esos nombres.
 *
 * El `instanceof File` NO se usa: el File del runtime de Next y el de Node no
 * son la misma clase, así que se comprueba por forma (tiene arrayBuffer y
 * name). Es el mismo criterio que lib/stock-sync/api.ts.
 */
export function ficheroDeFormulario(form: FormData, nombres: string[]): File | null {
  for (const nombre of nombres) {
    const valor = form.get(nombre)
    if (valor && typeof valor !== 'string' && typeof (valor as File).arrayBuffer === 'function') {
      const file = valor as File
      if (file.size > 0) return file
    }
  }
  return null
}

/** Bytes del fichero, comprobando el tamaño ANTES de reservar memoria por él */
export async function leerSubida(file: File, etiqueta: string): Promise<SubidaManual> {
  if (file.size > MAX_FICHERO_BYTES) {
    throw new StockSyncError(
      `${etiqueta} ocupa ${mb(file.size)} MB y el máximo son ${mb(MAX_FICHERO_BYTES)} MB`
    )
  }

  const lower = file.name.toLowerCase()
  if (!ACEPTADAS.some((ext) => lower.endsWith(ext))) {
    throw new StockSyncError(
      `${etiqueta} se llama «${file.name}» y no es un .xlsx, .xls ni .csv. Comprueba que es el fichero que querías subir.`
    )
  }

  return { nombre: file.name, bytes: await file.arrayBuffer(), tamano: file.size }
}

/** Igual pero opcional: si no viene el fichero, devuelve null en vez de fallar */
export async function leerSubidaOpcional(
  form: FormData,
  nombres: string[],
  etiqueta: string
): Promise<SubidaManual | null> {
  const file = ficheroDeFormulario(form, nombres)
  return file ? leerSubida(file, etiqueta) : null
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}
