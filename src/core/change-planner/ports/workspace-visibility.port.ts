/**
 * A read-only, synchronous capability that lets the Change Planner check whether a create, update, or
 * delete target's existence precondition currently holds. Implementations must be root-scoped and must
 * never create, modify, or delete anything. This port only informs planning-time warnings; the Safe
 * File Apply Engine remains the sole authority that revalidates and enforces preconditions before any
 * mutation occurs.
 */
export interface WorkspaceVisibilityPort {
  directoryExists(logicalPath: string): boolean;
  fileExists(logicalPath: string): boolean;
}
