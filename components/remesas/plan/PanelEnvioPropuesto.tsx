'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight, Ban, CheckCircle2, Clock, GitCompareArrows, History, Link2Off, ListChecks, MessageSquare, PackageMinus,
  PackagePlus, RefreshCw, RotateCcw, Sparkles, Truck, UserMinus, UserPlus,
} from 'lucide-react'
import { toast } from 'sonner'
import { Boton, EsqueletoTexto, EstadoVacio, FOCO, Insignia, LineaDeTiempo, PanelLateral, TACTIL, type Hito } from '@/components/ui-ls'
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import { diaEnEspana } from '@/lib/fba/fechas'
import type { AjusteIa, EnvioPropuestoGuardado, EstadoEnvioPropuesto, LineaPlan, MotivoDescarte, Prioridad } from '@/lib/fba/plan-tipos'
import { avisoDeFechaLimite } from '@/lib/fba/trabajo-plan'
import { createClient } from '@/lib/supabase/client'
import type { PanelEnvioPropuestoProps } from '../comun/tipos-ui'
import { leerRespuesta } from '../comun/errores'
import {
  CONFIANZA, ESTADO_ENVIO, MOTIVO_DESCARTE, PRIORIDAD, dinero, entero, fechaCorta,
} from '../comun/estilo-plan'
import { invalidarRemesas } from '../comun/useAgencia'
import { useEnvioPropuesto, useEnviosPropuestos, useHistorialEnvio, type CambioEnvioPropuesto, type EventoHistorialEnvio } from '../comun/useEnviosPropuestos'
import { usePlan } from '../comun/usePlan'
import { cx } from '../comun/ui'
import { FormularioDescarte } from './DescartarDialog'
import { FueraDelEnvio, LineasDelEnvio, filasDelEnvio } from './LineasDelEnvio'
import { RevisionIa } from './RevisionIa'
import { cuentaAtras, semanaDelEnvio } from './TarjetaEnvioPropuesto'

/**
 * EL PANEL DE UN ENVÍO PROPUESTO (spec remesas-pro §1.5, §4, D3, D4, D22, D23, D38 y D43).
 *
 * Un `PanelLateral` del kit (a la derecha en el ordenador; hoja inferior casi a pantalla completa en el móvil) con:
 *   1. Cabecera editable: fechas, estado, responsable (asignarme / soltar; el admin elige a otra persona), fecha límite
 *      (con el aviso «Pasada esta fecha ya no llega antes de la rotura») y nota. Cada cambio manda la `version` que se
 *      está viendo: si alguien cambió el envío antes (409), sale «Recargar» y no se pisa nada.
 *   2. «Qué ha cambiado desde ayer» (`cambiosDesdeAyer`).
 *   3. Las referencias (`LineasDelEnvio`): stock, camino, comprometido, ritmo, rotura, cantidad, caja y su origen, el
 *      porqué, lo entrante sin remesa, lo dudoso, los huecos que ya no se evitan y la diferencia hablado / plan de hoy.
 *   4. «Fuera del envío» (desplegable) con sus motivos, del plan del cliente.
 *   5. Revisión de la IA (`RevisionIa`): ajustes con «Aplicar», mensaje con «Copiar», coste y «Revisar con IA».
 *   6. Historial con `LineaDeTiempo`.
 *   El pie va en la prop `pie` de PanelLateral (NO en un portal propio, D38) con la acción principal según el estado.
 *   Dentro no hay Combo ni diálogos con portal (el PanelLateral es modal y les quitaría los clics): descartar es un
 *   formulario en línea y convertir / desenlazar se confirman en el propio pie.
 *
 * API
 *   <PanelEnvioPropuesto envioId onCerrar onConvertida usuarioId? esAdmin? puedeEditar? hoy? />
 *     envioId null = cerrado. onConvertida(remesaId, clienteId) también se llama con «Abrir la remesa» (ir a ella).
 *     usuarioId / esAdmin: si no se pasan, se leen de la sesión del navegador (Supabase).
 *
 * Puro (con prueba en plan.prueba.ts): hitoDeEvento(evento, nombres) · ordenarEquipo(personas) · fueraDelPlan(lineas)
 */

/* ------------------------------------------------------------------ */
/* Puro                                                                */
/* ------------------------------------------------------------------ */

export interface PersonaEquipo {
  id: string
  nombre: string
  role: string
  puesto: string | null
}

/** Gestión administrativa primero (son los que llevan los envíos), luego los admin; por nombre */
export function ordenarEquipo(personas: readonly PersonaEquipo[]): PersonaEquipo[] {
  const peso = (p: PersonaEquipo) => (p.puesto === 'gestion_administrativa' ? 0 : p.role === 'admin' ? 1 : 2)
  return [...personas].sort((a, b) => peso(a) - peso(b) || a.nombre.localeCompare(b.nombre, 'es'))
}

