import { createHash } from 'node:crypto';

import type { AgentLoopBudgetSnapshot, AgentLoopBudgets } from './agent-loop.types';
import { DEFAULT_AGENT_LOOP_BUDGETS } from './agent-loop.types';

export function createInitialBudgetSnapshot(nowMs: number): AgentLoopBudgetSnapshot {
  return {
    toolCalls: 0,
    providerTurns: 0,
    b4VerificationCalls: 0,
    startedAtMs: nowMs,
    identicalRepeatCounts: {},
    completedIntentIds: [],
  };
}

export function resolveBudgets(overrides?: Partial<AgentLoopBudgets>): AgentLoopBudgets {
  return {
    ...DEFAULT_AGENT_LOOP_BUDGETS,
    ...overrides,
  };
}

export function fingerprintToolCall(toolId: string, args: unknown): string {
  const normalized = stableStringify(args ?? null);
  return createHash('sha256').update(`${toolId}\n${normalized}`).digest('hex').slice(0, 32);
}

export function digestSummary(summary: string): string {
  return createHash('sha256').update(summary).digest('hex').slice(0, 24);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export function assertWallClockRemaining(
  budget: AgentLoopBudgetSnapshot,
  budgets: AgentLoopBudgets,
  nowMs: number,
): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string } {
  if (nowMs - budget.startedAtMs > budgets.hardWallClockMs) {
    return {
      ok: false,
      code: 'WALL_CLOCK_EXHAUSTED',
      message: `Agent loop exceeded hard wall-clock of ${budgets.hardWallClockMs}ms.`,
    };
  }
  return { ok: true };
}
