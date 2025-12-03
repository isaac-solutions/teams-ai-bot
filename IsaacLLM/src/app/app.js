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
const { CareerDevelopmentSkill } = require("./skills/careerDevelopmentSkill");
const { FileProcessingSkill } = require("./skills/fileProcessingSkill");
const { IndexDocumentSkill } = require("./skills/indexDocumentSkill");
const { WebSearchSkill } = require("./skills/webSearchSkill");
const { YahooFinanceSkill } = require("./skills/yahooFinanceSkill");
const { SalesCoachSkill } = require("./skills/salesCoachSkill");
const { NoteSummarySkill } = require("./skills/noteSummarySkill");
const { LLMOrchestrator } = require("./orchestration/llmOrchestrator");
const { CitationBuilder } = require("./utils/citationBuilder");
const { AnthropicChatModel } = require("./anthropicChatModel");

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
      jinaApiKey: config.jinaApiKey,
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
    
    // Initialize Yahoo Finance skill with LLM support for ticker extraction
    const yahooFinanceSkill = new YahooFinanceSkill({
      azureOpenAIKey: config.azureOpenAIKey,
      azureOpenAIEndpoint: config.azureOpenAIEndpoint,
      azureOpenAIDeploymentName: config.azureOpenAIDeploymentName
    });
    console.log('[Init] Yahoo Finance skill enabled');
    
    // Initialize Sales Coach skill with web search dependency
    const salesCoachSkill = new SalesCoachSkill({
      webSearchSkill: webSearchSkill,
      azureOpenAIKey: config.azureOpenAIKey,
      azureOpenAIEndpoint: config.azureOpenAIEndpoint,
      azureOpenAIMiniDeploymentName: config.azureOpenAIMiniDeploymentName
    });
    console.log('[Init] Sales Coach skill enabled');
    
    // Initialize Note Summary skill
    const noteSummarySkill = new NoteSummarySkill({
      azureOpenAIKey: config.azureOpenAIKey,
      azureOpenAIEndpoint: config.azureOpenAIEndpoint,
      azureOpenAIMiniDeploymentName: config.azureOpenAIMiniDeploymentName
    });
    console.log('[Init] Note Summary skill enabled');
    
    skills = [
      new CareerDevelopmentSkill(dataSource),
      new RAGSearchSkill(dataSource),
      new FileProcessingSkill(),
      yahooFinanceSkill,
      webSearchSkill,
      salesCoachSkill,
      noteSummarySkill
    ];
    
    // Initialize LLM-based orchestrator with GPT-4o-mini for intelligent routing
    router = new LLMOrchestrator(skills, {
      azureOpenAIKey: config.azureOpenAIKey,
      azureOpenAIEndpoint: config.azureOpenAIEndpoint,
      azureOpenAIMiniDeploymentName: config.azureOpenAIMiniDeploymentName
    });
    
    console.log('[Init] Skills architecture initialized successfully');
  } else {
    console.log('[Init] Azure AI Search not configured - running in file-only mode');
    
    // Initialize web search skill even in file-only mode
    const webSearchSkill = new WebSearchSkill({
      googleApiKey: config.googleApiKey,
      googleSearchEngineId: config.googleSearchEngineId,
      jinaApiKey: config.jinaApiKey,
      azureOpenAIKey: config.azureOpenAIKey,
      azureOpenAIEndpoint: config.azureOpenAIEndpoint,
      azureOpenAIDeploymentName: config.azureOpenAIDeploymentName
    });
    
    if (config.googleApiKey && config.googleSearchEngineId) {
      webSearchSkill.enable();
      console.log('[Init] Google Web Search enabled');
    }
    
    // Initialize Yahoo Finance skill with LLM support for ticker extraction
    const yahooFinanceSkill = new YahooFinanceSkill({
      azureOpenAIKey: config.azureOpenAIKey,
      azureOpenAIEndpoint: config.azureOpenAIEndpoint,
      azureOpenAIDeploymentName: config.azureOpenAIDeploymentName
    });
    console.log('[Init] Yahoo Finance skill enabled');
    
    // Initialize Sales Coach skill with web search dependency
    const salesCoachSkill = new SalesCoachSkill({
      webSearchSkill: webSearchSkill,
      azureOpenAIKey: config.azureOpenAIKey,
      azureOpenAIEndpoint: config.azureOpenAIEndpoint,
      azureOpenAIMiniDeploymentName: config.azureOpenAIMiniDeploymentName
    });
    console.log('[Init] Sales Coach skill enabled');
    
    // Initialize Note Summary skill
    const noteSummarySkill = new NoteSummarySkill({
      azureOpenAIKey: config.azureOpenAIKey,
      azureOpenAIEndpoint: config.azureOpenAIEndpoint,
      azureOpenAIMiniDeploymentName: config.azureOpenAIMiniDeploymentName
    });
    console.log('[Init] Note Summary skill enabled');
    
    // File processing only mode (with optional web search and finance)
    skills = [new FileProcessingSkill(), yahooFinanceSkill, webSearchSkill, salesCoachSkill, noteSummarySkill];
    router = new LLMOrchestrator(skills, {
      azureOpenAIKey: config.azureOpenAIKey,
      azureOpenAIEndpoint: config.azureOpenAIEndpoint,
      azureOpenAIMiniDeploymentName: config.azureOpenAIMiniDeploymentName
    });
  }
} catch (error) {
  console.error('[Init] Error initializing skills:', error);
  // Fallback to file processing only
  skills = [new FileProcessingSkill()];
  router = new LLMOrchestrator(skills, {
    azureOpenAIKey: config.azureOpenAIKey,
    azureOpenAIEndpoint: config.azureOpenAIEndpoint,
    azureOpenAIMiniDeploymentName: config.azureOpenAIMiniDeploymentName
  });
}

