'use client'

import { FileSignature, FileText, Loader2 } from 'lucide-react'
import { CrmDocuments } from '../CrmDocuments'
import { Seccion } from './piezas'
import type { ContextoFicha } from './tipos'

/** Propuestas y contratos del cliente: los PDF que se suben. Quien solo supervisa el equipo comercial no los ve (el bucket es público y la tabla se quedó fuera de su permiso, 212) */
export function PestanaDocumentos({ ctx }: { ctx: ContextoFicha }) {
  const cargando = (
    <p className="flex items-center gap-1.5 text-[11.5px] text-[var(--ls-t4)]">
      <Loader2 className="h-3 w-3 animate-spin" /> Cargando…
    </p>
  )
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Seccion titulo="Propuesta" icono={<FileText />}>
        {ctx.cargando ? cargando : <CrmDocuments clientId={ctx.client.id} kind="propuesta" label="Propuesta" documents={ctx.documentos} onChange={ctx.setDocumentos} puedeEditar={ctx.puedeEditar} />}
      </Seccion>
      <Seccion titulo="Contrato" icono={<FileSignature />}>
        {ctx.cargando ? cargando : <CrmDocuments clientId={ctx.client.id} kind="contrato" label="Contrato" documents={ctx.documentos} onChange={ctx.setDocumentos} puedeEditar={ctx.puedeEditar} />}
      </Seccion>
    </div>
  )
}
