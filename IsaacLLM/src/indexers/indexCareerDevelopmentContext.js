/**
 * Index Career Development Context Document
 * 
 * This script indexes the Isaac Development RAG Context file into Azure AI Search
 * so the CareerDevelopmentSkill can retrieve relevant guidance.
 * 
 * Usage:
 *   node src/indexers/indexCareerDevelopmentContext.js
 * 
 * Prerequisites:
 *   - Azure AI Search credentials configured in .localConfigs
 *   - Isaac_Dev_RAG_Context_V2.md file in the root directory or specified path
 */

const fs = require('fs');
const path = require('path');
const { SearchClient, AzureKeyCredential } = require("@azure/search-documents");
const { OpenAIClient, AzureKeyCredential: OpenAIKeyCredential } = require("@azure/openai");

// Load configuration
const config = require('../config');

/**
 * Parse the markdown context file into structured chunks
 * Each [[MODULE]] section becomes a separate searchable document
 */
function parseContextFile(filePath) {
  console.log(`Reading context file from: ${filePath}`);
  const content = fs.readFileSync(filePath, 'utf-8');
  
  const documents = [];
  let currentModule = null;
  let currentContent = [];
  let inModule = false;
  
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Detect module start: [[MODULE-NAME]]
    if (line.match(/^\[\[([^\]]+)\]\]$/)) {
      // Save previous module if exists
      if (currentModule && currentContent.length > 0) {
        documents.push({
          module: currentModule,
          content: currentContent.join('\n').trim()
        });
      }
      
      // Start new module
      currentModule = line.match(/^\[\[([^\]]+)\]\]$/)[1];
      currentContent = [];
      inModule = true;
      continue;
    }
    
    // Detect module end: [[/MODULE-NAME]]
    if (line.match(/^\[\[\/([^\]]+)\]\]$/)) {
      if (currentModule && currentContent.length > 0) {
        documents.push({
          module: currentModule,
          content: currentContent.join('\n').trim()
        });
      }
      currentModule = null;
      currentContent = [];
      inModule = false;
      continue;
    }
    
    // Collect content within module
    if (inModule && currentModule) {
      // Skip YAML frontmatter blocks
      if (line.trim().startsWith('```yaml') || line.trim() === '```') {
        continue;
      }
      
      // Skip empty YAML lines
      if (line.match(/^(name|category|version|tags|see_also):/)) {
        continue;
      }
      
      currentContent.push(line);
    }
  }
  
  // Save last module if exists
  if (currentModule && currentContent.length > 0) {
    documents.push({
      module: currentModule,
      content: currentContent.join('\n').trim()
    });
  }
  
  console.log(`Parsed ${documents.length} modules from context file`);
  return documents;
}

/**
 * Generate embeddings using Azure OpenAI
 */
async function generateEmbedding(text) {
  const client = new OpenAIClient(
    config.azureOpenAIEndpoint,
    new OpenAIKeyCredential(config.azureOpenAIKey)
  );
  
  const embeddings = await client.getEmbeddings(
    config.azureOpenAIEmbeddingDeploymentName,
    [text]
  );
  
  return embeddings.data[0].embedding;
}

/**
 * Index documents into Azure AI Search
 */
async function indexDocuments(documents) {
  const searchClient = new SearchClient(
    config.azureSearchEndpoint,
    "gptkbindex",
    new AzureKeyCredential(config.azureSearchKey)
  );
  
  console.log('\nGenerating embeddings and indexing documents...');
  
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    console.log(`\nProcessing module ${i + 1}/${documents.length}: ${doc.module}`);
    
    try {
      // Generate embedding for the content
      const embedding = await generateEmbedding(doc.content);
      
      // Create search document
      const searchDoc = {
        id: `career-dev-${doc.module.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        content: doc.content,
        title: `Isaac Development: ${doc.module}`,
        category: 'career-development',
        module: doc.module,
        sourcepage: 'Isaac_Dev_RAG_Context_V2.md',
        sourcefile: 'Isaac_Dev_RAG_Context_V2.md',
        contentVector: embedding,
        userId: 'system', // System-level document available to all users
        '@search.action': 'mergeOrUpload'
      };
      
      // Upload to search index
      const result = await searchClient.uploadDocuments([searchDoc]);
      
      if (result.results[0].succeeded) {
        console.log(`✅ Successfully indexed: ${doc.module}`);
      } else {
        console.error(`❌ Failed to index: ${doc.module}`, result.results[0].errorMessage);
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`❌ Error indexing ${doc.module}:`, error.message);
    }
  }
  
  console.log('\n✅ Indexing complete!');
}

/**
 * Main execution
 */
async function main() {
  console.log('='.repeat(60));
  console.log('Isaac Career Development Context Indexer');
  console.log('='.repeat(60));
  
  // Check configuration
  if (!config.azureSearchEndpoint || !config.azureSearchKey) {
    console.error('❌ Azure Search credentials not configured');
    console.error('Please set up .localConfigs with Azure Search settings');
    process.exit(1);
  }
  
  if (!config.azureOpenAIEndpoint || !config.azureOpenAIKey || !config.azureOpenAIEmbeddingDeploymentName) {
    console.error('❌ Azure OpenAI credentials not configured');
    console.error('Please set up .localConfigs with Azure OpenAI settings');
    process.exit(1);
  }
  
  // Find the context file
  const possiblePaths = [
    path.join(__dirname, '../../../Isaac_Dev_RAG_Context_V2 (1).md'),
    path.join(__dirname, '../../../Isaac_Dev_RAG_Context_V2.md'),
    path.join(process.cwd(), 'Isaac_Dev_RAG_Context_V2 (1).md'),
    path.join(process.cwd(), 'Isaac_Dev_RAG_Context_V2.md')
  ];
  
  let contextFilePath = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      contextFilePath = p;
      break;
    }
  }
  
  if (!contextFilePath) {
    console.error('❌ Could not find Isaac_Dev_RAG_Context_V2.md');
    console.error('Searched in:');
    possiblePaths.forEach(p => console.error(`  - ${p}`));
    console.error('\nPlease ensure the file is in the project root or specify the path');
    process.exit(1);
  }
  
  console.log(`✅ Found context file: ${contextFilePath}\n`);
  
  // Parse the context file
  const documents = parseContextFile(contextFilePath);
  
  if (documents.length === 0) {
    console.error('❌ No modules found in context file');
    process.exit(1);
  }
  
  console.log('\nModules to be indexed:');
  documents.forEach((doc, i) => {
    console.log(`  ${i + 1}. ${doc.module} (${doc.content.length} chars)`);
  });
  
  console.log(`\nTotal: ${documents.length} modules`);
  console.log('='.repeat(60));
  
  // Confirm before proceeding
  console.log('\nStarting indexing process...');
  
  // Index documents
  await indexDocuments(documents);
  
  console.log('\n' + '='.repeat(60));
  console.log('Career Development context is now available for RAG queries!');
  console.log('='.repeat(60));
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

