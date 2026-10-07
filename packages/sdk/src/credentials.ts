/**
 * A place that can say whether an address currently holds a credential of some kind, such as "kyc" or "over-18".
 *
 * This is only a seam for an app or a consumer to plug a verifier into. Credentials are deliberately **not** a condition
 * inside the policy contract, because the existing verifiers do not share a call shape; see `docs/CREDENTIALS.md`.
 * Nothing in this package implements it.
 */
export interface CredentialSource {
  /**
   * Whether `subject` (an address) holds an unexpired, unrevoked credential of `kind` right now. A verifier that
   * cannot answer should throw, not return `false`: a failure to check must not look like "does not hold it".
   */
  hasCredential(subject: string, kind: string): Promise<boolean>;
}
