export type AccountSort = 'name-asc' | 'name-desc' | 'tier-asc' | 'tier-desc' | 'last-login' | 'created';
type Account = { uid: string; displayName: string; role?: string | null; accountType?: string | null; lastLoginAt?: Date | null; createdAt?: Date | null };
const tiers: Record<string, number> = { general: 0, authorized: 1, head: 2, admin: 3 };
const rank = (account: Account) => account.accountType === 'station' ? 2
  : typeof account.role === 'string' && Object.hasOwn(tiers, account.role) ? tiers[account.role] : null;
const time = (date?: Date | null) => date && Number.isFinite(date.getTime()) ? date.getTime() : null;
const missingLast = (a: number | null, b: number | null, descending: boolean) =>
  a === null ? b === null ? 0 : 1 : b === null ? -1 : descending ? b - a : a - b;

export function sortAccountDirectory<T extends Account>(accounts: readonly T[], sort: AccountSort): T[] {
  return [...accounts].sort((a, b) => {
    const name = a.displayName.localeCompare(b.displayName) || a.uid.localeCompare(b.uid);
    if (sort === 'name-asc') return name;
    if (sort === 'name-desc') return -name;
    if (sort === 'tier-asc' || sort === 'tier-desc') return missingLast(rank(a), rank(b), sort === 'tier-desc') || name;
    return missingLast(time(sort === 'created' ? a.createdAt : a.lastLoginAt), time(sort === 'created' ? b.createdAt : b.lastLoginAt), true) || name;
  });
}
