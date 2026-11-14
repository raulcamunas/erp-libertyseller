/**
 * EL ENVÍO A NOTION «PRONTO»: unos segundos después de cada cambio hecho en el ERP se manda la cola a Notion, sin esperar a la pasada periódica del cron.
 *
 * Solo corre en el servidor que sigue vivo entre peticiones (el de Easypanel); una petición que llega y se va no lo espera. Lo que se queda en la cola si el servidor se
 * reinicia o si Notion falló lo recoge el cron (`/api/tareas-clientes/notion/cron`) y, mientras tanto, el reintento programado aquí.
 *
 *   · Varios cambios seguidos (escribir en el editor guarda cada pocos segundos) se agrupan: hay un solo temporizador y se manda todo junto.
 *   · Si la pasada entera tiene el turno, se espera y se reintenta (ella vaciará la cola al final, pero lo que se encole después no entraría).
 *   · Si algo falló, se reprograma para cuando le toque el siguiente reintento (con un tope de 15 minutos).
 */

const ESPERA_MS = 1_500
const ESPERA_SI_OCUPADO_MS = 8_000
const TOPE_DE_REINTENTO_MS = 15 * 60_000
const MAX_REINTENTOS_POR_OCUPADO = 5

let temporizador: ReturnType<typeof setTimeout> | null = null
let corriendo = false
let repetir = false

export function programarEnvioANotion(cuandoMs: number = ESPERA_MS, intento = 0): void {
  if (temporizador) return
  temporizador = setTimeout(() => {
    temporizador = null
    void correr(intento)
  }, cuandoMs)
}

async function correr(intento: number): Promise<void> {
  if (corriendo) {
    repetir = true
    return
  }
  corriendo = true
  try {
    do {
      repetir = false
      // Import dinámico: sync.ts importa servidor.ts, que es quien llama a esta función
      const { vaciarSoloLaCola } = await import('./sync')
      const r = await vaciarSoloLaCola()
      if (r.ocupado && intento < MAX_REINTENTOS_POR_OCUPADO) programarEnvioANotion(ESPERA_SI_OCUPADO_MS, intento + 1)
      else if (r.proximoEnMs !== null) programarEnvioANotion(Math.min(r.proximoEnMs, TOPE_DE_REINTENTO_MS), 0)
    } while (repetir)
  } catch (e) {
    console.error('No se ha podido mandar la cola a Notion:', e instanceof Error ? e.message : e)
  } finally {
    corriendo = false
  }
}
