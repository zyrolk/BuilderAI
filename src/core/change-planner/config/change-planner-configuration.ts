export interface ChangePlannerConfiguration {
  readonly maximumOperations: number;
  readonly maximumMetadataEntries: number;
  readonly maximumMetadataStringCharacters: number;
  readonly broadChangeOperationThreshold: number;
}

export const DEFAULT_CHANGE_PLANNER_CONFIGURATION: ChangePlannerConfiguration = {
  maximumOperations: 100,
  maximumMetadataEntries: 32,
  maximumMetadataStringCharacters: 2_000,
  broadChangeOperationThreshold: 20,
};
