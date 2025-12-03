const { BaseSkill } = require('./baseSkill');
const YahooFinance = require('yahoo-finance2').default;
const { AzureOpenAI } = require('openai');

// Create Yahoo Finance instance
const yahooFinance = new YahooFinance();

/**
 * Yahoo Finance Skill - Gets real-time stock data using yahoo-finance2 library
 */
class YahooFinanceSkill extends BaseSkill {
  constructor(config = {}) {
    super('yahoo_finance', 'Get real-time stock prices and financial data');
    this.enabled = true; // Always enabled - no API key required
    this.timeout = 5000; // 5 second timeout
    this.yf = yahooFinance; // Use the Yahoo Finance instance
    
    // Azure OpenAI for LLM-based ticker extraction
    this.azureOpenAIKey = config.azureOpenAIKey;
    this.azureOpenAIEndpoint = config.azureOpenAIEndpoint;
    this.azureOpenAIDeploymentName = config.azureOpenAIDeploymentName;
    this.llmEnabled = !!(this.azureOpenAIKey && this.azureOpenAIEndpoint && this.azureOpenAIDeploymentName);
    
    if (this.llmEnabled) {
      console.log('[YahooFinanceSkill] LLM ticker extraction enabled');
    }
  }
  
  /**
   * Execute Yahoo Finance lookup
   * @param {Object} context Contains query and optional tickers parameter
   * @returns {Promise<string|null>} Formatted financial data or null
   */
  async execute(context) {
    const { query, tickers } = context;
    
    if (!query || !query.trim()) {
      console.log('[YahooFinanceSkill] No query provided');
      return null;
    }

    try {
      // Use pre-extracted tickers if provided by orchestrator
      let symbols = [];
      
      if (tickers && Array.isArray(tickers) && tickers.length > 0) {
        symbols = tickers;
        console.log(`[YahooFinanceSkill] Using pre-extracted tickers: ${symbols.join(', ')}`);
      } else {
        // Extract stock symbols from query using LLM (preferred) or fallback to pattern matching
        if (this.llmEnabled) {
          symbols = await this.extractTickersWithLLM(query);
          console.log(`[YahooFinanceSkill] LLM extracted tickers: ${symbols.join(', ')}`);
        }
        
        // Fallback to pattern matching if LLM fails or returns nothing
        if (symbols.length === 0) {
          symbols = this.extractStockSymbols(query);
          console.log(`[YahooFinanceSkill] Pattern-based extraction: ${symbols.join(', ')}`);
        }
      }
      
      if (symbols.length === 0) {
        console.log('[YahooFinanceSkill] No stock symbols identified');
        return null;
      }

      console.log(`[YahooFinanceSkill] Fetching data for: ${symbols.join(', ')}`);
      
      // Fetch data for all symbols
      const results = await Promise.all(
        symbols.map(symbol => this.fetchStockData(symbol))
      );
      
      // Filter out failed requests
      const successfulResults = results.filter(r => r !== null);
      
      if (successfulResults.length === 0) {
        console.log('[YahooFinanceSkill] No data retrieved');
        return null;
      }
      
      // Format results for LLM
      const formattedData = this.formatFinancialData(successfulResults);
      console.log(`[YahooFinanceSkill] Successfully retrieved data for ${successfulResults.length} stock(s)`);
      
      return formattedData;
      
    } catch (error) {
      console.error('[YahooFinanceSkill] Error fetching financial data:', error.message);
      return null;
    }
  }
  
