'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { pedirMensajeConIa } from '@/lib/whatsapp/ia-cliente'
import { AVISO_DE_PROBLEMA, PROBLEMAS_QUE_BLOQUEAN, mensajeListoParaWhatsapp, revisarMensajeDeWhatsapp } from '@/lib/whatsapp/ia-revision'
import { MAX_DE_MENSAJE, type SituacionDeWhatsapp } from '@/lib/whatsapp/mensajes'

/**
 * EL ESTADO DE «GENERAR CON IA» DEL BOTÓN DE WHATSAPP.
 * ====================================================
 * Vive en el botón (siempre montado) y NO dentro del desplegable: un clic de más fuera del desplegable lo cierra, y lo que la IA acaba de escribir no se
 * puede perder por eso (cada mensaje cuesta una petición a la IA y varios segundos de espera).
 *
 * UN MENSAJE ES DE UN LEAD EN UN MOMENTO. Todo el estado lleva la clave «lead|momento» para la que se pidió, y lo que no es de la clave de ahora no se enseña
 * NI SIQUIERA UN FOTOGRAMA (no se espera a que un efecto lo limpie): un mensaje pensado para una persona nunca aparece en la ficha de otra, ni uno escrito
 * para «te he llamado y no contesta» cuando el lead ya está en «rellamada». Lo que llega tarde de una petición anterior, o de otra clave, se tira.
 *
 * Para cambiar el mensaje («Más corto»…) la IA parte de lo que haya en el cuadro en ese momento, incluido lo que la persona haya retocado.
 */

export interface MensajeConIa {
  /** El mensaje en el cuadro. null = todavía no se ha pedido ninguno */
  texto: string | null
  /** En qué datos se apoya, según la IA (vacío si la persona ya ha cambiado el texto: lo que decía la IA ya no vale tal cual) */
  base: string
  /** Lo que conviene mirar antes de abrir WhatsApp: lo que dijo la IA y lo que se ve al leer el texto tal como está ahora */
  avisos: string[]
  /** El texto ya limpio, tal como se abriría en WhatsApp */
  listo: string
  /** ¿Hay algo que impide abrir WhatsApp ahora mismo? (nada escrito, o un hueco por rellenar) */
  bloquea: boolean
  generando: boolean
  error: string | null
  /** Para qué momento se escribió (el que había al pedirlo) */
  situacion: SituacionDeWhatsapp | null
  generar: (indicacion?: string) => Promise<void>
  /** La persona cambia el texto a mano */
  escribir: (texto: string) => void
  descartar: () => void
}

interface Estado {
  /** «lead|momento» para el que es todo esto */
  clave: string
  texto: string | null
  base: string
  avisoDeLaIa: string | null
  editado: boolean
  generando: boolean
  error: string | null
  situacion: SituacionDeWhatsapp | null
}

const vacio = (clave: string): Estado => ({ clave, texto: null, base: '', avisoDeLaIa: null, editado: false, generando: false, error: null, situacion: null })

export function useMensajeDeWhatsappConIa(leadId: string, situacion: SituacionDeWhatsapp): MensajeConIa {
  const clave = `${leadId}|${situacion}`
  const [guardado, setGuardado] = useState<Estado>(() => vacio(clave))
  // Lo guardado para otra clave no existe para este lead ahora
  const e = guardado.clave === clave ? guardado : vacio(clave)
  const peticion = useRef(0)

  const cambiar = useCallback((paraClave: string, cambios: Partial<Estado>) => {
    setGuardado((previo) => ({ ...(previo.clave === paraClave ? previo : vacio(paraClave)), ...cambios, clave: paraClave }))
  }, [])

  const texto = e.texto
  const generar = useCallback(
    async (indicacion?: string) => {
      const paraClave = clave
      const mia = ++peticion.current
      cambiar(paraClave, { generando: true, error: null })
      const r = await pedirMensajeConIa({
        leadId,
        situacion,
        ...(indicacion ? { indicaciones: indicacion } : {}),
        ...(indicacion && texto ? { anterior: mensajeListoParaWhatsapp(texto) } : {}),
      })
      // Solo cuenta la última petición: si se ha pedido otra, o se ha descartado, lo que llega se tira. Si mientras tanto se ha ido a otro lead, se guarda igualmente
      // para su clave (al volver estará hecho en vez de quedarse «escribiendo» para siempre) y no se enseña en el otro: cada clave ve solo lo suyo
      if (mia !== peticion.current) return
      if (!r.ok) {
        cambiar(paraClave, { generando: false, error: r.error })
        return
      }
      cambiar(paraClave, { generando: false, error: null, texto: r.mensaje, base: r.base, avisoDeLaIa: r.aviso, editado: false, situacion })
    },
    [clave, leadId, situacion, texto, cambiar]
  )

  const escribir = useCallback((nuevo: string) => cambiar(clave, { texto: nuevo.slice(0, MAX_DE_MENSAJE), editado: true }), [clave, cambiar])

  const descartar = useCallback(() => {
    peticion.current++
    setGuardado(vacio(clave))
  }, [clave])

  const listo = texto === null ? '' : mensajeListoParaWhatsapp(texto)
  const problemas = useMemo(() => (listo === '' ? [] : revisarMensajeDeWhatsapp(listo)), [listo])
  const avisos = useMemo(() => {
    const todos = [...(e.editado || !e.avisoDeLaIa ? [] : [e.avisoDeLaIa]), ...problemas.map((p) => AVISO_DE_PROBLEMA[p])]
    return todos.filter((a, i) => todos.indexOf(a) === i)
  }, [e.avisoDeLaIa, e.editado, problemas])

  return {
    texto,
    base: e.editado ? '' : e.base,
    avisos,
    listo,
    bloquea: listo === '' || problemas.some((p) => PROBLEMAS_QUE_BLOQUEAN.has(p)),
    generando: e.generando,
    error: e.error,
    situacion: e.situacion,
    generar,
    escribir,
    descartar,
  }
}
