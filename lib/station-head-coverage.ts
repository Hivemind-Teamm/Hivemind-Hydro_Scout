export type HeadCoverageAccount = {
  accountType: string | null;
  role: string | null;
  stationId: string | null;
  stationMembershipStatus?: string | null;
};

export function countPersonalHeads(
  accounts: readonly HeadCoverageAccount[],
  stationId: string,
): number {
  return accounts.filter(account =>
    account.accountType === 'person' &&
    account.role === 'head' &&
    account.stationId === stationId &&
    (
      account.stationMembershipStatus === undefined ||
      account.stationMembershipStatus === null ||
      account.stationMembershipStatus === 'none' ||
      account.stationMembershipStatus === 'approved'
    )
  ).length;
}
