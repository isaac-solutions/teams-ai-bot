const { BaseSkill } = require('./baseSkill');

/**
 * Index Document Skill - Indexes user documents to Azure AI Search for persistent retrieval
 */
class IndexDocumentSkill extends BaseSkill {
  /**
   * @param {Object} dataSource Instance of AzureAISearchDataSource
   */
  constructor(dataSource) {
    super('index_document', 'Index documents to user\'s personal knowledge base');
    this.dataSource = dataSource;
  }
  
  /**
   * Index a document to Azure AI Search
   * @param {Object} context Contains text, fileName, userId
   * @returns {Promise<Object|null>} Index result or null
   */
  async execute(context) {
    const { text, fileName, userId } = context;
    
    if (!text || !fileName || !userId || !this.dataSource) {
      console.log('[IndexDocumentSkill] Missing required parameters');
      return null;
    }

    try {
      console.log(`[IndexDocumentSkill] Indexing document: ${fileName} for user: ${userId}`);
      
      // Generate embedding for the document
      const embedding = await this.dataSource.getEmbeddingVector(text);
      
      // Create document object
      const document = {
        id: `user-${userId}-${Date.now()}-${this.sanitizeFileName(fileName)}`,
        content: text,
        userId: userId,
        documentScope: 'personal',
        sourcefile: fileName,
        sourcepage: null,
        category: 'user-uploaded',
        embedding: embedding
      };
      
      // Upload to Azure AI Search
      const result = await this.dataSource.uploadDocuments([document]);
      
      console.log(`[IndexDocumentSkill] Successfully indexed ${fileName}`);
      
      return {
        success: true,
        documentId: document.id,
        fileName: fileName
      };
      
    } catch (error) {
      console.error('[IndexDocumentSkill] Error indexing document:', error);
      return {
        success: false,
        error: error.message,
        fileName: fileName
      };
    }
  }
  
  /**
   * Sanitize file name for use in document ID
   * @param {string} fileName
   * @returns {string} Sanitized file name
   */
  sanitizeFileName(fileName) {
    return fileName.replace(/[^a-zA-Z0-9.-]/g, '_').substring(0, 50);
  }
  
  /**
   * This skill is called explicitly, not through routing
   */
  async canHandle(query, context) {
    return false; // Not used in routing - called directly when needed
  }
}

module.exports = { IndexDocumentSkill };

