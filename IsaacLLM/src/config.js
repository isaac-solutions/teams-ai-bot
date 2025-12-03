const config = {
  MicrosoftAppId: process.env.CLIENT_ID,
  MicrosoftAppType: process.env.BOT_TYPE,
  MicrosoftAppTenantId: process.env.TENANT_ID,
  MicrosoftAppPassword: process.env.CLIENT_SECRET,
  // Anthropic configuration (primary model for chat responses)
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicEndpoint: process.env.ANTHROPIC_ENDPOINT,
  anthropicDeploymentName: process.env.ANTHROPIC_DEPLOYMENT_NAME,
  // Azure OpenAI configuration
  azureOpenAIKey: process.env.AZURE_OPENAI_API_KEY,
  azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
  azureOpenAIDeploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
  // Lightweight model for skill routing and quick analysis (preprocessing/intent detection)
  azureOpenAIMiniDeploymentName: process.env.AZURE_OPENAI_MINI_DEPLOYMENT_NAME || process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
  // New additions for Azure AI Search
  azureOpenAIEmbeddingDeploymentName: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME,
  azureSearchKey: process.env.AZURE_SEARCH_KEY,
  azureSearchEndpoint: process.env.AZURE_SEARCH_ENDPOINT,
  // Google Custom Search API (for web search functionality)
  googleApiKey: process.env.GOOGLE_SEARCH_API_KEY,
  googleSearchEngineId: process.env.GOOGLE_SEARCH_ENGINE_ID,
  // Jina Reader Pro API (for content extraction)
  jinaApiKey: process.env.JINA_KEY || process.env.JINA_API_KEY,
};

module.exports = config;
