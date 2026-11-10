/**
 * EL REPRODUCTOR OFICIAL DE YOUTUBE (IFrame Player API) — solo navegador. Se carga el script de YouTube una vez y se usa para dos cosas: reproducir la música de la sala (components/chat/ReproductorDeMusica.tsx)
 * y sacar los vídeos de una lista de reproducción a partir de su enlace (`expandirListaDeYouTube`), que es lo único que hace falta para añadir una lista entera sin clave de la API de datos.
 * Los métodos que se usan están declarados aquí; el resto de la API no se toca.
 */

export interface JugadorDeYouTube {
  loadVideoById(arg: { videoId: string; startSeconds?: number }): void
  cueVideoById(arg: { videoId: string; startSeconds?: number }): void
  playVideo(): void
  pauseVideo(): void
  stopVideo(): void
  seekTo(segundos: number, permitirBuscar: boolean): void
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): number
  setVolume(v: number): void
  getVolume(): number
  getPlaylist?(): string[] | null
  destroy(): void
}

export interface ApiDeYouTube {
  Player: new (destino: HTMLElement, opciones: Record<string, unknown>) => JugadorDeYouTube
  PlayerState: { UNSTARTED: -1; ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5 }
}

declare global {
  interface Window {
    YT?: ApiDeYouTube
    onYouTubeIframeAPIReady?: () => void
  }
}

let promesa: Promise<ApiDeYouTube> | null = null

/** Carga el script de YouTube (una sola vez) y devuelve su API cuando está lista */
export function cargarApiDeYouTube(): Promise<ApiDeYouTube> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Solo en el navegador'))
  if (window.YT?.Player) return Promise.resolve(window.YT)
  promesa ??= new Promise<ApiDeYouTube>((resolve, reject) => {
    const previa = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previa?.()
      if (window.YT?.Player) resolve(window.YT)
      else reject(new Error('YouTube no ha cargado'))
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    script.onerror = () => {
      promesa = null
      reject(new Error('No se ha podido cargar YouTube'))
    }
    document.head.appendChild(script)
  })
  return promesa
}

/**
 * Los vídeos de una lista de reproducción, por su id de lista. Abre un reproductor sin sonido fuera de pantalla solo el tiempo que tarda YouTube en decir qué hay en la lista (hasta 200) y lo destruye.
 * Devuelve [] si la lista es privada, no existe o tarda demasiado.
 */
export async function expandirListaDeYouTube(listaId: string, maximo = 100): Promise<string[]> {
  const YT = await cargarApiDeYouTube()
  const caja = document.createElement('div')
  caja.style.cssText = 'position:fixed;left:-9999px;top:0;width:200px;height:200px;pointer-events:none'
  const destino = document.createElement('div')
  caja.appendChild(destino)
  document.body.appendChild(caja)
  return new Promise<string[]>((resolve) => {
    let hecho = false
    let jugador: JugadorDeYouTube | null = null
    const fin = (ids: string[]) => {
      if (hecho) return
      hecho = true
      try {
        jugador?.destroy()
      } catch {
        /* ya no estaba */
      }
      caja.remove()
      resolve(ids.slice(0, maximo))
    }
    setTimeout(() => fin([]), 12_000)
    try {
      jugador = new YT.Player(destino, {
        width: 200,
        height: 200,
        playerVars: { listType: 'playlist', list: listaId, autoplay: 0, controls: 0 },
        events: {
          onReady: () => {
            let intentos = 0
            const t = setInterval(() => {
              const ids = jugador?.getPlaylist?.() ?? []
              if (ids.length > 0 || ++intentos > 40) {
                clearInterval(t)
                fin(ids)
              }
            }, 200)
          },
          onError: () => fin([]),
        },
      })
    } catch {
      fin([])
    }
  })
}
