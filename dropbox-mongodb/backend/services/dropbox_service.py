"""
Service for interacting with Dropbox API
"""

import logging
from typing import List, Dict, Any, Optional
import hashlib
import hmac

import dropbox
from dropbox.files import FileMetadata, FolderMetadata
from dropbox.exceptions import ApiError

logger = logging.getLogger(__name__)


class DropboxService:
    """Service for interacting with Dropbox API"""
    
    def __init__(self, access_token: str, app_key: Optional[str] = None, app_secret: Optional[str] = None):
        """
        Initialize Dropbox service
        
        Args:
            access_token: Dropbox access token
            app_key: Dropbox app key (optional, for webhook verification)
            app_secret: Dropbox app secret (optional, for webhook verification)
        """
        self.access_token = access_token
        self.app_key = app_key
        self.app_secret = app_secret
        self.dbx = dropbox.Dropbox(access_token)
        
    async def download_file(self, dropbox_path: str) -> bytes:
        """
        Download file content from Dropbox
        
        Args:
            dropbox_path: Full path in Dropbox
            
        Returns:
            File content as bytes
        """
        try:
            metadata, response = self.dbx.files_download(dropbox_path)
            return response.content
        except ApiError as e:
            logger.error(f"Failed to download {dropbox_path}: {e}")
            raise
    
    async def get_file_metadata(self, dropbox_path: str) -> Dict[str, Any]:
        """
        Get metadata for a file in Dropbox
        
        Returns:
            Dictionary with file metadata
        """
        try:
            metadata = self.dbx.files_get_metadata(dropbox_path)
            
            if isinstance(metadata, FileMetadata):
                return {
                    "id": metadata.id,
                    "name": metadata.name,
                    "path_display": metadata.path_display,
                    "size": metadata.size,
                    "modified": metadata.client_modified,
                    "rev": metadata.rev,
                    "content_hash": metadata.content_hash
                }
            else:
                raise ValueError(f"{dropbox_path} is not a file")
                
        except ApiError as e:
            logger.error(f"Failed to get metadata for {dropbox_path}: {e}")
            raise
    
    async def list_files(
        self,
        folder_path: str = "",
        recursive: bool = False,
        file_types: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """
        List files in a Dropbox folder
        
        Args:
            folder_path: Folder path (empty string for root)
            recursive: Include subfolders
            file_types: Filter by file extensions (e.g., ['pdf', 'docx'])
            
        Returns:
            List of file metadata dictionaries
        """
        files = []
        
        try:
            result = self.dbx.files_list_folder(
                folder_path,
                recursive=recursive
            )
            
            while True:
                for entry in result.entries:
                    if isinstance(entry, FileMetadata):
                        # Filter by file type if specified
                        if file_types:
                            file_ext = entry.name.split('.')[-1].lower() if '.' in entry.name else ''
                            if file_ext not in file_types:
                                continue
                        
                        files.append({
                            "id": entry.id,
                            "name": entry.name,
                            "path_display": entry.path_display,
                            "size": entry.size,
                            "modified": entry.client_modified,
                            "server_modified": entry.server_modified,
                            "rev": entry.rev,
                            "content_hash": entry.content_hash
                        })
                
                if not result.has_more:
                    break
                    
                result = self.dbx.files_list_folder_continue(result.cursor)
            
            logger.info(f"Listed {len(files)} files from {folder_path or 'root'}")
            return files
            
        except ApiError as e:
            logger.error(f"Failed to list files in {folder_path}: {e}")
            raise
    
    def verify_webhook_signature(
        self,
        signature: str,
        body: bytes
    ) -> bool:
        """
        Verify Dropbox webhook signature
        
        Args:
            signature: X-Dropbox-Signature header value
            body: Raw request body
            
        Returns:
            True if signature is valid
        """
        if not self.app_secret:
            logger.warning("App secret not configured, cannot verify webhook signature")
            return False
        
        expected_signature = hmac.new(
            self.app_secret.encode(),
            body,
            hashlib.sha256
        ).hexdigest()
        
        return hmac.compare_digest(signature, expected_signature)
    
    async def get_shared_link(self, dropbox_path: str) -> Optional[str]:
        """Get or create a shared link for a file"""
        try:
            links = self.dbx.sharing_list_shared_links(path=dropbox_path)
            if links.links:
                return links.links[0].url
            
            # Create new shared link
            link = self.dbx.sharing_create_shared_link_with_settings(
                dropbox_path
            )
            return link.url
            
        except ApiError:
            return None
    
    def get_file_extension(self, filename: str) -> str:
        """Extract file extension from filename"""
        if '.' in filename:
            return filename.split('.')[-1].lower()
        return ''
    
    def is_supported_file_type(self, file_type: str) -> bool:
        """Check if file type is supported for processing"""
        supported_types = [
            'pdf', 'docx', 'doc', 'pptx', 'ppt',
            'txt', 'md', 'html', 'htm', 'rtf',
            'xlsx', 'xls', 'csv'
        ]
        return file_type.lower() in supported_types

