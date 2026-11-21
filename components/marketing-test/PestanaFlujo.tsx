'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarDays, RefreshCw, Workflow } from 'lucide-react'
import { Boton, EsqueletoTarjeta, EstadoVacio, PanelLateral, Segmentado, Tarjeta } from '@/components/ui-ls'
import { CAMPO } from '@/lib/estilo/denso'
import type { RespuestaDelFlujo } from '@/lib/ads/flujo'
import { llamar } from './llamar'
import { DiagramaDeFlujo } from './flujo/DiagramaDeFlujo'
import { TerminosDeFlecha, tituloDeSeleccion } from './flujo/TerminosDeFlecha'
import { DiarioPorDias } from './flujo/DiarioPorDias'
import type { Seleccion } from './flujo/comun'

const DIAS = [
  { id: 7, texto: '7 días' },
  { id: 14, texto: '14 días' },
  { id: 30, texto: '30 días' },
] as const
type Dias = (typeof DIAS)[number]['id']

/** El ASIN que viene en la dirección (?asin=B0…), para llegar aquí desde otra pantalla con el producto ya elegido */
function asinDeLaUrl(): string | null {
  try {
    const a = new URLSearchParams(window.location.search).get('asin')?.toUpperCase() ?? ''
    return /^B0[A-Z0-9]{8}$/.test(a) ? a : null
  } catch {
    return null
  }
}

