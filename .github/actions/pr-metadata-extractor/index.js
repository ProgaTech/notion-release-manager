const path = require('path');
const fs = require('fs');

// Load shared modules from src/
const srcPath = path.join(__dirname, '..', '..', '..', 'src');
const { NotionClient } = require(path.join(srcPath, 'notion-client'));
const {
  aggregateNotes,
  resolveHighestLabel,
  parseSection,
  parseImpactLabel,
  extractTaskIds,
} = require(path.join(srcPath, 'notes-aggregator'));

async function main() {
  const {
    PR_NUMBER,
    REPO_IDENTIFIER,
    TASK_ID_PATTERN,
    NOTION_TOKEN,
    TASKS_DATABASE_ID,
    TASK_ID_PROPERTY,
    TASK_ID_PREFIX,
    GITHUB_TOKEN,
    GITHUB_REPOSITORY,
  } = process.env;

  // Fetch PR details from GitHub API
  const [owner, repo] = GITHUB_REPOSITORY.split('/');
  const prResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${PR_NUMBER}`,
    {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    }
  );

  if (!prResponse.ok) {
    console.error(`Failed to fetch PR: ${prResponse.status}`);
    setOutput('task_ids', '');
    setOutput('has_tasks', 'false');
    process.exit(1);
  }

  const pr = await prResponse.json();
  console.log(`Processing PR #${PR_NUMBER}: ${pr.title}`);

  // Extract task IDs from PR title
  const taskIds = extractTaskIds(pr.title, TASK_ID_PATTERN);

  if (taskIds.length === 0) {
    console.log('No task IDs found in PR title');
    setOutput('task_ids', '');
    setOutput('has_tasks', 'false');
    return;
  }

  console.log(`Found task IDs: ${taskIds.join(', ')}`);

  // Parse PR body for metadata
  const releaseNotes = parseSection(pr.body, 'Release Notes');
  const testingNotes = parseSection(pr.body, 'Testing Notes');
  const releaseLabel = parseImpactLabel(pr.body);

  console.log(`Release Notes: ${releaseNotes ? 'Found' : 'Empty'}`);
  console.log(`Testing Notes: ${testingNotes ? 'Found' : 'Empty'}`);
  console.log(`Release Label: ${releaseLabel || 'None'}`);

  // Initialize Notion client
  const notion = new NotionClient(NOTION_TOKEN, {
    tasksDbId: TASKS_DATABASE_ID,
    taskIdProperty: TASK_ID_PROPERTY,
    taskIdPrefix: TASK_ID_PREFIX,
  });

  // Source identifier for note attribution
  const source = `${REPO_IDENTIFIER} #${PR_NUMBER}`;

  // Process each task
  for (const taskId of taskIds) {
    console.log(`\nProcessing task: ${taskId}`);

    try {
      // Find existing task
      let task = await notion.findTaskById(taskId);

      if (!task) {
        console.log(`Task ${taskId} not found, creating...`);
        task = await notion.createTask(taskId, {
          releaseNotes: releaseNotes ? aggregateNotes('', releaseNotes, source) : '',
          testingNotes: testingNotes ? aggregateNotes('', testingNotes, source) : '',
          releaseLabel,
        });
        console.log(`Created task ${taskId}`);
        continue;
      }

      // Task exists - aggregate notes
      const existingReleaseNotes = notion.extractRichText(task.properties['Release Notes']);
      const existingTestingNotes = notion.extractRichText(task.properties['Testing Notes']);
      const existingLabel = notion.extractSelect(task.properties['Release Label']);

      const updates = {};

      // Aggregate release notes
      if (releaseNotes) {
        updates.releaseNotes = aggregateNotes(existingReleaseNotes, releaseNotes, source);
      }

      // Aggregate testing notes
      if (testingNotes) {
        updates.testingNotes = aggregateNotes(existingTestingNotes, testingNotes, source);
      }

      // Resolve highest label
      if (releaseLabel) {
        const highestLabel = resolveHighestLabel(existingLabel, releaseLabel);
        if (highestLabel !== existingLabel) {
          updates.releaseLabel = highestLabel;
        }
      }

      // Update task if there are changes
      if (Object.keys(updates).length > 0) {
        await notion.updateTask(task.id, updates);
        console.log(`Updated task ${taskId}`);
      } else {
        console.log(`No updates needed for task ${taskId}`);
      }
    } catch (error) {
      console.error(`Error processing task ${taskId}:`, error.message);
    }
  }

  // Set outputs
  setOutput('task_ids', taskIds.join(','));
  setOutput('has_tasks', 'true');

  console.log('\nMetadata extraction complete');
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
