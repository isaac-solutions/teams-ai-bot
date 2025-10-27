const { BaseSkill } = require('./baseSkill');
const { extractTextFromBuffer, validateFileSize } = require('../../utils/extractText');
const axios = require('axios');

// Maximum file size for uploads (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/**
 * File Processing Skill - Extracts text from uploaded files
 */
class FileProcessingSkill extends BaseSkill {
  constructor() {
    super('file_processing', 'Extract and analyze text content from uploaded documents');
  }
  
  /**
   * Downloads file content from Teams attachment
   * @param {object} attachment - Teams attachment object with contentUrl or content.downloadUrl
   * @returns {Promise<Buffer>} - File content as Buffer
   */
  async downloadFileFromTeams(attachment) {
    try {
      const downloadUrl = attachment.content?.downloadUrl || attachment.contentUrl;
      
      if (!downloadUrl) {
        throw new Error('No download URL available for attachment');
      }
      
      console.log(`[FileProcessingSkill] Downloading: ${attachment.name}`);
      
      const response = await axios.get(downloadUrl, {
        responseType: 'arraybuffer',
        timeout: 30000
      });
      
      console.log(`[FileProcessingSkill] Downloaded ${attachment.name}, size: ${response.data.byteLength} bytes`);
      return Buffer.from(response.data);
    } catch (error) {
      console.error(`[FileProcessingSkill] Download failed for ${attachment.name}:`, error.message);
      throw new Error(`Failed to download file ${attachment.name}: ${error.message}`);
    }
  }

  /**
   * Processes file attachments and extracts text content
   * @param {Array} attachments - Array of Teams attachment objects
   * @returns {Promise<object>} - Object with extracted text and success count
   */
  async processFileAttachments(attachments) {
    const extractedTexts = [];
    let successCount = 0;
    
    for (const attachment of attachments) {
      try {
        const fileBuffer = await this.downloadFileFromTeams(attachment);
        
        if (!validateFileSize(fileBuffer, MAX_FILE_SIZE)) {
          throw new Error(`File exceeds maximum size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
        }
        
        const extractedText = await extractTextFromBuffer(fileBuffer, attachment.name);
        
        if (extractedText.trim()) {
          extractedTexts.push(`--- Content from ${attachment.name} ---\n${extractedText}\n`);
          successCount++;
        }
        
      } catch (error) {
        console.error(`[FileProcessingSkill] Error processing ${attachment.name}:`, error.message);
        extractedTexts.push(`--- Error processing ${attachment.name}: ${error.message} ---\n`);
      }
    }
    
    return {
      text: extractedTexts.join('\n'),
      successCount: successCount,
      totalCount: attachments.length
    };
  }

  /**
   * Execute file processing
   * @param {Object} context Contains attachments array
   * @returns {Promise<Object|null>} Processing results or null if no files
   */
  async execute(context) {
    const { attachments } = context;
    
    if (!attachments || attachments.length === 0) {
      return null;
    }

    // Filter for actual file attachments
    const fileAttachments = attachments.filter(att => {
      return att.contentType === 'application/vnd.microsoft.teams.file.download.info' ||
             (att.name && (att.contentUrl || att.content?.downloadUrl));
    });

    if (fileAttachments.length === 0) {
      return null;
    }

    console.log(`[FileProcessingSkill] Processing ${fileAttachments.length} file(s)`);
    const result = await this.processFileAttachments(fileAttachments);
    
    console.log(`[FileProcessingSkill] Processed ${result.successCount}/${result.totalCount} files successfully`);
    
    return result;
  }
  
  /**
   * File processing runs only when files are present
   */
  async canHandle(query, context) {
    return context.hasFiles === true;
  }
}

module.exports = { FileProcessingSkill };

