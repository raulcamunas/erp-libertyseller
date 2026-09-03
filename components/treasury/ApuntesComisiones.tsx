'use client'

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { ChevronDown, Handshake, Plus, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

/**
 * EL MODELO PACTADO CON CADA CLIENTE, APUNTADO EN UN SITIO.
 *
 * Qué se cobró de set up, qué se cobra de mantenimiento, qué comisión lleva cada
 * cosa y —lo que más se olvida— SOBRE QUÉ se calcula esa comisión. Hoy eso vive
 * en la cabeza de dos personas y en correos de hace meses, y cada vez que hay
 * que revisar una factura hay que reconstruirlo.
 *
 *
 * ============ ESTO NO CALCULA NADA, Y ES A PROPÓSITO ============
 *
 * Todos los importes son texto libre. Los tratos reales no caben en un número:
 * «10 % sobre el incremento», «5 % los tres primeros meses y luego 3», «1.500 €
 * en tres pagos». Con casillas numéricas habría que inventarse una forma para
 * cada trato o dejar fuera la mitad, y entonces el apunte deja de servir para lo
 * único que sirve: mirarlo antes de facturar.
 *
 * Si algún día hay que calcular con esto, se añaden columnas numéricas al lado.
 * Lo que no se puede es guardar mal el dato hoy para poder calcular mañana.
 *
 *
 * ============ SE GUARDA AL SALIR DEL CAMPO ============
 *
 * Sin botón de guardar. Es una tabla de notas que se rellena a ratos y a
 * trozos, y un botón por fila obliga a acordarse de pulsarlo en cada una — que
 * es exactamente como se pierde lo que acabas de escribir.
 */

const BASES = [
  { id: 'ano_anterior', etiqueta: 'Sobre el año anterior' },
  { id: 'ventas_actuales', etiqueta: 'Sobre las ventas actuales' },
  { id: 'otro', etiqueta: 'Otro (ver notas)' },
] as const

export interface ModeloComision {
  id: string
  client_id: string | null
  nombre: string | null
  setup_precio: string | null
  setup_comision: string | null
  mantenimiento_precio: string | null
  mantenimiento_comision: string | null
  base: 'ano_anterior' | 'ventas_actuales' | 'otro' | null
  notas: string | null
  position: number
}

const celda =
  'w-full bg-transparent border border-transparent hover:border-white/10 focus:border-[#FF6600] focus:bg-white/[0.04] rounded px-1.5 py-1 text-[12px] text-white outline-none transition-colors placeholder:text-white/20'

/** Un campo que se guarda al salir, sin botón */
function Campo({
  valor,
  marcador,
  onGuardar,
}: {
  valor: string | null
  marcador: string
  onGuardar: (v: string | null) => void
}) {
  const [texto, setTexto] = useState(valor ?? '')
  useEffect(() => setTexto(valor ?? ''), [valor])

  return (
    <input
      value={texto}
      placeholder={marcador}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => {
        const limpio = texto.trim()
        if (limpio === (valor ?? '')) return
        onGuardar(limpio === '' ? null : limpio)
      }}
      className={celda}
    />
  )
}

