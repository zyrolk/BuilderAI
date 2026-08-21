import type { InvestigationHandoffFeedback } from './investigation-handoff';

/**
 * Process-local continuity for the short-lived INVESTIGATE -> PREPARE handoff.
 *
 * The browser receives only the opaque investigation identifier. The handoff
 * itself stays server-side and is cloned at both boundaries so callers cannot
 * mutate the retained authority.
 */
export interface InvestigationHandoffStore {
  save(handoff: InvestigationHandoffFeedback): void;
  resolve(investigationId: string): InvestigationHandoffFeedback | undefined;
}

export interface InvestigationContinuityClock {
  now(): Date;
}

export interface InvestigationHandoffStoreConfiguration {
  readonly ttlMs: number;
  readonly maximumEntries: number;
}

export const DEFAULT_INVESTIGATION_HANDOFF_STORE_CONFIGURATION: InvestigationHandoffStoreConfiguration =
  {
    ttlMs: 15 * 60 * 1_000,
    maximumEntries: 50,
  };

interface Entry {
  readonly handoff: InvestigationHandoffFeedback;
  readonly expiresAtMs: number;
}

export class InMemoryInvestigationHandoffStore implements InvestigationHandoffStore {
  private readonly entries = new Map<string, Entry>();
  private readonly configuration: InvestigationHandoffStoreConfiguration;

  constructor(
    private readonly clock: InvestigationContinuityClock,
    configuration: InvestigationHandoffStoreConfiguration = DEFAULT_INVESTIGATION_HANDOFF_STORE_CONFIGURATION,
  ) {
    if (!Number.isInteger(configuration.ttlMs) || configuration.ttlMs <= 0) {
      throw new Error('Investigation handoff TTL must be a positive integer.');
    }
    if (!Number.isInteger(configuration.maximumEntries) || configuration.maximumEntries <= 0) {
      throw new Error('Investigation handoff maximum entries must be a positive integer.');
    }
    this.configuration = configuration;
  }

  save(handoff: InvestigationHandoffFeedback): void {
    this.removeExpired();
    this.entries.set(handoff.sourceInvestigationId, {
      handoff: structuredClone(handoff),
      expiresAtMs: this.clock.now().getTime() + this.configuration.ttlMs,
    });
    while (this.entries.size > this.configuration.maximumEntries) {
      const oldest = this.entries.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.entries.delete(oldest);
    }
  }

  resolve(investigationId: string): InvestigationHandoffFeedback | undefined {
    this.removeExpired();
    const entry = this.entries.get(investigationId);
    return entry === undefined ? undefined : structuredClone(entry.handoff);
  }

  private removeExpired(): void {
    const nowMs = this.clock.now().getTime();
    for (const [investigationId, entry] of this.entries) {
      if (entry.expiresAtMs <= nowMs) this.entries.delete(investigationId);
    }
  }
}
