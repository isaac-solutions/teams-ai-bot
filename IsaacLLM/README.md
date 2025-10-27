# Aisaac - AI Agent with Ephemeral File Upload Support

Aisaac is an intelligent AI agent built with the Microsoft 365 Agents Toolkit that provides ephemeral file upload capabilities for Microsoft Teams. It can process PDF, DOCX, TXT, and EML files entirely in memory, ensuring complete privacy and security.

## Get Started with Aisaac

> **Prerequisites**
>
> To run Aisaac in your local development environment, you will need:
>
> - [Node.js](https://nodejs.org/), supported versions: 20, 22.
> - [Microsoft 365 Agents Toolkit Visual Studio Code Extension](https://aka.ms/teams-toolkit) latest version or [Microsoft 365 Agents Toolkit CLI](https://aka.ms/teamsfx-toolkit-cli).
> - Prepare your own [Azure OpenAI](https://aka.ms/oai/access) resource.

> For local debugging using Microsoft 365 Agents Toolkit CLI, you need to do some extra steps described in [Set up your Microsoft 365 Agents Toolkit CLI for local debugging](https://aka.ms/teamsfx-cli-debugging).

1. First, select the Microsoft 365 Agents Toolkit icon on the left in the VS Code toolbar.
1. In file *env/.env.playground.user*, fill in your Azure OpenAI key `SECRET_AZURE_OPENAI_API_KEY=<your-key>`, endpoint `AZURE_OPENAI_ENDPOINT=<your-endpoint>`, and deployment name `AZURE_OPENAI_DEPLOYMENT_NAME=<your-deployment>`.
1. Press F5 to start debugging which launches your app in Microsoft 365 Agents Playground using a web browser. Select `Debug in Microsoft 365 Agents Playground`.
1. You can send any message to get a response from the agent.

**Congratulations**! Aisaac is now running and ready to process file uploads in Microsoft 365 Agents Playground:

![ai chat agent](https://github.com/user-attachments/assets/984af126-222b-4c98-9578-0744790b103a)

## Aisaac Project Structure

| Folder       | Contents                                            |
| - | - |
| `.vscode`    | VSCode files for debugging                          |
| `appPackage` | Templates for the application manifest              |
| `env`        | Environment files                                   |
| `infra`      | Templates for provisioning Azure resources          |
| `src`        | The source code for the application                 |

The following files contain the core Aisaac implementation with ephemeral file upload capabilities.

| File                                 | Contents                                           |
| - | - |
|`src/index.js`| Application entry point. |
|`src/config.js`| Defines the environment variables.|
|`src/app/instructions.txt`| Defines Aisaac's AI agent personality and capabilities.|
|`src/app/app.js`| Main bot logic with ephemeral file upload processing.|
|`src/utils/extractText.js`| Utility for extracting text from uploaded files (PDF, DOCX, TXT, EML).|

## File Upload Support

Aisaac supports ephemeral file uploads with the following features:

### Supported File Types
- **PDF** - Extracts text content using pdf-parse
- **DOCX** - Extracts text content using mammoth
- **TXT** - Reads plain text files
- **EML** - Extracts email content (headers, body, HTML) using mailparser

### Privacy & Security
- **Ephemeral Processing**: Files are processed entirely in memory and immediately discarded
- **No Persistent Storage**: Files are never written to disk, Azure Blob Storage, or SharePoint
- **Memory-Only**: Text extraction happens in RAM with automatic garbage collection
- **Size Limits**: Files are limited to 5MB maximum size for performance and security

### How It Works
1. User uploads a file (PDF, DOCX, TXT, or EML) to the Teams chat
2. Bot downloads the file temporarily into memory using Teams attachment contentUrl
3. Text is extracted from the file directly in memory using appropriate parsers
4. Extracted text is sent to Azure AI Foundry agent along with the chat message
5. File bytes are immediately discarded (no persistent storage)
6. The extracted information becomes part of the agent's memory context for the conversation

### Email File Support
- **EML files**: Standard email format with full header information (From, To, CC, Subject, Date) and both text and HTML content
- **Email context**: All email metadata and content is extracted and made available to the AI agent for analysis and reference

### Privacy Compliance
Files are processed in memory and immediately discarded. Their text context is preserved in Azure AI Foundry session memory only. No file data is stored anywhere on disk or in cloud storage.

The following are Microsoft 365 Agents Toolkit specific project files. You can [visit a complete guide on Github](https://github.com/OfficeDev/TeamsFx/wiki/Teams-Toolkit-Visual-Studio-Code-v5-Guide#overview) to understand how Microsoft 365 Agents Toolkit works.

| File                                 | Contents                                           |
| - | - |
|`m365agents.yml`|This is the main Microsoft 365 Agents Toolkit project file. The project file defines two primary things:  Properties and configuration Stage definitions. |
|`m365agents.local.yml`|This overrides `m365agents.yml` with actions that enable local execution and debugging.|
|`m365agents.playground.yml`|This overrides `m365agents.yml` with actions that enable local execution and debugging in Microsoft 365 Agents Playground.|

## Extend Aisaac

To extend Aisaac with additional AI capabilities, explore [Teams AI library V2 documentation](https://aka.ms/m365-agents-toolkit/teams-agent-extend-ai).

## Additional information and references

- [Microsoft 365 Agents Toolkit Documentations](https://docs.microsoft.com/microsoftteams/platform/toolkit/teams-toolkit-fundamentals)
- [Microsoft 365 Agents Toolkit CLI](https://aka.ms/teamsfx-toolkit-cli)
- [Microsoft 365 Agents Toolkit Samples](https://github.com/OfficeDev/TeamsFx-Samples)
