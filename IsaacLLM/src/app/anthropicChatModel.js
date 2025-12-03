const Anthropic = require('@anthropic-ai/sdk');

/**
 * Anthropic Chat Model adapter for Microsoft Teams AI SDK
 * 
 * This adapter allows the Teams AI SDK to use Anthropic's Claude models
 * for chat completions while maintaining compatibility with the Teams SDK interface.
 */
class AnthropicChatModel {
  /**
   * @param {Object} options Configuration options
   * @param {string} options.model The Anthropic model to use (e.g., "claude-3-5-sonnet-20241022")
   * @param {string} options.apiKey Anthropic API key
   * @param {string} [options.endpoint] Optional custom endpoint for Anthropic API
   * @param {number} [options.maxTokens=4096] Maximum tokens to generate
   * @param {number} [options.temperature=1.0] Temperature for response generation
   */
  constructor(options = {}) {
    this.model = options.model;
    this.maxTokens = options.maxTokens || 4096;
    this.temperature = options.temperature !== undefined ? options.temperature : 1.0;
    
    // Initialize Anthropic client
    const clientOptions = {
      apiKey: options.apiKey
    };
    
    // Support for custom endpoints (e.g., Azure-hosted Anthropic)
    if (options.endpoint) {
      clientOptions.baseURL = options.endpoint;
    }
    
    this.client = new Anthropic(clientOptions);
    
    // Store messages and instructions for ChatPrompt compatibility
    // ChatPrompt will call send() with just the new message, so we need to store
    // the full conversation history that ChatPrompt manages
    this._storedMessages = [];
    this._storedInstructions = null;
    
    console.log(`[AnthropicChatModel] Initialized with model: ${this.model}`);
  }
  
  /**
   * Set messages and instructions (called by ChatPrompt when initialized)
   * This allows ChatPrompt to pass the conversation history to the model
   */
  setMessages(messages) {
    this._storedMessages = Array.isArray(messages) ? messages : [];
    console.log(`[AnthropicChatModel] Stored ${this._storedMessages.length} messages`);
  }
  
  /**
   * Set instructions (called by ChatPrompt when initialized)
   */
  setInstructions(instructions) {
    this._storedInstructions = instructions;
    console.log(`[AnthropicChatModel] Stored instructions (${instructions?.length || 0} chars)`);
  }
  
  /**
   * Send a message (Teams AI SDK ChatPrompt interface)
   * ChatPrompt calls this with the new user message string, but it should have
   * stored the full conversation context internally. However, the Teams AI SDK
   * may call complete() instead. We'll handle both cases.
   * 
   * Note: If ChatPrompt calls send() with just a string, we need to get the
   * full context from ChatPrompt. But since we don't have access to that,
   * we'll rely on complete() being called instead.
   * 
   * @param {string|Object} messageOrContext Either a message string or context object
   * @returns {Promise<Object>} Response object with content property
   */
  async send(messageOrContext) {
    // Log what we received for debugging
    console.log(`[AnthropicChatModel] send() called with type: ${typeof messageOrContext}`);
    if (typeof messageOrContext === 'object' && messageOrContext !== null) {
      console.log(`[AnthropicChatModel] send() object keys:`, Object.keys(messageOrContext));
    }
    
    // If it's a context object with messages array, use complete() directly
    if (typeof messageOrContext === 'object' && messageOrContext !== null) {
      if (messageOrContext.messages && Array.isArray(messageOrContext.messages)) {
        return await this.complete(messageOrContext);
      }
    }
    
    // ChatPrompt calls send() with a single message object { role: 'user', content: '...' }
    // We need to combine it with stored messages from ChatPrompt initialization
    if (typeof messageOrContext === 'object' && messageOrContext !== null && messageOrContext.role && messageOrContext.content) {
      console.log('[AnthropicChatModel] send() received single message object, combining with stored messages');
      
      // Combine stored messages with the new message
      // If stored messages is empty (e.g., after reset), just use the single message
      const allMessages = this._storedMessages.length > 0 
        ? [...this._storedMessages, messageOrContext]
        : [messageOrContext];
      
      console.log(`[AnthropicChatModel] Combined ${this._storedMessages.length} stored messages with new message = ${allMessages.length} total`);
      
      // Build context object for complete()
      const context = {
        messages: allMessages,
        instructions: this._storedInstructions
      };
      
      return await this.complete(context);
    }
    
    // If it's a string, treat it as a user message
    if (typeof messageOrContext === 'string') {
      console.log('[AnthropicChatModel] send() received string, treating as user message');
      
      const allMessages = [...this._storedMessages, {
        role: 'user',
        content: messageOrContext
      }];
      
      const context = {
        messages: allMessages,
        instructions: this._storedInstructions
      };
      
      return await this.complete(context);
    }
    
    // Fallback: try to use as context object
    console.warn('[AnthropicChatModel] send() received unexpected format, attempting to use as context');
    return await this.complete(messageOrContext);
  }
  
