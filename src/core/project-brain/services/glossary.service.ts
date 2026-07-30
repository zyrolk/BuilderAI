import type { ProjectBrainRepository } from '../storage';
import { ProjectBrainRecordConflictError } from '../types';
import type { GlossaryTerm, VersionedProjectBrain } from '../types';
import type { Clock } from './task.service';
import { commitProjectBrainCommand, loadProjectBrain } from './project-brain-command';

export type GlossaryCommand =
  | { readonly type: 'DEFINE_TERM'; readonly term: GlossaryTerm }
  | { readonly type: 'REVISE_TERM'; readonly term: GlossaryTerm };

function systemClock(): string {
  return new Date().toISOString();
}

export class GlossaryService {
  constructor(
    private readonly repository: ProjectBrainRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(projectId: string, command: GlossaryCommand): Promise<VersionedProjectBrain> {
    const current = await loadProjectBrain(this.repository, projectId);
    const terms = current.brain.domainGlossary.terms;
    const exists = terms.some(({ id }) => id === command.term.id);

    if (command.type === 'DEFINE_TERM' && exists) {
      throw new ProjectBrainRecordConflictError('Glossary term', command.term.id);
    }
    if (command.type === 'REVISE_TERM' && !exists) {
      throw new ProjectBrainRecordConflictError('Glossary term', command.term.id);
    }

    const updatedTerms =
      command.type === 'DEFINE_TERM'
        ? [...terms, command.term]
        : terms.map((term) => (term.id === command.term.id ? command.term : term));

    return commitProjectBrainCommand(this.repository, projectId, current, {
      ...current.brain,
      domainGlossary: {
        terms: updatedTerms,
        updatedAt: this.clock(),
      },
    });
  }
}
