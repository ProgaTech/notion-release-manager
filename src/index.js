const { NotionClient } = require('./notion-client');
const gitQueries = require('./git-queries');
const notesAggregator = require('./notes-aggregator');
const versionCalculator = require('./version-calculator');

module.exports = {
  NotionClient,
  ...gitQueries,
  ...notesAggregator,
  ...versionCalculator,
};