const ICONO_ACCION: Record<string, LucideIcon> = {
  crear: Sparkles,
  actualizar_plan: RefreshCw,
  estado: ArrowRight,
  responsable: UserPlus,
  fecha_limite: Clock,
  nota: MessageSquare,
  convertir: PackagePlus,
  ajuste_ia: Sparkles,
  caducar: PackageMinus,
  remesa_borrada: Link2Off,
  desenlazar: Link2Off,
  remesa_enviada: Truck,
  remesa_vuelve_a_lista: RotateCcw,
}

const esEstado = (x: string | null): x is EstadoEnvioPropuesto => !!x && x in ESTADO_ENVIO

/** Un apunte del historial como hito de la LineaDeTiempo (título, descripción y tono) */
export function hitoDeEvento(
  ev: Pick<EventoHistorialEnvio, 'accion' | 'de' | 'a' | 'nota' | 'datos'>,
  nombres: ReadonlyMap<string, string> = new Map()
): { titulo: string; descripcion: string | null; tono: TonoEstado } {
  const nombre = (id: string | null) => (id ? nombres.get(id) ?? 'otra persona' : null)
  const nota = ev.nota?.trim() || null
  switch (ev.accion) {
    case 'crear':
      return { titulo: 'El plan lo propone', descripcion: nota, tono: 'azul' }
    case 'actualizar_plan':
      return {
        titulo: 'El plan cambia las cifras',
        descripcion: ev.de && ev.a ? `${ev.de} → ${ev.a}${nota ? ` · ${nota}` : ''}` : nota,
        tono: 'gris',
      }
    case 'estado': {
      const a = esEstado(ev.a) ? ESTADO_ENVIO[ev.a] : null
      const motivo = typeof ev.datos?.motivoDescarte === 'string' ? MOTIVO_DESCARTE[ev.datos.motivoDescarte as MotivoDescarte] ?? null : null
      return {
        titulo: a ? `Pasa a «${a.texto}»` : `Cambia de estado${ev.a ? ` a ${ev.a}` : ''}`,
        descripcion: [motivo, nota].filter(Boolean).join(' · ') || null,
        tono: a?.tono ?? 'gris',
      }
    }
    case 'responsable':
      return ev.a
        ? { titulo: `Responsable: ${nombre(ev.a)}`, descripcion: ev.de ? `antes: ${nombre(ev.de)}` : null, tono: 'cian' }
        : { titulo: 'Se queda sin responsable', descripcion: ev.de ? `antes: ${nombre(ev.de)}` : null, tono: 'gris' }
    case 'fecha_limite':
      return { titulo: `Fecha límite: ${fechaCorta(ev.a)}`, descripcion: ev.de ? `antes: ${fechaCorta(ev.de)}` : null, tono: 'ambar' }
    case 'nota':
      return { titulo: 'Nota', descripcion: nota, tono: 'gris' }
    case 'convertir':
      return { titulo: 'Convertido en remesa', descripcion: nota, tono: 'violeta' }
    case 'ajuste_ia':
      return { titulo: 'Ajuste aplicado', descripcion: nota ?? (ev.a ? String(ev.a) : null), tono: 'azul' }
    case 'caducar':
      return { titulo: 'Caduca: el plan ya no lo pide', descripcion: nota, tono: 'gris' }
    case 'remesa_borrada':
      return { titulo: 'Se borró la remesa: vuelve a «Hablado»', descripcion: nota, tono: 'ambar' }
    case 'desenlazar':
      return { titulo: 'Desenlazado de la remesa', descripcion: nota, tono: 'ambar' }
    case 'remesa_enviada':
      return { titulo: 'La remesa ha salido', descripcion: nota, tono: 'verde' }
    case 'remesa_vuelve_a_lista':
      return { titulo: 'La remesa vuelve a «lista»', descripcion: nota ?? 'Se había marcado como enviada por error', tono: 'ambar' }
    default:
      return { titulo: ev.accion.replace(/_/g, ' '), descripcion: nota, tono: 'gris' }
  }
}

/** Las referencias del plan que se quedan fuera (con motivo), sin repetir SKU */
export function fueraDelPlan(lineas: readonly LineaPlan[]): LineaPlan[] {
  const vistos = new Set<string>()
  const salida: LineaPlan[] = []
  for (const l of lineas) {
    if (!l.fuera || vistos.has(l.sku)) continue
    vistos.add(l.sku)
    salida.push(l)
  }
  return salida
}

/* ------------------------------------------------------------------ */
/* Datos de la sesión y del equipo (navegador)                         */
/* ------------------------------------------------------------------ */

