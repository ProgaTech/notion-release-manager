const path = require('path');
const fs = require('fs');

// Load shared modules from src/
const srcPath = path.join(__dirname, '..', '..', '..', 'src');
const { NotionClient } = require(path.join(srcPath, 'notion-client'));
const {
  getReleaseConfig,
  getTasksFromGitRange,
  createTag,
  tagExists,
} = require(path.join(srcPath, 'git-queries'));
const { calculateNextVersion, getTagName } = require(path.join(srcPath, 'version-calculator'));

async function main() {
  const {
    RELEASE_TYPE,
    REPO_IDENTIFIER,
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

  console.log(`\n=== Release Cutter ===`);
  console.log(`Release Type: ${RELEASE_TYPE}`);
  console.log(`Repo: ${REPO_IDENTIFIER}`);

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
  }, {
    dev: process.env.DEV_RELEASE_NAME,
    stage: process.env.STAGE_RELEASE_NAME,
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

  // Route to the appropriate handler
  if (RELEASE_TYPE === 'prod') {
    await handleProdRelease({ notion, taskIds, env: process.env });
  } else {
    await handleDevStageRelease({ notion, taskIds, releaseName: config.releaseName, releaseType: RELEASE_TYPE });
  }
}

// ============================================================
// Dev/Stage: single rolling row that always reflects current state
// ============================================================

async function handleDevStageRelease({ notion, taskIds, releaseName, releaseType }) {
  const statusName = releaseType === 'dev' ? 'Dev Release' : 'Next Release';

  // Find or create the single row for this release type
  let release = await notion.findReleaseByName(releaseName);

  if (release) {
    console.log(`\nFound existing "${releaseName}" row — updating`);
  } else {
    console.log(`\nCreating "${releaseName}" placeholder row`);
    release = await notion.createRelease(releaseName, releaseType, [], null, statusName);
  }

  // Resolve task IDs to Notion page IDs
  const taskPageIds = [];
  for (const taskId of taskIds) {
    try {
      const task = await notion.findTaskById(taskId);
      if (task) {
        taskPageIds.push(task.id);
        console.log(`Resolved ${taskId} → ${task.id}`);
      } else {
        console.log(`Task ${taskId} not found in Notion — skipping`);
      }
    } catch (error) {
      console.error(`Error resolving task ${taskId}:`, error.message);
    }
  }

  // Replace task relations (full refresh from git)
  console.log(`\nSetting ${taskPageIds.length} tasks on "${releaseName}" row`);
  await notion.setReleaseTasks(release.id, taskPageIds);

  // Update date and status
  await notion.updateRelease(release.id, {
    date: new Date().toISOString().split('T')[0],
    status: statusName,
  });

  // Set outputs
  setOutput('release_name', releaseName);
  setOutput('release_id', release.id);
  setOutput('release_status', statusName);
  setOutput('task_count', taskPageIds.length.toString());
  setOutput('is_new_release', 'false');
  setOutput('tag_name', '');

  console.log(`\n=== ${releaseName} Updated ===`);
  console.log(`Tasks: ${taskPageIds.length}`);
}

// ============================================================
// Prod: versioned releases with multi-repo coordination
// ============================================================

async function handleProdRelease({ notion, taskIds, env }) {
  const isSingleRepoRelease = env.SINGLE_REPO_RELEASE === 'true';
  const forceOverride = env.FORCE_OVERRIDE_PARTIAL === 'true';
  const requiredRepos = env.REQUIRED_REPOS ? env.REQUIRED_REPOS.split(',').map(r => r.trim()).filter(Boolean) : [];
  const repoIdentifier = env.REPO_IDENTIFIER;

  console.log(`\nSingle Repo Release: ${isSingleRepoRelease}`);
  console.log(`Required Repos: ${requiredRepos.join(', ') || 'none'}`);

  if (taskIds.length === 0) {
    console.log('\nNo tasks found — nothing to release');
    setOutput('release_name', '');
    setOutput('release_id', '');
    setOutput('release_status', '');
    setOutput('task_count', '0');
    setOutput('is_new_release', 'false');
    setOutput('tag_name', '');
    return;
  }

  // Safety check: partial release collision
  const partialRelease = await notion.findPartiallyReleasedRelease();

  if (partialRelease && isSingleRepoRelease && !forceOverride) {
    console.error(`\n!!! SAFETY CHECK FAILED !!!`);
    console.error(`Cannot create single-repo release: prod release "${partialRelease.name}" is partially released by [${partialRelease.repos.join(', ')}].`);
    console.error(`Either:`);
    console.error(`  1. Complete the existing release first`);
    console.error(`  2. Manually mark it as Released/Abandoned in Notion`);
    console.error(`  3. Use force_override_partial=true to override`);
    process.exit(1);
  }

  // Determine if joining existing or creating new
  let release;
  let isNewRelease = false;
  let releaseName;

  if (partialRelease && !isSingleRepoRelease) {
    // Join existing partial release
    console.log(`\nJoining existing partial release: ${partialRelease.name}`);
    release = partialRelease;
    releaseName = partialRelease.name;
  } else {
    // Create new versioned release
    isNewRelease = true;

    const tasks = await notion.getTasksByIds(taskIds);
    const labels = tasks.map(t => t.releaseLabel).filter(Boolean);

    const latestVersion = await notion.getLatestProdVersion();
    console.log(`Latest prod version: ${latestVersion || 'none'}`);

    releaseName = calculateNextVersion(latestVersion, labels);
    console.log(`\nCalculated new version: ${releaseName}`);

    const initialRepos = [repoIdentifier];
    let initialStatus;

    if (isSingleRepoRelease) {
      initialStatus = 'Released';
    } else if (requiredRepos.length === 0 || (requiredRepos.length === 1 && requiredRepos[0] === repoIdentifier)) {
      initialStatus = 'Released';
    } else {
      initialStatus = 'Partially Released';
    }

    console.log(`\nCreating new release: ${releaseName} (${initialStatus})`);

    const createdRelease = await notion.createRelease(releaseName, 'prod', initialRepos);
    release = {
      id: createdRelease.id,
      name: releaseName,
      repos: initialRepos,
      status: initialStatus,
    };

    if (initialStatus !== 'Partially Released') {
      await notion.updateRelease(createdRelease.id, { status: initialStatus });
      release.status = initialStatus;
    }
  }

  // If joining, update repos and status
  if (!isNewRelease) {
    const updatedRepos = [...new Set([...release.repos, repoIdentifier])];

    let newStatus = release.status;
    if (requiredRepos.length > 0) {
      const allPresent = requiredRepos.every(r => updatedRepos.includes(r));
      newStatus = allPresent ? 'Released' : 'Partially Released';
    } else {
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
        console.log(`Task ${taskId} not found in Notion — skipping`);
      }
    } catch (error) {
      console.error(`Error linking task ${taskId}:`, error.message);
    }
  }

  // Create git tag
  let tagName = '';
  if (isNewRelease) {
    tagName = getTagName(releaseName);

    if (tagExists(tagName)) {
      console.log(`\nTag ${tagName} already exists — skipping`);
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
