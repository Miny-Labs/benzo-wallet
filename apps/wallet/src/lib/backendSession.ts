/**
 * A backend auth loss — a BFF 401 from an expired or absent SIWE session — must
 * only return the user to Onboarding when there is genuinely NO device-local
 * wallet. A valid device wallet stays put: its keys, encrypted balance, and
 * private send are local/on-chain and do not depend on the backend session.
 *
 * This is the single decision behind the "unplug the backend" litmus for auth:
 * the backend can reject every request and the self-custodial wallet survives.
 */
export function backendAuthLossEjectsWallet(hasLocalWallet: boolean): boolean {
  return !hasLocalWallet;
}
