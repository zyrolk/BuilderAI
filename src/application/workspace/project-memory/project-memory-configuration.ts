export interface ProjectMemoryConfiguration {
  readonly maximumDecisions: number;
  readonly maximumCompletedWork: number;
  readonly maximumInvestigations: number;
  readonly maximumFindings: number;
  readonly maximumSupportingPathsPerRecord: number;
  readonly maximumSummaryCharacters: number;
  readonly maximumTagsPerRecord: number;
  readonly maximumTagCharacters: number;
  readonly maximumSerializedBytes: number;
  readonly maximumRelevantRecords: number;
  readonly maximumContextCharacters: number;
  readonly recencyBoostWindowDays: number;
}

export const DEFAULT_PROJECT_MEMORY_CONFIGURATION: ProjectMemoryConfiguration = {
  maximumDecisions: 100,
  maximumCompletedWork: 200,
  maximumInvestigations: 100,
  maximumFindings: 150,
  maximumSupportingPathsPerRecord: 12,
  maximumSummaryCharacters: 1_000,
  maximumTagsPerRecord: 8,
  maximumTagCharacters: 48,
  maximumSerializedBytes: 512_000,
  maximumRelevantRecords: 8,
  maximumContextCharacters: 10_000,
  recencyBoostWindowDays: 30,
};

export const PROJECT_MEMORY_FILE_PATH = '.builderai/project-memory.json';
