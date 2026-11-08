'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AJUSTES_POR_DEFECTO, CLAVE_DE_ALMACENAMIENTO, leerAjustes, variablesDeTema, type AjustesDelChat } from '@/lib/chat/temas'

interface ContextoDeTema {
  ajustes: AjustesDelChat
  cambiar: (parcial: Partial<AjustesDelChat>) => void
  restablecer: () => void
}

const Contexto = createContext<ContextoDeTema>({ ajustes: AJUSTES_POR_DEFECTO, cambiar: () => undefined, restablecer: () => undefined })
export const useTemaDelChat = (): ContextoDeTema => useContext(Contexto)
/** Solo para probar las pantallas (la vista de pruebas) */
export const ContextoDeTemaParaPruebas = Contexto

const leer = (): AjustesDelChat => {
  try {
    return leerAjustes(window.localStorage.getItem(CLAVE_DE_ALMACENAMIENTO))
  } catch {
    return { ...AJUSTES_POR_DEFECTO }
  }
}

/**
 * El tema del chat de esta persona: se lee del almacenamiento del navegador y se pone en el elemento raíz mientras el chat está abierto (así también lo recogen los cuadros que se abren
 * fuera del chat, como «Crear un canal»). Al salir del chat se quita y el resto del ERP no se entera.
 */
export function TemaDelChatProvider({ children }: { children: ReactNode }) {
  const [ajustes, setAjustes] = useState<AjustesDelChat>(AJUSTES_POR_DEFECTO)

  useEffect(() => {
    setAjustes(leer())
  }, [])

  useEffect(() => {
    const raiz = document.documentElement
    const vars = variablesDeTema(ajustes)
    for (const [k, v] of Object.entries(vars)) raiz.style.setProperty(k, v)
    raiz.dataset.chatTema = ajustes.tema
    return () => {
      for (const k of Object.keys(vars)) raiz.style.removeProperty(k)
      delete raiz.dataset.chatTema
    }
  }, [ajustes])

  const guardar = useCallback((nuevos: AjustesDelChat) => {
    setAjustes(nuevos)
    try {
      window.localStorage.setItem(CLAVE_DE_ALMACENAMIENTO, JSON.stringify(nuevos))
    } catch {
      /* sin almacenamiento: vale para esta sesión */
    }
  }, [])

  const valor = useMemo<ContextoDeTema>(
    () => ({ ajustes, cambiar: (p) => guardar({ ...ajustes, ...p }), restablecer: () => guardar({ ...AJUSTES_POR_DEFECTO }) }),
    [ajustes, guardar]
  )
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}
