const { AzureOpenAI } = require('openai');

/**
 * LLM Orchestrator - Uses a lightweight LLM to intelligently route queries to appropriate skills
 * and extract relevant parameters upfront for efficient execution.
 * 
 * Benefits over SimpleRouter:
 * - Intelligent intent detection (no keyword matching)
 * - Extracts parameters upfront (search queries, stock tickers)
 * - Reduces redundant LLM calls within skills
 * - Scales better with many skills
 */
class LLMOrchestrator {
  /**
   * @param {Array<BaseSkill>} skills Array of skill instances
   * @param {Object} config Configuration object with Azure OpenAI settings
   */
  constructor(skills, config) {
    this.skills = skills;
    this.config = config;
    
    // Initialize Azure OpenAI client for routing
    try {
      let baseEndpoint = config.azureOpenAIEndpoint;
      // Handle full URL format: https://host/openai/deployments/name/...
      if (baseEndpoint.includes('/openai/')) {
        const url = new URL(baseEndpoint);
        baseEndpoint = `${url.protocol}//${url.host}/`;
      }
      // Handle endpoint that's already just the base
      else if (!baseEndpoint.endsWith('/')) {
        baseEndpoint = baseEndpoint + '/';
      }
      
      this.client = new AzureOpenAI({
        apiKey: config.azureOpenAIKey,
        endpoint: baseEndpoint,
        apiVersion: "2024-12-01-preview"
      });
      
      // Use mini deployment if configured, otherwise fall back to main deployment
      this.miniModelDeployment = config.azureOpenAIMiniDeploymentName || config.azureOpenAIDeploymentName;
      
      // If mini deployment is different from main, we'll try it first and fall back if it fails
      this.fallbackDeployment = config.azureOpenAIDeploymentName;
      
      console.log(`[LLMOrchestrator] Initialized with ${skills.length} skills using ${this.miniModelDeployment}`);
      if (this.miniModelDeployment !== this.fallbackDeployment) {
        console.log(`[LLMOrchestrator] Fallback deployment available: ${this.fallbackDeployment}`);
      }
    } catch (error) {
      console.error(`[LLMOrchestrator] Failed to initialize Azure OpenAI client: ${error.message}`);
      this.client = null;
      this.miniModelDeployment = null;
    }
  }
  