function guardarAsinEnUrl(asin: string) {
  try {
    const q = new URLSearchParams(window.location.search)
    q.set('asin', asin)
    window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`)
  } catch {
    /* sin dirección: da igual */
  }
}

/**
 * PESTAÑA «FLUJO» DE MARKETING TEST: por producto, cómo se mueven los términos de búsqueda entre sus campañas (qué se cosecha de AUTO a AMPLIA o a EXACTA y qué se
 * negativiza) y, debajo, el diario por días de todo lo que se ha hecho en ellas. Solo lee: no cambia nada en Amazon.
 */
export function PestanaFlujo({ perfilId, moneda, irA }: { perfilId: string; moneda: string | null; irA?: (pestana: string) => void }) {
  // null hasta leer la dirección (en el cliente): así el servidor y el navegador pintan lo mismo y la primera petición ya lleva el producto bueno
  const [asin, setAsin] = useState<string | null>(null)
  const [dias, setDias] = useState<Dias>(14)
  const [conPropuestas, setConPropuestas] = useState(true)
  const [datos, setDatos] = useState<RespuestaDelFlujo | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [seleccion, setSeleccion] = useState<Seleccion | null>(null)
  const peticion = useRef(0)
  // Con «auto», el servidor elige el producto con más cambios; se recuerda aquí para que cambiar de periodo no salte a otro (sin volver a pedir)
  const resuelto = useRef<string | null>(null)

  useEffect(() => {
    setAsin(asinDeLaUrl() ?? 'auto')
  }, [])

  const cargar = useCallback(async () => {
    if (asin === null) return
    const yo = ++peticion.current
    setCargando(true)
    try {
      const q = new URLSearchParams({ perfilId, dias: String(dias), asin: asin === 'auto' && resuelto.current ? resuelto.current : asin, propuestas: conPropuestas ? '1' : '0' })
      const r = await llamar<RespuestaDelFlujo>(`/api/ads/cuenta/flujo?${q.toString()}`)
      if (yo !== peticion.current) return
      setDatos(r)
      setError(null)
      if (asin === 'auto' && r.asin) resuelto.current = r.asin
    } catch (e) {
      if (yo === peticion.current) setError(e instanceof Error ? e.message : 'No se ha podido cargar el flujo.')
    } finally {
      if (yo === peticion.current) setCargando(false)
    }
  }, [perfilId, dias, asin, conPropuestas])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const elegirProducto = (a: string) => {
    setSeleccion(null)
    setAsin(a)
    guardarAsinEnUrl(a)
  }

  const productos = datos?.productos ?? []
  // El producto elegido puede no tener nada en este periodo: se añade al desplegable para que no desaparezca
  const elegido = asin && asin !== 'auto' ? asin : (datos?.asin ?? null)
  const opciones = elegido && !productos.some((p) => p.asin === elegido) ? [{ asin: elegido, resumen: '', cambios: 0, roles: [] }, ...productos] : productos
  const flujo = datos?.flujo ?? null
  const titulo = seleccion && flujo ? tituloDeSeleccion(seleccion, flujo) : null
  const hayFlechas = Boolean(flujo?.flechas.some((f) => f.hechos + f.deshechos + f.fallidos + (conPropuestas ? f.propuestos + f.sinAplicar : 0) > 0))

  return (
    <div className="flex flex-col gap-4 pb-8">
      {/* ---- la barra: producto, periodo y «ver lo propuesto» ---- */}
      <Tarjeta acento="marketing" cuerpoClassName="flex flex-wrap items-center gap-2">
        <select
          value={asin && asin !== 'auto' ? asin : (datos?.asin ?? '')}
          onChange={(e) => e.target.value && elegirProducto(e.target.value)}
          disabled={opciones.length === 0}
          className={`${CAMPO.input} min-h-[36px] min-w-0 flex-1 basis-[260px] text-[13.5px] [@media(pointer:coarse)]:min-h-[44px]`}
          aria-label="Producto"
        >
          {opciones.length === 0 && <option value="">{cargando ? 'Cargando productos…' : 'Ningún producto con cambios'}</option>}
          {opciones.map((p) => (
            <option key={p.asin} value={p.asin}>
              {p.asin}
              {p.resumen ? ` · ${p.resumen}` : ''}
              {` · ${p.cambios} ${p.cambios === 1 ? 'cambio' : 'cambios'}`}
            </option>
          ))}
        </select>
        <Segmentado etiqueta="Periodo" tamano="sm" opciones={DIAS} valor={dias} onCambio={(d) => {
            setSeleccion(null)
            setDias(d)
          }} />
        <label className="inline-flex min-h-[36px] cursor-pointer select-none items-center gap-2 rounded-[10px] px-2 text-[13px] text-[var(--ls-t2)] [@media(pointer:coarse)]:min-h-[44px]">
          <input type="checkbox" checked={conPropuestas} onChange={(e) => {
              setSeleccion(null)
              setConPropuestas(e.target.checked)
            }} className="h-4 w-4 accent-[var(--ls-acc)]" />
          Ver también lo propuesto
        </label>
        <Boton variante="fantasma" tamano="sm" icono={RefreshCw} soloIcono aria-label="Actualizar" cargando={cargando && Boolean(datos)} onClick={() => void cargar()} />
      </Tarjeta>

      {error ? (
        <EstadoVacio icono={Workflow} acento="marketing" titulo="No se ha podido cargar el flujo" descripcion={error} accion={{ texto: 'Reintentar', icono: RefreshCw, onClick: () => void cargar() }} />
      ) : !datos ? (
        <>
          <EsqueletoTarjeta />
          <EsqueletoTarjeta />
        </>
      ) : productos.length === 0 && !datos.asin ? (
        <EstadoVacio
          icono={Workflow}
          acento="marketing"
          titulo={`En los últimos ${dias} días no se ha tocado ningún producto`}
          descripcion="Cuando el agente, el motor o alguien del equipo cambie pujas, negativice o coseche términos, aquí se verá cómo fluyen entre las campañas."
          accion={irA ? { texto: 'Ver las propuestas', onClick: () => irA('propuestas') } : undefined}
        />
      ) : (
        <>
          <Tarjeta
            acento="marketing"
            icono={Workflow}
            titulo="Cómo se mueven los términos entre campañas"
            subtitulo={
              datos.asin
                ? `${datos.asin}${opciones.find((p) => p.asin === datos.asin)?.resumen ? ` · ${opciones.find((p) => p.asin === datos.asin)?.resumen}` : ''} · del ${new Date(`${datos.periodo.desde}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })} a hoy`
                : undefined
            }
            cuerpoClassName={cargando ? 'opacity-60 transition-opacity' : 'transition-opacity'}
          >
            {flujo && flujo.nodos.length > 1 ? (
              <div className="flex flex-col gap-3">
                {!hayFlechas && (
                  <p className="rounded-[10px] bg-[var(--ls-sup2)] px-3 py-2 text-[13px] text-[var(--ls-t3)]">
                    En estos días ningún término ha pasado de una campaña a otra ni se ha negativizado{conPropuestas ? ', y tampoco hay nada propuesto' : ''}. Abajo tienes lo demás que se ha hecho (pujas, presupuestos…).
                  </p>
                )}
                {hayFlechas && flujo.flechas.every((f) => f.tipo !== 'cosecha' || f.hechos === 0) && flujo.flechas.some((f) => f.tipo === 'cosecha') && (
                  <p className="rounded-[10px] bg-[var(--ls-sup2)] px-3 py-2 text-[12.5px] text-[var(--ls-t3)]">
                    Todavía no se ha pasado ningún término a otra campaña: las cosechas están sin aplicar (líneas discontinuas). Púlsalas para ver por qué.
                  </p>
                )}
                <DiagramaDeFlujo flujo={flujo} conPropuestas={conPropuestas} moneda={moneda} elegir={setSeleccion} />
              </div>
            ) : (
              <p className="py-6 text-center text-[13px] text-[var(--ls-t3)]">Este producto no tiene campañas con la nomenclatura «ASIN | SKU | RESUMEN | ESTRATEGIA», así que no se puede dibujar su flujo.</p>
            )}
          </Tarjeta>

          <Tarjeta acento="marketing" icono={CalendarDays} titulo="Diario por días" subtitulo="Qué se ha hecho cada día en las campañas de este producto, quién y por qué" cuerpoClassName={cargando ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            <DiarioPorDias diario={datos.diario} />
          </Tarjeta>
          {datos.cortado && <p className="text-[12px] text-[var(--ls-t4)]">Hay tantos cambios en este periodo que solo se han leído los 5.000 más recientes: prueba con menos días.</p>}
        </>
      )}

      <PanelLateral abierto={seleccion !== null} onCambio={(a) => !a && setSeleccion(null)} icono={Workflow} acento="marketing" titulo={titulo?.titulo ?? ''} descripcion={titulo?.descripcion} ancho={560}>
        {seleccion && flujo ? <TerminosDeFlecha key={`${seleccion.tipo}:${seleccion.id}`} seleccion={seleccion} flujo={flujo} moneda={moneda} /> : null}
      </PanelLateral>
    </div>
  )
}

