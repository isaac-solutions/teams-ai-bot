const { AzureKeyCredential, SearchClient } = require("@azure/search-documents");
const { AzureOpenAI } = require("openai");

/**
 * A data source that searches through Azure AI search with multi-tenant support.
 * Supports both company-wide documents and user-specific documents.
 */
class AzureAISearchDataSource {
    /**
     * Creates a new `AzureAISearchDataSource` instance.
     * @param {Object} options Options for creating the data source.
     * @param {string} options.name Name of the data source.
     * @param {string} options.indexName Name of the Azure AI Search index.
     * @param {string} options.azureAISearchApiKey Azure AI Search API key.
     * @param {string} options.azureAISearchEndpoint Azure AI Search endpoint.
     * @param {string} options.azureOpenAIApiKey Azure OpenAI API key.
     * @param {string} options.azureOpenAIEndpoint Azure OpenAI endpoint.
     * @param {string} options.azureOpenAIEmbeddingDeploymentName Azure OpenAI Embedding deployment.
     */
    constructor(options) {
        this.name = options.name;
        this.options = options;
        this.searchClient = new SearchClient(
            options.azureAISearchEndpoint,
            options.indexName,
            new AzureKeyCredential(options.azureAISearchApiKey),
            {}
        );
    }

    /**
     * Renders search results into a formatted context string for use in prompts.
     * @param {string} query The original search query
     * @param {string} userId The Teams user ID for filtering user-specific documents
     * @returns {Promise<string>} Rendered context
     */
    async renderContext(query, userId = null) {
        if(!query) {
            return "";
        }

        try {
            // hybrid search
            const queryVector = await this.getEmbeddingVector(query);
            
            // Build search options using actual index field names
            // Actual gptkbindex schema: id, content, embedding, category, sourcepage, sourcefile
            const searchOptions = {
                searchFields: ["content"], // Search in content field
                top: 3,
                vectorSearchOptions: {
                    queries: [
                        {
                            kind: "vector",
                            fields: ["embedding"], // Use correct vector field name
                            kNearestNeighborsCount: 3,
                            vector: queryVector
                        }
                    ]
                }
            };
            
            const searchResults = await this.searchClient.search(query, searchOptions);

            if (!searchResults.results) {
                return "";
            }

            let doc = "";
            for await (const result of searchResults.results) {
                // Use actual gptkbindex schema fields
                const citation = result.document?.sourcefile || 'Unknown Document';
                const pageInfo = result.document?.sourcepage ? ` (Page ${result.document.sourcepage})` : '';
                const category = result.document?.category ? ` [${result.document.category}]` : '';
                const content = result.document?.content || '';
                
                if (!content) {
                    console.log('[RAGSearchSkill] Skipping result with no content');
                    continue;
                }
                
                const formattedResult = this.formatDocument(
                    content, 
                    `${citation}${pageInfo}${category}`
                );
                doc += formattedResult;
            }

            return doc;
        } catch (error) {
            console.error('Error searching Azure AI Search:', error);
            // Return empty string on error to allow bot to continue with other context
            return "";
        }
    }

    /**
     * Formats a document with its citation for inclusion in context.
     * @param {string} content The document content
     * @param {string} citation The source citation
     * @returns {string} Formatted document string
     * @private
     */
    formatDocument(content, citation) {
        return `<context source="${citation}">\n${content}\n</context>\n\n`;
    }

    /**
     * Generate embeddings for the user's input.
     * @param {string} text - The user's input.
     * @returns {Promise<number[]>} The embedding vector for the user's input.
     */
    async getEmbeddingVector(text) {
        // Extract base endpoint from full endpoint (may include /openai/deployments/...)
        let baseEndpoint = this.options.azureOpenAIEndpoint;
        
        // If endpoint contains /openai/, extract just the base URL
        if (baseEndpoint.includes('/openai/')) {
            const url = new URL(baseEndpoint);
            baseEndpoint = `${url.protocol}//${url.host}/`;
        }
        
        const client = new AzureOpenAI({
            apiKey: this.options.azureOpenAIApiKey,
            endpoint: baseEndpoint,
            apiVersion: "2024-08-01-preview", // Updated to stable API version for embeddings
        });
        
        const result = await client.embeddings.create({
            input: text,
            model: this.options.azureOpenAIEmbeddingDeploymentName,
        });

        if (!result.data || result.data.length === 0) {
            throw new Error(`Failed to generate embeddings for description: ${text}`);
        }

        return result.data[0].embedding;
    }

    /**
     * Upload documents to the search index
     * @param {Array} documents Array of documents to upload
     * @returns {Promise<void>}
     */
    async uploadDocuments(documents) {
        try {
            const result = await this.searchClient.uploadDocuments(documents);
            console.log(`Successfully uploaded ${result.results.length} documents`);
            return result;
        } catch (error) {
            console.error('Error uploading documents to Azure AI Search:', error);
            throw error;
        }
    }

    /**
     * Delete a document from the search index
     * @param {string} documentId The document ID to delete
     * @returns {Promise<void>}
     */
    async deleteDocument(documentId) {
        try {
            await this.searchClient.deleteDocuments([{ id: documentId }]);
            console.log(`Successfully deleted document: ${documentId}`);
        } catch (error) {
            console.error('Error deleting document from Azure AI Search:', error);
            throw error;
        }
    }

    /**
     * List user's personal documents
     * @param {string} userId The Teams user ID
     * @returns {Promise<Array>} Array of user's documents
     */
    async listUserDocuments(userId) {
        try {
            const searchResults = await this.searchClient.search("*", {
                filter: `userId eq '${userId}' and documentScope eq 'personal'`,
                select: ["id", "sourcefile", "category"],
                top: 100
            });

            const documents = [];
            for await (const result of searchResults.results) {
                documents.push({
                    id: result.document.id,
                    fileName: result.document.sourcefile,
                    category: result.document.category
                });
            }

            return documents;
        } catch (error) {
            console.error('Error listing user documents:', error);
            return [];
        }
    }
}

module.exports = { AzureAISearchDataSource };

