'use client'

import { forwardRef, useCallback, useImperativeHandle, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import { AVISO, COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'

/**
 * LO QUE TAPA LA PANTALLA, COLGADO DEL <body>.
 *
 * La animación de entrada de la página deja puesto un `transform`, y con él un `fixed inset-0` mide como el contenido y no
 * como la ventana: el panel se cortaba donde acababa la tabla, con media pantalla vacía debajo y la barra lateral sin tapar.
 */
export function SobreLaPagina({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
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
