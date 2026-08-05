# External target onboarding

BuilderAI can operate on an existing application repository without copying BuilderAI's full
governance stack. Use the **external-target** workspace profile for trusted-local development.

## Quick start

1. Set the target repository root:

   ```powershell
   $env:BUILDERAI_PROJECT_ROOT = "D:\path\to\your-project"
   ```

2. Select the external-target profile:

   ```powershell
   $env:BUILDERAI_WORKSPACE_PROJECT_PROFILE = "external-target"
   ```

3. Copy the bootstrap templates into the target repository:

   ```text
   templates/external-target-bootstrap/target-project.json  ->  .builderai/target-project.json
   templates/external-target-bootstrap/docs/architecture.md   ->  docs/architecture.md
   templates/external-target-bootstrap/docs/project-constitution.md -> docs/project-constitution.md
   templates/external-target-bootstrap/docs/ai-rules.md         ->  docs/ai-rules.md
   ```

4. Edit the copied files for your project: identity, architecture boundaries, protected areas, and
   AI rules. Ensure the repository root contains a `package.json` with `build` and `test` scripts.

5. Enable the trusted-local workspace runtime and provider settings as documented for BuilderAI, then
   run prepare.

## Minimum required context

| Artifact                         | Purpose                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `.builderai/target-project.json` | Project identity, milestone, optional protected areas and source layout hints |
| `docs/architecture.md`           | Scope, principles, source boundaries                                          |
| `docs/project-constitution.md`   | Authority, precedence, change protocol                                        |
| `docs/ai-rules.md`               | Required behavior and verification rules                                      |
| `package.json`                   | Build/test command discovery for verification                                 |

`project-brain.json` is optional. When omitted, BuilderAI synthesizes minimal brain state from the
manifest for context assembly.

## Failure behavior

If required bootstrap files are missing or malformed, prepare fails closed with
`EXTERNAL_TARGET_ONBOARDING_REQUIRED` and a message listing each missing or invalid path.

The BuilderAI repository itself continues to use the default **builderai-self** profile and full
Blueprint Reader validation.

## Zyro.lk example

Point `BUILDERAI_PROJECT_ROOT` at the Zyro.lk checkout, set `BUILDERAI_WORKSPACE_PROJECT_PROFILE`
to `external-target`, copy and customize the four bootstrap files above, then run prepare. Do not
copy BuilderAI's eleven internal governance documents into Zyro.lk.

## Optional source layout hints

External-target manifests may declare bounded scan roots when the default layout is insufficient:

```json
{
  "sourceRoots": ["src", "server", "tests"],
  "staticSourceRoots": ["public"]
}
```

- Paths must be repository-relative, traversal-safe, and limited in count.
- `staticSourceRoots` accepts only `public` or `static` and indexes supported textual extensions;
  binaries and assets are excluded.
- Configured roots must not reference `.builderai`, `.git`, `node_modules`, build outputs, or other
  protected areas.

When omitted, BuilderAI uses the default scan roots from ADR-022/ADR-034.
