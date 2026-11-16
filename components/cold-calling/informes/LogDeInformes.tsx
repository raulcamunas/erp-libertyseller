'use client'

import { ExternalLink, ScrollText, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Boton, Insignia, Segmentado, TablaAdaptable, Tarjeta, type Columna } from '@/components/ui-ls'
import { rutaDeLaFicha } from '@/lib/cold-calling/abrir-lead'
import { CAMPO } from '@/lib/estilo/denso'
import { cuandoCorto, entero, TEXTO_TIPO, type FilaDelLog } from './tipos'

/**
 * EL LOG DE INFORMES: cada uno hecho, saltado o fallido, con su comercial, si el lead lo ha abierto y si se le ha enviado por correo.
 *
 * «Abrir ficha» lleva a la ficha del lead en Cold Calling (pestaña nueva). NUNCA al informe público (/analisis/<token>): abrirlo sin sesión
 * contaría como apertura del lead y avisaría al comercial. El panel ni siquiera recibe el token.
 */

type Resultado = 'todos' | FilaDelLog['resultado']
type Tipo = 'todos' | FilaDelLog['tipo']

const RESULTADO = {
  hecho: { texto: 'Hecho', tono: 'verde' },
  saltado: { texto: 'Saltado', tono: 'ambar' },
  fallo: { texto: 'Fallo', tono: 'rojo' },
} as const

