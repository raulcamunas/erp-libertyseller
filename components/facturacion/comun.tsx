'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, X, type LucideIcon } from 'lucide-react'
import { Esqueleto, Numero } from '@/components/rendimiento/ui'
import { AVISO, BOTON, COLOR_ESTADO, TARJETA, TEXTO, TEXTO_ESTADO, TIPO, TITULO, type TonoEstado } from '@/lib/estilo/denso'

/**
 * LO QUE TAPA LA PANTALLA, COLGADO DEL <body>.
 *
 * La animación de entrada de la página deja puesto un `transform`, y con él un `fixed inset-0` mide como el contenido y no
 * como la ventana: el panel se cortaba donde acababa la tabla, con media pantalla vacía debajo y la barra lateral sin tapar.
 */
export function SobreLaPagina({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}

/** Lo que tarda en irse lo que tapa la pantalla; la animación está en `.fac-velo[data-saliendo]` */
export function useSalida(onCerrar: () => void) {
  const [saliendo, setSaliendo] = useState(false)
  const cerrar = useCallback(() => {
    setSaliendo(true)
    window.setTimeout(onCerrar, 170)
  }, [onCerrar])
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrar()
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [cerrar])
  return { saliendo, cerrar }
}

/** El color de una pieza `fac-*`, que siempre sale de COLOR_ESTADO */
export const tonoComoEstilo = (tono: TonoEstado) => ({ '--tono': COLOR_ESTADO[tono] }) as CSSProperties
export const enteros = (n: number) => Math.round(n).toLocaleString('es-ES')

/** Cuenta desde cero al aparecer y, después, de un valor al siguiente: el contador común parte de su valor la primera vez */
export function Cuenta({ valor, formato }: { valor: number; formato?: (n: number) => string }) {
  const [objetivo, setObjetivo] = useState(0)
  useEffect(() => setObjetivo(valor), [valor])
  return <Numero valor={objetivo} formato={formato} />
}

/** El foco de luz de una tarjeta sigue al ratón */
export function seguirAlRaton(e: MouseEvent<HTMLElement>) {
  const caja = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty('--x', `${e.clientX - caja.left}px`)
  e.currentTarget.style.setProperty('--y', `${e.clientY - caja.top}px`)
}

/** Una barra de colores repartida entre sus tramos. Uno a cero no se pinta: su separación se vería como una muesca */
export function BarraDeReparto({
  tramos,
  etiqueta,
  completa = false,
}: {
  tramos: { id: string; nombre: string; tono: TonoEstado; valor: number; apagado?: boolean }[]
  etiqueta: string
  completa?: boolean
}) {
  return (
    <div className="fac-barra" data-completa={completa} role="img" aria-label={etiqueta}>
      {tramos
        .filter((t) => t.valor > 0)
        .map((t) => (
          <span key={t.id} title={t.nombre} className="fac-tramo" data-apagado={Boolean(t.apagado)} style={{ ...tonoComoEstilo(t.tono), '--parte': t.valor } as CSSProperties} />
        ))}
    </div>
  )
}

/** Una casilla de la tira de un resumen: cuántas hay, cuánto suman, y pulsarla deja solo esas */
export function CasillaDeResumen({
  tono,
  icono: Icono,
  nombre,
  nota,
  cantidad,
  importe,
  destacar = false,
  encendida,
  siguiente = false,
  onPulsar,
}: {
  tono: TonoEstado
  icono: LucideIcon
  nombre: string
  nota?: string | null
  cantidad: number
  importe: number
  destacar?: boolean
  encendida: boolean
  /** Lleva a la siguiente casilla: una flecha lo dice */
  siguiente?: boolean
  onPulsar: () => void
}) {
  return (
    <button type="button" aria-pressed={encendida} onClick={onPulsar} onMouseMove={seguirAlRaton} className="fac-paso" style={tonoComoEstilo(tono)}>
      <span className="fac-paso-icono">
        <Icono className="h-[15px] w-[15px]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className={`flex items-center gap-1.5 ${TIPO.xs} ${TEXTO.t3}`}>
          {nombre}
          {nota && <span className={`font-medium ${TEXTO_ESTADO.rojo}`}>· {nota}</span>}
        </span>
        <span className="flex items-baseline gap-2">
          <span className={`text-[18px] font-semibold leading-none tabular-nums ${destacar && cantidad > 0 ? TEXTO.acento : TEXTO.t1}`}>
            <Cuenta valor={cantidad} formato={enteros} />
          </span>
          <span className={`truncate ${TIPO.s} tabular-nums ${TEXTO.t3}`}>
            <Cuenta valor={importe} formato={dinero} />
          </span>
        </span>
      </span>
      {siguiente && <ChevronRight aria-hidden className="fac-paso-siguiente hidden lg:block" />}
    </button>
  )
}

/** La cabecera de una tarjeta: su icono de color, el título y cuántas cosas hay dentro */
export function CabeceraDeTarjeta({
  tono,
  icono: Icono,
  titulo,
  cantidad,
  derecha,
}: {
  tono: TonoEstado
  icono: LucideIcon
  titulo: string
  cantidad?: number
  derecha?: ReactNode
}) {
  return (
    <div className={TARJETA.cabecera} style={tonoComoEstilo(tono)}>
      <Icono className="h-[13px] w-[13px] shrink-0" style={{ color: COLOR_ESTADO[tono] }} />
      <span className={`${TITULO.seccion} truncate`}>{titulo}</span>
      {cantidad != null && <span className="fac-contador">{cantidad}</span>}
      {derecha && <span className="ml-auto flex min-w-0 items-center gap-2">{derecha}</span>}
    </div>
  )
}