  /**
   * Complete a chat prompt
   * This method is called by the Teams AI SDK's ChatPrompt class
   * 
   * @param {Object} context Context object from Teams AI SDK
   * @param {Array} context.messages Array of message objects with role and content
   * @param {string} [context.instructions] System instructions to prepend
   * @returns {Promise<Object>} Completion result
   */
  async complete(context) {
    try {
      // Log context structure for debugging
      console.log(`[AnthropicChatModel] complete() called with context keys:`, context ? Object.keys(context) : 'null');
      
      if (!context) {
        throw new Error('AnthropicChatModel.complete() requires a context object');
      }
      
      const { messages, instructions } = context;
      
      // Log message details
      if (messages) {
        console.log(`[AnthropicChatModel] Received ${messages.length} messages`);
        messages.forEach((msg, idx) => {
          console.log(`[AnthropicChatModel] Message ${idx}: role=${msg.role}, content length=${msg.content?.length || 0}`);
        });
      } else {
        console.warn('[AnthropicChatModel] No messages array in context');
      }
      
      // Convert Teams SDK message format to Anthropic format
      const anthropicMessages = this.convertMessages(messages);
      
      // Ensure we have at least one message
      if (anthropicMessages.length === 0) {
        console.error('[AnthropicChatModel] No valid messages after conversion. Original messages:', messages);
        throw new Error('At least one message is required. All messages were filtered out during conversion.');
      }
      
      // Anthropic uses a separate system parameter instead of system messages
      const requestOptions = {
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        messages: anthropicMessages
      };
      
      // Add system instructions if provided
      if (instructions && instructions.trim()) {
        requestOptions.system = instructions;
        console.log(`[AnthropicChatModel] Added system instructions (${instructions.length} chars)`);
      }
      
      console.log(`[AnthropicChatModel] Sending request with ${anthropicMessages.length} messages`);
      
      // Call Anthropic API
      const response = await this.client.messages.create(requestOptions);
      
      // Extract the text content from the response
      const content = this.extractContent(response);
      
      console.log(`[AnthropicChatModel] Received response (${content.length} chars)`);
      
      // Return in Teams SDK expected format
      return {
        content: content,
        role: 'assistant',
        finish_reason: response.stop_reason,
        usage: {
          input_tokens: response.usage?.input_tokens || 0,
          output_tokens: response.usage?.output_tokens || 0,
          total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
        }
      };
      
    } catch (error) {
      console.error('[AnthropicChatModel] Error during completion:', error);
      throw error;
    }
  }
  
  /**
   * Convert Teams SDK message format to Anthropic format
   * Teams format: { role: 'user'|'assistant'|'system', content: string }
   * Anthropic format: { role: 'user'|'assistant', content: string }
   * Note: Anthropic doesn't support system role in messages array
   * 
   * @param {Array} messages Messages from Teams SDK
   * @returns {Array} Messages in Anthropic format
   * @private
   */
  convertMessages(messages) {
    if (!Array.isArray(messages)) {
      console.warn('[AnthropicChatModel] convertMessages: messages is not an array:', typeof messages);
      return [];
    }
    
    if (messages.length === 0) {
      console.warn('[AnthropicChatModel] convertMessages: messages array is empty');
      return [];
    }
    
    const converted = messages
      .filter(msg => {
        if (!msg || typeof msg !== 'object') {
          console.warn('[AnthropicChatModel] convertMessages: skipping invalid message:', msg);
          return false;
        }
        return msg.role !== 'system'; // Filter out system messages (handled separately)
      })
      .map(msg => {
        const content = typeof msg.content === 'string' ? msg.content : (msg.content?.text || String(msg.content || ''));
        return {
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: content
        };
      })
      .filter(msg => {
        const hasContent = msg.content && msg.content.trim().length > 0;
        if (!hasContent) {
          console.warn('[AnthropicChatModel] convertMessages: filtering out empty message with role:', msg.role);
        }
        return hasContent;
      });
    
    console.log(`[AnthropicChatModel] convertMessages: converted ${messages.length} messages to ${converted.length} valid messages`);
    return converted;
  }
  
  /**
   * Extract text content from Anthropic response
   * Anthropic returns content as an array of content blocks
   * 
   * @param {Object} response Anthropic API response
   * @returns {string} Extracted text content
   * @private
   */
  extractContent(response) {
    if (!response.content || !Array.isArray(response.content)) {
      return '';
    }
    
    // Concatenate all text blocks
    return response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');
  }
}

module.exports = { AnthropicChatModel };

