'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * RECORDAR DÓNDE ESTABAS.
 *
 * Lo pidió Raúl: «estoy en Buy Box, COMERCIAL ARGI, España; pues que la próxima
 * vez que me meta no salga Francia, sino España, o lo que ya estaba viendo. Pero
 * en todos lados».
 *
 * El caso concreto que lo motiva: el desplegable de cuenta y país se rellenaba
 * con el primero de la lista, que va por orden alfabético. Con once mercados eso
 * significa que un cliente que trabaja España abría siempre en Francia y tenía
 * que corregirlo cada vez, en cada pantalla.
 *
 *
 * POR QUÉ NO VA EN LA URL
 * -----------------------
 * La pestaña de Amazon API y el submódulo de Growth SÍ van en la URL, a
 * propósito: son sitios a los que se enlaza y que se comparten. Esto es otra
 * cosa —una preferencia de quien mira, no una dirección— y meterla en la URL
 * haría que un enlace pegado a un compañero le cambiara SUS filtros.
 *
 *
 * POR QUÉ NO VA EN LA BASE DE DATOS
 * ---------------------------------
 * Porque no vale una consulta ni una migración. Si alguien entra desde otro
 * ordenador y le sale el primero de la lista, no ha pasado nada.
 *
 *
 * EL SALTO DE HIDRATACIÓN
 * -----------------------
 * El servidor no tiene `localStorage`, así que el primer render TIENE que dar el
 * valor por defecto: si se leyera durante el render, React pintaría una cosa en
 * el servidor y otra en el cliente y saltaría el aviso de hidratación —y en
 * producción se queda con la del servidor, o sea que no serviría de nada—. Por
 * eso se lee en un efecto, después del montaje. Es el mismo patrón que ya usa
 * ThemeToggle.
 *
 * Consecuencia visible: un parpadeo de un fotograma con el valor por defecto
 * antes de saltar al recordado. Se acepta; la alternativa es no pintar nada
 * hasta montar, que es peor.
 */

const PREFIJO = 'erp:recordar:'

/**
 * Como useState, pero recuerda.
 *
 * `valido` es la parte importante y no un adorno: lo guardado puede haber dejado
 * de existir —una cuenta desconectada, un país que se ha desactivado en Amazon
 * API— y restaurar un valor muerto deja la pantalla vacía sin explicación, que
 * es peor que abrir por el primero. Si no pasa el filtro, se descarta y se
 * queda el valor por defecto.
 */
export function useRecordado<T extends string>(
  clave: string,
  porDefecto: T,
  valido?: (v: string) => boolean
): [T, (v: T) => void] {
  const [valor, setValor] = useState<T>(porDefecto)

  useEffect(() => {
    try {
      const guardado = window.localStorage.getItem(PREFIJO + clave)
      if (!guardado) return
      if (valido && !valido(guardado)) return
      setValor(guardado as T)
    } catch {
      // Modo incógnito, almacenamiento lleno o bloqueado por el navegador. No
      // se recuerda y ya está: esto no puede tumbar una pantalla.
    }
    // `valido` se deja fuera a propósito: suele ser una función nueva en cada
    // render y volvería a restaurar el valor guardado pisando lo que el usuario
    // acabe de elegir. Solo se restaura al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  const guardar = useCallback(
    (v: T) => {
      setValor(v)
      try {
        window.localStorage.setItem(PREFIJO + clave, v)
      } catch {
        /* ver arriba */
      }
    },
    [clave]
  )

  return [valor, guardar]
}
