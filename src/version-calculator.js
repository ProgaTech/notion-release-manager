/**
 * Parse a semantic version string into components
 *
 * @param {string} version - Version string (e.g., "v1.2.3" or "1.2.3")
 * @returns {[number, number, number]} - [major, minor, patch]
 */
function parseVersion(version) {
  if (!version) return [0, 0, 0];

  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return [0, 0, 0];

  return [
    parseInt(match[1], 10),
    parseInt(match[2], 10),
    parseInt(match[3], 10),
  ];
}

/**
 * Format version components into a string
 *
 * @param {number} major
 * @param {number} minor
 * @param {number} patch
 * @param {boolean} withPrefix - Include 'v' prefix
 * @returns {string}
 */
function formatVersion(major, minor, patch, withPrefix = false) {
  const version = `${major}.${minor}.${patch}`;
  return withPrefix ? `v${version}` : version;
}

/**
 * Determine bump type from task labels
 *
 * @param {string[]} labels - Array of release labels
 * @returns {'major'|'minor'|'patch'}
 */
function determineBumpType(labels) {
  const normalizedLabels = labels.map(l => l?.toLowerCase());

  if (normalizedLabels.includes('major')) {
    return 'major';
  }
  if (normalizedLabels.includes('minor')) {
    return 'minor';
  }
  return 'patch';
}

/**
 * Calculate next version based on current version and task labels
 *
 * @param {string|null} currentVersion - Current version (e.g., "1.2.3")
 * @param {string[]} taskLabels - Array of release labels from tasks
 * @returns {string} - Next version (e.g., "1.3.0")
 */
function calculateNextVersion(currentVersion, taskLabels) {
  const [major, minor, patch] = parseVersion(currentVersion);
  const bumpType = determineBumpType(taskLabels);

  switch (bumpType) {
    case 'major':
      return formatVersion(major + 1, 0, 0);
    case 'minor':
      return formatVersion(major, minor + 1, 0);
    case 'patch':
    default:
      return formatVersion(major, minor, patch + 1);
  }
}

/**
 * Compare two versions
 *
 * @param {string} a - First version
 * @param {string} b - Second version
 * @returns {number} - -1 if a < b, 0 if equal, 1 if a > b
 */
function compareVersions(a, b) {
  const [aMajor, aMinor, aPatch] = parseVersion(a);
  const [bMajor, bMinor, bPatch] = parseVersion(b);

  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

/**
 * Check if version A is greater than version B
 */
function isGreaterThan(a, b) {
  return compareVersions(a, b) > 0;
}

/**
 * Get tag name from version
 *
 * @param {string} version - Version (e.g., "1.2.3")
 * @returns {string} - Tag name (e.g., "v1.2.3")
 */
function getTagName(version) {
  if (version.startsWith('v')) return version;
  return `v${version}`;
}

module.exports = {
  parseVersion,
  formatVersion,
  determineBumpType,
  calculateNextVersion,
  compareVersions,
  isGreaterThan,
  getTagName,
};
