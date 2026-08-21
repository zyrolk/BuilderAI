export const WORKFLOW_LEASE_SCHEMA_VERSION = 1 as const;

export interface WorkflowLease {
  readonly schemaVersion: typeof WORKFLOW_LEASE_SCHEMA_VERSION;
  readonly workflowId: string;
  readonly ownerIdentity: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

export type WorkflowLeaseOutcome =
  | { readonly kind: 'ACQUIRED'; readonly lease: WorkflowLease }
  | { readonly kind: 'HELD_BY_OTHER'; readonly holder: string; readonly expiresAt: string }
  | { readonly kind: 'STALE'; readonly previousHolder: string }
  | { readonly kind: 'RECOVERY_REQUIRED'; readonly message: string };
