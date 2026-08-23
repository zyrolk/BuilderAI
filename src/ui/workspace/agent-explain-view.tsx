'use client';

import type { ReactNode } from 'react';

import type { ExplainArtifact } from '../../application/workspace/agent-operating/explain-artifact.types';
import styles from './workspace.module.css';

interface AgentExplainViewProps {
  readonly explain: ExplainArtifact;
}

function availabilityLabel(status: string, reason?: string): string {
  if (reason === undefined || reason.trim().length === 0) return status;
  return `${status} — ${reason}`;
}

export function AgentExplainView({ explain }: AgentExplainViewProps) {
  return (
    <section className={styles.agentExplanation} aria-labelledby="agent-explain-artifact-title">
      <h3 id="agent-explain-artifact-title">Explain artifact</h3>
      <p>
        <strong>Final result:</strong> {explain.finalResult.runStatus} (
        {explain.finalResult.runPhase})
        {explain.finalResult.applyStatus !== undefined
          ? ` · Apply ${explain.finalResult.applyStatus}`
          : ''}
        {explain.finalResult.verificationStatus !== undefined
          ? ` · Verification ${explain.finalResult.verificationStatus}`
          : ''}
        {explain.finalResult.browserVerificationStatus !== undefined
          ? ` · Browser ${explain.finalResult.browserVerificationStatus}`
          : ''}
      </p>
      <p>{explain.summary}</p>

      <div className={styles.agentExplainGrid}>
        <ExplainBlock title="Understood">
          <p>
            {availabilityLabel(
              explain.understood.availability.status,
              explain.understood.availability.reason,
            )}
          </p>
          <p>Goal: {explain.understood.goal}</p>
          {explain.understood.investigationId !== undefined && (
            <p>Investigation: {explain.understood.investigationId}</p>
          )}
        </ExplainBlock>

        <ExplainBlock title="Plan">
          <p>
            {availabilityLabel(explain.plan.availability.status, explain.plan.availability.reason)}
          </p>
          {explain.plan.preparationOutcome !== undefined && (
            <p>Outcome: {explain.plan.preparationOutcome}</p>
          )}
          {explain.plan.plannedOperationCount !== undefined && (
            <p>Planned operations: {explain.plan.plannedOperationCount}</p>
          )}
          {explain.plan.preparationId !== undefined && (
            <p>Preparation: {explain.plan.preparationId}</p>
          )}
        </ExplainBlock>

        <ExplainBlock title="Changes">
          <p>
            {availabilityLabel(
              explain.changes.availability.status,
              explain.changes.availability.reason,
            )}
          </p>
          {explain.changes.applyStatus !== undefined && <p>Apply: {explain.changes.applyStatus}</p>}
          <PathList label="Created" paths={explain.changes.createdFiles} />
          <PathList label="Updated" paths={explain.changes.updatedFiles} />
          <PathList label="Deleted" paths={explain.changes.deletedFiles} />
        </ExplainBlock>

        <ExplainBlock title="Tests / verification">
          <p>
            {availabilityLabel(
              explain.verification.availability.status,
              explain.verification.availability.reason,
            )}
          </p>
          {explain.verification.overallStatus !== undefined && (
            <p>Overall: {explain.verification.overallStatus}</p>
          )}
          {explain.verification.stages !== undefined && explain.verification.stages.length > 0 && (
            <ul>
              {explain.verification.stages.map((stage) => (
                <li key={`${stage.stage}-${stage.status}`}>
                  {stage.stage}: {stage.status}
                </li>
              ))}
            </ul>
          )}
        </ExplainBlock>

        <ExplainBlock title="Browser verification">
          <p>
            {availabilityLabel(
              explain.browserVerification.availability.status,
              explain.browserVerification.availability.reason,
            )}
          </p>
          {explain.browserVerification.overallStatus !== undefined && (
            <p>Overall: {explain.browserVerification.overallStatus}</p>
          )}
          {explain.browserVerification.routeCount !== undefined && (
            <p>Routes checked: {explain.browserVerification.routeCount}</p>
          )}
        </ExplainBlock>

        <ExplainBlock title="Failures">
          {explain.failures.length === 0 ? (
            <p>None recorded.</p>
          ) : (
            <ul>
              {explain.failures.map((failure, index) => (
                <li key={`${failure.source}-${failure.code ?? 'none'}-${index}`}>
                  [{failure.source}] {failure.code ?? '—'}
                  {failure.message !== undefined ? `: ${failure.message}` : ''}
                </li>
              ))}
            </ul>
          )}
        </ExplainBlock>

        <ExplainBlock title="Corrections">
          <p>
            {availabilityLabel(
              explain.corrections.availability.status,
              explain.corrections.availability.reason,
            )}
          </p>
          {explain.corrections.state !== undefined && <p>State: {explain.corrections.state}</p>}
          {explain.corrections.attempt !== undefined && (
            <p>
              Attempt: {explain.corrections.attempt}
              {explain.corrections.maximumAttempts !== undefined
                ? ` / ${explain.corrections.maximumAttempts}`
                : ''}
            </p>
          )}
        </ExplainBlock>

        <ExplainBlock title="Approvals">
          <p>
            {availabilityLabel(
              explain.approvals.availability.status,
              explain.approvals.availability.reason,
            )}
          </p>
          {explain.approvals.gate2CyclesObserved !== undefined && (
            <p>Gate 2 cycles observed: {explain.approvals.gate2CyclesObserved}</p>
          )}
        </ExplainBlock>

        <ExplainBlock title="Tool loop">
          <p>
            {availabilityLabel(
              explain.toolLoop.availability.status,
              explain.toolLoop.availability.reason,
            )}
          </p>
          {explain.toolLoop.evidenceCount !== undefined && (
            <p>Digest count: {explain.toolLoop.evidenceCount}</p>
          )}
          {explain.toolLoop.toolCalls !== undefined && (
            <p>
              Budget: {explain.toolLoop.toolCalls} tool calls /{' '}
              {explain.toolLoop.providerTurns ?? 0} provider turns
            </p>
          )}
          {explain.toolLoop.items !== undefined && explain.toolLoop.items.length > 0 && (
            <ul>
              {explain.toolLoop.items.map((item) => (
                <li key={`${item.intentId}-${item.toolId}`}>
                  {item.toolId} · {item.status} · {item.summaryDigest.slice(0, 12)}…
                </li>
              ))}
            </ul>
          )}
        </ExplainBlock>

        <ExplainBlock title="Evidence">
          <ul>
            {Object.entries(explain.evidence).map(([key, value]) =>
              value === undefined ? null : (
                <li key={key}>
                  {key}: {value}
                </li>
              ),
            )}
          </ul>
        </ExplainBlock>
      </div>
    </section>
  );
}

function ExplainBlock({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <div className={styles.agentExplainBlock}>
      <h4>{title}</h4>
      {children}
    </div>
  );
}

function PathList({
  label,
  paths,
}: {
  readonly label: string;
  readonly paths?: readonly string[];
}) {
  if (paths === undefined || paths.length === 0) return null;
  return (
    <p>
      {label}: {paths.join(', ')}
    </p>
  );
}
