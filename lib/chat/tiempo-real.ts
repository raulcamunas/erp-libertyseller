import type { EventoDeChat } from './tipos'

/**
 * EL REPARTO EN DIRECTO. El servidor guarda el mensaje y lo reparte por Realtime Broadcast: cada persona escucha UN canal privado propio, `chat:<su id>` (la política de la migración 284 solo
 * deja entrar a su dueño). Viaja por memoria, sin pasar por el disco de la base. Si falla, no pasa nada grave: el mensaje ya está guardado y la pantalla lo recoge al volver a la pestaña o
 * al recargar; por eso nunca lanza error y quien llama no espera por él.
 */
const POR_TANDA = 100

export async function emitir(usuarios: readonly string[], evento: EventoDeChat): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY
  const unicos = [...new Set(usuarios)]
  if (!url || !clave || unicos.length === 0) return
  try {
    for (let i = 0; i < unicos.length; i += POR_TANDA) {
      const respuesta = await fetch(`${url}/realtime/v1/api/broadcast`, {
        method: 'POST',
        headers: { apikey: clave, Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: unicos.slice(i, i + POR_TANDA).map((u) => ({ topic: `chat:${u}`, event: 'chat', payload: evento, private: true })) }),
        signal: AbortSignal.timeout(4000),
        cache: 'no-store',
      })
      if (!respuesta.ok) console.error('Chat: el reparto en directo ha fallado:', respuesta.status)
    }
  } catch (e) {
    console.error('Chat: el reparto en directo ha fallado:', e instanceof Error ? e.message : e)
  }
}
