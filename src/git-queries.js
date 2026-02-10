const { execSync } = require('child_process');

/**
 * Check if a branch exists locally or remotely
 */
function branchExists(branch) {
  try {
    // Check local branch
    execSync(`git rev-parse --verify ${branch}`, { stdio: 'ignore' });
    return true;
  } catch {
    try {
      // Check remote branch
      execSync(`git rev-parse --verify origin/${branch}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Get the latest production tag (semver format)
 */
function getLatestProdTag() {
  try {
    const output = execSync('git tag -l "v*" --sort=-version:refname', { encoding: 'utf8' });
    const tags = output.trim().split('\n').filter(Boolean);
    return tags[0] || null;
  } catch {
    return null;
  }
}

/**
 * Get branch configuration for different release types
 */
function getReleaseConfig(releaseType, branches = {}) {
  const dev = branches.dev || 'dev';
  const stage = branches.stage || 'stage';
  const prod = branches.prod || 'main';

  switch (releaseType) {
    case 'dev':
      return {
        targetBranch: dev,
        excludeBranches: [stage, prod],
        sinceTag: null,
        releaseNameFn: () => `Dev ${new Date().toISOString().split('T')[0]}`
      };

    case 'stage':
      return {
        targetBranch: stage,
        excludeBranches: [prod],
        sinceTag: null,
        releaseNameFn: () => `Stage ${new Date().toISOString().split('T')[0]}`
      };

    case 'prod':
      return {
        targetBranch: prod,
        excludeBranches: [],
        sinceTag: getLatestProdTag(),
        releaseNameFn: (version) => version
      };

    default:
      throw new Error(`Unknown release type: ${releaseType}`);
  }
}

/**
 * Get task IDs from a git commit range
 *
 * @param {string} targetBranch - Branch to query
 * @param {string[]} excludeBranches - Branches to exclude commits from
 * @param {string|null} sinceTag - Tag to start from (for prod releases)
 * @param {string} taskPattern - Regex pattern for task IDs
 * @returns {string[]} - Array of unique task IDs
 */
function getTasksFromGitRange(targetBranch, excludeBranches, sinceTag, taskPattern) {
  let gitCommand;

  // Resolve branch to use (local or remote)
  const resolvedTarget = resolveBranch(targetBranch);

  if (sinceTag) {
    // Prod release: commits since last tag
    gitCommand = `git log ${sinceTag}..${resolvedTarget} --format="%s %b"`;
  } else {
    // Dev/Stage: commits in target but not in exclude branches
    const excludeArgs = excludeBranches
      .filter(b => branchExists(b))
      .map(b => `^${resolveBranch(b)}`)
      .join(' ');

    if (excludeArgs) {
      gitCommand = `git log ${resolvedTarget} ${excludeArgs} --format="%s %b"`;
    } else {
      // No branches to exclude - get all commits (first release scenario)
      gitCommand = `git log ${resolvedTarget} --format="%s %b"`;
    }
  }

  try {
    const output = execSync(gitCommand, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const lines = output.trim().split('\n').filter(Boolean);

    const taskIds = new Set();
    const regex = new RegExp(taskPattern, 'gi');

    for (const line of lines) {
      const matches = line.match(regex) || [];
      matches.forEach(id => taskIds.add(id.toUpperCase()));
    }

    return Array.from(taskIds);
  } catch (error) {
    console.error('Git query error:', error.message);
    return [];
  }
}

/**
 * Resolve branch name (prefer local, fallback to origin/)
 */
function resolveBranch(branch) {
  try {
    execSync(`git rev-parse --verify ${branch}`, { stdio: 'ignore' });
    return branch;
  } catch {
    return `origin/${branch}`;
  }
}

/**
 * Get commits between two branches/refs
 */
function getCommitsBetween(from, to) {
  try {
    const output = execSync(`git log ${from}..${to} --format="%H"`, { encoding: 'utf8' });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Create and push a git tag
 */
function createTag(tagName, message = null) {
  try {
    const tagMessage = message || `Release ${tagName}`;
    execSync(`git tag -a ${tagName} -m "${tagMessage}"`, { encoding: 'utf8' });
    execSync(`git push origin ${tagName}`, { encoding: 'utf8' });
    return true;
  } catch (error) {
    console.error('Failed to create tag:', error.message);
    return false;
  }
}

/**
 * Check if a tag exists
 */
function tagExists(tagName) {
  try {
    execSync(`git rev-parse --verify refs/tags/${tagName}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  branchExists,
  getLatestProdTag,
  getReleaseConfig,
  getTasksFromGitRange,
  resolveBranch,
  getCommitsBetween,
  createTag,
  tagExists,
};
