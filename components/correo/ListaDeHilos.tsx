'use client'

import { Clock, Inbox, Loader2, Paperclip, Search, Send, Star, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { ChipDeFiltro, Esqueleto } from '@/components/rendimiento/ui'
import { fechaDeLista } from '@/lib/correo/formato'
import type { HiloDeLista, ResumenDeBuzon, VistaDeCorreo } from '@/lib/correo/tipos'
import { BOTON_SECUNDARIO, Etiqueta } from './ui'

/**
 * LA LISTA DE HILOS DE UN BUZÓN: buscador, filtros y una fila por conversación.
 *
 * Una fila es un HILO, no un correo: «Ana López (4) · Propuesta de Amazon» agrupa los cuatro mensajes. En negrita y con
 * un punto naranja lo que tiene algo sin leer; con un reloj ámbar, lo que espera que le contestemos.
 */

const FILTROS: Array<{ id: VistaDeCorreo; nombre: string; icono: ReactNode; ayuda: string }> = [
  { id: 'todos', nombre: 'Todos', icono: null, ayuda: 'Todas las conversaciones' },
  { id: 'recibidos', nombre: 'Recibidos', icono: <Inbox className="h-3 w-3" aria-hidden />, ayuda: 'Conversaciones en las que te han escrito' },
  { id: 'enviados', nombre: 'Enviados', icono: <Send className="h-3 w-3" aria-hidden />, ayuda: 'Conversaciones en las que has escrito tú' },
  { id: 'destacados', nombre: 'Destacados', icono: <Star className="h-3 w-3" aria-hidden />, ayuda: 'Las que has marcado con una estrella' },
  { id: 'pendientes', nombre: 'Pendientes', icono: <Clock className="h-3 w-3" aria-hidden />, ayuda: 'El último mensaje lo ha escrito una persona del otro lado y está sin contestar' },
]

interface Props {
  hilos: HiloDeLista[]
  cargando: boolean
  cargandoMas: boolean
  hayMas: boolean
  onMas: () => void
  seleccionado: string | null
  onElegir: (id: string) => void
  vista: VistaDeCorreo
  onVista: (v: VistaDeCorreo) => void
  soloNoLeidos: boolean
  onSoloNoLeidos: (v: boolean) => void
  busqueda: string
  onBusqueda: (texto: string) => void
  resumen: ResumenDeBuzon
  /** Se está trayendo el histórico: cuántos mensajes faltan */
  importando: { quedan: number } | null
  error: string | null
}

const numero = (n: number) => n.toLocaleString('es-ES')

export function ListaDeHilos({ hilos, cargando, cargandoMas, hayMas, onMas, seleccionado, onElegir, vista, onVista, soloNoLeidos, onSoloNoLeidos, busqueda, onBusqueda, resumen, importando, error }: Props) {
  const buscando = busqueda.trim().length >= 2

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-[var(--ls-linea)] p-2">
        <label className="relative block">
          <span className="sr-only">Buscar en el correo</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ls-t4)]" aria-hidden />
          <input
            type="search"
            value={busqueda}
            onChange={(e) => onBusqueda(e.target.value)}
            placeholder="Buscar por persona, asunto o texto"
            className="h-8 w-full rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] pl-8 pr-8 text-[12.5px] text-[var(--ls-t1)] outline-none transition-colors placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)] [&::-webkit-search-cancel-button]:hidden"
          />
          {busqueda && (
            <button type="button" onClick={() => onBusqueda('')} aria-label="Borrar la búsqueda" className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[4px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </label>

        {!buscando && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar conversaciones">
            {FILTROS.map((f) => (
              <ChipDeFiltro key={f.id} activo={vista === f.id} onClick={() => onVista(f.id)} ayuda={f.ayuda}>
                {f.icono}
                {f.nombre}
                {f.id === 'recibidos' && resumen.hilosSinLeer > 0 && <span className="rounded-full bg-[var(--ls-acc-graf)] px-1.5 text-[10px] font-semibold leading-[15px] text-[var(--ls-acc-tinta)]">{resumen.hilosSinLeer}</span>}
                {f.id === 'pendientes' && resumen.esperandoRespuesta > 0 && <span className="text-[10.5px] tabular-nums text-[var(--ls-t4)]">{resumen.esperandoRespuesta}</span>}
              </ChipDeFiltro>
            ))}
            <ChipDeFiltro activo={soloNoLeidos} onClick={() => onSoloNoLeidos(!soloNoLeidos)} ayuda="Enseñar solo lo que tiene mensajes sin leer">
              Sin leer
            </ChipDeFiltro>
          </div>
        )}
      </div>

      {importando && (
        <p className="flex items-center gap-1.5 border-b border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-1.5 text-[11.5px] text-[var(--ls-t3)]" role="status">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Trayendo tus correos antiguos… faltan {numero(importando.quedan)}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p className="p-4 text-[12.5px] text-[var(--ls-e-ambar)]" role="alert">
            {error}
          </p>
        ) : cargando ? (
          <div className="space-y-px" aria-busy="true" aria-label="Cargando las conversaciones">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="space-y-1.5 border-b border-[var(--ls-linea)] px-3 py-3">
                <Esqueleto className="h-3 w-2/5" />
                <Esqueleto className="h-3 w-4/5" />
                <Esqueleto className="h-2.5 w-3/5" />
              </div>
            ))}
          </div>
        ) : hilos.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-[13px] font-medium text-[var(--ls-t2)]">{buscando ? 'No hay nada que encaje con esa búsqueda' : soloNoLeidos ? 'No tienes nada sin leer' : vista === 'pendientes' ? 'No hay nada esperando respuesta' : 'No hay conversaciones aquí'}</p>
            <p className="mx-auto mt-1 max-w-[260px] text-[12px] leading-relaxed text-[var(--ls-t4)]">
              {importando ? 'Se están trayendo los correos antiguos; irán saliendo según lleguen.' : buscando ? 'Prueba con otra palabra o con un trozo de la dirección.' : 'Cuando llegue o envíes un correo aparecerá aquí.'}
            </p>
          </div>
        ) : (
          <ul>
            {hilos.map((h) => {
              const sinLeer = h.noLeidos > 0
              const elegido = seleccionado === h.id
              return (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => onElegir(h.id)}
                    aria-current={elegido ? 'true' : undefined}
                    className={`flex w-full gap-2 border-b border-[var(--ls-linea)] px-3 py-2.5 text-left transition-colors ${elegido ? 'bg-[var(--ls-sel)]' : 'hover:bg-[var(--ls-sup2)]'}`}
                  >
                    <span className="mt-1.5 flex w-2 shrink-0 justify-center" aria-hidden>
                      {sinLeer && <span className="h-2 w-2 rounded-full bg-[var(--ls-acc-graf)]" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate text-[13px] ${sinLeer ? 'font-semibold text-[var(--ls-t1)]' : 'text-[var(--ls-t2)]'}`}>
                          {h.contraparte || h.contraparteDireccion || '(sin remitente)'}
                          {h.mensajes > 1 && <span className="ml-1.5 text-[11px] font-normal text-[var(--ls-t4)]">{h.mensajes}</span>}
                        </span>
                        <time dateTime={h.ultimoMensajeAt} className="shrink-0 text-[11px] tabular-nums text-[var(--ls-t4)]">
                          {fechaDeLista(h.ultimoMensajeAt)}
                        </time>
                      </span>
                      <span className={`block truncate text-[12.5px] ${sinLeer ? 'font-medium text-[var(--ls-t1)]' : 'text-[var(--ls-t3)]'}`}>{h.asunto || '(sin asunto)'}</span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--ls-t4)]">{h.vistaPrevia}</span>
                        {h.automatico && <Etiqueta>Automático</Etiqueta>}
                        {h.esperandoRespuesta && (
                          <span title="Espera tu respuesta" className="shrink-0 text-[var(--ls-e-ambar)]">
                            <Clock className="h-3 w-3" aria-label="Espera tu respuesta" />
                          </span>
                        )}
                        {h.tieneAdjuntos && <Paperclip className="h-3 w-3 shrink-0 text-[var(--ls-t4)]" aria-label="Con adjuntos" />}
                        {h.destacado && <Star className="h-3 w-3 shrink-0 fill-[var(--ls-e-ambar)] text-[var(--ls-e-ambar)]" aria-label="Destacado" />}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
            {hayMas && (
              <li className="p-3">
                <button type="button" onClick={onMas} disabled={cargandoMas} className={`${BOTON_SECUNDARIO} w-full`}>
                  {cargandoMas && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                  {cargandoMas ? 'Cargando…' : 'Ver más antiguos'}
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
