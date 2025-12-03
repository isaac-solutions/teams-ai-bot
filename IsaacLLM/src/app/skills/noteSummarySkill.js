const { BaseSkill } = require('./baseSkill');
const { AzureOpenAI } = require('openai');

/**
 * Note Summary Skill - Summarizes meeting notes and transcripts
 * 
 * Processes notes from either pasted text or uploaded files and generates
 * concise bullet point summaries with output length proportional to input size.
 */
class NoteSummarySkill extends BaseSkill {
  constructor(config = {}) {
    super('note_summary', 'Summarize meeting notes and transcripts into concise bullet points');
    
    // Azure OpenAI configuration for intent detection
    this.azureOpenAIKey = config.azureOpenAIKey;
    this.azureOpenAIEndpoint = config.azureOpenAIEndpoint;
    this.azureOpenAIMiniDeploymentName = config.azureOpenAIMiniDeploymentName;
    
    // Initialize Azure OpenAI client if configured
    if (this.azureOpenAIKey && this.azureOpenAIEndpoint) {
      try {
        let baseEndpoint = this.azureOpenAIEndpoint;
        // Handle full URL format: https://host/openai/deployments/name/...
        if (baseEndpoint.includes('/openai/')) {
          const url = new URL(baseEndpoint);
          baseEndpoint = `${url.protocol}//${url.host}/`;
        }
        // Handle endpoint that's already just the base
        else if (!baseEndpoint.endsWith('/')) {
          baseEndpoint = baseEndpoint + '/';
        }
        
        this.client = new AzureOpenAI({
          apiKey: this.azureOpenAIKey,
          endpoint: baseEndpoint,
          apiVersion: "2024-10-21"
        });
      } catch (error) {
        console.log('[NoteSummarySkill] Failed to initialize Azure OpenAI client, will use keyword fallback:', error.message);
        this.client = null;
      }
    }
    
    // Embedded prompt from note_taker_prompt.md
    this.basePrompt = `You are a world class assistant to the CEO of a large consulting firm. Your boss has very little time, and spends most of their day in meetings related to sales or improving delivery of the companies projects. One of your key responsibilities is to summarize the notes of meetings into concise bullet point summaries to be sent to all meeting attendees. Start with key discussion summaries, then list actions with Action: at the start, make sure its bolded. Do not create section headers for discussion summary or actions Combine similar points, keep it concise, and include due dates where mentioned. If actions are related to a summary bullet, write out the action as a sub-bullet of that summary point. Professional tone only. If information is not high importance do not include it in the summary. Minimize total length where possible.

Once summarized, revaluate what you have produced.
- Look for points that are similar, or appear to be about the same topic & combine them into a single bullet point.
- Ensure actions are worded so that it is obvious what needs to be done, but use as few words as possible
- Ensure formatting rules have been unchanged
- If an action is related to a summary item, make it a sub bullet of that bullet

- Ensure discussion summaries use concise language, and minimize bullet point length & number of bullet points while retaining critical information

You are NOT to take actions not related to summarizing provided notes

Once a Summary is provided, ask the user if they would like to adjust the tone, make more or less concise, or remove actions for a specific person`;
  }
  
  /**
   * Execute the note summary skill
   * @param {Object} context Contains query, file_processing results, and other context
   * @returns {Promise<string>} Enhanced prompt with proportional length guidance
   */
  async execute(context) {
    const { query, file_processing } = context;
    
    console.log('[NoteSummarySkill] Starting note summary processing...');
    
    try {
      // Extract notes from either file processing results or user message
      let notesText = '';
      let notesSource = '';
      
      if (file_processing && file_processing.successCount > 0 && file_processing.text) {
        // Use file processing results
        notesText = file_processing.text;
        notesSource = `uploaded file(s) (${file_processing.totalCount} file(s))`;
        console.log('[NoteSummarySkill] Using notes from file processing');
      } else if (query && query.trim().length > 500) {
        // Use user message if it's substantial (likely pasted notes)
        notesText = query;
        notesSource = 'pasted text';
        console.log('[NoteSummarySkill] Using notes from user message');
      } else {
        // Try to extract notes from query even if shorter
        notesText = query || '';
        notesSource = 'user message';
      }
      
      // If files are present but file_processing results not available yet, return null
      // This will trigger re-execution in app.js after file_processing completes
      if ((!notesText || notesText.trim().length === 0) && context.hasFiles) {
        console.log('[NoteSummarySkill] Files detected but file_processing results not available yet, will re-execute');
        return null; // Will be re-executed with file_processing results
      }
      
      if (!notesText || notesText.trim().length === 0) {
        return null; // No notes to process
      }
      
      // Calculate metrics for context
      const charCount = notesText.length;
      const wordCount = notesText.split(/\s+/).filter(w => w.length > 0).length;
      console.log(`[NoteSummarySkill] Processing notes from ${notesSource}, ${charCount} characters, ${wordCount} words`);
      
      // Provide proportional length guidance
      // Note: Input may already be in point form (shorter) or full transcript (longer)
      // Output should always be significantly shorter than input since it's a summary
      const lengthGuidance = `**IMPORTANT: Output Length Guidance**

The input contains ${wordCount} words (${charCount} characters). Your summary output should be:
- **More concise than the input** - This is a summary, not a restatement
- **Proportional to input length** - Longer inputs may require more bullet points, but each point should still be concise
- **Appropriately detailed** - If the input is already brief/point-form, keep your summary very brief. If the input is a full transcript, you can include more detail but still be concise.
- **Focused on high-value information** - Prioritize key decisions, action items, and critical discussion points

Remember: The goal is to condense the information, not expand it. Your output should never be longer than the input, and ideally should be 20-40% of the input length.`;
      
      // Build enhanced prompt (instructions only - notes will go in user message)
      // Store notes separately so they can be added to user message instead of system instructions
      const enhancedPrompt = `${this.basePrompt}

${lengthGuidance}

Please summarize the notes provided in the user message according to the instructions and length guidance above.`;

      // Return both the prompt and the notes separately
      // The notes will be added to the user message, not system instructions
      return {
        prompt: enhancedPrompt,
        notes: notesText
      };
      
    } catch (error) {
      console.error('[NoteSummarySkill] Error during execution:', error);
      return `**Error During Note Summary**\n\nAn error occurred while processing the notes: ${error.message}\n\nPlease try again or contact support if the issue persists.`;
    }
  }
  
