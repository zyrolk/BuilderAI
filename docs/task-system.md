<!-- builderai-document
type: task-system
version: 1
-->

# BuilderAI Task System

## Task contract

Every executable task has:

- A stable lowercase kebab-case ID.
- Title and implementation-focused description.
- Status and priority.
- Observable acceptance criteria.
- Zero or more dependency task IDs.
- Created and last-updated UTC timestamps.
- A blocker reason only while Blocked.
- A completion timestamp only while Done.

Priorities are `LOW`, `MEDIUM`, `HIGH`, and `CRITICAL`.

## States and transitions

| From        | Allowed destination  | Meaning                                                           |
| ----------- | -------------------- | ----------------------------------------------------------------- |
| Todo        | In Progress, Blocked | Ready work can start or expose an external blocker.               |
| In Progress | Todo, Done, Blocked  | Active work can be returned, completed, or blocked.               |
| Blocked     | Todo, In Progress    | A resolved blocker returns work to the queue or active execution. |
| Done        | Todo                 | Completed work can be explicitly reopened.                        |

Assigning the current state is idempotent and does not create a new revision. Other transitions fail
with `PROJECT_BRAIN_INVALID_TASK_TRANSITION`.

## Invariants

- A Blocked task requires a non-empty blocker reason; other states cannot retain one.
- A Done task requires a completion timestamp; other states cannot retain one.
- A task cannot be Done until every declared dependency is Done.
- Dependencies must exist, must be unique, cannot refer to the task itself, and cannot form cycles.
- Completed task IDs in the progress log must reference Done tasks.
- Task IDs are unique within a Project Brain.
- Reopening a Done task removes its completion timestamp and progress completion reference.

## Operating procedure

1. Define the task and acceptance criteria in Todo.
2. Confirm dependencies and Project Brain context.
3. Move to In Progress before implementation.
4. Move to Blocked with a concrete reason when work cannot proceed; do not disguise incomplete work as
   Done.
5. Run appropriate validation before Done.
6. Synchronize project memory and progress at sprint close.

The TypeScript source of the executable model is `src/core/project-brain/types/project-brain.ts`; task
transition policy is owned by `src/core/project-brain/services/task.service.ts`.
