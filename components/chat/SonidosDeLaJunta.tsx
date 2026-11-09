'use client'

import { useEffect, useRef } from 'react'
import type { Room } from 'livekit-client'
import { iniciarLlamando, prepararSonidosDeVoz, sonarVoz } from '@/lib/chat/sonidos-voz'
import { useChat } from './ChatProvider'
import { useJunta } from './JuntaProvider'

/** Tras entrar, el micrófono se enciende solo: ese cambio no es «te has desmuteado» y no suena */
const GRACIA_AL_ENTRAR_MS = 2_000

const identidades = (room: Room | null): Set<string> => new Set(room ? [room.localParticipant.identity, ...room.remoteParticipants.keys()] : [])

/**
 * LOS SONIDOS DE LA JUNTA, como en Discord (lib/chat/sonidos-voz.ts). No pinta nada: mira lo que pasa en la sala y suena.
 *   · entras / sales                        → te suena a ti
 *   · otra persona entra o sale             → suena a quienes ya están dentro (suave)
 *   · te silencias / te desmuteas           → suena
 *   · te ensordeces / vuelves a oír         → suena
 *   · llamas a alguien y aún no entra       → el «llamando…» hasta que entra (máx. 40 s, una vez por llamada)
 * Vive en el layout con la junta, así que suena en cualquier pantalla y en cualquier pestaña.
 */
export function SonidosDeLaJunta() {
  const { actual, room, version, ensordecido } = useJunta()
  const { canales } = useChat()
  const conectada = actual?.estado === 'conectada'
  const canal = actual ? canales.find((c) => c.id === actual.canalId) : undefined

  const estabaConectada = useRef(false)
  const gentePrevia = useRef<Set<string>>(new Set())
  const microPrevio = useRef<boolean | null>(null)
  const ensordecidoPrevio = useRef(false)
  const entreEn = useRef(0)
  const yaLlamo = useRef(false)

  // El navegador solo deja sonar tras el primer toque en la página
  useEffect(() => prepararSonidosDeVoz(), [])

  // Entrar y salir de la junta
  useEffect(() => {
    if (conectada && !estabaConectada.current) {
      estabaConectada.current = true
      entreEn.current = Date.now()
      gentePrevia.current = identidades(room)
      microPrevio.current = null
      ensordecidoPrevio.current = ensordecido
      yaLlamo.current = false
      sonarVoz('entrar')
    } else if (!conectada && estabaConectada.current) {
      estabaConectada.current = false
      gentePrevia.current = new Set()
      microPrevio.current = null
      sonarVoz('salir')
    }
  }, [conectada, room, ensordecido])

  // Lo que pasa dentro: alguien entra o sale, tu micrófono, ensordecer
  useEffect(() => {
    if (!conectada || !room || !estabaConectada.current) return
    const ahora = identidades(room)
    let entro = false
    let salio = false
    for (const id of ahora) if (!gentePrevia.current.has(id)) entro = true
    for (const id of gentePrevia.current) if (!ahora.has(id)) salio = true
    gentePrevia.current = ahora
    if (entro) sonarVoz('otro-entra')
    else if (salio) sonarVoz('otro-sale')

    const mic = room.localParticipant.isMicrophoneEnabled
    if (ensordecidoPrevio.current !== ensordecido) {
      // Ensordecerse apaga el micrófono solo: suena una vez («ensordecer»), no dos
      ensordecidoPrevio.current = ensordecido
      sonarVoz(ensordecido ? 'ensordecer' : 'oir')
    } else if (microPrevio.current !== null && microPrevio.current !== mic && Date.now() - entreEn.current > GRACIA_AL_ENTRAR_MS) {
      sonarVoz(mic ? 'unmute' : 'mute')
    }
    microPrevio.current = mic
  }, [version, conectada, room, ensordecido])

  // El «llamando…» de quien llama a una conversación directa y espera a que el otro entre
  const sola = conectada && room !== null && room.remoteParticipants.size === 0
  const esDirecto = canal?.tipo === 'directo'
  useEffect(() => {
    if (!sola || !esDirecto || yaLlamo.current) return
    yaLlamo.current = true
    return iniciarLlamando()
  }, [sola, esDirecto])

  return null
}