export function LogDeInformes({ log, indice }: { log: FilaDelLog[]; indice?: number }) {
  const [resultado, setResultado] = useState<Resultado>('todos')
  const [tipo, setTipo] = useState<Tipo>('todos')
  const [comercial, setComercial] = useState('todos')
  const [busqueda, setBusqueda] = useState('')

  const comerciales = useMemo(() => [...new Set(log.map((f) => f.comercial))].sort((a, b) => a.localeCompare(b, 'es')), [log])
  const cuentas = useMemo(() => {
    const c = { todos: log.length, hecho: 0, saltado: 0, fallo: 0 }
    for (const f of log) c[f.resultado]++
    return c
  }, [log])

  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return log.filter(
      (f) =>
        (resultado === 'todos' || f.resultado === resultado) &&
        (tipo === 'todos' || f.tipo === tipo) &&
        (comercial === 'todos' || f.comercial === comercial) &&
        (!q || f.tienda.toLowerCase().includes(q) || (f.motivo ?? '').toLowerCase().includes(q)),
    )
  }, [log, resultado, tipo, comercial, busqueda])

  const columnas: Columna<FilaDelLog>[] = [
    {
      id: 'at',
      cabecera: 'Cuándo',
      movil: 'subtitulo',
      ordenar: (f) => (f.at ? Date.parse(f.at) : 0),
      celda: (f) => (f.at ? <span className="tabular-nums">{cuandoCorto(f.at)}</span> : <span className="text-[var(--ls-t4)]" title="Saltado antes de que hubiera bitácora: no se sabe cuándo">antes del 16 nov</span>),
    },
    { id: 'tienda', cabecera: 'Tienda', movil: 'titulo', ordenar: (f) => f.tienda.toLowerCase(), celda: (f) => <span className="font-medium text-[var(--ls-t1)]">{f.tienda}</span> },
    { id: 'comercial', cabecera: 'Comercial', ordenar: (f) => f.comercial, celda: (f) => f.comercial },
    {
      id: 'tipo',
      cabecera: 'Tipo',
      ordenar: (f) => f.tipo,
      celda: (f) => (
        <span className="inline-flex items-center gap-1.5 text-[12.5px]">
          <span className="h-2 w-2 rounded-[2px]" style={{ background: f.tipo === 'amazon' ? 'var(--viz-1)' : 'var(--viz-2)' }} aria-hidden />
          {TEXTO_TIPO[f.tipo]}
        </span>
      ),
    },
    {
      id: 'resultado',
      cabecera: 'Resultado',
      movil: 'insignia',
      ordenar: (f) => f.resultado,
      celda: (f) => (
        <span className="flex min-w-0 flex-col items-start gap-0.5">
          <Insignia tono={RESULTADO[f.resultado].tono} tamano="sm">
            {RESULTADO[f.resultado].texto}
          </Insignia>
          {f.motivo && f.resultado !== 'hecho' && <span className="max-w-[260px] truncate text-[11.5px] text-[var(--ls-t4)]" title={f.motivo}>{f.motivo}</span>}
        </span>
      ),
    },
    {
      id: 'abierto',
      cabecera: 'Abierto',
      alinear: 'derecha',
      ordenar: (f) => f.aperturas,
      celda: (f) =>
        f.aperturas > 0 ? (
          <span title={f.abiertoUltima ? `Última vez: ${cuandoCorto(f.abiertoUltima)}` : undefined}>
            <span className="font-medium text-[var(--ls-e-verde)]">{entero(f.aperturas)} {f.aperturas === 1 ? 'vez' : 'veces'}</span>
            {f.abiertoUltima && <span className="block text-[11px] text-[var(--ls-t4)]">{cuandoCorto(f.abiertoUltima)}</span>}
          </span>
        ) : (
          <span className="text-[var(--ls-t4)]">—</span>
        ),
    },
    {
      id: 'correo',
      cabecera: 'Por correo',
      ordenar: (f) => (f.enviadoAt ? Date.parse(f.enviadoAt) : 0),
      celda: (f) => (f.enviadoAt ? cuandoCorto(f.enviadoAt) : <span className="text-[var(--ls-t4)]">—</span>),
    },
    { id: 'tokens', cabecera: 'Tokens', alinear: 'derecha', movil: 'oculto', ordenar: (f) => f.tokens ?? -1, celda: (f) => (f.tokens != null ? entero(f.tokens) : <span className="text-[var(--ls-t4)]">—</span>) },
  ]

  const hayFiltros = resultado !== 'todos' || tipo !== 'todos' || comercial !== 'todos' || busqueda.trim() !== ''

  return (
    <Tarjeta indice={indice} icono={ScrollText} acento="marca" titulo="Log de informes" subtitulo={`${entero(filas.length)} de ${entero(log.length)} · los más nuevos arriba`} sinRelleno>
      <div className="flex flex-col gap-2 border-b border-[var(--ls-linea)] p-3 lg:flex-row lg:flex-wrap lg:items-center">
        <Segmentado
          etiqueta="Resultado"
          tamano="sm"
          valor={resultado}
          onCambio={setResultado}
          opciones={[
            { id: 'todos', texto: 'Todos', cuenta: cuentas.todos },
            { id: 'hecho', texto: 'Hechos', cuenta: cuentas.hecho },
            { id: 'saltado', texto: 'Saltados', cuenta: cuentas.saltado },
            { id: 'fallo', texto: 'Fallos', cuenta: cuentas.fallo },
          ]}
        />
        <Segmentado
          etiqueta="Tipo"
          tamano="sm"
          valor={tipo}
          onCambio={setTipo}
          opciones={[
            { id: 'todos', texto: 'Todos' },
            { id: 'amazon', texto: 'Amazon' },
            { id: 'sin', texto: 'Sin Amazon' },
          ]}
        />
        <select value={comercial} onChange={(e) => setComercial(e.target.value)} aria-label="Comercial" className={`${CAMPO.input} !h-8 cursor-pointer lg:!w-[180px]`}>
          <option value="todos">Todos los comerciales</option>
          {comerciales.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="relative flex min-w-0 flex-1 items-center lg:max-w-[260px]">
          <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[var(--ls-t4)]" aria-hidden />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar tienda o motivo…" aria-label="Buscar en el log" className={`${CAMPO.input} !h-8 pl-8`} />
        </label>
        {hayFiltros && (
          <Boton
            variante="fantasma"
            tamano="sm"
            icono={X}
            onClick={() => {
              setResultado('todos')
              setTipo('todos')
              setComercial('todos')
              setBusqueda('')
            }}
          >
            Limpiar
          </Boton>
        )}
      </div>
      <TablaAdaptable
        columnas={columnas}
        filas={filas}
        claveDe={(f) => `${f.resultado}:${f.tipo}:${f.leadId ?? f.tienda}:${f.at ?? ''}`}
        porPagina={25}
        etiqueta="Log de informes"
        className="p-2 lg:p-0"
        acciones={(f) =>
          f.leadId ? (
            <Boton asChild variante="fantasma" tamano="sm" icono={ExternalLink}>
              <a href={rutaDeLaFicha(f.leadId)} target="_blank" rel="noopener" title="Abrir la ficha del lead en Cold Calling (pestaña nueva)">
                Ficha
              </a>
            </Boton>
          ) : null
        }
        vacio={{ icono: ScrollText, titulo: 'Nada con estos filtros', descripcion: 'Cambia el resultado, el tipo o el comercial.', compacto: true }}
      />
    </Tarjeta>
  )
}