function useYo(dado: { usuarioId?: string | null; esAdmin?: boolean }) {
  const [yo, setYo] = useState<{ id: string | null; esAdmin: boolean }>({ id: dado.usuarioId ?? null, esAdmin: dado.esAdmin ?? false })
  const faltan = dado.usuarioId === undefined || dado.esAdmin === undefined
  useEffect(() => {
    if (!faltan) {
      setYo({ id: dado.usuarioId ?? null, esAdmin: dado.esAdmin ?? false })
      return
    }
    let vivo = true
    void (async () => {
      try {
        const supabase = createClient()
        const { data } = await supabase.auth.getUser()
        const id = data.user?.id ?? null
        let esAdmin = false
        if (id) {
          const { data: p } = await supabase.from('profiles').select('role').eq('id', id).maybeSingle()
          esAdmin = (p as { role?: string } | null)?.role === 'admin'
        }
        if (vivo) setYo({ id: dado.usuarioId ?? id, esAdmin: dado.esAdmin ?? esAdmin })
      } catch {
        /* sin sesión legible: solo se pierde «Asignarme» */
      }
    })()
    return () => {
      vivo = false
    }
  }, [faltan, dado.usuarioId, dado.esAdmin])
  return yo
}

function useEquipo(activo: boolean) {
  const [equipo, setEquipo] = useState<PersonaEquipo[]>([])
  useEffect(() => {
    if (!activo) return
    let vivo = true
    void (async () => {
      try {
        const { data } = await createClient().from('profiles').select('id, full_name, email, role, puesto').in('role', ['admin', 'employee'])
        const filas = (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null; role: string; puesto: string | null }>
        if (vivo) setEquipo(ordenarEquipo(filas.map((f) => ({ id: f.id, nombre: f.full_name || f.email || 'Sin nombre', role: f.role, puesto: f.puesto ?? null }))))
      } catch {
        /* sin lista: el admin solo podrá asignarse o soltar */
      }
    })()
    return () => {
      vivo = false
    }
  }, [activo])
  return equipo
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

function Seccion({ titulo, icono: Icono, children, derecha }: { titulo: string; icono?: LucideIcon; children: ReactNode; derecha?: ReactNode }) {
  return (
    <section className="min-w-0 border-t border-[var(--ls-linea)] pt-4">
      <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
        <h3 className="flex items-center gap-[7px] text-[13px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]">
          {Icono && <Icono className="h-[14px] w-[14px] text-[var(--ls-t3)]" aria-hidden />}
          {titulo}
        </h3>
        {derecha}
      </div>
      {children}
    </section>
  )
}

function Aviso({ tono, children, accion }: { tono: TonoEstado; children: ReactNode; accion?: ReactNode }) {
  const color = COLOR_ESTADO[tono]
  return (
    <div
      role={tono === 'rojo' ? 'alert' : undefined}
      className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-[10px] border px-3 py-[9px] text-[12.5px] leading-[1.5] text-[var(--ls-t2)]"
      style={{ borderColor: `color-mix(in srgb, ${color} 38%, transparent)`, background: `color-mix(in srgb, ${color} 9%, transparent)` }}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {accion}
    </div>
  )
}

const CAMPO = cx(
  'w-full min-w-0 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 py-[7px] text-[13px] text-[var(--ls-t1)] placeholder:text-[var(--ls-t4)] [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:text-[16px]',
  FOCO
)

const ACTIVOS: readonly EstadoEnvioPropuesto[] = ['nuevo', 'hablado', 'esperando_cliente']

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function PanelEnvioPropuesto({
  envioId,
  onCerrar,
  onConvertida,
  usuarioId,
  esAdmin,
  puedeEditar = true,
  hoy: hoyDado,
}: PanelEnvioPropuestoProps & { usuarioId?: string | null; esAdmin?: boolean; puedeEditar?: boolean; hoy?: string }) {
  const hoy = hoyDado ?? diaEnEspana()
  const leido = useEnvioPropuesto(envioId)
  const historial = useHistorialEnvio(envioId)
  const { cambiar, convertir, ocupado } = useEnviosPropuestos(null)
  const yo = useYo({ usuarioId, esAdmin })
  const equipo = useEquipo(!!envioId && yo.esAdmin)

  // Lo último que devolvió un PATCH manda sobre lo leído hasta que la lectura lo alcance (misma versión o más)
  const [propio, setPropio] = useState<EnvioPropuestoGuardado | null>(null)
  const [conflicto, setConflicto] = useState<string | null>(null)
  const [modo, setModo] = useState<'normal' | 'descartar'>('normal')
  const [confirmando, setConfirmando] = useState<'convertir' | 'desenlazar' | null>(null)
  const [revisando, setRevisando] = useState(false)
  const [aplicando, setAplicando] = useState<string | null>(null)
  const [verFuera, setVerFuera] = useState(false)

  useEffect(() => {
    setPropio(null)
    setConflicto(null)
    setModo('normal')
    setConfirmando(null)
    setVerFuera(false)
  }, [envioId])

  const e: EnvioPropuestoGuardado | null =
    propio && propio.id === envioId && (!leido.envio || leido.envio.version <= propio.version) ? propio : leido.envio && leido.envio.id === envioId ? leido.envio : null

  const plan = usePlan(e?.clienteId ?? null)
  const plazo = plan.deAgencia && plan.plan && 'plazo' in plan.plan ? plan.plan.plazo : null
  const lineasFuera = useMemo(() => {
    if (plan.deAgencia && plan.plan && 'lineas' in plan.plan) return fueraDelPlan(plan.plan.lineas as LineaPlan[])
    return e ? fueraDelPlan(e.lineas) : []
  }, [plan.deAgencia, plan.plan, e])

  // Borradores de la cabecera
  const [fechaLimite, setFechaLimite] = useState('')
  const [nota, setNota] = useState('')
  useEffect(() => {
    if (!e) return
    setFechaLimite(e.fechaLimite)
    setNota(e.nota ?? '')
    // Solo al cambiar de envío o de versión: no se pisa lo que se está escribiendo por un refresco igual
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e?.id, e?.version])

  const nombres = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of equipo) m.set(p.id, p.nombre)
    if (e?.responsableId && e.responsableNombre) m.set(e.responsableId, e.responsableNombre)
    return m
  }, [equipo, e?.responsableId, e?.responsableNombre])

  const abierto = envioId !== null
  const activo = !!e && ACTIVOS.includes(e.estado)
  const editable = !!e && puedeEditar && activo
  const trabajando = !!e && ocupado === e.id

  /* ---------------- Escrituras ---------------- */

  async function aplicarCambio(cambio: CambioEnvioPropuesto, exito: string): Promise<boolean> {
    if (!e) return false
    const r = await cambiar(e, cambio)
    if (r.ok) {
      setPropio(r.envio)
      setConflicto(null)
      if (r.aviso) toast.warning(r.aviso)
      else toast.success(exito)
      void historial.recargar()
      return true
    }
    if (r.estado === 409 && (r.conflicto || /cambiado|cambiar/i.test(r.error))) {
      setConflicto(r.error)
      return false
    }
    toast.error(r.error)
    return false
  }

  async function hacerConvertir() {
    if (!e) return
    const r = await convertir(e)
    setConfirmando(null)
    if (r.ok) {
      toast.success(r.yaExistia ? 'Este envío ya tenía su remesa: te llevo a ella' : 'Remesa creada en borrador')
      if (!r.analisisGuardado) toast.message('La explicación del plan no se ha podido guardar en la remesa (falta una migración); la remesa está bien.')
      onConvertida(r.remesaId, e.clienteId)
      onCerrar()
      return
    }
    if (r.conflicto) setConflicto(r.error)
    else toast.error(r.error)
  }

  async function revisarConIa() {
    if (!e) return
    setRevisando(true)
    try {
      let res: Response
      try {
        res = await fetch('/api/fba/plan/ia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clienteId: e.clienteId, envioId: e.id }) })
      } catch {
        toast.error('No hay conexión con el servidor: comprueba la red y vuelve a probar.')
        return
      }
      const r = await leerRespuesta<{ revision: { aviso: string | null } }>(res, 'No se ha podido revisar el plan con la IA')
      if (!r.ok) {
        if (r.estado === 429) toast.message(r.error)
        else toast.error(r.error)
        return
      }
      if (r.datos.revision?.aviso) toast.warning(`La revisión de la IA no ha llegado: ${r.datos.revision.aviso}`)
      else toast.success('Plan revisado por la IA')
      setPropio(null)
      invalidarRemesas(e.clienteId)
      void historial.recargar()
    } finally {
      setRevisando(false)
    }
  }

  async function aplicarAjuste(a: AjusteIa) {
    setAplicando(a.sku)
    try {
      await aplicarCambio({ aplicarAjuste: a }, 'Ajuste aplicado y recalculado')
    } finally {
      setAplicando(null)
    }
  }

  function recargarTodo() {
    setPropio(null)
    setConflicto(null)
    void leido.recargar()
    void historial.recargar()
  }

  /* ---------------- Pie ---------------- */

  const pie = !e || modo === 'descartar' ? undefined : (() => {
    if (confirmando) {
      const ud = filasDelEnvio(e).reduce((s, f) => s + (f.acordada ?? f.hoy), 0)
      return (
        <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-[12.5px] leading-[1.45] text-[var(--ls-t2)]">
            {confirmando === 'convertir'
              ? `Se crea una remesa en borrador con ${entero(ud)} ud (${e.lineasAceptadas ? 'lo hablado' : 'el plan de hoy'}). Después sigue el flujo de siempre.`
              : 'Vuelve a «Hablado». Solo se puede mientras la remesa siga en borrador.'}
          </p>
          <div className="flex shrink-0 gap-2">
            <Boton variante="secundario" onClick={() => setConfirmando(null)} disabled={trabajando}>
              Cancelar
            </Boton>
            <Boton
              variante="primario"
              cargando={trabajando}
              onClick={() =>
                confirmando === 'convertir'
                  ? void hacerConvertir()
                  : void aplicarCambio({ estado: 'hablado' }, 'Desenlazado: vuelve a «Hablado»').then(() => setConfirmando(null))
              }
            >
              {confirmando === 'convertir' ? 'Sí, crear la remesa' : 'Sí, desenlazar'}
            </Boton>
          </div>
        </div>
      )
    }
    const botones: ReactNode[] = []
    const prim = (texto: string, icono: LucideIcon, accion: () => void) => (
      <Boton key="p" variante="primario" icono={icono} onClick={accion} disabled={trabajando} cargando={trabajando} className="w-full sm:w-auto">
        {texto}
      </Boton>
    )
    const sec = (k: string, texto: string, icono: LucideIcon, accion: () => void, variante: 'secundario' | 'fantasma' = 'secundario') => (
      <Boton key={k} variante={variante} icono={icono} onClick={accion} disabled={trabajando}>
        {texto}
      </Boton>
    )
    if (puedeEditar) {
      if (activo) {
        botones.push(sec('d', 'Descartar', Ban, () => setModo('descartar'), 'fantasma'))
        if (e.estado === 'nuevo') botones.push(sec('h', 'Hablado', MessageSquare, () => void aplicarCambio({ estado: 'hablado' }, 'Marcado como hablado: se congela lo hablado')))
        if (e.estado === 'hablado') botones.push(sec('e', 'Esperando al cliente', Clock, () => void aplicarCambio({ estado: 'esperando_cliente' }, 'Esperando al cliente')))
        if (e.estado === 'esperando_cliente') botones.push(sec('c', 'Ha contestado', CheckCircle2, () => void aplicarCambio({ estado: 'hablado' }, 'Vuelve a «Hablado»')))
        botones.push(prim('Convertir en remesa', PackagePlus, () => setConfirmando('convertir')))
      } else if (e.estado === 'en_preparacion') {
        botones.push(sec('u', 'Desenlazar', Link2Off, () => setConfirmando('desenlazar'), 'fantasma'))
      } else if (e.estado === 'descartado') {
        botones.push(prim('Recuperar', RotateCcw, () => void aplicarCambio({ estado: 'nuevo' }, 'Recuperado: vuelve a «Nuevo»')))
      }
    }
    if (e.remesaId && (e.estado === 'en_preparacion' || e.estado === 'enviado')) {
      botones.push(prim('Abrir la remesa', ArrowRight, () => {
        onConvertida(e.remesaId as string, e.clienteId)
        onCerrar()
      }))
    }
    if (botones.length === 0) {
      botones.push(
        <Boton key="x" variante="secundario" onClick={onCerrar}>
          Cerrar
        </Boton>
      )
    }
    return <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2">{botones}</div>
  })()

  /* ---------------- Cuerpo ---------------- */

  const p = e ? PRIORIDAD[e.prioridad] : null
  const titulo = e ? `${e.clienteNombre} · Envío de la semana ${semanaDelEnvio(e)}` : 'Envío propuesto'
  const descripcion = e ? `Salir antes del ${fechaCorta(e.salirAntesDe, hoy)} · ${entero(e.unidades)} ud` : leido.cargando ? 'Cargando…' : undefined

  let cuerpo: ReactNode
  if (!e) {
    cuerpo = leido.error ? (
      <EstadoVacio
        compacto
        icono={PackageMinus}
        titulo={leido.estado === 404 ? 'Este envío propuesto ya no existe' : 'No se ha podido abrir el envío'}
        descripcion={leido.error}
        accion={leido.estado === 404 ? undefined : { texto: 'Volver a probar', onClick: () => void leido.recargar(), icono: RefreshCw }}
      />
    ) : (
      <div className="space-y-4">
        <EsqueletoTexto lineas={3} />
        <EsqueletoTexto lineas={5} />
      </div>
    )
  } else if (modo === 'descartar') {
    cuerpo = (
      <div className="min-w-0">
        <p className="mb-3 text-[13px] text-[var(--ls-t2)]">
          Descartar el envío de <b>{e.clienteNombre}</b> que tenía que salir antes del {fechaCorta(e.salirAntesDe, hoy)}.
        </p>
        <FormularioDescarte
          unidades={e.unidades}
          onCancelar={() => setModo('normal')}
          onConfirmar={async (motivo, n) => {
            // Con varias referencias, «descatalogada» no excluye ninguna sola (el servidor avisa de dónde hacerlo)
            const unaSola = new Set((e.lineasAceptadas ?? e.lineas).filter((l) => l.cantidad > 0).map((l) => l.sku)).size <= 1
            const ok = await aplicarCambio({ estado: 'descartado', motivoDescarte: motivo, nota: n }, motivo === 'descatalogada' && unaSola ? 'Descartado: la referencia deja de planificarse' : 'Envío descartado')
            if (ok) setModo('normal')
            return ok
          }}
        />
      </div>
    )
  } else {
    const conf = CONFIANZA[e.confianza]
    const cuenta = activo ? cuentaAtras(e.fechaLimite, hoy) : null
    const avisoFecha = fechaLimite ? avisoDeFechaLimite(fechaLimite, e.decidirAntesDe) : null
    const cambiaFecha = !!fechaLimite && fechaLimite !== e.fechaLimite
    const cambiaNota = nota.trim() !== (e.nota ?? '').trim()
    const cambios = e.cambiosDesdeAyer
    const esMio = !!yo.id && e.responsableId === yo.id

    cuerpo = (
      <div className="min-w-0 space-y-4">
        {conflicto && (
          <Aviso
            tono="rojo"
            accion={
              <Boton tamano="sm" variante="secundario" icono={RefreshCw} onClick={recargarTodo}>
                Recargar
              </Boton>
            }
          >
            {conflicto}
          </Aviso>
        )}
        {e.planYaNoLoPide && activo && <Aviso tono="ambar">El plan de hoy ya no pide este envío. Decide si sigue adelante o se descarta: no caduca solo porque ya se habló.</Aviso>}
        {e.provisional && <Aviso tono="ambar">Plan provisional: las ventas no están al día y las fechas pueden moverse.</Aviso>}
        {e.estado === 'descartado' && e.motivoDescarte && (
          <Aviso tono="gris">
            Descartado: {MOTIVO_DESCARTE[e.motivoDescarte]}
            {e.nota ? ` · ${e.nota}` : ''}
          </Aviso>
        )}

        {/* Insignias y fechas */}
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-[6px]">
            {p && (
              <Insignia tono={p.tono} variante={p.variante} vivo={p.vivo}>
                {p.texto}
              </Insignia>
            )}
            <Insignia tono={ESTADO_ENVIO[e.estado].tono} variante={ESTADO_ENVIO[e.estado].variante}>
              {ESTADO_ENVIO[e.estado].texto}
            </Insignia>
            {e.vencido && (
              <Insignia tono="rojo" variante="solida">
                Vencido
              </Insignia>
            )}
            {conf && (
              <Insignia tono={conf.tono} variante={conf.variante} tamano="sm">
                {conf.texto}
              </Insignia>
            )}
          </div>
          <dl className="grid min-w-0 grid-cols-3 gap-2 rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-3">
            {[
              { k: 'Decidir antes del', c: 'Decidir', v: e.decidirAntesDe, fuerte: activo },
              { k: 'Salir antes del', c: 'Salir', v: e.salirAntesDe, fuerte: false },
              { k: 'A la venta el', c: 'A la venta', v: e.aLaVenta, fuerte: false },
            ].map((x) => (
              <div key={x.k} className="min-w-0">
                <dt className="truncate text-[10.5px] uppercase tracking-[0.05em] text-[var(--ls-t4)]" title={x.k}>
                  <span className="sm:hidden">{x.c}</span>
                  <span className="hidden sm:inline">{x.k}</span>
                </dt>
                <dd className={cx('truncate text-[14px] tabular-nums', x.fuerte ? 'font-semibold text-[var(--ls-t1)]' : 'text-[var(--ls-t2)]')}>{fechaCorta(x.v, hoy)}</dd>
              </div>
            ))}
          </dl>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] tabular-nums text-[var(--ls-t2)]">
            <span>
              <b className="text-[var(--ls-t1)]">{entero(e.unidades)}</b> ud
            </span>
            {e.cajasEstimadas != null && e.cajasEstimadas > 0 && <span>~{entero(e.cajasEstimadas)} cajas</span>}
            {e.eurosEnRiesgo != null && e.eurosEnRiesgo > 0 && (
              <span>
                <b style={{ color: COLOR_ESTADO[e.prioridad === 'tarde' || e.prioridad === 'urgente' ? 'rojo' : 'naranja'] }}>{dinero(e.eurosEnRiesgo, e.moneda)}</b> en juego si no sale
              </span>
            )}
            {cuenta && <span style={{ color: cuenta.tono === 'gris' ? undefined : COLOR_ESTADO[cuenta.tono] }}>{cuenta.texto}</span>}
          </p>
        </div>

        {/* Gestión: responsable, fecha límite y nota */}
        <div className="grid min-w-0 gap-3 rounded-[12px] border border-[var(--ls-linea)] p-3 sm:grid-cols-2">
          <div className="min-w-0 sm:col-span-2">
            <p className="mb-1 text-[12px] text-[var(--ls-t3)]">Responsable</p>
            {yo.esAdmin && editable && equipo.length > 0 ? (
              <select
                className={CAMPO}
                value={e.responsableId ?? ''}
                disabled={trabajando}
                aria-label="Responsable del envío"
                onChange={(ev) => {
                  const v = ev.target.value || null
                  void aplicarCambio({ responsableId: v }, v ? `Asignado a ${nombres.get(v) ?? 'esa persona'}` : 'Sin responsable')
                }}
              >
                <option value="">Sin responsable (avisa a todo el equipo)</option>
                {e.responsableId && !equipo.some((x) => x.id === e.responsableId) && <option value={e.responsableId}>{e.responsableNombre ?? 'Asignado'}</option>}
                {equipo.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nombre}
                    {x.id === yo.id ? ' (tú)' : ''}
                    {x.puesto === 'gestion_administrativa' ? ' · gestión administrativa' : x.role === 'admin' ? ' · admin' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-[13px] text-[var(--ls-t1)]">{e.responsableNombre ?? (e.responsableId ? 'Asignado' : 'Nadie todavía')}</span>
                {editable && yo.id && !e.responsableId && (
                  <Boton tamano="sm" variante="secundario" icono={UserPlus} disabled={trabajando} onClick={() => void aplicarCambio({ responsableId: yo.id }, 'Ahora es tuyo')}>
                    Asignarme
                  </Boton>
                )}
                {editable && esMio && (
                  <Boton tamano="sm" variante="fantasma" icono={UserMinus} disabled={trabajando} onClick={() => void aplicarCambio({ responsableId: null }, 'Lo has soltado')}>
                    Soltar
                  </Boton>
                )}
              </div>
            )}
            {!e.responsableId && activo && <p className="mt-1 text-[11.5px] text-[var(--ls-t4)]">Sin responsable, los avisos van a gestión administrativa y a los administradores.</p>}
          </div>

          <div className="min-w-0">
            <label htmlFor={`limite-${e.id}`} className="mb-1 block text-[12px] text-[var(--ls-t3)]">
              Fecha límite
            </label>
            <div className="flex min-w-0 gap-2">
              <input
                id={`limite-${e.id}`}
                type="date"
                className={CAMPO}
                value={fechaLimite}
                min={hoy}
                disabled={!editable || trabajando}
                onChange={(ev) => setFechaLimite(ev.target.value)}
              />
              {cambiaFecha && editable && (
                <Boton variante="secundario" disabled={trabajando} onClick={() => void aplicarCambio({ fechaLimite }, 'Fecha límite guardada')}>
                  Guardar
                </Boton>
              )}
            </div>
            <p className="mt-1 text-[11.5px]" style={{ color: avisoFecha ? COLOR_ESTADO.ambar : undefined }}>
              {avisoFecha ?? <span className="text-[var(--ls-t4)]">Por defecto, el día que hay que decidir ({fechaCorta(e.decidirAntesDe, hoy)}).</span>}
            </p>
          </div>

          <div className="min-w-0">
            <label htmlFor={`nota-${e.id}`} className="mb-1 block text-[12px] text-[var(--ls-t3)]">
              Nota
            </label>
            <textarea
              id={`nota-${e.id}`}
              rows={2}
              maxLength={1000}
              className={cx(CAMPO, 'resize-y')}
              value={nota}
              disabled={!puedeEditar || trabajando}
              placeholder="Lo que ha dicho el cliente, qué falta…"
              onChange={(ev) => setNota(ev.target.value)}
            />
            {cambiaNota && puedeEditar && (
              <div className="mt-[6px] flex justify-end gap-2">
                <Boton tamano="sm" variante="fantasma" onClick={() => setNota(e.nota ?? '')} disabled={trabajando}>
                  Deshacer
                </Boton>
                <Boton tamano="sm" variante="secundario" disabled={trabajando} onClick={() => void aplicarCambio({ nota: nota.trim() || null }, 'Nota guardada')}>
                  Guardar nota
                </Boton>
              </div>
            )}
          </div>
        </div>

        {/* Qué ha cambiado desde ayer */}
        {cambios && (cambios.frases.length > 0 || cambios.unidadesAntes !== cambios.unidadesAhora || cambios.salidaAntes !== cambios.salidaAhora || cambios.prioridadAntes !== cambios.prioridadAhora) && (
          <Seccion titulo="Qué ha cambiado desde ayer" icono={GitCompareArrows}>
            <ul className="space-y-[5px] text-[12.5px] tabular-nums text-[var(--ls-t2)]">
              {cambios.unidadesAntes !== cambios.unidadesAhora && (
                <li>
                  Unidades: {entero(cambios.unidadesAntes)} → <b className="text-[var(--ls-t1)]">{entero(cambios.unidadesAhora)}</b>
                </li>
              )}
              {cambios.salidaAntes && cambios.salidaAntes !== cambios.salidaAhora && (
                <li>
                  Salida: antes del {fechaCorta(cambios.salidaAntes, hoy)} → <b className="text-[var(--ls-t1)]">antes del {fechaCorta(cambios.salidaAhora, hoy)}</b>
                </li>
              )}
              {cambios.prioridadAntes && cambios.prioridadAntes !== cambios.prioridadAhora && (
                <li>
                  Prioridad: {PRIORIDAD[cambios.prioridadAntes as Prioridad]?.texto ?? cambios.prioridadAntes} →{' '}
                  <b className="text-[var(--ls-t1)]">{PRIORIDAD[cambios.prioridadAhora]?.texto ?? cambios.prioridadAhora}</b>
                </li>
              )}
              {cambios.frases.map((f, i) => (
                <li key={i} className="text-[var(--ls-t3)]">
                  {f}
                </li>
              ))}
            </ul>
          </Seccion>
        )}

        {e.porque.length > 0 && (
          <Seccion titulo="Por qué hay que enviarlo">
            <ul className="space-y-[6px] text-[12.5px] leading-[1.55] text-[var(--ls-t2)]">
              {e.porque.map((f, i) => (
                <li key={i} className="border-l-2 pl-[10px]" style={{ borderColor: p ? `color-mix(in srgb, ${COLOR_ESTADO[p.tono]} 55%, transparent)` : undefined }}>
                  {f}
                </li>
              ))}
            </ul>
          </Seccion>
        )}

        <Seccion titulo="Referencias del envío" icono={ListChecks}>
          <LineasDelEnvio envio={e} hoy={hoy} plazo={plazo} />
        </Seccion>

        <Seccion
          titulo="Fuera del envío"
          icono={PackageMinus}
          derecha={
            <button
              type="button"
              onClick={() => setVerFuera((v) => !v)}
              aria-expanded={verFuera}
              className={cx('rounded-[8px] px-2 text-[12px] font-medium text-[var(--ls-t2)] hover:text-[var(--ls-t1)]', TACTIL, FOCO)}
            >
              {verFuera ? 'Ocultar' : `Ver (${lineasFuera.length})`}
            </button>
          }
        >
          {verFuera ? (
            <FueraDelEnvio lineas={lineasFuera} hoy={hoy} />
          ) : (
            <p className="text-[12px] text-[var(--ls-t4)]">Las referencias del cliente que el plan no propone, con el motivo de cada una.</p>
          )}
        </Seccion>

        <Seccion titulo="Revisión de la IA" icono={Sparkles}>
          <RevisionIa
            revision={e.ia}
            ajustesAplicados={e.ajustesAplicados ?? []}
            puedeEditar={editable}
            revisando={revisando}
            aplicando={aplicando}
            onRevisar={() => void revisarConIa()}
            onAplicar={aplicarAjuste}
            moneda={e.moneda}
          />
        </Seccion>

        <Seccion titulo="Historial" icono={History}>
          {historial.cargando && historial.eventos.length === 0 ? (
            <EsqueletoTexto lineas={3} />
          ) : historial.eventos.length === 0 ? (
            <p className="text-[12px] text-[var(--ls-t4)]">{historial.error ?? 'Todavía no hay movimientos.'}</p>
          ) : (
            <LineaDeTiempo
              eventos={historial.eventos.map((ev): Hito => {
                const h = hitoDeEvento(ev, nombres)
                return { id: ev.id, titulo: h.titulo, descripcion: h.descripcion ?? undefined, cuando: ev.cuando, tono: h.tono, icono: ICONO_ACCION[ev.accion], autor: ev.quienNombre ?? (ev.quien ? undefined : 'El plan') }
              })}
            />
          )}
        </Seccion>
      </div>
    )
  }

  return (
    <PanelLateral
      abierto={abierto}
      onCambio={(a) => {
        if (!a) onCerrar()
      }}
      titulo={titulo}
      descripcion={descripcion}
      icono={Truck}
      acento="remesas"
      ancho={640}
      pie={pie}
    >
      {cuerpo}
    </PanelLateral>
  )
}
