# 🧩 Notion Release Manager

Reusable GitHub Actions workflows that automatically sync your PRs with Notion databases, tracking tasks through development and production releases.

---

## 📋 What It Does

This package provides two reusable workflows that you integrate into your repository:

1. **`release-dev.yaml`** - Updates Notion when PRs are merged to your development branch
2. **`release-main.yaml`** - Promotes tasks to production and creates versioned releases

### Development Workflow (`release-dev.yaml`)

When a PR is merged to your dev branch, this workflow:

- Extracts task IDs (e.g., `STR-123`) from the PR title
- Parses dependent PRs from the PR description (supports multi-repo tasks)
- Checks if ALL dependent PRs are merged across all repositories
- Links tasks to "Next Release" in Notion
- Sets Release Stage:
  - **"On Dev"** - All PRs are merged ✅
  - **"Partially On Dev"** - Some PRs are still pending ⏳
- Extracts Release Label from PR description (Major/Minor/Patch)
- Extracts Release Notes and Testing Notes from PR description
- Automatically promotes tasks to "On Dev" when the final PR is merged

### Production Workflow (`release-main.yaml`)

When code is pushed to your main branch, this workflow:

- Gets the latest released version from Notion (source of truth)
- Calculates the next version based on Release Labels in "Next Release" tasks
- Promotes all "On Dev" tasks from "Next Release" to the new version
- Sets Release Stage to "On Prod"
- Creates a Git tag `vX.Y.Z`

---

## 🚀 How to Integrate in Your Repo

These workflows are reusable workflows stored in a central repository within your organization. You can call them from any repository in the same organization without copying the files.

### Step 1: Set Up Notion

The workflows use the existing **"GitHub Proga"** Notion integration. Make sure this integration has access to your Notion databases.

#### Create Notion Databases

**Tasks Database** - Create a database with these properties:

| Property      | Type                   | Required | Example                                             |
| ------------- | ---------------------- | -------- | --------------------------------------------------- |
| ID            | Number (unique)        | Yes      | 101                                                 |
| Release Stage | Select                 | Yes      | On Dev / Partially On Dev / On Prod / Not Scheduled |
| Release       | Relation → Releases DB | Yes      | 1.10.0                                              |
| Release Notes | Text                   | No       | Description from PR                                 |
| Testing Notes | Text                   | No       | Testing instructions from PR                        |
| Release Label | Select                 | No       | Major / Minor / Patch                               |

**Releases Database** - Create a database with these properties:

| Property     | Type   | Required | Example         |
| ------------ | ------ | -------- | --------------- |
| Version      | Title  | Yes      | 1.10.0          |
| Status       | Select | Yes      | Next / Released |
| Release Date | Date   | No       | 2025-11-10      |

**Important:** Share both databases with the "GitHub Proga" Notion integration.

### Step 2: Configure GitHub Secrets

In your repository: **Settings → Secrets and variables → Actions → New repository secret**

Add these secrets:

| Secret                        | Description                                      |
| ----------------------------- | ------------------------------------------------ |
| `NOTION_API_TOKEN`            | Your Notion integration token                    |
| `NOTION_TASKS_DATABASE_ID`    | The ID of your Tasks database (found in its URL) |
| `NOTION_RELEASES_DATABASE_ID` | The ID of your Releases database                 |

**Finding Database IDs:** The database ID is the 32-character string in the Notion database URL:

```
https://www.notion.so/workspace/32-char-database-id?v=...
```

### Step 3: Create Your Deployment Workflows

Create workflows in your repository that call these reusable workflows from the central repository. Replace `org-name/repo-name` with the actual organization and repository name where the workflows are stored (e.g., `ProgaTech/release-automation-demo`).

**`.github/workflows/deploy-dev.yaml`** - Call after deploying to dev:

```yaml
name: Deploy to Dev

on:
  pull_request:
    types: [closed]
    branches: [dev]
  workflow_dispatch:
    inputs:
      pr_number:
        description: "PR number that triggered this deployment (optional)"
        required: false
        type: string

permissions:
  contents: write
  pull-requests: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    if: github.event.pull_request.merged == true || github.event_name == 'workflow_dispatch'
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Deploy to Dev Environment
        run: |
          # Add your deployment commands here
          # e.g., npm run build, deploy to AWS, etc.

  update-notion:
    needs: deploy
    if: github.event.pull_request.merged == true || inputs.pr_number != ''
    uses: org-name/repo-name/.github/workflows/release-dev.yaml@main
    with:
      pr_number: ${{ inputs.pr_number || github.event.pull_request.number }}
    secrets:
      NOTION_API_TOKEN: ${{ secrets.NOTION_API_TOKEN }}
      NOTION_TASKS_DATABASE_ID: ${{ secrets.NOTION_TASKS_DATABASE_ID }}
      NOTION_RELEASES_DATABASE_ID: ${{ secrets.NOTION_RELEASES_DATABASE_ID }}
```

**`.github/workflows/deploy-main.yaml`** - Call after deploying to production:

```yaml
name: Deploy to Main

on:
  push:
    branches: [main]
  workflow_dispatch: {}

permissions:
  contents: write
  pull-requests: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Deploy to Production
        run: |
          # Add your deployment commands here

  promote-release:
    needs: deploy
    uses: org-name/repo-name/.github/workflows/release-main.yaml@main
    secrets:
      NOTION_API_TOKEN: ${{ secrets.NOTION_API_TOKEN }}
      NOTION_TASKS_DATABASE_ID: ${{ secrets.NOTION_TASKS_DATABASE_ID }}
      NOTION_RELEASES_DATABASE_ID: ${{ secrets.NOTION_RELEASES_DATABASE_ID }}
```

