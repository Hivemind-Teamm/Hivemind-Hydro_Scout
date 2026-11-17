
import type {
  Firestore,
  Transaction,
} from 'firebase-admin/firestore';

/**
 * Read occupancy claims belonging to one station response.
 *
 * Call this before any transaction writes.
 */
export async function readResponseHydrantClaims(
  db: Firestore,
  transaction: Transaction,
  responseId: string,
) {
  const query = db
    .collection('hydrantOccupancy')
    .where('responseId', '==', responseId);

  return transaction.get(query);
}

/**
 * Schedule removal of previously read claims.
 *
 * Must run inside the same transaction that ends
 * the corresponding station response.
 */
export function releaseResponseHydrantClaims(
  transaction: Transaction,
  claims: Awaited<ReturnType<typeof readResponseHydrantClaims>>,
) {
  for (const claim of claims.docs) {
    transaction.delete(claim.ref);
  }

  return claims.size;
}
