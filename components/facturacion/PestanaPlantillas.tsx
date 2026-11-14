'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Check, Code2, Copy, Eye, Link2, Loader2, Mail, Sparkles } from 'lucide-react'
import { colorDePersona, Esqueleto } from '@/components/rendimiento/ui'
import { BOTON, CAMPO, COLOR_ESTADO, TARJETA, TEXTO, TEXTO_ESTADO, TIPO } from '@/lib/estilo/denso'
import { huecosDeEnlace, rotuloDeHueco } from '@/lib/facturacion/logica'
import type { PlantillaCompleta, PlantillaResumen } from '@/lib/facturacion/tipos'
import { Aviso, CabeceraDeTarjeta, EditorCorreo, EsqueletoDePestana, pedir, tonoComoEstilo, type ManejoEditor } from './comun'

/** Cada plantilla, su color: siempre el mismo. La que trae Zoho va en gris porque no es de las nuestras */
const colorDePlantilla = (p: PlantillaResumen) => ({ '--tono': p.nombre === 'Predeterminado' ? COLOR_ESTADO.gris : colorDePersona(p.nombre) }) as CSSProperties

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
  const [editada, setEditada] = useState(false)
  const [copiado, setCopiado] = useState<string | null>(null)
  const editor = useRef<ManejoEditor>(null)
  const marcarEditada = useCallback(() => setEditada(true), [])

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
        setEditada(false)
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
      setEditada(false)
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
      setCopiado(texto)
      window.setTimeout(() => setCopiado((actual) => (actual === texto ? null : actual)), 1500)
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
  if (cargando) return <EsqueletoDePestana etiqueta="Leyendo las plantillas de Zoho" />

  const huecos = plantilla ? huecosDeEnlace(`${plantilla.asunto} ${html}`) : []

  return (
    <div className="grid grid-cols-1 items-start gap-2 lg:grid-cols-[272px_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-2">
        <div className={`${TARJETA.base} fac-entra overflow-hidden`}>
          <CabeceraDeTarjeta tono="violeta" icono={Mail} titulo="Plantillas de correo" cantidad={lista.length} />
          <div className="flex flex-col gap-0.5 p-1">
            {lista.map((p) => (
              <button key={p.id} type="button" aria-current={p.id === elegida} onClick={() => setElegida(p.id)} className="fac-plantilla" style={colorDePlantilla(p)}>
                <span className="fac-icono">
                  <Mail className="h-3 w-3" />
                </span>
                <span className="min-w-0 flex-1">{p.nombre}</span>
              </button>
            ))}
          </div>
        </div>

        {plantilla && (
          <div className={`${TARJETA.base} fac-entra overflow-hidden`} style={{ '--d': 1 } as CSSProperties}>
            <CabeceraDeTarjeta tono="cian" icono={Sparkles} titulo="Datos que se rellenan solos" cantidad={plantilla.marcadores.length} />
            <div className="flex max-h-[320px] flex-wrap gap-1 overflow-auto p-1.5">
              {plantilla.marcadores.map((m) => {
                const recien = copiado === m.valor
                return (
                  <button key={m.valor} type="button" title={`Copiar ${m.valor}`} onClick={() => void copiar(m.valor)} className="fac-chip !h-[22px] !px-2 !text-[11px]" style={tonoComoEstilo(recien ? 'verde' : 'cian')}>
                    {recien ? <Check className="rend-pop h-3 w-3" /> : <Copy className="h-2.5 w-2.5" />}
                    {m.nombre}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {!plantilla ? (
        <div role="status" aria-label="Leyendo la plantilla" className={`${TARJETA.base} flex flex-col gap-2 p-3`}>
          <Esqueleto className="h-[26px]" />
          <Esqueleto className="h-[26px] w-2/3" />
          <Esqueleto className="h-[480px]" />
        </div>
      ) : (
        <div key={plantilla.id} className="rend-fundido flex min-w-0 flex-col gap-2">
          <div className={`${TARJETA.base} flex flex-col gap-2 p-2.5`}>
            <div className={CAMPO.rejilla}>
              <div className={CAMPO.contenedor}>
                <label className={CAMPO.etiqueta}>Nombre</label>
                <input
                  value={nombre}
                  onChange={(e) => {
                    setNombre(e.target.value)
                    setEditada(true)
                  }}
                  className={CAMPO.input}
                />
              </div>
              <div className={CAMPO.contenedor}>
                <label className={CAMPO.etiqueta}>Asunto</label>
                <input
                  value={asunto}
                  onChange={(e) => {
                    setAsunto(e.target.value)
                    setEditada(true)
                  }}
                  className={CAMPO.input}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" aria-pressed={modo === 'visual'} onClick={() => cambiarModo('visual')} className="fac-chip" style={tonoComoEstilo('azul')}>
                <Eye className="h-3 w-3" /> Visual
              </button>
              <button type="button" aria-pressed={modo === 'html'} onClick={() => cambiarModo('html')} className="fac-chip" style={tonoComoEstilo('violeta')}>
                <Code2 className="h-3 w-3" /> HTML
              </button>
              {huecos.map((h) => (
                <span key={h} className="fac-contador !h-[22px] gap-1 !px-2 font-medium" style={tonoComoEstilo('ambar')} title="Se rellena al enviar la factura">
                  <Link2 className="h-3 w-3" /> {rotuloDeHueco(h)}
                </span>
              ))}
              <div className="ml-auto flex items-center gap-2">
                {editada && (
                  <span className={`rend-entra inline-flex items-center gap-1.5 ${TIPO.s} ${TEXTO_ESTADO.ambar}`}>
                    <span aria-hidden className="fac-punto" style={tonoComoEstilo('ambar')} /> Sin guardar
                  </span>
                )}
                <button type="button" disabled={guardando} onClick={() => void duplicar()} className={`${BOTON.base} ${BOTON.secundario}`}>
                  Guardar como nueva
                </button>
                <button type="button" disabled={guardando} onClick={() => void guardar()} className={`${BOTON.base} ${BOTON.primario} fac-brillo`}>
                  {guardando && <Loader2 className="h-3 w-3 animate-spin" />}
                  Guardar en Zoho
                </button>
              </div>
            </div>
          </div>

          <div className={`${TARJETA.base} overflow-hidden`}>
            <CabeceraDeTarjeta tono="azul" icono={Mail} titulo={asunto || 'Sin asunto'} derecha={<span className={`whitespace-nowrap ${TIPO.s} ${TEXTO.t4}`}>Así lo verá el cliente</span>} />
            <div className="h-[640px] overflow-hidden">
              {modo === 'visual' ? (
                <EditorCorreo ref={editor} html={html} onEditado={marcarEditada} />
              ) : (
                <textarea
                  value={html}
                  aria-label="HTML de la plantilla"
                  spellCheck={false}
                  onChange={(e) => {
                    setHtml(e.target.value)
                    setEditada(true)
                  }}
                  className="h-full w-full resize-none bg-[var(--ls-sup2)] p-2 font-mono text-[11.5px] text-[var(--ls-t1)] outline-none"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
