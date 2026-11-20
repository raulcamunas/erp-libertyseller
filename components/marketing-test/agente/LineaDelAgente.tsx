'use client'

import { useMemo, useState } from 'react'
import { Ban, Bot, Brain, CalendarClock, CircleDollarSign, FlaskConical, History, OctagonX, PackageX, Pause, PenLine, Play, Power, Sprout, Target, TrendingDown, TrendingUp, Undo2, type LucideIcon } from 'lucide-react'
import { Boton, Confirmacion, EstadoVacio, Insignia, LineaDeTiempo, Segmentado, Tarjeta, type Hito } from '@/components/ui-ls'
import type { TonoEstado } from '@/lib/estilo/denso'
import type { ClaseDeCambio, EventoDeLinea, Veredicto } from '@/lib/ads/agente/tipos'
import { NOMBRE_DE_CLASE, type Accion } from './TarjetaDeEstado'

const ICONO_DE_CLASE: Record<ClaseDeCambio, LucideIcon> = {
  negativizar: Ban,
  promover: Sprout,
  puja_subir: TrendingUp,
  puja_bajar: TrendingDown,
  puja_bajar_sin_pedidos: TrendingDown,
  pausar: Pause,
  presupuesto_subir: CircleDollarSign,
  presupuesto_bajar: CircleDollarSign,
  pausar_campana: PackageX,
}

/** Icono de los eventos (el `estado` de una fila de tipo «evento» es el tipo de evento) */
const ICONO_DE_EVENTO: Record<string, LucideIcon> = {
  encendido: Power,
  apagado: Power,
  ensayo_saltado: Play,
  ensayo_fin: FlaskConical,
  veda: CalendarClock,
  temporada: CalendarClock,
  freno: OctagonX,
  reanudado: Play,
  reanudar_rechazado: OctagonX,
  deshacer_freno: Undo2,
  deshacer_auto: Undo2,
  deshacer_fallo: Undo2,
  postura: Target,
  objetivo_auto: Target,
  objetivo_revisado: Target,
  techo_auto: CircleDollarSign,
  ritmo: CircleDollarSign,
  mover_presupuesto: CircleDollarSign,
  agotada_top: CircleDollarSign,
  calibracion: Brain,
  ia_fallo: Brain,
  ia_tope: Brain,
  stock: PackageX,
  stock_vuelve: PackageX,
  stock_fallo: PackageX,
  primera_escritura: PenLine,
}

const TONO_DE_EVENTO: Record<string, TonoEstado> = {
  freno: 'rojo',
  reanudar_rechazado: 'rojo',
  stock_fallo: 'rojo',
  deshacer_fallo: 'rojo',
  ia_fallo: 'ambar',
  ia_tope: 'ambar',
  uso_error: 'ambar',
  datos_viejos: 'ambar',
  vigilar_falla: 'ambar',
  sin_autorizacion: 'rojo',
  stock: 'ambar',
  veda: 'ambar',
  temporada: 'ambar',
  agotada_top: 'ambar',
  parada_general: 'rojo',
  encendido: 'verde',
  reanudado: 'verde',
  ensayo_fin: 'verde',
  primera_escritura: 'verde',
  stock_vuelve: 'verde',
  deshacer_auto: 'violeta',
  deshacer_freno: 'violeta',
}

const ESTADO_DE_CAMBIO: Record<string, { texto: string; tono: TonoEstado }> = {
  aplicada: { texto: 'Aplicada', tono: 'verde' },
  ensayada: { texto: 'Ensayada', tono: 'cian' },
  deshecha: { texto: 'Deshecha', tono: 'gris' },
  error: { texto: 'Error', tono: 'rojo' },
  obsoleta: { texto: 'Obsoleta', tono: 'gris' },
  descartada: { texto: 'Descartada', tono: 'gris' },
  pendiente: { texto: 'Pendiente', tono: 'ambar' },
}

const VEREDICTO: Record<Veredicto, { texto: string; tono: TonoEstado; title: string }> = {
  mejoro: { texto: 'Mejoró', tono: 'verde', title: 'Medido 14 días después frente a los 14 de antes, contra un grupo de control' },
  empeoro: { texto: 'Empeoró', tono: 'rojo', title: 'Medido 14 días después frente a los 14 de antes, contra un grupo de control' },
  neutro: { texto: 'Neutro', tono: 'gris', title: 'Ni mejor ni peor de forma clara' },
  sin_muestra: { texto: 'Sin muestra', tono: 'gris', title: 'Pocos clics (o un evento de temporada en medio) para juzgarlo' },
  mezclado: { texto: 'Mezclado', tono: 'violeta', title: 'Hubo otro cambio en lo mismo a la vez: no se le puede atribuir el resultado' },
}

type Filtro = 'todo' | 'cambios' | 'eventos'

/**
 * LO QUE HA HECHO EL AGENTE, en orden: cada cambio (con su clase, si fue ensayo, su veredicto cuando se mide y si se deshizo solo) y cada evento (encendido, freno, ensayo terminado…).
 * Los cambios aplicados se pueden deshacer desde aquí, con confirmación.
 */
