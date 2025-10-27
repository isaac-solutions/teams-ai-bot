# Isaac Unified Bot - Setup Guide

## Overview

Isaac is now a unified bot that combines:
- **Azure AI Search RAG** - Company knowledge base and user-specific documents
- **File Processing** - Ephemeral document analysis (PDF, DOCX, TXT, EML)
- **Hybrid Intelligence** - Intelligent routing between skills
- **Extensible Architecture** - Ready for future features (web search, career planning, etc.)

## Architecture

```
IsaacLLM (Unified Bot)
├── Skills
│   ├── RAG Search (Azure AI Search)
│   ├── File Processing (Ephemeral)
│   ├── Index Document (User-specific RAG)
│   └── Web Search (Placeholder - future)
├── Orchestration
│   ├── SimpleRouter (Phase 1 - Current)
│   └── LLMOrchestrator (Phase 2 - Future)
└── OpenAI GPT-4 with Hybrid Context
```

## Configuration

### Required Environment Variables

Update your `.localConfigs` and `.localConfigs.playground` files with:

```env
# Existing configuration
CLIENT_ID=<your-managed-identity-client-id>
CLIENT_SECRET=<your-secret>
AZURE_OPENAI_API_KEY=<your-openai-key>
AZURE_OPENAI_ENDPOINT=<your-openai-endpoint>
AZURE_OPENAI_DEPLOYMENT_NAME=<your-deployment-name>

# NEW: Azure AI Search Configuration
AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME=text-embedding-ada-002
AZURE_SEARCH_KEY=<your-search-key>
AZURE_SEARCH_ENDPOINT=https://<your-service>.search.windows.net
```

### Azure AI Search Index Setup

Your Azure AI Search index should have the following schema:

```json
{
  "fields": [
    {"name": "id", "type": "Edm.String", "key": true},
    {"name": "content", "type": "Edm.String", "searchable": true},
    {"name": "sourcefile", "type": "Edm.String", "filterable": true},
    {"name": "sourcepage", "type": "Edm.String"},
    {"name": "category", "type": "Edm.String", "filterable": true},
    {"name": "userId", "type": "Edm.String", "filterable": true},
    {"name": "documentScope", "type": "Edm.String", "filterable": true},
    {"name": "embedding", "type": "Collection(Edm.Single)", "dimensions": 1536, "vectorSearchProfile": "myHnswProfile"}
  ]
}
```

**Field Descriptions:**
- `userId`: Teams user ID for multi-tenant isolation (null for company-wide docs)
- `documentScope`: Either `"company-wide"` or `"personal"`
- `embedding`: Vector embedding for semantic search

### Running the Bot

**Development Mode:**
```bash
npm run dev:teamsfx:testtool
```

**Production:**
```bash
npm start
```

## Features

### 1. Hybrid RAG + File Processing

The bot automatically:
- Searches Azure AI Search for relevant company knowledge
- Processes any uploaded files in memory
- Combines both sources to provide comprehensive answers
- Cites sources appropriately

**Example:**
```
User: "What's our vacation policy?" + uploads employment_contract.pdf
Bot: According to the Employee Handbook [handbook.pdf], you receive 15 days PTO. 
     Based on your uploaded contract, your start date determines accrual...
```

### 2. User-Specific Document Isolation

**Multi-tenant security:**
- Company documents are visible to all users
- User-uploaded documents are private (filtered by `userId`)
- No cross-user document access

**Future Enhancement:** Users will be able to index documents to their personal RAG for persistent access across conversations.

### 3. Special Commands

| Command | Description |
|---------|-------------|
| `/reset` | Clear conversation history and start fresh |
| `/my-docs` | List your personally indexed documents (future) |
| `/search <query>` | Explicitly search company knowledge base |

### 4. Intelligent Routing

The bot uses `SimpleRouter` which:
- Executes RAG search for most queries
- Processes files when attachments are present
- Skips RAG for file-only queries (e.g., "summarize this document")
- Runs skills in parallel for efficiency

**Query Examples:**
- "What's our consulting methodology?" → RAG search only
- Uploads file + "Analyze this" → File processing only
- "Compare this contract with company policy" + file → Both RAG + File

## Modular Skills Architecture

### Current Skills

1. **RAGSearchSkill** (`src/app/skills/ragSearchSkill.js`)
   - Searches Azure AI Search with user filtering
   - Returns formatted context with citations
   - Skips for file-only queries

2. **FileProcessingSkill** (`src/app/skills/fileProcessingSkill.js`)
   - Downloads and extracts text from uploaded files
   - Supports PDF, DOCX, TXT, EML
   - Ephemeral processing (no storage)

3. **IndexDocumentSkill** (`src/app/skills/indexDocumentSkill.js`)
   - Indexes documents to user's personal RAG (future feature)
   - Generates embeddings
   - Handles user-specific document isolation

