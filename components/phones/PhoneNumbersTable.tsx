'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Check, Copy, Pencil, Phone, Plus, Search, Trash2, X } from 'lucide-react'
import { Avatar, Boton, CabeceraDeModulo, Confirmacion, EstadoVacio, Segmentado, TACTIL_CUADRADO } from '@/components/ui-ls'
import { cn } from '@/lib/utils'
import { formatoTelefono, separarNumeros } from './formato'
import { CuentasRinkel } from './CuentasRinkel'

/**
 * TELÉFONOS: el registro interno de los números que usamos y para qué es cada uno (solo dirección).
 *
 * Rediseñado con el kit (15 nov 2026). Los mismos flujos de siempre: se edita en la propia casilla y se guarda al salir, se busca, se copia, se añade
 * y se borra. Lo nuevo: el número se ve agrupado (623 973 018) y una casilla con varios («621099518 - 650…») enseña cada uno con su botón de copiar
 * en vez de cortarse; filtro por «con cliente / con otro uso / sin asignar»; borrar pide confirmación (antes era un clic sin vuelta atrás); y en el
 * móvil cada número es una tarjeta, con los botones siempre a la vista (allí no hay ratón que los descubra).
 */
export interface PhoneNumber {
  id: string
  phone: string
  client: string | null
  other_use: string | null
  pin?: string | null
  notes: string | null
  position: number | null
}

interface PhoneNumbersTableProps {
  initialRows: PhoneNumber[]
}

type Pestana = 'numeros' | 'rinkel'
type Filtro = 'todos' | 'cliente' | 'uso' | 'libres'

const CAMPO =
  'w-full min-w-0 rounded-[10px] border border-transparent bg-transparent px-[10px] py-[7px] text-[13.5px] text-[var(--ls-t1)] outline-none transition-colors placeholder:text-[var(--ls-t4)] hover:bg-[var(--ls-sup2)] focus:border-[var(--ls-acc-graf)] focus:bg-[var(--ls-sup2)]'

function copiar(texto: string) {
  navigator.clipboard.writeText(texto).then(
    () => toast.success(`Copiado: ${formatoTelefono(texto)}`),
    () => toast.error('No se pudo copiar'),
  )
}

