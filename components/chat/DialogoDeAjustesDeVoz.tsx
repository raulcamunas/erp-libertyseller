'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Room, Track } from 'livekit-client'
import { Headphones, Mic, RotateCcw, Square, X } from 'lucide-react'
import { restriccionesDeMicro } from '@/lib/chat/audio'
import { dialogoDeVozAbierto, ponerDialogoDeVoz, suscribirDialogoDeVoz } from '@/lib/chat/dialogo-voz'
import { AJUSTES_DE_VOZ_POR_DEFECTO, dbAMedidor, umbralADb, type AjustesDeVoz } from '@/lib/chat/voz-ajustes'
import { ProcesadorDeVoz } from '@/lib/chat/voz-procesador'
import { useJunta } from './JuntaProvider'

/** El medidor: lo que entra por el micrófono, con una marca donde está el umbral de la puerta de ruido */
function Medidor({ nivelDb, voz, abierta, activa }: { nivelDb: number; voz: AjustesDeVoz; abierta: boolean; activa: boolean }) {
  const lleno = activa ? dbAMedidor(nivelDb) : 0
  const pasa = !voz.puerta || abierta
  return (
    <div className="voz-medidor" role="meter" aria-label="Nivel de tu micrófono" aria-valuemin={-90} aria-valuemax={0} aria-valuenow={Math.round(nivelDb)}>
      <div className="voz-medidor-barra" data-pasa={activa && pasa ? 'true' : undefined} style={{ width: `${lleno}%` }} />
      {voz.puerta && <div className="voz-medidor-marca" style={{ left: `${dbAMedidor(umbralADb(voz.umbral))}%` }} title={`Umbral: ${Math.round(umbralADb(voz.umbral))} dB`} />}
    </div>
  )
}

/**
 * LA PRUEBA DEL MICRÓFONO, EN TIEMPO REAL. Abre el micrófono elegido y lo pasa por EL MISMO procesador que usa la llamada (volumen y puerta de ruido), así que lo que ves en el medidor y lo que oyes si
 * activas «escucharme» es lo que de verdad saldría. Cambiar un ajuste se nota al instante. Se para sola al cerrar la ventana.
 */
function usePruebaDeMicro(entrada: string, restricciones: MediaTrackConstraints, voz: AjustesDeVoz, salida: string) {
  const [activa, setActiva] = useState(false)
  const [error, setError] = useState('')
  const [nivelDb, setNivelDb] = useState(-100)
  const [abierta, setAbierta] = useState(true)
  const proc = useRef<ProcesadorDeVoz | null>(null)
  const recursos = useRef<{ flujo: MediaStream; ctx: AudioContext; cuadro: number } | null>(null)
  const vozRef = useRef(voz)
  vozRef.current = voz
  const escucharRef = useRef(false)

  const parar = useCallback(() => {
    const r = recursos.current
    recursos.current = null
    if (r) {
      cancelAnimationFrame(r.cuadro)
      r.flujo.getTracks().forEach((t) => t.stop())
      void r.ctx.close().catch(() => undefined)
    }
    void proc.current?.destroy()
    proc.current = null
    setActiva(false)
    setNivelDb(-100)
  }, [])

  const empezar = useCallback(async () => {
    setError('')
    try {
      const flujo = await navigator.mediaDevices.getUserMedia({ audio: { ...restricciones, ...(entrada ? { deviceId: { exact: entrada } } : {}) } })
      const ctx = new AudioContext()
      const sink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }
      if (salida && sink.setSinkId) void sink.setSinkId(salida).catch(() => undefined)
      const p = new ProcesadorDeVoz(vozRef.current)
      await p.init({ kind: Track.Kind.Audio, track: flujo.getAudioTracks()[0], audioContext: ctx })
      p.escucharme(escucharRef.current)
      proc.current = p
      const bucle = () => {
        setNivelDb(p.nivelDb())
        setAbierta(p.puertaAbierta())
        if (recursos.current) recursos.current.cuadro = requestAnimationFrame(bucle)
      }
      recursos.current = { flujo, ctx, cuadro: 0 }
      recursos.current.cuadro = requestAnimationFrame(bucle)
      setActiva(true)
    } catch (e) {
      parar()
      setError(e instanceof Error && /denied|permission|notallowed/i.test(`${e.name} ${e.message}`) ? 'El navegador no deja usar el micrófono: mira el permiso de esta página.' : 'No se ha podido abrir ese micrófono.')
    }
  }, [entrada, parar, restricciones, salida])

  // Un ajuste cambia: se nota al instante en el medidor
  useEffect(() => {
    proc.current?.actualizar(voz)
  }, [voz])
  useEffect(() => parar, [parar])

  const escucharme = useCallback((v: boolean) => {
    escucharRef.current = v
    proc.current?.escucharme(v)
  }, [])
  return { activa, error, nivelDb, abierta, empezar, parar, escucharme }
}