export function ApuntesComisiones({
  nombrePorCliente,
}: {
  /** Los nombres de `treasury_clients`, para no repetirlos aquí */
  nombrePorCliente: Map<string, string>
}) {
  const supabase = createClient()
  const [abierto, setAbierto] = useState(false)
  const [filas, setFilas] = useState<ModeloComision[]>([])
  const [cargando, setCargando] = useState(true)

  const traer = useCallback(async () => {
    const { data, error } = await supabase
      .from('treasury_commission_models')
      .select('*')
      .order('position')
      .order('created_at')
    setCargando(false)
    if (error) {
      // La migración se lanza a mano: sin ella la sección no existe todavía y no
      // puede tumbar Tesorería entera por un añadido.
      console.warn('No hay apuntes de comisiones todavía:', error.message)
      return
    }
    setFilas((data ?? []) as unknown as ModeloComision[])
  }, [supabase])

  useEffect(() => {
    if (abierto && cargando) void traer()
  }, [abierto, cargando, traer])

  async function guardar(id: string, patch: Partial<ModeloComision>) {
    setFilas((f) => f.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    const { error } = await supabase
      .from('treasury_commission_models')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      toast.error('No se ha podido guardar el apunte')
      void traer()
    }
  }

  async function anadir() {
    const nombre = window.prompt('Nombre del cliente o del trato')
    if (!nombre?.trim()) return
    const { data, error } = await supabase
      .from('treasury_commission_models')
      .insert({ nombre: nombre.trim(), position: filas.length })
      .select('*')
      .single()
    if (error) {
      toast.error('No se ha podido añadir')
      return
    }
    setFilas((f) => [...f, data as unknown as ModeloComision])
  }

  async function quitar(id: string) {
    const { error } = await supabase.from('treasury_commission_models').delete().eq('id', id)
    if (error) {
      toast.error('No se ha podido quitar')
      return
    }
    setFilas((f) => f.filter((x) => x.id !== id))
  }

  const nombreDe = (f: ModeloComision) =>
    f.client_id ? (nombrePorCliente.get(f.client_id) ?? 'Cliente borrado') : (f.nombre ?? '—')

  return (
    <div className="flex-shrink-0 rounded-2xl border border-white/10 bg-white/[0.02]">
      {/* ---------------- Cabecera, plegable ----------------
          Plegada por defecto: es una referencia que se consulta de vez en
          cuando, no lo que se viene a hacer a Tesorería todos los días. */}
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/[0.02]"
      >
        <Handshake className="h-3.5 w-3.5 text-[#FF6600]" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/45">
          Apuntes comisiones
        </span>
        <span className="text-[11px] text-white/30">
          Lo pactado con cada cliente: set up, mantenimiento y sobre qué se calcula
        </span>
        <ChevronDown
          className={`ml-auto h-4 w-4 text-white/35 transition-transform duration-200 ${
            abierto ? 'rotate-180' : ''
          }`}
        />
      </button>

      <AnimatePresence initial={false}>
        {abierto && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="w-[150px] pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                        Cliente
                      </th>
                      <th className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                        Set up · precio
                      </th>
                      <th className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                        Set up · comisión
                      </th>
                      <th className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                        Mantenim. · precio
                      </th>
                      <th className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                        Mantenim. · comisión
                      </th>
                      <th className="w-[190px] pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                        Se calcula sobre
                      </th>
                      <th className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                        Notas
                      </th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f) => (
                      <tr key={f.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                        <td className="py-1 pr-2 text-[12px] font-medium text-white/85">
                          {nombreDe(f)}
                        </td>
                        <td className="py-1 pr-1">
                          <Campo
                            valor={f.setup_precio}
                            marcador="1.500 €"
                            onGuardar={(v) => void guardar(f.id, { setup_precio: v })}
                          />
                        </td>
                        <td className="py-1 pr-1">
                          <Campo
                            valor={f.setup_comision}
                            marcador="—"
                            onGuardar={(v) => void guardar(f.id, { setup_comision: v })}
                          />
                        </td>
                        <td className="py-1 pr-1">
                          <Campo
                            valor={f.mantenimiento_precio}
                            marcador="450 €/mes"
                            onGuardar={(v) => void guardar(f.id, { mantenimiento_precio: v })}
                          />
                        </td>
                        <td className="py-1 pr-1">
                          <Campo
                            valor={f.mantenimiento_comision}
                            marcador="10 %"
                            onGuardar={(v) => void guardar(f.id, { mantenimiento_comision: v })}
                          />
                        </td>
                        <td className="py-1 pr-1">
                          <select
                            value={f.base ?? ''}
                            onChange={(e) =>
                              void guardar(f.id, {
                                base: (e.target.value || null) as ModeloComision['base'],
                              })
                            }
                            className={`${celda} cursor-pointer`}
                          >
                            <option value="" className="bg-[#141417]">
                              — sin definir —
                            </option>
                            {BASES.map((b) => (
                              <option key={b.id} value={b.id} className="bg-[#141417]">
                                {b.etiqueta}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1 pr-1">
                          <Campo
                            valor={f.notas}
                            marcador="Lo que haga falta recordar"
                            onGuardar={(v) => void guardar(f.id, { notas: v })}
                          />
                        </td>
                        <td className="py-1 text-right">
                          {/* Solo se quitan los apuntados a mano. Los que vienen
                              de Tesorería se van solos si se borra el cliente:
                              borrar aquí uno que sigue facturando dejaría su
                              trato sin apuntar y nadie se enteraría. */}
                          {!f.client_id && (
                            <button
                              type="button"
                              onClick={() => void quitar(f.id)}
                              className="text-white/20 transition-colors hover:text-red-300"
                              aria-label="Quitar"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}

                    {filas.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-4 text-center text-[12px] text-white/30">
                          {cargando
                            ? 'Cargando…'
                            : 'Todavía no hay apuntes. Falta lanzar la migración 172, o añade uno a mano.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void anadir()}
                  className="flex h-7 items-center gap-1 rounded-lg border border-white/10 px-2.5 text-[11px] text-white/70 transition-colors hover:border-white/25 hover:text-white"
                >
                  <Plus className="h-3 w-3" />
                  Añadir uno
                </button>
                <span className="text-[10.5px] leading-relaxed text-white/30">
                  Los clientes de Tesorería salen solos. Añade a mano los tratos cerrados con quien
                  todavía no factura. Se guarda al salir de cada casilla — todo es texto libre,
                  porque «10 % sobre el incremento» no cabe en una casilla de números.
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
