# Notion Release Manager

Reusable GitHub Actions workflows that automatically sync PRs with Notion databases and manage releases across multiple repositories.

---

## Overview

This package provides modular, reusable workflows for release management:

| Workflow | Purpose |
|----------|---------|
| `on-pr-merge.yml` | Extract PR metadata and store in Notion |
| `cut-release.yml` | Cut releases for any stage (dev/stage/prod) |
| `notify-release.yml` | Send release notifications to Slack |

### Architecture: Git as Source of Truth

The system uses **git branches as the source of truth** for determining what's in each release:

- **PR merge** → Stores metadata only (notes, labels) - no stage tracking
- **Dev/Stage release** → Queries git, updates a single rolling "Dev" / "Stage" row in Notion
- **Prod release** → Queries git, creates a versioned release record with multi-repo coordination
- **Stage status** → Derived from which row a task is linked to, not stored on tasks

This approach eliminates race conditions and state synchronization issues.

### Key Features

- **Multi-repo coordination** - Shared versions across repos with partial release tracking
- **Flexible branching** - Supports any branch flow (dev→stage→prod, direct to prod, hotfixes)
- **Aggregated notes** - Release notes from multiple PRs are combined with attribution
- **Automatic version calculation** - Semver bumping based on task labels
- **Safety checks** - Prevents conflicts between normal and hotfix releases

---

## Quick Start

### 1. Set Up Notion Databases

**Tasks Database:**

| Property | Type | Purpose |
|----------|------|---------|
| Task ID | Title | Task identifier (e.g., "STR-101") |
| ID | Unique ID | Auto-generated ID with prefix (e.g., "STR-101") |
| Release Notes | Rich Text | Aggregated from PRs |
| Testing Notes | Rich Text | Aggregated from PRs |
| Release Label | Select | Major / Minor / Patch |
| Release | Relation | Links to Releases DB |

**Releases Database:**

| Property | Type | Purpose |
|----------|------|---------|
| Name | Title | Version or fixed name ("Dev", "Stage", "1.2.0") |
| Status | Status | Dev Release / Next Release / Partially Released / Released |
| Repositories | Multi-select | Repos included in release (prod only) |
| Date | Date | Release date |
| Tasks | Relation | Linked tasks |
| Type | Select | (Optional) dev / stage / prod — for Notion views/grouping |

### 2. Configure GitHub Secrets

Add these secrets to your repository:

| Secret | Description |
|--------|-------------|
| `NOTION_API_TOKEN` | Notion integration token |
| `NOTION_TASKS_DATABASE_ID` | Tasks database ID |
| `NOTION_RELEASES_DATABASE_ID` | Releases database ID |
| `SLACK_WEBHOOK_URL` | Slack webhook URL (optional) |

### 3. Create Release Workflow

Create `.github/workflows/release-automation.yml` in your repository:

```yaml
name: Release Automation

on:
  pull_request:
    types: [closed]
    branches: [dev, stage, main]
  workflow_dispatch:
    inputs:
      release_type:
        type: choice
        options: [dev, stage, prod]
        description: 'Type of release to cut'
      hotfix:
        type: boolean
        default: false
        description: 'Single repo release (hotfix)'

permissions:
  contents: write
  pull-requests: read

jobs:
  # Store PR metadata on any merge
  store-pr-metadata:
    if: github.event.pull_request.merged == true
    uses: ProgaTech/notion-release-manager/.github/workflows/on-pr-merge.yml@main
    with:
      pr_number: ${{ github.event.pull_request.number }}
      repo_identifier: api  # Change per repo
    secrets: inherit

  # Auto-cut dev release
  auto-dev-release:
    needs: store-pr-metadata
    if: github.base_ref == 'dev'
    uses: ProgaTech/notion-release-manager/.github/workflows/cut-release.yml@main
    with:
      release_type: dev
      repo_identifier: api
    secrets: inherit

  # Auto-cut stage release
  auto-stage-release:
    needs: store-pr-metadata
    if: github.base_ref == 'stage'
    uses: ProgaTech/notion-release-manager/.github/workflows/cut-release.yml@main
    with:
      release_type: stage
      repo_identifier: api
    secrets: inherit

  # Manual prod release
  manual-prod-release:
    if: github.event_name == 'workflow_dispatch' && inputs.release_type == 'prod'
    uses: ProgaTech/notion-release-manager/.github/workflows/cut-release.yml@main
    with:
      release_type: prod
      repo_identifier: api
      single_repo_release: ${{ inputs.hotfix }}
      required_repos: 'api,ui'  # Configure per project
    secrets: inherit

  # Notify on prod release
  notify-prod:
    needs: manual-prod-release
    if: needs.manual-prod-release.outputs.release_name != ''
    uses: ProgaTech/notion-release-manager/.github/workflows/notify-release.yml@main
    with:
      release_name: ${{ needs.manual-prod-release.outputs.release_name }}
      release_type: prod
    secrets: inherit
```

