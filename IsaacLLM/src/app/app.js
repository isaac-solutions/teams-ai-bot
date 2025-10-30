const { ManagedIdentityCredential } = require("@azure/identity");
const { App } = require("@microsoft/teams.apps");
const { ChatPrompt } = require("@microsoft/teams.ai");
const { LocalStorage } = require("@microsoft/teams.common");
const { OpenAIChatModel } = require("@microsoft/teams.openai");
const { MessageActivity } = require('@microsoft/teams.api');
const fs = require('fs');
const path = require('path');
const config = require("../config");

// Import skills architecture
const { AzureAISearchDataSource } = require("./azureAISearchDataSource");
const { RAGSearchSkill } = require("./skills/ragSearchSkill");
const { FileProcessingSkill } = require("./skills/fileProcessingSkill");
const { IndexDocumentSkill } = require("./skills/indexDocumentSkill");
const { WebSearchSkill } = require("./skills/webSearchSkill");
const { SimpleRouter } = require("./orchestration/simpleRouter");
const { CitationBuilder } = require("./utils/citationBuilder");

// Create storage for conversation history
const storage = new LocalStorage();

// Load instructions from file on initialization
function loadInstructions() {
  const instructionsFilePath = path.join(__dirname, "instructions.txt");
  return fs.readFileSync(instructionsFilePath, 'utf-8').trim();
}

// Load instructions once at startup
const instructions = loadInstructions();

// Initialize Azure AI Search Data Source (if configured)
let dataSource = null;
let skills = [];
let router = null;

try {
  if (config.azureSearchEndpoint && config.azureSearchKey && config.azureOpenAIEmbeddingDeploymentName) {
    console.log('[Init] Initializing Azure AI Search data source...');
    dataSource = new AzureAISearchDataSource({
      name: "azure-ai-search",
      indexName: "gptkbindex", // Actual Azure index name
      azureAISearchApiKey: config.azureSearchKey,
      azureAISearchEndpoint: config.azureSearchEndpoint,
      azureOpenAIApiKey: config.azureOpenAIKey,
      azureOpenAIEndpoint: config.azureOpenAIEndpoint,
      azureOpenAIEmbeddingDeploymentName: config.azureOpenAIEmbeddingDeploymentName
    });
    
    // Initialize skills
    const webSearchSkill = new WebSearchSkill({
      googleApiKey: config.googleApiKey,
      googleSearchEngineId: config.googleSearchEngineId,
      azureOpenAIKey: config.azureOpenAIKey,
      azureOpenAIEndpoint: config.azureOpenAIEndpoint,
      azureOpenAIDeploymentName: config.azureOpenAIDeploymentName
    });
    
    // Enable web search if credentials are configured
    if (config.googleApiKey && config.googleSearchEngineId) {
      webSearchSkill.enable();
      console.log('[Init] Google Web Search enabled');
    } else {
      console.log('[Init] Google Web Search not configured - skill disabled');
    }
    
    skills = [
      new RAGSearchSkill(dataSource),
      new FileProcessingSkill(),
      webSearchSkill
    ];
    
    // Initialize simple router
    router = new SimpleRouter(skills);
    
    console.log('[Init] Skills architecture initialized successfully');
  } else {
    console.log('[Init] Azure AI Search not configured - running in file-only mode');
    
    // Initialize web search skill even in file-only mode
    const webSearchSkill = new WebSearchSkill({
      googleApiKey: config.googleApiKey,
      googleSearchEngineId: config.googleSearchEngineId,
      azureOpenAIKey: config.azureOpenAIKey,
      azureOpenAIEndpoint: config.azureOpenAIEndpoint,
      azureOpenAIDeploymentName: config.azureOpenAIDeploymentName
    });
    
    if (config.googleApiKey && config.googleSearchEngineId) {
      webSearchSkill.enable();
      console.log('[Init] Google Web Search enabled');
    }
    
    // File processing only mode (with optional web search)
    skills = [new FileProcessingSkill(), webSearchSkill];
    router = new SimpleRouter(skills);
  }
} catch (error) {
  console.error('[Init] Error initializing skills:', error);
  // Fallback to file processing only
  skills = [new FileProcessingSkill()];
  router = new SimpleRouter(skills);
}

/**
 * Gets context window usage information using simple character count / 4 for token estimation
 * @param {Array} messages - Array of conversation messages
 * @param {string} instructions - System instructions
 * @returns {object} - Context usage info
 */
