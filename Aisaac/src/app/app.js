const { App } = require("@microsoft/teams.apps");
const { ChatPrompt } = require("@microsoft/teams.ai");
const { LocalStorage } = require("@microsoft/teams.common");
const { OpenAIChatModel } = require("@microsoft/teams.openai");
const { MessageActivity, TokenCredentials } = require('@microsoft/teams.api');
const { ManagedIdentityCredential } = require('@azure/identity');
const fs = require('fs');
const path = require('path');
const config = require("../config");
const { AzureAISearchDataSource } = require("./azureAISearchDataSource");

// Create storage for conversation history
const storage = new LocalStorage();

// Initialize the standalone data source
const dataSource = new AzureAISearchDataSource({
    name: "azure-ai-search",
    indexName: "gptkbindex",
    azureAISearchApiKey: config.azureSearchKey,
    azureAISearchEndpoint: config.azureSearchEndpoint,
    azureOpenAIApiKey: config.azureOpenAIKey,
    azureOpenAIEndpoint: config.azureOpenAIEndpoint,
    azureOpenAIEmbeddingDeploymentName: config.azureOpenAIEmbeddingDeploymentName
});

// Load instructions from file on initialization
function loadInstructions() {
  const instructionPath = path.join(__dirname, 'instructions.txt');
  return fs.readFileSync(instructionPath, 'utf-8').trim();
}

// Load instructions once at startup
const instructions = loadInstructions();

const createTokenFactory = () => {
  return async (scope, tenantId) => {
    const managedIdentityCredential = new ManagedIdentityCredential({
        clientId: process.env.CLIENT_ID
      });
    const scopes = Array.isArray(scope) ? scope : [scope];
    const tokenResponse = await managedIdentityCredential.getToken(scopes, {
      tenantId: tenantId
    });
   
    return tokenResponse.token;
  };
};

// Configure authentication using TokenCredentials
const tokenCredentials = {
  clientId: process.env.CLIENT_ID || '',
  token: createTokenFactory()
};

const credentialOptions = config.MicrosoftAppType === "UserAssignedMsi" ? { ...tokenCredentials } : undefined;

// Create the main App instance
const app = new App({
  ...credentialOptions,
  storage
});

// Handle incoming messages
app.on('message', async ({ send, activity }) => {
  //Get conversation history
  const conversationKey = `${activity.conversation.id}/${activity.from.id}`;
  const messages = storage.get(conversationKey) || [];

  try {
    // Get relevant context from the data source
    const contextData = await dataSource.renderContext(activity.text);
    
    // Build enhanced instructions that include context if available
    let enhancedInstructions = instructions;
    if (contextData) {
      enhancedInstructions += `\n\nAdditional Context \n${contextData}`;
    }

    const prompt = new ChatPrompt({
      messages,
      instructions: enhancedInstructions,
      model: new OpenAIChatModel({
        model: config.azureOpenAIDeploymentName,
        apiKey: config.azureOpenAIKey,
        endpoint: config.azureOpenAIEndpoint,
        apiVersion: "2024-10-21"
      })
    });

    const response = await prompt.send(activity.text);
    
    // Create response with AI generated indicator and add citations if we used context
    let result = null;
    
    try {
      result = JSON.parse(response.content);
    } catch (error) {
      console.error(`Response is not valid json, using raw text. error: ${error}`);
      await send(response.content);
      return;
    }

    // Process citations if they exist in the parsed response
    const citations = [];
    let position = 1;
    let content = "";

    if (result && result.results && result.results.length > 0) {
      result.results.forEach((contentItem) => {
        if (contentItem.citationTitle ) {
          const citation = {
            name: contentItem.citationTitle || `Document #${position}`,
            abstract: contentItem.citationContent ?? `Full document content from ${contentItem.citationTitle}`,
          };
          
         content += `${contentItem.answer}[${position}]<br>`;
          
          position++;
          citations.push(citation);
        } else {
          // Add content without citation
          content += `${contentItem.answer}<br>`;
        }
      });
    } else if (contextData) {
      // If no structured results but we have context, create citations from context
      const contextMatches = contextData.match(/<context source="([^"]+)">([\s\S]*?)<\/context>/g);
      if (contextMatches) {
        contextMatches.forEach((match, index) => {
          const sourceMatch = match.match(/source="([^"]+)"/);
          const contentMatch = match.match(/<context[^>]*>([\s\S]*?)<\/context>/);
          
          if (sourceMatch && contentMatch) {
            const source = sourceMatch[1];
            const docContent = contentMatch[1].trim();
            
            const citation = {
              name: source,
              abstract: docContent.length > 200 ? docContent.substring(0, 200) + '...' : docContent,
            };
            
            citations.push(citation);
          }
        });
      }
    }
    
    const responseActivity = new MessageActivity(content).addAiGenerated();
    
    // Add citations from parsed response or fallback to context sources
    if (citations.length > 0) {
      citations.forEach((citation, index) => {
        responseActivity.addCitation(index + 1, {
          name: citation.name,
          abstract: `${citation.abstract}`
        });
      });
    } 
    
    await send(responseActivity);
    storage.set(conversationKey, messages);

  } catch (error) {
    console.error('Error processing message:', error);
    await send('Sorry, I encountered an error while processing your message.');
  }
});

module.exports = app;