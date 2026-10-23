export interface IncidentLocationCleanupRegistry {
  register(uid: string, cleanup: () => Promise<void>): () => void;
  cleanup(uid: string): Promise<void>;
  readonly registeredUid: string | null;
}

export function createIncidentLocationCleanupRegistry():
  IncidentLocationCleanupRegistry;

export const incidentLocationCleanupRegistry:
  IncidentLocationCleanupRegistry;