'use client';

import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';

import type { WorkspaceActivity } from '../../application/workspace/activity-history.types';
import {
  statusClassName,
  toActivityHistoryDisplay,
  type ActivityHistoryDisplayModel,
} from './activity-history-display';
import styles from './workspace.module.css';

export interface ActivityHistoryPanelProps {
  readonly activities: readonly WorkspaceActivity[];
}

export function ActivityHistoryPanel({ activities }: ActivityHistoryPanelProps) {
  const headingId = useId();
  const listboxId = useId();
  const detailId = useId();
  const sortedActivities = useMemo(
    () =>
      [...activities].sort(
        (left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp),
      ),
    [activities],
  );
  const displayModels = useMemo(
    () => sortedActivities.map((activity) => toActivityHistoryDisplay(activity)),
    [sortedActivities],
  );
  const [selectedActivityId, setSelectedActivityId] = useState<string | undefined>(
    displayModels[0]?.activityId,
  );
  const selected =
    displayModels.find(({ activityId }) => activityId === selectedActivityId) ?? displayModels[0];

  return (
    <section className={styles.activityHistoryPanel} aria-labelledby={headingId}>
      <div className={styles.panelHeading}>
        <div>
          <p className={styles.eyebrow}>Workspace audit</p>
          <h2 id={headingId}>Activity history</h2>
        </div>
        <span className={styles.activityHistoryCount}>{activities.length} records</span>
      </div>

      {displayModels.length === 0 ? (
        <div className={styles.emptyResult} role="status">
          <span aria-hidden="true">◇</span>
          <p>No workspace activity has been recorded yet.</p>
        </div>
      ) : (
        <div className={styles.activityHistoryLayout}>
          <div
            className={styles.activityHistoryList}
            id={listboxId}
            role="listbox"
            aria-label="Recent workspace activities"
            aria-activedescendant={
              selected === undefined ? undefined : `activity-option-${selected.activityId}`
            }
            onKeyDown={(event) =>
              handleListKeyDown(event, displayModels, selected?.activityId, setSelectedActivityId)
            }
            tabIndex={0}
          >
            {displayModels.map((entry, index) => (
              <ActivityHistoryListItem
                key={entry.activityId}
                entry={entry}
                selected={selected?.activityId === entry.activityId}
                onSelect={() => setSelectedActivityId(entry.activityId)}
                onNavigate={(direction) =>
                  navigateSelection(displayModels, index, direction, setSelectedActivityId)
                }
              />
            ))}
          </div>

          {selected !== undefined && <ActivityHistoryDetail entry={selected} detailId={detailId} />}
        </div>
      )}
    </section>
  );
}

function ActivityHistoryListItem({
  entry,
  selected,
  onSelect,
  onNavigate,
}: {
  readonly entry: ActivityHistoryDisplayModel;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onNavigate: (direction: 'previous' | 'next' | 'first' | 'last') => void;
}) {
  return (
    <button
      type="button"
      role="option"
      id={`activity-option-${entry.activityId}`}
      className={selected ? styles.activityHistoryItemSelected : styles.activityHistoryItem}
      aria-selected={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          onNavigate('next');
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          onNavigate('previous');
        }
        if (event.key === 'Home') {
          event.preventDefault();
          onNavigate('first');
        }
        if (event.key === 'End') {
          event.preventDefault();
          onNavigate('last');
        }
      }}
    >
      <div className={styles.activityHistoryItemHeader}>
        <strong>{entry.label}</strong>
        <span className={statusClassName(entry.status, styles)}>{entry.statusText}</span>
      </div>
      <time dateTime={entry.timestamp}>{formatTimestamp(entry.timestamp)}</time>
      {entry.paths.length > 0 && (
        <p className={styles.activityHistoryItemPaths}>
          {entry.paths.length} affected path{entry.paths.length === 1 ? '' : 's'}
        </p>
      )}
    </button>
  );
}

function ActivityHistoryDetail({
  entry,
  detailId,
}: {
  readonly entry: ActivityHistoryDisplayModel;
  readonly detailId: string;
}) {
  return (
    <article
      className={styles.activityHistoryDetail}
      id={detailId}
      role="region"
      aria-labelledby={`${detailId}-title`}
      {...(entry.summaryLines.length > 0 ? { 'aria-describedby': `${detailId}-summary` } : {})}
    >
      <div className={styles.activityHistoryDetailHeader}>
        <h3 id={`${detailId}-title`}>{entry.label}</h3>
        <span className={statusClassName(entry.status, styles)}>{entry.statusText}</span>
      </div>
      <dl className={styles.activityHistoryMeta}>
        <div>
          <dt>Recorded at</dt>
          <dd>
            <time dateTime={entry.timestamp}>{formatTimestamp(entry.timestamp)}</time>
          </dd>
        </div>
        <div>
          <dt>Activity type</dt>
          <dd>{formatActivityType(entry.type)}</dd>
        </div>
      </dl>
      {entry.summaryLines.length > 0 && (
        <ul className={styles.activityHistorySummary} id={`${detailId}-summary`}>
          {entry.summaryLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {entry.paths.length > 0 ? (
        <section className={styles.pathGroup} aria-labelledby={`${detailId}-paths-title`}>
          <h4 id={`${detailId}-paths-title`}>Affected logical paths</h4>
          <ul>
            {entry.paths.map((path) => (
              <li key={path}>
                <code>{path}</code>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className={styles.muted} aria-live="polite">
          No logical paths are associated with this activity.
        </p>
      )}
    </article>
  );
}

function navigateSelection(
  entries: readonly ActivityHistoryDisplayModel[],
  currentIndex: number,
  direction: 'previous' | 'next' | 'first' | 'last',
  setSelectedActivityId: (activityId: string) => void,
): void {
  if (entries.length === 0) return;
  let nextIndex = currentIndex;
  if (direction === 'previous') nextIndex = Math.max(0, currentIndex - 1);
  if (direction === 'next') nextIndex = Math.min(entries.length - 1, currentIndex + 1);
  if (direction === 'first') nextIndex = 0;
  if (direction === 'last') nextIndex = entries.length - 1;
  const nextEntry = entries[nextIndex];
  if (nextEntry === undefined) return;
  setSelectedActivityId(nextEntry.activityId);
  document.getElementById(`activity-option-${nextEntry.activityId}`)?.focus();
}

function handleListKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  entries: readonly ActivityHistoryDisplayModel[],
  selectedActivityId: string | undefined,
  setSelectedActivityId: (activityId: string) => void,
): void {
  if (entries.length === 0) return;
  const currentIndex = entries.findIndex(({ activityId }) => activityId === selectedActivityId);
  const resolvedIndex = currentIndex >= 0 ? currentIndex : 0;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    navigateSelection(entries, resolvedIndex, 'next', setSelectedActivityId);
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    navigateSelection(entries, resolvedIndex, 'previous', setSelectedActivityId);
  }
  if (event.key === 'Home') {
    event.preventDefault();
    navigateSelection(entries, resolvedIndex, 'first', setSelectedActivityId);
  }
  if (event.key === 'End') {
    event.preventDefault();
    navigateSelection(entries, resolvedIndex, 'last', setSelectedActivityId);
  }
}

function formatTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

function formatActivityType(type: WorkspaceActivity['type']): string {
  return type
    .toLowerCase()
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
