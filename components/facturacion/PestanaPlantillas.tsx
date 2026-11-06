'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Copy, Loader2 } from 'lucide-react'
import { BOTON, CAMPO, TARJETA, TEXTO, TIPO, TITULO } from '@/lib/estilo/denso'
import { huecosDeEnlace, rotuloDeHueco } from '@/lib/facturacion/logica'
import type { PlantillaCompleta, PlantillaResumen } from '@/lib/facturacion/tipos'
import { Aviso, EditorCorreo, pedir, type ManejoEditor } from './comun'

/**
 * LAS PLANTILLAS DE CORREO, QUE VIVEN EN ZOHO Y SE EDITAN DESDE AQUÍ.
 *
 * Guardar cambia la plantilla para todos los envíos siguientes; por eso se
 * pregunta. Para retocar un solo correo está el paso de envío. Antes de pisar una
 * plantilla, el texto anterior queda en el registro, porque Zoho no guarda historial.
 */
export function PestanaPlantillas() {
  const [lista, setLista] = useState<PlantillaResumen[]>([])
  const [elegida, setElegida] = useState<string | null>(null)
  const [plantilla, setPlantilla] = useState<PlantillaCompleta | null>(null)
  const [nombre, setNombre] = useState('')
  const [asunto, setAsunto] = useState('')
  const [modo, setModo] = useState<'visual' | 'html'>('visual')
  const [html, setHtml] = useState('')
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editor = useRef<ManejoEditor>(null)

  const traerLista = useCallback(async (seleccionar?: string) => {
    try {
      const { plantillas } = await pedir<{ plantillas: PlantillaResumen[] }>('/api/facturacion/plantillas')
      setLista(plantillas)
      setElegida((actual) => seleccionar ?? actual ?? plantillas.find((p) => p.nombre !== 'Predeterminado')?.id ?? plantillas[0]?.id ?? null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se han podido leer las plantillas')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void traerLista()
  }, [traerLista])

  useEffect(() => {
    if (!elegida) return
    let vigente = true
    setPlantilla(null)
    pedir<{ plantilla: PlantillaCompleta }>(`/api/facturacion/plantillas?id=${encodeURIComponent(elegida)}`)
      .then(({ plantilla: p }) => {
        if (!vigente) return
        setPlantilla(p)
        setNombre(p.nombre)
        setAsunto(p.asunto)
        setHtml(p.cuerpo)
        setModo('visual')
      })
      .catch((e: Error) => toast.error(e.message))
    return () => {
      vigente = false
    }
  }, [elegida])

  const htmlActual = () => (modo === 'visual' ? (editor.current?.html() ?? html) : html)

  function cambiarModo(nuevo: 'visual' | 'html') {
    if (nuevo === modo) return
    setHtml(htmlActual())
    setModo(nuevo)
  }

  async function guardar() {
    if (!plantilla) return
    if (!window.confirm(`Esto cambia «${plantilla.nombre}» en Zoho para todas las facturas que se envíen a partir de ahora. ¿Guardar?`)) return
    setGuardando(true)
    try {
      const cuerpo = htmlActual()
      await pedir('/api/facturacion/plantillas', { metodo: 'PUT', cuerpo: { id: plantilla.id, nombre, asunto, cuerpo } })
      setHtml(cuerpo)
      setPlantilla({ ...plantilla, nombre, asunto, cuerpo })
      toast.success('Plantilla guardada en Zoho')
      void traerLista()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar')
    } finally {
      setGuardando(false)
    }
  }

  async function duplicar() {
    if (!plantilla) return
    const nuevo = window.prompt('Nombre de la plantilla nueva:', `${plantilla.nombre} (copia)`)?.trim()
    if (!nuevo) return
    setGuardando(true)
    try {
      const { id } = await pedir<{ id: string }>('/api/facturacion/plantillas', {
        metodo: 'POST',
        cuerpo: { desdeId: plantilla.id, nombre: nuevo, asunto, cuerpo: htmlActual() },
      })
      toast.success('Plantilla creada en Zoho')
      await traerLista(id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido crear')
    } finally {
      setGuardando(false)
    }
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto)
      toast.success(`${texto} copiado`)
    } catch {
      toast.error('No se ha podido copiar')
    }
  }

  if (error) {
    return (
      <Aviso tono="rojo" icono={AlertTriangle}>
        {error}
      </Aviso>
    )
  }
  if (cargando) {
    return (
      <div className={`flex items-center justify-center gap-2 py-16 ${TIPO.s} ${TEXTO.t3}`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Leyendo las plantillas de Zoho…
      </div>
    )
  }

  const huecos = plantilla ? huecosDeEnlace(`${plantilla.asunto} ${html}`) : []

  return (
    <div className="grid grid-cols-1 gap-2 lg:grid-cols-[260px_1fr]">
      <div className="flex flex-col gap-2">
        <div className={TARJETA.base}>
          <div className={TARJETA.cabecera}>
            <span className={TITULO.seccion}>Plantillas de correo</span>
          </div>
          <div className="flex flex-col gap-0.5 p-1">
            {lista.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setElegida(p.id)}
                className={`rounded-[4px] px-2 py-1 text-left ${TIPO.s} ${p.id === elegida ? 'bg-[var(--ls-sel)] text-[var(--ls-t1)]' : `${TEXTO.t2} hover:bg-[var(--ls-sup3)]`}`}
              >
                {p.nombre}
              </button>
            ))}
          </div>
        </div>

        {plantilla && (
          <div className={TARJETA.base}>
            <div className={TARJETA.cabecera}>
              <span className={TITULO.seccion}>Datos que se rellenan solos</span>
            </div>
            <div className="max-h-[320px] overflow-auto p-1">
              {plantilla.marcadores.map((m) => (
                <button
                  key={m.valor}
                  type="button"
                  title={`Copiar ${m.valor}`}
                  onClick={() => void copiar(m.valor)}
                  className={`flex w-full items-center justify-between gap-2 rounded-[4px] px-2 py-0.5 text-left ${TIPO.s} ${TEXTO.t3} hover:bg-[var(--ls-sup3)]`}
                >
                  <span className="truncate">{m.nombre}</span>
                  <Copy className="h-3 w-3 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {!plantilla ? (
        <div className={`flex items-center justify-center gap-2 py-16 ${TIPO.s} ${TEXTO.t3}`}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Leyendo la plantilla…
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          <div className={CAMPO.rejilla}>
            <div className={CAMPO.contenedor}>
              <label className={CAMPO.etiqueta}>Nombre</label>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={CAMPO.input} />
            </div>
            <div className={CAMPO.contenedor}>
              <label className={CAMPO.etiqueta}>Asunto</label>
              <input value={asunto} onChange={(e) => setAsunto(e.target.value)} className={CAMPO.input} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => cambiarModo('visual')} className={`${BOTON.chip} ${modo === 'visual' ? BOTON.chipEncendido : ''}`}>
              Visual
            </button>
            <button type="button" onClick={() => cambiarModo('html')} className={`${BOTON.chip} ${modo === 'html' ? BOTON.chipEncendido : ''}`}>
              HTML
            </button>
            {huecos.length > 0 && <span className={`${TIPO.s} ${TEXTO.t3}`}>Huecos al enviar: {huecos.map(rotuloDeHueco).join(', ')}</span>}
            <div className="ml-auto flex items-center gap-2">
              <button type="button" disabled={guardando} onClick={() => void duplicar()} className={`${BOTON.base} ${BOTON.secundario}`}>
                Guardar como nueva
              </button>
              <button type="button" disabled={guardando} onClick={() => void guardar()} className={`${BOTON.base} ${BOTON.primario}`}>
                {guardando && <Loader2 className="h-3 w-3 animate-spin" />}
                Guardar en Zoho
              </button>
            </div>
          </div>

          <div className="h-[640px] overflow-hidden rounded-[6px] border border-[var(--ls-linea)]">
            {modo === 'visual' ? (
              <EditorCorreo ref={editor} html={html} />
            ) : (
              <textarea
                value={html}
                aria-label="HTML de la plantilla"
                spellCheck={false}
                onChange={(e) => setHtml(e.target.value)}
                className="h-full w-full resize-none bg-[var(--ls-sup2)] p-2 font-mono text-[11.5px] text-[var(--ls-t1)] outline-none"
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
