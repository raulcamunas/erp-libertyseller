'use client'

import { BookText, FlaskConical, Loader2, RefreshCw, Trophy, Lightbulb } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { pedir } from '@/components/correo/api'
import { Aviso } from '@/components/correo/ui'
import { Esqueleto } from '@/components/rendimiento/ui'
import { BOTON } from '@/lib/estilo/denso'
import type { RespuestaDeVersiones } from '@/lib/correo/ia-laboratorio-tipos'
import { TabEjemplos } from './TabEjemplos'
import { TabFunciona } from './TabFunciona'
import { TabResultados } from './TabResultados'
import { TabVersiones } from './TabVersiones'

/**
 * CONFIGURACIÓN DE CORREOS: la mini app de Mi rendimiento para afinar el correo que escribe la IA.
 *
 *   · Versiones   las instrucciones de la IA por secciones, con su reparto: cada correo que pide un comercial lo escribe una versión
 *                 sorteada según su peso. Se prueban con un lead sin enviar nada.
 *   · Mis ejemplos los correos que escribe quien supervisa: los «textos ganadores» candidatos, que una versión puede enseñarle a la IA.
 *   · Lo que ya funciona  los correos del equipo que consiguieron respuesta, tal como los ve la IA.
 *   · Resultados  qué versión consigue más respuestas, con la cautela que piden tasas tan bajas.
 *
 * Todo se lee y se escribe en /api/correo/laboratorio/* (permiso «Configuración de la IA»).
 */

type Pestana = 'versiones' | 'ejemplos' | 'funciona' | 'resultados'

const PESTANAS: ReadonlyArray<{ id: Pestana; texto: string; icono: typeof FlaskConical; ayuda: string }> = [
  { id: 'versiones', texto: 'Versiones', icono: FlaskConical, ayuda: 'Las instrucciones de la IA y su reparto' },
  { id: 'ejemplos', texto: 'Mis ejemplos', icono: BookText, ayuda: 'Los correos que escribes tú para enseñarle a la IA' },
  { id: 'funciona', texto: 'Lo que ya funciona', icono: Lightbulb, ayuda: 'Los correos del equipo que consiguieron respuesta' },
  { id: 'resultados', texto: 'Resultados', icono: Trophy, ayuda: 'Qué versión consigue más respuestas' },
]

export function PanelLaboratorio() {
  const [pestana, setPestana] = useState<Pestana>('versiones')
  const [datos, setDatos] = useState<RespuestaDeVersiones | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [faltaMigracion, setFaltaMigracion] = useState<string | null>(null)

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true)
    const r = await pedir<RespuestaDeVersiones>('/api/correo/laboratorio/versiones')
    setCargando(false)
    if (!r.ok) {
      if (r.estado === 503) setFaltaMigracion(r.mensaje)
      else setError(r.mensaje)
      return
    }
    setDatos(r.datos)
    setError(null)
    setFaltaMigracion(null)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  if (faltaMigracion) return <Aviso titulo="Falta preparar la base de datos">{faltaMigracion}</Aviso>
  if (error) {
    return (
      <Aviso titulo="No se ha podido abrir la configuración de correos">
        {error}{' '}
        <button type="button" onClick={() => void cargar()} className="underline underline-offset-2 hover:text-[var(--ls-t1)]">
          Volver a probar
        </button>
      </Aviso>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Secciones de la configuración de correos">
        {PESTANAS.map((p) => {
          const Icono = p.icono
          const activa = pestana === p.id
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={activa}
              title={p.ayuda}
              onClick={() => setPestana(p.id)}
              className={`${BOTON.chip} !h-7 !px-2.5 !text-[12px] ${activa ? BOTON.chipEncendido : ''}`}
            >
              <Icono className="h-3.5 w-3.5" aria-hidden /> {p.texto}
            </button>
          )
        })}
        <button type="button" onClick={() => void cargar(true)} className={`${BOTON.icono} ml-1 !h-7 !w-7`} aria-label="Volver a leer" title="Volver a leer">
          {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
        </button>
      </div>

      {cargando && !datos ? (
        <div className="grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)]" aria-busy="true" aria-label="Cargando">
          <Esqueleto className="h-64" />
          <Esqueleto className="h-[28rem]" />
        </div>
      ) : datos ? (
        <>
          {pestana === 'versiones' && <TabVersiones versiones={datos.versiones} ejemplos={datos.ejemplos} onCambio={() => cargar(true)} />}
          {pestana === 'ejemplos' && <TabEjemplos versiones={datos.versiones} ejemplos={datos.ejemplos} onCambio={() => cargar(true)} />}
          {pestana === 'funciona' && <TabFunciona onCopiado={() => cargar(true)} />}
          {pestana === 'resultados' && <TabResultados />}
        </>
      ) : null}
    </div>
  )
}
