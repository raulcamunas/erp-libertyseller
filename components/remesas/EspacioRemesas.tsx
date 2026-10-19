'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Boxes, ClipboardList, Database, Download, FileDown, Package, Plus, Sparkles, TrendingDown, Upload } from 'lucide-react'
import { AVISO, BOTON, CIFRAS, COLOR_ESTADO, INSIGNIA, TIPO } from '@/lib/estilo/denso'
import { analizarProductos, resumenDeRitmo } from '@/lib/fba/analisis'
import { filasACsv } from '@/lib/fba/catalogo/exportar'
import { esClienteConCatalogo } from '@/lib/fba/catalogo/tipos'
import { estaCompleta } from '@/lib/fba/catalogo/validar'
import type { PanelRemesas, RemesaDePanel } from '@/lib/fba/datos'
import type { Actor } from '@/lib/fba/flujo'
import { esEnvio, esPropuesta, estaEnCamino, estaEnlazada, leToca, turnoDe } from '@/lib/fba/vista'
import { AnadirReferenciaDialog, type PrellenadoReferencia } from './catalogo/AnadirReferenciaDialog'
import { ImportarCatalogoDialog } from './catalogo/ImportarCatalogoDialog'
import { useCatalogo } from './catalogo/useCatalogo'
import { VistaBaseDeDatos } from './catalogo/VistaBaseDeDatos'
import { cx, Vacio } from './comun/ui'
import { DetalleEnvio } from './envios/DetalleEnvio'
import { PanelInventario } from './inventario/PanelInventario'
import { ListaEnvios } from './envios/ListaEnvios'
import { TraerEnvioDialog } from './envios/TraerEnvioDialog'
import { EspacioPropuesta } from './propuestas/EspacioPropuesta'
import { ListaPropuestas } from './propuestas/ListaPropuestas'
import { NuevaPropuestaDialog } from './propuestas/NuevaPropuestaDialog'
import { PropuestaIaDialog } from './propuestas/PropuestaIaDialog'
import { fecha } from './formato'
import { VistaReferencias } from './VistaReferencias'

/**
 * REMESAS A FBA: DOS COSAS DISTINTAS Y UNA TERCERA PARA MIRAR.
 *
 *   ENVÍOS       lo que ya ha salido y existe en Amazon: se sigue su estado, lo
 *                que ha llegado y lo que se va vendiendo. Es lo verídico.
 *   PROPUESTAS   lo que se está preparando con el cliente: qué mandar, que lo
 *                apruebe, que etiquete y encaje. Cuando se marca como enviada y se
 *                enlaza con su número de Amazon, pasa a Envíos.
 *   REFERENCIAS  producto a producto, la que dice cuándo hay que reponer.
 *   PANEL DEL CLIENTE   (pestaña «Panel del cliente») TODO lo que el cliente tiene en Amazon,
 *                con sus ventas, devoluciones, el tiempo que lleva parado y lo que puede
 *                costar: su inventario FBA entero, sin depender de qué envíos se hayan
 *                registrado. Al cambiar de cliente en la barra, la pestaña se queda: se
 *                recorren los paneles de uno en uno.
 *   PROPUESTA CON IA   (solo la agencia) la IA mira el inventario y propone qué mandar, con el
 *                porqué de cada línea; se revisa, se corrige y se crea el borrador. La
 *                propuesta a mano sigue ahí, al lado.
 *   BASE DE DATOS  solo para los clientes que la tienen (ShoesF): su hoja de REF,
 *                color, talla, EAN, FNSKU, ASIN y FBASKU, de la que las propuestas
 *                sacan los desplegables.
 *
 * Cada una es una pantalla con su propia lista a la izquierda y su espacio de
 * trabajo a la derecha. La pantalla no calcula nada pesado: el reparto de ventas
 * llega hecho del servidor.
 *
 * Cambiar de pestaña o de envío es instantáneo —no toca el servidor—. Solo se
 * pide al servidor lo que hace falta: otro cliente, o las cajas de una propuesta
 * que está encajándose, que llegan por la URL.
 */

