export const BUILD_ENVIRONMENTS = ['production', 'staging', 'testing'] as const;
export type BuildEnvironment = typeof BUILD_ENVIRONMENTS[number];

export function isDeploymentUrl(value: string): boolean {
  if (!value || value.length > 2048 || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !!url.hostname
      && !url.username && !url.password
      && /^https?:\/\/[A-Za-z0-9][A-Za-z0-9.:-]*([/?#]\S*)?$/.test(value);
  } catch {
    return false;
  }
}
