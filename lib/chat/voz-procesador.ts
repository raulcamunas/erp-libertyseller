import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client'
import { decidirPuerta, ganancia, nivelEnDb, umbralADb, type AjustesDeVoz } from './voz-ajustes'

/**
 * EL PROCESADOR DE TU MICRÓFONO — solo navegador. Se cuelga de la pista de micrófono de LiveKit (`track.setProcessor`) y hace dos cosas con el audio antes de que salga: subirlo o bajarlo
 * (volumen) y cortar lo que esté por debajo del umbral (puerta de ruido, con una pequeña retención para no comerse las pausas). La lógica de cuándo abre y cierra es lib/chat/voz-ajustes.ts.
 *
 * Es el MISMO que usa la prueba de micrófono de los ajustes (components/chat/DialogoDeAjustesDeVoz.tsx): lo que ves en el medidor es exactamente lo que hace la llamada. Expone el nivel de
 * entrada y si la puerta está abierta para dibujarlos. Con los valores de fábrica no se usa: el audio va directo (necesitaProcesador).
 */

const CADA_MS = 20

export class ProcesadorDeVoz implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = 'liberty-voz'
  processedTrack?: MediaStreamTrack

  private ajustes: AjustesDeVoz
  private ctx: AudioContext | null = null
  private fuente: MediaStreamAudioSourceNode | null = null
  private entrada: GainNode | null = null
  private analizador: AnalyserNode | null = null
  private puerta: GainNode | null = null
  private destino: MediaStreamAudioDestinationNode | null = null
  private temporizador: ReturnType<typeof setInterval> | null = null
  private muestras: Float32Array<ArrayBuffer> | null = null
  private abierta = true
  private ultimoSobreMs = 0
  private nivel = -100
  private escuchando = false

  constructor(ajustes: AjustesDeVoz) {
    this.ajustes = { ...ajustes }
  }

  async init(opts: AudioProcessorOptions): Promise<void> {
    const ctx = opts.audioContext
    this.ctx = ctx
    this.fuente = ctx.createMediaStreamSource(new MediaStream([opts.track]))
    this.entrada = ctx.createGain()
    this.entrada.gain.value = ganancia(this.ajustes.volumen)
    this.analizador = ctx.createAnalyser()
    this.analizador.fftSize = 1024
    this.puerta = ctx.createGain()
    this.destino = ctx.createMediaStreamDestination()
    this.fuente.connect(this.entrada)
    this.entrada.connect(this.analizador)
    this.entrada.connect(this.puerta)
    this.puerta.connect(this.destino)
    if (this.escuchando) this.puerta.connect(ctx.destination)
    this.processedTrack = this.destino.stream.getAudioTracks()[0]
    this.muestras = new Float32Array(new ArrayBuffer(this.analizador.fftSize * 4))
    this.abierta = !this.ajustes.puerta
    this.ultimoSobreMs = Date.now()
    this.temporizador = setInterval(() => this.medir(), CADA_MS)
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.destroy()
    await this.init(opts)
  }

  async destroy(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador)
    this.temporizador = null
    for (const n of [this.fuente, this.entrada, this.analizador, this.puerta, this.destino]) {
      try {
        n?.disconnect()
      } catch {
        /* ya estaba suelto */
      }
    }
    this.fuente = this.entrada = this.analizador = this.puerta = this.destino = null
    this.processedTrack = undefined
  }

  /** Cambia el volumen y la puerta sin cortar el audio */
  actualizar(ajustes: AjustesDeVoz): void {
    this.ajustes = { ...ajustes }
    if (this.entrada && this.ctx) this.entrada.gain.setTargetAtTime(ganancia(ajustes.volumen), this.ctx.currentTime, 0.02)
    if (!ajustes.puerta) this.poner(true)
  }

  /** El nivel de lo que entra por el micrófono (ya con el volumen aplicado), en decibelios: lo que mira la puerta */
  nivelDb(): number {
    return this.nivel
  }

  puertaAbierta(): boolean {
    return this.abierta
  }

  /** Oírte a ti mismo por los altavoces (solo para probar; con altavoces y no auriculares da eco) */
  escucharme(activar: boolean): void {
    this.escuchando = activar
    if (!this.puerta || !this.ctx) return
    try {
      if (activar) this.puerta.connect(this.ctx.destination)
      else this.puerta.disconnect(this.ctx.destination)
    } catch {
      /* ya estaba como se pide */
    }
  }

  private poner(abierta: boolean): void {
    this.abierta = abierta
    // Se abre rápido (para no comerse el principio de la palabra) y se cierra con suavidad (para que no haga «clic»)
    if (this.puerta && this.ctx) this.puerta.gain.setTargetAtTime(abierta ? 1 : 0, this.ctx.currentTime, abierta ? 0.008 : 0.05)
  }

  private medir(): void {
    if (!this.analizador || !this.muestras) return
    this.analizador.getFloatTimeDomainData(this.muestras)
    let suma = 0
    for (let i = 0; i < this.muestras.length; i++) suma += this.muestras[i] * this.muestras[i]
    this.nivel = nivelEnDb(Math.sqrt(suma / this.muestras.length))
    if (!this.ajustes.puerta) {
      if (!this.abierta) this.poner(true)
      return
    }
    const ahora = Date.now()
    const d = decidirPuerta({ nivelDb: this.nivel, umbralDb: umbralADb(this.ajustes.umbral), abierta: this.abierta, ultimoSobreMs: this.ultimoSobreMs, ahoraMs: ahora })
    this.ultimoSobreMs = d.ultimoSobreMs
    if (d.abierta !== this.abierta) this.poner(d.abierta)
  }
}
