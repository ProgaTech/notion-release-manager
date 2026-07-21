# Auto-create Notion task for untracked PRs

**Date:** 2026-07-22
**Status:** Approved for implementation
**Branch:** `feat/notion-task-autocreation`

## Problem

When a PR is merged, `release-dev.yaml` parses task IDs (e.g. `STR-2534`) from the PR
title and updates the matching Notion task. If no matching task exists, the work
silently drops out of release tracking (`release-dev.yaml:417-423` logs "not found" and
`continue`s). Separately, `pr-template-validation.yaml` hard-blocks any PR whose title
contains no task ID at all.

We want PRs that are opened **without a task ID** — i.e. genuinely untracked work where
no Notion task exists yet — to seed a fresh Notion task automatically, so the work is
tracked from the start. This must be opt-in so it never spams the tasks database.

## Key constraint

The task ID property (`ID`) is a Notion **`unique_id`** property (hence the existing
`unique_id: { equals: n }` filter). Notion **auto-generates** these; the API **cannot set
them on create**. Therefore autocreation cannot reproduce a developer-typed ID. This is
why the trigger is "no ID in the title": we let Notion assign the ID, then **write it back
into the PR title**, so the created ID becomes the canonical, resolvable reference.

## Scope decision

Only the **"genuinely no task yet"** scenario is in scope. PRs that reference an existing
or mistyped ID are never touched — that avoids duplicate/trash tasks and is the natural
gate.

## Design

### New reusable workflow: `notion-autocreate.yaml`

`pr-template-validation.yaml` stays **completely untouched**. Autocreation lives in a new
reusable workflow so the two concerns are separated. Consumers sequence them in their
caller workflow:

```yaml
jobs:
  autocreate:
    uses: org/notion-release-manager/.github/workflows/notion-autocreate.yaml@v1
    secrets: inherit
  validate:
    needs: autocreate
    uses: org/notion-release-manager/.github/workflows/pr-template-validation.yaml@v1
```

Opt-in is the wiring itself: including the `autocreate` job enables the feature; omitting
it leaves validation blocking no-ID PRs as before. No separate enable flag is needed —
it would be redundant with the job's presence.

Ordering works because `pr-template-validation.yaml` re-fetches the PR title fresh from
the API (`pulls.get`, line 58) rather than the stale event payload. Once `autocreate`
patches the title with the new ID, `validate` sees it and passes with no changes to its
logic. If the `autocreate` job is not wired into the caller, validation blocks no-ID PRs
exactly as today.

### Control gates

Opt-in is the presence of the `autocreate` job in the caller — no separate enable flag.
Given that, two runtime gates decide whether a task is created:

1. Title contains **no** task ID matching `task_id_pattern`.
2. Event type is `opened` or `ready_for_review` (manual dispatch via `pr_number` bypasses
   this gate).

So manually editing a title later cannot spawn a stray task, and a PR referencing an
existing/mistyped ID is never touched.

### Flow (`notion-autocreate.yaml` job)

```
fetch PR fresh from API
parse taskIds from PR title with task_id_pattern
if taskIds present: log "already tracked", exit 0
if event type not in {opened, ready_for_review}: log "skip", exit 0

# create branch
parse Release Label from the ## Impact checkbox (reuse Major/Minor/Patch logic)
create Notion task in NOTION_TASKS_DATABASE_ID with:
    Title          = original PR title
    <status prop>  = initial_stage  (default "In Review")
    <label prop>   = parsed Release Label (omit if none checked)
read created task's unique_id back -> `${prefix}-${number}`  (e.g. "STR-3051")
PATCH the PR title -> "STR-3051 <original title>"
log success
```

### Notion task fields on creation

| Field         | Source                                    | Notes                          |
|---------------|-------------------------------------------|--------------------------------|
| Title         | PR title (original, pre-injection)        | Required by Notion.            |
| Status        | `initial_stage` input, default "In Review"| Configurable stage value.      |
| Release Label | `## Impact` Major/Minor/Patch checkbox    | Omitted if none checked.       |

Release Notes / Testing Notes and the Release relation are intentionally **not** set here;
they are filled at merge by `release-dev.yaml` as today.

### Idempotency

No new Notion property required.

- **Title rewrite is the primary guard** — after injection the title carries the ID, so
  every later run resolves it instead of creating a second task.
- **`concurrency` group keyed on PR number** (`cancel-in-progress: false`) serializes
  overlapping events for the same PR so two runs cannot both observe "no ID" and
  double-create.
- **Fresh title re-read** at the top of the create step is a final belt-and-suspenders
  check: if an ID is already present, skip.

### PR title injection format

`"<ID> <original title>"` (e.g. `STR-3051 Add login button`). Configurable via a
`title_id_format` input defaulting to `{id} {title}`.

### Workflow inputs

| Input                       | Default        | Purpose                                     |
|-----------------------------|----------------|---------------------------------------------|
| `task_id_pattern`           | `STR-\\d+`     | Regex for detecting an existing ID.          |
| `task_id_property`          | `ID`           | Notion unique_id property (read ID back).    |
| `task_title_property`       | `Name`         | Notion title property (DB's primary column). |
| `release_stage_property`    | `Status`       | Notion status property name.                 |
| `initial_stage`             | `In Review`    | Status value set on the new task.            |
| `release_label_property`    | `Release Label`| Notion select property for the label.        |
| `release_label_major`       | `Major`        | Label value for Major.                       |
| `release_label_minor`       | `Minor`        | Label value for Minor.                       |
| `release_label_patch`       | `Patch`        | Label value for Patch.                       |
| `title_id_format`           | `{id} {title}` | How the ID is injected into the title.       |

Secrets (required only when the flag is on): `NOTION_API_TOKEN`,
`NOTION_TASKS_DATABASE_ID`.

Permissions: `pull-requests: write`, `contents: read`.

## Edge cases

- **Job not wired in** — validation blocks no-ID PRs exactly as today.
- **`edited` / `synchronize` events** — never autocreate; only `opened` /
  `ready_for_review` do.
- **Concurrent events for same PR** — serialized by the `concurrency` group; the second
  run re-reads the title, finds the injected ID, and skips.
- **Notion create failure** — log the error and exit non-zero so the failure is visible;
  the PR title is not rewritten, so a re-open/re-run can retry cleanly.
- **ID property is not a `unique_id` type** — out of scope; the Notion schema is assumed
  to match the existing filter contract.

## Documentation

Add an "Automatic task creation" subsection to `README.MD` under the validation workflow:
the opt-in flag, the title-rewrite behavior, the caller-workflow `needs:` wiring, and the
`unique_id` caveat.

## Testing

Manual verification against a test Notion database and a scratch repo:

1. Job not wired in → no-ID PR still blocked by validation; no Notion task created.
2. Job wired in, no-ID PR opened → task created with Title/Status/Label; PR title
   rewritten; validation passes on the fresh title.
3. Job wired in, PR opened *with* an existing ID → untouched, no task created.
4. Re-run / rapid edit on the same PR → no duplicate task (concurrency + title re-read).
5. Impact checkbox variations (Major/Minor/Patch/none) → correct or omitted label.
