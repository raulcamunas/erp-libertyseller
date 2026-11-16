'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Clock, Eye, Unplug, Users } from 'lucide-react'
import { Avatar, Boton, GrupoDeAvatares, Insignia, TablaAdaptable, type Columna } from '@/components/ui-ls'
import type { TonoEstado } from '@/lib/estilo/denso'
import { hace } from '@/lib/correo/fechas'
import type { BuzonVisible } from '@/lib/correo/tipos'

/**
 * EL RESUMEN DEL EQUIPO: UNA FILA POR BUZÓN.
 * ==========================================
 * Para quien supervisa. Dice de cada persona si su correo está conectado y al día, cuántas conversaciones tiene sin leer y cuántas esperan que les conteste
 * (un cliente que escribió y no ha recibido respuesta), quién más lo trabaja (asignaciones, migración 318) y cuándo fue el último correo. Abrir un buzón ajeno es
 * solo lectura (salvo que te lo hayan asignado con respuesta) y queda anotado.
 *
 * TablaAdaptable del kit: tabla en el ordenador y tarjetas en el móvil (sin scroll horizontal). Las fechas salen de lib/correo/fechas.ts (`hace`), la única fuente.
 * Quien lo monta (PanelCorreo) lo refresca cada 30 s con Auto: aquí solo se pinta.
 */

export interface PropsDeVistaEquipo {
  buzones: BuzonVisible[]
  onAbrir: (id: string) => void
  /** OPCIONAL. Primera carga: esqueleto de tabla en vez del estado vacío */
  cargando?: boolean
}

const numero = (n: number) => n.toLocaleString('es-ES')

/** El estado del buzón en una palabra, con su tono (pura; con prueba en equipo.prueba.ts) */
export function estadoDeBuzon(b: Pick<BuzonVisible, 'conectado' | 'credencialesInvalidas' | 'ultimoError' | 'ultimoSyncAt' | 'historicoCompleto'>, ahora: number = Date.now()): { tono: TonoEstado; texto: string; detalle: string | null } {
  if (!b.conectado) return { tono: 'gris', texto: 'Desconectado', detalle: null }
  if (b.credencialesInvalidas) return { tono: 'ambar', texto: 'Contraseña rechazada', detalle: 'El servidor ha rechazado la contraseña: su dueño tiene que volver a escribirla' }
  if (b.ultimoError) return { tono: 'ambar', texto: 'Con un aviso', detalle: b.ultimoError }
  const leido = b.ultimoSyncAt ? `Leído ${hace(b.ultimoSyncAt, ahora)}` : 'Todavía sin leer'
  return { tono: 'verde', texto: b.historicoCompleto ? leido : `${leido} · importando`, detalle: null }
}

/** El estado en una o dos palabras, para la tabla compacta (el texto entero va en el `title`). Pura; con prueba en equipo.prueba.ts */
export function estadoCortoDeBuzon(b: Pick<BuzonVisible, 'conectado' | 'credencialesInvalidas' | 'ultimoError' | 'ultimoSyncAt' | 'historicoCompleto'>): string {
  if (!b.conectado) return 'Desconectado'
  if (b.credencialesInvalidas) return 'Contraseña'
  if (b.ultimoError) return 'Aviso'
  if (!b.ultimoSyncAt) return 'Esperando'
  return b.historicoCompleto ? 'Al día' : 'Importando'
}

/** Por debajo de este ancho del hueco, la tabla compacta: estado corto, sin «Conv.» y el botón solo con el icono */
export const ANCHO_TABLA_COMPLETA = 900
/** Y por debajo de este (un portátil de 1024-1180 px con la barra del ERP abierta), además sin «Equipo» y la persona más estrecha */
export const ANCHO_TABLA_COMPACTA = 720

export type FormaDeTabla = 'completa' | 'compacta' | 'minima'
/** La forma de la tabla según el ancho del hueco (pura). Sin medir aún (0), la completa */
export function formaDeTabla(ancho: number): FormaDeTabla {
  if (ancho <= 0 || ancho >= ANCHO_TABLA_COMPLETA) return 'completa'
  return ancho >= ANCHO_TABLA_COMPACTA ? 'compacta' : 'minima'
}

/** Los nombres de quien lo trabaja (asignaciones), para el grupo de avatares. Para quien no es dueño ni admin llega vacío */
export function quienLoTrabaja(b: Pick<BuzonVisible, 'asignaciones'>): string[] {
  return (b.asignaciones ?? []).map((a) => a.nombre)
}

function Estado({ b, corto }: { b: BuzonVisible; corto: boolean }) {
  const e = estadoDeBuzon(b)
  const Icono = !b.conectado ? Unplug : e.tono === 'ambar' ? AlertCircle : CheckCircle2
  const titulo = [e.texto, e.detalle].filter(Boolean).join(' · ')
  return (
    <span suppressHydrationWarning>
      <Insignia tono={e.tono} icono={Icono} tamano="sm" title={corto || e.detalle ? titulo : undefined}>
        {corto ? estadoCortoDeBuzon(b) : e.texto}
      </Insignia>
    </span>
  )
}

/*
 * Las columnas caben en el hueco de Correo con la barra lateral del ERP abierta (unos 840 px a 1440, 680 a 1280; medido el 16 nov 2026 en el preview
 * con la barra de 16rem). Por debajo de ANCHO_TABLA_COMPLETA (lo mide el contenedor, no la ventana) sale compacta, y por debajo de ANCHO_TABLA_COMPACTA
 * mínima. Siempre: la persona con la dirección recortada (180 o 140 px), cabeceras cortas («Conv.» = conversaciones) y «Sin leer» y «Esperan respuesta» juntas en «Pendiente». En el móvil,
 * tarjetas con el rótulo largo. Las cabeceras son texto (no JSX) para que el módulo se pueda importar en las pruebas.
 */