/**
 * Gets context window usage information using simple character count / 4 for token estimation
 * This includes:
 * - Enhanced instructions (base instructions + all research material: RAG, web search, sales coach, file processing, etc.)
 * - All conversation messages (user messages + assistant responses)
 * 
 * @param {Array} messages - Array of conversation messages (should include current user message and assistant response)
 * @param {string} instructions - Enhanced system instructions (includes all research material from skills)
 * @returns {object} - Context usage info
 */
function getContextUsage(messages, instructions) {
  if (!messages || !Array.isArray(messages)) {
    return null;
  }
  
  // Simple token estimation: characters / 4
  let totalCharacters = 0;
  let instructionChars = 0;
  let messageChars = 0;
  
  // Add instructions (includes all research material: RAG, web search, sales coach synthesis, file content, etc.)
  if (instructions) {
    instructionChars = instructions.length;
    totalCharacters += instructionChars;
  }
  
  // Add all message content (user messages + assistant responses)
  messages.forEach((msg, idx) => {
    if (msg.content) {
      const msgChars = msg.content.length;
      messageChars += msgChars;
      totalCharacters += msgChars;
    }
  });
  
  // Convert to estimated tokens (characters / 4)
  const estimatedTokens = Math.ceil(totalCharacters / 4);
  
  // Claude 3.5 Sonnet context limit (200k tokens, but using 64k as conservative estimate for display)
  const MAX_TOKENS = 64000;
  
  const usagePercentage = Math.min((estimatedTokens / MAX_TOKENS) * 100, 100);
  const isNearLimit = usagePercentage > 70; // Warning at 70%
  const isAtLimit = usagePercentage > 90; // Critical at 90%
  
  // Log breakdown for debugging
  console.log(`[ContextUsage] Breakdown: ${instructionChars} chars instructions, ${messageChars} chars messages, ${totalCharacters} total chars = ~${estimatedTokens} tokens`);
  
  return {
    estimatedTokens,
    maxTokens: MAX_TOKENS,
    totalCharacters,
    instructionChars,
    messageChars,
    usagePercentage: Math.round(usagePercentage),
    isNearLimit,
    isAtLimit,
    remainingTokens: MAX_TOKENS - estimatedTokens
  };
}

/**
 * Split large messages into chunks that fit within Teams message size limits
 * Teams has a ~28 KB limit per message, so we'll use 25 KB to be safe
 * Tries to split at markdown section boundaries (## headers) when possible
 * @param {string} content - The message content to split
 * @param {number} maxSizeBytes - Maximum size per chunk in bytes (default 25000 = ~25 KB)
 * @returns {Array<string>} Array of message chunks
 */
