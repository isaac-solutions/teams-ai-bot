/**
 * Citation Builder - Extracts and formats citations from RAG context
 */
class CitationBuilder {
  /**
   * Extract citations from RAG context string
   * @param {string} ragContext Context string with <context source="..."> tags
   * @returns {Array} Array of citation objects
   */
  static extractCitations(ragContext) {
    if (!ragContext || !ragContext.trim()) {
      return [];
    }

    const citations = [];
    const contextMatches = ragContext.match(/<context source="([^"]+)">([\s\S]*?)<\/context>/g);
    
    if (!contextMatches) {
      return [];
    }

    contextMatches.forEach((match, index) => {
      const sourceMatch = match.match(/source="([^"]+)"/);
      const contentMatch = match.match(/<context[^>]*>([\s\S]*?)<\/context>/);
      
      if (sourceMatch && contentMatch) {
        const source = sourceMatch[1];
        const content = contentMatch[1].trim();
        
        citations.push({
          position: index + 1,
          name: source,
          abstract: content.length > 300 ? content.substring(0, 300) + '...' : content,
          fullContent: content
        });
      }
    });

    return citations;
  }

  /**
   * Add citations to a MessageActivity
   * @param {Object} messageActivity Teams MessageActivity object
   * @param {Array} citations Array of citation objects
   * @returns {Object} MessageActivity with citations added
   */
  static addCitationsToMessage(messageActivity, citations) {
    if (!citations || citations.length === 0) {
      return messageActivity;
    }

    citations.forEach((citation) => {
      messageActivity.addCitation(citation.position, {
        name: citation.name,
        abstract: citation.abstract
      });
    });

    return messageActivity;
  }

  /**
   * Format context for LLM prompt with citation markers
   * @param {string} ragContext RAG context with source tags
   * @returns {string} Formatted context with citation instructions
   */
  static formatContextForPrompt(ragContext) {
    if (!ragContext || !ragContext.trim()) {
      return '';
    }

    const header = `## Knowledge Base Context\n\n` +
                  `The following information has been retrieved from the company knowledge base. ` +
                  `When using this information, cite the sources using the format [SourceName].\n\n`;

    return header + ragContext;
  }

  /**
   * Format file context for LLM prompt
   * @param {string} fileContext Extracted file content
   * @param {number} fileCount Number of files processed
   * @returns {string} Formatted file context
   */
  static formatFileContextForPrompt(fileContext, fileCount = 0) {
    if (!fileContext || !fileContext.trim()) {
      return '';
    }

    const header = `## Uploaded Documents (${fileCount} file${fileCount !== 1 ? 's' : ''})\n\n` +
                  `The user has uploaded the following document(s). Use this information to answer their questions.\n\n`;

    return header + fileContext;
  }

  /**
   * Combine RAG and file contexts
   * @param {string} ragContext RAG search results
   * @param {string} fileContext File processing results
   * @param {number} fileCount Number of files
   * @returns {string} Combined context for LLM
   */
  static combineContexts(ragContext, fileContext, fileCount = 0) {
    let combined = '';

    if (ragContext && ragContext.trim()) {
      combined += this.formatContextForPrompt(ragContext);
    }

    if (fileContext && fileContext.trim()) {
      if (combined) combined += '\n\n---\n\n';
      combined += this.formatFileContextForPrompt(fileContext, fileCount);
    }

    return combined;
  }
}

module.exports = { CitationBuilder };

