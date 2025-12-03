# User Input and Follow-up Question Handling

## Overview

The IsaacLLM application uses a sophisticated multi-stage architecture to handle user inputs and maintain conversation context across follow-up questions. This document explains the complete flow from initial input to response generation and how follow-up questions are processed.

---

## Architecture Components

### 1. **Main Application Handler** (`app.js`)
- Entry point for all user messages
- Manages conversation history using LocalStorage
- Orchestrates skill execution and response generation
- Handles context window tracking and reset functionality

### 2. **Skills Architecture**
Each skill represents a specialized capability:
- `RAGSearchSkill` - Search company knowledge base and user documents
- `WebSearchSkill` - Search the web for current information
- `YahooFinanceSkill` - Get stock prices and financial data
- `SalesCoachSkill` - Sales meeting preparation and research
- `CareerDevelopmentSkill` - Personal development planning at Isaac
- `FileProcessingSkill` - Process and analyze uploaded files
- `NoteSummarySkill` - Summarize meeting notes and transcripts

### 3. **LLM Orchestrator**
- Intelligent routing of queries to appropriate skills
- Uses GPT-4o-mini to analyze intent and select relevant skills
- Extracts parameters upfront (search queries, tickers, etc.)
- Falls back to keyword-based routing if LLM is unavailable

---

## Initial User Input Flow

### Stage 1: Message Reception
```
User sends message → app.on('message') event fires
```

**Steps:**
1. Extract user message text from activity
2. Load conversation history from storage (`conversationKey`)
3. Check for special commands (`/reset`, `/my-docs`)
4. Validate message is not a placeholder

### Stage 2: Context Preparation
```javascript
const context = {
  userId: activity.from.id,
  attachments: fileAttachments,
  hasFiles: fileAttachments.length > 0,
  conversationId: activity.conversation.id,
  send: send // Allows skills to send immediate messages
};
```

**Context includes:**
- User ID for personalized searches
- File attachments (if any)
- Conversation ID
- Direct access to send function

### Stage 3: Skill Routing (LLM Orchestrator)

The orchestrator uses a two-phase approach:

#### Phase 1: Intent Detection & Planning
```
User Query → LLM Analyzes Intent → Selects Relevant Skills → Extracts Parameters
```

The LLM evaluates:
- What skills are needed for this query?
- Are there files attached?
- What parameters should be extracted (search queries, tickers, etc.)?

**Example:**
```
Query: "Prepare for sales call with VP of Operations at Acme Corp"
→ Selects: sales_coach
→ Extracts: {companyName: "Acme Corp", role: "VP of Operations"}
```

#### Phase 2: Skill Execution
```
Selected Skills Execute in Parallel → Results Collected → Added to Context
```

Each skill:
1. Checks if it can handle the query (`canHandle()` method)
2. Executes its specialized functionality (`execute()` method)
3. Returns formatted results or null

**Example Skill Results:**
- `rag_search` → Knowledge base context with citations
- `web_search` → Web search results
- `file_processing` → Extracted file content
- `yahoo_finance` → Stock price data

### Stage 4: Enhanced Instruction Building

The base system instructions are enhanced with skill results:

```
Base Instructions
  + RAG Search Results (if available)
  + Yahoo Finance Data (if available)
  + Web Search Results (if available)
  + Sales Coach Synthesis (if available)
  + File Processing Content (if available)
  + Note Summary Prompt (if available)
= Enhanced Instructions
```

**Key Points:**
- Each skill adds its results to the system instructions
- RAG results include citations that are tracked separately
- Skills add context, NOT conversational responses
- The LLM sees all research upfront, no tool calling needed

### Stage 5: Response Generation

```
Enhanced Instructions + Conversation History + User Message → LLM → Response
```

**Process:**
1. Create `ChatPrompt` with enhanced instructions
2. Use Anthropic Claude (preferred) or Azure OpenAI (fallback)
3. Pass full conversation history + new user message
4. Generate response
5. Chunk response if needed (Teams has 28KB message limit)
6. Add citations to first chunk
7. Add feedback button to last chunk

### Stage 6: History Storage

```javascript
messages.push({
  role: 'user',
  content: processedUserMessage
});
messages.push({
  role: 'assistant',
  content: responseContent
});
storage.set(conversationKey, messages);
```

**Stored for Each Turn:**
- User message
- Assistant response
- Conversation continues to build in storage

---

## Follow-up Question Handling

### How Follow-ups Work

When a user asks a follow-up question, the **entire conversation history** is included in the context. This creates continuity and allows the AI to reference previous exchanges.

### Follow-up Flow

```
User Follow-up Message
  ↓
Load Conversation History from Storage
  ↓
Skills Re-evaluate Query (may execute different skills)
  ↓
Enhanced Instructions Built (fresh skill execution)
  ↓
LLM Receives:
  - Base Instructions
  - NEW Skill Results (from current query)
  - FULL Conversation History (all previous turns)
  - Current User Message
  ↓
Generate Response (with full context)
  ↓
Append to History
```

