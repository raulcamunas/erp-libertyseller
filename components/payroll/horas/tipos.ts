/** Cita que cobra (cualificada o semi-cualificada), con lo mínimo para contarla y listarla */
export interface QualifiedAppointment {
  id: string
  comercial_id: string | null
  status: string
  start_time: string
  lead_name: string
  lead_company: string | null
}