/**
 * EL DIARIO POR DÍAS DE TODA LA CUENTA (el modo «Por días» de la pestaña Log): lo mismo que el diario de un producto, pero con todas las campañas y con el ASIN en cada línea.
 */
export function DiarioDeCuenta({ perfilId }: { perfilId: string }) {
  const [dias, setDias] = useState<Dias>(7)
  const [datos, setDatos] = useState<RespuestaDelFlujo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const peticion = useRef(0)

  const cargar = useCallback(async () => {
    const yo = ++peticion.current
    setCargando(true)
    try {
      const r = await llamar<RespuestaDelFlujo>(`/api/ads/cuenta/flujo?${new URLSearchParams({ perfilId, dias: String(dias) }).toString()}`)
      if (yo !== peticion.current) return
      setDatos(r)
      setError(null)
    } catch (e) {
      if (yo === peticion.current) setError(e instanceof Error ? e.message : 'No se ha podido cargar el diario.')
    } finally {
      if (yo === peticion.current) setCargando(false)
    }
  }, [perfilId, dias])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return (
    <Tarjeta
      acento="marketing"
      icono={CalendarDays}
      titulo="Diario por días"
      subtitulo="Qué se ha hecho cada día en toda la cuenta, quién y por qué"
      acciones={
        <div className="flex items-center gap-1">
          <Segmentado etiqueta="Periodo" tamano="sm" opciones={DIAS} valor={dias} onCambio={setDias} />
          <Boton variante="fantasma" tamano="sm" icono={RefreshCw} soloIcono aria-label="Actualizar" cargando={cargando && Boolean(datos)} onClick={() => void cargar()} />
        </div>
      }
    >
      {error ? (
        <EstadoVacio compacto icono={CalendarDays} titulo="No se ha podido cargar el diario" descripcion={error} accion={{ texto: 'Reintentar', icono: RefreshCw, onClick: () => void cargar() }} />
      ) : !datos ? (
        <EsqueletoTarjeta />
      ) : (
        <div className={cargando ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <DiarioPorDias diario={datos.diario} conProducto />
          {datos.cortado && <p className="mt-3 text-[12px] text-[var(--ls-t4)]">Solo se han leído los 5.000 cambios más recientes: prueba con menos días.</p>}
        </div>
      )}
    </Tarjeta>
  )
}