4. **WebSearchSkill** (`src/app/skills/webSearchSkill.js`)
   - Placeholder for future web search capability
   - Disabled by default

### Adding New Skills

To add a new skill (e.g., career planning):

1. **Create skill file:**
```javascript
// src/app/skills/careerPlanningSkill.js
const { BaseSkill } = require('./baseSkill');

class CareerPlanningSkill extends BaseSkill {
  constructor() {
    super('career_planning', 'Help with career development and planning');
  }
  
  async execute(context) {
    // Your implementation
  }
  
  async canHandle(query, context) {
    return /career|development|growth|promotion/i.test(query);
  }
}

module.exports = { CareerPlanningSkill };
```

2. **Register in app.js:**
```javascript
const { CareerPlanningSkill } = require('./skills/careerPlanningSkill');

skills = [
  new RAGSearchSkill(dataSource),
  new FileProcessingSkill(),
  new CareerPlanningSkill(), // Add here
  new WebSearchSkill()
];
```

3. **That's it!** The router automatically includes it.

## Migration to LLM Orchestration

When you have 5+ skills and want intelligent routing:

**In `app.js`, change one line:**
```javascript
// Phase 1 (Current)
const router = new SimpleRouter(skills);

// Phase 2 (Future) - Just swap this line!
const router = new LLMOrchestrator(skills, model);
```

The `LLMOrchestrator` uses an LLM to decide which skills to execute, reducing cost and latency for expensive operations.

## File Structure

```
IsaacLLM/
├── src/
│   ├── app/
│   │   ├── app.js                         # Main bot logic
│   │   ├── instructions.txt               # System prompt
│   │   ├── azureAISearchDataSource.js     # RAG data source
│   │   ├── skills/
│   │   │   ├── baseSkill.js               # Base class
│   │   │   ├── ragSearchSkill.js          # RAG search
│   │   │   ├── fileProcessingSkill.js     # File processing
│   │   │   ├── indexDocumentSkill.js      # Document indexing
│   │   │   └── webSearchSkill.js          # Web search (future)
│   │   ├── orchestration/
│   │   │   ├── simpleRouter.js            # Current router
│   │   │   └── llmOrchestrator.js         # Future router
│   │   └── utils/
│   │       ├── citationBuilder.js         # Citation formatting
│   │       └── extractText.js             # File text extraction
│   ├── config.js                          # Configuration
│   └── index.js                           # Entry point
├── package.json
└── .localConfigs                          # Local environment config
```

## Testing

### Test Scenarios

1. **RAG Only:**
   - Query: "What's our consulting methodology?"
   - Expected: Searches knowledge base, returns with citations

2. **File Only:**
   - Upload: contract.pdf + "Summarize this document"
   - Expected: Extracts and analyzes file, no RAG search

3. **Hybrid:**
   - Upload: report.pdf + "How does this align with our best practices?"
   - Expected: Processes file + searches RAG, combines both

4. **User Isolation:**
   - User A uploads sensitive doc
   - User B queries → Should NOT see User A's doc

5. **Reset:**
   - Send: `/reset`
   - Expected: Conversation cleared, fresh start

## Troubleshooting

### Bot Runs in File-Only Mode

**Symptom:** RAG search not working
**Cause:** Azure Search credentials not configured
**Fix:** Add `AZURE_SEARCH_KEY`, `AZURE_SEARCH_ENDPOINT`, and `AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME` to `.localConfigs`

### No Search Results

**Symptom:** RAG always returns empty
**Cause:** Index name mismatch or empty index
**Fix:** 
1. Verify index name is `gptkbindex` (or update in `app.js` line 43)
2. Check Azure portal that index has documents
3. Ensure documents have `documentScope: 'company-wide'`

### File Processing Fails

**Symptom:** Error extracting file content
**Cause:** Unsupported file type or corrupted file
**Fix:** 
1. Check supported types: PDF, DOCX, TXT, EML
2. Verify file size < 5MB
3. Check file is not password-protected

## Next Steps

### Immediate (Already Done ✅)
- ✅ Modular skills architecture
- ✅ RAG search with user filtering
- ✅ Hybrid context assembly
- ✅ Citation support
- ✅ Updated system instructions

### Short Term (Next Sprint)
- [ ] Populate Azure AI Search with company documents
- [ ] Enable user document indexing
- [ ] Implement `/my-docs` command fully
- [ ] Add document deletion capability

### Future Enhancements
- [ ] Web search skill (Google Custom Search)
- [ ] Career planning skill
- [ ] Data processing skill
- [ ] Migrate to LLM Orchestration
- [ ] Advanced analytics and logging

## Support

For issues or questions:
1. Check this guide first
2. Review logs in console
3. Verify environment variables are set
4. Test with simple queries before complex ones

## License

MIT - Isaac Consulting

