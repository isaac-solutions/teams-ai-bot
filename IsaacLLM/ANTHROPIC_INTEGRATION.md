
# Anthropic (Claude) Integration

## Overview

This application has been configured to use **Anthropic's Claude** as the primary model for chat responses, while keeping **Azure OpenAI Mini** for preprocessing, intent detection, and skill routing operations.

## Architecture

### Primary Chat Model: Anthropic Claude
- **Usage**: Main conversational responses to users
- **Configuration**: 
  - `ANTHROPIC_API_KEY` - Your Anthropic API key
  - `ANTHROPIC_ENDPOINT` - Optional custom endpoint (for Azure-hosted Anthropic)
  - `ANTHROPIC_DEPLOYMENT_NAME` - Model name (e.g., `claude-3-5-sonnet-20241022`)
- **File**: `src/app/anthropicChatModel.js`
- **Integration Point**: `src/app/app.js` lines 404-428

### Preprocessing Model: Azure OpenAI Mini
- **Usage**: 
  - Intent detection and skill routing (LLM Orchestrator)
  - Search query optimization (Web Search Skill)
  - Stock ticker extraction (Yahoo Finance Skill)
- **Configuration**: `AZURE_OPENAI_MINI_DEPLOYMENT_NAME` (e.g., `gpt-4o-mini`)
- **Files**:
  - `src/app/orchestration/llmOrchestrator.js` - Skill routing
  - `src/app/skills/webSearchSkill.js` - Query optimization
  - `src/app/skills/yahooFinanceSkill.js` - Ticker extraction

## Configuration

### Environment Variables

Add these to your `.localConfigs` and `.localConfigs.playground` files:

```env
# Anthropic Configuration (Primary model for chat responses)
ANTHROPIC_API_KEY=your_anthropic_api_key_here
ANTHROPIC_ENDPOINT=optional_custom_endpoint
ANTHROPIC_DEPLOYMENT_NAME=claude-3-5-sonnet-20241022

# Azure OpenAI Configuration (for preprocessing/intent detection)
AZURE_OPENAI_MINI_DEPLOYMENT_NAME=gpt-4o-mini
```

### Fallback Behavior

If Anthropic is not configured (missing `ANTHROPIC_API_KEY` or `ANTHROPIC_DEPLOYMENT_NAME`), the application will automatically fall back to Azure OpenAI for chat responses.

## Key Components

### 1. AnthropicChatModel Adapter
Location: `src/app/anthropicChatModel.js`

This adapter makes Anthropic's Claude compatible with the Microsoft Teams AI SDK:
- Converts Teams SDK message format to Anthropic format
- Handles system instructions properly
- Returns responses in the expected Teams SDK format
- Supports custom endpoints (for Azure-hosted Anthropic)

### 2. Model Selection Logic
Location: `src/app/app.js` (lines 404-428)

```javascript
// Use Anthropic (Claude) for main chat responses, fallback to Azure OpenAI if not configured
let chatModel;
if (config.anthropicApiKey && config.anthropicDeploymentName) {
  console.log('[Message] Using Anthropic model for chat response');
  chatModel = new AnthropicChatModel({
    model: config.anthropicDeploymentName,
    apiKey: config.anthropicApiKey,
    endpoint: config.anthropicEndpoint,
    maxTokens: 4096,
    temperature: 1.0
  });
} else {
  console.log('[Message] Anthropic not configured, using Azure OpenAI fallback');
  chatModel = new OpenAIChatModel({...});
}
```

### 3. Orchestrator (Unchanged)
Location: `src/app/orchestration/llmOrchestrator.js`

Continues to use Azure OpenAI Mini for:
- Analyzing user intent
- Selecting appropriate skills
- Extracting parameters (tickers, search queries)

## Model Usage Summary

| Operation | Model Used | Why |
|-----------|------------|-----|
| Main chat responses | Anthropic Claude | High-quality conversational responses |
| Intent detection | Azure OpenAI Mini | Fast, cost-effective preprocessing |
| Skill routing | Azure OpenAI Mini | Quick decision-making |
| Search query optimization | Azure OpenAI Mini | Lightweight text transformation |
| Ticker extraction | Azure OpenAI Mini | Simple pattern extraction |
| RAG/Knowledge base | Anthropic Claude | Complex reasoning with context |
| File analysis | Anthropic Claude | Deep document understanding |
| Web synthesis | Anthropic Claude | Multi-source information synthesis |

## Testing

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables**:
   - Add your Anthropic credentials to `.localConfigs`
   - Ensure `AZURE_OPENAI_MINI_DEPLOYMENT_NAME` is set

3. **Run the application**:
   ```bash
   npm run dev
   ```

4. **Verify in logs**:
   - Look for `[Message] Using Anthropic model for chat response`
   - Look for `[LLMOrchestrator] Initialized with X skills using gpt-4o-mini`

## Benefits

1. **Better Response Quality**: Claude models excel at conversational AI and complex reasoning
2. **Cost Optimization**: Use lightweight models for preprocessing, powerful models for responses
3. **Flexibility**: Easy to switch models or fall back to Azure OpenAI
4. **Performance**: Fast preprocessing with Mini, thorough responses with Claude

## Troubleshooting

### Anthropic API Errors
- Check that `ANTHROPIC_API_KEY` is valid
- Verify `ANTHROPIC_DEPLOYMENT_NAME` matches a valid model
- Check endpoint if using custom/Azure-hosted Anthropic

### Falling Back to Azure OpenAI
If you see "Anthropic not configured, using Azure OpenAI fallback":
- Ensure both `ANTHROPIC_API_KEY` and `ANTHROPIC_DEPLOYMENT_NAME` are set
- Check for typos in environment variable names

### Orchestrator Issues
If skill routing fails:
- Verify `AZURE_OPENAI_MINI_DEPLOYMENT_NAME` is set correctly
- Check Azure OpenAI credentials are valid
- Review logs for `[LLMOrchestrator]` messages

