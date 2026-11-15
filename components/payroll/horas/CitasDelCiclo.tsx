'use client'

import { useState } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { CalendarPlus, CheckCircle2, MoreHorizontal, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Avatar, Boton, Confirmacion, EstadoVacio, Insignia, PanelLateral, Tarjeta } from '@/components/ui-ls'
import { formatDollars, resolveRate, type PayrollRate } from '@/lib/types/payroll'
import type { CitaDelCiclo } from './useNominaCiclo'
import { diaYMes } from './fechas'

const itemMenu =
  'flex min-h-[40px] cursor-pointer select-none items-center gap-2 rounded-[8px] px-2.5 text-[13px] text-[var(--ls-t2)] outline-none data-[highlighted]:bg-[var(--ls-sup3)] data-[highlighted]:text-[var(--ls-t1)]'

/** Una cita de la lista: inicial del lead, chips legibles (no a 8 px) y el importe. Las acciones de admin, en un «⋯» siempre visible. */
function FilaCita({ cita, esAdmin, onSoltarFijo, onQuitar }: { cita: CitaDelCiclo; esAdmin: boolean; onSoltarFijo: () => void; onQuitar: () => void }) {
  const conAcciones = esAdmin && (cita.fijo || cita.manual)
  return (
    <li className="flex items-center gap-3 rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2.5">
      <Avatar nombre={cita.name} tamano={34} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium text-[var(--ls-t1)]">{cita.name}</p>
        <p className="truncate text-[12px] text-[var(--ls-t4)]">
          {cita.company || 'Sin empresa'} · {diaYMes(cita.dia)}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {cita.semi ? <Insignia tono="violeta" tamano="sm">Semi-cualificada</Insignia> : !cita.manual && <Insignia tono="verde" tamano="sm">Cualificada</Insignia>}
          {cita.manual && <Insignia tono="gris" tamano="sm">Manual</Insignia>}
          {cita.semi && cita.commission === 0 && (
            <Insignia tono="ambar" tamano="sm" title="Ese mes no tiene precio de semi-cualificada: se pone en las tarifas del año.">
              Sin precio
            </Insignia>
          )}
          {/* POR QUÉ ESTA COBRA OTRA COSA: una cita a mano con el importe escrito manda sobre la tarifa del mes. */}
          {cita.fijo && (
            <Insignia tono="ambar" tamano="sm" title="Lleva el importe escrito a mano, así que no usa la tarifa del mes.">
              Importe fijo
            </Insignia>
          )}
        </div>
      </div>
      <span className="shrink-0 text-[14px] font-semibold tabular-nums text-[var(--ls-e-verde)]">+{formatDollars(cita.commission)}</span>
      {conAcciones && (
        <Menu.Root>
          <Menu.Trigger asChild>
            <Boton variante="fantasma" tamano="sm" soloIcono icono={MoreHorizontal} aria-label={`Acciones de la cita de ${cita.name}`} />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content align="end" sideOffset={6} className="z-50 min-w-[220px] rounded-[12px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-1 shadow-[var(--ls-sombra-3)] data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none">
              {cita.fijo && (
                <Menu.Item className={itemMenu} onSelect={onSoltarFijo}>
                  <RotateCcw className="h-4 w-4" /> Usar la tarifa del mes
                </Menu.Item>
              )}
              {cita.manual && (
                <Menu.Item className={`${itemMenu} text-[var(--ls-e-rojo)] data-[highlighted]:text-[var(--ls-e-rojo)]`} onSelect={onQuitar}>
                  <Trash2 className="h-4 w-4" /> Quitar esta cita
                </Menu.Item>
              )}
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      )}
    </li>
  )
}

/**
 * LAS CITAS QUE COBRAN EN EL CICLO (de la Agenda y las añadidas a mano). El admin añade citas manuales en una hoja
 * (antes era un formulario apretado de 320 px) y sus acciones van en el «⋯», que en el móvil SÍ se ve (antes solo
 * salían al pasar el ratón).
 */
