export interface IncidentWakeLockController {
  start(): void;
  visibilityChanged(): void;
  stop(): void;
}

export interface IncidentWakeLockDependencies {
  request(): Promise<WakeLockSentinel>;
  isVisible(): boolean;
  onChange?(held: boolean): void;
}

export function createIncidentWakeLockController(
  dependencies: IncidentWakeLockDependencies,
): IncidentWakeLockController;