function chunkMessage(content, maxSizeBytes = 25000) {
  if (!content || content.length === 0) {
    return [];
  }
  
  // If content is already under limit, return as single chunk
  const contentBytes = Buffer.byteLength(content, 'utf8');
  if (contentBytes <= maxSizeBytes) {
    return [content];
  }
  
  console.log(`[Message] Content size (${contentBytes} bytes) exceeds Teams limit, splitting into chunks...`);
  
  const chunks = [];
  let currentChunk = '';
  let currentSize = 0;
  
  // Split by markdown headers (##) to try to keep sections together
  const sections = content.split(/(?=^##\s)/m);
  
  for (const section of sections) {
    const sectionBytes = Buffer.byteLength(section, 'utf8');
    
    // If section itself is too large, split it further by paragraphs
    if (sectionBytes > maxSizeBytes) {
      // If we have accumulated content, save it first
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = '';
        currentSize = 0;
      }
      
      // Split large section by double newlines (paragraphs)
      const paragraphs = section.split(/\n\n+/);
      for (const paragraph of paragraphs) {
        const paraBytes = Buffer.byteLength(paragraph, 'utf8');
        
        // If paragraph is still too large, split by sentences
        if (paraBytes > maxSizeBytes) {
          if (currentChunk) {
            chunks.push(currentChunk);
            currentChunk = '';
            currentSize = 0;
          }
          
          // Split by sentences (period followed by space or newline)
          const sentences = paragraph.split(/(?<=\.)\s+/);
          for (const sentence of sentences) {
            const sentBytes = Buffer.byteLength(sentence, 'utf8');
            const needsSeparator = currentChunk.length > 0;
            const separatorBytes = needsSeparator ? 1 : 0; // 1 byte for space
            
            if (currentSize + sentBytes + separatorBytes > maxSizeBytes) {
              if (currentChunk) {
                chunks.push(currentChunk);
                currentChunk = '';
                currentSize = 0;
              }
            }
            
            currentChunk += (needsSeparator ? ' ' : '') + sentence;
            currentSize += sentBytes + separatorBytes;
          }
        } else {
          // Paragraph fits, check if it fits in current chunk
          const needsSeparator = currentChunk.length > 0;
          const separatorBytes = needsSeparator ? 2 : 0; // 2 bytes for \n\n
          
          if (currentSize + paraBytes + separatorBytes > maxSizeBytes) {
            if (currentChunk) {
              chunks.push(currentChunk);
              currentChunk = '';
              currentSize = 0;
            }
          }
          
          currentChunk += (needsSeparator ? '\n\n' : '') + paragraph;
          currentSize += paraBytes + separatorBytes;
        }
      }
    } else {
      // Section fits, check if it fits in current chunk
      const needsSeparator = currentChunk.length > 0;
      const separatorBytes = needsSeparator ? 2 : 0; // 2 bytes for \n\n
      
      if (currentSize + sectionBytes + separatorBytes > maxSizeBytes) {
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = '';
          currentSize = 0;
        }
      }
      
      currentChunk += (needsSeparator ? '\n\n' : '') + section;
      currentSize += sectionBytes + separatorBytes;
    }
  }
  
  // Add remaining chunk
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  
  console.log(`[Message] Split message into ${chunks.length} chunks`);
  chunks.forEach((chunk, idx) => {
    console.log(`[Message] Chunk ${idx + 1}: ${Buffer.byteLength(chunk, 'utf8')} bytes`);
  });
  
  return chunks;
}

/**
 * Creates a compact adaptive card with reset button and context indicator
 * @param {object} contextUsage - Context usage information
 * @returns {object} - Adaptive card object
 */
