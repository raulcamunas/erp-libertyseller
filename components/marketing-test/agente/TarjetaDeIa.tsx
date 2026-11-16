'use client'

import { useState } from 'react'
import { Brain, CheckCircle2, CircleAlert, Sparkles } from 'lucide-react'
import { BarraDeProgreso, Boton, Confirmacion, haceCuanto, Insignia, TablaAdaptable, Tarjeta, type Columna } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { AGENTE, type ClaseDeCambio, type PanelDelAgente } from '@/lib/ads/agente/tipos'
import { Aviso, NOMBRE_DE_CLASE, type Accion } from './TarjetaDeEstado'

type FilaDeVeredictos = { clase: ClaseDeCambio; mejoro: number; empeoro: number; neutro: number; sinMuestra: number; mezclado: number }

const usd = (n: number) => `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`

/**
 * LA IA DEL AGENTE: cuánto lleva gastado este mes frente a su tope, su último informe, si sus etiquetas de términos ya están validadas por personas (hasta entonces no negativiza sola)
 * y los resultados medidos de los cambios por clase. Un administrador puede pedirle que piense ya.
 */
export function TarjetaDeIa({ panel, accion }: { panel: PanelDelAgente; accion: Accion }) {
  const [pensar, setPensar] = useState(false)
  const ia = panel.ia
  const v = ia.validacion
  const acuerdo = v.resueltas > 0 ? Math.round((v.deAcuerdo / v.resueltas) * 100) : null
  const estado = panel.config?.estado ?? 'apagado'
  const pidiendo = panel.config?.pensarYa === true

  const filas: FilaDeVeredictos[] = (Object.entries(panel.veredictosPorClase) as Array<[ClaseDeCambio, Omit<FilaDeVeredictos, 'clase'> | undefined]>)
    .filter((e): e is [ClaseDeCambio, Omit<FilaDeVeredictos, 'clase'>] => e[1] != null)
    .map(([clase, r]) => ({ clase, ...r }))

  const columnas: Columna<FilaDeVeredictos>[] = [
    { id: 'clase', cabecera: 'Clase de cambio', movil: 'titulo', ordenar: (f) => NOMBRE_DE_CLASE[f.clase], celda: (f) => NOMBRE_DE_CLASE[f.clase] },
    { id: 'mejoro', cabecera: 'Mejoró', alinear: 'derecha', ordenar: (f) => f.mejoro, celda: (f) => <span className="tabular-nums" style={{ color: f.mejoro ? COLOR_ESTADO.verde : undefined }}>{f.mejoro}</span> },
    { id: 'empeoro', cabecera: 'Empeoró', alinear: 'derecha', ordenar: (f) => f.empeoro, celda: (f) => <span className="tabular-nums" style={{ color: f.empeoro ? COLOR_ESTADO.rojo : undefined }}>{f.empeoro}</span> },
    { id: 'neutro', cabecera: 'Neutro', alinear: 'derecha', ordenar: (f) => f.neutro, celda: (f) => <span className="tabular-nums">{f.neutro}</span> },
    { id: 'mezclado', cabecera: 'Mezclado', alinear: 'derecha', ordenar: (f) => f.mezclado, celda: (f) => <span className="tabular-nums" title="Otro cambio en lo mismo a la vez: no cuenta">{f.mezclado}</span> },
    { id: 'sinMuestra', cabecera: 'Sin muestra', alinear: 'derecha', ordenar: (f) => f.sinMuestra, celda: (f) => <span className="tabular-nums">{f.sinMuestra}</span> },
  ]

  return (
    <Tarjeta
      acento="marketing"
      icono={Brain}
      titulo="Cerebro con IA"
      subtitulo="Clasifica términos, da una postura por producto y escribe el informe. Las cifras las ponen las reglas."
      acciones={
        panel.esAdmin && estado !== 'apagado' && estado !== 'frenado' ? (
          <Boton variante="secundario" tamano="sm" icono={Sparkles} disabled={pidiendo} title={pidiendo ? 'Ya pedido: lo hace el proceso de fondo en 5 minutos como mucho' : 'Que piense ahora en vez de esperar a las 8:00 o las 15:00'} onClick={() => setPensar(true)}>
            {pidiendo ? 'Pedido' : 'Pensar ahora'}
          </Boton>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <BarraDeProgreso valor={ia.costeMesUsd} maximo={ia.topeUsd > 0 ? ia.topeUsd : 1} etiqueta="Gasto en IA este mes" detalle={`${usd(ia.costeMesUsd)} de ${usd(ia.topeUsd)}`} umbrales={{ ambar: 0.8, rojo: 1 }} acento="marketing" />
          <p className="mt-[6px] text-[12px] text-[var(--ls-t3)]">
            {ia.llamadasMes.toLocaleString('es-ES')} {ia.llamadasMes === 1 ? 'llamada' : 'llamadas'} este mes{ia.ultimaAt ? ` · la última ${haceCuanto(ia.ultimaAt)}` : ''}. Al llegar al tope deja de llamar y siguen solo las reglas.
          </p>
          {ia.ultimoError && <p className="mt-1 text-[12px]" style={{ color: COLOR_ESTADO.rojo }}>Último fallo: {ia.ultimoError}</p>}
        </div>

        {/* ---- validación de las etiquetas: hasta que no esté, la IA no negativiza sola ---- */}
        <Aviso
          tono={v.ok ? 'verde' : 'ambar'}
          icono={v.ok ? CheckCircle2 : CircleAlert}
          titulo={v.ok ? 'Sus etiquetas de términos están validadas: ya puede negativizar sola' : 'Sus etiquetas de términos aún no están validadas: no negativiza sola'}
        >
          <p>
            {v.resueltas.toLocaleString('es-ES')} de {AGENTE.IA_VALIDACION_MUESTRA} revisadas por una persona{acuerdo != null ? `; acuerdo ${acuerdo} %` : ''}. Hacen falta {AGENTE.IA_VALIDACION_MUESTRA} y un acuerdo del {Math.round(AGENTE.IA_VALIDACION_ACUERDO * 100)} % o más.
            {!v.ok && ' Mientras, retiene las que marcaría y las verás en Propuestas: revisarlas le enseña.'}
          </p>
        </Aviso>

        {/* ---- el último informe ---- */}
        <div className="rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--ls-t4)]">Último informe</div>
          {ia.ultimoInforme ? (
            <div className="mt-1 text-[13px] leading-[1.5] text-[var(--ls-t2)]">
              <p className="font-semibold text-[var(--ls-t1)]">{ia.ultimoInforme.titular}</p>
              {ia.ultimoInforme.puntos.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {ia.ultimoInforme.puntos.map((p, i) => (
                    <li key={i} className="break-words">
                      {p}
                    </li>
                  ))}
                </ul>
              )}
              {ia.ultimoInforme.necesitaPersona.length > 0 && (
                <div className="mt-2">
                  <Insignia tono="ambar" tamano="sm">
                    Necesita a una persona
                  </Insignia>
                  <ul className="mt-1 list-disc pl-5">
                    {ia.ultimoInforme.necesitaPersona.map((p, i) => (
                      <li key={i} className="break-words">
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-1 text-[12.5px] text-[var(--ls-t3)]">Todavía no ha escrito ninguno. Piensa a las 8:00 (y a las 15:00 si hay algo raro pendiente).</p>
          )}
        </div>

        {/* ---- resultados medidos ---- */}
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--ls-t4)]">Resultados medidos (60 días)</div>
          <TablaAdaptable
            etiqueta="Resultados de los cambios por clase"
            columnas={columnas}
            filas={filas}
            claveDe={(f) => f.clase}
            porPagina={0}
            vacio={{ icono: Brain, titulo: 'Nada medido todavía', descripcion: 'Cada cambio se mide 14 días después (con una lectura provisional a los 7).' }}
          />
        </div>
      </div>

      <Confirmacion
        abierto={pensar}
        onCambio={setPensar}
        titulo="¿Que el agente piense ahora?"
        descripcion={`Lo hace el proceso de fondo en 5 minutos como mucho. Cuenta para el tope de IA del mes (${usd(ia.topeUsd)}).`}
        palabra={null}
        tono="normal"
        textoConfirmar="Pensar ahora"
        onConfirmar={() => accion('POST', { accion: 'pensar-ahora' }, { exito: 'Pedido: el agente pensará en 5 minutos como mucho.' })}
      />
    </Tarjeta>
  )
}
