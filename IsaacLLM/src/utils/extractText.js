const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { simpleParser } = require('mailparser');

/**
 * Extracts text content from various file formats in memory
 * Supports PDF, DOCX, TXT, and email files (EML)
 * 
 * @param {Buffer} fileBuffer - The file content as a Buffer
 * @param {string} fileName - The original file name with extension
 * @returns {Promise<string>} - Extracted text content
 */
async function extractTextFromBuffer(fileBuffer, fileName) {
  if (!fileBuffer || !fileName) {
    throw new Error('File buffer and filename are required');
  }

  const fileExtension = fileName.toLowerCase().split('.').pop();
  
  try {
    switch (fileExtension) {
      case 'pdf':
        return await extractTextFromPDF(fileBuffer);
      
      case 'docx':
        return await extractTextFromDOCX(fileBuffer);
      
      case 'txt':
        return extractTextFromTXT(fileBuffer);
      
      case 'eml':
        return await extractTextFromEML(fileBuffer);
      
      default:
        throw new Error(`Unsupported file type: ${fileExtension}. Supported types: PDF, DOCX, TXT, EML`);
    }
  } catch (error) {
    throw new Error(`Failed to extract text from ${fileName}: ${error.message}`);
  }
}

/**
 * Extracts text from PDF buffer using pdf-parse
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @returns {Promise<string>} - Extracted text
 */
async function extractTextFromPDF(pdfBuffer) {
  try {
    const data = await pdfParse(pdfBuffer);
    return data.text || '';
  } catch (error) {
    throw new Error(`PDF parsing failed: ${error.message}`);
  }
}

/**
 * Extracts text from DOCX buffer using mammoth
 * @param {Buffer} docxBuffer - DOCX file buffer
 * @returns {Promise<string>} - Extracted text
 */
async function extractTextFromDOCX(docxBuffer) {
  try {
    const result = await mammoth.extractRawText({ buffer: docxBuffer });
    return result.value || '';
  } catch (error) {
    throw new Error(`DOCX parsing failed: ${error.message}`);
  }
}

/**
 * Extracts text from TXT buffer
 * @param {Buffer} txtBuffer - TXT file buffer
 * @returns {string} - Extracted text
 */
function extractTextFromTXT(txtBuffer) {
  try {
    return txtBuffer.toString('utf-8');
  } catch (error) {
    throw new Error(`TXT parsing failed: ${error.message}`);
  }
}

/**
 * Validates file size against maximum allowed size
 * @param {Buffer} fileBuffer - File buffer to validate
 * @param {number} maxSizeBytes - Maximum size in bytes (default: 5MB)
 * @returns {boolean} - True if file size is valid
 */
function validateFileSize(fileBuffer, maxSizeBytes = 5 * 1024 * 1024) {
  return fileBuffer.length <= maxSizeBytes;
}

/**
 * Extracts text from EML (email) buffer using mailparser
 * @param {Buffer} emlBuffer - EML file buffer
 * @returns {Promise<string>} - Extracted email content
 */
async function extractTextFromEML(emlBuffer) {
  try {
    const parsed = await simpleParser(emlBuffer);
    
    const emailContent = [];
    
    // Add email headers
    if (parsed.from) {
      emailContent.push(`From: ${parsed.from.text}`);
    }
    if (parsed.to) {
      emailContent.push(`To: ${parsed.to.text}`);
    }
    if (parsed.cc) {
      emailContent.push(`CC: ${parsed.cc.text}`);
    }
    if (parsed.subject) {
      emailContent.push(`Subject: ${parsed.subject}`);
    }
    if (parsed.date) {
      emailContent.push(`Date: ${parsed.date}`);
    }
    
    emailContent.push(''); // Empty line separator
    
    // Add email body
    if (parsed.text) {
      emailContent.push('Email Content:');
      emailContent.push(parsed.text);
    }
    
    if (parsed.html) {
      emailContent.push(''); // Empty line separator
      emailContent.push('HTML Content:');
      // Strip HTML tags for plain text
      const htmlText = parsed.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      emailContent.push(htmlText);
    }
    
    return emailContent.join('\n');
  } catch (error) {
    throw new Error(`EML parsing failed: ${error.message}`);
  }
}

/**
 * Gets supported file extensions
 * @returns {string[]} - Array of supported file extensions
 */
function getSupportedExtensions() {
  return ['pdf', 'docx', 'txt', 'eml'];
}

module.exports = {
  extractTextFromBuffer,
  validateFileSize,
  getSupportedExtensions
};
