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
        
        const selectedFields = [
            "id",
            "content",
            "sourcefile",
            "sourcepage",
            "category",
            "userId",
            "documentScope"
        ];

        try {
            // hybrid search
            const queryVector = await this.getEmbeddingVector(query);
            
            // Build filter for multi-tenant access:
            // Show company-wide documents OR user's personal documents
            let filter = "documentScope eq 'company-wide'";
            if (userId) {
                filter = `documentScope eq 'company-wide' or userId eq '${userId}'`;
            }
            
            const searchResults = await this.searchClient.search(query, {
                searchFields: ["content"],
                select: selectedFields,
                top: 3,
                filter: filter,
                vectorSearchOptions: {
                    queries: [
                        {
                            kind: "vector",
                            fields: ["embedding"],
                            kNearestNeighborsCount: 3,
                            // The query vector is the embedding of the user's input
                            vector: queryVector
                        }
                    ]
                },
            });

            if (!searchResults.results) {
                return "";
            }

            let doc = "";
            for await (const result of searchResults.results) {
                // Create a more detailed citation with page info if available
                const citation = result.document.sourcefile || 'Unknown Document';
                const pageInfo = result.document.sourcepage ? ` (Page ${result.document.sourcepage})` : '';
                const category = result.document.category ? ` [${result.document.category}]` : '';
                const scope = result.document.documentScope === 'personal' ? ' [Personal Document]' : '';
                
                const formattedResult = this.formatDocument(
                    result.document.content, 
                    `${citation}${pageInfo}${category}${scope}`
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
        const client = new AzureOpenAI({
            apiKey: this.options.azureOpenAIApiKey,
            endpoint: this.options.azureOpenAIEndpoint,
            apiVersion: "2024-02-01",
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

