const NOTION_API_VERSION = '2022-06-28';
const RATE_LIMIT_DELAY = 300;

class NotionClient {
  constructor(token, options = {}) {
    this.token = token;
    this.tasksDbId = options.tasksDbId;
    this.releasesDbId = options.releasesDbId;
    this.taskIdProperty = options.taskIdProperty || 'ID';
    this.taskIdPrefix = options.taskIdPrefix || 'STR-';
  }

  async request(endpoint, method = 'GET', body = null) {
    const url = `https://api.notion.com/v1${endpoint}`;
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Notion-Version': NOTION_API_VERSION,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, options);

        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After') || 1;
          await this.delay(retryAfter * 1000);
          continue;
        }

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Notion API error ${response.status}: ${errorBody}`);
        }

        await this.delay(RATE_LIMIT_DELAY);
        return await response.json();
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await this.delay(1000 * (attempt + 1));
        }
      }
    }
    throw lastError;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============ Query Helpers ============

  async findTaskById(taskId) {
    const numericId = this.extractNumericId(taskId);

    const response = await this.request(`/databases/${this.tasksDbId}/query`, 'POST', {
      filter: {
        property: this.taskIdProperty,
        number: { equals: numericId }
      }
    });

    return response.results[0] || null;
  }

  async findReleaseByName(name) {
    const response = await this.request(`/databases/${this.releasesDbId}/query`, 'POST', {
      filter: {
        property: 'Name',
        title: { equals: name }
      }
    });

    return response.results[0] || null;
  }

  async findPartiallyReleasedRelease(type) {
    const response = await this.request(`/databases/${this.releasesDbId}/query`, 'POST', {
      filter: {
        and: [
          { property: 'Type', select: { equals: type } },
          { property: 'Status', select: { equals: 'Partially Released' } }
        ]
      },
      sorts: [{ property: 'Date', direction: 'descending' }],
      page_size: 1
    });

    if (response.results.length === 0) return null;

    const release = response.results[0];
    return {
      id: release.id,
      name: this.extractTitle(release.properties.Name),
      type: this.extractSelect(release.properties.Type),
      status: this.extractSelect(release.properties.Status),
      repos: this.extractMultiSelect(release.properties.Repos),
      date: this.extractDate(release.properties.Date),
    };
  }

  async getLatestProdVersion() {
    const response = await this.request(`/databases/${this.releasesDbId}/query`, 'POST', {
      filter: {
        and: [
          { property: 'Type', select: { equals: 'prod' } },
          { property: 'Status', select: { equals: 'Released' } }
        ]
      },
      sorts: [{ property: 'Date', direction: 'descending' }],
      page_size: 1
    });

    if (response.results.length === 0) return null;
    return this.extractTitle(response.results[0].properties.Name);
  }

  async getTasksInRelease(releaseId) {
    const response = await this.request(`/databases/${this.tasksDbId}/query`, 'POST', {
      filter: {
        property: 'Releases',
        relation: { contains: releaseId }
      }
    });

    return response.results.map(task => ({
      id: task.id,
      taskId: this.formatTaskId(this.extractUniqueId(task.properties[this.taskIdProperty])),
      releaseNotes: this.extractRichText(task.properties['Release Notes']),
      testingNotes: this.extractRichText(task.properties['Testing Notes']),
      releaseLabel: this.extractSelect(task.properties['Release Label']),
    }));
  }

  async getTasksByIds(taskIds) {
    const tasks = [];
    for (const taskId of taskIds) {
      const task = await this.findTaskById(taskId);
      if (task) {
        tasks.push({
          id: task.id,
          taskId: this.formatTaskId(this.extractUniqueId(task.properties[this.taskIdProperty])),
          releaseNotes: this.extractRichText(task.properties['Release Notes']),
          testingNotes: this.extractRichText(task.properties['Testing Notes']),
          releaseLabel: this.extractSelect(task.properties['Release Label']),
        });
      }
    }
    return tasks;
  }

  // ============ Mutation Helpers ============

  async createTask(taskId, metadata = {}) {
    const numericId = this.extractNumericId(taskId);

    const properties = {
      [this.taskIdProperty]: { number: numericId },
    };

    if (metadata.releaseNotes) {
      properties['Release Notes'] = { rich_text: [{ text: { content: metadata.releaseNotes.slice(0, 2000) } }] };
    }
    if (metadata.testingNotes) {
      properties['Testing Notes'] = { rich_text: [{ text: { content: metadata.testingNotes.slice(0, 2000) } }] };
    }
    if (metadata.releaseLabel) {
      properties['Release Label'] = { select: { name: metadata.releaseLabel } };
    }

    const response = await this.request('/pages', 'POST', {
      parent: { database_id: this.tasksDbId },
      properties,
    });

    return response;
  }

  async updateTask(pageId, properties) {
    const notionProperties = {};

    if (properties.releaseNotes !== undefined) {
      notionProperties['Release Notes'] = {
        rich_text: [{ text: { content: properties.releaseNotes.slice(0, 2000) } }]
      };
    }
    if (properties.testingNotes !== undefined) {
      notionProperties['Testing Notes'] = {
        rich_text: [{ text: { content: properties.testingNotes.slice(0, 2000) } }]
      };
    }
    if (properties.releaseLabel !== undefined) {
      notionProperties['Release Label'] = { select: { name: properties.releaseLabel } };
    }

    return await this.request(`/pages/${pageId}`, 'PATCH', {
      properties: notionProperties,
    });
  }

  async createRelease(name, type, repos = [], date = null) {
    const properties = {
      'Name': { title: [{ text: { content: name } }] },
      'Type': { select: { name: type } },
      'Status': { select: { name: repos.length > 0 ? 'Partially Released' : 'Released' } },
      'Date': { date: { start: date || new Date().toISOString().split('T')[0] } },
    };

    if (repos.length > 0) {
      properties['Repos'] = { multi_select: repos.map(r => ({ name: r })) };
    }

    const response = await this.request('/pages', 'POST', {
      parent: { database_id: this.releasesDbId },
      properties,
    });

    return response;
  }

  async updateRelease(pageId, properties) {
    const notionProperties = {};

    if (properties.status !== undefined) {
      notionProperties['Status'] = { select: { name: properties.status } };
    }
    if (properties.repos !== undefined) {
      notionProperties['Repos'] = { multi_select: properties.repos.map(r => ({ name: r })) };
    }

    return await this.request(`/pages/${pageId}`, 'PATCH', {
      properties: notionProperties,
    });
  }

  async linkTaskToRelease(taskPageId, releasePageId) {
    // Get current releases linked to task
    const task = await this.request(`/pages/${taskPageId}`);
    const currentReleases = task.properties.Releases?.relation || [];

    // Check if already linked
    if (currentReleases.some(r => r.id === releasePageId)) {
      return task;
    }

    // Add new release to relation
    return await this.request(`/pages/${taskPageId}`, 'PATCH', {
      properties: {
        'Releases': {
          relation: [...currentReleases, { id: releasePageId }]
        }
      }
    });
  }

  // ============ Property Extractors ============

  extractTitle(property) {
    return property?.title?.[0]?.plain_text || '';
  }

  extractRichText(property) {
    return property?.rich_text?.map(t => t.plain_text).join('') || '';
  }

  extractSelect(property) {
    return property?.select?.name || null;
  }

  extractMultiSelect(property) {
    return property?.multi_select?.map(s => s.name) || [];
  }

  extractDate(property) {
    return property?.date?.start || null;
  }

  extractNumber(property) {
    return property?.number ?? null;
  }

  extractUniqueId(property) {
    return property?.unique_id?.number ?? property?.number ?? null;
  }

  // ============ Utilities ============

  extractNumericId(taskId) {
    const match = taskId.match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
  }

  formatTaskId(numericId) {
    return `${this.taskIdPrefix}${numericId}`;
  }
}

module.exports = { NotionClient };
