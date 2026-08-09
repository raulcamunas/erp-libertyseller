'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info, X } from 'lucide-react'
import {
  BOTON,
  LINEA,
  RADIO,
  SUPERFICIE,
  TEXTO,
  TIPO,
  TITULO,
} from '@/lib/estilo/denso'

/**
 * EL BOTÓN DE INFORMACIÓN. UNO PARA TODO EL ERP.
 *
 * Existe por una petición literal: «no pongas tanto texto explicativo. Hazlo
 * bonito sin tanto texto. Pon un botón de información arriba y explica todo pero
 * no en medio de la pantalla».
 *
 *
 * ============ LA REGLA DE QUÉ VA DENTRO Y QUÉ SE QUEDA FUERA ============
 *
 * EN PANTALLA se queda lo imprescindible: la etiqueta de un campo y, como mucho,
 * UNA línea corta cuando sin ella el control es ambiguo.
 *
 * AQUÍ DENTRO va todo lo demás: el porqué, las consecuencias, los avisos largos,
 * y lo que hoy son cajas azules y amarillas encima de los controles.
 *
 * LA INFORMACIÓN NO SE PIERDE, SE MUEVE. El texto que explica por qué existe un
 * freno, o qué pasa si un SKU no tiene coste, tiene que seguir escrito: es lo
 * que separa «esto está roto» de «esto todavía no ha corrido». Lo único que
 * cambia es que deja de estar delante de quien ya lo sabe.
 *
 * LO QUE NO VA AQUÍ: un aviso ACCIONABLE de hoy —«esta conexión ha caducado»,
 * «este trabajo lleva dos noches fallando»— se queda en pantalla. Esconderlo
 * detrás de un botón es no darlo. El panel es para lo que se lee una vez, no
 * para lo que hay que atender.
 *
 *
 * ============ ACCESIBILIDAD: NO ES UN MODAL ============
 *
 * Es un cajón NO MODAL, y a propósito. Un modal obliga a atrapar el foco, y un
 * cepo de foco sobre un panel de solo lectura es justo la clase de trampa que
 * deja a alguien con teclado sin salida cuando el panel no tiene ni un control
 * dentro. Aquí:
 *
 *   · El foco va al panel al abrirlo, y VUELVE al botón al cerrarlo.
 *   · Escape cierra, en cualquier sitio de la página.
 *   · Tabular sale del panel con normalidad y sigue por la página; no hay cepo.
 *   · Pinchar en el velo cierra. El velo no tapa la página: la atenúa.
 *
 * Va por portal a <body> porque el contenedor del dashboard lleva una animación
 * con `transform`, y un `position: fixed` dentro de un elemento transformado se
 * ancla a ESE elemento y no a la ventana: el panel saldría a media pantalla y
 * cortado.
 */

export function BotonInfo({
  titulo,
  children,
  etiqueta = 'Qué es esta pantalla',
}: {
  /** Cabecera del panel. Suele ser el nombre de la pestaña */
  titulo: string
  /** La explicación entera */
  children: React.ReactNode
  /** Lo que lee un lector de pantalla en el botón */
  etiqueta?: string
}) {
  const [abierto, setAbierto] = useState(false)
  const [montado, setMontado] = useState(false)
  const botonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const idPanel = useId()

  // createPortal necesita document, que en el render del servidor no existe.
  useEffect(() => setMontado(true), [])

  const cerrar = useCallback(() => {
    setAbierto(false)
    // El foco vuelve DE DÓNDE SALIÓ. Sin esto, cerrar con Escape deja el foco
    // en el <body> y la siguiente pulsación de Tab empieza otra vez por el
    // principio de la página.
    botonRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!abierto) return
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        cerrar()
      }
    }
    document.addEventListener('keydown', alPulsar)
    return () => document.removeEventListener('keydown', alPulsar)
  }, [abierto, cerrar])

  useEffect(() => {
    if (abierto) panelRef.current?.focus()
  }, [abierto])

  return (
    <>
      <button
        ref={botonRef}
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-haspopup="dialog"
        aria-controls={abierto ? idPanel : undefined}
        aria-label={etiqueta}
        title={etiqueta}
        className={`${BOTON.base} ${BOTON.secundario} shrink-0`}
      >
        <Info className="h-[13px] w-[13px]" />
        Info
      </button>

      {montado &&
        abierto &&
        createPortal(
          <>
            {/* El velo atenúa, no tapa: el panel explica lo que se está viendo
                y esconderlo detrás de un negro sólido lo deja sin referencia. */}
            <div
              className="fixed inset-0 z-[90] bg-black/25"
              onMouseDown={cerrar}
              aria-hidden="true"
            />

            <div
              ref={panelRef}
              id={idPanel}
              role="dialog"
              aria-label={titulo}
              tabIndex={-1}
              className={[
                'fixed right-0 top-0 z-[91] flex h-full w-full max-w-[420px] flex-col',
                'border-l shadow-2xl outline-none',
                LINEA.fuerte,
                SUPERFICIE.sup,
              ].join(' ')}
            >
              <header
                className={`flex h-[34px] shrink-0 items-center gap-2 border-b px-[10px] ${LINEA.normal}`}
              >
                <Info className={`h-[13px] w-[13px] shrink-0 ${TEXTO.t4}`} />
                <h2 className={`${TITULO.seccion} truncate`}>{titulo}</h2>
                <button
                  type="button"
                  onClick={cerrar}
                  className={`${BOTON.icono} ml-auto shrink-0`}
                  aria-label="Cerrar la información"
                >
                  <X className="h-[13px] w-[13px]" />
                </button>
              </header>

              <div
                className={`min-h-0 flex-1 overflow-y-auto px-[14px] py-[12px] ${TIPO.s} ${TEXTO.t2} [&_p]:mb-[9px] [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_strong]:text-[var(--ls-t1)] [&_code]:text-[var(--ls-t3)]`}
              >
                {children}
              </div>
            </div>
          </>,
          document.body
        )}
    </>
  )
}

/**
 * Un apartado dentro del panel.
 *
 * Está aquí y no copiado en cada pantalla para que los ~15 paneles del módulo se
 * lean igual: un rótulo, su párrafo y el siguiente. Sin esto cada agente elegiría
 * su propio tamaño de título y el panel de Costes no se parecería al de Marcas.
 */
export function SeccionInfo({
  titulo,
  children,
}: {
  titulo: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-[14px] last:mb-0">
      <h3 className={`${TITULO.rotulo} mb-[5px]`}>{titulo}</h3>
      <div className={`${TIPO.s} ${TEXTO.t3} leading-[1.6]`}>{children}</div>
    </section>
  )
}

/**
 * La lista de un apartado. Misma razón que SeccionInfo: que las viñetas midan lo
 * mismo en las quince pantallas.
 */
export function ListaInfo({ children }: { children: React.ReactNode }) {
  return (
    <ul
      className={`ml-[14px] list-disc space-y-[4px] marker:text-[var(--ls-t4)] ${RADIO.r1}`}
    >
      {children}
    </ul>
  )
}
