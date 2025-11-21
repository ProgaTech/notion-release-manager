# 🧩 Notion Release Manager

Reusable GitHub Actions workflows that automatically sync your PRs with Notion databases, tracking tasks through development and production releases.

---

## 📋 What It Does

This package provides three reusable workflows that you integrate into your repository:

1. **`release-dev.yaml`** - Updates Notion when PRs are merged to your development branch
2. **`release-main.yaml`** - Promotes tasks to production and creates versioned releases
3. **`pr-template-validation.yaml`** - Validates PR descriptions match the template and blocks merges if requirements aren't met

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

### PR Template Validation Workflow (`pr-template-validation.yaml`)

When a PR is opened, edited, or marked ready for review, this workflow:

- Validates that the PR title contains at least one task ID (e.g., `STR-123`)
- Checks that the PR description includes all required sections:
  - **Description** - Always required
  - **Impact** - Required for primary PRs, optional for secondary PRs
  - **Release Notes** - Required for primary PRs, optional for secondary PRs
  - **Testing Notes** - Required for primary PRs, optional for secondary PRs
- Verifies that at least one Impact checkbox is selected (Major/Minor/Patch) for primary PRs
- Detects secondary PRs (PRs with dependent PRs listed) and makes Impact, Release Notes, and Testing Notes optional
- Creates a GitHub check status that **blocks merging** if validation fails
- Provides clear error messages indicating what needs to be fixed

**Secondary PR Detection:** If a PR has entries in the "Dependent PRs" section, it's considered a secondary PR. For secondary PRs, Impact, Release Notes, and Testing Notes are optional since those details should be in the master/primary PR.

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

### Step 3: Set Up PR Template Validation (Recommended)

Add PR template validation to automatically check PRs when they're opened or updated. This ensures all PRs follow the required template format.

**Option A: Automatic validation on PR events** (Recommended)

The workflow runs automatically when triggered by PR events. Simply create a workflow file that references it:

**`.github/workflows/validate-pr.yaml`**:

```yaml
name: Validate PR Template

on:
  pull_request:
    types: [opened, edited, synchronize, ready_for_review]

permissions:
  pull-requests: write
  checks: write
  contents: read

jobs:
  validate:
    uses: org-name/repo-name/.github/workflows/pr-template-validation.yaml@main
    with:
      task_id_pattern: "STR-\\d+" # Optional: customize task ID pattern
```

**Option B: Call as reusable workflow from another workflow**

You can also call the validation workflow from other workflows:

```yaml
jobs:
  validate-pr:
    uses: org-name/repo-name/.github/workflows/pr-template-validation.yaml@main
    with:
      pr_number: ${{ github.event.pull_request.number }}
      task_id_pattern: "STR-\\d+" # Optional
```

**Note:** Replace `org-name/repo-name` with the actual organization and repository name where the workflows are stored (e.g., `ProgaTech/notion-release-manager`).

### Step 4: Create Your Deployment Workflows

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

   **⚠️ Important:** The PR template validation workflow will **block merging** if your PR title doesn't contain at least one task ID matching the pattern.

2. **Fill in the PR description using the template:**

   The PR template validation workflow ensures your PR description includes all required sections. Here's what's required:

   **Required for all PRs:**

   - **Description** - Brief description of changes

   **Required for primary PRs (optional for secondary PRs with dependent PRs):**

   - **Impact** - Select one: Major, Minor, or Patch
   - **Release Notes** - What users should know about this change
   - **Testing Notes** - How this PR was tested

   **Example PR description:**

   ```markdown
   ## Description

   <!-- Provide a brief description of the changes in this PR -->

   Adds payment processing functionality with support for credit cards and PayPal.

   ## Impact

   <!-- Select the version strategy for this PR -->

   - [ ] **Major** - Breaking changes, incompatible API changes
   - [x] **Minor** - New features, backward-compatible additions
   - [ ] **Patch** - Bug fixes, backward-compatible changes

   ## Release Notes

   <!-- Describe what users should know about this change. This will be synced to Notion. -->

   Added new payment processing flow with support for credit cards and PayPal.

   ## Testing Notes

   <!-- Describe how this PR was tested and any important testing considerations -->

   - Tested credit card payment flow
   - Verified PayPal integration
   - Checked error handling for declined cards
   - Manual testing on staging environment
   ```

3. **Add Dependent PRs section** (if task spans multiple repositories):

   ```markdown
   ## Dependent PRs

   - https://github.com/owner/api/pull/200
   - https://github.com/owner/mobile/pull/300
   ```

   ```markdown
   ## Dependent PRs

   <!-- List any PRs that must be merged before or alongside this PR -->

   - https://github.com/owner/api/pull/200
   - https://github.com/owner/mobile/pull/300
   ```

   **Note:** Only full GitHub URLs are supported. Use the format: `https://github.com/owner/repo/pull/123`. Other formats (like `owner/repo#123` or `#123`) are not supported.

   **Secondary PRs:** If your PR depends on another PR (e.g., UI depends on API), you can list it in the Dependent PRs section. For secondary PRs:

   - Impact, Release Notes, and Testing Notes become **optional**
   - The validation workflow will show warnings instead of errors for missing optional fields
   - All details should be explained in the master/primary PR

4. **PR Validation:**

   - When you open or update the PR, the validation workflow automatically runs
   - Check the "PR Template Validation" status check on your PR
   - If validation fails, the PR cannot be merged until all errors are fixed
   - Fix any errors shown in the check output and push updates

5. **Merge PR to `dev` branch:**
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

All workflows support many input parameters for customization. See the workflow files for all available options, including:

### PR Template Validation Workflow

- **`task_id_pattern`** - Regex pattern for task IDs in PR title (default: `STR-\d+`)
  - Example: `"PROJ-\\d+"` for `PROJ-123` format
  - Example: `"[A-Z]+-\\d+"` for any uppercase prefix

### Release Workflows

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

### Testing PR Template Validation

1. Create a PR without a task ID in the title → Should fail validation
2. Create a PR with task ID but missing Description section → Should fail validation
3. Create a PR with all required sections → Should pass validation
4. Create a secondary PR (with Dependent PRs) without Impact/Release Notes/Testing Notes → Should pass with warnings

### Testing Release Workflows

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