export function CitasDelCiclo({
  citas,
  esAdmin,
  rates,
  hoy,
  claveCiclo,
  nombrePersona,
  guardando,
  onAnadir,
  onSoltarFijo,
  onQuitar,
}: {
  citas: CitaDelCiclo[]
  esAdmin: boolean
  rates: PayrollRate[]
  hoy: string
  claveCiclo: string
  nombrePersona: string
  guardando: boolean
  onAnadir: (d: { nombre: string; fecha: string; importe: number | null }) => Promise<boolean>
  onSoltarFijo: (id: string) => void
  onQuitar: (id: string) => Promise<void>
}) {
  const [alta, setAlta] = useState(false)
  const [nombre, setNombre] = useState('')
  const [fecha, setFecha] = useState('')
  const [importe, setImporte] = useState('')
  const [aQuitar, setAQuitar] = useState<CitaDelCiclo | null>(null)
  // Los campos van a 16 px con el dedo ([@media(pointer:coarse)]): con menos, iOS amplía la página al enfocarlos y no la devuelve

  const importeTexto = importe.trim().replace(',', '.')
  const importeLeido = importeTexto === '' ? null : Number(importeTexto)
  const importeMalo = importeLeido !== null && (!Number.isFinite(importeLeido) || importeLeido < 0)

  const abrirAlta = () => {
    setNombre('')
    setFecha(hoy)
    /**
     * VACÍO A PROPÓSITO: un importe escrito se guarda FIJO y manda sobre la tarifa del mes para siempre. Vacío = la
     * tarifa del mes de su fecha. La casilla queda para las excepciones y el placeholder enseña lo que va a cobrar.
     */
    setImporte('')
    setAlta(true)
  }

  const guardarAlta = async () => {
    if (!nombre.trim() || !fecha || importeMalo) return
    if (await onAnadir({ nombre: nombre.trim(), fecha, importe: importeLeido })) setAlta(false)
  }

  return (
    <Tarjeta
      titulo="Citas que cobran"
      subtitulo={citas.length ? `${citas.length} en este ciclo` : undefined}
      icono={CheckCircle2}
      acento="var(--ls-e-verde)"
      indice={2}
      acciones={
        esAdmin && (
          <Boton tamano="sm" icono={Plus} onClick={abrirAlta} title="Sumar una cita que no está en la agenda">
            Añadir
          </Boton>
        )
      }
    >
      {citas.length === 0 ? (
        <EstadoVacio
          compacto
          icono={CalendarPlus}
          acento="var(--ls-e-verde)"
          titulo="Ninguna todavía en este ciclo"
          descripcion="En cuanto se marque una cita como cualificada aparecerá aquí y sumará a las comisiones."
          accion={esAdmin ? { texto: 'Añadir a mano', onClick: abrirAlta, icono: Plus } : undefined}
        />
      ) : (
        <ul className="space-y-2">
          {citas.map((c) => (
            <FilaCita key={c.id} cita={c} esAdmin={esAdmin} onSoltarFijo={() => onSoltarFijo(c.id)} onQuitar={() => setAQuitar(c)} />
          ))}
        </ul>
      )}

      <PanelLateral
        abierto={alta}
        onCambio={setAlta}
        titulo="Añadir una cita a mano"
        descripcion={`Cuenta para ${nombrePersona}. Para citas que no pasaron por la agenda.`}
        icono={CalendarPlus}
        acento="var(--ls-e-verde)"
        ancho={420}
        pie={
          <>
            <Boton variante="fantasma" onClick={() => setAlta(false)}>
              Cancelar
            </Boton>
            <Boton variante="primario" cargando={guardando} disabled={!nombre.trim() || !fecha || importeMalo} onClick={() => void guardarAlta()}>
              Añadir
            </Boton>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-[12.5px] text-[var(--ls-t3)]">Nombre del lead</span>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej.: Zapatos Martínez"
              className="h-11 w-full rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 text-[14px] text-[var(--ls-t1)] outline-none [@media(pointer:coarse)]:text-[16px] placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] text-[var(--ls-t3)]">Día de la cita (decide a qué ciclo cuenta)</span>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="h-11 w-full rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 text-[14px] text-[var(--ls-t1)] outline-none [@media(pointer:coarse)]:text-[16px] focus:border-[var(--ls-acc-graf)] [color-scheme:dark] [html.light_&]:[color-scheme:light]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] text-[var(--ls-t3)]">Importe (vacío = la tarifa del mes de su fecha)</span>
            <div className="relative">
              <input
                value={importe}
                onChange={(e) => setImporte(e.target.value)}
                inputMode="decimal"
                placeholder={String(resolveRate(rates, fecha || claveCiclo).commission)}
                aria-invalid={importeMalo || undefined}
                className={`h-11 w-full rounded-[10px] border bg-[var(--ls-sup2)] pl-3 pr-8 text-[14px] tabular-nums text-[var(--ls-t1)] outline-none [@media(pointer:coarse)]:text-[16px] placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)] ${importeMalo ? 'border-[var(--ls-e-rojo)]' : 'border-[var(--ls-linea2)]'}`}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-[var(--ls-t4)]">$</span>
            </div>
            <span className={`mt-1 block text-[12px] ${importeMalo ? 'text-[var(--ls-e-rojo)]' : 'text-[var(--ls-t4)]'}`}>
              {importeMalo ? 'Escribe solo un número, por ejemplo 20 o 22,5' : 'Escríbelo solo si esta cita es una excepción: un importe escrito manda sobre la tarifa.'}
            </span>
          </label>
        </div>
      </PanelLateral>

      <Confirmacion
        abierto={aQuitar !== null}
        onCambio={(a) => !a && setAQuitar(null)}
        titulo={`¿Quitar la cita de ${aQuitar?.name ?? ''}?`}
        descripcion={aQuitar ? `Deja de sumar ${formatDollars(aQuitar.commission)} a las comisiones de ${nombrePersona}.` : undefined}
        palabra={null}
        textoConfirmar="Quitar"
        onConfirmar={async () => {
          if (aQuitar) await onQuitar(aQuitar.id)
        }}
      />
    </Tarjeta>
  )
}
