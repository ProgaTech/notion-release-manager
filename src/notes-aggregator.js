/**
 * Escape special regex characters in a string
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Aggregate notes from multiple sources with attribution
 *
 * @param {string} existingNotes - Current notes content
 * @param {string} newNotes - New notes to add
 * @param {string} source - Source identifier (e.g., "api #123")
 * @returns {string} - Aggregated notes
 */
function aggregateNotes(existingNotes, newNotes, source) {
  if (!newNotes?.trim()) {
    return existingNotes || '';
  }

  const sourceHeader = `**[${source}]**`;
  const newSection = `${sourceHeader}\n${newNotes.trim()}`;

  // Check if this source already contributed
  if (existingNotes?.includes(sourceHeader)) {
    // Replace existing section from this source
    const regex = new RegExp(
      `\\*\\*\\[${escapeRegex(source)}\\]\\*\\*\\n[\\s\\S]*?(?=\\n\\n\\*\\*\\[|$)`,
      'g'
    );
    return existingNotes.replace(regex, newSection).trim();
  }

  // Append new source
  if (!existingNotes?.trim()) {
    return newSection;
  }

  return `${existingNotes.trim()}\n\n${newSection}`;
}

/**
 * Priority mapping for release labels
 */
const LABEL_PRIORITY = {
  'Major': 3,
  'Minor': 2,
  'Patch': 1,
};

/**
 * Resolve the highest priority label between two labels
 *
 * @param {string|null} existingLabel - Current label
 * @param {string|null} newLabel - New label to consider
 * @returns {string|null} - Highest priority label
 */
function resolveHighestLabel(existingLabel, newLabel) {
  const existingPriority = LABEL_PRIORITY[existingLabel] || 0;
  const newPriority = LABEL_PRIORITY[newLabel] || 0;

  if (newPriority > existingPriority) {
    return newLabel;
  }
  return existingLabel || newLabel || null;
}

/**
 * Parse release notes section from PR body
 *
 * @param {string} body - PR body content
 * @param {string} sectionName - Section header (e.g., "Release Notes")
 * @returns {string} - Extracted content
 */
function parseSection(body, sectionName) {
  if (!body) return '';

  // Match ## Section Name followed by content until next ## or end
  const regex = new RegExp(
    `##\\s*${escapeRegex(sectionName)}\\s*\\n([\\s\\S]*?)(?=\\n##|$)`,
    'i'
  );

  const match = body.match(regex);
  if (!match) return '';

  // Clean up the content
  let content = match[1].trim();

  // Remove HTML comments
  content = content.replace(/<!--[\s\S]*?-->/g, '');

  // Remove empty lines at start/end
  content = content.trim();

  return content;
}

/**
 * Parse impact/release label from PR body
 *
 * @param {string} body - PR body content
 * @returns {string|null} - Major, Minor, or Patch
 */
function parseImpactLabel(body) {
  if (!body) return null;

  const impactSection = parseSection(body, 'Impact');
  if (!impactSection) return null;

  // Look for checked checkboxes
  const majorMatch = impactSection.match(/\[x\]\s*(?:\*\*)?Major(?:\*\*)?/i);
  const minorMatch = impactSection.match(/\[x\]\s*(?:\*\*)?Minor(?:\*\*)?/i);
  const patchMatch = impactSection.match(/\[x\]\s*(?:\*\*)?Patch(?:\*\*)?/i);

  if (majorMatch) return 'Major';
  if (minorMatch) return 'Minor';
  if (patchMatch) return 'Patch';

  return null;
}

/**
 * Extract task IDs from text using a pattern
 *
 * @param {string} text - Text to search
 * @param {string} pattern - Regex pattern (e.g., "STR-\\d+")
 * @returns {string[]} - Array of task IDs
 */
function extractTaskIds(text, pattern) {
  if (!text) return [];

  const regex = new RegExp(pattern, 'gi');
  const matches = text.match(regex) || [];

  // Deduplicate and uppercase
  return [...new Set(matches.map(m => m.toUpperCase()))];
}

module.exports = {
  aggregateNotes,
  resolveHighestLabel,
  parseSection,
  parseImpactLabel,
  extractTaskIds,
  escapeRegex,
  LABEL_PRIORITY,
};
