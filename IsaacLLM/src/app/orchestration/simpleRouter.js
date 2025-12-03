/**
 * Simple Router - Executes all applicable skills in parallel
 * 
 * DEPRECATED: This router is kept as a fallback but is no longer the primary routing mechanism.
 * The LLMOrchestrator is now used for intelligent skill routing with parameter extraction.
 * 
 * This router uses keyword-based canHandle() methods to determine which skills to execute.
 * It's kept here as a backup if the LLM-based routing fails.
 */
class SimpleRouter {
  /**
   * @param {Array<BaseSkill>} skills Array of skill instances
   */
  constructor(skills) {
    this.skills = skills;
    console.log(`[SimpleRouter] Initialized with ${skills.length} skills: ${skills.map(s => s.name).join(', ')}`);
  }
  
  /**
   * Route a query to applicable skills
   * @param {string} query User's query
   * @param {Object} context Additional context (userId, hasFiles, attachments, etc.)
   * @returns {Promise<Object>} Results from all skills
   */
  async route(query, context) {
    console.log(`[SimpleRouter] Routing query: "${query.substring(0, 50)}..."`);
    
    // Execute all skills in parallel, filtering by canHandle
    const skillPromises = this.skills.map(async (skill) => {
      try {
        const canHandle = await skill.canHandle(query, context);
        
        if (!canHandle) {
          console.log(`[SimpleRouter] Skipping ${skill.name} (canHandle returned false)`);
          return { skillName: skill.name, result: null };
        }
        
        console.log(`[SimpleRouter] Executing ${skill.name}`);
        const result = await skill.execute({ query, ...context });
        
        return { skillName: skill.name, result };
      } catch (error) {
        console.error(`[SimpleRouter] Error in ${skill.name}:`, error);
        return { skillName: skill.name, result: null, error: error.message };
      }
    });
    
    const results = await Promise.all(skillPromises);
    
    // Convert array to object for easier access
    const resultMap = {};
    results.forEach(({ skillName, result, error }) => {
      resultMap[skillName] = result;
      if (error) {
        resultMap[`${skillName}_error`] = error;
      }
    });
    
    console.log(`[SimpleRouter] Routing complete. Active skills: ${
      results.filter(r => r.result !== null).map(r => r.skillName).join(', ') || 'none'
    }`);
    
    return resultMap;
  }
  
  /**
   * Get list of all registered skills
   * @returns {Array} Skill names and descriptions
   */
  getSkills() {
    return this.skills.map(skill => ({
      name: skill.name,
      description: skill.description
    }));
  }
}

module.exports = { SimpleRouter };