  /**
   * Extract stock tickers using LLM
   * @param {string} query User query
   * @returns {Promise<Array<string>>} Array of stock symbols
   * @private
   */
  async extractTickersWithLLM(query) {
    try {
      const client = new AzureOpenAI({
        apiKey: this.azureOpenAIKey,
        endpoint: this.azureOpenAIEndpoint,
        apiVersion: "2024-10-21",
        deployment: this.azureOpenAIDeploymentName
      });
      
      const prompt = `Extract stock ticker symbols from the following query. Return ONLY the ticker symbols, comma-separated, with no explanation.

Rules:
- For US stocks, return the symbol only (e.g., AAPL for Apple)
- For Canadian stocks on TSX, add .TO suffix and use hyphens for multi-part symbols (e.g., HPS-A.TO for Hammond Power on TSX)
- For international stocks, include appropriate suffix (.L for London, etc.)
- If a company name is mentioned, return its ticker symbol
- Return up to 3 tickers maximum
- If no valid tickers can be identified, return NONE
- IMPORTANT: Yahoo Finance uses hyphens (-) not dots (.) for multi-character ticker symbols

Common mappings:
- Apple → AAPL
- Microsoft → MSFT
- Google/Alphabet → GOOGL
- Amazon → AMZN
- Tesla → TSLA
- Hammond Power Solutions → HPS-A.TO (Toronto Stock Exchange)
- Meta/Facebook → META
- Nvidia → NVDA

Query: "${query}"

Tickers:`;

      const response = await client.chat.completions.create({
        model: this.azureOpenAIDeploymentName,
        messages: [
          { role: "system", content: "You are a financial data assistant that extracts stock ticker symbols from queries." },
          { role: "user", content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 50
      });
      
      const result = response.choices[0]?.message?.content?.trim();
      
      if (!result || result === 'NONE') {
        return [];
      }
      
      // Parse comma-separated tickers
      const tickers = result
        .split(',')
        .map(t => t.trim().toUpperCase())
        .filter(t => t && t !== 'NONE' && t.length >= 1 && t.length <= 10);
      
      return tickers.slice(0, 3); // Limit to 3 tickers
      
    } catch (error) {
      console.log(`[YahooFinanceSkill] LLM extraction failed: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Extract stock symbols from query (fallback pattern matching)
   * @param {string} query User query
   * @returns {Array<string>} Array of stock symbols
   * @private
   */
  extractStockSymbols(query) {
    const symbols = [];
    const upperQuery = query.toUpperCase();
    
    // Common stock symbol patterns (1-5 uppercase letters, optionally with hyphens and .TO, .L, etc.)
    const symbolPattern = /\b([A-Z]{1,5}(?:-[A-Z]{1,2})?(?:\.[A-Z]{1,2})?)\b/g;
    const matches = upperQuery.match(symbolPattern);
    
    if (matches) {
      // Filter out common words that look like symbols but aren't
      const commonWords = ['THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HER', 'WAS', 'ONE', 'OUR', 'OUT', 'INC', 'LLC', 'LTD', 'CORP'];
      const filtered = matches.filter(m => !commonWords.includes(m) && m.length >= 2);
      symbols.push(...filtered);
    }
    
    // Known company name to symbol mapping (extend as needed)
    // Note: Yahoo Finance uses hyphens (-) not dots (.) for multi-character symbols
    const companyMap = {
      'APPLE': 'AAPL',
      'MICROSOFT': 'MSFT',
      'GOOGLE': 'GOOGL',
      'ALPHABET': 'GOOGL',
      'AMAZON': 'AMZN',
      'TESLA': 'TSLA',
      'META': 'META',
      'FACEBOOK': 'META',
      'NVIDIA': 'NVDA',
      'HAMMOND POWER': 'HPS-A.TO',
      'HAMMOND POWER SOLUTIONS': 'HPS-A.TO',
      'NETFLIX': 'NFLX',
      'ADOBE': 'ADBE',
      'SALESFORCE': 'CRM',
      'ORACLE': 'ORCL',
      'INTEL': 'INTC',
      'IBM': 'IBM',
      'WALMART': 'WMT',
      'DISNEY': 'DIS',
      'COCA COLA': 'KO',
      'PEPSI': 'PEP',
      'MCDONALD': 'MCD',
      'VISA': 'V',
      'MASTERCARD': 'MA',
      'PAYPAL': 'PYPL',
      'BOEING': 'BA',
      'GENERAL ELECTRIC': 'GE',
      'FORD': 'F',
      'GM': 'GM',
      'GENERAL MOTORS': 'GM'
    };
    
    // Check for company names in query
    for (const [company, symbol] of Object.entries(companyMap)) {
      if (upperQuery.includes(company) && !symbols.includes(symbol)) {
        symbols.push(symbol);
      }
    }
    
    // Remove duplicates and limit to 3 symbols per query
    return [...new Set(symbols)].slice(0, 3);
  }
  
  /**
   * Fetch stock data from Yahoo Finance using yahoo-finance2 library
   * @param {string} symbol Stock symbol (e.g., AAPL, MSFT, HPS-A.TO)
   * @returns {Promise<Object|null>} Stock data or null
   * @private
   */
  async fetchStockData(symbol) {
    try {
      console.log(`[YahooFinanceSkill] Fetching quote for: ${symbol}`);
      
      // Use yahoo-finance2's quote method which handles authentication
      const quote = await this.yf.quote(symbol);
      
      if (quote) {
        console.log(`[YahooFinanceSkill] Successfully fetched ${symbol}`);
        return {
          symbol: quote.symbol,
          name: quote.longName || quote.shortName || symbol,
          price: quote.regularMarketPrice,
          currency: quote.currency || 'USD',
          change: quote.regularMarketChange,
          changePercent: quote.regularMarketChangePercent,
          dayHigh: quote.regularMarketDayHigh,
          dayLow: quote.regularMarketDayLow,
          volume: quote.regularMarketVolume,
          marketCap: quote.marketCap,
          fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
          exchange: quote.fullExchangeName,
          timestamp: new Date(quote.regularMarketTime * 1000).toISOString()
        };
      }
      
      return null;
    } catch (error) {
      console.log(`[YahooFinanceSkill] Failed to fetch ${symbol}: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Format financial data for LLM context
   * @param {Array<Object>} stockData Array of stock data objects
   * @returns {string} Formatted context
   * @private
   */
  formatFinancialData(stockData) {
    const timestamp = new Date().toISOString();
    const formattedDate = new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC'
    });
    
    let formatted = `<financial_data source="Yahoo Finance" timestamp="${timestamp}" retrieved_at="${formattedDate} UTC">\n`;
    formatted += `Real-time stock market data retrieved on ${formattedDate} UTC:\n\n`;
    
    for (const stock of stockData) {
      const changeSign = stock.change >= 0 ? '+' : '';
      const changeColor = stock.change >= 0 ? '📈' : '📉';
      
      formatted += `<stock symbol="${stock.symbol}">\n`;
      formatted += `**${stock.name} (${stock.symbol})**\n`;
      formatted += `Exchange: ${stock.exchange}\n`;
      formatted += `Current Price: ${stock.currency} ${stock.price?.toFixed(2) || 'N/A'}\n`;
      formatted += `Change: ${changeSign}${stock.change?.toFixed(2) || 'N/A'} (${changeSign}${stock.changePercent?.toFixed(2) || 'N/A'}%) ${changeColor}\n`;
      formatted += `Day Range: ${stock.dayLow?.toFixed(2) || 'N/A'} - ${stock.dayHigh?.toFixed(2) || 'N/A'}\n`;
      formatted += `52 Week Range: ${stock.fiftyTwoWeekLow?.toFixed(2) || 'N/A'} - ${stock.fiftyTwoWeekHigh?.toFixed(2) || 'N/A'}\n`;
      
      if (stock.volume) {
        formatted += `Volume: ${stock.volume.toLocaleString()}\n`;
      }
      
      if (stock.marketCap) {
        const marketCapBillions = (stock.marketCap / 1000000000).toFixed(2);
        formatted += `Market Cap: ${stock.currency} ${marketCapBillions}B\n`;
      }
      
      formatted += `Last Updated: ${new Date(stock.timestamp).toLocaleString('en-US', { timeZone: 'UTC' })} UTC\n`;
      formatted += `</stock>\n\n`;
    }
    
    formatted += `Data source: Yahoo Finance (Real-time quotes)\n`;
    formatted += `Note: Prices may be delayed by 15-20 minutes for some exchanges.\n`;
    formatted += `</financial_data>`;
    
    return formatted;
  }
  
  /**
   * Determine if this skill should handle the query
   * @param {string} query User query
   * @param {Object} context Query context
   * @returns {Promise<boolean>} True if skill should run
   */
  async canHandle(query, context) {
    if (!query) return false;
    
    const lowerQuery = query.toLowerCase();
    
    // Financial keywords
    const financialKeywords = /stock price|share price|stock|shares|ticker|market price|trading at|stock quote|equity price/i;
    if (financialKeywords.test(query)) {
      console.log('[YahooFinanceSkill] Financial keywords detected');
      return true;
    }
    
    // Company name patterns followed by financial terms
    const companyFinancePattern = /(what is|what's|get|find|check|look up|show me|tell me).*(price|trading|worth|value|stock|shares)/i;
    if (companyFinancePattern.test(query)) {
      console.log('[YahooFinanceSkill] Company finance query detected');
      return true;
    }
    
    // Specific company names we know
    const knownCompanies = /apple|microsoft|google|amazon|tesla|meta|nvidia|hammond power|netflix|adobe|salesforce|oracle/i;
    if (knownCompanies.test(query) && /price|stock|trading|market/i.test(query)) {
      console.log('[YahooFinanceSkill] Known company with financial terms detected');
      return true;
    }
    
    // Stock symbol patterns (2-5 uppercase letters, optionally with hyphens and exchange suffix)
    const symbolPattern = /\b[A-Z]{2,5}(?:-[A-Z]{1,2})?(?:\.[A-Z]{1,2})?\b/;
    if (symbolPattern.test(query) && /price|quote|trading/i.test(query)) {
      console.log('[YahooFinanceSkill] Stock symbol pattern detected');
      return true;
    }
    
    return false;
  }
}

module.exports = { YahooFinanceSkill };