### Key Characteristics of Follow-ups

1. **Fresh Skill Execution**: Each message triggers a new routing decision
   - Skills are re-evaluated for every query
   - Different skills may execute based on the new question
   - Example: First question uses RAG, follow-up uses web search

2. **Cumulative Context**: Conversation history accumulates
   ```
   Turn 1: User Q1 + Assistant A1
   Turn 2: User Q1 + Assistant A1 + User Q2 + Assistant A2
   Turn 3: User Q1 + A1 + Q2 + A2 + User Q3 + Assistant A3
   ```

3. **Context Window Management**:
   - System tracks token usage (characters / 4)
   - Displays usage percentage with reset button
   - Warning at 70%, critical at 90%
   - User can reset conversation to start fresh

4. **Skill Results Are NOT Persisted**:
   - Only user/assistant messages are stored
   - Skill results (RAG, web search, etc.) are regenerated each turn
   - This keeps storage efficient and allows fresh data

### Example Follow-up Scenarios

#### Scenario 1: Clarification Question
```
User: "What's our company policy on remote work?"
→ Skills: rag_search
→ Response: [Policy details from knowledge base]

User: "Can you summarize that in bullet points?"
→ Skills: rag_search (re-executed, same context)
→ Response: [Same policy info, reformatted as bullets]
→ Context: Previous Q&A helps AI understand "that" refers to policy
```

#### Scenario 2: Topic Shift
```
User: "Tell me about Acme Corp for a sales call"
→ Skills: sales_coach, web_search
→ Response: [Detailed research on Acme Corp]

User: "What's their stock price?"
→ Skills: yahoo_finance (different skill!)
→ Response: [Stock data for Acme]
→ Context: "their" refers to Acme Corp from previous turn
```

#### Scenario 3: Multi-turn Analysis
```
User: [Uploads meeting notes file]
"Summarize these notes"
→ Skills: file_processing, note_summary
→ Response: [Concise bullet point summary]

User: "Make it more concise"
→ Skills: note_summary (re-executed)
→ Response: [Even more condensed summary]
→ Context: File content still in conversation, AI knows what to condense

User: "What are the action items for John?"
→ Skills: None (question about existing content)
→ Response: [Extracts John's actions from summary]
→ Context: Full conversation helps AI understand context
```

---

## Special Features

### 1. Reset Conversation
Users can start fresh via:
- `/reset` command
- Reset button (adaptive card)
- Clears both conversation history AND file acknowledgment flag

### 2. Context Usage Tracking
```javascript
const contextUsage = getContextUsage(messages, enhancedInstructions);
// Returns: estimatedTokens, usagePercentage, remainingTokens
```
- Tracks: Instructions + All Messages
- Displayed: Reset button shows "X% used"
- Purpose: Helps users manage context window

### 3. File Processing Acknowledgment
- First file upload: Sends acknowledgment message
- Subsequent messages: No re-acknowledgment
- Prevents spam when asking follow-up questions about files

