<!-- 85b17d9a-860e-47fd-99b0-b178fc76d075 b6730ebd-e388-4ff5-879c-220be5d10d46 -->
# Chat History with Personal Tab Implementation

## Architecture Overview

Transform Aisaac from bot messaging to a Personal Tab application with:

- **Frontend**: React app with left sidebar (conversation list) + main chat area
- **Backend**: Express API for conversation management, message handling, and LLM orchestration
- **Storage**: Azure Cosmos DB with user-partitioned conversations for privacy and persistence
- **Security**: Row-level isolation, encryption at rest/transit, RBAC for zero-admin access to content

## Phase 1: Azure Cosmos DB Setup & Integration

### 1.1 Cosmos DB Configuration

- Create Cosmos DB account in Azure (SQL API)
- Create database: `aisaac-conversations`
- Create containers:
  - `conversations`: Stores conversation metadata (id, userId, title, createdAt, updatedAt, archived)
  - `messages`: Stores individual messages (id, conversationId, userId, role, content, timestamp, attachments)
- Configure partition keys: `/userId` for user-level isolation
- Enable encryption at rest (automatic)
- Configure RBAC to restrict admin access to data plane

**Key Files**: New `src/storage/cosmosClient.js`, `src/storage/conversationRepository.js`, `src/storage/messageRepository.js`

### 1.2 Environment Configuration

Add Cosmos DB connection details to environment variables:

- `COSMOS_DB_ENDPOINT`
- `COSMOS_DB_KEY`
- `COSMOS_DB_DATABASE_NAME`

Update `src/config.js` to include Cosmos DB configuration.

## Phase 2: Backend API Development

### 2.1 Conversation Management API

Create REST endpoints in `src/api/` for:

- `GET /api/conversations` - List user's conversations (with pagination, sorted by updatedAt)
- `POST /api/conversations` - Create new conversation (auto-generate title from first message)
- `GET /api/conversations/:id` - Get conversation details with messages
- `PATCH /api/conversations/:id` - Update conversation (rename title)
- `DELETE /api/conversations/:id` - Delete/archive conversation
- `POST /api/conversations/:id/messages` - Add message to conversation
- `GET /api/conversations/:id/messages` - Get conversation messages (with pagination)

**Authentication**: Use Teams SSO token validation to identify userId from requests.

**Key Files**: `src/api/conversationController.js`, `src/api/messageController.js`, `src/middleware/auth.js`

### 2.2 Message Streaming & LLM Integration

- Adapt existing LLM orchestration (`src/app/orchestration/llmOrchestrator.js`) to work with API requests
- Implement Server-Sent Events (SSE) for streaming responses to frontend
- Maintain skills architecture (RAG, web search, file processing, Yahoo Finance)
- Store complete messages (user + assistant) in Cosmos DB after generation

**Key Files**: Update `src/api/messageController.js`, new `src/api/streamHandler.js`

### 2.3 File Upload Handling

- Accept file uploads via multipart/form-data in Personal Tab
- Reuse existing `FileProcessingSkill` for text extraction
- Store file metadata with messages (filename, contentType, extracted text)
- Optional: Store file blobs in Azure Blob Storage, reference in Cosmos DB

**Key Files**: `src/api/fileUploadController.js`, update `src/app/skills/fileProcessingSkill.js`

## Phase 3: Frontend Development (React Personal Tab)

### 3.1 Project Structure

Create new frontend app in `src/client/`:

```
src/client/
├── public/
│   └── index.html
├── src/
│   ├── components/
│   │   ├── ConversationList.jsx      # Left sidebar
│   │   ├── ConversationItem.jsx      # Individual conversation item
│   │   ├── ChatArea.jsx              # Main chat interface
│   │   ├── MessageBubble.jsx         # Individual message display
│   │   ├── InputArea.jsx             # User input with file upload
│   │   └── NewChatButton.jsx         # Create new conversation
│   ├── services/
│   │   ├── api.js                    # API client for backend
│   │   └── teams.js                  # Teams SDK integration
│   ├── hooks/
│   │   ├── useConversations.js       # Fetch/manage conversations
│   │   └── useMessages.js            # Fetch/send messages
│   ├── App.jsx                       # Main app component
│   └── index.jsx                     # Entry point
├── package.json
└── webpack.config.js
```

### 3.2 Conversation List (Left Sidebar)

- Display conversations grouped by date (Today, Yesterday, Last 7 Days, Last 30 Days, Older)
- Auto-generated titles (first 50 chars of first user message or AI-generated summary)
- "New Chat" button at top
- Search/filter conversations
- Delete button (hover/context menu)
- Highlight active conversation

**Component**: `ConversationList.jsx`

### 3.3 Chat Area (Main Interface)

- Display messages in conversation (scrollable history)
- Show user messages on right, assistant on left (standard chat UI)
- Support markdown rendering, code blocks, citations
- File attachment display
- Streaming response indicator (typing animation)
- Empty state for new conversations

**Component**: `ChatArea.jsx`

### 3.4 Input Area

