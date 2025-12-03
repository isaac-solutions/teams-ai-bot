const { BaseSkill } = require('./baseSkill');
const { google } = require('googleapis');
const axios = require('axios');
const cheerio = require('cheerio');
const { AzureOpenAI } = require('openai');

/**
 * Web Search Skill - Searches the web for current information using Google Custom Search API
 * Updated to use Jina Reader Pro as primary scraping method
 */
class WebSearchSkill extends BaseSkill {
  constructor(config = {}) {
    super('web_search', 'Search the web for current information and recent events');
    this.enabled = false; // Disabled until API is configured
    this.apiKey = config.googleApiKey;
    this.searchEngineId = config.googleSearchEngineId;
    this.jinaApiKey = config.jinaApiKey; // NEW: Jina Reader API key
    this.maxResults = 4; // Top 4 results for more concise output
    this.maxCharactersPerPage = 4000; // Limit content per page
    this.fetchTimeout = 15000; // 15 second timeout for fetching pages (increased from 8s)
    this.jinaTimeout = 12000; // 12 second timeout for Jina Reader (increased from 5s)
    this.totalSearchTimeout = 30000; // 30 second overall timeout (increased from 25s)
    this.apiCallCount = 0; // Track API usage
    this.dailyLimit = 90; // Daily limit (buffer under Google's 100/day free tier)
    this.lastResetDate = new Date().toDateString(); // Track when to reset counter
    
    // Request rate limiting to avoid overwhelming services
    this.requestDelay = 800; // 800ms delay between requests (reduced from implicit)
    this.lastRequestTime = 0;
    
    // Retry configuration for failed requests
    this.maxRetries = 3;
    this.retryDelay = 1000; // Start with 1 second, exponential backoff
    
    // Azure OpenAI configuration for LLM query optimization
    this.azureOpenAIKey = config.azureOpenAIKey;
    this.azureOpenAIEndpoint = config.azureOpenAIEndpoint;
    this.azureOpenAIDeploymentName = config.azureOpenAIDeploymentName;
    this.llmOptimizationEnabled = !!(this.azureOpenAIKey && this.azureOpenAIEndpoint && this.azureOpenAIDeploymentName);
    
    if (this.llmOptimizationEnabled) {
      console.log('[WebSearchSkill] LLM query optimization enabled');
    }
    
    if (this.jinaApiKey) {
      console.log('[WebSearchSkill] Jina Reader Pro API key configured');
    }
  }
  
