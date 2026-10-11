// Release-owned facts, not user-editable checkboxes or caller booleans.
// Remain CLOSED until independent code review + permitted native tests + owner
// release decision are recorded against this exact artifact. No backend fallback.
export const READINESS = Object.freeze({ independentReview: false, nativeBrowserUi: false,
  nativeIndexedDB: false, nativeRestartRecovery: false, nativeCrossTab: false,
  nativeLifecycleQuota: false, browserPublicCors: false, ownerReleaseApproved: false });
export function assertPublicPilotReady() {
  if (!Object.values(READINESS).every(value => value === true)) throw Error('PUBLIC_PAPER_READINESS_GATE_CLOSED');
}