  /**
   * Route a query to skills using LLM-based intent detection and parameter extraction
   * @param {string} query User's query
   * @param {Object} context Additional context (userId, hasFiles, attachments, etc.)
   * @returns {Promise<Object>} Results from selected skills
   */
  async route(query, context) {
    console.log(`[LLMOrchestrator] Analyzing query: "${query.substring(0, 100)}..."`);
    
    try {
      // Step 1: Ask LLM which skills to use and extract parameters
      const plan = await this.planExecution(query, context);
      console.log(`[LLMOrchestrator] Execution plan:`, JSON.stringify(plan, null, 2));
      
      // Step 2: Execute only selected skills with extracted parameters
      const selectedSkills = this.skills.filter(s => plan.skills.includes(s.name));
      
      if (selectedSkills.length === 0) {
        console.log('[LLMOrchestrator] No skills selected, falling back to all skills');
        return await this.fallbackToAllSkills(query, context);
      }
      
      const skillPromises = selectedSkills.map(async (skill) => {
        try {
          console.log(`[LLMOrchestrator] Executing ${skill.name}`);
          
          // Build execution context with extracted parameters
          const executionContext = { 
            query, 
            ...context
          };
          
          // Add skill-specific parameters if available
          if (plan.parameters && plan.parameters[skill.name]) {
            Object.assign(executionContext, plan.parameters[skill.name]);
          }
          
          const result = await skill.execute(executionContext);
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
      // Use keyword-based fallback instead of executing all skills
      console.log('[LLMOrchestrator] Using keyword-based fallback due to orchestration error');
      const fallbackPlan = this.keywordBasedFallback(query, context, error);
      
      // Execute only the skills selected by keyword fallback
      const selectedSkills = this.skills.filter(s => fallbackPlan.skills.includes(s.name));
      
      if (selectedSkills.length === 0) {
        console.log('[LLMOrchestrator] No skills selected by keyword fallback, using canHandle fallback');
        return await this.fallbackToAllSkills(query, context);
      }
      
      const skillPromises = selectedSkills.map(async (skill) => {
        try {
          console.log(`[LLMOrchestrator] Executing ${skill.name} (keyword fallback)`);
          
          const executionContext = { 
            query, 
            ...context
          };
          
          // Add skill-specific parameters if available
          if (fallbackPlan.parameters && fallbackPlan.parameters[skill.name]) {
            Object.assign(executionContext, fallbackPlan.parameters[skill.name]);
          }
          
          const result = await skill.execute(executionContext);
          return { skillName: skill.name, result };
        } catch (error) {
          console.error(`[LLMOrchestrator] Error in ${skill.name}:`, error);
          return { skillName: skill.name, result: null, error: error.message };
        }
      });
      
      const results = await Promise.all(skillPromises);
      const resultMap = {};
      results.forEach(({ skillName, result, error }) => {
        resultMap[skillName] = result;
        if (error) {
          resultMap[`${skillName}_error`] = error;
        }
      });
      
      return resultMap;
    }
  }
  
  /**
   * Use LLM to determine which skills should handle the query and extract parameters
   * @param {string} query User's query
   * @param {Object} context Context information
   * @returns {Promise<Object>} Plan with skill names and extracted parameters
   */
  async planExecution(query, context) {
    // If client is not available, return fallback plan
    if (!this.client || !this.miniModelDeployment) {
      console.log('[LLMOrchestrator] Azure OpenAI client not available, using fallback plan');
      return {
        skills: this.skills.map(s => s.name),
        parameters: {},
        reasoning: "Fallback to all skills due to missing Azure OpenAI configuration"
      };
    }
    
    // Build skill catalog with detailed use cases
    const skillCatalog = {
      'career_development': {
        description: 'Isaac professional development and career growth (ONLY for YOUR OWN development at Isaac, NOT for sales prep or external company research)',
        useCases: [
          'Creating YOUR OWN development plans after appraisals',
          'YOUR OWN DPR (Development Plan Review) check-ins and progress tracking',
          'Understanding competency hierarchy stages for YOUR development',
          'Working through YOUR development objectives (skill-based, behavior-based, mindset-based)',
          'Defining milestones and DPR actions for YOUR development',
          'Questions about Isaac development methodology for YOUR career'
        ],
        keywords: ['development plan', 'DPR', 'appraisal', 'competency', 'hierarchy', 'milestone', 'development objective', 'career development', 'isaac development'],
        excludeWhen: ['sales prep', 'meeting prep', 'client research', 'company research', 'external company', 'sales call', 'preparing for meeting with']
      },
      'rag_search': {
        description: 'Search internal company knowledge base and user documents',
        useCases: [
          'Company policies and procedures',
          'Internal documentation and stored knowledge',
          'Previously uploaded user documents',
          'Organizational information and guidelines',
          'Historical project information'
        ],
        keywords: ['policy', 'internal', 'company', 'document', 'knowledge base', 'our company', 'isaac operations']
      },
      'file_processing': {
        description: 'Process and analyze uploaded files',
        useCases: [
          'User uploads files or documents for analysis',
          'Extracting content from attachments',
          'Summarizing or analyzing uploaded documents'
        ],
        keywords: ['uploaded', 'attachment', 'file', 'document']
      },
      'yahoo_finance': {
        description: 'Get real-time stock prices and financial market data',
        useCases: [
          'Stock prices and ticker symbols',
          'Company market data and valuations',
          'Financial metrics (market cap, volume, price changes)',
          'Stock performance and trading information'
        ],
        keywords: ['stock price', 'ticker', 'shares', 'market price', 'trading', 'financial data', 'stock quote'],
        extractParameters: true,
        parameterInstructions: 'Extract stock ticker symbols (e.g., AAPL, MSFT, GOOGL). For Canadian stocks add .TO suffix (e.g., HPS-A.TO). Return up to 3 tickers.'
      },
      'web_search': {
        description: 'Search the web for current information and recent events',
        useCases: [
          'Current events and breaking news',
          'Recent information not in knowledge base',
          'External company research and discovery',
          'Time-sensitive queries (today, latest, recent)',
          'Information about external organizations',
          'Year-specific information (2024, 2025)'
        ],
        keywords: ['search web', 'google', 'latest', 'current', 'recent', 'news', 'today', 'this year', 'breaking', 'external'],
        extractParameters: true,
        parameterInstructions: 'Create an optimized Google search query (under 10 words) by extracting key entities and removing conversational fluff. Focus on company names, products, topics, and important context.'
      },
      'sales_coach': {
        description: 'Sales and discovery coach for comprehensive meeting preparation and client research',
        useCases: [
          'Sales call preparation and discovery',
          'Client company research and background',
          'Meeting preparation with specific contacts',
          'Competitive intelligence gathering',
          'Understanding prospect operations and challenges',
          'Tailoring value propositions to client needs'
        ],
        keywords: ['sales prep', 'meeting prep', 'prepare for', 'sales call', 'client research', 'research company', 'sales discovery', 'meeting with', 'call with', 'discovery call', 'sales coach'],
        extractParameters: true,
        parameterInstructions: 'Extract the company name and contact role/title if mentioned. Company names may include suffixes like Inc, Corp, LLC, etc.'
      }
    };
    
    // Build the orchestration prompt
    const skillList = Object.entries(skillCatalog).map(([name, info]) => {
      let skillDesc = `- **${name}**: ${info.description}\n`;
      skillDesc += `  Use cases: ${info.useCases.join(', ')}\n`;
      if (info.extractParameters) {
        skillDesc += `  **[EXTRACT PARAMETERS]**: ${info.parameterInstructions}\n`;
      }
      return skillDesc;
    }).join('\n');
    
    const orchestrationPrompt = `You are a skill router for an AI assistant. Analyze the user's query and determine which skills should handle it.

User Query: "${query}"

Context:
- Has uploaded files: ${context.hasFiles ? 'Yes' : 'No'}
- User ID: ${context.userId || 'unknown'}

Available Skills:
${skillList}

CRITICAL RULES - READ CAREFULLY:
1. Select ONLY the skills necessary to answer this query
2. For file uploads, ALWAYS include "file_processing"
3. **SALES PREP EXCLUSION**: If the query contains ANY of these patterns, use "sales_coach" and DO NOT use "career_development":
   - "sales call", "sales prep", "meeting prep", "prepare for", "research company", "client research"
   - Job titles like "SVP", "VP", "CEO", "Director" when mentioned with a company name
   - "overview of [Company]" or "detailed overview" when preparing for a meeting
   - Example: "Provide a detailed overview of [Company] tailored to prepare for a sales call" → USE sales_coach ONLY
4. For career/development questions about YOUR OWN development at Isaac (DPR, appraisals, development plans), use "career_development"
5. For current events or external research, use "web_search" (not rag_search)
6. For internal company knowledge, best practices, policies, procedures, or how to implement a work stream use "rag_search"
7. For stock/financial data, use "yahoo_finance"
8. Extract parameters for skills marked with [EXTRACT PARAMETERS]:
   - For "yahoo_finance": extract "tickers" array
   - For "web_search": create "searchQuery" string
   - For "sales_coach": extract company name and contact role if mentioned

Return a JSON object in this EXACT format:
{
  "skills": ["skill_name1", "skill_name2"],
  "parameters": {
    "yahoo_finance": {"tickers": ["AAPL", "MSFT"]},
    "web_search": {"searchQuery": "optimized query here"}
  },
  "reasoning": "Brief explanation of why these skills were selected"
}

IMPORTANT: 
- Return ONLY valid JSON, no markdown formatting or code blocks
- Include "parameters" object only if there are parameters to extract
- If no parameters needed, use empty object: "parameters": {}`;

    try {
      // Try with mini deployment first, fall back to main deployment if it fails
      let response;
      let deploymentUsed = this.miniModelDeployment;
      
      try {
        response = await this.client.chat.completions.create({
          model: this.miniModelDeployment,
          messages: [
            { 
              role: "system", 
              content: "You are a precise skill routing assistant. Always return valid JSON without markdown formatting."
            },
            { role: "user", content: orchestrationPrompt }
          ],
          temperature: 0.2,
          max_tokens: 500,
          response_format: { type: "json_object" }
        });
      } catch (deploymentError) {
        // If deployment not found and we have a fallback, try that
        if ((deploymentError.code === 'DeploymentNotFound' || deploymentError.status === 404) && 
            this.fallbackDeployment && 
            this.miniModelDeployment !== this.fallbackDeployment) {
          console.warn(`[LLMOrchestrator] Mini deployment ${this.miniModelDeployment} not found, trying fallback ${this.fallbackDeployment}`);
          deploymentUsed = this.fallbackDeployment;
          response = await this.client.chat.completions.create({
            model: this.fallbackDeployment,
            messages: [
              { 
                role: "system", 
                content: "You are a precise skill routing assistant. Always return valid JSON without markdown formatting."
              },
              { role: "user", content: orchestrationPrompt }
            ],
            temperature: 0.2,
            max_tokens: 500,
            response_format: { type: "json_object" }
          });
        } else {
          throw deploymentError;
        }
      }
      
      console.log(`[LLMOrchestrator] Successfully called deployment: ${deploymentUsed}`);
      
      const content = response.choices[0]?.message?.content?.trim();
      
      if (!content) {
        throw new Error('Empty response from LLM');
      }
      
      // Parse JSON response
      let plan;
      try {
        plan = JSON.parse(content);
      } catch (parseError) {
        // Try to extract JSON from markdown code blocks if present
        const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
        if (jsonMatch) {
          plan = JSON.parse(jsonMatch[1]);
        } else {
          throw parseError;
        }
      }
      
      // Validate plan structure
      if (!plan.skills || !Array.isArray(plan.skills)) {
        throw new Error('Invalid plan: missing or invalid skills array');
      }
      
      // Ensure parameters object exists
      if (!plan.parameters) {
        plan.parameters = {};
      }
      
      // Validate skill names
      const validSkillNames = this.skills.map(s => s.name);
      plan.skills = plan.skills.filter(skillName => {
        const isValid = validSkillNames.includes(skillName);
        if (!isValid) {
          console.warn(`[LLMOrchestrator] Invalid skill name: ${skillName}`);
        }
        return isValid;
      });
      
      return plan;
      
    } catch (error) {
      console.error('[LLMOrchestrator] Failed to plan execution:', error);
      console.error('[LLMOrchestrator] Error details:', {
        code: error.code,
        message: error.message,
        status: error.status
      });
      
      // Use intelligent keyword-based fallback instead of executing all skills
      console.log('[LLMOrchestrator] Using keyword-based fallback routing');
      return this.keywordBasedFallback(query, context, error);
    }
  }
  
  /**
   * Keyword-based fallback routing when LLM planning fails
   * Uses pattern matching to select appropriate skills instead of executing all
   * @param {string} query User query
   * @param {Object} context Context object
   * @param {Error} error The error that caused the fallback
   */
  keywordBasedFallback(query, context, error = null) {
    const lowerQuery = query.toLowerCase();
    const selectedSkills = [];
    const parameters = {};
    
    // Sales prep queries - highest priority
    const salesPrepPatterns = [
      /sales (call|prep|preparation|discovery|coach)/i,
      /meeting (prep|preparation|with|call)/i,
      /prepare (for|a) (sales|meeting|call)/i,
      /research (company|client|prospect)/i,
      /client research/i,
      /(overview|detailed overview).*(company|client).*(prepare|sales|meeting)/i,
      /(svp|vp|ceo|cfo|coo|president|director).*(of|global|operations).*(company|client)/i
    ];
    
    if (salesPrepPatterns.some(pattern => pattern.test(query))) {
      selectedSkills.push('sales_coach');
      // Try to extract company name
      const companyMatch = query.match(/\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})\s+(Inc|Corp|LLC|Ltd|Corporation|Company|Diagnostics|Solutions|Technologies)?\b/);
      if (companyMatch) {
        parameters.sales_coach = { companyName: companyMatch[0] };
      }
      console.log('[LLMOrchestrator] Keyword fallback: Selected sales_coach for sales prep query');
    }
    
    // File processing
    if (context.hasFiles) {
      selectedSkills.push('file_processing');
    }
    
    // Stock/finance queries
    if (/\b(stock|ticker|share|price|trading|financial|market cap|NYSE|NASDAQ)\b/i.test(query)) {
      selectedSkills.push('yahoo_finance');
      // Try to extract tickers
      const tickerMatch = query.match(/\b([A-Z]{1,5}(?:\.TO)?)\b/g);
      if (tickerMatch) {
        parameters.yahoo_finance = { tickers: tickerMatch.slice(0, 3) };
      }
    }
    
    // Web search for external research (but not if sales_coach already selected)
    if (!selectedSkills.includes('sales_coach')) {
      const webSearchPatterns = [
        /search (the )?web|google|look ?up online|find online|search (for|about)/i,
        /latest|current|recent|news|today|this (year|month|week)|breaking/i,
        /(research|information|tell me about|learn about).*(company|competitor|industry|market|client)/i
      ];
      
      if (webSearchPatterns.some(pattern => pattern.test(query))) {
        selectedSkills.push('web_search');
        // Create simple search query
        const searchQuery = query.replace(/\b(search|find|look up|google|web)\b/gi, '').trim().substring(0, 100);
        if (searchQuery) {
          parameters.web_search = { searchQuery: searchQuery };
        }
      }
    }
    
    // Career development (only if NOT sales prep)
    if (!selectedSkills.includes('sales_coach')) {
      const careerPatterns = [
        /development plan|dpr|appraisal|competency|hierarchy|milestone|development objective/i,
        /career development|isaac development/i
      ];
      
      if (careerPatterns.some(pattern => pattern.test(query))) {
        selectedSkills.push('career_development');
      }
    }
    
    // RAG search for internal queries (default if nothing else matches)
    const internalPatterns = [
      /our (policy|policies|team|benefits|company|operations)/i,
      /internal|company knowledge|knowledge base/i
    ];
    
    if (internalPatterns.some(pattern => pattern.test(query)) || selectedSkills.length === 0) {
      selectedSkills.push('rag_search');
    }
    
    // Remove duplicates
    const uniqueSkills = [...new Set(selectedSkills)];
    
    console.log(`[LLMOrchestrator] Keyword fallback selected: ${uniqueSkills.join(', ')}`);
    
    return {
      skills: uniqueSkills,
      parameters: parameters,
      reasoning: `Keyword-based fallback routing (LLM planning unavailable: ${error ? (error.code || error.message || 'unknown error') : 'unknown error'})`
    };
  }
  
  /**
   * Fallback method: execute all skills using their canHandle methods (like SimpleRouter)
   * This should only be used as a last resort
   */
  async fallbackToAllSkills(query, context) {
    const skillPromises = this.skills.map(async (skill) => {
      try {
        // Use canHandle if available
        const canHandle = typeof skill.canHandle === 'function' 
          ? await skill.canHandle(query, context)
          : true;
        
        if (!canHandle) {
          console.log(`[LLMOrchestrator] Skipping ${skill.name} (canHandle returned false)`);
          return { skillName: skill.name, result: null };
        }
        
        const result = await skill.execute({ query, ...context });
        return { skillName: skill.name, result };
      } catch (error) {
        console.error(`[LLMOrchestrator] Error in ${skill.name}:`, error);
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