function columnasDe(forma: FormaDeTabla): Columna<BuzonVisible>[] {
  const compacta = forma !== 'completa'
  const todas: Array<Columna<BuzonVisible> | false> = [
    {
      id: 'persona',
      cabecera: 'Persona',
      movil: 'titulo',
      ordenar: (b) => b.propietario.nombre,
      celda: (b) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar nombre={b.propietario.nombre} tamano={28} />
          <span className={forma === 'minima' ? 'min-w-0 max-w-[140px]' : 'min-w-0 max-w-[180px]'}>
            <span className="block truncate font-medium text-[var(--ls-t1)]">
              {b.propietario.nombre}
              {b.esMio && <span className="ml-1.5 text-[11px] font-normal text-[var(--ls-t4)]">(tú)</span>}
            </span>
            <span className="block truncate text-[11.5px] text-[var(--ls-t4)]" title={b.direccion}>
              {b.direccion}
            </span>
          </span>
        </span>
      ),
    },
    { id: 'estado', cabecera: 'Estado', movil: 'insignia', celda: (b) => <Estado b={b} corto={compacta} /> },
    !compacta && {
      id: 'hilos',
      cabecera: 'Conv.',
      rotuloMovil: 'Conversaciones',
      alinear: 'derecha',
      ordenar: (b) => b.resumen.hilos,
      celda: (b) => <span className="tabular-nums text-[var(--ls-t2)]">{numero(b.resumen.hilos)}</span>,
    },
    {
      id: 'pendiente',
      cabecera: 'Pendiente',
      rotuloMovil: 'Pendiente',
      alinear: 'derecha',
      // Primero lo que espera respuesta (un cliente sin contestar), luego lo sin leer
      ordenar: (b) => b.resumen.esperandoRespuesta * 100000 + b.resumen.hilosSinLeer,
      celda: (b) => <Pendiente b={b} />,
    },
    forma !== 'minima' && {
      id: 'trabajan',
      cabecera: 'Equipo',
      rotuloMovil: 'Lo trabajan',
      celda: (b) => {
        const nombres = quienLoTrabaja(b)
        return nombres.length > 0 ? <GrupoDeAvatares nombres={nombres} max={3} tamano={24} /> : <span className="text-[var(--ls-t4)]">—</span>
      },
    },
    {
      id: 'ultimo',
      cabecera: 'Último',
      rotuloMovil: 'Último correo',
      ordenar: (b) => b.resumen.ultimoMensajeAt ?? '',
      celda: (b) => (
        <span className="whitespace-nowrap text-[var(--ls-t3)]" suppressHydrationWarning>
          {hace(b.resumen.ultimoMensajeAt) || '—'}
        </span>
      ),
    },
  ]
  return todas.filter((c): c is Columna<BuzonVisible> => c !== false)
}

/** «Sin leer» y «Esperan respuesta» en una celda: dos líneas cortas, lo que espera en ámbar */
function Pendiente({ b }: { b: BuzonVisible }) {
  const { hilosSinLeer: sinLeer, esperandoRespuesta: esperan } = b.resumen
  if (sinLeer === 0 && esperan === 0) return <span className="text-[var(--ls-t4)]">—</span>
  return (
    <span className="inline-flex flex-col items-end gap-0.5 whitespace-nowrap text-[12.5px] leading-tight tabular-nums">
      {sinLeer > 0 && <span className="font-semibold text-[var(--ls-t1)]">{numero(sinLeer)} sin leer</span>}
      {esperan > 0 && (
        <span className="inline-flex items-center gap-1 font-semibold text-[var(--ls-e-ambar)]">
          <Clock className="h-3 w-3" aria-hidden />
          {numero(esperan)} {esperan === 1 ? 'espera' : 'esperan'}
        </span>
      )}
    </span>
  )
}

export function VistaEquipo({ buzones, onAbrir, cargando }: PropsDeVistaEquipo) {
  // El ancho del HUECO (no de la ventana): depende de si la barra lateral del ERP está abierta y de la barra de buzones
  const caja = useRef<HTMLDivElement | null>(null)
  const [forma, setForma] = useState<FormaDeTabla>('completa')
  useEffect(() => {
    const el = caja.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const medir = () => setForma(formaDeTabla(el.clientWidth))
    medir()
    const o = new ResizeObserver(medir)
    o.observe(el)
    return () => o.disconnect()
  }, [])
  const columnas = useMemo(() => columnasDe(forma), [forma])
  const compacta = forma !== 'completa'

  return (
    <div ref={caja} className="min-h-0 flex-1 overflow-y-auto">
      <TablaAdaptable
        etiqueta="Resumen del equipo"
        columnas={columnas}
        filas={buzones}
        claveDe={(b) => b.id}
        alPulsarFila={(b) => onAbrir(b.id)}
        porPagina={0}
        cargando={cargando}
        vacio={{
          icono: Users,
          titulo: 'Todavía nadie ha conectado su correo',
          descripcion: 'Cada persona lo conecta desde esta misma pantalla con la contraseña de su buzón. En cuanto lo haga aparecerá aquí.',
        }}
        acciones={(b) => {
          const texto = b.esMio || b.puedeResponder ? 'Abrir' : 'Mirar'
          return (
            <Boton tamano="sm" icono={Eye} soloIcono={compacta} onClick={() => onAbrir(b.id)} title={compacta ? texto : undefined} aria-label={`${texto} el buzón ${b.direccion}`}>
              {compacta ? null : texto}
            </Boton>
          )
        }}
      />
    </div>
  )
}