/** Los dispositivos de audio del equipo (los nombres solo salen tras dar permiso al micrófono) */
function useDispositivos(refrescar: unknown) {
  const [micros, setMicros] = useState<MediaDeviceInfo[]>([])
  const [altavoces, setAltavoces] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    let vivo = true
    void Promise.all([Room.getLocalDevices('audioinput', false).catch(() => []), Room.getLocalDevices('audiooutput', false).catch(() => [])]).then(([m, a]) => {
      if (!vivo) return
      setMicros(m.filter((d) => d.deviceId && d.deviceId !== 'default'))
      setAltavoces(a.filter((d) => d.deviceId && d.deviceId !== 'default'))
    })
    return () => {
      vivo = false
    }
  }, [refrescar])
  return { micros, altavoces }
}

function Contenido() {
  const { audio, cambiarAudio, voz, cambiarVoz } = useJunta()
  const [oyendo, setOyendo] = useState(false)
  const restricciones = restriccionesDeMicro(audio)
  const prueba = usePruebaDeMicro(audio.entrada, restricciones, voz, audio.salida)
  const { micros, altavoces } = useDispositivos(prueba.activa)

  // Cambiar el micrófono o su procesado reinicia la prueba (si estaba en marcha) para que pase por el nuevo
  const reiniciar = useCallback(() => {
    if (!prueba.activa) return
    prueba.parar()
    setTimeout(() => void prueba.empezar(), 60)
  }, [prueba])
  const ref = useRef(reiniciar)
  ref.current = reiniciar
  const primera = useRef(true)
  useEffect(() => {
    if (primera.current) return void (primera.current = false)
    ref.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio.entrada, audio.salida, audio.supresion, audio.eco, audio.nivelacion])

  const estado = !prueba.activa ? 'Pulsa «Probar micrófono» y habla: verás aquí cómo te oye la llamada.' : prueba.nivelDb < -75 ? 'Silencio' : voz.puerta && !prueba.abierta ? 'Se corta: estás por debajo del umbral' : 'Se te oye'
  const interruptor = (clave: 'supresion' | 'eco' | 'nivelacion', titulo: string, ayuda: string) => (
    <label className="chat-audio-fila">
      <span><b>{titulo}</b><small>{ayuda}</small></span>
      <input type="checkbox" role="switch" checked={audio[clave]} onChange={(e) => void cambiarAudio({ [clave]: e.target.checked })} />
    </label>
  )
  return (
    <div className="chat-dialogo-cuerpo voz-dialogo-cuerpo">
      <section className="voz-bloque">
        <h3>Prueba tu micrófono</h3>
        <Medidor nivelDb={prueba.nivelDb} voz={voz} abierta={prueba.abierta} activa={prueba.activa} />
        <p className="voz-estado" data-estado={!prueba.activa ? 'parada' : prueba.nivelDb < -75 ? 'silencio' : voz.puerta && !prueba.abierta ? 'corta' : 'oye'} aria-live="polite">{estado}</p>
        <div className="voz-prueba-mandos">
          {prueba.activa ? (
            <button type="button" className="tc-boton-primario" onClick={prueba.parar}><Square className="mr-1.5 inline h-3.5 w-3.5" />Parar la prueba</button>
          ) : (
            <button type="button" className="tc-boton-primario" onClick={() => void prueba.empezar()}><Mic className="mr-1.5 inline h-3.5 w-3.5" />Probar micrófono</button>
          )}
          <label className="voz-escucharme">
            <input type="checkbox" checked={oyendo} onChange={(e) => { setOyendo(e.target.checked); prueba.escucharme(e.target.checked) }} />
            <span><Headphones className="mr-1 inline h-3.5 w-3.5" />Escucharme <small>(usa auriculares: con altavoces da eco)</small></span>
          </label>
        </div>
        {prueba.error && <p className="voz-error" role="alert">{prueba.error}</p>}
      </section>

      <section className="voz-bloque">
        <h3>Tu voz</h3>
        <label className="voz-deslizador">
          <span><b>Volumen del micrófono</b><i>{voz.volumen} %</i></span>
          <input type="range" min={0} max={200} step={5} value={voz.volumen} onChange={(e) => cambiarVoz({ volumen: Number(e.target.value) })} aria-label="Volumen del micrófono" />
          <small>100 % es sin tocar. Súbelo si la gente te oye bajito, bájalo si saturas.</small>
        </label>
        <label className="chat-audio-fila">
          <span><b>Puerta de ruido</b><small>Corta todo lo que esté por debajo del nivel que marques: teclado, ventilador, la tele de fondo</small></span>
          <input type="checkbox" role="switch" checked={voz.puerta} onChange={(e) => cambiarVoz({ puerta: e.target.checked })} />
        </label>
        <label className="voz-deslizador" data-apagado={!voz.puerta ? 'true' : undefined}>
          <span><b>Sensibilidad</b><i>{Math.round(umbralADb(voz.umbral))} dB</i></span>
          <input type="range" min={0} max={100} value={voz.umbral} disabled={!voz.puerta} onChange={(e) => cambiarVoz({ umbral: Number(e.target.value) })} aria-label="Sensibilidad de la puerta de ruido" />
          <small className="voz-extremos"><span>Muy sensible: se cuela hasta el ruido</span><span>Poco sensible: hay que hablar fuerte</span></small>
          <small>Ponla justo por encima del ruido de fondo (la marca naranja del medidor): hablando, la barra tiene que pasarla.</small>
        </label>
      </section>

      <section className="voz-bloque">
        <h3>Dispositivos</h3>
        <label className="chat-audio-campo">
          <span>Micrófono</span>
          <select value={audio.entrada} onChange={(e) => void cambiarAudio({ entrada: e.target.value })}>
            <option value="">El del sistema</option>
            {micros.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Micrófono'}</option>)}
          </select>
        </label>
        {altavoces.length > 0 && (
          <label className="chat-audio-campo">
            <span>Altavoz</span>
            <select value={audio.salida} onChange={(e) => void cambiarAudio({ salida: e.target.value })}>
              <option value="">El del sistema</option>
              {altavoces.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Altavoz'}</option>)}
            </select>
          </label>
        )}
        {micros.length > 0 && micros.every((d) => !d.label) && <p className="voz-nota">Los nombres de los dispositivos salen después de dar permiso al micrófono (pulsa «Probar micrófono»).</p>}
        {interruptor('supresion', 'Supresión de ruido', 'Quita teclado, ventilador y ruido de fondo')}
        {interruptor('eco', 'Cancelar el eco', 'Evita que tu voz vuelva por los altavoces')}
        {interruptor('nivelacion', 'Nivelar mi micrófono', 'Sube o baja el volumen solo, para que se te oiga siempre igual')}
      </section>
      <p className="voz-nota">Solo cambia lo tuyo y se guarda en este navegador. Los cambios se aplican también a la llamada en curso.</p>
    </div>
  )
}

/**
 * «AJUSTES DE VOZ»: volumen del micrófono, sensibilidad (puerta de ruido), dispositivos y una prueba en tiempo real con medidor. Se abre desde la barra del chat y desde los ajustes de audio de la junta
 * (lib/chat/dialogo-voz.ts); un solo componente la pinta.
 */
export function DialogoDeAjustesDeVoz() {
  const abierto = useSyncExternalStore(suscribirDialogoDeVoz, dialogoDeVozAbierto, () => false)
  const { cambiarVoz } = useJunta()
  useEffect(() => {
    if (!abierto) return
    const alTeclear = (e: KeyboardEvent) => e.key === 'Escape' && ponerDialogoDeVoz(false)
    document.addEventListener('keydown', alTeclear)
    return () => document.removeEventListener('keydown', alTeclear)
  }, [abierto])
  if (!abierto || typeof document === 'undefined') return null
  const cerrar = () => ponerDialogoDeVoz(false)
  return createPortal(
    <div className="tc-modal-fondo" onClick={(e) => e.target === e.currentTarget && cerrar()}>
      <div className="tc-modal chat-dialogo voz-dialogo" role="dialog" aria-modal="true" aria-label="Ajustes de voz">
        <header className="tc-modal-cabecera">
          <span className="text-[15px] font-semibold text-[var(--ls-t1)]">Ajustes de voz</span>
          <button type="button" onClick={() => cambiarVoz(AJUSTES_DE_VOZ_POR_DEFECTO)} className="tc-icono-boton ml-auto" title="Volver a lo de fábrica (volumen y puerta)" aria-label="Volver a lo de fábrica">
            <RotateCcw className="h-4 w-4" />
          </button>
          <button type="button" onClick={cerrar} aria-label="Cerrar" className="tc-icono-boton"><X className="h-4 w-4" /></button>
        </header>
        <Contenido />
      </div>
    </div>,
    document.body
  )
}
