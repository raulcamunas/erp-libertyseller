'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { hayQueReenviar } from '@/lib/correo/atajos'
import { documentoDeCorreo, documentoDeTexto, type FondoDeCorreo } from '@/lib/correo/html'

/**
 * EL CONTENIDO DE UN CORREO, DENTRO DE UN MARCO AISLADO.
 *
 * El HTML de un correo lo ha escrito un desconocido. Aunque ya llega limpio del servidor (lib/correo/limpiar.ts), se
 * enseña además dentro de un iframe con tres cierres, por si uno fallara:
 *
 *   · `sandbox` sin permiso de scripts, de formularios ni de abrir ventanas del propio ERP: solo se permiten los enlaces
 *     que se abren en otra pestaña (y esa pestaña no hereda ninguna restricción ni conoce de dónde viene);
 *   · una política de contenido dentro del propio documento (lib/correo/html.ts): sin scripts, sin conexiones y, mientras
 *     la persona no lo pida, sin imágenes de fuera. Una imagen de fuera avisa a quien envía de que se ha abierto el correo;
 *   · el fondo: oscuro (el del ERP) para el correo de persona a persona y un gris suave para el que trae diseño propio, en vez
 *     del blanco puro de antes (ver documentoDeCorreo en lib/correo/html.ts). Quien lee puede cambiarlo en cada mensaje.
 *
 * `allow-same-origin` está puesto A PROPÓSITO y solo para poder medir el alto del contenido y ajustar el marco (si no, cada
 * correo largo sería un cuadro con su propia barra de desplazamiento). Es seguro justamente porque NO se da `allow-scripts`:
 * sin poder ejecutar nada, el contenido no puede tocar la página; es la combinación de las dos la que no se debe hacer nunca.
 *
 * Gracias a ese mismo `allow-same-origin`, la pantalla escucha las teclas DENTRO del marco y reenvía a la ventana las de los atajos de Correo
 * (TECLAS_DE_ATAJO de lib/correo/atajos.ts): con el foco en el correo, «j», «r» o «Esc» siguen funcionando. El correo sigue sin poder ejecutar nada.
 */

interface Props {
  html: string | null
  texto: string
  imagenesDeFuera: boolean
  fondo: FondoDeCorreo
}

const ALTO_MINIMO = 40
const ALTO_MAXIMO = 8000

export function CuerpoDeCorreo({ html, texto, imagenesDeFuera, fondo }: Props) {
  const marco = useRef<HTMLIFrameElement>(null)
  const [alto, setAlto] = useState(80)

  const documento = useMemo(() => (html ? documentoDeCorreo(html, { imagenesDeFuera, fondo }) : documentoDeTexto(texto, { imagenesDeFuera, fondo })), [html, texto, imagenesDeFuera, fondo])

  useEffect(() => {
    const iframe = marco.current
    if (!iframe) return
    let observador: ResizeObserver | null = null

    const medir = () => {
      const d = iframe.contentDocument
      if (!d || !d.documentElement) return
      const alto = Math.max(d.documentElement.scrollHeight, d.body ? d.body.scrollHeight : 0)
      setAlto(Math.min(ALTO_MAXIMO, Math.max(ALTO_MINIMO, alto)))
    }
    // Los atajos de teclado con el foco DENTRO del correo: el iframe se queda sus teclas y la ventana no se entera. Se reenvía a `window` un
    // KeyboardEvent nuevo, solo para las teclas de los atajos (TECLAS_DE_ATAJO, sin ⌘/Ctrl/Alt): el resto (copiar, buscar en la página…) no se toca
    let documentoEscuchado: Document | null = null
    const reenviarTecla = (e: KeyboardEvent) => {
      if (!hayQueReenviar(e)) return
      const copia = new KeyboardEvent('keydown', {
        key: e.key,
        code: e.code,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        repeat: e.repeat,
        bubbles: true,
        cancelable: true,
      })
      window.dispatchEvent(copia)
      // Si la pantalla lo ha usado (preventDefault), el navegador no hace lo suyo dentro del marco («/» abre la búsqueda rápida en Firefox)
      if (copia.defaultPrevented) e.preventDefault()
    }
    const dejarDeEscuchar = () => {
      documentoEscuchado?.removeEventListener('keydown', reenviarTecla)
      documentoEscuchado = null
    }

    const alCargar = () => {
      medir()
      observador?.disconnect()
      const d = iframe.contentDocument
      if (d && d.documentElement && typeof ResizeObserver !== 'undefined') {
        observador = new ResizeObserver(medir)
        observador.observe(d.documentElement)
      }
      dejarDeEscuchar()
      if (d) {
        d.addEventListener('keydown', reenviarTecla)
        documentoEscuchado = d
      }
    }

    iframe.addEventListener('load', alCargar)
    // Si el documento ya cargó antes de enganchar el evento (poco probable, pero pasa al volver a montar)
    if (iframe.contentDocument?.readyState === 'complete') alCargar()
    window.addEventListener('resize', medir)
    return () => {
      iframe.removeEventListener('load', alCargar)
      window.removeEventListener('resize', medir)
      observador?.disconnect()
      dejarDeEscuchar()
    }
  }, [documento])

  return (
    <iframe
      ref={marco}
      srcDoc={documento}
      title="Contenido del correo"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      className="block w-full rounded-[6px]"
      style={{ height: alto }}
    />
  )
}