/** Lo que ocupa una pestaña mientras se lee por primera vez */
export function EsqueletoDePestana({ etiqueta }: { etiqueta: string }) {
  return (
    <div role="status" aria-label={etiqueta} className="flex flex-col gap-2">
      <div className="rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3">
        <Esqueleto className="h-5 w-52" />
        <Esqueleto className="mt-3 h-1.5 w-full" />
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Esqueleto key={i} className="h-10" />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <Esqueleto key={i} className="h-5" />
        ))}
      </div>
    </div>
  )
}

/** Un cuadro sobre la pantalla: entra, sale, y se cierra con Escape o pulsando fuera */
export function Dialogo({
  titulo,
  tono,
  icono,
  onCerrar,
  caja = 'max-h-[90vh] max-w-[520px]',
  children,
}: {
  titulo: string
  tono: TonoEstado
  icono: LucideIcon
  onCerrar: () => void
  /** Medidas del cuadro */
  caja?: string
  children: ReactNode
}) {
  const { saliendo, cerrar } = useSalida(onCerrar)
  return (
    <SobreLaPagina>
      <div data-saliendo={saliendo} className="fac-velo fac-zona fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]" onClick={cerrar}>
        <div
          role="dialog"
          aria-label={titulo}
          onClick={(e) => e.stopPropagation()}
          className={`fac-dialogo flex w-full flex-col overflow-hidden rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] shadow-[0_24px_70px_rgba(0,0,0,0.4)] ${caja}`}
        >
          <CabeceraDeTarjeta
            tono={tono}
            icono={icono}
            titulo={titulo}
            derecha={
              <button type="button" aria-label="Cerrar" onClick={cerrar} className={BOTON.icono}>
                <X className="h-3.5 w-3.5" />
              </button>
            }
          />
          {children}
        </div>
      </div>
    </SobreLaPagina>
  )
}

export function dinero(n: number | null | undefined, moneda = 'EUR'): string {
  if (n == null) return '—'
  // `es-ES` no pone el punto de miles en cuatro cifras («6083,88 €») si no se le pide: al comparar columnas, se lee peor
  return n.toLocaleString('es-ES', { style: 'currency', currency: moneda, minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })
}

export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a.slice(2)}`
}

export const hoyISO = () => new Date().toISOString().slice(0, 10)

/** fetch que devuelve el JSON o lanza el mensaje de error que ha dado el servidor */
export async function pedir<T>(url: string, init?: { metodo?: string; cuerpo?: unknown }): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method: init?.metodo ?? 'GET',
      cache: 'no-store',
      ...(init?.cuerpo !== undefined
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.cuerpo) }
        : {}),
    })
  } catch {
    throw new Error('No hay conexión con el servidor. Inténtalo otra vez.')
  }
  const datos = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok || !datos) throw new Error(datos?.error ?? `Error ${res.status}`)
  return datos
}

export function Aviso({ tono, icono: Icono, children }: { tono: TonoEstado; icono: LucideIcon; children: ReactNode }) {
  return (
    <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO[tono] }}>
      <Icono className={AVISO.icono} style={{ color: COLOR_ESTADO[tono] }} />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export interface ManejoEditor {
  html: () => string
}

/**
 * EL CORREO, TAL COMO LO VA A VER EL CLIENTE, Y SE ESCRIBE ENCIMA.
 *
 * Un iframe aísla el HTML de la plantilla de los estilos del ERP. El sandbox no
 * lleva `allow-scripts`: es correo, aquí no corre nada. `allow-same-origin` es lo
 * que deja leer lo escrito al enviar. El contenido no se vuelve a pintar al
 * teclear: se manda al iframe solo cuando cambia `html` desde fuera, o el cursor
 * saltaría al principio con cada letra.
 */
export const EditorCorreo = forwardRef<ManejoEditor, { html: string; onEditado?: () => void; alto?: string }>(function EditorCorreo(
  { html, onEditado, alto = 'h-full' },
  ref
) {
  const marco = useRef<HTMLIFrameElement>(null)

  // El <style> que abre una plantilla el navegador lo sube al <head>: sin esto se perdería al guardar
  useImperativeHandle(
    ref,
    () => ({
      html: () => {
        const doc = marco.current?.contentDocument
        return doc?.body ? `${doc.head?.innerHTML ?? ''}${doc.body.innerHTML}` : html
      },
    }),
    [html]
  )

  const alCargar = useCallback(() => {
    const doc = marco.current?.contentDocument
    if (!doc?.body) return
    doc.body.contentEditable = 'true'
    doc.body.style.margin = '0'
    doc.body.style.outline = 'none'
    doc.body.addEventListener('input', () => onEditado?.())
    // Pulsar un botón del correo no tiene que sacar de la pantalla
    doc.addEventListener('click', (e) => {
      if ((e.target as HTMLElement | null)?.closest?.('a')) e.preventDefault()
    })
  }, [onEditado])

  return (
    <iframe
      ref={marco}
      srcDoc={html}
      sandbox="allow-same-origin"
      title="Correo"
      onLoad={alCargar}
      className={`w-full border-0 bg-white ${alto}`}
    />
  )
})
