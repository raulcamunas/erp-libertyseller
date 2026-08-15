'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Copy, Loader2, Play, TriangleAlert } from 'lucide-react'
import { postAmazon } from '@/lib/amazon/client'
import {
  LECTURAS,
  cambiarPujaKeyword,
  informeTerminosDeBusqueda,
  type LlamadaPreparada,
} from '@/lib/ads/laboratorio'
import type { ClienteAds } from './MarketingApiBoard'

/**
 * MARKETING V2 · EL BANCO DE PRUEBAS.
 *
 * No es la pantalla de Marketing, es lo que va ANTES: sirve para ver qué
 * devuelve Amazon de verdad —campañas, grupos, keywords, segmentación, términos
 * de búsqueda— antes de decidir qué se guarda y con qué forma.
 *
 * Se pidió así con todas las letras: «no construyamos interfaz seria todavía,
 * sino un entorno de pruebas rápido para ver que extraemos todos los datos». Y
 * es lo correcto: diseñar el esquema antes de ver el dato es cómo se acaba con
 * una tabla de treinta columnas de las que se usan cuatro.
 *
 * Nada de lo que sale de aquí se guarda. Se pide, se mira y se descarta.
 */
export function Laboratorio({ clientes }: { clientes: ClienteAds[] }) {
  /** Todas las cuentas encendidas, de todos los clientes y todas las regiones */
  const cuentas = useMemo(
    () =>
      clientes.flatMap((c) =>
        c.conexiones.flatMap((conn) =>
          conn.perfiles
            .filter((p) => p.en_uso)
            .map((p) => ({
              id: p.id,
              etiqueta: `${p.nombre || p.id_externo || p.profile_id} · ${p.pais ?? '?'} · ${c.nombre}`,
            }))
        )
      ),
    [clientes]
  )

  const [cuenta, setCuenta] = useState<string>(cuentas[0]?.id ?? '')
  const [ruta, setRuta] = useState(LECTURAS[0].ruta)
  const [metodo, setMetodo] = useState<string>(LECTURAS[0].metodo)
  const [tipo, setTipo] = useState(LECTURAS[0].tipo ?? '')
  const [cuerpo, setCuerpo] = useState(JSON.stringify(LECTURAS[0].cuerpo ?? {}, null, 2))
  const [escribir, setEscribir] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [salida, setSalida] = useState<string>('')
  const [meta, setMeta] = useState<string>('')

  function cargar(ll: LlamadaPreparada) {
    setRuta(ll.ruta)
    setMetodo(ll.metodo)
    setTipo(ll.tipo ?? '')
    setCuerpo(ll.cuerpo ? JSON.stringify(ll.cuerpo, null, 2) : '')
    // El interruptor de escritura NO se hereda de la llamada: se enciende a
    // mano, cada vez. Cargar una plantilla no puede armar el gatillo.
    setEscribir(false)
  }

  async function lanzar() {
    if (!cuenta) {
      toast.error('Elige una cuenta. Solo salen las que están encendidas arriba.')
      return
    }

    let parseado: unknown = undefined
    if (cuerpo.trim()) {
      try {
        parseado = JSON.parse(cuerpo)
      } catch {
        toast.error('El cuerpo no es JSON válido')
        return
      }
    }

    setCargando(true)
    setSalida('')
    setMeta('')

    const res = await postAmazon<{
      ms: number
      cuenta: string
      profileId: number
      datos: unknown
    }>('/api/ads/probar', {
      perfilId: cuenta,
      ruta,
      metodo,
      tipo: tipo || undefined,
      cuerpo: parseado,
      escribir,
    })

    setCargando(false)

    if (!res.ok) {
      setSalida(res.error)
      setMeta('falló')
      return
    }
    setMeta(`${res.data.cuenta} · profileId ${res.data.profileId} · ${res.data.ms} ms`)
    setSalida(JSON.stringify(res.data.datos, null, 2))
  }

  const hoy = new Date().toISOString().slice(0, 10)
  const haceUnMes = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)

  return (
    <div className="space-y-2.5 pt-2">
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold text-white">Banco de pruebas</h3>
        <span className="text-[11px] text-white/35">
          Mira qué devuelve Amazon. No se guarda nada.
        </span>
      </div>

      {cuentas.length === 0 ? (
        <div className="rounded-xl border border-yellow-500/25 bg-yellow-400/[0.06] px-3 py-2 text-[12px] text-yellow-200/90">
          No hay ninguna cuenta encendida. Enciende arriba las que se trabajen — de las apagadas no
          se pide nada, tampoco desde aquí.
        </div>
      ) : (
        <>
          {/* Las llamadas preparadas */}
          <div className="flex flex-wrap gap-1.5">
            {LECTURAS.map((ll) => (
              <button
                key={ll.id}
                type="button"
                onClick={() => cargar(ll)}
                title={ll.para}
                className={`px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors ${
                  ruta === ll.ruta
                    ? 'border-[#FF6600]/60 bg-[#FF6600]/15 text-white'
                    : 'border-white/10 text-white/45 hover:text-white/80'
                }`}
              >
                {ll.nombre}
              </button>
            ))}
            <button
              type="button"
              onClick={() => cargar(informeTerminosDeBusqueda(haceUnMes, hoy))}
              title="Pide el informe. Amazon tarda en generarlo: esto solo devuelve el identificador"
              className="px-2.5 py-1 rounded-full border border-white/10 text-[11px] font-medium text-white/45 hover:text-white/80 transition-colors"
            >
              Informe de términos
            </button>
            {/* En rojo desde el propio botón: cargarla no escribe nada, pero
                tiene que verse distinta desde antes de tocarla. */}
            <button
              type="button"
              onClick={() => cargar(cambiarPujaKeyword('PON_AQUI_EL_KEYWORD_ID', 0.5))}
              title="ESCRIBE en la cuenta del cliente y gasta su dinero"
              className="px-2.5 py-1 rounded-full border border-red-500/40 text-[11px] font-medium text-red-300/80 hover:text-red-200 transition-colors flex items-center gap-1.5"
            >
              <TriangleAlert className="h-3 w-3" />
              Cambiar una puja
            </button>
          </div>

          {/* Los controles */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <div className="space-y-1.5">
              <select
                value={cuenta}
                onChange={(e) => setCuenta(e.target.value)}
                className="w-full h-7 rounded-lg border border-white/10 bg-white/[0.03] px-2 text-[11px] text-white outline-none focus:border-[#FF6600]"
              >
                {cuentas.map((c) => (
                  <option key={c.id} value={c.id} className="bg-[#1a1a1a]">
                    {c.etiqueta}
                  </option>
                ))}
              </select>

              <div className="flex gap-1.5">
                <select
                  value={metodo}
                  onChange={(e) => setMetodo(e.target.value)}
                  className="h-7 w-[76px] rounded-lg border border-white/10 bg-white/[0.03] px-1.5 text-[11px] text-white outline-none focus:border-[#FF6600]"
                >
                  {['GET', 'POST', 'PUT'].map((m) => (
                    <option key={m} value={m} className="bg-[#1a1a1a]">
                      {m}
                    </option>
                  ))}
                </select>
                <input
                  value={ruta}
                  onChange={(e) => setRuta(e.target.value)}
                  placeholder="/sp/campaigns/list"
                  className="flex-1 h-7 rounded-lg border border-white/10 bg-white/[0.03] px-2 text-[11px] text-white font-mono outline-none focus:border-[#FF6600]"
                />
              </div>

              <input
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                placeholder="Content-Type de la v3, p. ej. application/vnd.spCampaign.v3+json"
                className="w-full h-7 rounded-lg border border-white/10 bg-white/[0.03] px-2 text-[11px] text-white/70 font-mono outline-none focus:border-[#FF6600]"
              />

              <textarea
                value={cuerpo}
                onChange={(e) => setCuerpo(e.target.value)}
                rows={8}
                spellCheck={false}
                placeholder="Cuerpo JSON (vacío para GET)"
                className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[11px] text-white font-mono outline-none focus:border-[#FF6600] resize-y"
              />

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={lanzar}
                  disabled={cargando}
                  className="px-3 py-1.5 rounded-full bg-[#FF6600] text-white text-[11px] font-medium flex items-center gap-1.5 disabled:opacity-50"
                >
                  {cargando ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                  Lanzar
                </button>

                {/* SE ENCIENDE A MANO Y CADA VEZ. Sin esto, el servidor rechaza
                    cualquier llamada que no sea de lectura. */}
                <label className="flex items-center gap-1.5 text-[11px] text-red-300/80 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={escribir}
                    onChange={(e) => setEscribir(e.target.checked)}
                    className="accent-red-500"
                  />
                  Permitir escribir en la cuenta del cliente
                </label>
              </div>

              {escribir && (
                <p className="text-[10px] text-red-300/70 flex gap-1.5">
                  <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                  Con esto puesto, la llamada puede cambiar pujas, presupuestos o el estado de una
                  campaña. Es dinero del cliente y no hay deshacer.
                </p>
              )}
            </div>

            {/* La respuesta */}
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-wider text-white/35">
                  Respuesta
                </span>
                {meta && <span className="text-[10px] text-white/40">{meta}</span>}
                {salida && (
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(salida)
                      toast.success('Copiado')
                    }}
                    className="ml-auto text-white/40 hover:text-white transition-colors"
                    title="Copiar el JSON"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                )}
              </div>
              <pre className="h-[360px] overflow-auto rounded-lg border border-white/10 bg-black/40 p-2 text-[10.5px] text-white/70 font-mono whitespace-pre">
                {salida || 'Elige una llamada de arriba y dale a Lanzar.'}
              </pre>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
