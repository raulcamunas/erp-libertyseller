'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bookmark, Check, Globe, Trash2, Users } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { type FiltrosDeTareas, type TipoDeVista } from '@/lib/tareas-clientes/tipos'
import { configDeFiltros, filtrosDeConfig, filtrosDePredefinida, mismosFiltros, nombreDeVista, vistaDeConfig, VISTAS_PREDEFINIDAS, type VistaGuardada } from '@/lib/tareas-clientes/vistas-guardadas'
import { BASE, pedir } from './api'

/**
 * EL MENÚ «VISTAS»: las predefinidas («Mis vencidas», «Esta semana»…), las que ha guardado cada cual y las que ha compartido un administrador. Elegir una pone sus filtros (y el
 * modo de mirar, si lo lleva); «Guardar esta vista» guarda los filtros que hay puestos. No recuerda nada solo: una vista se elige y se nota que está elegida.
 */
export function MenuDeVistas({ filtros, vista, esAdmin, onAplicar }: { filtros: FiltrosDeTareas; vista: TipoDeVista; esAdmin: boolean; onAplicar: (f: FiltrosDeTareas, v?: TipoDeVista) => void }) {
  const [abierto, setAbierto] = useState(false)
  const [guardadas, setGuardadas] = useState<VistaGuardada[] | null>(null)
  const [nombre, setNombre] = useState('')
  const [compartir, setCompartir] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const r = await pedir<{ vistas: VistaGuardada[] }>(`${BASE}/vistas`)
      setGuardadas(r.vistas)
    } catch {
      setGuardadas((previas) => previas ?? [])
    }
  }, [])
  useEffect(() => {
    if (abierto) void cargar()
  }, [abierto, cargar])

  const puestaPredefinida = VISTAS_PREDEFINIDAS.find((v) => mismosFiltros(filtros, filtrosDePredefinida(v)))
  const puestaGuardada = (guardadas ?? []).find((v) => mismosFiltros(filtros, filtrosDeConfig(v.config)))
  const hayAlgo = Boolean(puestaPredefinida || puestaGuardada)

  async function guardar() {
    const limpio = nombreDeVista(nombre)
    if (!limpio) return setError('Ponle un nombre a la vista.')
    setGuardando(true)
    setError(null)
    try {
      await pedir(`${BASE}/vistas`, { metodo: 'POST', cuerpo: { nombre: limpio, compartida: compartir && esAdmin, config: configDeFiltros(filtros, vista) } })
      setNombre('')
      setCompartir(false)
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido guardar.')
    } finally {
      setGuardando(false)
    }
  }

  async function borrar(v: VistaGuardada) {
    setGuardadas((l) => (l ?? []).filter((x) => x.id !== v.id))
    try {
      await pedir(`${BASE}/vistas/${v.id}`, { metodo: 'DELETE' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido borrar.')
      void cargar()
    }
  }

  const Fila = ({ puesta, texto, icono, onElegir, onBorrar }: { puesta: boolean; texto: string; icono?: React.ReactNode; onElegir: () => void; onBorrar?: () => void }) => (
    <div className="group flex items-center">
      <button type="button" className="tc-opcion min-w-0 flex-1" onClick={() => { onElegir(); setAbierto(false) }}>
        <span className="flex h-4 w-4 items-center justify-center text-[var(--ls-acc-graf)]">{puesta ? <Check className="h-3.5 w-3.5" /> : icono}</span>
        <span className="min-w-0 flex-1 truncate text-left">{texto}</span>
      </button>
      {onBorrar && <button type="button" aria-label={`Borrar la vista ${texto}`} onClick={onBorrar} className="mr-1 hidden h-6 w-6 items-center justify-center rounded-[6px] text-[var(--ls-t4)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-e-rojo)] group-hover:flex focus-visible:flex"><Trash2 className="h-3 w-3" /></button>}
    </div>
  )

  const propias = (guardadas ?? []).filter((v) => !v.compartida)
  const compartidas = (guardadas ?? []).filter((v) => v.compartida)

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <button type="button" className="tc-boton-herramienta" data-activo={hayAlgo ? 'true' : undefined}><Bookmark className="h-3.5 w-3.5" /> Vistas</button>
      </PopoverTrigger>
      <PopoverContent align="end" className="!w-[290px] !rounded-[12px] !border-[var(--ls-linea2)] !bg-[var(--ls-sup)] !p-1.5 !text-[var(--ls-t1)] shadow-[0_18px_50px_rgba(0,0,0,0.4)]">
        <div className="flex max-h-[360px] flex-col overflow-auto text-[12.5px]">
          <p className="tc-lat-rotulo !pt-2">Rápidas</p>
          {VISTAS_PREDEFINIDAS.map((v) => <Fila key={v.id} puesta={puestaPredefinida?.id === v.id} texto={v.nombre} onElegir={() => onAplicar(filtrosDePredefinida(v))} />)}
          {propias.length > 0 && <p className="tc-lat-rotulo !pt-3">Mis vistas</p>}
          {propias.map((v) => <Fila key={v.id} puesta={puestaGuardada?.id === v.id} texto={v.nombre} onElegir={() => onAplicar(filtrosDeConfig(v.config), vistaDeConfig(v.config))} onBorrar={() => void borrar(v)} />)}
          {compartidas.length > 0 && <p className="tc-lat-rotulo !pt-3">Del equipo</p>}
          {compartidas.map((v) => <Fila key={v.id} puesta={puestaGuardada?.id === v.id} texto={v.nombre} icono={<Users className="h-3 w-3 opacity-60" />} onElegir={() => onAplicar(filtrosDeConfig(v.config), vistaDeConfig(v.config))} onBorrar={esAdmin ? () => void borrar(v) : undefined} />)}
        </div>
        <div className="mt-1 flex flex-col gap-1.5 border-t border-[var(--ls-linea)] p-1.5 pt-2.5">
          <p className="text-[11px] font-semibold text-[var(--ls-t4)]">Guardar los filtros que hay puestos</p>
          <div className="flex gap-1.5">
            <input value={nombre} onChange={(e) => { setNombre(e.target.value); setError(null) }} onKeyDown={(e) => { if (e.key === 'Enter') void guardar() }} maxLength={60} placeholder="Nombre de la vista" aria-label="Nombre de la vista" className="h-8 min-w-0 flex-1 rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[12.5px] outline-none placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)]" />
            <button type="button" disabled={guardando || !nombre.trim()} onClick={() => void guardar()} className="tc-boton-primario !h-8 disabled:opacity-50">Guardar</button>
          </div>
          {esAdmin && <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--ls-t2)]"><input type="checkbox" className="tc-casilla" checked={compartir} onChange={(e) => setCompartir(e.target.checked)} /><Globe className="h-3 w-3" /> Compartir con todo el equipo</label>}
          {error && <p role="alert" className="text-[11.5px] text-[var(--ls-e-rojo)]">{error}</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}
