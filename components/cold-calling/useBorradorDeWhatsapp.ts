'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { alDeshacer, alElegirDeLaLista, alEscribir, alLlegarDeLaIa, borradorVacio, estaTocado, etiquetaDelOrigen, revisarBorrador, textoMostrado, type Borrador, type OrigenDelTexto } from '@/lib/whatsapp/borrador'
import { pedirMensajeConIa } from '@/lib/whatsapp/ia-cliente'
import { mensajeListoParaWhatsapp } from '@/lib/whatsapp/ia-revision'
import type { SituacionDeWhatsapp } from '@/lib/whatsapp/mensajes'

/**
 * EL MENSAJE QUE SE ESTÁ ESCRIBIENDO EN EL BOTÓN DE WHATSAPP (EL ESTADO). Las reglas de qué pasa con el texto están en lib/whatsapp/borrador.ts (puro).
 * ==============================================================================================================================================
 * Vive en el botón (siempre montado) y NO dentro del desplegable: un clic de más fuera del desplegable lo cierra, y lo que la persona acaba de escribir —o la
 * IA de escribir, que cuesta una petición y varios segundos— no se puede perder por eso.
 *
 * UN BORRADOR ES DE UN LEAD EN UN MOMENTO. Todo el estado lleva la clave «lead|momento» para la que se pidió, y lo que no es de la clave de ahora no se enseña
 * NI SIQUIERA UN FOTOGRAMA (no se espera a que un efecto lo limpie): un mensaje pensado para una persona nunca aparece en la ficha de otra, ni uno escrito
 * para «te he llamado y no contesta» cuando el lead ya está en «rellamada». Lo que llega tarde de una petición anterior, o de otra clave, se tira.
 *
 * Para cambiar el mensaje («Más corto»…) la IA parte de lo que haya en el cuadro en ese momento, sea el sugerido, uno de la lista o lo que la persona haya escrito.
 */

export interface BorradorDeWhatsapp {
  /** Lo que se ve en el cuadro: lo que se haya puesto o, si nada se ha tocado, el mensaje sugerido */
  texto: string
  /** De dónde viene el texto que hay: el sugerido, uno de la lista o uno escrito por la IA */
  origen: OrigenDelTexto
  /** «Mensaje sugerido · Primer contacto», «Escrito con IA · … (retocado)»… */
  etiqueta: string
  /** En qué datos se apoya el mensaje de la IA (vacío si la persona ya lo ha cambiado) */
  base: string
  /** Lo que conviene mirar antes de enviar */
  avisos: string[]
  /** El texto ya limpio, tal como se abre en WhatsApp y tal como se apunta en el historial */
  listo: string
  /** ¿Hay algo que impide enviar ahora mismo? (nada escrito, un hueco por rellenar) */
  bloquea: boolean
  generando: boolean
  error: string | null
  /** Se ha escrito algún mensaje con la IA: se ofrecen los atajos para cambiarlo */
  hayIa: boolean
  /** Se ha cambiado algo respecto al mensaje sugerido */
  tocado: boolean
  /** Hay un texto anterior al que volver (tras elegir otro mensaje o tras la IA) */
  hayPrevio: boolean
  generar: (indicacion?: string) => Promise<void>
  /** La persona cambia el texto a mano */
  escribir: (texto: string) => void
  /** Pasa al cuadro un mensaje de la lista (no abre WhatsApp) */
  elegir: (texto: string) => void
  deshacer: () => void
  /** Vuelve al mensaje sugerido y olvida lo demás: se llama al enviar */
  restablecer: () => void
}

interface Estado {
  borrador: Borrador
  generando: boolean
  error: string | null
}

const inicial = (clave: string): Estado => ({ borrador: borradorVacio(clave), generando: false, error: null })

export function useBorradorDeWhatsapp(leadId: string, situacion: SituacionDeWhatsapp, sugerido: string): BorradorDeWhatsapp {
  const clave = `${leadId}|${situacion}`
  const [guardado, setGuardado] = useState<Estado>(() => inicial(clave))
  // Lo guardado para otra clave no existe para este lead ahora
  const e = guardado.borrador.clave === clave ? guardado : inicial(clave)
  const peticion = useRef(0)

  const actualizar = useCallback((paraClave: string, cambio: (e: Estado) => Estado) => {
    setGuardado((previo) => cambio(previo.borrador.clave === paraClave ? previo : inicial(paraClave)))
  }, [])

  const generar = useCallback(
    async (indicacion?: string) => {
      const paraClave = clave
      const mia = ++peticion.current
      const anterior = indicacion ? mensajeListoParaWhatsapp(textoMostrado(e.borrador, sugerido)) : ''
      actualizar(paraClave, (a) => ({ ...a, generando: true, error: null }))
      const r = await pedirMensajeConIa({ leadId, situacion, ...(indicacion ? { indicaciones: indicacion } : {}), ...(anterior ? { anterior } : {}) })
      // Solo cuenta la última petición: si se ha pedido otra, o se ha restablecido, lo que llega se tira. Si mientras tanto se ha ido a otro lead, se guarda igualmente
      // para su clave (al volver estará hecho en vez de quedarse «escribiendo» para siempre) y no se enseña en el otro: cada clave ve solo lo suyo
      if (mia !== peticion.current) return
      if (!r.ok) {
        actualizar(paraClave, (a) => ({ ...a, generando: false, error: r.error }))
        return
      }
      actualizar(paraClave, (a) => ({ borrador: alLlegarDeLaIa(a.borrador, r, situacion), generando: false, error: null }))
    },
    [clave, leadId, situacion, sugerido, e.borrador, actualizar]
  )

  const escribir = useCallback((nuevo: string) => actualizar(clave, (a) => ({ ...a, borrador: alEscribir(a.borrador, nuevo) })), [clave, actualizar])
  const elegir = useCallback((texto: string) => actualizar(clave, (a) => ({ ...a, error: null, borrador: alElegirDeLaLista(a.borrador, texto) })), [clave, actualizar])
  const deshacer = useCallback(() => actualizar(clave, (a) => ({ ...a, error: null, borrador: alDeshacer(a.borrador) })), [clave, actualizar])
  const restablecer = useCallback(() => {
    peticion.current++
    setGuardado(inicial(clave))
  }, [clave])

  const revision = useMemo(() => revisarBorrador(e.borrador, sugerido), [e.borrador, sugerido])

  return {
    texto: textoMostrado(e.borrador, sugerido),
    origen: e.borrador.origen,
    etiqueta: etiquetaDelOrigen(e.borrador, situacion),
    base: revision.base,
    avisos: revision.avisos,
    listo: revision.listo,
    bloquea: revision.bloquea,
    generando: e.generando,
    error: e.error,
    hayIa: e.borrador.hayIa,
    tocado: estaTocado(e.borrador),
    hayPrevio: e.borrador.previo !== null,
    generar,
    escribir,
    elegir,
    deshacer,
    restablecer,
  }
}
