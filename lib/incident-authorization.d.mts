export type IncidentRole =
  | "admin"
  | "sub_admin"
  | "head"
  | "authorized"
  | "general";

export interface IncidentAuthorizationInput {
  role?: IncidentRole | null;
  jurisdictionVerified?: boolean;
}

export function canManageIncident(
  input: IncidentAuthorizationInput
): boolean;
