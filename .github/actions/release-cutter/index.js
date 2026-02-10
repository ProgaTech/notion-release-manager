const path = require('path');
const fs = require('fs');

// Load shared modules from src/
const srcPath = path.join(__dirname, '..', '..', '..', 'src');
const { NotionClient } = require(path.join(srcPath, 'notion-client'));
const {
  getReleaseConfig,
  getTasksFromGitRange,
  getLatestProdTag,
  createTag,
  tagExists,
} = require(path.join(srcPath, 'git-queries'));
const { calculateNextVersion, getTagName } = require(path.join(srcPath, 'version-calculator'));

async function main() {
  const {
    RELEASE_TYPE,
    REPO_IDENTIFIER,
    SINGLE_REPO_RELEASE,
    REQUIRED_REPOS,
    FORCE_OVERRIDE_PARTIAL,
    DEV_BRANCH,
    STAGE_BRANCH,
    PROD_BRANCH,
    TASK_ID_PATTERN,
    NOTION_TOKEN,
    RELEASES_DATABASE_ID,
    TASKS_DATABASE_ID,
    TASK_ID_PROPERTY,
    TASK_ID_PREFIX,
  } = process.env;

  const isSingleRepoRelease = SINGLE_REPO_RELEASE === 'true';
  const forceOverride = FORCE_OVERRIDE_PARTIAL === 'true';
  const requiredRepos = REQUIRED_REPOS ? REQUIRED_REPOS.split(',').map(r => r.trim()).filter(Boolean) : [];

  console.log(`\n=== Release Cutter ===`);
  console.log(`Release Type: ${RELEASE_TYPE}`);
  console.log(`Repo: ${REPO_IDENTIFIER}`);
  console.log(`Single Repo Release: ${isSingleRepoRelease}`);
  console.log(`Required Repos: ${requiredRepos.join(', ') || 'none'}`);

  // Initialize Notion client
  const notion = new NotionClient(NOTION_TOKEN, {
    tasksDbId: TASKS_DATABASE_ID,
    releasesDbId: RELEASES_DATABASE_ID,
    taskIdProperty: TASK_ID_PROPERTY,
    taskIdPrefix: TASK_ID_PREFIX,
  });

  // Get release configuration
  const config = getReleaseConfig(RELEASE_TYPE, {
    dev: DEV_BRANCH,
    stage: STAGE_BRANCH,
    prod: PROD_BRANCH,
  });

  console.log(`\nTarget branch: ${config.targetBranch}`);
  console.log(`Exclude branches: ${config.excludeBranches.join(', ') || 'none'}`);
  if (config.sinceTag) {
    console.log(`Since tag: ${config.sinceTag}`);
  }

  // Query git for task IDs in the commit range
  const taskIds = getTasksFromGitRange(
    config.targetBranch,
    config.excludeBranches,
    config.sinceTag,
    TASK_ID_PATTERN
  );

  console.log(`\nFound ${taskIds.length} tasks: ${taskIds.join(', ') || 'none'}`);

  if (taskIds.length === 0) {
    console.log('\nNo tasks found - nothing to release');
    setOutput('release_name', '');
    setOutput('release_id', '');
    setOutput('release_status', '');
    setOutput('task_count', '0');
    setOutput('is_new_release', 'false');
    setOutput('tag_name', '');
    return;
  }

  // Check for partial release collision (safety check)
  const partialRelease = await notion.findPartiallyReleasedRelease(RELEASE_TYPE);

  if (partialRelease && isSingleRepoRelease && !forceOverride) {
    console.error(`\n!!! SAFETY CHECK FAILED !!!`);
    console.error(`Cannot create single-repo release: ${RELEASE_TYPE} release "${partialRelease.name}" is partially released by [${partialRelease.repos.join(', ')}].`);
    console.error(`Either:`);
    console.error(`  1. Complete the existing release first`);
    console.error(`  2. Manually mark it as Released/Abandoned in Notion`);
    console.error(`  3. Use force_override_partial=true to override (will orphan partial release)`);
    process.exit(1);
  }

  // Determine if we're joining an existing release or creating a new one
  let release;
  let isNewRelease = false;
  let releaseName;

  if (partialRelease && !isSingleRepoRelease) {
    // Join existing partial release
    console.log(`\nJoining existing partial release: ${partialRelease.name}`);
    release = partialRelease;
    releaseName = partialRelease.name;
  } else {
    // Create new release
    isNewRelease = true;

    if (RELEASE_TYPE === 'prod') {
      // Calculate version for prod release
      const tasks = await notion.getTasksByIds(taskIds);
      const labels = tasks.map(t => t.releaseLabel).filter(Boolean);

      // Get latest version from Notion (source of truth)
      const latestVersion = await notion.getLatestProdVersion();
      console.log(`Latest prod version: ${latestVersion || 'none'}`);

      releaseName = calculateNextVersion(latestVersion, labels);
      console.log(`\nCalculated new version: ${releaseName}`);
    } else {
      // Dev/Stage use date-based names
      releaseName = config.releaseNameFn();
    }

    console.log(`\nCreating new release: ${releaseName}`);

    // Determine initial status
    const initialRepos = [REPO_IDENTIFIER];
    let initialStatus;

    if (isSingleRepoRelease) {
      // Single repo release is immediately complete
      initialStatus = 'Released';
    } else if (requiredRepos.length === 0 || (requiredRepos.length === 1 && requiredRepos[0] === REPO_IDENTIFIER)) {
      // No other repos required
      initialStatus = 'Released';
    } else {
      // Multi-repo, waiting for others
      initialStatus = 'Partially Released';
    }

    const createdRelease = await notion.createRelease(releaseName, RELEASE_TYPE, initialRepos);
    release = {
      id: createdRelease.id,
      name: releaseName,
      repos: initialRepos,
      status: initialStatus,
    };

    // Update status if not default
    if (initialStatus !== 'Partially Released') {
      await notion.updateRelease(createdRelease.id, { status: initialStatus });
      release.status = initialStatus;
    }
  }

  // If joining existing release, add this repo to the list
  if (!isNewRelease) {
    const updatedRepos = [...new Set([...release.repos, REPO_IDENTIFIER])];

    // Check if all required repos are now present
    let newStatus = release.status;
    if (requiredRepos.length > 0) {
      const allPresent = requiredRepos.every(r => updatedRepos.includes(r));
      newStatus = allPresent ? 'Released' : 'Partially Released';
    } else {
      // No required repos specified - mark as released
      newStatus = 'Released';
    }

    await notion.updateRelease(release.id, {
      repos: updatedRepos,
      status: newStatus,
    });

    release.repos = updatedRepos;
    release.status = newStatus;

    console.log(`Updated release repos: ${updatedRepos.join(', ')}`);
    console.log(`Updated release status: ${newStatus}`);
  }

  // Link tasks to release
  console.log(`\nLinking ${taskIds.length} tasks to release...`);

  for (const taskId of taskIds) {
    try {
      const task = await notion.findTaskById(taskId);
      if (task) {
        await notion.linkTaskToRelease(task.id, release.id);
        console.log(`Linked task ${taskId}`);
      } else {
        console.log(`Task ${taskId} not found in Notion - skipping`);
      }
    } catch (error) {
      console.error(`Error linking task ${taskId}:`, error.message);
    }
  }

  // Create git tag for prod releases
  let tagName = '';
  if (RELEASE_TYPE === 'prod' && isNewRelease) {
    tagName = getTagName(releaseName);

    if (tagExists(tagName)) {
      console.log(`\nTag ${tagName} already exists - skipping`);
    } else {
      console.log(`\nCreating git tag: ${tagName}`);
      const tagCreated = createTag(tagName, `Release ${releaseName}`);
      if (tagCreated) {
        console.log(`Tag ${tagName} created and pushed`);
      } else {
        console.error(`Failed to create tag ${tagName}`);
      }
    }
  }

  // Set outputs
  setOutput('release_name', releaseName);
  setOutput('release_id', release.id);
  setOutput('release_status', release.status);
  setOutput('task_count', taskIds.length.toString());
  setOutput('is_new_release', isNewRelease.toString());
  setOutput('tag_name', tagName);

  console.log(`\n=== Release Cut Complete ===`);
  console.log(`Release: ${releaseName}`);
  console.log(`Status: ${release.status}`);
  console.log(`Tasks: ${taskIds.length}`);
  if (tagName) {
    console.log(`Tag: ${tagName}`);
  }
}

function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    fs.appendFileSync(outputFile, `${name}=${value}\n`);
  }
  console.log(`Output: ${name}=${value}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
