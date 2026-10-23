'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * LA VENTANA DE UNA LISTA LARGA: solo se pintan las filas que se ven, más unas pocas de margen.
 *
 * Una cartera son miles de leads y pintarlos todos —o 400 de golpe, como se hacía— cuesta más que todo lo demás junto: cada fila es
 * un botón con varios textos, y cada cambio de filtro los monta otra vez. Con filas de ALTO FIJO la cuenta es aritmética: la fila
 * que está a `scrollTop` es `scrollTop / alto`, así que no hace falta medir nada.
 *
 * Lo que devuelve es el tramo [inicio, fin) que hay que pintar y la altura total de la lista, para que la barra de desplazamiento
 * mida lo mismo que si estuviera todo pintado. Las filas pintadas se colocan con `translateY(inicio * alto)` dentro de un contenedor
 * de la altura total.
 *
 * NO HACE FALTA LIBRERÍA: el repositorio no tiene react-window y en esta máquina no se puede instalar nada.
 */

interface Opciones {
  total: number
  /** Alto de cada fila, en píxeles. Fijo: es lo que hace posible no medir */
  alto: number
  /**
   * Filas extra por arriba y por abajo, para que no se vea el hueco al desplazar rápido. 14 filas son unos 730 px a cada lado: más que una
   * pantalla de móvil, que es donde un empujón del dedo recorre muchas filas antes de que la ventana se entere (el evento de scroll llega
   * y la nueva ventana se pinta un cuadro después). Montar 14 filas de más cuesta menos que una franja en blanco al hacer scroll.
   */
  sobrescan?: number
  /**
   * El elemento que hace scroll. Es el ELEMENTO (guardado en un estado con `ref={setContenedor}`) y no un objeto `useRef`: la lista se
   * desmonta cuando no hay leads (cargando, o un filtro que no deja pasar a ninguno) y se vuelve a montar después. Con un `useRef` el
   * efecto que engancha el scroll se ejecutaba una vez, con el elemento todavía ausente, y no se enteraba de que había vuelto: la lista
   * se quedaba con las primeras filas y no se podía bajar.
   */
  contenedor: HTMLElement | null
}

export interface VentanaDeLista {
  inicio: number
  fin: number
  alturaTotal: number
  /** Desplaza lo justo para que la fila `indice` se vea entera (no hace nada si ya se ve) */
  desplazarA: (indice: number) => void
}

/** Las filas que se pintan antes de saber cuánto mide la ventana (el servidor y el primer pintado del navegador) */
const FILAS_INICIALES = 24

export function useVentana({ total, alto, sobrescan = 14, contenedor }: Opciones): VentanaDeLista {
  const [tramo, setTramo] = useState({ inicio: 0, fin: FILAS_INICIALES })

  useEffect(() => {
    const el = contenedor
    if (!el) return
    let cuadro = 0

    const medir = () => {
      cuadro = 0
      const inicio = Math.max(0, Math.floor(el.scrollTop / alto) - sobrescan)
      const fin = Math.ceil((el.scrollTop + el.clientHeight) / alto) + sobrescan
      // Solo se repinta si el tramo cambia: desplazar un píxel no mueve ninguna fila
      setTramo((previo) => (previo.inicio === inicio && previo.fin === fin ? previo : { inicio, fin }))
    }
    // Un cuadro como mucho: el evento de scroll llega más veces de las que se puede pintar
    const programar = () => {
      if (!cuadro) cuadro = requestAnimationFrame(medir)
    }

    el.addEventListener('scroll', programar, { passive: true })
    const observador = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(programar) : null
    observador?.observe(el)
    medir()
    return () => {
      el.removeEventListener('scroll', programar)
      observador?.disconnect()
      if (cuadro) cancelAnimationFrame(cuadro)
    }
  }, [contenedor, alto, sobrescan])

  const desplazarA = useCallback(
    (indice: number) => {
      const el = contenedor
      if (!el || indice < 0) return
      const arriba = indice * alto
      const abajo = arriba + alto
      if (arriba < el.scrollTop) el.scrollTop = arriba
      else if (abajo > el.scrollTop + el.clientHeight) el.scrollTop = abajo - el.clientHeight
    },
    [contenedor, alto]
  )

  return { inicio: Math.min(tramo.inicio, total), fin: Math.min(tramo.fin, total), alturaTotal: total * alto, desplazarA }
}
