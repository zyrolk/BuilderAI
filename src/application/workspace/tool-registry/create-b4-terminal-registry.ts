import { SafeVerificationRunner } from '../../../infrastructure/verification/safe-verification-runner';
import {
  ControlledTerminalService,
  type ControlledTerminalRunnerPort,
} from '../controlled-terminal/controlled-terminal.service';
import {
  createB3EditingRegistry,
  type B3EditingToolRegistryDeps,
} from './create-b3-editing-registry';
import type { ToolExecutor } from './tool-executor';
import type { ToolPolicyGate } from './tool-policy';
import type { ToolRegistry } from './tool-registry';
import { createInspectVerificationCatalogTool } from './tools/inspect-verification-catalog.tool';
import { createRunVerificationCommandTool } from './tools/run-verification-command.tool';

export interface B4TerminalToolRegistryDeps extends B3EditingToolRegistryDeps {
  readonly controlledTerminal: ControlledTerminalService;
}

/**
 * Additive B4 registry: B3 tools + catalog-only controlled terminal tools (ADR-040).
 * Must not wire FileApply, approveAndApply, unrestricted shell, Git write, MCP, or browser.
 */
export function createB4TerminalRegistry(deps: B4TerminalToolRegistryDeps): {
  readonly registry: ToolRegistry;
  readonly policy: ToolPolicyGate;
  readonly executor: ToolExecutor;
} {
  const { registry, policy, executor } = createB3EditingRegistry(deps);
  registry.register(
    createRunVerificationCommandTool({ controlledTerminal: deps.controlledTerminal }),
  );
  registry.register(
    createInspectVerificationCatalogTool({ controlledTerminal: deps.controlledTerminal }),
  );
  return { registry, policy, executor };
}

export interface CreateControlledTerminalServiceOptions {
  readonly builderAiRoot?: string;
  readonly stageTimeoutMs?: number;
  readonly outputLimitBytes?: number;
  readonly diagnosticSummaryMaxChars?: number;
  readonly createRunner?: (projectRoot: string) => ControlledTerminalRunnerPort;
}

/** Production helper: ControlledTerminalService backed by SafeVerificationRunner. */
export function createControlledTerminalService(
  options: CreateControlledTerminalServiceOptions = {},
): ControlledTerminalService {
  return new ControlledTerminalService({
    stageTimeoutMs: options.stageTimeoutMs,
    outputLimitBytes: options.outputLimitBytes,
    diagnosticSummaryMaxChars: options.diagnosticSummaryMaxChars,
    createRunner:
      options.createRunner ??
      ((projectRoot) =>
        new SafeVerificationRunner({
          projectRoot,
          builderAiRoot: options.builderAiRoot,
          stageTimeoutMs: options.stageTimeoutMs ?? 120_000,
          outputLimitBytes: options.outputLimitBytes ?? 1_000_000,
        })),
  });
}