export function LineaDelAgente({ linea, accion }: { linea: readonly EventoDeLinea[]; accion: Accion }) {
  const [filtro, setFiltro] = useState<Filtro>('todo')
  const [deshacer, setDeshacer] = useState<EventoDeLinea | null>(null)

  const cambios = linea.filter((e) => e.tipo === 'cambio').length
  const vistos = useMemo(() => linea.filter((e) => filtro === 'todo' || (filtro === 'cambios' ? e.tipo === 'cambio' : e.tipo === 'evento')), [linea, filtro])

  const hitos: Hito[] = vistos.map((e) => {
    const esCambio = e.tipo === 'cambio'
    const estado = esCambio ? (ESTADO_DE_CAMBIO[e.estado] ?? { texto: e.estado, tono: 'gris' as TonoEstado }) : null
    const tono: TonoEstado = esCambio ? (e.deshechoAuto ? 'violeta' : (estado?.tono ?? 'gris')) : (TONO_DE_EVENTO[e.estado] ?? 'azul')
    const icono = esCambio ? (e.clase ? ICONO_DE_CLASE[e.clase] : Bot) : (ICONO_DE_EVENTO[e.estado] ?? History)
    const marcas = esCambio && (estado || e.ensayo || e.veredicto || e.deshechoAuto || e.clase)
    return {
      id: e.id,
      cuando: e.at,
      tono,
      icono,
      titulo: e.titulo,
      descripcion:
        e.detalle || marcas || e.deshacible ? (
          <div className="flex flex-col gap-2">
            {e.detalle && <p className="break-words">{e.detalle}</p>}
            {marcas && (
              <div className="flex flex-wrap items-center gap-1">
                {e.clase && (
                  <Insignia tono="gris" tamano="sm" variante="contorno">
                    {NOMBRE_DE_CLASE[e.clase]}
                  </Insignia>
                )}
                {estado && !e.ensayo && (
                  <Insignia tono={estado.tono} tamano="sm">
                    {estado.texto}
                  </Insignia>
                )}
                {e.ensayo && (
                  <Insignia tono="cian" tamano="sm" icono={FlaskConical} title="En ensayo no se escribe en Amazon: es lo que habría hecho">
                    ensayo
                  </Insignia>
                )}
                {e.veredicto && (
                  <Insignia tono={VEREDICTO[e.veredicto].tono} tamano="sm" title={VEREDICTO[e.veredicto].title}>
                    {VEREDICTO[e.veredicto].texto}
                  </Insignia>
                )}
                {e.deshechoAuto && (
                  <Insignia tono="violeta" tamano="sm" icono={Undo2} title="El agente lo midió, empeoraba y lo deshizo solo">
                    deshecho solo
                  </Insignia>
                )}
              </div>
            )}
            {e.deshacible && e.propuestaId && (
              <div>
                <Boton variante="secundario" tamano="sm" icono={Undo2} onClick={() => setDeshacer(e)}>
                  Deshacer
                </Boton>
              </div>
            )}
          </div>
        ) : undefined,
    }
  })

  return (
    <Tarjeta
      acento="marketing"
      icono={History}
      titulo="Lo que ha hecho"
      subtitulo="Cambios y eventos del agente, lo último primero."
    >
      <div className="mb-4">
        <Segmentado
          etiqueta="Qué enseñar"
          tamano="sm"
          opciones={[
            { id: 'todo', texto: 'Todo', cuenta: linea.length },
            { id: 'cambios', texto: 'Cambios', cuenta: cambios },
            { id: 'eventos', texto: 'Eventos', cuenta: linea.length - cambios },
          ]}
          valor={filtro}
          onCambio={(v) => setFiltro(v as Filtro)}
        />
      </div>
      {hitos.length === 0 ? (
        <EstadoVacio compacto icono={History} titulo={filtro === 'todo' ? 'Todavía no ha hecho nada' : filtro === 'cambios' ? 'Ningún cambio todavía' : 'Ningún evento todavía'} descripcion="Cuando el agente vigile, ensaye o aplique algo, sale aquí con su motivo." />
      ) : (
        <LineaDeTiempo eventos={hitos} maximo={60} />
      )}

      <Confirmacion
        abierto={deshacer !== null}
        onCambio={(a) => !a && setDeshacer(null)}
        titulo="¿Deshacer este cambio en Amazon?"
        descripcion={deshacer ? `${deshacer.titulo}. Se vuelve al valor de antes (si nadie lo ha cambiado desde entonces) y queda en el log.` : undefined}
        palabra={null}
        tono="normal"
        textoConfirmar="Deshacer"
        onConfirmar={async () => {
          if (!deshacer?.propuestaId) return
          await accion('POST', { accion: 'deshacer', id: deshacer.propuestaId }, { exito: 'Deshecho en Amazon.' })
          setDeshacer(null)
        }}
      />
    </Tarjeta>
  )
}
