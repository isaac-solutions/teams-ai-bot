const { BaseSkill } = require('./baseSkill');

/**
 * RAG Search Skill - Searches Azure AI Search for company knowledge and user documents
 */
class RAGSearchSkill extends BaseSkill {
  /**
   * @param {Object} dataSource Instance of AzureAISearchDataSource
   */
  constructor(dataSource) {
    super('rag_search', 'Search company knowledge base and user-specific documents');
    this.dataSource = dataSource;
  }
  
  /**
   * Execute RAG search
   * @param {Object} context Contains query and userId
   * @returns {Promise<string|null>} Formatted context from search results
   */
  async execute(context) {
    const { query, userId } = context;
    
    if (!query || !this.dataSource) {
      return null;
    }

    try {
      console.log(`[RAGSearchSkill] Searching for: "${query}" (user: ${userId})`);
      const ragContext = await this.dataSource.renderContext(query, userId);
      
      if (ragContext && ragContext.trim()) {
        console.log(`[RAGSearchSkill] Found ${ragContext.split('<context').length - 1} relevant documents`);
        return ragContext;
      }
      
      console.log('[RAGSearchSkill] No relevant documents found');
      return null;
    } catch (error) {
      console.error('[RAGSearchSkill] Error during search:', error);
      return null;
    }
  }
  
  /**
   * Determine if RAG search should run
   * Skip for file-only queries like "summarize this document"
   */
  async canHandle(query, context) {
    if (!query) return false;
    
    // Skip RAG for explicit file-only requests
    const fileOnlyPatterns = /^(summarize|analyze|explain) (this|the) (file|document|attachment)/i;
    const isFileOnlyQuery = fileOnlyPatterns.test(query.trim());
    
    if (isFileOnlyQuery && context.hasFiles) {
      console.log('[RAGSearchSkill] Skipping - file-only query detected');
      return false;
    }
    
    return true;
  }
}

module.exports = { RAGSearchSkill };

