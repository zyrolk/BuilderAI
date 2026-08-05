import type { BlueprintReadResult } from '../blueprint-reader';

export interface ProjectContextReaderPort {
  read(): Promise<BlueprintReadResult>;
}
