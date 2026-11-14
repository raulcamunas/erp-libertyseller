'use client'

import { Eye, Pencil } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Avatar } from './AvatarTC'
import { desconectados, describirLugar, escribiendoEnTarea, nombresEnFrase, type Conectado } from '@/lib/tareas-clientes/presencia'
import type { PersonaTC } from '@/lib/tareas-clientes/tipos'
import { usePresencia } from './PresenciaProvider'

/**
 * LO QUE SE VE DE LA PRESENCIA: las caras de quien está en un cliente o en una tarea (con un punto verde si está activa y gris si se ha quedado quieta), la lista de quién está en
 * línea y dónde, y el aviso de «está escribiendo». Todo sale de PresenciaProvider; sin proveedor (o sin canal) no se pinta nada.
 */

/** Unas caras apiladas: quién está ahí. `max` caras y un «+N» con el resto */
export function Presentes({ personas, max = 3, tamano = 18, etiqueta }: { personas: readonly Conectado[]; max?: number; tamano?: number; etiqueta?: string }) {
  if (personas.length === 0) return null
  const vistas = personas.slice(0, max)
  const resto = personas.length - vistas.length
  return (
    <span className="tc-presentes" title={`${etiqueta ? `${etiqueta}: ` : ''}${nombresEnFrase(personas.map((p) => p.nombre))}`} aria-label={`${etiqueta ?? 'Aquí'}: ${personas.map((p) => p.nombre).join(', ')}`}>
      {vistas.map((p) => (
        <span key={p.id} className="tc-presente" data-estado={p.estado} style={{ width: tamano, height: tamano }}>
          <Avatar id={p.id} nombre={p.nombre} tamano={tamano} />
          <i />
        </span>
      ))}
      {resto > 0 && <span className="tc-presente-mas" style={{ height: tamano, minWidth: tamano }}>+{resto}</span>}
    </span>
  )
}

/** El resumen de la barra lateral y del inicio: quién está en línea, y al abrirlo dónde está cada uno y quién no está */
export function EnLinea({ equipo, nombreDeCliente, tituloDeTarea, compacto = false }: { equipo: readonly PersonaTC[]; nombreDeCliente: (id: string) => string | undefined; tituloDeTarea: (id: string) => string | undefined; compacto?: boolean }) {
  const { conectados, yo, disponible } = usePresencia()
  if (!disponible) return null
  const otros = conectados.filter((c) => c.id !== yo)
  const fuera = desconectados(equipo.filter((p) => p.id !== yo), conectados)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="tc-enlinea" data-compacto={compacto ? 'true' : undefined} aria-label={`${otros.length} compañeros en línea`}>
          {otros.length > 0 ? <Presentes personas={otros} max={compacto ? 3 : 4} tamano={compacto ? 20 : 22} etiqueta="En línea" /> : <span className="tc-presente-solo" />}
          <span className="tc-enlinea-texto">{otros.length === 0 ? 'Solo tú' : `${otros.length} en línea`}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="!w-[320px] !rounded-[14px] !border-[var(--ls-linea2)] !bg-[var(--ls-sup)] !p-2 !text-[var(--ls-t1)] shadow-[0_18px_50px_rgba(0,0,0,0.4)]">
        <p className="tc-lat-rotulo !pt-1">En línea · {otros.length}</p>
        {otros.length === 0 && <p className="px-2 pb-2 text-[12px] text-[var(--ls-t4)]">Nadie más tiene Tareas de clientes abierto ahora mismo.</p>}
        <ul className="flex max-h-[260px] flex-col gap-px overflow-auto">
          {otros.map((c) => (
            <li key={c.id} className="tc-enlinea-fila">
              <span className="tc-presente" data-estado={c.estado} style={{ width: 26, height: 26 }}><Avatar id={c.id} nombre={c.nombre} tamano={26} /><i /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-[var(--ls-t1)]">{c.nombre}{c.escribiendoEn && c.escribiendoHasta > Date.now() ? <span className="ml-1.5 text-[11px] font-normal text-[var(--ls-acc)]">escribiendo…</span> : null}</span>
                <span className="block truncate text-[11.5px] text-[var(--ls-t3)]">{c.estado === 'quieto' ? 'Quieto · ' : ''}{describirLugar(c, nombreDeCliente, tituloDeTarea)}</span>
              </span>
            </li>
          ))}
        </ul>
        {fuera.length > 0 && (
          <>
            <p className="tc-lat-rotulo !pt-3">Sin conectar · {fuera.length}</p>
            <ul className="flex flex-wrap gap-1.5 px-2 pb-1">
              {fuera.map((p) => <li key={p.id} className="tc-fuera" title={`${p.nombre} no está conectado`}><Avatar id={p.id} nombre={p.nombre} tamano={22} /><span>{p.nombre.split(' ')[0]}</span></li>)}
            </ul>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** En el panel de una tarea: quién más la está viendo, y un aviso cuando alguien escribe en ella */
export function PresenciaDeTarea({ tareaId }: { tareaId: string }) {
  const { deTarea, conectados, yo, disponible } = usePresencia()
  if (!disponible) return null
  const viendo = deTarea.get(tareaId) ?? []
  if (viendo.length === 0) return null
  const escribiendo = escribiendoEnTarea(conectados, tareaId, Date.now(), yo)
  return (
    <>
      <span className="tc-chip-estado" title={nombresEnFrase(viendo.map((v) => v.nombre))}>
        <Eye className="h-3 w-3" /> <Presentes personas={viendo} max={3} tamano={18} etiqueta="Viendo esta tarea" />
      </span>
      {escribiendo.length > 0 && (
        <span className="tc-escribiendo" role="status">
          <Pencil className="h-3 w-3" /> {nombresEnFrase(escribiendo.map((e) => e.nombre))} {escribiendo.length === 1 ? 'está escribiendo' : 'están escribiendo'}<b><i /><i /><i /></b>
        </span>
      )}
    </>
  )
}
