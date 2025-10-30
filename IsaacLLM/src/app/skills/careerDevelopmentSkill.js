const { BaseSkill } = require('./baseSkill');

/**
 * Career Development Skill - Specialized RAG skill for Isaac professional development
 * 
 * This skill helps Isaac consultants:
 * 1. Create structured Development Plans based on appraisal feedback
 * 2. Generate specific DPR (Development Plan Review) actions
 * 3. Track progress on Development Objectives
 * 4. Navigate the Competency Hierarchy
 * 
 * It retrieves context from Isaac's Development methodology documents and applies
 * the structured workflow defined in the Career Development Assistant prompt.
 */
class CareerDevelopmentSkill extends BaseSkill {
  /**
   * @param {Object} dataSource Instance of AzureAISearchDataSource
   */
  constructor(dataSource) {
    super('career_development', 'Isaac Professional Development and Career Growth Assistant');
    this.dataSource = dataSource;
    
    // Keywords that trigger career development mode
    this.triggerKeywords = [
      'development plan',
      'development objective',
      'dpr',
      'development plan review',
      'appraisal',
      'competency',
      'hierarchy of competence',
      'career development',
      'milestone',
      'failure mode',
      'consciously incompetent',
      'consciously competent',
      'unconsciously incompetent',
      'unconsciously competent',
      'development theme',
      'development action',
      'workstream review',
      'wsr',
      'skill based',
      'behavior based',
      'behaviour based',
      'mindset based',
      'print score',
      'clifton strength'
    ];
    
    // Context modules from the RAG document
    this.contextModules = [
      'LLM ANSWER STYLE',
      'WHAT-IS-ISAAC',
      'ISAAC-STRUCTURES',
      'DEVELOPMENT-AT-ISAAC',
      'CREATING-A-DEVELOPMENT-PLAN',
      'AI-SUGGESTED-WORKFLOW',
      'HIERARCHY-OVERVIEW',
      'UNCONSCIOUSLY-INCOMPETENT',
      'CONSCIOUSLY-INCOMPETENT',
      'CONSCIOUSLY-COMPETENT',
      'WORKING-THROUGH-OBJECTIVES',
      'SKILL-BASED',
      'BEHAVIOUR-BASED',
      'MINDSET-BASED',
      'EXAMPLE-MILESTONES',
      'EXAMPLE-DPR-ACTIONS'
    ];
  }
  
  /**
   * Determine if this skill should handle the query
   * Activates for career development and DPR-related queries
   */
  async canHandle(query, context) {
    if (!query) return false;
    
    const lowerQuery = query.toLowerCase();
    
    // Check for trigger keywords
    const hasTriggerKeyword = this.triggerKeywords.some(keyword => 
      lowerQuery.includes(keyword.toLowerCase())
    );
    
    // Check for common question patterns
    const developmentPatterns = [
      /how (do|can|should) i (create|build|make|develop)/i,
      /help (me )?(with|create|build|make)/i,
      /what (is|are|does) (my|the)/i,
      /guide (me )?through/i,
      /(plan|planning) (my|for)/i
    ];
    
    const hasPattern = developmentPatterns.some(pattern => pattern.test(query));
    
    if (hasTriggerKeyword || (hasPattern && lowerQuery.includes('development'))) {
      console.log('[CareerDevelopmentSkill] Activated for development query');
      return true;
    }
    
    return false;
  }
  
  /**
   * Execute the career development skill
   * Searches development context and formats response according to PDA guidelines
   */
  async execute(context) {
    const { query, userId } = context;
    
    if (!query || !this.dataSource) {
      return null;
    }

    try {
      console.log(`[CareerDevelopmentSkill] Processing development query: "${query}"`);
      
      // Enhance query for better RAG retrieval
      const enhancedQuery = this.enhanceQueryForRAG(query);
      console.log(`[CareerDevelopmentSkill] Enhanced query: "${enhancedQuery}"`);
      
      // Search the development knowledge base
      const ragContext = await this.dataSource.renderContext(enhancedQuery, userId);
      
      if (!ragContext || !ragContext.trim()) {
        console.log('[CareerDevelopmentSkill] No relevant development context found');
        return null;
      }
      
      // Add career development instruction wrapper
      const formattedContext = this.formatCareerDevelopmentContext(ragContext, query);
      
      console.log(`[CareerDevelopmentSkill] Found relevant development guidance`);
      return formattedContext;
      
    } catch (error) {
      console.error('[CareerDevelopmentSkill] Error during development search:', error);
      return null;
    }
  }
  
