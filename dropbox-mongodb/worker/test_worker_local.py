#!/usr/bin/env python3
"""
Local Testing Script for Dropbox Worker

Test docling document conversion locally without Azure dependencies.
Useful for iterating on conversion settings and previewing outputs.

Usage:
    python test_worker_local.py --file "test.pdf"
    python test_worker_local.py --file "test.docx" --output-dir "./output"
    python test_worker_local.py --file "test.pdf" --with-embeddings
"""

import os
import sys
import json
import argparse
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List
from datetime import datetime

# Add parent directory to path if needed
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Import docling
try:
    from docling.document_converter import DocumentConverter
    DOCLING_AVAILABLE = True
except ImportError:
    DOCLING_AVAILABLE = False
    logger.error("Docling not available. Install with: pip install docling")

# Import chunking and tokenization
import tiktoken
from langchain_text_splitters import RecursiveCharacterTextSplitter

# Import OpenAI for embeddings (optional)
try:
    from openai import AsyncAzureOpenAI
    import asyncio
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False
    logger.warning("OpenAI not available. Embedding generation will be skipped.")


class LocalDoclingTester:
    """Local tester for docling conversion"""
    
    def __init__(
        self,
        chunk_size: int = 512,
        chunk_overlap: int = 50,
        openai_api_key: Optional[str] = None,
        azure_endpoint: Optional[str] = None,
        embedding_model: str = "text-embedding-3-large"
    ):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        
        # Initialize docling converter
        self.converter = None
        if DOCLING_AVAILABLE:
            try:
                self.converter = DocumentConverter()
                logger.info("✓ Docling converter initialized")
            except Exception as e:
                logger.error(f"Failed to initialize docling: {e}")
        
        # Initialize tokenizer
        try:
            self.encoding = tiktoken.get_encoding("cl100k_base")
            logger.info("✓ Tokenizer initialized")
        except Exception as e:
            logger.warning(f"Failed to load tokenizer: {e}")
            self.encoding = None
        
        # Initialize OpenAI client (optional)
        self.openai_client = None
        if OPENAI_AVAILABLE and openai_api_key and azure_endpoint:
            try:
                self.openai_client = AsyncAzureOpenAI(
                    api_key=openai_api_key,
                    api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2023-05-15"),
                    azure_endpoint=azure_endpoint
                )
                self.embedding_model = embedding_model
                logger.info("✓ Azure OpenAI client initialized")
            except Exception as e:
                logger.warning(f"Failed to initialize OpenAI client: {e}")
    
    def count_tokens(self, text: str) -> int:
        """Count tokens in text"""
        if self.encoding:
            try:
                return len(self.encoding.encode(text))
            except Exception:
                pass
        return len(text) // 4
    
    def convert_to_markdown(self, file_path: str) -> Optional[str]:
        """Convert document to markdown"""
        if not self.converter:
            logger.error("Docling converter not available")
            return None
        
        try:
            logger.info(f"Converting file to markdown: {file_path}")
            start_time = datetime.now()
            
            # Convert document
            result = self.converter.convert(file_path)
            
            # Export to markdown
            markdown_content = result.document.export_to_markdown()
            
            conversion_time = (datetime.now() - start_time).total_seconds()
            logger.info(f"✓ Conversion completed in {conversion_time:.2f}s")
            logger.info(f"  Markdown length: {len(markdown_content):,} characters")
            logger.info(f"  Estimated tokens: {self.count_tokens(markdown_content):,}")
            
            return markdown_content
            
        except Exception as e:
            logger.error(f"Conversion failed: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def chunk_markdown(self, markdown_content: str) -> List[Dict[str, Any]]:
        """Chunk markdown content"""
        try:
            logger.info("Chunking markdown content...")
            
            text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=self.chunk_size * 4,
                chunk_overlap=self.chunk_overlap * 4,
                length_function=lambda x: self.count_tokens(x),
                separators=[
                    "\n\n## ",
                    "\n\n### ",
                    "\n\n",
                    "\n",
                    ". ",
                    " ",
                    ""
                ]
            )
            
            chunks_text = text_splitter.split_text(markdown_content)
            
            chunks = []
            for idx, chunk_text in enumerate(chunks_text):
                chunk_text = chunk_text.strip()
                if not chunk_text:
                    continue
                
                # Determine chunk type
                chunk_type = "text"
                if "|" in chunk_text and "---" in chunk_text:
                    chunk_type = "table"
                elif chunk_text.startswith("- ") or chunk_text.startswith("* "):
                    chunk_type = "list"
                elif chunk_text.startswith("#"):
                    chunk_type = "heading"
                
                token_count = self.count_tokens(chunk_text)
                
                chunk = {
                    "chunk_index": idx,
                    "content": chunk_text,
                    "token_count": token_count,
                    "char_count": len(chunk_text),
                    "chunk_type": chunk_type
                }
                chunks.append(chunk)
            
            logger.info(f"✓ Created {len(chunks)} chunks")
            
            # Show stats
            token_counts = [c["token_count"] for c in chunks]
            logger.info(f"  Token counts - min: {min(token_counts)}, max: {max(token_counts)}, avg: {sum(token_counts)/len(token_counts):.1f}")
            
            # Show chunk type distribution
            chunk_types = {}
            for c in chunks:
                chunk_types[c["chunk_type"]] = chunk_types.get(c["chunk_type"], 0) + 1
            logger.info(f"  Chunk types: {chunk_types}")
            
            return chunks
            
        except Exception as e:
            logger.error(f"Chunking failed: {e}")
            import traceback
            traceback.print_exc()
            return []
    
    async def generate_embeddings_async(self, chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Generate embeddings for chunks"""
        if not self.openai_client:
            logger.warning("OpenAI client not available, skipping embeddings")
            return chunks
        
        try:
            texts = [chunk["content"] for chunk in chunks]
            logger.info(f"Generating embeddings for {len(texts)} chunks...")
            
            start_time = datetime.now()
            response = await self.openai_client.embeddings.create(
                model=self.embedding_model,
                input=texts
            )
            
            for idx, embedding_data in enumerate(response.data):
                if idx < len(chunks):
                    chunks[idx]["embedding"] = embedding_data.embedding
                    chunks[idx]["embedding_dim"] = len(embedding_data.embedding)
            
            generation_time = (datetime.now() - start_time).total_seconds()
            logger.info(f"✓ Generated embeddings in {generation_time:.2f}s")
            logger.info(f"  Embedding dimensions: {chunks[0]['embedding_dim']}")
            
            return chunks
            
        except Exception as e:
            logger.error(f"Embedding generation failed: {e}")
            import traceback
            traceback.print_exc()
            return chunks
    
    def generate_embeddings(self, chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Synchronous wrapper for embedding generation"""
        if not OPENAI_AVAILABLE or not self.openai_client:
            return chunks
        return asyncio.run(self.generate_embeddings_async(chunks))


def save_output(output_dir: Path, filename: str, markdown: str, chunks: List[Dict[str, Any]]):
    """Save markdown and chunks to output directory"""
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Save markdown
    markdown_path = output_dir / f"{filename}.md"
    with open(markdown_path, "w", encoding="utf-8") as f:
        f.write(markdown)
    logger.info(f"✓ Saved markdown: {markdown_path}")
    
    # Save chunks (without embeddings for readability)
    chunks_for_save = []
    for chunk in chunks:
        chunk_copy = chunk.copy()
        if "embedding" in chunk_copy:
            chunk_copy["embedding"] = f"<{len(chunk_copy['embedding'])} dimensions>"
        chunks_for_save.append(chunk_copy)
    
    chunks_path = output_dir / f"{filename}_chunks.json"
    with open(chunks_path, "w", encoding="utf-8") as f:
        json.dump(chunks_for_save, f, indent=2, ensure_ascii=False)
    logger.info(f"✓ Saved chunks: {chunks_path}")
    
    # Save summary
    summary_path = output_dir / f"{filename}_summary.txt"
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write(f"Document Processing Summary\n")
        f.write(f"{'='*50}\n\n")
        f.write(f"File: {filename}\n")
        f.write(f"Markdown length: {len(markdown):,} characters\n")
        f.write(f"Number of chunks: {len(chunks)}\n\n")
        
        f.write(f"Chunk Statistics:\n")
        f.write(f"-" * 50 + "\n")
        token_counts = [c["token_count"] for c in chunks]
        f.write(f"  Token count - min: {min(token_counts)}, max: {max(token_counts)}, avg: {sum(token_counts)/len(token_counts):.1f}\n")
        
        char_counts = [c["char_count"] for c in chunks]
        f.write(f"  Char count - min: {min(char_counts)}, max: {max(char_counts)}, avg: {sum(char_counts)/len(char_counts):.1f}\n\n")
        
        chunk_types = {}
        for c in chunks:
            chunk_types[c["chunk_type"]] = chunk_types.get(c["chunk_type"], 0) + 1
        f.write(f"Chunk type distribution:\n")
        for chunk_type, count in sorted(chunk_types.items()):
            f.write(f"  {chunk_type}: {count}\n")
        
        f.write(f"\n{'='*50}\n")
        f.write(f"\nFirst 3 chunks preview:\n")
        f.write(f"{'-'*50}\n\n")
        for i, chunk in enumerate(chunks[:3]):
            f.write(f"Chunk {i} ({chunk['chunk_type']}, {chunk['token_count']} tokens):\n")
            preview = chunk['content'][:500]
            if len(chunk['content']) > 500:
                preview += "..."
            f.write(f"{preview}\n\n")
            f.write(f"{'-'*50}\n\n")
    
    logger.info(f"✓ Saved summary: {summary_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Test docling document conversion locally",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--file",
        required=True,
        help="Path to file to process (PDF, DOCX, PPTX, etc.)"
    )
    parser.add_argument(
        "--output-dir",
        default="./test_output",
        help="Output directory for results (default: ./test_output)"
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=512,
        help="Chunk size in tokens (default: 512)"
    )
    parser.add_argument(
        "--chunk-overlap",
        type=int,
        default=50,
        help="Chunk overlap in tokens (default: 50)"
    )
    parser.add_argument(
        "--with-embeddings",
        action="store_true",
        help="Generate embeddings (requires Azure OpenAI env vars)"
    )
    
    args = parser.parse_args()
    
    # Check if file exists
    file_path = Path(args.file)
    if not file_path.exists():
        logger.error(f"File not found: {file_path}")
        sys.exit(1)
    
    logger.info("="*60)
    logger.info("Dropbox Worker Local Tester")
    logger.info("="*60)
    logger.info(f"File: {file_path.name}")
    logger.info(f"Size: {file_path.stat().st_size:,} bytes")
    logger.info(f"Output directory: {args.output_dir}")
    logger.info("-"*60)
    
    # Initialize tester
    openai_key = None
    azure_endpoint = None
    if args.with_embeddings:
        openai_key = os.getenv("OPENAI_API_KEY")
        azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        if not openai_key or not azure_endpoint:
            logger.warning("Azure OpenAI credentials not found in environment")
            logger.warning("Set OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT to generate embeddings")
    
    tester = LocalDoclingTester(
        chunk_size=args.chunk_size,
        chunk_overlap=args.chunk_overlap,
        openai_api_key=openai_key,
        azure_endpoint=azure_endpoint
    )
    
    # Convert to markdown
    logger.info("\n" + "="*60)
    logger.info("Step 1: Converting to Markdown")
    logger.info("="*60)
    markdown = tester.convert_to_markdown(str(file_path))
    if not markdown:
        logger.error("Conversion failed, exiting")
        sys.exit(1)
    
    # Chunk markdown
    logger.info("\n" + "="*60)
    logger.info("Step 2: Chunking Markdown")
    logger.info("="*60)
    chunks = tester.chunk_markdown(markdown)
    if not chunks:
        logger.error("Chunking failed, exiting")
        sys.exit(1)
    
    # Generate embeddings (optional)
    if args.with_embeddings:
        logger.info("\n" + "="*60)
        logger.info("Step 3: Generating Embeddings")
        logger.info("="*60)
        chunks = tester.generate_embeddings(chunks)
    
    # Save outputs
    logger.info("\n" + "="*60)
    logger.info("Saving Results")
    logger.info("="*60)
    output_dir = Path(args.output_dir)
    filename = file_path.stem
    save_output(output_dir, filename, markdown, chunks)
    
    logger.info("\n" + "="*60)
    logger.info("✓ Testing Complete!")
    logger.info("="*60)
    logger.info(f"\nResults saved to: {output_dir.absolute()}")
    logger.info(f"  - {filename}.md (markdown)")
    logger.info(f"  - {filename}_chunks.json (chunks)")
    logger.info(f"  - {filename}_summary.txt (summary)")


if __name__ == "__main__":
    main()