---

## How It Works

### PR Metadata Extraction

When a PR is merged to any branch:

1. Extracts task IDs from PR title (e.g., `STR-123`)
2. Parses PR body for:
   - `## Release Notes` section
   - `## Testing Notes` section
   - `## Impact` section → Release Label
3. Aggregates notes in Notion with source attribution:
   ```
   **[api #123]**
   Fixed authentication bug

   **[ui #456]**
   Updated login form
   ```
4. Keeps highest release label (Major > Minor > Patch)

### Release Cutting

When cutting a release, git is queried to find included tasks:

| Release Type | Git Query | Notion Behavior |
|--------------|-----------|-----------------|
| Dev | Commits in `dev` NOT in `stage` or `main` | Updates single "Dev" row (status: Dev Release) |
| Stage | Commits in `stage` NOT in `main` | Updates single "Stage" row (status: Next Release) |
| Prod | Commits in `main` since last prod tag | Creates versioned release (e.g., `1.2.0`) |

**Dev/Stage** maintain a single rolling row each. Every time the release is cut, the row's task relations are **replaced** with whatever git currently says is in that branch. This gives you a live dashboard of "what's in dev" and "what's heading to prod". The row names are configurable via `dev_release_name` / `stage_release_name`.

**Prod** creates a new versioned record per release with full multi-repo coordination.

This handles all scenarios correctly:
- Regular flow: task → dev → stage → main
- Direct to stage (skip dev)
- Direct to main (hotfix)
- Backmerge sync (main → stage)

### Multi-Repo Coordination (Prod Only)

For projects with multiple repos (e.g., api + ui):

**Normal release:**
1. Repo A triggers → creates version 1.2.0 "Partially Released"
2. Repo B triggers → joins 1.2.0 → status becomes "Released"

**Hotfix (single repo):**
1. Repo A triggers with `single_repo_release: true`
2. Creates version 1.2.1 immediately "Released"
3. Repo B later bumps from 1.2.1 on next release

**Safety check:** Cannot create hotfix if a partial release exists (prevents orphaning).

### Version Calculation (Prod Only)

Versioning only applies to prod releases:
1. Gets latest "Released" version from Notion
2. Collects release labels from all included tasks
3. Bumps version based on highest label:
   - Any Major → 1.0.0 → 2.0.0
   - Any Minor → 1.0.0 → 1.1.0
   - Otherwise → 1.0.0 → 1.0.1

Dev and stage releases have no versioning — they use fixed names ("Dev", "Stage") by default.

---

## Workflow Reference

### `on-pr-merge.yml`

Stores PR metadata in Notion.

**Inputs:**

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `pr_number` | Yes | - | PR number to process |
| `repo_identifier` | Yes | - | Unique repo ID (e.g., "api") |
| `task_id_pattern` | No | `STR-\d+` | Regex for task IDs |
| `task_id_property` | No | `ID` | Notion property name |
| `task_id_prefix` | No | `STR-` | Task ID prefix |

**Outputs:**

| Output | Description |
|--------|-------------|
| `task_ids` | Comma-separated task IDs |
| `has_tasks` | Whether tasks were found |

### `cut-release.yml`

Cuts a release for any stage.

**Inputs:**

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `release_type` | Yes | - | `dev`, `stage`, or `prod` |
| `repo_identifier` | Yes | - | Unique repo ID |
| `single_repo_release` | No | `false` | Hotfix mode (prod only) |
| `required_repos` | No | `''` | Required repos for complete release (prod only) |
| `force_override_partial` | No | `false` | Override partial release check |
| `dev_branch` | No | `dev` | Dev branch name |
| `stage_branch` | No | `stage` | Stage branch name |
| `prod_branch` | No | `main` | Prod branch name |
| `dev_release_name` | No | `Dev` | Display name for dev row in Notion |
| `stage_release_name` | No | `Stage` | Display name for stage row in Notion |

**Outputs:**

