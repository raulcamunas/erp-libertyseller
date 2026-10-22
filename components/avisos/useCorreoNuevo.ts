'use client'

import { useEffect, useRef } from 'react'
import type { AvisoDeCorreo } from '@/lib/correo/avisos'

/**
 * LEER EL CORREO POR DETRÁS Y AVISAR DE LO NUEVO.
 *
 * Cada minuto, mientras el ERP está abierto y A LA VISTA —esté en la aplicación que esté—, pregunta a /api/correo/avisos si ha llegado algo
 * al buzón propio. Esa ruta lee el servidor de correo si hace falta (si nadie lo ha leído en los últimos 55 segundos) y contesta con los
 * correos nuevos de personas, sin leer, y cuántas conversaciones tienen algo sin leer.
 *
 *   · LA PRIMERA VEZ NO AVISA DE NADA: solo marca desde dónde se cuenta lo nuevo (sin «desde» la ruta contesta solo la hora). Abrir el ERP
 *     por la mañana no suelta de golpe los correos de anoche.
 *   · Con la pestaña oculta no pregunta, y al volver lo hace al momento (a los dos segundos): mira lo que llegó mientras tanto.
 *   · Con varias pestañas abiertas pregunta una sola: si otra lo hizo hace menos de 25 s, esta espera. Lo último consultado y lo ya avisado
 *     se guardan en localStorage, que es lo que comparten.
 *   · Si algo falla, espera el doble (hasta 10 minutos) y vuelve a probar. Sin la app «Correo» (403) o sin ruta (404), deja de preguntar y
 *     no lo vuelve a intentar en seis horas.
 *   · Sin buzón conectado pregunta solo cada cinco minutos: por si lo conecta.
 *
 * Es lo único que consulta el correo cuando nadie tiene abierta la pantalla de Correo; con ella abierta (o montada, oculta, tras haberla
 * visitado) su propia lectura de cada minuto hace lo mismo, y la ruta no relee un buzón leído hace menos de 55 segundos.
 */

const CADA_MS = 60_000
const SIN_BUZON_MS = 5 * 60_000
const MAX_ESPERA_MS = 10 * 60_000
const ENTRE_PESTANAS_MS = 25_000
const TRAS_VOLVER_MS = 2_000

const CLAVE_DESDE = 'correoAvisos:desde'
const CLAVE_VISTOS = 'correoAvisos:vistos'
const CLAVE_ULTIMA = 'correoAvisos:ultima'
/** Cuándo se supo que esta persona no tiene la app de Correo: durante seis horas no se vuelve a preguntar (cada página nueva sería un 403 más) */
const CLAVE_SIN_ACCESO = 'correoAvisos:sinAcceso'
const SIN_ACCESO_MS = 6 * 60 * 60_000

const leer = (clave: string): string | null => {
  try {
    return window.localStorage.getItem(clave)
  } catch {
    return null
  }
}
const escribir = (clave: string, valor: string) => {
  try {
    window.localStorage.setItem(clave, valor)
  } catch {
    // Sin almacenamiento: se avisa igual, y en esta pestaña no se repite nada (el Set de abajo)
  }
}

interface RespuestaDeAvisos {
  ahora: string
  hayBuzon: boolean
  nuevos: AvisoDeCorreo[]
  sinLeer: number
}

export function useCorreoNuevo(alLlegar: (nuevos: AvisoDeCorreo[]) => void, alContar: (sinLeer: number) => void, activo: boolean) {
  // Las últimas versiones de las funciones, sin relanzar la lectura cada vez que cambian
  const llegar = useRef(alLlegar)
  llegar.current = alLlegar
  const contar = useRef(alContar)
  contar.current = alContar

  useEffect(() => {
    // Un partner o un cliente no tienen correo en el ERP, y quien ya se sabe sin la app tampoco pregunta
    if (!activo || Date.now() - Number(leer(CLAVE_SIN_ACCESO) ?? 0) < SIN_ACCESO_MS) return
    let vivo = true
    let parado = false
    let espera = CADA_MS
    let temporizador: ReturnType<typeof setTimeout> | null = null

    const vistos = new Set<string>()
    try {
      for (const id of JSON.parse(leer(CLAVE_VISTOS) ?? '[]') as unknown[]) if (typeof id === 'string') vistos.add(id)
    } catch {
      // Lo guardado está estropeado: se empieza sin recordar nada
    }
    const recordar = (id: string) => {
      vistos.add(id)
      escribir(CLAVE_VISTOS, JSON.stringify([...vistos].slice(-40)))
    }

    const programar = (ms: number) => {
      if (!vivo || parado) return
      if (temporizador) clearTimeout(temporizador)
      temporizador = setTimeout(() => void consultar(), ms)
    }

    async function consultar() {
      temporizador = null
      if (!vivo || parado) return
      // Con la pestaña oculta no se pregunta: al volver se hace al momento
      if (document.visibilityState !== 'visible') return programar(espera)
      // Otra pestaña acaba de preguntar
      if (Date.now() - Number(leer(CLAVE_ULTIMA) ?? 0) < ENTRE_PESTANAS_MS) return programar(espera)
      escribir(CLAVE_ULTIMA, String(Date.now()))

      try {
        const r = await fetch('/api/correo/avisos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ desde: leer(CLAVE_DESDE) }), cache: 'no-store' })
        if (!vivo) return
        if (r.status === 401 || r.status === 403 || r.status === 404) {
          parado = true
          escribir(CLAVE_SIN_ACCESO, String(Date.now()))
          return
        }
        if (!r.ok) {
          espera = Math.min(espera * 2, MAX_ESPERA_MS)
          return programar(espera)
        }
        const j = (await r.json()) as RespuestaDeAvisos
        if (!vivo) return
        espera = j.hayBuzon ? CADA_MS : SIN_BUZON_MS
        if (typeof j.ahora === 'string') escribir(CLAVE_DESDE, j.ahora)
        if (typeof j.sinLeer === 'number') contar.current(j.sinLeer)
        const frescos = (Array.isArray(j.nuevos) ? j.nuevos : []).filter((n) => !vistos.has(n.id))
        for (const n of frescos) recordar(n.id)
        if (frescos.length > 0) llegar.current(frescos)
      } catch {
        espera = Math.min(espera * 2, MAX_ESPERA_MS)
      }
      programar(espera + Math.random() * 5_000)
    }

    // Al volver a la pestaña se mira enseguida lo que llegó mientras no se miraba
    const alVolver = () => {
      if (document.visibilityState === 'visible') programar(TRAS_VOLVER_MS)
    }
    document.addEventListener('visibilitychange', alVolver)
    programar(3_000)

    return () => {
      vivo = false
      if (temporizador) clearTimeout(temporizador)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [activo])
}
