const { AzureKeyCredential, SearchClient } = require("@azure/search-documents");
const { AzureOpenAI } = require("openai");

/**
 * A data source that searches through Azure AI search.
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
     * @returns {Promise<string>} Rendered context
     */
    async renderContext(query) {
        if(!query) {
            return "";
        }
        
        const selectedFields = [
            "id",
            "content",
            "sourcefile",
            "sourcepage",
            "category",
        ];

        // hybrid search
        const queryVector = await this.getEmbeddingVector(query);
        const searchResults = await this.searchClient.search(query, {
            searchFields: ["content"],
            select: selectedFields,
            top: 1,
            vectorSearchOptions: {
                queries: [
                    {
                        kind: "vector",
                        fields: ["embedding"],
                        kNearestNeighborsCount: 1,
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
            
            const formattedResult = this.formatDocument(
                result.document.content, 
                `${citation}${pageInfo}${category}`
            );
            doc += formattedResult;
        }

        return doc;
    }

    /**
     * Formats a document with its citation for inclusion in context.
     * @param {string} content The document content
     * @param {string} citation The source citation
     * @returns {string} Formatted document string
     * @private
     */
    formatDocument(content, citation) {
        return `<context source="${citation}">\n${content}\n</context>`;
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
}

module.exports = { AzureAISearchDataSource };