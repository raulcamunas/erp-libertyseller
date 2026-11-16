'use client'

import { ArrowDown, ArrowUp, Gauge, TriangleAlert } from 'lucide-react'
import { BarraDeProgreso, FilaDeKpis, Insignia, Kpi, TablaAdaptable, Tarjeta, type Columna } from '@/components/ui-ls'
import type { TonoEstado } from '@/lib/estilo/denso'
import { AGENTE, type PanelDelAgente, type RitmoDelMes } from '@/lib/ads/agente/tipos'
import { dinero } from '../formato'
import { Aviso, pct } from './TarjetaDeEstado'

type Campana = PanelDelAgente['ritmo']['hoy']['campanas'][number]

const RITMO: Record<RitmoDelMes, { texto: string; tono: TonoEstado; que: string }> = {
  recorte: { texto: 'Recorte', tono: 'rojo', que: 'el mes va por encima del techo: no sube nada y baja pujas primero' },
  normal: { texto: 'Normal', tono: 'gris', que: 'dentro del techo' },
  crecer: { texto: 'Crecer', tono: 'verde', que: 'hay hueco en el techo y la cuenta rinde: sube algo más lo que funciona' },
}

/** «13:40» tal cual; si llega un instante ISO, su hora en Madrid */
const horaDe = (v: string | null): string | null => {
  if (!v) return null
  if (/^\d{1,2}:\d{2}/.test(v)) return v.slice(0, 5)
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }) : v
}

/**
 * EL RITMO DE GASTO: lo que lleva gastado hoy (estimado con el uso de presupuesto de Amazon), lo máximo que podría gastar hoy, la media de 7 días y la proyección del mes contra el techo; y,
 * por campaña, el uso del presupuesto, a qué hora se agotó y la presión de hoy en las pujas (↑ subir, ↓ bajar).
 */
