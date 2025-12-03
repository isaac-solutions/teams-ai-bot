const { BaseSkill } = require('./baseSkill');
const { AzureOpenAI } = require('openai');
const isaacServices = require('../config/isaacServices');

/**
 * Sales Coach Skill - Deep research and discovery for sales call preparation
 * 
 * Performs comprehensive research on target companies and generates detailed
 * sales preparation reports including company overview, recent news, industry context,
 * and tailored value propositions for Isaac Team's consulting services.
 */
class SalesCoachSkill extends BaseSkill {
  constructor(config = {}) {
    super('sales_coach', 'Sales and discovery coach for meeting preparation and client research');
    
    // Store reference to WebSearchSkill for performing searches
    this.webSearchSkill = config.webSearchSkill;
    
    // Azure OpenAI configuration for entity extraction
    this.azureOpenAIKey = config.azureOpenAIKey;
    this.azureOpenAIEndpoint = config.azureOpenAIEndpoint;
    this.azureOpenAIMiniDeploymentName = config.azureOpenAIMiniDeploymentName;
    
    // Initialize Azure OpenAI client if configured
    if (this.azureOpenAIKey && this.azureOpenAIEndpoint) {
      try {
        let baseEndpoint = this.azureOpenAIEndpoint;
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
          apiKey: this.azureOpenAIKey,
          endpoint: baseEndpoint,
          apiVersion: "2024-10-21"
        });
      } catch (error) {
        console.log('[SalesCoachSkill] Failed to initialize Azure OpenAI client, will use regex fallback:', error.message);
        this.client = null;
      }
    }
  }
  
  /**
   * Execute the sales coach skill
   * @param {Object} context Contains query and other context
   * @returns {Promise<string>} Formatted sales preparation report or error message
   */
  async execute(context) {
    const { query, send } = context;
    
    console.log('[SalesCoachSkill] Starting sales preparation research...');
    
    // Check if web search is available
    if (!this.webSearchSkill || !this.webSearchSkill.enabled) {
      console.log('[SalesCoachSkill] Web search not available');
      return "Web search is required for sales preparation but is not currently enabled. Please configure Google Custom Search API credentials.";
    }
    
    try {
      // Step 1: Extract company name and contact role from query
      console.log('[SalesCoachSkill] Extracting company and contact information...');
      const entityInfo = await this.extractEntities(query);
      
      if (!entityInfo.companyName) {
        return "I couldn't identify a company name in your request. Please specify the company you'd like to research.\n\nExample: \"Prepare for a sales call with Beckman Coulter Diagnostics\" or \"Research Tesla for a meeting\"";
      }
      
      console.log(`[SalesCoachSkill] Company: ${entityInfo.companyName}, Contact: ${entityInfo.contactRole || 'Not specified'}${entityInfo.contactName ? ` (${entityInfo.contactName})` : ''}`);
      
      // Calculate estimated time based on number of searches
      const numSearches = entityInfo.contactRole ? 4 : 3; // Base 3 searches + 1 leadership search if contact role provided
      const estimatedSeconds = numSearches * 10 * 2; // ~10 seconds per search and 2 extractions per search (conservative estimate)
      const estimatedMinutes = Math.ceil(estimatedSeconds / 60);
      
      // Notify user that research is starting (this appears immediately)
      const contactInfo = entityInfo.contactName && entityInfo.contactRole 
        ? `${entityInfo.contactName}, ${entityInfo.contactRole}`
        : entityInfo.contactRole || '';
      const startMessage = `🔍 **Sales Preparation & Deep Research Workflow Started**\n\n**Target Company:** ${entityInfo.companyName}\n${contactInfo ? `**Contact:** ${contactInfo}\n` : ''}**Status:** Generating comprehensive sales preparation research...\n**Estimated Time:** ${estimatedMinutes} minute${estimatedMinutes > 1 ? 's' : ''}\n\nI'm gathering information from multiple sources and preparing a detailed report. Please stand by...`;
      
      // Send immediate status message to user
      if (send && typeof send === 'function') {
        await send(startMessage);
        console.log('[SalesCoachSkill] Sent immediate status message to user');
      }
      
      // Step 2: Perform multiple targeted searches (SEQUENTIALLY for better reliability)
      console.log('[SalesCoachSkill] Performing targeted web searches (sequential)...');
      const searchResults = await this.performResearchSequential(entityInfo);
      
      // Step 3: Validate we have at least one successful search
      const successfulSearches = searchResults.filter(r => r.success);
      if (successfulSearches.length === 0) {
        return startMessage + "❌ **Research Failed**\n\nI was unable to retrieve sufficient information from web searches. This could be due to:\n- Network connectivity issues\n- Content extraction failures\n- Company name not found online\n\nPlease try again or verify the company name is correct.";
      }
      
      console.log(`[SalesCoachSkill] Successfully completed ${successfulSearches.length}/${searchResults.length} searches`);
      
      // Step 4: Return  aggregated search results for LLM synthesis
      // The main chat model (Anthropic Claude) will synthesize this into a structured report
      const synthesisPrompt = this.buildSynthesisPrompt(entityInfo, searchResults);
      
      return startMessage + synthesisPrompt;
      
    } catch (error) {
      console.error('[SalesCoachSkill] Error during execution:', error);
      return `❌ **Error During Sales Research**\n\nAn error occurred while preparing the sales brief: ${error.message}\n\nPlease try again or contact support if the issue persists.`;
    }
  }
  
  /**
   * Extract company name and contact role from user query using LLM
   * @param {string} query User's query
   * @returns {Promise<Object>} Object with companyName and contactRole
   */
  async extractEntities(query) {
    // Try LLM extraction if client is available
    if (this.client && this.azureOpenAIMiniDeploymentName) {
      try {
        const systemPrompt = `You are an entity extraction assistant. Extract the company name, contact role, and contact name (if mentioned) from sales preparation requests.

Return a JSON object with:
- companyName: The full company name (including Inc, Corp, Ltd, etc. if present)
- contactRole: The role/title of the contact person (e.g., "SVP Global Operations", "CEO", "VP of Manufacturing") or null if not mentioned
- contactName: The person's name (e.g., "Adam Grogan", "John Smith") or null if not mentioned

Examples:
Input: "Prepare for a sales call with Beckman Coulter Diagnostics SVP Global Operations"
Output: {"companyName": "Beckman Coulter Diagnostics", "contactRole": "SVP Global Operations", "contactName": null}

Input: "Research Adam Grogan COO Maple Leaf Foods"
Output: {"companyName": "Maple Leaf Foods", "contactRole": "COO", "contactName": "Adam Grogan"}

Input: "I need to prepare for a meeting with the VP of Supply Chain at Tesla"
Output: {"companyName": "Tesla", "contactRole": "VP of Supply Chain", "contactName": null}

Return ONLY the JSON object, no other text.`;

        const response = await this.client.chat.completions.create({
          model: this.azureOpenAIMiniDeploymentName,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: query }
          ],
          temperature: 0.1,
          max_tokens: 150
        });
        
        const content = response.choices[0]?.message?.content?.trim() || '';
        
        // Parse JSON response
        if (content) {
          try {
            const parsed = JSON.parse(content);
            if (parsed.companyName) {
              return {
                companyName: parsed.companyName,
                contactRole: parsed.contactRole || null,
                contactName: parsed.contactName || null
              };
            }
          } catch (parseError) {
            console.log('[SalesCoachSkill] Failed to parse LLM response, using regex fallback');
          }
        }
      } catch (error) {
        // Log but don't throw - fallback to regex
        console.log(`[SalesCoachSkill] LLM entity extraction failed (${error.code || error.message}), using regex fallback`);
      }
    }
    
    // Fallback: Use regex patterns
    return this.extractEntitiesWithRegex(query);
  }
  
  /**
   * Extract entities using regex patterns (fallback method)
   * @param {string} query User's query
   * @returns {Object} Object with companyName and contactRole
   */
  extractEntitiesWithRegex(query) {
    // Extract contact name (person's name before role/company)
    // Pattern: FirstName LastName followed by role or company
    const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(COO|CEO|SVP|VP|President|Chief|CFO|CTO|CMO|Director|Manager|Vice President|Senior Vice President)/i;
    const nameMatch = query.match(namePattern);
    let contactName = null;
    if (nameMatch && nameMatch[1]) {
      contactName = nameMatch[1];
    }
    
    // Extract company names with proper suffixes
    const companyWithSuffixPattern = /\b([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*){0,5})\s+(Inc\.?|Corp\.?|Corporation|Company|LLC|Ltd\.?|Limited|Co\.?|Diagnostics|Solutions|Technologies|Systems|Industries|Group|International)\b/i;
    const companyMatch = query.match(companyWithSuffixPattern);
    
    let companyName = null;
    if (companyMatch && companyMatch[0]) {
      companyName = companyMatch[0];
    } else {
      // Try to find capitalized multi-word phrases (likely company names)
      const properNounPattern = /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,4})\b/;
      const properNounMatch = query.match(properNounPattern);
      if (properNounMatch) {
        companyName = properNounMatch[0];
      }
    }
    
    // Extract contact role
    const rolePatterns = [
      /\b(SVP|VP|EVP|AVP|Senior Vice President|Vice President|Executive Vice President|Assistant Vice President)\s+(?:of\s+)?([A-Z][a-zA-Z\s]+)/i,
      /\b(CEO|CFO|COO|CTO|CMO|Chief\s+\w+\s+Officer)\b/i,
      /\b(President|Director|Manager)\s+(?:of\s+)?([A-Z][a-zA-Z\s]+)/i
    ];
    
    let contactRole = null;
    for (const pattern of rolePatterns) {
      const roleMatch = query.match(pattern);
      if (roleMatch) {
        contactRole = roleMatch[0];
        break;
      }
    }
    
    return { companyName, contactRole, contactName };
  }
  
  /**
   * Perform multiple targeted web searches SEQUENTIALLY for better reliability
   * Sequential execution prevents overwhelming Jina API and reduces timeout risks
   * @param {Object} entityInfo Extracted company and contact information
   * @returns {Promise<Array>} Array of search results with validation
   */
  async performResearchSequential(entityInfo) {
    const { companyName, contactRole, contactName } = entityInfo;
    
    // Define targeted searches
    const searches = [
      {
        name: "Company Overview",
        query: `${companyName} company overview history mission products`,
        description: "Company profile, history, mission, and core products/services"
      },
      {
        name: "Recent News",
        query: `${companyName} news 2025 announcements products launches`,
        description: "Recent developments, product launches, and business updates"
      },
      {
        name: "Industry Context",
        query: `${companyName} industry market trends competitors challenges`,
        description: "Industry trends, market dynamics, and competitive landscape"
      }
    ];
    
    // Add leadership search if contact role is specified (using improved query format)
    if (contactRole) {
      let leadershipQuery;
      if (contactName) {
        leadershipQuery = `${contactName} ${contactRole} ${companyName} background profile`;
      } else {
        leadershipQuery = `${contactRole} ${companyName} background profile`;
      }
      searches.push({
        name: "Leadership Profile",
        query: leadershipQuery,
        description: "Contact background, career history, and professional profile"
      });
    }
    
    // Execute searches SEQUENTIALLY (not in parallel)
    const results = [];
    
    for (const search of searches) {
      try {
        console.log(`[SalesCoachSkill] Searching: ${search.name}`);
        
        // Use the web search skill to perform the search
        const result = await this.webSearchSkill.execute({
          query: search.query,
          searchQuery: search.query // Pre-optimized query
        });
        
        // Validate result has substantial content
        const success = result && result.length > 200;
        
        if (success) {
          // Parse and truncate web search results to limit tokens (more concise)
          const truncatedContent = this.truncateWebSearchResults(result, 3500, 8000);
          console.log(`[SalesCoachSkill] ✓ ${search.name} - Success (${result.length} chars → ${truncatedContent.length} chars after truncation)`);
          
          results.push({
            name: search.name,
            description: search.description,
            query: search.query,
            success: true,
            content: truncatedContent
          });
        } else {
          console.log(`[SalesCoachSkill] ✗ ${search.name} - Failed or insufficient content`);
          results.push({
            name: search.name,
            description: search.description,
            query: search.query,
            success: false,
            content: ''
          });
        }
        
        // Optional: Add small delay between searches for politeness (webSearchSkill handles this internally now)
        // await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`[SalesCoachSkill] Error in ${search.name}:`, error);
        results.push({
          name: search.name,
          description: search.description,
          query: search.query,
          success: false,
          content: '',
          error: error.message
        });
      }
    }
    
    return results;
  }
  
  /**
   * Perform multiple targeted web searches for comprehensive research (PARALLEL - LEGACY)
   * Kept for backward compatibility, but performResearchSequential is now preferred
   * @param {Object} entityInfo Extracted company and contact information
   * @returns {Promise<Array>} Array of search results with validation
   */
  async performResearch(entityInfo) {
    const { companyName, contactRole } = entityInfo;
    
    // Define targeted searches
    const searches = [
      {
        name: "Company Overview",
        query: `${companyName} company overview history mission products`,
        description: "Company profile, history, mission, and core products/services"
      },
      {
        name: "Recent News",
        query: `${companyName} news 2025 announcements products launches`,
        description: "Recent developments, product launches, and business updates"
      },
      {
        name: "Industry Context",
        query: `${companyName} industry market trends competitors challenges`,
        description: "Industry trends, market dynamics, and competitive landscape"
      }
    ];
    
    // Add leadership search if contact role is specified
    if (contactRole) {
      searches.push({
        name: "Leadership Profile",
        query: `${contactRole} ${companyName} LinkedIn background`,
        description: "Contact background and professional profile"
      });
    }
    
    // Execute searches in parallel
    const searchPromises = searches.map(async (search) => {
      try {
        console.log(`[SalesCoachSkill] Searching: ${search.name}`);
        
        // Use the web search skill to perform the search
        const result = await this.webSearchSkill.execute({
          query: search.query,
          searchQuery: search.query // Pre-optimized query
        });
        
        // Validate result has substantial content
        const success = result && result.length > 200;
        
        if (success) {
          // Parse and truncate web search results to limit tokens (more concise)
          const truncatedContent = this.truncateWebSearchResults(result, 3500, 8000);
          console.log(`[SalesCoachSkill] ✓ ${search.name} - Success (${result.length} chars → ${truncatedContent.length} chars after truncation)`);
          
          return {
            name: search.name,
            description: search.description,
            query: search.query,
            success: true,
            content: truncatedContent
          };
        } else {
          console.log(`[SalesCoachSkill] ✗ ${search.name} - Failed or insufficient content`);
          return {
            name: search.name,
            description: search.description,
            query: search.query,
            success: false,
            content: ''
          };
        }
        
      } catch (error) {
        console.error(`[SalesCoachSkill] Error in ${search.name}:`, error);
        return {
          name: search.name,
          description: search.description,
          query: search.query,
          success: false,
          content: '',
          error: error.message
        };
      }
    });
    
    const results = await Promise.all(searchPromises);
    return results;
  }
  
  /**
   * Truncate web search results to limit token usage
   * Parses XML-formatted results, truncates each page to maxCharsPerPage,
   * and combines up to maxTotalChars per category
   * @param {string} webSearchResult XML-formatted web search results
   * @param {number} maxCharsPerPage Maximum characters per page (default 3500)
   * @param {number} maxTotalChars Maximum total characters per category (default 8000)
   * @returns {string} Truncated and formatted results
   */
  truncateWebSearchResults(webSearchResult, maxCharsPerPage = 3500, maxTotalChars = 8000) {
    if (!webSearchResult || webSearchResult.length === 0) {
      return '';
    }
    
    try {
      // Extract web_result blocks from XML
      const webResultRegex = /<web_result[^>]*>([\s\S]*?)<\/web_result>/g;
      const results = [];
      let match;
      
      while ((match = webResultRegex.exec(webSearchResult)) !== null) {
        const content = match[1].trim();
        if (content && content.length > 200) { // Only include substantial results
          // Truncate each page to maxCharsPerPage
          let truncated = content;
          if (content.length > maxCharsPerPage) {
            // Try to cut at sentence boundary
            truncated = content.substring(0, maxCharsPerPage);
            const lastPeriod = truncated.lastIndexOf('. ');
            const lastNewline = truncated.lastIndexOf('\n');
            const cutPoint = Math.max(lastPeriod, lastNewline);
            
            if (cutPoint > maxCharsPerPage * 0.8) {
              truncated = truncated.substring(0, cutPoint + 1) + '...';
            } else {
              truncated = truncated + '...';
            }
          }
          
          results.push({
            content: truncated,
            originalLength: content.length
          });
        }
      }
      
      // Combine results up to maxTotalChars, prioritizing top results
      let combined = '';
      let totalChars = 0;
      
      for (const result of results) {
        if (totalChars + result.content.length <= maxTotalChars) {
          combined += result.content + '\n\n---\n\n';
          totalChars += result.content.length;
        } else {
          // Add partial content if there's room
          const remaining = maxTotalChars - totalChars;
          if (remaining > 500) { // Only add if meaningful space remains
            combined += result.content.substring(0, remaining) + '...\n\n---\n\n';
          }
          break;
        }
      }
      
      // Preserve the original XML structure header/footer if present
      const headerMatch = webSearchResult.match(/<web_search_results[^>]*>[\s\S]*?The following are web search results/);
      const footerMatch = webSearchResult.match(/<\/web_search_results>/);
      
      let finalResult = '';
      if (headerMatch) {
        finalResult = headerMatch[0] + '\n\n';
      }
      finalResult += combined;
      if (footerMatch) {
        finalResult += '\n' + footerMatch[0];
      }
      
      return finalResult || combined;
      
    } catch (error) {
      console.error('[SalesCoachSkill] Error truncating web search results:', error);
      // Fallback: simple truncation
      if (webSearchResult.length > maxTotalChars) {
        return webSearchResult.substring(0, maxTotalChars) + '...';
      }
      return webSearchResult;
    }
  }
  
  /**
   * Build synthesis prompt for the main LLM to generate structured report
   * @param {Object} entityInfo Company and contact information
   * @param {Array} searchResults Results from web searches
   * @returns {string} Formatted prompt with all context
   */
  buildSynthesisPrompt(entityInfo, searchResults) {
    const { companyName, contactRole, contactName } = entityInfo;
    const successfulSearches = searchResults.filter(r => r.success);
    
    // Build research summary
    let researchSummary = `**Research Results:** ${successfulSearches.length}/${searchResults.length} searches successful\n\n`;
    
    searchResults.forEach(result => {
      const status = result.success ? '✓' : '✗';
      researchSummary += `${status} **${result.name}**: ${result.description}\n`;
    });
    
    researchSummary += `\n---\n\n`;
    
    // Include all successful search content
    let searchContent = '';
    successfulSearches.forEach(result => {
      searchContent += `## ${result.name}\n\n${result.content}\n\n---\n\n`;
    });
    
    // Build contact reference for prompt
    const contactReference = contactName && contactRole 
      ? ` (meeting with ${contactName}, ${contactRole})`
      : contactRole 
        ? ` (meeting with ${contactRole})`
        : '';
    
    // Build the synthesis prompt
    const synthesisPrompt = `${researchSummary}**Please analyze the following web search results and create a comprehensive sales preparation report for ${companyName}${contactReference}.**

**IMPORTANT: Response Length Limit - CRITICAL**
- You MUST try to keep your response under 3,000 tokens 
- The hard limit is 3,500 tokens - if your response exceeds this, it will be cut off mid-sentence and be useless
- Be concise and focused - prioritize the most critical and actionable insights
- Use bullet points and tables to convey information efficiently
- Be selective about detail level - provide key points rather than exhaustive descriptions
- Keep sections brief: 2-3 bullet points per subsection maximum
- Prioritize: Executive Summary, Sales Call Insights (especially pain points), and Value Proposition Alignment
- Avoid redundancy - if information appears in multiple sections, choose the most relevant place

# Isaac Team Service Context

${JSON.stringify(isaacServices, null, 2)}

# Web Search Results

${searchContent}

# Report Structure Required

Please generate a detailed sales preparation report with the following sections:

## EXECUTIVE SUMMARY
- Brief overview of the company and contact (if specified)
- Key focus areas relevant to Isaac Team's services
- High-level value proposition alignment

## COMPANY OVERVIEW
- Company profile (history, size, locations) - include key statistics here
- Mission and vision
- Core products/services
- Target markets and customers
- Manufacturing/operations footprint (if available)

## RECENT NEWS & DEVELOPMENTS (2025)
- Major product launches and innovations (top 2 items)
- Strategic partnerships or acquisitions (most significant)
- Leadership changes (if significant)
- Business performance highlights

## INDUSTRY CONTEXT
- Market size and growth trends (brief)
- Key industry challenges (top 2)
- Competitive landscape (brief overview)
- Technology and market trends affecting the industry (most relevant)

## SALES CALL INSIGHTS
${contactRole || contactName ? `- **Key Decision-Maker Profile**: Provide a brief summary paragraph (3-5 sentences) covering:
  - Current role and key responsibilities
  - Tenure/background highlights (years with company, previous roles if found)
  - Education (if found in research)
  - Leadership style and priorities (based on research findings)
  - Any notable achievements or awards mentioned
` : ''}- **Critical Pain Points & Operational Challenges** (focus on top 3-4 most relevant):
  For each pain point, structure as follows:
  - **Pain Point Title** (e.g., "Manufacturing Capacity & Efficiency Constraints")
    - **The Challenge:** Brief description of the operational challenge and impact
    - **Isaac's Solution:** How Isaac addresses this challenge (1-2 sentences)
- Current strategic initiatives based on research (1 key initiative)

## ISAAC VALUE PROPOSITION ALIGNMENT
Briefly map Isaac Team's core capabilities to their top 2 most relevant needs:
- Their specific need/challenge
- How Isaac addresses it (1 sentence per capability)

## RECOMMENDED CONVERSATION APPROACH
Provide concise conversation guidance:

### Opening Positioning
- Provide a brief opening script/approach (2-3 sentences) that demonstrates understanding of their current situation and positions Isaac's value proposition

### Key Discussion Points
Organize into:
- **Validation Questions** (1-2 questions): Questions to validate your understanding of their priorities and challenges
- **Experience Sharing**: Brief mention of relevant Isaac case studies or experience (1-2 examples)
- **Challenge Exploration** (2-3 questions): Questions to explore specific operational challenges and opportunities

### Addressing Potential Objections
- Identify 2-3 likely objections based on research (e.g., "We just completed major investments", "We have internal teams", "Budget constraints")
- Provide brief response approaches for each objection (1-2 sentences each)

### Closing & Next Steps
- Suggest a specific engagement proposal (e.g., "90-day focused engagement", "Rapid diagnostic assessment")
- Include a clear call-to-action or next step recommendation

## KEY STATISTICS TO REFERENCE
Extract and highlight the most important quantitative data from research (5-7 key metrics: employee count, revenue, market size, growth rates, product metrics, etc.)

## CAUTIONS & CONSIDERATIONS
Briefly note 1-2 most critical factors to be aware of (industry-specific, regulatory, or organizational)

## NEXT STEPS AFTER THE MEETING
Suggest appropriate engagement types:
- Discovery Workshop
- Pilot Project
- Case study preparation needs
---

Format the report in clean, professional markdown. Use bullet points, tables, and clear hierarchical structure. Be specific and actionable, not generic. Reference specific facts from the research to demonstrate preparation quality.`;

    return synthesisPrompt;
  }
  
  /**
   * Determine if this skill should handle the query
   * @param {string} query The user's query
   * @param {Object} context Additional context
   * @returns {Promise<boolean>} True if skill should execute
   */
  async canHandle(query, context) {
    if (!query || !query.trim()) {
      return false;
    }
    
    const lowerQuery = query.toLowerCase();
    
    // Explicit sales/meeting prep triggers
    const salesTriggers = [
      'sales prep',
      'meeting prep',
      'prepare for',
      'sales call',
      'client research',
      'research company',
      'research client',
      'sales discovery',
      'discovery call',
      'meeting with',
      'call with',
      'prepare meeting',
      'sales coach',
      'discovery coach'
    ];
    
    for (const trigger of salesTriggers) {
      if (lowerQuery.includes(trigger)) {
        console.log(`[SalesCoachSkill] Triggered by: "${trigger}"`);
        return true;
      }
    }
    
    // Check if query mentions a company with intent to research
    const researchIntent = /(research|prepare|meeting|call|sales).+(company|client|prospect)/i;
    if (researchIntent.test(query)) {
      console.log('[SalesCoachSkill] Research intent detected');
      return true;
    }
    
    return false;
  }
}

module.exports = { SalesCoachSkill };

