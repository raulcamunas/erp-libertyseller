'use client'

import { AlertTriangle, History, ListChecks, Loader2, RefreshCw, Store, Users, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  FILTRO_DE_LEADS_VACIO,
  armarPanorama,
  porcentajeTexto,
  type AlcanceDeAsignar,
  type FiltroDeBanco,
  type FiltroDeLeads,
  type Movimiento,
  type ResumenDeLista,
} from '@/lib/cold-calling/listas'
import { fraseDeAnadir, leadsTexto, mensajeDeAnadir, mensajeDeDeshacer, mensajeDeMover, type OperacionDeMover } from '@/lib/cold-calling/listas-vista'
import type { PeticionDeSeleccion } from '@/lib/cold-calling/seleccion'
import { AVISO, BOTON, CIFRAS, COLOR_ESTADO, TITULO } from '@/lib/estilo/denso'
import {
  anadirDelBanco,
  archivarLista,
  asignarLista,
  cargarPanel,
  crearLista,
  deshacer,
  moverLeads,
  renombrarLista,
  type RespuestaDelPanel,
} from './api'
import { numero, useConservar } from './atomos'
import { BancoDeTiendas } from './BancoDeTiendas'
import { DialogoAsignarLista, DialogoDeConfirmar, DialogoDeLista, DialogoMover } from './DialogosDeListas'
import { ExplorarLeads } from './ExplorarLeads'
import { HistorialDeListas } from './HistorialDeListas'
import { ResumenDeListas } from './ResumenDeListas'

/**
 * LAS LISTAS DE LEADS DE COLD CALLING: VERLAS, MOVER LEADS ENTRE ELLAS, ASIGNARLAS AL EQUIPO Y METERLES TIENDAS NUEVAS.
 *
 * Es una vista más de Cold Calling (junto a Ficha, Tabla y Rellamadas) y solo la ven administradores, partners y quien tenga la casilla «Gestión de listas de leads».
 * Cuatro pestañas:
 *   · LISTAS      todas las listas, de qué tipo son (venden o no venden en Amazon), a quién están asignadas y lo usadas y llamadas que están. Se crean, renombran, asignan y archivan.
 *   · LEADS       los leads con filtros y selección múltiple para moverlos de lista o de dueño de golpe.
 *   · BANCO       las tiendas del Excel «Tienda no Amazon» por repartir, para añadirlas a una lista.
 *   · HISTORIAL   lo que se ha hecho y quién, con el botón de deshacer.
 *
 * Esta pantalla manda: es quien guarda los datos del panel, abre las ventanas, llama a la API, avisa del resultado (con «Deshacer» en el propio aviso) y, tras cada cambio,
 * pide al panel y a las pestañas que se pongan al día. Las pestañas solo pintan y piden. Lo que se calcula o se dice vive en lib/cold-calling/listas*.ts, con pruebas.
 */

type Pestana = 'listas' | 'leads' | 'banco' | 'historial'

const PESTANAS: ReadonlyArray<{ id: Pestana; etiqueta: string; icono: LucideIcon; ayuda: string }> = [
  { id: 'listas', etiqueta: 'Listas', icono: ListChecks, ayuda: 'Todas las listas y lo usadas y llamadas que están' },
  { id: 'leads', etiqueta: 'Leads', icono: Users, ayuda: 'Los leads con filtros: elige varios para moverlos de lista o asignarlos' },
  { id: 'banco', etiqueta: 'Banco de tiendas', icono: Store, ayuda: 'Las tiendas por repartir: añádelas a una lista' },
  { id: 'historial', etiqueta: 'Historial', icono: History, ayuda: 'Lo que se ha movido y asignado, y quién. Con deshacer' },
]

interface Props {
  /** Se llama tras cualquier cambio que pueda tocar leads de la cartera, para que Cold Calling la vuelva a pedir */
  alCambiarLeads: () => void
}

