import type { EntradaDeFase } from '@/lib/crm/fases'
import type { FilaDeNota } from '@/lib/crm/gemini/tipos'
import type { CalendarPerson } from '@/lib/types/appointments'
import type { CrmClientWithDetails, CrmDocument, CrmInteraction, CrmStage } from '@/lib/types/crm'
import type { UserProfile } from '@/lib/supabase/get-user-profile'

export type Pestana = 'resumen' | 'reunion' | 'propuesta' | 'actividad' | 'documentos' | 'datos'

export const PESTANAS: ReadonlyArray<{ id: Pestana; nombre: string }> = [
  { id: 'resumen', nombre: 'Resumen' },
  { id: 'reunion', nombre: 'Reunión' },
  { id: 'propuesta', nombre: 'Propuesta' },
  { id: 'actividad', nombre: 'Actividad' },
  { id: 'documentos', nombre: 'Documentos' },
  { id: 'datos', nombre: 'Datos' },
]

/** Lo que reciben las seis pestañas de la ficha: la ficha, quién mira, cómo se guarda y lo que se ha leído de la base */
export interface ContextoFicha {
  client: CrmClientWithDetails
  team: CalendarPerson[]
  currentUser: UserProfile
  /** Dirección: puede cambiar la ficha. Quien solo supervisa la lee y apunta tomas de contacto */
  puedeEditar: boolean
  /** Guarda campos de crm_clients. Devuelve true si salió bien */
  patch: (campos: Partial<CrmClientWithDetails>) => Promise<boolean>
  commitText: (campo: keyof CrmClientWithDetails, valor: string) => void
  commitNumber: (campo: 'setup_budget' | 'maintenance_budget' | 'revenue_amount', valor: string) => void
  /** Mueve al cliente de fase, con el aviso «Deshacer» */
  cambiarFase: (etapa: CrmStage) => Promise<void>
  /** Todos los clientes del CRM, en ligero, para asignar una nota de reunión a otro */
  clientes: ReadonlyArray<{ id: string; nombre: string; empresa: string | null }>
  /** Cambia la cita de este cliente (cualificada, no cualificada, no asistió) por la ruta de la agenda */
  cambiarEstadoCita: (estado: 'qualified' | 'not_qualified' | 'no_show') => Promise<void>
  cambiandoCita: boolean
  interacciones: CrmInteraction[]
  setInteracciones: (l: CrmInteraction[]) => void
  documentos: CrmDocument[]
  setDocumentos: (l: CrmDocument[]) => void
  historial: EntradaDeFase[]
  notas: FilaDeNota[]
  cargando: boolean
  /** La migración 258 no está lanzada: no hay notas ni historial que leer */
  migracionFalta: boolean
  refrescarNotas: () => Promise<void>
  irA: (p: Pestana) => void
  /** Hora de referencia (milisegundos), para «lleva X días» y las acciones vencidas */
  ahora: number
}
