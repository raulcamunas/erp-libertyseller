'use client'

import { CalendarRange } from 'lucide-react'
import { EstadoVacio, Esqueleto, Tarjeta } from '@/components/ui-ls'
import type { ResumenGlobal } from '@/lib/fba/plan-tipos'
import { GraficoBarrasApiladas } from '../comun/graficos'
import { entero } from '../formato'
import { etiquetaSemana, seriesDeSalidas } from './useResumen'

/**
 * SALIDAS PREVISTAS POR SEMANA (spec remesas-pro §1.5 y §6.3).
 *
 * Unidades de los envíos propuestos activos por semana ISO (8 semanas desde la actual) y por cliente, apiladas. Un color
 * estable por cliente (`tonoEstable` del nombre) y, con más de 6 clientes, los 5 mayores y «Otros». En el escritorio son
 * columnas; en el móvil, barras horizontales con la semana en el eje Y (lo decide GraficoBarrasApiladas por CSS).
 * Lo que ya tenía que haber salido cuenta en la semana actual (lo hace el servidor).
 *
 * API
 *   <GraficoSalidasSemana salidas nombres hoy cargando? sinMigracion? onVerPlan />
 */

export interface GraficoSalidasSemanaProps {
  salidas: ResumenGlobal['salidasPorSemana'] | null
  /** id del cliente → nombre */
  nombres: Record<string, string>
  hoy: string
  cargando?: boolean
  /** Falta la migración 316: no hay envíos propuestos guardados y por eso no hay salidas */
  sinMigracion?: boolean
  onVerPlan: () => void
}

const ALTOS_ESQUELETO = [60, 85, 40, 70, 30, 55, 20, 45]

export function GraficoSalidasSemana({ salidas, nombres, hoy, cargando, sinMigracion, onVerPlan }: GraficoSalidasSemanaProps) {
  const { datos, series, total } = seriesDeSalidas(salidas ?? [], nombres)
  const semanasConAlgo = datos.filter((d) => series.some((s) => Number(d[s.clave]) > 0)).length
  const vacio = !cargando && total === 0

  return (
    <Tarjeta
      acento="remesas"
      icono={CalendarRange}
      titulo="Salidas previstas"
      subtitulo={
        cargando ? 'Cargando…' : vacio ? 'Próximas 8 semanas' : `${entero(total)} ud en ${semanasConAlgo} de 8 semanas · por cliente`
      }
      className="h-full"
    >
      {cargando && !salidas ? (
        <div className="flex h-[220px] items-end gap-3 lg:h-[280px]" aria-hidden>
          {ALTOS_ESQUELETO.map((h, i) => (
            <div key={i} className="flex-1" style={{ height: `${h}%` }}>
              <Esqueleto className="h-full w-full" />
            </div>
          ))}
        </div>
      ) : vacio ? (
        <EstadoVacio
          compacto
          acento="remesas"
          icono={CalendarRange}
          titulo={sinMigracion ? 'Aún no hay envíos propuestos guardados' : 'Nada que enviar en 8 semanas'}
          descripcion={
            sinMigracion
              ? 'Falta lanzar la migración 316: el plan se calcula pero no se guarda, así que no hay salidas que pintar.'
              : 'Ningún envío propuesto activo sale en las próximas 8 semanas. Mira el plan por si hay algo «más adelante».'
          }
          accion={{ texto: 'Ver el plan', onClick: onVerPlan }}
        />
      ) : (
        <GraficoBarrasApiladas
          datos={datos}
          claveX="semana"
          series={series.map((s) => ({ clave: s.clave, nombre: s.nombre, color: s.color }))}
          formatoX={(v) => etiquetaSemana(String(v), hoy)}
          unidad="ud"
          etiqueta={`Unidades que tienen que salir hacia Amazon por semana y cliente, próximas 8 semanas: ${entero(total)} ud en total`}
        />
      )}
    </Tarjeta>
  )
}