export function PantallaDeListas({ alCambiarLeads }: Props) {
  const [panel, setPanel] = useState<RespuestaDelPanel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [pestana, setPestana] = useState<Pestana>('listas')
  const [filtroLeads, setFiltroLeads] = useState<FiltroDeLeads>(FILTRO_DE_LEADS_VACIO)
  const [version, setVersion] = useState(0)
  const [listaParaBanco, setListaParaBanco] = useState('')

  const [dialogoLista, setDialogoLista] = useState<{ modo: 'crear' | 'renombrar'; lista?: ResumenDeLista } | null>(null)
  const [asignando, setAsignando] = useState<ResumenDeLista | null>(null)
  const [moviendo, setMoviendo] = useState<{ seleccion: PeticionDeSeleccion; filtro: FiltroDeLeads; cuantos: number } | null>(null)
  const [anadiendo, setAnadiendo] = useState<{ peticion: { dominios: string[] } | { filtro: FiltroDeBanco; primeras: number }; cuantas: number; lista: string; dueno: string | null } | null>(null)

  const dialogoListaVista = useConservar(dialogoLista)
  const asignandoConservado = useConservar(asignando)
  const movidoConservado = useConservar(moviendo)
  const anadidoConservado = useConservar(anadiendo)

  const recargar = useCallback(async () => {
    const r = await cargarPanel()
    setCargando(false)
    if (r.ok) {
      setPanel(r.datos)
      setError(null)
    } else setError(r.error)
  }, [])

  useEffect(() => {
    void recargar()
  }, [recargar])

  /** Tras cambiar algo: las pestañas vuelven a pedir lo suyo, el panel se pone al día y la cartera de Cold Calling también */
  const trasCambio = useCallback(async () => {
    setVersion((v) => v + 1)
    await recargar()
    alCambiarLeads()
  }, [recargar, alCambiarLeads])

  const panorama = useMemo(() => (panel ? armarPanorama(panel.filas, panel.registro) : null), [panel])
  const nombres = panel?.nombres ?? {}
  const nombreDe = useCallback((id: string) => nombres[id] ?? 'esa persona', [nombres])
  const puedeCambiar = panel?.migracion === true

  /* ---------------- deshacer ---------------- */

  const deshacerMovimiento = useCallback(
    async (id: string) => {
      const r = await deshacer(id)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(mensajeDeDeshacer(r.datos))
      await trasCambio()
    },
    [trasCambio]
  )

  /** Los avisos de lo que se acaba de hacer llevan el botón de deshacerlo, durante un rato largo */
  const conDeshacer = useCallback(
    (movimiento: string | null) => (movimiento ? { duration: 15_000, action: { label: 'Deshacer', onClick: () => void deshacerMovimiento(movimiento) } } : {}),
    [deshacerMovimiento]
  )

  /* ---------------- navegar entre pestañas ---------------- */

  const verLeads = useCallback((lista: string | null, persona: string | null) => {
    setFiltroLeads({ ...FILTRO_DE_LEADS_VACIO, lista, dueno: persona })
    setPestana('leads')
  }, [])

  const anadirTiendas = useCallback((lista: string) => {
    setListaParaBanco(lista)
    setPestana('banco')
  }, [])

  /* ---------------- lo que se guarda ---------------- */

  async function guardarLista(d: { nombre: string; descripcion: string; responsable: string | null }): Promise<string | null> {
    if (dialogoLista?.modo === 'renombrar' && dialogoLista.lista?.id) {
      const vieja = dialogoLista.lista.nombre
      const r = await renombrarLista(dialogoLista.lista.id, d.nombre)
      if (!r.ok) return r.error
      toast.success(`Lista renombrada a «${r.datos.nombre}»${r.datos.leads > 0 ? ` (${leadsTexto(r.datos.leads)})` : ''}`)
      // Si se estaban mirando sus leads, el filtro sigue a la lista con su nombre nuevo
      setFiltroLeads((f) => (f.lista && f.lista.trim().toLowerCase() === vieja.trim().toLowerCase() ? { ...f, lista: r.datos.nombre } : f))
      setListaParaBanco((l) => (l.trim().toLowerCase() === vieja.trim().toLowerCase() ? r.datos.nombre : l))
    } else {
      const r = await crearLista({ nombre: d.nombre, descripcion: d.descripcion || undefined, responsable: d.responsable })
      if (!r.ok) return r.error
      toast.success(`Lista «${r.datos.nombre}» creada`)
      setListaParaBanco(r.datos.nombre)
    }
    await trasCambio()
    return null
  }

  async function guardarAsignacion(dueno: string | null, alcance: AlcanceDeAsignar): Promise<string | null> {
    if (!asignando?.id) return 'Esa lista todavía no está registrada.'
    const r = await asignarLista(asignando.id, dueno, alcance)
    if (!r.ok) return r.error
    const quien = dueno ? nombreDe(dueno) : null
    const pasan = r.datos.cambiados
    toast.success(quien ? `«${asignando.nombre}» asignada a ${quien}${pasan > 0 ? `; ${leadsTexto(pasan)} pasan a ser suyos` : ''}` : `«${asignando.nombre}» ya no tiene responsable`, conDeshacer(r.datos.movimiento))
    await trasCambio()
    return null
  }

  async function archivar(l: ResumenDeLista, archivada: boolean) {
    if (!l.id) return
    const r = await archivarLista(l.id, archivada)
    if (!r.ok) {
      toast.error(r.error)
      return
    }
    toast.success(archivada ? `Lista «${l.nombre}» archivada` : `Lista «${l.nombre}» recuperada`)
    await trasCambio()
  }

  async function confirmarMover(cambios: { lista?: string | null; dueno?: string | null }): Promise<string | null> {
    if (!moviendo) return 'No hay nada elegido.'
    const r = await moverLeads(moviendo.seleccion, moviendo.filtro, cambios)
    if (!r.ok) return r.error
    const op: OperacionDeMover = { n: moviendo.cuantos, cambiaLista: 'lista' in cambios, lista: cambios.lista ?? null, cambiaDueno: 'dueno' in cambios, dueno: cambios.dueno ?? null, nombreDe }
    toast.success(mensajeDeMover(op, r.datos), conDeshacer(r.datos.movimiento))
    await trasCambio()
    return null
  }

  async function confirmarAnadir(): Promise<string | null> {
    if (!anadiendo) return 'No hay nada elegido.'
    const r = await anadirDelBanco(anadiendo.peticion, anadiendo.lista, anadiendo.dueno)
    if (!r.ok) return r.error
    toast.success(mensajeDeAnadir(r.datos), r.datos.anadidos > 0 ? conDeshacer(r.datos.movimiento) : {})
    await trasCambio()
    return null
  }

  /* ---------------- pintar ---------------- */

  if (!panel || !panorama) {
    return (
      <div className="flex min-h-[240px] flex-1 flex-col items-center justify-center gap-3 text-center">
        {error ? (
          <>
            <AlertTriangle className="h-5 w-5 text-[var(--ls-e-ambar)]" aria-hidden />
            <p className="max-w-[360px] text-[12.5px] text-[var(--ls-t2)]">{error}</p>
            <button type="button" onClick={() => void recargar()} className={`${BOTON.base} ${BOTON.secundario} ${BOTON.alto}`}>
              <RefreshCw className="h-3 w-3" aria-hidden /> Reintentar
            </button>
          </>
        ) : (
          cargando && (
            <p className="flex items-center gap-2 text-[12.5px] text-[var(--ls-t3)]" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando las listas…
            </p>
          )
        )}
      </div>
    )
  }

  const t = panorama.totales
  const listasDestino = panorama.listas.filter((l) => l.registrada && !l.archivada)
  // Lo que enseña cada ventana se conserva mientras se desvanece al cerrarse
  const listaDeLaVentana = dialogoLista?.lista ?? dialogoListaVista?.lista
  const modoDeLaVentana = dialogoLista?.modo ?? dialogoListaVista?.modo ?? 'crear'
  const asignandoVisto = asignandoConservado
  const cuantosVisto = movidoConservado?.cuantos ?? 0
  const anadidoVisto = anadidoConservado

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className={TITULO.pantalla}>Listas de leads</h2>
          <p className={`${TITULO.entradilla} max-w-[560px]`}>Mira las listas y lo usadas que están, mueve leads de una a otra, asígnalas a tu equipo y mete tiendas nuevas del banco.</p>
        </div>
        <div className={`${CIFRAS.tira} max-w-full overflow-x-auto`} role="group" aria-label="Resumen de todas las listas">
          <div className={CIFRAS.celda}>
            <span className={CIFRAS.valor}>{numero(t.leads)}</span>
            <span className={CIFRAS.rotulo}>leads</span>
          </div>
          <div className={CIFRAS.celda}>
            <span className={CIFRAS.valor}>{numero(t.listas)}</span>
            <span className={CIFRAS.rotulo}>listas</span>
          </div>
          <div className={CIFRAS.celda} title="Los que son de un vendedor que ya vende en Amazon (vendedores de Amazon)">
            <span className={CIFRAS.valor}>{numero(t.venden)}</span>
            <span className={CIFRAS.rotulo}>venden en Amazon</span>
          </div>
          <div className={CIFRAS.celda} title="Tiendas online que todavía no venden en Amazon">
            <span className={CIFRAS.valor}>{numero(t.noVenden)}</span>
            <span className={CIFRAS.rotulo}>no venden</span>
          </div>
          <div className={CIFRAS.celda}>
            <span className={CIFRAS.valor}>{porcentajeTexto(t.pctTrabajados)}</span>
            <span className={CIFRAS.rotulo}>trabajados</span>
          </div>
          <div className={CIFRAS.celda} title="Leads que no son de nadie: nadie los ve en su cartera">
            <span className={`${CIFRAS.valor} ${t.sinDueno > 0 ? CIFRAS.urgente : ''}`}>{numero(t.sinDueno)}</span>
            <span className={CIFRAS.rotulo}>sin dueño</span>
          </div>
        </div>
        <button type="button" onClick={() => void recargar()} className={`${BOTON.chip} !h-7 ml-auto`} title="Volver a leer las listas">
          <RefreshCw className="h-3 w-3" aria-hidden /> Actualizar
        </button>
      </div>

      {!panel.migracion && (
        <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.ambar }} role="alert">
          <AlertTriangle className={`${AVISO.icono} text-[var(--ls-e-ambar)]`} aria-hidden />
          <p>
            <span className={AVISO.fuerte}>Falta lanzar la migración 257.</span> Las listas se ven, pero todavía no se puede crear, mover ni asignar nada desde aquí. En cuanto se lance, funciona todo.
          </p>
        </div>
      )}

      <div role="tablist" aria-label="Qué mirar" className="flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-0.5">
        {PESTANAS.map((p) => {
          const activa = pestana === p.id
          const Icono = p.icono
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={activa}
              onClick={() => setPestana(p.id)}
              title={p.ayuda}
              className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[4px] px-2.5 text-[11.5px] font-medium transition-colors ${
                activa ? 'bg-[var(--ls-sup3)] text-[var(--ls-t1)] shadow-[inset_0_0_0_1px_var(--ls-acc-graf)]' : 'text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]'
              }`}
            >
              <Icono className="h-3.5 w-3.5" aria-hidden />
              {p.etiqueta}
            </button>
          )
        })}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-0.5" role="tabpanel">
        {pestana === 'listas' && (
          <ResumenDeListas
            panorama={panorama}
            filas={panel.filas}
            equipo={panel.equipo}
            nombres={nombres}
            puedeCambiar={puedeCambiar}
            onVerLeads={verLeads}
            onAnadirTiendas={anadirTiendas}
            onNueva={() => setDialogoLista({ modo: 'crear' })}
            onRenombrar={(l) => setDialogoLista({ modo: 'renombrar', lista: l })}
            onAsignar={setAsignando}
            onArchivar={(l, a) => void archivar(l, a)}
          />
        )}
        {pestana === 'leads' && (
          <ExplorarLeads
            filtro={filtroLeads}
            onFiltro={setFiltroLeads}
            panorama={panorama}
            equipo={panel.equipo}
            nombres={nombres}
            puedeCambiar={puedeCambiar}
            version={version}
            onMover={(seleccion, filtro, cuantos) => setMoviendo({ seleccion, filtro, cuantos })}
          />
        )}
        {pestana === 'banco' && (
          <BancoDeTiendas
            panorama={panorama}
            equipo={panel.equipo}
            nombres={nombres}
            puedeCambiar={puedeCambiar}
            version={version}
            lista={listaParaBanco}
            onLista={setListaParaBanco}
            onNuevaLista={() => setDialogoLista({ modo: 'crear' })}
            onAnadir={(peticion, cuantas, lista, dueno) => setAnadiendo({ peticion, cuantas, lista, dueno })}
          />
        )}
        {pestana === 'historial' && <HistorialDeListas movimientos={panel.movimientos} nombres={nombres} puedeCambiar={puedeCambiar} onDeshacer={(m: Movimiento) => void deshacerMovimiento(m.id)} />}
      </div>

      <DialogoDeLista
        abierto={dialogoLista !== null}
        onCerrar={() => setDialogoLista(null)}
        modo={modoDeLaVentana}
        lista={listaDeLaVentana}
        equipo={panel.equipo}
        onGuardar={guardarLista}
      />
      <DialogoAsignarLista abierto={asignando !== null} onCerrar={() => setAsignando(null)} lista={asignandoVisto} equipo={panel.equipo} onAsignar={guardarAsignacion} />
      <DialogoMover abierto={moviendo !== null} onCerrar={() => setMoviendo(null)} cuantos={cuantosVisto} listas={listasDestino} equipo={panel.equipo} nombres={nombres} onConfirmar={confirmarMover} />
      <DialogoDeConfirmar
        abierto={anadiendo !== null}
        onCerrar={() => setAnadiendo(null)}
        titulo="Añadir tiendas del banco"
        frase={anadidoVisto ? fraseDeAnadir({ n: anadidoVisto.cuantas, lista: anadidoVisto.lista, dueno: anadidoVisto.dueno, nombreDe }) : ''}
        detalle="Las tiendas cuya web ya está entre los leads no se duplican, y las ya repartidas o descartadas se saltan. Se puede deshacer desde el historial: se quitan las que sigan sin tocar."
        textoDelBoton="Añadir"
        onConfirmar={confirmarAnadir}
      />
    </div>
  )
}