  /**
   * Execute web search
   * @param {Object} context Contains query and optional searchQuery parameter
   * @returns {Promise<string|null>} Search results with page content or null
   */
  async execute(context) {
    if (!this.enabled) {
      console.log('[WebSearchSkill] Skill not yet enabled');
      return null;
    }

    const { query, searchQuery } = context;
    
    if (!query || !query.trim()) {
      console.log('[WebSearchSkill] No query provided');
      return null;
    }

    // Check rate limiting
    this.resetDailyLimitIfNeeded();
    if (this.apiCallCount >= this.dailyLimit) {
      console.log(`[WebSearchSkill] Daily API limit reached (${this.dailyLimit} calls). Skipping search.`);
      return null;
    }

    try {
      // Use pre-extracted search query if provided by orchestrator
      const queryToSearch = searchQuery || query;
      if (searchQuery) {
        console.log(`[WebSearchSkill] Using pre-extracted search query: "${searchQuery}"`);
      }
      
      console.log(`[WebSearchSkill] Searching Google for: "${queryToSearch}" (API call ${this.apiCallCount + 1}/${this.dailyLimit})`);
      
      // Wrap entire search operation with timeout
      // Note: If timeout fires, performSearch() may continue in background, but result is returned
      // With optimization to stop after 2 successful extractions, this should complete quickly
      const searchPromise = this.performSearch(queryToSearch, !!searchQuery);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Web search operation timeout')), this.totalSearchTimeout)
      );
      
      const result = await Promise.race([searchPromise, timeoutPromise]);
      console.log(`[WebSearchSkill] Search operation completed, returning result`);
      return result;
      
    } catch (error) {
      if (error.message === 'Web search operation timeout') {
        console.error('[WebSearchSkill] Search operation timed out after', this.totalSearchTimeout, 'ms');
      } else {
        console.error('[WebSearchSkill] Error during web search:', error);
      }
      return null;
    }
  }
  
  /**
   * Perform the actual search operation (separated for timeout control)
   * @param {string} query Search query
   * @param {boolean} skipOptimization If true, skip query optimization (already done by orchestrator)
   * @returns {Promise<string|null>} Formatted search results
   * @private
   */
  async performSearch(query, skipOptimization = false) {
    // Step 1: Optimize search query using LLM or regex (skip if already optimized by orchestrator)
    let optimizedQuery = query;
    if (!skipOptimization) {
      optimizedQuery = await this.optimizeSearchQuery(query);
      console.log(`[WebSearchSkill] Optimized query: "${optimizedQuery}"`);
    } else {
      console.log(`[WebSearchSkill] Using pre-optimized query: "${optimizedQuery}"`);
    }
    
    // Step 2: Get search results from Google
    const searchResults = await this.searchGoogle(optimizedQuery);
    
    if (!searchResults || searchResults.length === 0) {
      console.log('[WebSearchSkill] No search results found');
      return null;
    }
    
    console.log(`[WebSearchSkill] Found ${searchResults.length} search results`);
    
    // Step 3: Fetch and extract content from each page with rate limiting
    const resultsWithContent = await this.fetchAllPageContent(searchResults);
    
    // Step 4: If no pages could be fetched, fall back to snippets only
    if (resultsWithContent.length === 0) {
      console.log('[WebSearchSkill] No page content could be extracted - using snippets only');
      return this.formatResultsWithSnippets(searchResults);
    }
    
    console.log(`[WebSearchSkill] Successfully extracted content from ${resultsWithContent.length} pages`);
    
    // Step 5: Format results for LLM context
    return this.formatResults(resultsWithContent);
  }
  
  /**
   * Optimize search query using LLM or regex fallback
   * @param {string} query Original user query
   * @returns {Promise<string>} Optimized search query
   * @private
   */
  async optimizeSearchQuery(query) {
    // Strategy 1: Try LLM optimization (best quality)
    if (this.llmOptimizationEnabled) {
      try {
        const optimized = await this.optimizeWithLLM(query);
        if (optimized && optimized.length > 0) {
          console.log(`[WebSearchSkill] LLM optimization successful`);
          return optimized;
        }
      } catch (error) {
        console.log(`[WebSearchSkill] LLM optimization failed: ${error.message}, using regex fallback`);
      }
    }
    
    // Strategy 2: Regex-based optimization (fallback)
    console.log(`[WebSearchSkill] Using regex-based optimization`);
    return this.optimizeWithRegex(query);
  }
  
  /**
   * Optimize search query using LLM
   * @param {string} query Original user query
   * @returns {Promise<string>} Optimized search query
   * @private
   */
  async optimizeWithLLM(query) {
    try {
      // Extract base endpoint
      let baseEndpoint = this.azureOpenAIEndpoint;
      if (baseEndpoint.includes('/openai/')) {
        const url = new URL(baseEndpoint);
        baseEndpoint = `${url.protocol}//${url.host}/`;
      }
      
      const client = new AzureOpenAI({
        apiKey: this.azureOpenAIKey,
        endpoint: baseEndpoint,
        apiVersion: "2024-10-21"
      });
      
      const systemPrompt = `You are a search query optimizer. Your job is to convert conversational questions into optimal Google search queries.

Rules:
1. Extract key entities (company names, products, topics, people)
2. Remove conversational fluff and filler words
3. Keep it concise (under 10 words)
4. Use keywords that work well in search engines
5. Preserve important context (like "company overview" or "financial data")
6. Return ONLY the optimized query, nothing else

Examples:
User: "I have a client named Hammond Power Solutions Inc that is a potential client, I want to do some initial research"
Optimized: "Hammond Power Solutions Inc company overview"

User: "Can you find me information about Tesla's latest earnings report?"
Optimized: "Tesla earnings report latest"

User: "What does Microsoft do and what are their main products?"
Optimized: "Microsoft company products services"`;

      const response = await client.chat.completions.create({
        model: this.azureOpenAIDeploymentName,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: query }
        ],
        temperature: 0.3,
        max_tokens: 50
      });
      
      const optimizedQuery = response.choices[0]?.message?.content?.trim() || '';
      
      if (optimizedQuery) {
        return optimizedQuery;
      }
      
      throw new Error('No optimized query returned from LLM');
      
    } catch (error) {
      console.error(`[WebSearchSkill] LLM optimization error: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Optimize search query using regex patterns (fallback method)
   * @param {string} query Original user query
   * @returns {string} Optimized search query
   * @private
   */
  optimizeWithRegex(query) {
    // Extract company names with proper suffixes (Inc, Corp, etc.)
    const companyWithSuffixPattern = /\b([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*){0,5})\s+(Inc\.?|Corp\.?|Corporation|Company|LLC|Ltd\.?|Limited|Co\.?)\b/i;
    const companyMatch = query.match(companyWithSuffixPattern);
    
    if (companyMatch && companyMatch[0]) {
      // Found a company name with suffix - search for it
      console.log(`[WebSearchSkill] Extracted company name: "${companyMatch[0]}"`);
      return companyMatch[0];
    }
    
    // Try to find capitalized multi-word phrases (likely proper nouns/companies)
    const properNounPattern = /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,4})\b/g;
    const properNouns = query.match(properNounPattern);
    
    if (properNouns && properNouns.length > 0) {
      // Filter out common words that might be capitalized
      const filtered = properNouns.filter(noun => {
        const lower = noun.toLowerCase();
        return !['I Need', 'I Want', 'We Have', 'We Need', 'Please Help'].includes(noun);
      });
      
      if (filtered.length > 0) {
        // Return the longest proper noun (likely a company/person name)
        const longest = filtered.reduce((a, b) => a.length > b.length ? a : b);
        console.log(`[WebSearchSkill] Extracted proper noun: "${longest}"`);
        return longest;
      }
    }
    
    // Extract quoted phrases
    const quotedPattern = /"([^"]+)"/g;
    const quotedMatch = query.match(quotedPattern);
    if (quotedMatch && quotedMatch.length > 0) {
      return quotedMatch[0].replace(/"/g, '');
    }
    
    // If query is very long (>100 chars), extract key terms
    if (query.length > 100) {
      // Remove common filler words and extract important terms
      const fillerWords = /\b(i|we|need|want|to|do|some|about|on|can|you|please|help|me|with|the|a|an|is|are|was|were|been|have|has|had|that|this|these|those|named|called)\b/gi;
      const cleanedQuery = query.replace(fillerWords, ' ').replace(/\s+/g, ' ').trim();
      
      // Take first 50 chars of cleaned query
      const result = cleanedQuery.substring(0, 50).trim();
      console.log(`[WebSearchSkill] Extracted key terms: "${result}"`);
      return result;
    }
    
    // Return original query if it's already short
    return query;
  }
  
  /**
   * Reset daily API call counter if it's a new day
   * @private
   */
  resetDailyLimitIfNeeded() {
    const today = new Date().toDateString();
    if (this.lastResetDate !== today) {
      this.apiCallCount = 0;
      this.lastResetDate = today;
      console.log('[WebSearchSkill] Daily API counter reset');
    }
  }
  
  /**
   * Search Google using Custom Search API
   * @param {string} query Search query
   * @returns {Promise<Array>} Array of search results
   * @private
   */
  async searchGoogle(query) {
    try {
      const customsearch = google.customsearch('v1');
      
      const response = await customsearch.cse.list({
        auth: this.apiKey,
        cx: this.searchEngineId,
        q: query,
        num: this.maxResults
      });
      
      // Increment API call counter after successful call
      this.apiCallCount++;
      
      if (!response.data.items || response.data.items.length === 0) {
        return [];
      }
      
      return response.data.items.map(item => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet,
        displayLink: item.displayLink
      }));
      
    } catch (error) {
      console.error('[WebSearchSkill] Error calling Google Custom Search API:', error.message);
      throw error;
    }
  }
  
  /**
   * Fetch and extract content from all search result pages with rate limiting
   * Stops after 2 successful extractions, but continues if 429 errors occur
   * @param {Array} searchResults Array of search results
   * @returns {Promise<Array>} Array of results with extracted content
   * @private
   */
  async fetchAllPageContent(searchResults) {
    const results = [];
    const targetSuccessCount = 2; // Stop after 2 successful extractions
    let successCount = 0;
    
    // Process pages sequentially with rate limiting to avoid overwhelming services
    for (const result of searchResults) {
      // Stop if we've reached our target of 2 successful extractions
      if (successCount >= targetSuccessCount) {
        console.log(`[WebSearchSkill] Reached target of ${targetSuccessCount} successful extractions, stopping`);
        break;
      }
      
      try {
        // Apply rate limiting between requests
        await this.applyRateLimit();
        
        const content = await this.fetchPageContent(result.url);
        if (content && content.trim()) {
          results.push({
            ...result,
            content: content
          });
          successCount++;
          console.log(`[WebSearchSkill] Successfully extracted page ${successCount}/${targetSuccessCount}: ${result.url}`);
        }
      } catch (error) {
        // Check if this is a 429 (rate limit) error
        const is429Error = error.message && (
          error.message.includes('429') || 
          error.message.includes('rate limit') || 
          error.message.includes('too many requests') ||
          (error.response && error.response.status === 429)
        );
        
        if (is429Error && successCount < targetSuccessCount) {
          // If we have < 2 successes and get a 429, continue to next page
          console.log(`[WebSearchSkill] Got 429 error on ${result.url}, but only have ${successCount}/${targetSuccessCount} successes - continuing to next page`);
          // Continue to next iteration
        } else {
          // For non-429 errors or if we already have enough successes, skip silently
          console.log(`[WebSearchSkill] Failed to fetch ${result.url}: ${error.message}`);
        }
      }
    }
    
    return results;
  }
  
  /**
   * Apply rate limiting between requests
   * @private
   */
  async applyRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.requestDelay) {
      const waitTime = this.requestDelay - timeSinceLastRequest;
      console.log(`[WebSearchSkill] Rate limiting: waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }
  
  /**
   * Fetch HTML content from a URL with retry logic
   * @param {string} url URL to fetch
   * @returns {Promise<string>} Extracted text content
   * @private
   */
  async fetchPageContent(url) {
    // Skip LinkedIn URLs entirely - they're heavily protected
    if (url.includes('linkedin.com')) {
      console.log(`[WebSearchSkill] Skipping LinkedIn URL (heavily protected): ${url}`);
      throw new Error('LinkedIn URLs are not supported');
    }
    
    // Strategy 1: Try Jina Reader Pro with retry logic (primary method)
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const jinaText = await this.fetchViaJinaReaderPro(url);
        if (jinaText && jinaText.length > 200) {
          const truncated = this.truncateText(jinaText);
          console.log(`[WebSearchSkill] Successfully extracted via Jina Reader Pro (${jinaText.length} chars, truncated to ${truncated.length}) [attempt ${attempt + 1}]`);
          return truncated;
        }
      } catch (jinaError) {
        if (attempt < this.maxRetries - 1) {
          const backoffTime = this.retryDelay * Math.pow(2, attempt);
          console.log(`[WebSearchSkill] Jina Reader attempt ${attempt + 1} failed: ${jinaError.message}, retrying in ${backoffTime}ms`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
        } else {
          console.log(`[WebSearchSkill] Jina Reader failed after ${this.maxRetries} attempts: ${jinaError.message}, trying direct fetch`);
        }
      }
    }
    
    // Strategy 2: Direct fetch with cheerio (fallback)
    try {
      const response = await axios.get(url, {
        timeout: this.fetchTimeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Cache-Control': 'max-age=0'
        },
        maxRedirects: 5,
        maxContentLength: 5 * 1024 * 1024, // 5MB limit
        validateStatus: (status) => status >= 200 && status < 300
      });
      
      const html = response.data;
      
      // Check HTML size before parsing
      const htmlSize = typeof html === 'string' ? html.length : Buffer.byteLength(html);
      if (htmlSize > 3 * 1024 * 1024) { // 3MB
        console.log(`[WebSearchSkill] HTML too large (${htmlSize} bytes), truncating`);
        const truncatedHtml = typeof html === 'string' ? html.substring(0, 1024 * 1024) : html;
        return this.extractTextFromHTML(truncatedHtml);
      }
      
      return this.extractTextFromHTML(html);
      
    } catch (error) {
      console.log(`[WebSearchSkill] Error fetching page: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Fetch page content via Jina Reader Pro (paid service with API key)
   * @param {string} url URL to fetch
   * @returns {Promise<string>} Extracted text
   * @private
   */
  async fetchViaJinaReaderPro(url) {
    const jinaUrl = `https://r.jina.ai/${encodeURIComponent(url)}`;
    
    const headers = {
      'Accept': 'text/plain',
      'X-Return-Format': 'text'
    };
    
    // Add Authorization header if API key is configured
    if (this.jinaApiKey) {
      headers['Authorization'] = `Bearer ${this.jinaApiKey}`;
    }
    
    const response = await axios.get(jinaUrl, {
      timeout: this.jinaTimeout,
      headers: headers
    });
    
    return response.data;
  }
  
  /**
   * Truncate text to maxCharactersPerPage while trying to preserve sentence boundaries
   * @param {string} text Text to truncate
   * @returns {string} Truncated text
   * @private
   */
  truncateText(text) {
    if (text.length <= this.maxCharactersPerPage) {
      return text;
    }
    
    let truncated = text.substring(0, this.maxCharactersPerPage);
    
    // Try to cut at sentence boundary (period followed by space or newline)
    const lastPeriod = truncated.lastIndexOf('. ');
    const lastNewline = truncated.lastIndexOf('\n');
    const cutPoint = Math.max(lastPeriod, lastNewline);
    
    // Only use the cut point if it's reasonably close to the limit (within 80%)
    if (cutPoint > this.maxCharactersPerPage * 0.8) {
      truncated = truncated.substring(0, cutPoint + 1);
    }
    
    return truncated + '...';
  }
  
  /**
   * Extract clean text from HTML using cheerio
   * @param {string} html HTML content
   * @returns {string} Extracted and cleaned text
   * @private
   */
  extractTextFromHTML(html) {
    try {
      // Load HTML with cheerio (with error handling for malformed HTML)
      const $ = cheerio.load(html, {
        xml: false,
        decodeEntities: true,
        _useHtmlParser2: true
      });
      
      // Remove unwanted elements (scripts, styles, navigation, ads, etc.)
      $('script, style, nav, header, footer, iframe, noscript, aside, form').remove();
      $('[class*="ad"], [id*="ad"], [class*="advertisement"]').remove();
      $('[class*="cookie"], [id*="cookie"], [class*="banner"]').remove();
      $('[class*="sidebar"], [class*="menu"], [class*="navigation"]').remove();
      $('[class*="popup"], [class*="modal"], [class*="overlay"]').remove();
      $('button, .button, input, select, textarea').remove(); // Remove interactive elements
      
      // Get text from main content areas first, fallback to body
      let text = '';
      const mainSelectors = ['main', 'article', '[role="main"]', '.content', '.main-content', '#content', '#main'];
      
      for (const selector of mainSelectors) {
        try {
          const mainContent = $(selector);
          if (mainContent.length > 0) {
            text = mainContent.text();
            if (text && text.trim().length > 100) {
              break;
            }
          }
        } catch (selectorError) {
          // Skip problematic selectors
          continue;
        }
      }
      
      // Fallback to body if no main content found
      if (!text || text.trim().length < 100) {
        try {
          text = $('body').length > 0 ? $('body').text() : $.text();
        } catch (bodyError) {
          // Last resort: return raw text extraction
          text = html.replace(/<[^>]*>/g, ' ');
        }
      }
      
      // Clean up whitespace while preserving some structure
      text = text
        .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
        .replace(/\n\s*\n/g, '\n') // Remove empty lines
        .replace(/\. /g, '.\n') // Add line breaks after sentences for better readability
        .trim();
      
      // Limit to max characters (try to cut at sentence boundary)
      if (text.length > this.maxCharactersPerPage) {
        let truncated = text.substring(0, this.maxCharactersPerPage);
        const lastPeriod = truncated.lastIndexOf('.');
        const lastNewline = truncated.lastIndexOf('\n');
        const cutPoint = Math.max(lastPeriod, lastNewline);
        
        if (cutPoint > this.maxCharactersPerPage * 0.8) {
          truncated = truncated.substring(0, cutPoint + 1);
        }
        text = truncated + '...';
      }
      
      return text;
      
    } catch (error) {
      console.error(`[WebSearchSkill] Error extracting text with cheerio: ${error.message}`);
      // Fallback: simple regex-based text extraction
      try {
        let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
        text = text.replace(/<[^>]*>/g, ' ');
        text = text.replace(/\s+/g, ' ').trim();
        return text.substring(0, this.maxCharactersPerPage) + '...';
      } catch (fallbackError) {
        console.error(`[WebSearchSkill] Fallback extraction also failed: ${fallbackError.message}`);
        return '';
      }
    }
  }
  
  /**
   * Determine if web search should run
   * Uses smart detection to avoid triggering on internal/RAG/file queries
   */
  async canHandle(query, context) {
    if (!this.enabled) {
      return false;
    }

    if (!query || !query.trim()) {
      return false;
    }

    const lowerQuery = query.toLowerCase();
    
    // Priority 1: Explicit web search triggers (highest confidence)
    const explicitWebTriggers = /search (the )?web|google|look ?up online|find online|search (for|about)|web search|research|discovery/i;
    if (explicitWebTriggers.test(query)) {
      console.log('[WebSearchSkill] Explicit web search trigger detected');
      return true;
    }
    
    // Priority 2: Skip internal/policy queries (should use RAG)
    const internalKeywords = /our (policy|policies|team|benefits|vacation|pto|handbook)|my (manager|schedule|benefits|team)/i;
    if (internalKeywords.test(query)) {
      console.log('[WebSearchSkill] Skipping - detected internal/policy query (RAG should handle)');
      return false;
    }
    
    // Priority 3: Time-sensitive/current information
    const timeSensitive = /today|latest|current|breaking|now|recent|this (week|month|year)|what('s| is) happening/i;
    if (timeSensitive.test(query)) {
      console.log('[WebSearchSkill] Time-sensitive query detected');
      return true;
    }
    
    // Priority 4: News queries
    const newsKeywords = /news|headline|announcement/i;
    if (newsKeywords.test(query)) {
      console.log('[WebSearchSkill] News query detected');
      return true;
    }
    
    // Priority 5: External research queries (companies, competitors, industries)
    const externalResearch = /(research|information|tell me about|learn about|background on) (the )?(company|competitor|industry|market|client)/i;
    const companyNamePattern = /\b[A-Z][a-zA-Z]+(\s[A-Z][a-zA-Z]+)*\s(Inc|Corp|LLC|Ltd|Corporation|Company)\b/;
    
    if (externalResearch.test(query) || companyNamePattern.test(query)) {
      console.log('[WebSearchSkill] External research query detected');
      return true;
    }
    
    // Priority 6: Specific year mentions (2024, 2025, etc.)
    const yearPattern = /\b(2024|2025|2026)\b/;
    if (yearPattern.test(query)) {
      console.log('[WebSearchSkill] Year-specific query detected');
      return true;
    }
    
    // Default: Don't search web (let RAG or direct LLM handle it)
    console.log('[WebSearchSkill] No web search triggers detected - skipping');
    return false;
  }
  
  /**
   * Enable web search (call after configuring API credentials)
   */
  enable() {
    if (!this.apiKey || !this.searchEngineId) {
      console.log('[WebSearchSkill] Cannot enable - missing API credentials');
      return;
    }
    
    this.enabled = true;
    console.log('[WebSearchSkill] Web search enabled successfully');
    
    if (this.jinaApiKey) {
      console.log('[WebSearchSkill] Jina Reader Pro enabled with API key');
    } else {
      console.log('[WebSearchSkill] Warning: No Jina API key configured - using free tier (rate limited)');
    }
  }
  
  /**
   * Format web search results with page content for LLM context
   * @param {Array} results Search results with content
   * @returns {string} Formatted context
   * @private
   */
  formatResults(results) {
    if (!results || results.length === 0) {
      return '';
    }
    
    const searchTimestamp = new Date().toISOString();
    const formattedDate = new Date().toLocaleString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC'
    });
    
    const formattedResults = results.map((result, index) => {
      return `<web_result index="${index + 1}" source="${result.url}" title="${result.title}">
${result.content}
</web_result>`;
    }).join('\n\n');
    
    const header = `<web_search_results count="${results.length}" timestamp="${searchTimestamp}" searched_at="${formattedDate} UTC">
The following are web search results retrieved on ${formattedDate} UTC. This information may contain current events or recent data:
`;
    
    const footer = `\n</web_search_results>`;
    
    return header + formattedResults + footer;
  }
  
  /**
   * Format web search results using only snippets (fallback when pages can't be fetched)
   * @param {Array} results Search results with snippets
   * @returns {string} Formatted context
   * @private
   */
  formatResultsWithSnippets(results) {
    if (!results || results.length === 0) {
      return '';
    }
    
    const searchTimestamp = new Date().toISOString();
    const formattedDate = new Date().toLocaleString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC'
    });
    
    const formattedResults = results.map((result, index) => {
      return `<web_result index="${index + 1}" source="${result.url}" title="${result.title}">
${result.snippet}
(Note: Full page content unavailable - showing search snippet only)
</web_result>`;
    }).join('\n\n');
    
    const header = `<web_search_results count="${results.length}" timestamp="${searchTimestamp}" searched_at="${formattedDate} UTC" content_type="snippets_only">
The following are web search results retrieved on ${formattedDate} UTC. Full page content could not be accessed, so only search result snippets are provided:
`;
    
    const footer = `\n</web_search_results>`;
    
    return header + formattedResults + footer;
  }
}

module.exports = { WebSearchSkill };