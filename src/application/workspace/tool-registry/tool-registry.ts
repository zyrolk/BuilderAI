import type { ToolPolicyGate } from './tool-policy';
import {
  TOOL_ID_MAX_CHARS,
  ToolRegistryError,
  type ToolDefinition,
  type ToolHandler,
} from './tool-registry.types';

/**
 * In-process catalog of B1 tool handlers. Rejects mutating / APPLY / non-B1 classes at register.
 * Intentionally has no FileApply or provider dependencies.
 */
export class ToolRegistry {
  private readonly handlers = new Map<string, ToolHandler>();

  constructor(private readonly policy: ToolPolicyGate) {}

  register(handler: ToolHandler): void {
    const toolId = handler.definition.toolId.trim();
    if (
      toolId.length === 0 ||
      toolId.length > TOOL_ID_MAX_CHARS ||
      !/^[a-z][a-z0-9_]*$/.test(toolId)
    ) {
      throw new ToolRegistryError('INVALID_DEFINITION', 'Invalid toolId.');
    }
    this.policy.assertRegistrable(handler.definition);
    if (this.handlers.has(toolId)) {
      throw new ToolRegistryError('DUPLICATE_TOOL', `Tool ${toolId} is already registered.`);
    }
    this.handlers.set(toolId, handler);
  }

  get(toolId: string): ToolHandler | undefined {
    return this.handlers.get(toolId);
  }

  require(toolId: string): ToolHandler {
    const handler = this.handlers.get(toolId);
    if (handler === undefined) {
      throw new ToolRegistryError('UNKNOWN_TOOL', `Unknown tool ${toolId}.`);
    }
    return handler;
  }

  listDefinitions(): readonly ToolDefinition[] {
    return [...this.handlers.values()].map((handler) => handler.definition);
  }

  /** Composition guard: registry never exposes FileApply-shaped keys. */
  dependencySurface(): readonly string[] {
    return ['ToolPolicyGate', 'ToolHandler'];
  }
}
