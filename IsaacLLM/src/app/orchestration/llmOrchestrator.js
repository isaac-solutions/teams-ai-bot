/**
 * LLM Orchestrator - Uses an LLM to intelligently decide which skills to execute
 * PLACEHOLDER: Ready for Phase 2 migration when you have 5+ skills
 * 
 * Benefits over SimpleRouter:
 * - Only executes necessary skills (reduces cost/latency for expensive operations)
 * - Intelligent intent detection
 * - Scales better with many skills (10+)
 * 
 * To activate: Simply swap SimpleRouter with this in app.js (same interface!)
 */
class LLMOrchestrator {
  /**
   * @param {Array<BaseSkill>} skills Array of skill instances
   * @param {Object} model OpenAI chat model for orchestration
   */
  constructor(skills, model) {
    this.skills = skills;
    this.model = model;
    console.log(`[LLMOrchestrator] Initialized with ${skills.length} skills`);
  }
  
  /**
   * Route a query to skills using LLM-based intent detection
   * @param {string} query User's query
   * @param {Object} context Additional context
   * @returns {Promise<Object>} Results from selected skills
   */
  async route(query, context) {
    console.log(`[LLMOrchestrator] Analyzing query intent: "${query.substring(0, 50)}..."`);
    
    try {
      // Step 1: Ask LLM which skills to use
      const plan = await this.planExecution(query, context);
      console.log(`[LLMOrchestrator] Execution plan:`, plan);
      
      // Step 2: Execute only selected skills
      const selectedSkills = this.skills.filter(s => plan.skills.includes(s.name));
      
      const skillPromises = selectedSkills.map(async (skill) => {
        try {
          console.log(`[LLMOrchestrator] Executing ${skill.name}`);
          const result = await skill.execute({ query, ...context });
          return { skillName: skill.name, result };
        } catch (error) {
          console.error(`[LLMOrchestrator] Error in ${skill.name}:`, error);
          return { skillName: skill.name, result: null, error: error.message };
        }
      });
      
      const results = await Promise.all(skillPromises);
      
      // Convert to object
      const resultMap = {};
      results.forEach(({ skillName, result, error }) => {
        resultMap[skillName] = result;
        if (error) {
          resultMap[`${skillName}_error`] = error;
        }
      });
      
      return resultMap;
      
    } catch (error) {
      console.error('[LLMOrchestrator] Error during orchestration:', error);
      // Fallback: execute all skills (same as SimpleRouter)
      console.log('[LLMOrchestrator] Falling back to executing all skills');
      return await this.fallbackToAllSkills(query, context);
    }
  }
  
  /**
   * Use LLM to determine which skills should handle the query
   * @param {string} query User's query
   * @param {Object} context Context information
   * @returns {Promise<Object>} Plan with skill names to execute
   */
  async planExecution(query, context) {
    const skillDescriptions = this.skills.map(s => 
      `- ${s.name}: ${s.description}`
    ).join('\n');
    
    const orchestrationPrompt = `Analyze this user query and determine which skills should handle it.

User Query: "${query}"

Context:
- Has uploaded files: ${context.hasFiles ? 'Yes' : 'No'}
- User ID: ${context.userId}

Available Skills:
${skillDescriptions}

Instructions:
1. Select only the skills that are necessary to answer this query
2. Avoid redundant skills
3. For current events/news, use web_search
4. For company policies or stored knowledge, use rag_search
5. For uploaded documents, use file_processing

Return a JSON object with this format:
{
  "skills": ["skill_name1", "skill_name2"],
  "reasoning": "Brief explanation"
}`;

    const response = await this.model.send(orchestrationPrompt);
    
    try {
      const plan = JSON.parse(response.content);
      return plan;
    } catch (error) {
      console.error('[LLMOrchestrator] Failed to parse LLM response:', error);
      // Fallback: use all skills
      return {
        skills: this.skills.map(s => s.name),
        reasoning: 'Fallback to all skills due to parsing error'
      };
    }
  }
  
  /**
   * Fallback method: execute all skills if orchestration fails
   */
  async fallbackToAllSkills(query, context) {
    const skillPromises = this.skills.map(async (skill) => {
      try {
        const canHandle = await skill.canHandle(query, context);
        if (!canHandle) return { skillName: skill.name, result: null };
        
        const result = await skill.execute({ query, ...context });
        return { skillName: skill.name, result };
      } catch (error) {
        return { skillName: skill.name, result: null, error: error.message };
      }
    });
    
    const results = await Promise.all(skillPromises);
    const resultMap = {};
    results.forEach(({ skillName, result, error }) => {
      resultMap[skillName] = result;
      if (error) resultMap[`${skillName}_error`] = error;
    });
    
    return resultMap;
  }
  
  /**
   * Get list of all registered skills
   */
  getSkills() {
    return this.skills.map(skill => ({
      name: skill.name,
      description: skill.description
    }));
  }
}

module.exports = { LLMOrchestrator };