- Text input with multi-line support
- File upload button (drag-and-drop optional)
- Send button
- Character/token counter (optional)
- Disabled state during message processing

**Component**: `InputArea.jsx`

### 3.5 Teams Integration

- Initialize Teams SDK (`@microsoft/teams-js`)
- Get user context (userId, theme)
- Handle SSO authentication
- Apply Teams theming to UI

**File**: `src/client/src/services/teams.js`

## Phase 4: Manifest & Deployment Changes

### 4.1 Update Teams App Manifest

- **Remove**: `bots` section (eliminates Chat tab)
- **Add**: `staticTabs` with Personal Tab configuration:
  ```json
  {
    "staticTabs": [
      {
        "entityId": "aisaac-chat",
        "name": "Aisaac",
        "contentUrl": "https://{your-domain}/tab",
        "websiteUrl": "https://{your-domain}",
        "scopes": ["personal"]
      }
    ]
  }
  ```

- Update permissions: Remove bot permissions, add personal tab permissions

**Key Files**: `appPackage/manifest.json`

### 4.2 Backend Routing Updates

Update `src/index.js`:

- Remove Bot Framework adapter setup
- Add Express routes for API endpoints
- Serve static React build for `/tab` route
- Configure CORS for Teams origin

### 4.3 Build & Deployment

- Add React build script to `package.json`
- Configure production build to output to `src/client/build`
- Update Azure deployment to serve both API and static frontend
- Configure environment variables in Azure App Service

## Phase 5: Privacy & Security Implementation

### 5.1 User Isolation

- Enforce userId in all Cosmos DB queries (partition key)
- Validate JWT token from Teams SDK to extract userId
- Prevent cross-user data access in API layer
- Add audit logging for data access (optional)

**Key Files**: `src/middleware/auth.js`, all repository files

### 5.2 Encryption

- Cosmos DB encryption at rest (automatic)
- HTTPS enforcement for all API calls
- Optional: Client-side encryption for sensitive message content

### 5.3 RBAC Configuration

- Configure Azure RBAC roles
- App identity: Read/write access to Cosmos DB
- Admin users: Control plane only (no data access)

## Phase 6: Migration & Testing

### 6.1 Data Migration

- Script to migrate existing LocalStorage conversations to Cosmos DB (if needed)
- One-time migration utility: `src/scripts/migrateToCosmosDB.js`

### 6.2 Testing Checklist

- [ ] Create new conversation
- [ ] Send messages with streaming responses
- [ ] Upload and process files
- [ ] Switch between conversations (full history loads)
- [ ] Delete conversation
- [ ] Search conversations
- [ ] Skills integration (RAG, web search, finance)
- [ ] Multi-user isolation (test with different user accounts)
- [ ] Theme compatibility (light/dark mode)
- [ ] Mobile responsive design (Teams mobile app)

## Key Technical Decisions

1. **Frontend Framework**: React (lightweight, Teams-compatible)
2. **State Management**: React Context API + hooks (sufficient for this use case)
3. **Styling**: CSS modules or styled-components (Teams Fluent UI optional)
4. **API Protocol**: REST for CRUD, SSE for streaming
5. **Authentication**: Teams SSO with JWT validation
6. **Title Generation**: Use first 50 characters of first message initially; upgrade to AI-generated titles later
7. **Pagination**: Load 20 conversations initially, infinite scroll for more
8. **Message History**: Load last 50 messages per conversation, load more on scroll up

## Dependencies to Add

```json
{
  "dependencies": {
    "@azure/cosmos": "^4.0.0",
    "@microsoft/teams-js": "^2.20.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "jsonwebtoken": "^9.0.0",
    "multer": "^1.4.5-lts.1"
  },
  "devDependencies": {
    "@babel/core": "^7.23.0",
    "@babel/preset-react": "^7.23.0",
    "webpack": "^5.89.0",
    "webpack-cli": "^5.1.4",
    "webpack-dev-server": "^4.15.0"
  }
}
```

## Implementation Order

1. Set up Cosmos DB and create repositories
2. Build backend API endpoints (without frontend)
3. Test API with Postman/curl
4. Create React frontend skeleton
5. Implement conversation list UI
6. Implement chat area UI
7. Integrate API with frontend
8. Update Teams manifest
9. Test end-to-end in Teams
10. Deploy to Azure
11. Final security audit and testing

### To-dos

- [ ] Set up Azure Cosmos DB account, database, and containers with partitioning
- [ ] Create conversation and message repository classes with CRUD operations
- [ ] Build REST API endpoints for conversation and message management
- [ ] Implement Teams SSO authentication middleware for user validation
- [ ] Implement SSE streaming for real-time LLM responses
- [ ] Initialize React project structure and webpack configuration
- [ ] Build conversation list sidebar component with grouping
- [ ] Build main chat area with message display and input
- [ ] Connect React frontend to backend APIs with hooks
- [ ] Update Teams manifest to remove bot and add Personal Tab
- [ ] Configure build pipeline and Azure deployment for Personal Tab app
- [ ] Test complete flow in Teams with multiple users for privacy validation