---

## 📖 How to Use

### Creating PRs for Development

1. **Include task IDs in your PR title:**

   ```
   feat: add payment processing STR-123 STR-456
   ```

   The workflow extracts task IDs using a regex pattern (default: `STR-\d+`). You can customize this via workflow inputs.

2. **Add Release Notes section** (optional):

   ```markdown
   ## Release Notes

   This PR adds payment processing functionality with support for credit cards and PayPal.
   ```

3. **Add Testing Notes section** (optional):

   ```markdown
   ## Testing Notes

   - Test credit card payment flow
   - Verify PayPal integration
   - Check error handling for declined cards
   ```

4. **Add Impact section** to specify version bump (optional):

   ```markdown
   ## Impact

   - [ ] **Major** - Breaking changes
   - [x] **Minor** - New features
   - [ ] **Patch** - Bug fixes
   ```

   Check one checkbox to set the Release Label. If none is checked, the task won't have a Release Label set.

5. **Add Dependent PRs section** (if task spans multiple repositories):

   ```markdown
   ## Dependent PRs

   - https://github.com/owner/api/pull/200
   - https://github.com/owner/mobile/pull/300
   ```

   **Note:** Only full GitHub URLs are supported. Use the format: `https://github.com/owner/repo/pull/123`. Other formats (like `owner/repo#123` or `#123`) are not supported.

6. **Merge PR to `dev` branch:**
   - Your deployment workflow runs
   - After successful deployment, `release-dev.yaml` is called
   - Notion tasks are updated automatically

### Multi-Repository Tasks

When a task spans multiple repositories (e.g., web and API):

1. **Add Dependent PRs section** to each PR description with full GitHub URLs:

   ```markdown
   ## Dependent PRs

   - https://github.com/owner/web/pull/100
   - https://github.com/owner/api/pull/200
   ```

   **Important:** Only full GitHub URLs are supported (e.g., `https://github.com/owner/repo/pull/123`).

2. **When a PR is merged to dev:**

   - Workflow checks ALL dependent PRs (including the current one)
   - **If all merged**: Task is set to `Release Stage = "On Dev"` ✅
   - **If partially merged**: Task is set to `Release Stage = "Partially On Dev"` ⏳

3. **When the final PR is merged**: The task automatically promotes to "On Dev" since all PRs are now merged

4. **Production promotion**: Only tasks with `Release Stage = "On Dev"` in "Next Release" are promoted to production

**Example:**

- Task STR-123 has PRs in `web` repo (#100) and `api` repo (#200)
- PR #100 description includes: `## Dependent PRs\n- https://github.com/owner/api/pull/200` (full URL format)
- When PR #100 is merged: Checks both PRs → PR #200 still open → `Release Stage = "Partially On Dev"`
- When PR #200 is merged: Checks both PRs → All merged → `Release Stage = "On Dev"`, **ready for production**

### Production Release

1. **Merge to `main` branch** (usually via PR from `dev`)

2. **Automatic release:**
   - Your deployment workflow runs
   - After successful deployment, `release-main.yaml` is called
   - Version is calculated from Notion's latest release + task labels
   - All "On Dev" tasks in "Next Release" are promoted to the new version
   - Git tag `vX.Y.Z` is created

### Version Calculation

The next version is determined by:

- **Base version**: Latest "Released" version in Notion
- **Bump type**: Highest Release Label found in "Next Release" tasks with `Release Stage = "On Dev"`
  - If any task has `Major` → major bump (1.0.0 → 2.0.0)
  - Else if any task has `Minor` → minor bump (1.0.0 → 1.1.0)
  - Else → patch bump (1.0.0 → 1.0.1)

**Important:** Only tasks with `Release Stage = "On Dev"` are considered for version calculation. Tasks with `Release Stage = "Partially On Dev"` are skipped.

---

## ⚙️ Customization

Both workflows support many input parameters for customization. See the workflow files for all available options, including:

- Branch names (dev/main)
- Task ID pattern (regex)
- Property names in Notion
- Release stage values
- Release label values
- And more...

---

## 🧱 Notion Schema Reference

### Tasks Database

- **ID** (Number, unique) - Task identifier (e.g., 101 for STR-101)
- **Release Stage** (Select) - `On Dev` (all PRs merged) / `Partially On Dev` (some PRs pending) / `On Prod` / `Not Scheduled`
- **Release** (Relation) - Links to Releases database
- **Release Notes** (Text) - Optional notes from PR body (parsed from "## Release Notes" section)
- **Testing Notes** (Text) - Optional testing instructions from PR body (parsed from "## Testing Notes" section)
- **Release Label** (Select) - `Major` / `Minor` / `Patch` (parsed from "## Impact" section)

### Releases Database

- **Version** (Title) - Semantic version (e.g., "1.10.0")
- **Status** (Select) - `Next` (pending) / `Released` (completed)
- **Release Date** (Date) - Optional release date

---

## 🧪 Testing

1. Create a test release in Notion with version `0.0.0` and status `Released`
2. Create a PR with task IDs in the title and merge to `dev`
3. Verify tasks appear in "Next Release" with stage "On Dev"
4. Merge to `main` and verify:
   - New version is created (e.g., `0.0.1`)
   - Tasks are promoted to the new version
   - Git tag is created

---

## 🔐 Required Secrets

| Secret                        | Description                            |
| ----------------------------- | -------------------------------------- |
| `NOTION_API_TOKEN`            | Notion integration token               |
| `NOTION_TASKS_DATABASE_ID`    | Tasks database ID (from Notion URL)    |
| `NOTION_RELEASES_DATABASE_ID` | Releases database ID (from Notion URL) |