  /**
   * Determine if this skill should handle the query
   * Uses LLM to detect note summary intent, with keyword fallback
   * @param {string} query The user's query
   * @param {Object} context Additional context (hasFiles, etc.)
   * @returns {Promise<boolean>} True if skill should execute
   */
  async canHandle(query, context) {
    if (!query || !query.trim()) {
      // Still check if files are present
      return context.hasFiles === true;
    }
    
    // Check for substantial text or files as indicators
    const hasSubstantialText = query.length > 500;
    const hasFiles = context.hasFiles === true;
    
    // Try LLM-based intent detection if client is available
    if (this.client && this.azureOpenAIMiniDeploymentName) {
      try {
        const systemPrompt = `You are an intent detection assistant. Determine if the user's query is asking to summarize meeting notes, email recaps, meeting recaps, or similar note-taking/summarization tasks.

Return a JSON object with:
- isNoteSummary: true if the query is about summarizing notes/meetings/emails, false otherwise
- confidence: "high", "medium", or "low"

Examples:
Input: "Can you summarize these meeting notes?"
Output: {"isNoteSummary": true, "confidence": "high"}

Input: "Email recap from yesterday"
Output: {"isNoteSummary": true, "confidence": "high"}

Input: "Meeting recap"
Output: {"isNoteSummary": true, "confidence": "high"}

Input: "What's the weather today?"
Output: {"isNoteSummary": false, "confidence": "high"}

Input: "Summarize this document"
Output: {"isNoteSummary": true, "confidence": "medium"}

Return ONLY the JSON object, no other text.`;

        const response = await this.client.chat.completions.create({
          model: this.azureOpenAIMiniDeploymentName,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: query }
          ],
          temperature: 0.1,
          max_tokens: 50
        });
        
        const content = response.choices[0]?.message?.content?.trim() || '';
        
        // Parse JSON response
        if (content) {
          try {
            const parsed = JSON.parse(content);
            if (parsed.isNoteSummary === true) {
              console.log(`[NoteSummarySkill] LLM detected note summary intent (confidence: ${parsed.confidence})`);
              return true;
            }
          } catch (parseError) {
            console.log('[NoteSummarySkill] Failed to parse LLM response, using keyword fallback');
          }
        }
      } catch (error) {
        // Log but don't throw - fallback to keywords
        console.log(`[NoteSummarySkill] LLM intent detection failed (${error.code || error.message}), using keyword fallback`);
      }
    }
    
    // Fallback: Use keyword patterns
    const lowerQuery = query.toLowerCase();
    
    // Explicit note summary triggers
    const noteSummaryTriggers = [
      'email recap',
      'meeting recap',
      'meeting notes',
      'summarize notes',
      'note summary',
      'summarize meeting',
      'meeting summary',
      'recap meeting',
      'summarize this',
      'summarize these',
      'take notes',
      'notes from'
    ];
    
    for (const trigger of noteSummaryTriggers) {
      if (lowerQuery.includes(trigger)) {
        console.log(`[NoteSummarySkill] Triggered by keyword: "${trigger}"`);
        return true;
      }
    }
    
    // Check if substantial text is present (likely pasted notes) even without explicit keywords
    if (hasSubstantialText && (lowerQuery.includes('summarize') || lowerQuery.includes('recap'))) {
      console.log('[NoteSummarySkill] Triggered by substantial text with summarize/recap keywords');
      return true;
    }
    
    // If files are present and query suggests summarization
    if (hasFiles && (lowerQuery.includes('summarize') || lowerQuery.includes('recap') || lowerQuery.includes('notes'))) {
      console.log('[NoteSummarySkill] Triggered by file upload with summarize/recap/notes keywords');
      return true;
    }
    
    return false;
  }
}

module.exports = { NoteSummarySkill };