function getContextUsage(messages, instructions) {
  if (!messages || !Array.isArray(messages)) {
    return null;
  }
  
  // Simple token estimation: characters / 4
  let totalCharacters = 0;
  
  // Add instructions
  if (instructions) {
    totalCharacters += instructions.length;
  }
  
  // Add all message content
  messages.forEach(msg => {
    if (msg.content) {
      totalCharacters += msg.content.length;
    }
  });
  
  // Convert to estimated tokens (characters / 4)
  const estimatedTokens = Math.ceil(totalCharacters / 4);
  
  // GPT-4.1 mini context limit (conservative)
  const MAX_TOKENS = 64000;
  
  const usagePercentage = Math.min((estimatedTokens / MAX_TOKENS) * 100, 100);
  const isNearLimit = usagePercentage > 70; // Warning at 70%
  const isAtLimit = usagePercentage > 90; // Critical at 90%
  
  return {
    estimatedTokens,
    maxTokens: MAX_TOKENS,
    totalCharacters,
    usagePercentage: Math.round(usagePercentage),
    isNearLimit,
    isAtLimit,
    remainingTokens: MAX_TOKENS - estimatedTokens
  };
}

/**
 * Creates a compact adaptive card with reset button and context indicator
 * @param {object} contextUsage - Context usage information
 * @returns {object} - Adaptive card object
 */
function createResetCard(contextUsage = null) {
  const body = [];
  
  // Add context window indicator if provided
  if (contextUsage) {
    const color = contextUsage.isAtLimit ? "Attention" : 
                  contextUsage.isNearLimit ? "Warning" : "Good";
    
    const statusText = contextUsage.isAtLimit ? "⚠️ Context window nearly full!" :
                      contextUsage.isNearLimit ? "⚡ Context window getting full" :
                      "✅ Context window has space";
    
    body.push({
      type: "Container",
      style: "emphasis",
      items: [
        {
          type: "TextBlock",
          text: statusText,
          weight: "Bolder",
          size: "Small",
          color: color
        },
        {
          type: "TextBlock",
          text: `${contextUsage.usagePercentage}% used (${contextUsage.estimatedTokens.toLocaleString()}/${contextUsage.maxTokens.toLocaleString()} tokens)`,
          size: "Small",
          color: "Default"
        }
      ]
    });
  }
  
  return {
    type: "AdaptiveCard",
    version: "1.3",
    body: body,
     actions: [
       {
         type: "Action.Submit",
         title: "🔄 Reset Conversation",
         data: {
           action: "reset_conversation"
         }
       }
     ]
  };
}

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

// Create the app with storage
const app = new App({
  ...credentialOptions,
  storage
});