function createResetCard(contextUsage = null) {
  const card = {
    type: "AdaptiveCard",
    version: "1.3",
    body: []
  };
  
  // If we have context usage, create a row with button column and usage column
  if (contextUsage) {
    card.body.push({
      type: "ColumnSet",
      spacing: "None",
      columns: [
        {
          type: "Column",
          width: "auto",
          items: [
            {
              type: "ActionSet",
              actions: [
                {
                  type: "Action.Submit",
                  title: "🔄 Reset Conversation ",
                  data: {
                    action: "reset_conversation"
                  }
                }
              ]
            }
          ]
        },
        {
          type: "Column",
          width: "stretch",
          verticalContentAlignment: "Center",
          items: [
            {
              type: "TextBlock",
              text: `${contextUsage.usagePercentage}% used`,
              size: "Small",
              horizontalAlignment: "Right",
              spacing: "None"
            }
          ]
        }
      ]
    });
  } else {
    // No context usage, just the button
    card.actions = [
      {
        type: "Action.Submit",
        title: "🔄 Reset Conversation",
        data: {
          action: "reset_conversation"
        }
      }
    ];
  }
  
  return card;
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

  // Check for reset action in activity value FIRST (from adaptive card buttons)
  // This must be checked BEFORE filtering short messages, as reset buttons may send placeholder text
  // Handle both direct value.action and nested value structures
  const actionValue = activity.value?.action || activity.value?.data?.action;
  if (actionValue === 'reset_conversation' || (activity.value && typeof activity.value === 'object' && activity.value.action === 'reset_conversation')) {
    console.log('[Message] Reset action detected in message event (from button press)');
    // Clear conversation history and file acknowledgment flag from storage
    storage.delete(conversationKey);
    storage.delete(fileAcknowledgedKey);
    
    console.log(`[Message] Reset button executed - cleared conversation for ${conversationKey}`);
    
    // Send confirmation message
    await send("🔄 **Conversation Reset Complete**\n\nI've cleared our conversation history and started fresh. You can now begin a new conversation with me. Feel free to upload new files or ask me anything!");
    return; // Exit early since we've handled the reset
  }

  // Check for reset conversation command
  const userMessage = activity.text || '';
  if (userMessage.toLowerCase().trim() === '/reset' || 
      userMessage.toLowerCase().trim() === 'reset conversation' ||
      userMessage.toLowerCase().trim() === 'clear conversation' ||
      userMessage.toLowerCase().trim() === 'start over') {
    
    // Clear conversation history and file acknowledgment flag from storage
    storage.delete(conversationKey);
    storage.delete(fileAcknowledgedKey);
    
    console.log(`[Message] Reset command executed - cleared conversation for ${conversationKey}`);
    
    // Send confirmation message
    await send("🔄 **Conversation Reset Complete**\n\nI've cleared our conversation history and started fresh. You can now begin a new conversation with me. Feel free to upload new files or ask me anything!");
    
    return; // Exit early since we've handled the reset
  }
  
  // Skip processing placeholder or very short messages (like "..." from reset buttons)
  // But only if it's not a reset action (checked above)
  if (!userMessage || userMessage.trim().length < 4 || userMessage.trim() === '...') {
    console.log('[Message] Skipping placeholder or very short message');
    return;
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
    // Only count actual file attachments (not citations, mentions, etc.)
    const fileAttachments = (activity.attachments || []).filter(att => 
      att.contentType && (
        att.contentType.startsWith('application/') || 
        att.contentType.startsWith('text/') ||
        att.contentType === 'application/vnd.microsoft.teams.file.download.info'
      )
    );
    const hasFiles = fileAttachments.length > 0;
    const context = {
      userId: userId,
      attachments: fileAttachments,
      hasFiles: hasFiles,
      conversationId: activity.conversation.id
    };

    console.log(`[Message] Processing query from user ${userId}: "${userMessage.substring(0, 50)}..."`);
    if (hasFiles) {
      console.log(`[Message] ${fileAttachments.length} file attachment(s) detected`);
    }
    
    // Add send function to context so skills can send immediate messages
    context.send = send;
    
    // Route through skills to get RAG and file processing results
    const skillResults = await router.route(userMessage, context);
    
    console.log('[Message] Skill results:', Object.keys(skillResults).filter(k => skillResults[k] !== null));

    // Build enhanced instructions with context from skills
    let enhancedInstructions = instructions;
    let citations = [];
    
    // Add RAG context if available
    if (skillResults.rag_search && skillResults.rag_search.trim()) {
      const ragContext = CitationBuilder.formatContextForPrompt(skillResults.rag_search);
      enhancedInstructions += '\n\n**IMPORTANT: Knowledge base search has already been performed. The results are provided below. Do NOT use <search_company_knowledge> tags - just use the information directly in your response.**\n\n' + ragContext;
      
      // Extract citations from RAG results
      citations = CitationBuilder.extractCitations(skillResults.rag_search);
      console.log(`[Message] Added ${citations.length} citations from RAG search`);
    }
    
    // Add Yahoo Finance data if available
    if (skillResults.yahoo_finance && skillResults.yahoo_finance.trim()) {
      enhancedInstructions += '\n\n' + skillResults.yahoo_finance;
      console.log(`[Message] Added Yahoo Finance data to context`);
    }
    
    // Add web search context if available
    if (skillResults.web_search && skillResults.web_search.trim()) {
      enhancedInstructions += '\n\n**IMPORTANT: Web search has already been performed. The results are provided below. Do NOT use <search_web> tags or announce searches - just use the information directly in your response.**\n\n' + skillResults.web_search;
      console.log(`[Message] Added web search results to context`);
    }
    
    // Add sales coach synthesis prompt if available
    if (skillResults.sales_coach && skillResults.sales_coach.trim()) {
      enhancedInstructions += '\n\n' + skillResults.sales_coach;
      console.log(`[Message] Added sales coach synthesis prompt to context`);
    }
    
    // Handle file processing results
    let processedUserMessage = userMessage;
    if (skillResults.file_processing) {
      const fileResult = skillResults.file_processing;
      
      if (fileResult.successCount > 0) {
        // If note_summary is active, it will use file_processing results directly
        // Otherwise, format file context for general use
        if (!skillResults.note_summary) {
          const fileContext = CitationBuilder.formatFileContextForPrompt(
            fileResult.text, 
            fileResult.totalCount
          );
          enhancedInstructions += '\n\n' + fileContext;
        }
         
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
    
    // Add note summary prompt if available (after file processing so it can use file results)
    // If file_processing results are available and note_summary was triggered, re-execute with file results
    let noteSummaryData = null;
    if (skillResults.file_processing && skillResults.file_processing.successCount > 0) {
      const noteSummarySkill = skills.find(s => s.name === 'note_summary');
      // Re-execute note_summary with file_processing results if skill exists and was triggered
      if (noteSummarySkill && (skillResults.note_summary !== null && skillResults.note_summary !== undefined)) {
        const enhancedNoteSummary = await noteSummarySkill.execute({
          query: userMessage,
          file_processing: skillResults.file_processing,
          hasFiles: true
        });
        if (enhancedNoteSummary) {
          noteSummaryData = enhancedNoteSummary;
        }
      }
    } else if (skillResults.note_summary) {
      // Use the initial note_summary result (from query text, no files)
      noteSummaryData = skillResults.note_summary;
    }
    
    // Handle note summary data - extract prompt for system instructions, notes for user message
    if (noteSummaryData) {
      if (typeof noteSummaryData === 'object' && noteSummaryData.prompt) {
        // New format: object with prompt and notes
        enhancedInstructions += '\n\n' + noteSummaryData.prompt;
        // Add notes to user message instead of system instructions
        if (noteSummaryData.notes) {
          processedUserMessage = noteSummaryData.notes;
        }
        console.log(`[Message] Added note summary prompt to context (notes in user message)`);
      } else if (typeof noteSummaryData === 'string' && noteSummaryData.trim()) {
        // Legacy format: just a string (for backward compatibility)
        enhancedInstructions += '\n\n' + noteSummaryData;
        console.log(`[Message] Added note summary prompt to context`);
      }
    }

    // Create chat prompt with enhanced instructions
    // Use Anthropic (Claude) for main chat responses, fallback to Azure OpenAI if not configured
    let chatModel;
    if (config.anthropicApiKey && config.anthropicDeploymentName) {
      console.log('[Message] Using Anthropic model for chat response');
      chatModel = new AnthropicChatModel({
        model: config.anthropicDeploymentName,
        apiKey: config.anthropicApiKey,
        endpoint: config.anthropicEndpoint, // Optional, for Azure-hosted Anthropic
        maxTokens: 4000, // Reduced to ensure responses stay under 4k tokens
        temperature: 1.0
      });
    } else {
      console.log('[Message] Anthropic not configured, using Azure OpenAI fallback');
      chatModel = new OpenAIChatModel({
        model: config.azureOpenAIDeploymentName,
        apiKey: config.azureOpenAIKey,
        endpoint: config.azureOpenAIEndpoint,
        apiVersion: "2024-10-21"
      });
    }
    
    const prompt = new ChatPrompt({
      messages,
      instructions: enhancedInstructions,
      model: chatModel
    });
    
    // Store messages and instructions in the model for ChatPrompt compatibility
    // ChatPrompt may call send() with just the new message, so we need to store the full context
    if (chatModel.setMessages && chatModel.setInstructions) {
      chatModel.setMessages(messages);
      chatModel.setInstructions(enhancedInstructions);
    }

    // Generate response
    const response = await prompt.send(processedUserMessage);
    
    // Check if response needs to be chunked (Teams has ~28 KB limit per message)
    const responseContent = response.content || '';
    const chunks = chunkMessage(responseContent);
    
    // ChatPrompt internally manages the messages array and automatically adds both 
    // the user message and assistant response. We don't need to manually add them
    // as that would cause duplicate messages in the conversation history.
    // The messages array passed to ChatPrompt is updated in place.
    
    // Send each chunk as a separate message
    // Add citations only to the first chunk
    for (let i = 0; i < chunks.length; i++) {
      let chunkContent = chunks[i];
      
      // Add chunk indicator if multiple chunks
      if (chunks.length > 1) {
        chunkContent += `\n\n---\n*Part ${i + 1} of ${chunks.length}*`;
      }
      
      const responseActivity = new MessageActivity(chunkContent)
        .addAiGenerated();
      
      // Only add feedback button to last chunk
      if (i === chunks.length - 1) {
        responseActivity.addFeedback();
      }
      
      // Add citations only to first chunk
      if (i === 0 && citations.length > 0) {
        CitationBuilder.addCitationsToMessage(responseActivity, citations);
        console.log(`[Message] Added ${citations.length} citations to first chunk`);
      }
      
      await send(responseActivity);
    }
    
    // Send reset card after response
    // Calculate context usage including: enhancedInstructions (with all research material), 
    // all conversation messages (including the response we just generated)
    try {
      const contextUsage = getContextUsage(messages, enhancedInstructions);
      console.log(`[Message] Context usage: ${contextUsage.estimatedTokens} tokens (${contextUsage.usagePercentage}% of ${contextUsage.maxTokens})`);
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
    
    // Save updated conversation history (now includes user message and assistant response)
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
  console.log('[Message.submit] Event received');
  console.log('[Message.submit] Activity keys:', Object.keys(activity || {}));
  console.log('[Message.submit] Activity.value:', JSON.stringify(activity?.value, null, 2));
  
  const conversationKey = `${activity.conversation.id}/${activity.from.id}`;
  const fileAcknowledgedKey = `${conversationKey}/fileAcknowledged`;
  
  // Check if this is a reset conversation action
  // Handle both direct value.action and nested value structures
  const actionValue = activity.value?.action || activity.value?.data?.action || activity.value;
  if (actionValue === 'reset_conversation' || (typeof actionValue === 'object' && actionValue.action === 'reset_conversation')) {
    console.log('[Message.submit] Reset conversation action detected from button press');
    // Clear conversation history and file acknowledgment flag from storage
    // This matches exactly what /reset command does
    storage.delete(conversationKey);
    storage.delete(fileAcknowledgedKey);
    
    console.log(`[Message.submit] Reset button executed - cleared conversation for ${conversationKey}`);
    
    // Send confirmation message (same as /reset command)
    await send("🔄 **Conversation Reset Complete**\n\nI've cleared our conversation history and started fresh. You can now begin a new conversation with me. Feel free to upload new files or ask me anything!");
    console.log('[Message.submit] Reset confirmation sent');
  } else {
    console.log('[Message.submit] No matching action found. activity.value:', JSON.stringify(activity.value, null, 2));
  }
});

module.exports = app;