| Output | Description |
|--------|-------------|
| `release_name` | Release name/version |
| `release_id` | Notion page ID |
| `release_status` | Dev Release / Next Release / Partially Released / Released |
| `task_count` | Number of tasks |
| `is_new_release` | Whether new release was created |
| `tag_name` | Git tag (prod only) |

### `notify-release.yml`

Sends Slack notification.

**Inputs:**

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `release_name` | Yes | - | Release to notify about |
| `release_type` | Yes | - | Type for emoji/formatting |

**Outputs:**

| Output | Description |
|--------|-------------|
| `success` | Whether notification sent |

---

## PR Template

Use this template in your PRs:

```markdown
## Description

Brief description of changes.

## Impact

- [ ] **Major** - Breaking changes
- [ ] **Minor** - New features
- [x] **Patch** - Bug fixes

## Release Notes

What users should know about this change.

## Testing Notes

How this was tested.
```

---

## Configuration Examples

### Single Repo Setup

```yaml
- uses: ProgaTech/notion-release-manager/.github/workflows/cut-release.yml@main
  with:
    release_type: prod
    repo_identifier: myapp
    # No required_repos = released immediately
```

### Multi-Repo Setup

```yaml
# In api repo
- uses: ProgaTech/notion-release-manager/.github/workflows/cut-release.yml@main
  with:
    release_type: prod
    repo_identifier: api
    required_repos: 'api,ui,worker'

# In ui repo
- uses: ProgaTech/notion-release-manager/.github/workflows/cut-release.yml@main
  with:
    release_type: prod
    repo_identifier: ui
    required_repos: 'api,ui,worker'
```

### Custom Task ID Pattern

```yaml
- uses: ProgaTech/notion-release-manager/.github/workflows/on-pr-merge.yml@main
  with:
    pr_number: ${{ github.event.pull_request.number }}
    repo_identifier: api
    task_id_pattern: 'PROJ-\d+'
    task_id_prefix: 'PROJ-'
```

### Custom Release Row Names

```yaml
- uses: ProgaTech/notion-release-manager/.github/workflows/cut-release.yml@main
  with:
    release_type: dev
    repo_identifier: api
    dev_release_name: 'Next Dev'
    stage_release_name: 'Next Stage'
```

### Different Branch Names

```yaml
- uses: ProgaTech/notion-release-manager/.github/workflows/cut-release.yml@main
  with:
    release_type: prod
    repo_identifier: api
    dev_branch: develop
    stage_branch: staging
    prod_branch: master
```

---

## Migrating from Previous Version

If upgrading from the previous architecture:

1. **Update Notion schema:**
   - Change `Status` from Select to **Status** type with options: Dev Release, Next Release, Partially Released, Released
   - Rename `Repos` to **Repositories** (multi-select)
   - Rename `Releases` to **Release** (relation, on Tasks database)
   - Change task ID property to **Unique ID** type (with prefix, e.g., "STR-")
   - `Type` property (select: dev/stage/prod) is optional — kept for Notion views but not required by automation

2. **Update consumer repo workflows:**
   - Replace old workflow calls with new ones
   - Update input parameters as needed

3. **Test in isolation:**
   - Create test PR and verify metadata extraction
   - Run dev release and verify "Dev" row is created/updated
   - Test multi-repo coordination on prod

See `docs/plans/2026-02-04-release-automation-redesign.md` for full migration details.

---

## Troubleshooting

### No tasks found in release

- Verify task IDs are in commit messages/PR titles
- Check that branches exist and have the expected commits
- Run `git log dev ^stage ^main` locally to see what would be included

### Partial release collision error

- A normal release is in progress, can't create hotfix
- Either complete the normal release or mark it as Released in Notion
- Use `force_override_partial: true` to override (will orphan partial)

### Version not incrementing

- Check that tasks have Release Label set
- Verify latest "Released" version in Notion is correct
- Ensure prod release (not dev/stage) is being triggered

---

## File Structure

```
notion-release-manager/
├── .github/
│   ├── actions/
│   │   ├── pr-metadata-extractor/
│   │   ├── release-cutter/
│   │   └── slack-notifier/
│   └── workflows/
│       ├── on-pr-merge.yml
│       ├── cut-release.yml
│       └── notify-release.yml
├── src/
│   ├── notion-client.js
│   ├── git-queries.js
│   ├── notes-aggregator.js
│   ├── version-calculator.js
│   └── index.js
└── docs/
    └── plans/
```
