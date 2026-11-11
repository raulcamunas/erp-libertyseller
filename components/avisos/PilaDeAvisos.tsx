'use client'

import { CalendarCheck, Flame, Mail, MailWarning, MessageSquare, X, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { cerrarAviso, leerAvisos, suscribirAvisos, type Aviso, type TipoDeAviso } from '@/lib/avisos/pila'
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'

/**
 * LOS AVISOS DE ABAJO A LA DERECHA: tarjetas que entran deslizándose, se quedan unos segundos y se van solas.
 *
 *   · Con el ratón encima NO se van: la barra de abajo (que cuenta lo que les queda) y el temporizador se paran.
 *   · Con la pestaña oculta tampoco corre el tiempo: lo que llega mientras no se mira sigue ahí al volver.
 *   · Pulsar la tarjeta hace lo que dice su botón (abrir el correo, ir a Correo) y la cierra; la X solo la cierra.
 *   · Entran sin movimiento si la persona ha pedido menos movimiento (`prefers-reduced-motion`, en globals.css).
 *
 * Los publica quien lo sabe (components/avisos/AvisosEnVivo.tsx) en lib/avisos/pila.ts; esto solo los pinta. Va FUERA del recuadro animado
 * del layout, para que `fixed` sea respecto a la ventana.
 *
 * Se apilan ENCIMA de lo que haya en la esquina (la pastilla o la ventana del chat, las tarjetas del chat, la cápsula de la junta): lo publica el dock en `--dock-arriba` y
 * `--avisos-derecha` (components/chat/DockDelChat.tsx) y la pila se mueve con suavidad cuando eso cambia. Cada aviso abre su hueco al entrar y lo cierra al irse, así que los de
 * encima se deslizan en vez de saltar (globals.css, `.pila-hueco`). Si no caben, los más viejos se esconden por arriba.
 */

const ICONO: Record<TipoDeAviso, { icono: LucideIcon; tono: TonoEstado }> = {
  correo: { icono: Mail, tono: 'azul' },
  rebote: { icono: MailWarning, tono: 'ambar' },
  hito: { icono: Flame, tono: 'ambar' },
  cita: { icono: CalendarCheck, tono: 'verde' },
  tarea: { icono: MessageSquare, tono: 'azul' },
}

const vacia: readonly Aviso[] = []

function Tarjeta({ aviso }: { aviso: Aviso }) {
  const { icono: Icono, tono } = ICONO[aviso.tipo]
  const color = COLOR_ESTADO[tono]
  const [encima, setEncima] = useState(false)
  const [oculta, setOculta] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden')
  const pausada = encima || oculta

  // Cuánto tiempo queda, que se va descontando cada vez que se para
  const restante = useRef(aviso.duracionMs)
  const arrancó = useRef(0)

  useEffect(() => {
    const alCambiar = () => setOculta(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', alCambiar)
    return () => document.removeEventListener('visibilitychange', alCambiar)
  }, [])

  useEffect(() => {
    if (pausada) return
    arrancó.current = Date.now()
    const temporizador = setTimeout(() => cerrarAviso(aviso.id), Math.max(0, restante.current))
    return () => {
      clearTimeout(temporizador)
      restante.current -= Date.now() - arrancó.current
    }
  }, [pausada, aviso.id])

  const pulsar = () => {
    aviso.accion?.alPulsar()
    cerrarAviso(aviso.id)
  }

  return (
    <div
      role="status"
      className="rend-aviso pointer-events-auto relative w-full overflow-hidden rounded-[12px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] shadow-2xl shadow-black/40"
      onMouseEnter={() => setEncima(true)}
      onMouseLeave={() => setEncima(false)}
    >
      <div className="flex items-start gap-3 p-3 pr-9">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]" style={{ color, background: `color-mix(in srgb, ${color} 15%, var(--ls-sup))` }}>
          <Icono className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold leading-tight text-[var(--ls-t1)]">{aviso.titulo}</p>
          {aviso.detalle && <p className="mt-0.5 truncate text-[12px] leading-snug text-[var(--ls-t2)]">{aviso.detalle}</p>}
          {aviso.texto && <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-[var(--ls-t4)]">{aviso.texto}</p>}
          {aviso.accion && (
            <button type="button" onClick={pulsar} className="mt-2 inline-flex h-6 items-center rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-2 text-[11.5px] font-medium text-[var(--ls-t1)] transition-colors hover:border-[var(--ls-acc-graf)] hover:bg-[var(--ls-sup3)]">
              {aviso.accion.etiqueta}
            </button>
          )}
        </div>
      </div>
      <button type="button" onClick={() => cerrarAviso(aviso.id)} aria-label="Cerrar el aviso" className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--ls-t4)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]">
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
      <span aria-hidden className="rend-cuenta-atras absolute inset-x-0 bottom-0 h-[2px]" style={{ background: color, '--dur': `${aviso.duracionMs}ms`, animationPlayState: pausada ? 'paused' : undefined } as CSSProperties} />
    </div>
  )
}