interface Cliente {
  id: string
  nombre: string
  puedeEditar: boolean
  remesas: number
  envios: number
  propuestas: number
}

type Vista = 'envios' | 'propuestas' | 'referencias' | 'inventario' | 'base'

export function EspacioRemesas({
  clientes,
  cliente,
  panel,
  esAdmin,
  remesaAbierta,
}: {
  clientes: Cliente[]
  cliente: Cliente
  panel: PanelRemesas
  esAdmin: boolean
  /** La remesa cuyas cajas ha traído el servidor. Viene de la URL */
  remesaAbierta: string | null
  nombreUsuario: string
}) {
  const router = useRouter()
  const verComo: Actor = esAdmin ? 'agencia' : 'cliente'
  const hoy = panel.hoy
  // Cada propuesta con IA es una llamada de pago sobre el inventario entero del cliente: la lanza
  // la agencia, igual que la ruta, que lo comprueba otra vez en el servidor
  const puedeProponerConIa = esAdmin && cliente.puedeEditar

  const envios = useMemo(() => panel.remesas.filter(esEnvio), [panel.remesas])
  const propuestas = useMemo(() => panel.remesas.filter(esPropuesta), [panel.remesas])

  // Si llegan por un enlace a una propuesta, se abre en Propuestas
  const [vistaElegida, setVista] = useState<Vista>(() => {
    const abierta = panel.remesas.find((r) => r.id === remesaAbierta)
    return abierta && esPropuesta(abierta) ? 'propuestas' : 'envios'
  })

  // La base de datos solo existe para los clientes que la tienen. Si se estaba en ella
  // y se salta a otro cliente, se cae a Envíos: derivado, no corregido en un efecto.
  const conCatalogo = esClienteConCatalogo(cliente.nombre)
  const vista: Vista = vistaElegida === 'base' && !conCatalogo ? 'envios' : vistaElegida
  const catalogo = useCatalogo(cliente.id, conCatalogo)
  const [anadiendo, setAnadiendo] = useState<PrellenadoReferencia | null>(null)
  const [importando, setImportando] = useState(false)
  const [envioElegido, setEnvioElegido] = useState<string | null>(remesaAbierta)
  const [propuestaElegida, setPropuestaElegida] = useState<string | null>(remesaAbierta)
  const [nueva, setNueva] = useState(false)
  const [conIa, setConIa] = useState(false)
  const [trayendo, setTrayendo] = useState(false)
  const [cambiando, setCambiando] = useState<string | null>(null)

  function irACliente(id: string) {
    if (id === cliente.id) return
    setCambiando(id)
    router.push(`/dashboard/remesas?cliente=${id}`)
  }
  useEffect(() => setCambiando(null), [cliente.id])

  /**
   * LA ELEGIDA, DERIVADA Y NO CORREGIDA.
   *
   * Si la remesa elegida todavía no está en el panel —acaba de crearse y el
   * servidor no ha contestado— se enseña la primera, pero NO se toca la elección:
   * cuando lleguen los datos, la elegida está ahí y se abre sola. Corregir el
   * estado en medio es lo que haría saltar a otra.
   */
  const envio = envios.find((r) => r.id === envioElegido) ?? primeroPorDefecto(envios)
  const propuesta = propuestas.find((r) => r.id === propuestaElegida) ?? propuestas[0] ?? null

  // Las cajas de una propuesta que se está encajando llegan por la URL: es lo único
  // que obliga a ir al servidor al elegir una. Se pide UNA vez por propuesta y paso
  // (la clave lo recuerda), así que si el servidor no las trae no se queda
  // preguntando en bucle.
  const cajasPedidas = useRef<string | null>(null)
  const clavePropuesta = propuesta ? `${propuesta.id}:${propuesta.estado}` : null
  const cajasLlegadas = panel.cajasDe?.remesaId ?? null
  useEffect(() => {
    if (vista !== 'propuestas' || !propuesta || !clavePropuesta) return
    const necesitaCajas = propuesta.estado === 'encajando' || propuesta.estado === 'lista'
    if (!necesitaCajas || cajasLlegadas === propuesta.id || cajasPedidas.current === clavePropuesta) return
    cajasPedidas.current = clavePropuesta
    router.replace(`/dashboard/remesas?cliente=${cliente.id}&remesa=${propuesta.id}`, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista, clavePropuesta, cajasLlegadas, cliente.id])

  /** Días de stock de cada envío, para señalar en la lista los que se agotan pronto */
  const diasCobertura = useMemo(() => {
    const globales = new Map(panel.skus.map((s) => [s.sku, s]))
    const m = new Map<string, number | null>()
    for (const r of envios) {
      if (r.quedan === 0) {
        m.set(r.id, null)
        continue
      }
      m.set(r.id, resumenDeRitmo(r, analizarProductos(r, globales, hoy), hoy).cobertura)
    }
    return m
  }, [envios, panel.skus, hoy])

  const cifras = useMemo(() => {
    const enviadas = envios.reduce((s, r) => s + r.enviadas, 0)
    const vivas = envios.reduce((s, r) => s + r.quedan, 0)
    const enCamino = envios.filter((r) => estaEnCamino(r.estadoAmazon)).length
    const urgentes = panel.skus.filter((s) => s.diasDeCobertura !== null && s.diasDeCobertura <= 14 && s.quedan > 0).length
    const descuadre = panel.skus.reduce((s, k) => s + (k.descuadre ?? 0), 0)
    const tocan = propuestas.filter((r) => leToca(turnoDe(r.estado, r.lineas.length), verComo)).length
    const porFase = (e: string) => propuestas.filter((r) => r.estado === e).length
    return { enviadas, vivas, enCamino, urgentes, descuadre, tocan, porFase, conDescuadre: panel.skus.filter((s) => s.descuadre !== null && s.descuadre !== 0).length }
  }, [envios, propuestas, panel.skus, verComo])

  const cifrasBase = useMemo(() => {
    const filas = catalogo.filas ?? []
    return {
      referencias: catalogo.indice.grupos.length,
      modelos: catalogo.indice.modelos.length,
      tallas: filas.length,
      incompletas: filas.filter((f) => !estaCompleta(f)).length,
    }
  }, [catalogo.filas, catalogo.indice])

  /** Descarga la base de datos en el formato de la hoja: se puede pegar de vuelta o volver a importar */
  function descargarBase() {
    const csv = '\ufeff' + filasACsv(catalogo.filas ?? [])
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    const nombre = cliente.nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    a.href = url
    a.download = `base-de-datos-${nombre}-${hoy}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fba-cockpit flex h-[calc(100vh-4rem)] min-h-0 flex-col">
      {/* ================= CABECERA: TÍTULO, VISTAS, CIFRAS Y ACCIONES ================= */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-5 pb-[6px] pt-[10px]">
        <h1 className={cx(TIPO.xl, 'text-[var(--ls-t1)]')}>Remesas a FBA</h1>

        <nav aria-label="Vistas" className="flex items-center gap-[2px] rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-[3px]">
          <Pestana activa={vista === 'envios'} onClick={() => setVista('envios')} icono={<Package className="h-[14px] w-[14px]" />} titulo="Lo que ya ha salido y existe en Amazon">
            Envíos
            <span className="tabular-nums text-[var(--ls-t4)]">{envios.filter(estaEnlazada).length}</span>
          </Pestana>
          <Pestana activa={vista === 'propuestas'} onClick={() => setVista('propuestas')} icono={<ClipboardList className="h-[14px] w-[14px]" />} titulo="Lo que se está preparando con el cliente">
            Propuestas
            {propuestas.length > 0 && (
              <span className={cifras.tocan > 0 ? INSIGNIA.contador : 'tabular-nums text-[var(--ls-t4)]'} title={cifras.tocan > 0 ? `${cifras.tocan} esperan a que muevas tú` : undefined}>
                {propuestas.length}
              </span>
            )}
          </Pestana>
          <Pestana activa={vista === 'referencias'} onClick={() => setVista('referencias')} icono={<TrendingDown className="h-[14px] w-[14px]" />} titulo="Producto a producto: cuándo hay que reponer">
            Referencias
          </Pestana>
          <Pestana activa={vista === 'inventario'} onClick={() => setVista('inventario')} icono={<Boxes className="h-[14px] w-[14px]" />} titulo="El panel completo de este cliente: su inventario FBA con ventas, devoluciones, tiempo parado, ritmo de venta y lo que puede costarle dejarlo en Amazon">
            Panel del cliente
          </Pestana>
          {conCatalogo && (
            <Pestana activa={vista === 'base'} onClick={() => setVista('base')} icono={<Database className="h-[14px] w-[14px]" />} titulo={`La hoja de referencias de ${cliente.nombre}: REF, color, talla y sus códigos. De aquí salen los desplegables de las propuestas`}>
              Base de datos
              {catalogo.filas && <span className="tabular-nums text-[var(--ls-t4)]">{catalogo.filas.length}</span>}
            </Pestana>
          )}
        </nav>

        {/* Las cifras del cliente, en la misma fila: no merecen una fila entera */}
        {vista === 'envios' && (
          <div className={CIFRAS.tira}>
            <Cifra rotulo="enviadas" valor={cifras.enviadas} />
            <Cifra rotulo="vivas" valor={cifras.vivas} />
            <Cifra rotulo="de camino" valor={cifras.enCamino} />
            <Cifra rotulo="se agotan en 14 días" valor={cifras.urgentes} alerta={cifras.urgentes > 0} />
            {panel.conectado && <Cifra rotulo="descuadre con Amazon" valor={cifras.descuadre} signo alerta={cifras.descuadre !== 0} pista="Lo que Amazon tiene menos lo que explican los envíos. Positivo: había stock de antes" />}
          </div>
        )}
        {vista === 'propuestas' && (
          <div className={CIFRAS.tira}>
            <Cifra rotulo="te tocan a ti" valor={cifras.tocan} urgente={cifras.tocan > 0} />
            <Cifra rotulo="en propuesta" valor={cifras.porFase('borrador')} />
            <Cifra rotulo="aprobadas" valor={cifras.porFase('aprobada')} />
            <Cifra rotulo="encajando" valor={cifras.porFase('encajando')} />
            <Cifra rotulo="listas" valor={cifras.porFase('lista')} />
          </div>
        )}
        {vista === 'referencias' && (
          <div className={CIFRAS.tira}>
            <Cifra rotulo="referencias" valor={panel.skus.length} />
            <Cifra rotulo="se agotan en 14 días" valor={cifras.urgentes} alerta={cifras.urgentes > 0} />
            <Cifra rotulo="con descuadre" valor={cifras.conDescuadre} alerta={cifras.conDescuadre > 0} />
          </div>
        )}
        {vista === 'base' && catalogo.filas && catalogo.filas.length > 0 && (
          <div className={CIFRAS.tira}>
            <Cifra rotulo="REF" valor={cifrasBase.referencias} />
            <Cifra rotulo="modelos" valor={cifrasBase.modelos} />
            <Cifra rotulo="tallas" valor={cifrasBase.tallas} />
            <Cifra rotulo="incompletas" valor={cifrasBase.incompletas} alerta={cifrasBase.incompletas > 0} pista="Tallas a las que les falta el FBASKU, el EAN, el FNSKU o el ASIN" />
          </div>
        )}

        <div className="ml-auto flex items-center gap-3">
          {panel.leidoHasta && <span className="hidden text-[11px] text-[var(--ls-t4)] 2xl:inline">Ventas leídas hasta el {fecha(panel.leidoHasta)}</span>}
          {cliente.puedeEditar && vista === 'envios' && (
            <button type="button" onClick={() => setTrayendo(true)} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)} title="Traer de Amazon un envío que ya existe, por su número FBA">
              <Download className="h-3 w-3" />
              Traer envío de Amazon
            </button>
          )}
          {vista === 'base' ? (
            <>
              {catalogo.filas && catalogo.filas.length > 0 && (
                <button type="button" onClick={descargarBase} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)} title="Descargar la base de datos en el formato de la hoja de cálculo">
                  <FileDown className="h-3 w-3" />
                  Exportar CSV
                </button>
              )}
              {catalogo.puedeEditar && !catalogo.sinMigrar && (
                <>
                  <button type="button" onClick={() => setImportando(true)} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)} title="Cargar o completar la base de datos desde el CSV de la hoja">
                    <Upload className="h-3 w-3" />
                    Importar CSV
                  </button>
                  <button type="button" onClick={() => setAnadiendo({})} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
                    <Plus className="h-3 w-3" />
                    Añadir referencia
                  </button>
                </>
              )}
            </>
          ) : (
            cliente.puedeEditar &&
            (puedeProponerConIa ? (
              // La agencia tiene las dos: que la IA proponga, o montarla a mano como siempre
              <>
                <button type="button" onClick={() => setNueva(true)} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)} title="Eliges tú qué mandar, producto a producto">
                  <Plus className="h-3 w-3" />
                  Propuesta manual
                </button>
                <button type="button" onClick={() => setConIa(true)} className={cx(BOTON.base, BOTON.alto, BOTON.primario)} title="La IA mira el inventario, las ventas y las devoluciones y propone qué mandar. Se revisa y se corrige antes de crearla">
                  <Sparkles className="h-3 w-3" />
                  Propuesta con IA
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setNueva(true)} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
                <Plus className="h-3 w-3" />
                Nueva propuesta
              </button>
            ))
          )}
        </div>
      </header>

      {/* ================= CLIENTES ================= */}
      {clientes.length > 1 && <BarraClientes clientes={clientes} activo={cliente.id} cargando={cambiando} onElegir={irACliente} />}

      {/* ================= AVISOS (solo si los hay) ================= */}
      {((!panel.conectado && envios.length > 0) || panel.ultimoError) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pb-2">
          {!panel.conectado && envios.length > 0 && (
            <div className={cx(AVISO.base, AVISO.conTono, 'items-center')} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
              <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.ambar }} />
              Sin API de Amazon: las ventas no se descuentan solas
            </div>
          )}
          {panel.ultimoError && (
            <div className={cx(AVISO.base, AVISO.conTono, 'items-center')} style={{ borderLeftColor: COLOR_ESTADO.rojo }}>
              <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.rojo }} />
              Última lectura fallida: {panel.ultimoError.slice(0, 80)}
            </div>
          )}
        </div>
      )}

      {/* ================= CUERPO ================= */}
      {vista === 'inventario' ? (
        <div className="min-h-0 flex-1 px-5 pb-1">
          <PanelInventario key={cliente.id} clienteId={cliente.id} clienteNombre={cliente.nombre} hoy={hoy} onProponer={puedeProponerConIa ? () => setConIa(true) : undefined} />
        </div>
      ) : vista === 'base' ? (
        <div className="min-h-0 flex-1 px-5 pb-4">
          <VistaBaseDeDatos clienteId={cliente.id} clienteNombre={cliente.nombre} onAnadir={(p) => setAnadiendo(p ?? {})} onImportar={() => setImportando(true)} />
        </div>
      ) : vista === 'referencias' ? (
        <div className="min-h-0 flex-1 px-5 pb-4">
          <VistaReferencias skus={panel.skus} />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 px-5 pb-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          {vista === 'envios' ? (
            <>
              <ListaEnvios envios={envios} seleccionada={envio?.id ?? null} onElegir={setEnvioElegido} puedeEditar={cliente.puedeEditar} onTraer={() => setTrayendo(true)} diasCobertura={diasCobertura} hoy={hoy} />
              <section className="min-h-0 min-w-0">
                {envio ? (
                  <DetalleEnvio key={envio.id} remesa={envio} skus={panel.skus} hoy={hoy} puedeEditar={cliente.puedeEditar} puedeBorrar={esAdmin} conectado={panel.conectado} />
                ) : (
                  <SinSeleccion icono={<Package />} titulo={envios.length === 0 ? 'Todavía no hay ningún envío' : 'Elige un envío de la lista'}>
                    {envios.length === 0
                      ? 'Los envíos nacen de una propuesta: se prepara con el cliente, se marca como enviada y se enlaza con su número de Amazon. O se trae uno que ya existe por su número FBA.'
                      : 'Aquí aparece todo lo que se sabe de él: por dónde va en Amazon, cuánto ha llegado, cuánto se ha vendido y cuándo se agota.'}
                  </SinSeleccion>
                )}
              </section>
            </>
          ) : (
            <>
              <ListaPropuestas
                propuestas={propuestas}
                seleccionada={propuesta?.id ?? null}
                onElegir={(id) => setPropuestaElegida(id)}
                verComo={verComo}
                hoy={hoy}
                puedeEditar={cliente.puedeEditar}
                onNueva={() => setNueva(true)}
                onNuevaIa={puedeProponerConIa ? () => setConIa(true) : undefined}
              />
              <section className="min-h-0 min-w-0">
                {propuesta ? (
                  <EspacioPropuesta
                    key={propuesta.id}
                    remesa={propuesta}
                    clienteId={cliente.id}
                    clienteNombre={cliente.nombre}
                    esAdmin={esAdmin}
                    puedeEditar={cliente.puedeEditar}
                    puedeBorrar={esAdmin}
                    cajas={panel.cajasDe?.remesaId === propuesta.id ? panel.cajasDe.datos : null}
                    hoy={hoy}
                    onEnviada={(id) => {
                      setEnvioElegido(id)
                      setVista('envios')
                    }}
                  />
                ) : (
                  <SinSeleccion icono={<ClipboardList />} titulo={propuestas.length === 0 ? 'No hay ninguna propuesta' : 'Elige una propuesta'}>
                    Se propone qué mandar, el cliente lo aprueba, etiqueta y encaja, y la agencia crea el envío en Amazon. Cuando está enviada pasa a Envíos.
                  </SinSeleccion>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {anadiendo && <AnadirReferenciaDialog clienteId={cliente.id} clienteNombre={cliente.nombre} prellenado={anadiendo} onCerrar={() => setAnadiendo(null)} />}
      {importando && <ImportarCatalogoDialog clienteId={cliente.id} clienteNombre={cliente.nombre} onCerrar={() => setImportando(false)} />}
      {nueva && (
        <NuevaPropuestaDialog
          clienteId={cliente.id}
          clienteNombre={cliente.nombre}
          esAdmin={esAdmin}
          conCatalogo={conCatalogo}
          onCerrar={() => setNueva(false)}
          onCreada={(id) => {
            setPropuestaElegida(id)
            setVista('propuestas')
            router.refresh()
          }}
        />
      )}
      {conIa && puedeProponerConIa && (
        <PropuestaIaDialog
          clienteId={cliente.id}
          clienteNombre={cliente.nombre}
          hoy={hoy}
          onCerrar={() => setConIa(false)}
          onCreada={(id) => {
            setPropuestaElegida(id)
            setVista('propuestas')
            router.refresh()
          }}
        />
      )}
      {trayendo && (
        <TraerEnvioDialog
          clienteId={cliente.id}
          clienteNombre={cliente.nombre}
          onCerrar={() => setTrayendo(false)}
          onTraido={(id) => {
            setEnvioElegido(id)
            setVista('envios')
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

/** Al abrir Envíos, si no hay ninguno elegido, el más reciente de los enlazados */
function primeroPorDefecto(envios: RemesaDePanel[]): RemesaDePanel | null {
  const enlazados = envios.filter(estaEnlazada).sort((a, b) => b.fechaEnvio.localeCompare(a.fechaEnvio))
  return enlazados.find((r) => r.quedan > 0) ?? enlazados[0] ?? null
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

function Pestana({ activa, onClick, icono, titulo, children }: { activa: boolean; onClick: () => void; icono: React.ReactNode; titulo: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-current={activa ? 'page' : undefined}
      className={cx(
        'inline-flex h-[28px] items-center gap-[7px] rounded-[6px] px-3 text-[12.5px] font-medium transition-colors',
        activa ? 'bg-[var(--ls-sup)] text-[var(--ls-t1)] shadow-[inset_0_0_0_1px_var(--ls-linea2)]' : 'text-[var(--ls-t3)] hover:text-[var(--ls-t1)]'
      )}
    >
      <span className={activa ? 'text-[var(--ls-acc)]' : undefined}>{icono}</span>
      {children}
    </button>
  )
}

function Cifra({ rotulo, valor, signo, alerta, urgente, pista }: { rotulo: string; valor: number; signo?: boolean; alerta?: boolean; urgente?: boolean; pista?: string }) {
  return (
    <div className={CIFRAS.celda} title={pista}>
      <span className={cx(CIFRAS.valor, urgente && CIFRAS.urgente)} style={alerta ? { color: COLOR_ESTADO.ambar } : undefined}>
        {signo && valor > 0 ? '+' : ''}
        {valor.toLocaleString('es-ES')}
      </span>
      <span className={CIFRAS.rotulo}>{rotulo}</span>
    </div>
  )
}

function SinSeleccion({ icono, titulo, children }: { icono: React.ReactNode; titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center rounded-[8px] border border-dashed border-[var(--ls-linea2)]">
      <Vacio icono={icono} titulo={titulo}>
        {children}
      </Vacio>
    </div>
  )
}

/**
 * UN BOTÓN POR CLIENTE, EN HORIZONTAL.
 *
 * Con once cuentas un desplegable obliga a abrirlo para saber qué hay; en
 * horizontal se ven todas de un vistazo y se salta de una a otra con un clic, que
 * es como se trabaja cuando revisas varias seguidas. Cada una dice cuántos envíos
 * tiene y, en naranja, cuántas propuestas hay en marcha. Las que no tienen nada se
 * pintan apagadas: siguen siendo clicables —hay que poder crearle la primera—.
 */
function BarraClientes({ clientes, activo, cargando, onElegir }: { clientes: Cliente[]; activo: string; cargando: string | null; onElegir: (id: string) => void }) {
  const fila = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fila.current?.querySelector('[data-activo="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [activo])

  return (
    <div ref={fila} className="flex shrink-0 items-center gap-[6px] overflow-x-auto px-5 pb-[8px] pt-[2px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {clientes.map((c) => {
        const esActivo = c.id === activo
        const vacio = c.remesas === 0
        return (
          <button
            key={c.id}
            type="button"
            data-activo={esActivo}
            onClick={() => onElegir(c.id)}
            title={vacio ? `${c.nombre} · todavía sin remesas` : `${c.nombre} · ${c.envios} envío${c.envios === 1 ? '' : 's'} · ${c.propuestas} propuesta${c.propuestas === 1 ? '' : 's'}`}
            className={cx(
              'relative inline-flex h-[26px] shrink-0 items-center gap-[7px] rounded-[6px] border px-[10px] text-[12px] transition-colors',
              c.id === cargando && 'animate-pulse',
              esActivo
                ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] font-medium text-[var(--ls-t1)]'
                : vacio
                  ? 'border-[var(--ls-linea)] text-[var(--ls-t4)] hover:border-[var(--ls-linea2)] hover:text-[var(--ls-t2)]'
                  : 'border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[var(--ls-t2)] hover:border-[var(--ls-linea2)] hover:text-[var(--ls-t1)]'
            )}
          >
            {c.nombre}
            {c.envios > 0 && <span className="tabular-nums text-[11px] text-[var(--ls-t4)]">{c.envios}</span>}
            {c.propuestas > 0 && (
              <span className={INSIGNIA.contador} title={`${c.propuestas} propuesta${c.propuestas === 1 ? '' : 's'} en marcha`}>
                {c.propuestas}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