### 4. Message Chunking
- Teams limit: ~28KB per message
- Large responses split at markdown section boundaries (##)
- Chunk indicators added: "Part 1 of 3"
- Citations only on first chunk

---

## Skills Deep Dive

### BaseSkill Pattern
All skills inherit from `BaseSkill`:

```javascript
class BaseSkill {
  async canHandle(query, context) {
    // Determine if skill should execute
    // Returns: boolean
  }
  
  async execute(context) {
    // Execute skill's functionality
    // Returns: formatted results or null
  }
}
```

### Skill Independence
- Each skill is self-contained
- Skills can call other skills (e.g., SalesCoachSkill uses WebSearchSkill)
- Skills don't know about conversation history (only current query + context)
- Skills return formatted context, NOT conversational responses

### Example: NoteSummarySkill

**canHandle Logic:**
1. Check if query contains note/summary keywords
2. Use LLM to detect intent (with keyword fallback)
3. Check for substantial text (>500 chars) or file uploads

**execute Logic:**
1. Extract notes from file or pasted text
2. Calculate input length metrics
3. Build prompt with proportional length guidance
4. Return enhanced prompt + notes separately

**Result:**
```javascript
{
  prompt: "Enhanced instructions for summarizing...",
  notes: "Actual meeting notes text..."
}
```
- `prompt` → Added to system instructions
- `notes` → Added to user message

---

## Conversation Persistence

### What's Stored
```javascript
storage.set(conversationKey, messages);
// conversationKey = "${conversationId}/${userId}"
// messages = [
//   {role: 'user', content: '...'},
//   {role: 'assistant', content: '...'},
//   ...
// ]
```

### What's NOT Stored
- Skill results (regenerated each turn)
- Enhanced instructions (rebuilt each turn)
- Citations (extracted each turn from RAG results)
- Context usage metrics (calculated on demand)

### Why This Approach?
1. **Efficiency**: Smaller storage footprint
2. **Freshness**: New searches can return updated results
3. **Flexibility**: Skills can change behavior without migration
4. **Simplicity**: Clear separation between conversation and context

---

## LLM Orchestrator Intelligence

### Skill Routing Rules

The orchestrator follows specific rules to avoid conflicts:

1. **Sales Prep Exclusion**: If query contains sales/meeting prep keywords, use `sales_coach` ONLY (not `career_development`)
   
2. **File Priority**: Always include `file_processing` for file uploads

3. **External vs Internal**: 
   - External/current events → `web_search`
   - Internal policies/procedures → `rag_search`

4. **Parameter Extraction**: 
   - `yahoo_finance` → Extract ticker symbols
   - `web_search` → Create optimized search query
   - `sales_coach` → Extract company name and role

### Fallback Mechanisms

**Tier 1**: LLM-based routing (preferred)
```
GPT-4o-mini analyzes query → Selects skills + extracts parameters
```

**Tier 2**: Keyword-based fallback
```
Pattern matching on query → Selects skills based on regex
```

**Tier 3**: canHandle fallback (last resort)
```
Execute all skills, each decides via canHandle()
```

---

## Response Generation

### Model Selection
```javascript
if (config.anthropicApiKey) {
  // Use Anthropic Claude (preferred)
  chatModel = new AnthropicChatModel({...});
} else {
  // Fallback to Azure OpenAI
  chatModel = new OpenAIChatModel({...});
}
```

### ChatPrompt Architecture
```javascript
const prompt = new ChatPrompt({
  messages: messages,           // Full conversation history
  instructions: enhancedInstructions,  // Base + skill results
  model: chatModel
});

const response = await prompt.send(processedUserMessage);
```

### Response Enhancement
1. Add citations from RAG results
2. Chunk if necessary for Teams limits
3. Add feedback button to last chunk
4. Add part indicators if multiple chunks
5. Send reset card with context usage

---

## Summary: The Complete Cycle

```
┌─────────────────────────────────────────────────────────────┐
│ USER INPUT                                                  │
│ "Prepare for sales call with VP at Acme Corp"              │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ LOAD HISTORY                                                │
│ - Retrieve all previous messages from storage              │
│ - Build context object (userId, files, etc.)               │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ SKILL ROUTING (LLM Orchestrator)                           │
│ - Analyze query intent                                      │
│ - Select: sales_coach, web_search                          │
│ - Extract: {companyName: "Acme Corp", role: "VP"}          │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ SKILL EXECUTION (Parallel)                                 │
│ sales_coach.execute() → Research on Acme Corp              │
│ web_search.execute() → Current news and info               │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ BUILD ENHANCED INSTRUCTIONS                                 │
│ Base Instructions                                           │
│ + Sales Coach Research Context                             │
│ + Web Search Results                                        │
│ = Enhanced Instructions                                     │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ RESPONSE GENERATION                                         │
│ ChatPrompt receives:                                        │
│ - Enhanced Instructions (base + research)                   │
│ - Full Conversation History                                 │
│ - Current User Message                                      │
│                                                             │
│ Claude Sonnet 3.5 generates comprehensive response         │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ RESPONSE DELIVERY                                           │
│ - Chunk if needed (Teams 28KB limit)                       │
│ - Add citations (first chunk)                              │
│ - Add feedback button (last chunk)                         │
│ - Send reset card with context usage                       │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ UPDATE HISTORY                                              │
│ messages.push(user message)                                 │
│ messages.push(assistant response)                           │
│ storage.set(conversationKey, messages)                      │
└─────────────────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ FOLLOW-UP QUESTION                                          │
│ "What's their current stock price?"                         │
│                                                             │
│ → CYCLE REPEATS                                             │
│ → History includes ALL previous turns                       │
│ → Skills re-evaluate (now: yahoo_finance)                   │
│ → "their" resolves to "Acme Corp" via history              │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Takeaways

1. **Every message triggers fresh skill routing** - The orchestrator analyzes each query independently

2. **Conversation history provides continuity** - Full message history is always included, allowing natural follow-ups

3. **Skills are stateless** - They only see current query + context, not conversation history

4. **Context is rebuilt every turn** - Enhanced instructions are regenerated with fresh skill execution

5. **Follow-ups "just work"** - The LLM naturally understands references ("their", "that", "it") from conversation history

6. **Storage is efficient** - Only user/assistant messages stored, not skill results

7. **Users control context** - Reset functionality allows starting fresh when context gets too large

8. **Chunking prevents failures** - Large responses are split to respect Teams message limits

9. **Multi-model approach** - Different LLMs for different tasks (GPT-4o-mini for routing, Claude for responses)

10. **Graceful degradation** - Multiple fallback mechanisms ensure robustness