/** El hueco de un aviso en la pila: se abre al entrar y se cierra al irse (mientras se anima, recorta lo que sobresale; después deja ver la sombra) */
function Hueco({ aviso, saliendo }: { aviso: Aviso; saliendo: boolean }) {
  const [entrando, setEntrando] = useState(true)
  return (
    <li className="pila-hueco" data-entrando={entrando ? 'true' : undefined} data-saliendo={saliendo ? 'true' : undefined} onAnimationEnd={(e) => e.target === e.currentTarget && setEntrando(false)}>
      <div className="pila-hueco-dentro">
        <Tarjeta aviso={aviso} />
      </div>
    </li>
  )
}

/** Lo que tarda un aviso en irse (globals.css, `pila-cierra`) */
const SALIDA_MS = 320

export function PilaDeAvisos() {
  const avisos = useSyncExternalStore(suscribirAvisos, leerAvisos, () => vacia)
  // Los que se acaban de cerrar se quedan un momento, para irse con animación (y en su sitio de la pila)
  const [saliendo, setSaliendo] = useState<readonly Aviso[]>(vacia)
  const previos = useRef<readonly Aviso[]>(vacia)
  const orden = useRef(new Map<string, number>())
  const contador = useRef(0)
  const relojes = useRef(new Set<ReturnType<typeof setTimeout>>())

  for (const a of avisos) if (!orden.current.has(a.id)) orden.current.set(a.id, contador.current++)

  useEffect(() => {
    const vivos = new Set(avisos.map((a) => a.id))
    const idos = previos.current.filter((a) => !vivos.has(a.id))
    previos.current = avisos
    if (idos.length === 0) return
    setSaliendo((s) => [...s.filter((a) => !vivos.has(a.id)), ...idos])
    const reloj = setTimeout(() => {
      relojes.current.delete(reloj)
      setSaliendo((s) => s.filter((a) => !idos.some((i) => i.id === a.id)))
      for (const i of idos) if (!avisos.some((a) => a.id === i.id)) orden.current.delete(i.id)
    }, SALIDA_MS)
    relojes.current.add(reloj)
  }, [avisos])

  useEffect(() => {
    const r = relojes.current
    return () => {
      for (const t of r) clearTimeout(t)
    }
  }, [])

  const todos = useMemo(() => {
    const vivos = new Set(avisos.map((a) => a.id))
    const lista = [...avisos.map((a) => ({ aviso: a, saliendo: false })), ...saliendo.filter((a) => !vivos.has(a.id)).map((a) => ({ aviso: a, saliendo: true }))]
    return lista.sort((x, y) => (orden.current.get(x.aviso.id) ?? 0) - (orden.current.get(y.aviso.id) ?? 0))
  }, [avisos, saliendo])

  if (todos.length === 0) return null
  return (
    <ol aria-label="Avisos" className="pila-de-avisos">
      {todos.map(({ aviso, saliendo: s }) => (
        <Hueco key={aviso.id} aviso={aviso} saliendo={s} />
      ))}
    </ol>
  )
}