export function TarjetaDeRitmo({ panel, moneda }: { panel: PanelDelAgente; moneda: string | null }) {
  const { hoy, mes, usoDisponible, usoError } = panel.ritmo
  const euros = (n: number) => dinero(n, moneda, 0)
  const ritmo = RITMO[mes.ritmo]
  const leido = horaDe(hoy.leidoAt)

  const columnas: Columna<Campana>[] = [
    { id: 'nombre', cabecera: 'Campaña', movil: 'titulo', ordenar: (c) => c.nombre, celda: (c) => <span className="block truncate" title={c.nombre}>{c.nombre}</span> },
    { id: 'presupuesto', cabecera: 'Presupuesto', alinear: 'derecha', rotuloMovil: 'Presupuesto diario', ordenar: (c) => c.presupuesto ?? -1, celda: (c) => <span className="tabular-nums">{dinero(c.presupuesto, moneda)}</span> },
    {
      id: 'uso',
      cabecera: 'Uso hoy',
      ancho: '180px',
      rotuloMovil: 'Uso del presupuesto',
      ordenar: (c) => c.usoPct ?? -1,
      celda: (c) =>
        c.usoPct == null ? (
          <span className="text-[var(--ls-t4)]">—</span>
        ) : (
          <BarraDeProgreso tamano="sm" valor={Math.min(c.usoPct, 125)} maximo={100} umbrales={{ ambar: 0.8, rojo: AGENTE.USO_AGOTADO_PCT / 100 }} detalle={pct(c.usoPct, 0)} />
        ),
    },
    {
      id: 'agotada',
      cabecera: 'Agotada',
      movil: 'insignia',
      ordenar: (c) => c.agotadaA ?? '',
      celda: (c) =>
        c.agotadaA ? (
          <Insignia tono="ambar" tamano="sm">
            agotada a las {horaDe(c.agotadaA)}
          </Insignia>
        ) : (
          <span className="text-[var(--ls-t4)] max-lg:hidden">—</span>
        ),
    },
    {
      id: 'presion',
      cabecera: 'Pujas hoy',
      alinear: 'centro',
      rotuloMovil: 'Presión de hoy',
      ordenar: (c) => c.presion ?? '',
      celda: (c) =>
        c.presion === 'subir' ? (
          <Insignia tono="verde" tamano="sm" icono={ArrowUp} title="Gasta poco con buen ACoS: hoy las reglas suben pujas con algo más de facilidad">
            subir
          </Insignia>
        ) : c.presion === 'bajar' ? (
          <Insignia tono="rojo" tamano="sm" icono={ArrowDown} title="Se agota con ACoS malo (o el mes va en recorte): hoy las reglas bajan pujas antes">
            bajar
          </Insignia>
        ) : (
          <span className="text-[var(--ls-t4)]">—</span>
        ),
    },
  ]

  return (
    <Tarjeta acento="marketing" icono={Gauge} titulo="Ritmo de gasto" subtitulo={leido ? `Gasto de hoy estimado con el uso de presupuesto de Amazon · leído a las ${leido}` : 'Gasto de hoy estimado con el uso de presupuesto de Amazon'}>
      {!usoDisponible && (
        <div className="mb-3">
          <Aviso tono="ambar" icono={TriangleAlert} titulo="Amazon no da el uso de presupuesto de esta cuenta ahora mismo">
            <p>Se sabe qué campañas se han quedado sin presupuesto (por su estado), pero no a qué hora ni cuánto llevan; mientras, el agente no sube ni baja presupuestos solo. Se vuelve a intentar cada {AGENTE.USO_REINTENTO_HORAS} h.</p>
            {usoError && <p className="text-[var(--ls-t4)]">Último error: {usoError}</p>}
          </Aviso>
        </div>
      )}

      <FilaDeKpis minimo={150}>
        <Kpi etiqueta="Gasto de hoy" valor={hoy.gastoEstimado} formato={euros} acento="marketing" indice={0} nota={hoy.proyeccion != null ? `estimado · va a ${euros(hoy.proyeccion)} al final del día` : 'estimado'} />
        <Kpi etiqueta="Máximo posible hoy" valor={hoy.maximoPosible} formato={euros} indice={1} nota={`presupuestos activos × ${AGENTE.EXCESO_DIARIO_AMAZON.toLocaleString('es-ES')} (Amazon deja pasarse un 25 %)`} />
        <Kpi etiqueta="Media 7 días" valor={hoy.mediaDiaria7} formato={euros} indice={2} nota="días cerrados" />
        <Kpi etiqueta="Proyección del mes" valor={mes.proyeccion} formato={euros} indice={3} nota={mes.techo != null ? `techo ${euros(mes.techo)}` : 'sin techo'} />
      </FilaDeKpis>

      <div className="mt-4 rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-3">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--ls-t2)]">
          <span className="font-semibold text-[var(--ls-t1)]">Ritmo del mes</span>
          <Insignia tono={ritmo.tono} tamano="sm">
            {ritmo.texto}
          </Insignia>
          <span className="text-[var(--ls-t3)]">{mes.motivo || ritmo.que}</span>
        </div>
        {mes.techo != null && mes.techo > 0 ? (
          <>
            <BarraDeProgreso valor={mes.gastoMes} maximo={mes.techo} etiqueta="Gastado este mes" detalle={`${euros(mes.gastoMes)} de ${euros(mes.techo)}`} umbrales={{ ambar: 0.85, rojo: 1 }} acento="marketing" />
            <p className="mt-[6px] text-[12px] text-[var(--ls-t3)]">
              {mes.proyeccion != null ? `Proyección a fin de mes: ${euros(mes.proyeccion)} · ` : ''}quedan {mes.diasRestantes} {mes.diasRestantes === 1 ? 'día' : 'días'} (con hoy)
            </p>
          </>
        ) : (
          <p className="text-[12.5px] text-[var(--ls-t3)]">Gastado este mes: {euros(mes.gastoMes)}. Sin techo de gasto, el agente no sube nada.</p>
        )}
      </div>

      <TablaAdaptable
        className="mt-4"
        etiqueta="Uso del presupuesto por campaña"
        columnas={columnas}
        filas={hoy.campanas}
        claveDe={(c) => c.campaignId}
        ordenInicial={{ id: 'uso', sentido: 'desc' }}
        porPagina={10}
        vacio={{ icono: Gauge, titulo: 'Sin lecturas de hoy', descripcion: 'El agente lee el uso de presupuesto cada 30 minutos cuando está encendido.' }}
      />
    </Tarjeta>
  )
}