// Handle incoming messages
app.on('message', async ({ send, stream, activity }) => {
  // Get conversation history
  const conversationKey = `${activity.conversation.id}/${activity.from.id}`;
  const messages = storage.get(conversationKey) || [];
  const fileAcknowledgedKey = `${conversationKey}/fileAcknowledged`;
  const hasAcknowledgedFiles = storage.get(fileAcknowledgedKey) || false;
  const userId = activity.from.id;

  // Check for reset conversation command
  const userMessage = activity.text || '';
  if (userMessage.toLowerCase().trim() === '/reset' || 
      userMessage.toLowerCase().trim() === 'reset conversation' ||
      userMessage.toLowerCase().trim() === 'clear conversation' ||
      userMessage.toLowerCase().trim() === 'start over') {
    
    // Clear conversation history and file acknowledgment flag from storage
    storage.delete(conversationKey);
    storage.delete(fileAcknowledgedKey);
    
    // Send confirmation message
    await send("🔄 **Conversation Reset Complete**\n\nI've cleared our conversation history and started fresh. You can now begin a new conversation with me. Feel free to upload new files or ask me anything!");
    
    return; // Exit early since we've handled the reset
  }

  // Handle /my-docs command (list user's indexed documents)
  if (userMessage.toLowerCase().trim() === '/my-docs' && dataSource) {
    try {
      const userDocs = await dataSource.listUserDocuments(userId);
      
      if (userDocs.length === 0) {
        await send("📄 You don't have any personally indexed documents yet.\n\nUpload files and they'll be automatically indexed to your personal knowledge base for future searches.");
      } else {
        const docList = userDocs.map((doc, i) => `${i + 1}. ${doc.fileName} (ID: ${doc.id})`).join('\n');
        await send(`📄 **Your Indexed Documents (${userDocs.length})**\n\n${docList}\n\nThese documents are searchable across all your conversations.`);
      }
    } catch (error) {
      console.error('Error listing user documents:', error);
      await send("❌ Error retrieving your document list. Please try again later.");
    }
    return;
  }

  try {
    // Prepare context for skills routing
    const hasFiles = activity.attachments && activity.attachments.length > 0;
    const context = {
      userId: userId,
      attachments: activity.attachments || [],
      hasFiles: hasFiles,
      conversationId: activity.conversation.id
    };

    console.log(`[Message] Processing query from user ${userId}: "${userMessage.substring(0, 50)}..."`);
    
    // Route through skills to get RAG and file processing results
    const skillResults = await router.route(userMessage, context);
    
    console.log('[Message] Skill results:', Object.keys(skillResults).filter(k => skillResults[k] !== null));

    // Build enhanced instructions with context from skills
    let enhancedInstructions = instructions;
    let citations = [];
    
    // Add RAG context if available
    if (skillResults.rag_search && skillResults.rag_search.trim()) {
      const ragContext = CitationBuilder.formatContextForPrompt(skillResults.rag_search);
      enhancedInstructions += '\n\n' + ragContext;
      
      // Extract citations from RAG results
      citations = CitationBuilder.extractCitations(skillResults.rag_search);
      console.log(`[Message] Added ${citations.length} citations from RAG search`);
    }
    
    // Add web search context if available
    if (skillResults.web_search && skillResults.web_search.trim()) {
      enhancedInstructions += '\n\n' + skillResults.web_search;
      console.log(`[Message] Added web search results to context`);
    }
    
    // Handle file processing results
    let processedUserMessage = userMessage;
    if (skillResults.file_processing) {
      const fileResult = skillResults.file_processing;
      
      if (fileResult.successCount > 0) {
        const fileContext = CitationBuilder.formatFileContextForPrompt(
          fileResult.text, 
          fileResult.totalCount
        );
        enhancedInstructions += '\n\n' + fileContext;
        
        processedUserMessage = `${userMessage || 'Please analyze the uploaded document(s).'}`;
        
        // Send acknowledgment about file processing - only if this is the first time
        if (!hasAcknowledgedFiles) {
          await send(`✅ I've processed ${fileResult.successCount} file(s) and extracted the text content. The information is now available in our conversation context.`);
          storage.set(fileAcknowledgedKey, true);
        }
      } else if (fileResult.text && fileResult.text.trim()) {
        // Files were attempted but all failed
        await send("❌ I was unable to extract text content from the uploaded file(s). Please check the error details and try uploading a different file or verify the file format is supported.");
        return;
      }
    }

    // Create chat prompt with enhanced instructions
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

    // Generate response
    const response = await prompt.send(processedUserMessage);
    
    // Create response activity with AI generated indicator
    const responseActivity = new MessageActivity(response.content)
      .addAiGenerated()
      .addFeedback();
    
    // Add citations if we have them
    if (citations.length > 0) {
      CitationBuilder.addCitationsToMessage(responseActivity, citations);
      console.log(`[Message] Added ${citations.length} citations to response`);
    }
    
    await send(responseActivity);
    
    // Send reset card after response
    try {
      const contextUsage = getContextUsage(messages, enhancedInstructions);
      const resetCard = createResetCard(contextUsage);
      await send(resetCard);
    } catch (error) {
      console.error('Error creating reset card:', error);
      // Fallback to simple reset card
      try {
        const resetCard = createResetCard();
        await send(resetCard);
      } catch (fallbackError) {
        console.error('Even fallback reset card failed:', fallbackError);
      }
    }
    
    // Save updated conversation history
    storage.set(conversationKey, messages);
    
  } catch (error) {
    console.error('[Message] Error processing message:', error);
    await send("❌ I encountered an error while processing your request. Please try again or use /reset to start a fresh conversation.");
  }
});

app.on('message.submit.feedback', async ({ activity }) => {
  // Add custom feedback process logic here
  console.log("Your feedback is " + JSON.stringify(activity.value));
});

// Handle adaptive card submit actions
app.on('message.submit', async ({ send, activity }) => {
  console.log('Message submit event received:', JSON.stringify(activity, null, 2));
  
  const conversationKey = `${activity.conversation.id}/${activity.from.id}`;
  const fileAcknowledgedKey = `${conversationKey}/fileAcknowledged`;
  
  // Check if this is a reset conversation action
  if (activity.value && activity.value.action === 'reset_conversation') {
    console.log('Reset conversation action detected');
    // Clear conversation history and file acknowledgment flag from storage
    storage.delete(conversationKey);
    storage.delete(fileAcknowledgedKey);
    
    // Send confirmation message
    await send("🔄 **Conversation Reset Complete**\n\nI've cleared our conversation history and started fresh. You can now begin a new conversation with me. Feel free to upload new files or ask me anything!");
    console.log('Reset confirmation sent');
  } else {
    console.log('No matching action found, activity.value:', activity.value);
  }
});

module.exports = app;
