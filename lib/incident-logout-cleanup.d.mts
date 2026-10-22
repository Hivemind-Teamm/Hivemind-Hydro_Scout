import type {
  IncidentLocationCleanupRegistry,
} from "./incident-location-cleanup-registry.mjs";

export interface IncidentLogoutCleanupOptions {
  uid: string;
  registry: IncidentLocationCleanupRegistry;
  getExistingDeviceId: () => string | null;
  deleteDeviceLocation: (uid: string) => Promise<void>;
}

export function cleanupIncidentLocationBeforeLogout(
  options: IncidentLogoutCleanupOptions
): Promise<void>;