/** El número: agrupado y con copiar; con el lápiz se edita en la misma casilla y se guarda al salir. Vacío, sale ya como campo. */
function CampoTelefono({ valor, onGuardar, autoFoco }: { valor: string; onGuardar: (v: string) => void; autoFoco?: boolean }) {
  const [editando, setEditando] = useState(autoFoco || !valor)
  const numeros = separarNumeros(valor)

  if (editando || numeros.length === 0) {
    return (
      <input
        autoFocus={autoFoco || (editando && !!valor)}
        defaultValue={valor}
        inputMode="tel"
        aria-label="Teléfono"
        placeholder="600 000 000"
        onBlur={(e) => {
          const v = e.target.value.trim()
          if (v !== valor) onGuardar(v)
          if (v) setEditando(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            e.currentTarget.value = valor
            e.currentTarget.blur()
          }
        }}
        className={cn(CAMPO, 'font-medium tabular-nums tracking-[0.01em]')}
      />
    )
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-[6px]">
      {numeros.map((n, i) => (
        <span key={`${n}-${i}`} className="inline-flex items-center gap-[2px] rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] py-[3px] pl-[10px] pr-[3px]">
          <span className="whitespace-nowrap text-[13.5px] font-semibold tabular-nums tracking-[0.02em] text-[var(--ls-t1)]">{formatoTelefono(n)}</span>
          <button
            type="button"
            onClick={() => copiar(n)}
            className="grid h-7 w-7 place-items-center rounded-[7px] text-[var(--ls-t4)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] focus-visible:outline-2 focus-visible:outline-[var(--ls-acc-graf)]"
            aria-label={`Copiar ${n}`}
            title="Copiar"
          >
            <Copy className="h-[13px] w-[13px]" aria-hidden />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => setEditando(true)}
        className="grid h-7 w-7 place-items-center rounded-[7px] text-[var(--ls-t4)] transition-[opacity,color] hover:text-[var(--ls-t1)] focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--ls-acc-graf)] lg:opacity-0 lg:group-hover:opacity-100"
        aria-label="Editar el número"
        title="Editar"
      >
        <Pencil className="h-[13px] w-[13px]" aria-hidden />
      </button>
    </div>
  )
}

function CampoTexto({ valor, onGuardar, etiqueta, apagado }: { valor: string | null; onGuardar: (v: string | null) => void; etiqueta: string; apagado?: boolean }) {
  return (
    <input
      defaultValue={valor ?? ''}
      aria-label={etiqueta}
      placeholder="—"
      onBlur={(e) => {
        const v = e.target.value.trim() || null
        if (v !== (valor ?? null)) onGuardar(v)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      className={cn(CAMPO, apagado && 'text-[var(--ls-t2)]')}
    />
  )
}

export function PhoneNumbersTable({ initialRows }: PhoneNumbersTableProps) {
  const supabase = createClient()
  const [rows, setRows] = useState(initialRows)
  const [search, setSearch] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [pestana, setPestana] = useState<Pestana>('numeros')
  const [nuevo, setNuevo] = useState<string | null>(null)
  const [borrando, setBorrando] = useState<PhoneNumber | null>(null)

  const cuentas = useMemo(
    () => ({
      todos: rows.length,
      cliente: rows.filter((r) => r.client).length,
      uso: rows.filter((r) => r.other_use).length,
      libres: rows.filter((r) => !r.client && !r.other_use).length,
    }),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qDigitos = q.replace(/\D/g, '')
    return [...rows]
      .sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
      .filter((r) => (filtro === 'cliente' ? !!r.client : filtro === 'uso' ? !!r.other_use : filtro === 'libres' ? !r.client && !r.other_use : true))
      .filter((r) => {
        if (!q) return true
        // «623 973» encuentra 623973018: también se compara sin espacios
        if (qDigitos.length >= 3 && r.phone.replace(/\D/g, '').includes(qDigitos)) return true
        return [r.phone, r.client, r.other_use, r.notes].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
      })
  }, [rows, search, filtro])

  async function save(id: string, patch: Partial<PhoneNumber>) {
    const { error } = await supabase.from('phone_numbers').update(patch).eq('id', id)
    if (error) {
      console.error('Error guardando el número:', error)
      toast.error('No se pudo guardar')
      return
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    toast.success('Guardado', { duration: 1200 })
  }

  async function addRow() {
    const nextPos = Math.max(0, ...rows.map((r) => r.position ?? 0)) + 1
    const { data, error } = await supabase.from('phone_numbers').insert({ phone: '', position: nextPos }).select('*').single()
    if (error) {
      console.error('Error añadiendo fila:', error)
      toast.error('No se pudo añadir')
      return
    }
    setRows((prev) => [...prev, data as PhoneNumber])
    setSearch('')
    setFiltro('todos')
    setNuevo((data as PhoneNumber).id)
  }

  async function removeRow(id: string) {
    const { error } = await supabase.from('phone_numbers').delete().eq('id', id)
    if (error) {
      toast.error('No se pudo borrar')
      throw error
    }
    setRows((prev) => prev.filter((r) => r.id !== id))
    toast.success('Número borrado')
  }

  const botonBorrar = (r: PhoneNumber) => (
    <button
      type="button"
      onClick={() => setBorrando(r)}
      className={cn(
        TACTIL_CUADRADO,
        'grid h-8 w-8 shrink-0 place-items-center rounded-[9px] text-[var(--ls-t4)] transition-[opacity,color,background-color] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-rojo,#f87171)] focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--ls-acc-graf)] lg:opacity-0 lg:group-hover:opacity-100',
      )}
      aria-label={`Borrar ${r.phone || 'la fila'}`}
      title="Borrar"
    >
      <Trash2 className="h-[14px] w-[14px]" aria-hidden />
    </button>
  )

  return (
    <div className="mx-auto w-full max-w-[1100px]">
      <CabeceraDeModulo
        icono={Phone}
        acento="marca"
        titulo="Teléfonos"
        subtitulo="Los números que usamos y para qué es cada uno."
        acciones={
          pestana === 'numeros' ? (
            <Boton variante="primario" icono={Plus} onClick={addRow}>
              Añadir número
            </Boton>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Segmentado<Pestana>
          etiqueta="Sección"
          tamano="sm"
          valor={pestana}
          onCambio={setPestana}
          opciones={[
            { id: 'numeros', texto: 'Números' },
            { id: 'rinkel', texto: 'Cuentas de Rinkel' },
          ]}
        />
      </div>

      {pestana === 'rinkel' ? (
        <CuentasRinkel />
      ) : (
        <>

      {/* Buscar y filtrar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative block w-full sm:w-[320px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-[var(--ls-t4)]" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar número, cliente o uso…"
            aria-label="Buscar"
            className="h-10 w-full rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] pl-9 pr-9 text-[13.5px] text-[var(--ls-t1)] outline-none transition-colors placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)]"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-[7px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]" aria-label="Borrar la búsqueda">
              <X className="h-[14px] w-[14px]" aria-hidden />
            </button>
          )}
        </label>
        <Segmentado<Filtro>
          etiqueta="Filtrar"
          tamano="sm"
          valor={filtro}
          onCambio={setFiltro}
          opciones={[
            { id: 'todos', texto: 'Todos', cuenta: cuentas.todos },
            { id: 'cliente', texto: 'Con cliente', cuenta: cuentas.cliente },
            { id: 'uso', texto: 'Con otro uso', cuenta: cuentas.uso },
            { id: 'libres', texto: 'Sin asignar', cuenta: cuentas.libres },
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <EstadoVacio
          icono={Phone}
          acento="marca"
          compacto
          titulo={rows.length === 0 ? 'Todavía no hay números' : 'Ningún número coincide'}
          descripcion={rows.length === 0 ? 'Añade el primero y apunta de quién es o para qué se usa.' : 'Prueba con otra búsqueda o quita el filtro.'}
          accion={
            rows.length === 0
              ? { texto: 'Añadir número', onClick: addRow }
              : {
                  texto: 'Ver todos',
                  onClick: () => {
                    setSearch('')
                    setFiltro('todos')
                  },
                }
          }
        />
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-[var(--ls-sombra-1)]">
          {/* Rótulos de columna: solo en el ordenador (en el móvil cada número es una tarjeta con sus rótulos) */}
          <div className="hidden grid-cols-[minmax(250px,1.1fr)_120px_minmax(0,1fr)_minmax(0,1.2fr)_40px] gap-3 border-b border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-4 py-[10px] text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ls-t4)] lg:grid">
            <span>Teléfono</span>
            <span>PIN</span>
            <span>Cliente</span>
            <span>Otro uso</span>
            <span className="sr-only">Acciones</span>
          </div>

          <ul role="list" className="divide-y divide-[var(--ls-linea)]">
            {filtered.map((r) => (
              <li
                key={r.id}
                className={cn(
                  'group grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 px-3 py-3 transition-colors hover:bg-[color-mix(in_srgb,var(--ls-sup2)_60%,transparent)] lg:grid-cols-[minmax(250px,1.1fr)_120px_minmax(0,1fr)_minmax(0,1.2fr)_40px] lg:items-center lg:gap-3 lg:px-4 lg:py-[10px]',
                  nuevo === r.id && 'bg-[color-mix(in_srgb,var(--ls-acc-graf)_7%,transparent)]',
                )}
              >
                <div className="min-w-0">
                  <CampoTelefono valor={r.phone} autoFoco={nuevo === r.id} onGuardar={(v) => save(r.id, { phone: v })} />
                </div>

                {/* En el móvil la papelera va arriba a la derecha, junto al número; en el ordenador, en su columna */}
                <div className="col-start-2 row-start-1 flex items-start lg:col-start-5 lg:justify-end">{botonBorrar(r)}</div>

                <div className="col-span-2 flex min-w-0 items-center gap-2 lg:col-span-1 lg:col-start-2 lg:row-start-1">
                  <span className="w-[54px] shrink-0 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--ls-t4)] lg:hidden">PIN</span>
                  <CampoTexto etiqueta="PIN" valor={r.pin ?? null} onGuardar={(v) => save(r.id, { pin: v })} />
                </div>

                <div className="col-span-2 flex min-w-0 items-center gap-2 lg:col-span-1 lg:col-start-3 lg:row-start-1">
                  <span className="w-[54px] shrink-0 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--ls-t4)] lg:hidden">Cliente</span>
                  {r.client ? <Avatar nombre={r.client} tamano={26} className="shrink-0" /> : <span aria-hidden className="w-[26px] shrink-0 lg:hidden" />}
                  <CampoTexto etiqueta="Cliente" valor={r.client} onGuardar={(v) => save(r.id, { client: v })} />
                </div>

                <div className="col-span-2 flex min-w-0 items-center gap-2 lg:col-span-1 lg:col-start-4 lg:row-start-1">
                  <span className="w-[54px] shrink-0 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--ls-t4)] lg:hidden">Uso</span>
                  {/* Mismo sangrado que el avatar de la fila de arriba, para que los dos textos empiecen a la misma altura en el móvil */}
                  <span aria-hidden className="w-[26px] shrink-0 lg:hidden" />
                  <CampoTexto etiqueta="Otro uso" valor={r.other_use} apagado onGuardar={(v) => save(r.id, { other_use: v })} />
                </div>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={addRow}
            className="flex w-full items-center justify-center gap-2 border-t border-[var(--ls-linea)] py-3 text-[13px] font-medium text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]"
          >
            <Plus className="h-[15px] w-[15px]" aria-hidden /> Añadir número
          </button>
        </div>
      )}

      <p className="mt-3 flex items-center gap-[6px] text-[12px] text-[var(--ls-t4)]">
        <Check className="h-[13px] w-[13px]" aria-hidden /> Los cambios se guardan solos al salir de cada casilla. Intro guarda; Esc deshace el número.
      </p>
        </>
      )}

      <Confirmacion
        abierto={!!borrando}
        onCambio={(a) => !a && setBorrando(null)}
        titulo="¿Borrar este número?"
        descripcion={
          borrando ? (
            <>
              <strong className="tabular-nums text-[var(--ls-t1)]">{borrando.phone ? separarNumeros(borrando.phone).map(formatoTelefono).join(' · ') : 'Fila vacía'}</strong>
              {borrando.client || borrando.other_use ? ` (${[borrando.client, borrando.other_use].filter(Boolean).join(' · ')})` : ''}. Se borra del registro y no se puede deshacer.
            </>
          ) : null
        }
        palabra={null}
        textoConfirmar="Borrar"
        onConfirmar={() => (borrando ? removeRow(borrando.id) : undefined)}
      />
    </div>
  )
}