  /**
   * Enhance the user's query to retrieve more relevant development context
   */
  enhanceQueryForRAG(query) {
    const lowerQuery = query.toLowerCase();
    
    // Detect workflow stage and add relevant context
    if (lowerQuery.includes('create') || lowerQuery.includes('new') || lowerQuery.includes('start')) {
      return `${query} creating development plan hierarchy competency`;
    }
    
    if (lowerQuery.includes('dpr') || lowerQuery.includes('review') || lowerQuery.includes('progress')) {
      return `${query} DPR actions milestones progress`;
    }
    
    if (lowerQuery.includes('objective') || lowerQuery.includes('goal')) {
      return `${query} development objectives skill behavior mindset`;
    }
    
    if (lowerQuery.includes('milestone') || lowerQuery.includes('track')) {
      return `${query} milestones target dates`;
    }
    
    // Default enhancement
    return `${query} development plan`;
  }
  
  /**
   * Format the RAG context with career development instructions
   */
  formatCareerDevelopmentContext(ragContext, originalQuery) {
    const lowerQuery = originalQuery.toLowerCase();
    
    // Determine which stage of the workflow this query represents
    let workflowStage = '';
    
    if (lowerQuery.includes('create') || lowerQuery.includes('build') || lowerQuery.includes('new plan')) {
      workflowStage = `
The user is creating a NEW DEVELOPMENT PLAN. Follow the AI-SUGGESTED-WORKFLOW:
1. Confirm their role and working situation
2. Ask for external resources (PRINT Scores, Clifton Strengths)
3. Confirm Development Objectives and their types
4. Identify competency hierarchy stage
5. Define "what good looks like"
6. Suggest 3-4 milestones with dates
7. Recommend 3-4 DPR actions for next two weeks
8. Summarize with clear Next Steps
9. Create summary table if multiple objectives

Reference modules inline (e.g., [[CREATING-A-DEVELOPMENT-PLAN]]).
`;
    } else if (lowerQuery.includes('dpr') || lowerQuery.includes('review') || lowerQuery.includes('progress')) {
      workflowStage = `
The user is conducting a DPR CHECK-IN. Follow the review process:
1. Summarize completed ✅, missed ⚠️, and adjusted 🔁 actions
2. Highlight helps, blockers, and learnings
3. Replace weak actions, keep 3-4 active items
4. Close with Next Steps and suggest next DPR date

Be concise and action-oriented.
`;
    } else if (lowerQuery.includes('objective')) {
      workflowStage = `
The user is working on DEVELOPMENT OBJECTIVES. Help them:
1. Identify the objective type (Skill, Behavior, or Mindset)
2. Determine their competency stage
3. Apply relevant strategies from the appropriate module

Reference [[SKILL-BASED]], [[BEHAVIOUR-BASED]], or [[MINDSET-BASED]] modules.
`;
    }
    
    // Build the complete context with instructions
    return `
<career_development_context>
${workflowStage}

RESPONSE STYLE (per [[LLM ANSWER STYLE]]):
- Reference module names in brackets (e.g., [[HIERARCHY-OVERVIEW]])
- Include examples when suggesting actions
- Keep bullets concise
- Recommend top 3 options with rationale
- Use Isaac's terms exactly
- Summarize with 2-3 decisive next steps
- Offer reminder assistance

AVAILABLE CONTEXT MODULES:
${this.contextModules.map(m => `- [[${m}]]`).join('\n')}

RETRIEVED DEVELOPMENT GUIDANCE:
${ragContext}
</career_development_context>
`;
  }
  
  /**
   * Get a summary of what this skill can do
   */
  getCapabilityDescription() {
    return `
**Isaac Professional Development Assistant**

I can help you with:
- Creating structured Development Plans after appraisals
- Identifying your stage in the Competency Hierarchy
- Generating specific DPR actions for the next two weeks
- Defining milestones and "what good looks like"
- Working through Skill-based, Behavior-based, and Mindset-based objectives
- Tracking progress and adjusting your development plan

Just ask me to help with your development plan, DPR review, or career objectives!
`;
  }
}

module.exports = { CareerDevelopmentSkill };

