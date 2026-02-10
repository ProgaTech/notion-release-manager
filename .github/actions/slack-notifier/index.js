const path = require('path');
const fs = require('fs');

// Load shared modules from src/
const srcPath = path.join(__dirname, '..', '..', '..', 'src');
const { NotionClient } = require(path.join(srcPath, 'notion-client'));

async function main() {
  const {
    RELEASE_NAME,
    RELEASE_TYPE,
    NOTION_TOKEN,
    RELEASES_DATABASE_ID,
    TASKS_DATABASE_ID,
    SLACK_WEBHOOK_URL,
    TASK_ID_PROPERTY,
    TASK_ID_PREFIX,
  } = process.env;

  console.log(`\n=== Slack Notifier ===`);
  console.log(`Release: ${RELEASE_NAME}`);
  console.log(`Type: ${RELEASE_TYPE}`);

  // Initialize Notion client
  const notion = new NotionClient(NOTION_TOKEN, {
    tasksDbId: TASKS_DATABASE_ID,
    releasesDbId: RELEASES_DATABASE_ID,
    taskIdProperty: TASK_ID_PROPERTY,
    taskIdPrefix: TASK_ID_PREFIX,
  });

  // Find the release
  const release = await notion.findReleaseByName(RELEASE_NAME);

  if (!release) {
    console.error(`Release "${RELEASE_NAME}" not found in Notion`);
    setOutput('success', 'false');
    process.exit(1);
  }

  // Extract release properties
  const releaseData = {
    name: notion.extractTitle(release.properties.Name),
    type: notion.extractSelect(release.properties.Type),
    status: notion.extractSelect(release.properties.Status),
    repos: notion.extractMultiSelect(release.properties.Repos),
    date: notion.extractDate(release.properties.Date),
  };

  console.log(`\nRelease data:`, releaseData);

  // Get tasks in this release
  const tasks = await notion.getTasksInRelease(release.id);
  console.log(`\nFound ${tasks.length} tasks`);

  // Build Slack message
  const emoji = getReleaseEmoji(RELEASE_TYPE);
  const typeLabel = RELEASE_TYPE.charAt(0).toUpperCase() + RELEASE_TYPE.slice(1);

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${emoji} ${typeLabel} Release: ${releaseData.name}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Status:*\n${releaseData.status}`,
        },
        {
          type: 'mrkdwn',
          text: `*Date:*\n${releaseData.date || 'Not set'}`,
        },
        {
          type: 'mrkdwn',
          text: `*Repositories:*\n${releaseData.repos.join(', ') || 'None'}`,
        },
        {
          type: 'mrkdwn',
          text: `*Tasks:*\n${tasks.length}`,
        },
      ],
    },
    {
      type: 'divider',
    },
  ];

  // Add task sections (max 10 to avoid Slack limits)
  const displayTasks = tasks.slice(0, 10);

  for (const task of displayTasks) {
    const labelEmoji = getLabelEmoji(task.releaseLabel);

    const taskBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${task.taskId}* ${labelEmoji}\n${truncate(task.releaseNotes, 500) || '_No release notes_'}`,
      },
    };

    blocks.push(taskBlock);

    if (task.testingNotes) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `*Testing:* ${truncate(task.testingNotes, 300)}`,
          },
        ],
      });
    }
  }

  if (tasks.length > 10) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `_...and ${tasks.length - 10} more tasks_`,
        },
      ],
    });
  }

  // Send to Slack
  const slackPayload = {
    text: `${emoji} ${typeLabel} Release: ${releaseData.name}`,
    blocks,
  };

  console.log('\nSending to Slack...');

  const response = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(slackPayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Slack API error: ${response.status} - ${errorText}`);
    setOutput('success', 'false');
    process.exit(1);
  }

  console.log('Notification sent successfully');
  setOutput('success', 'true');
}

function getReleaseEmoji(type) {
  switch (type) {
    case 'prod':
      return '🚀';
    case 'stage':
      return '🎭';
    case 'dev':
      return '🔧';
    default:
      return '📦';
  }
}

function getLabelEmoji(label) {
  switch (label) {
    case 'Major':
      return '🔴';
    case 'Minor':
      return '🟡';
    case 'Patch':
      return '🟢';
    default:
      return '';
  }
}

function truncate(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
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
