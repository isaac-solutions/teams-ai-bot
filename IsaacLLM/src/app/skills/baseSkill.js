/**
 * Base class for all skills in the Isaac bot.
 * Each skill represents a distinct capability (RAG search, file processing, etc.)
 */
class BaseSkill {
  /**
   * @param {string} name Unique identifier for the skill
   * @param {string} description Human-readable description of what the skill does
   */
  constructor(name, description) {
    this.name = name;
    this.description = description;
  }
  
  /**
   * Execute the skill's main functionality
   * @param {Object} context Context object containing query, userId, attachments, etc.
   * @returns {Promise<any>} Result of the skill execution
   */
  async execute(context) {
    throw new Error(`Skill ${this.name} must implement execute() method`);
  }
  
  /**
   * Determine if this skill should handle the given query
   * @param {string} query The user's query
   * @param {Object} context Additional context (hasFiles, etc.)
   * @returns {Promise<boolean>} True if skill should execute
   */
  async canHandle(query, context) {
    // Default: always execute (override in subclasses for conditional logic)
    return true;
  }
}

module.exports = { BaseSkill };

