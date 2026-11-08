'use client'

import { useCallback, useMemo, useRef } from 'react'
import { FileText } from 'lucide-react'
import { huellaDeContenido, tieneBloquesAjenos, type Bloque } from '@/lib/tareas-clientes/bloques'
import { separarCuerpo, unirCuerpo } from '@/lib/tareas-clientes/cuerpo'
import { Editor } from './Editor'
import { ListaDeTareas } from './ListaDeTareas'

/**
 * EL CUERPO DE UNA TAREA EN DOS TARJETAS: arriba la LISTA DE TAREAS (casillas con su propia interfaz) y debajo el CONTEXTO (el editor de bloques completo: texto, títulos, tablas,
 * imágenes que se pegan o se sueltan…). Por debajo es UN solo cuerpo —el mismo que se guarda y se manda a Notion—: lib/tareas-clientes/cuerpo.ts reparte y vuelve a juntar.
 */
export function CuerpoDeLaTarea({ contenido, onCambio }: { contenido: Bloque[]; onCambio: (c: Bloque[]) => void }) {
  const sep = useMemo(() => separarCuerpo(contenido), [contenido])
  // Lo que ve cada tarjeta mantiene su identidad mientras no cambie, para que escribir en una no reinicie la otra
  const huellaLista = useRef('')
  const listaEstable = useRef(sep.lista)
  const huella = huellaDeContenido(sep.lista)
  if (huella !== huellaLista.current) {
    huellaLista.current = huella
    listaEstable.current = sep.lista
  }
  const huellaContexto = useRef('')
  const contextoEstable = useRef(sep.contexto)
  const hc = huellaDeContenido(sep.contexto)
  if (hc !== huellaContexto.current) {
    huellaContexto.current = hc
    contextoEstable.current = sep.contexto
  }
  // Lo último que se vio, para juntar sin depender de lo que tarde en llegar el siguiente pintado
  const ultimo = useRef({ sep, lista: sep.lista, contexto: sep.contexto })
  ultimo.current = { sep, lista: listaEstable.current, contexto: contextoEstable.current }

  const alCambiarLista = useCallback((nueva: Bloque[]) => onCambio(unirCuerpo(ultimo.current.sep, nueva, ultimo.current.contexto)), [onCambio])
  const alCambiarContexto = useCallback((nuevo: Bloque[]) => onCambio(unirCuerpo(ultimo.current.sep, ultimo.current.lista, nuevo)), [onCambio])

  return (
    <div className="flex flex-col gap-4">
      <ListaDeTareas tareas={listaEstable.current} onCambio={alCambiarLista} reordenar={!tieneBloquesAjenos(contenido)} />
      <section className="tc-cuerpo-tarjeta" aria-label="Contexto">
        <header className="tc-cuerpo-cabecera">
          <span className="tc-cuerpo-icono" data-tono="azul"><FileText className="h-3.5 w-3.5" /></span>
          <h3>Contexto</h3>
          <span className="ml-auto hidden text-[11.5px] text-[var(--ls-t4)] sm:block">Texto, títulos, tablas… «/» para elegir · pega o suelta una foto</span>
        </header>
        <div className="tc-cuerpo-editor"><Editor bloques={contextoEstable.current} onCambio={alCambiarContexto} /></div>
      </section>
    </div>
  )
}
