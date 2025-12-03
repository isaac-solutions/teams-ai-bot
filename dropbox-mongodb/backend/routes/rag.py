"""
RAG (Retrieval-Augmented Generation) routes for vector search
"""

import logging
from typing import List
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from openai import AsyncAzureOpenAI

from ..models.rag_models import RAGSearchRequest, RAGSearchResponse, RAGSearchResult

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/rag", tags=["rag"])


# Dependency to get MongoDB database
async def get_database() -> AsyncIOMotorClient:
    """Get MongoDB database instance"""
    from ..main import app
    return app.state.db


# Dependency to get OpenAI client
async def get_openai_client() -> AsyncAzureOpenAI:
    """Get OpenAI client instance"""
    from ..main import app
    return app.state.openai_client


@router.post("/search", response_model=RAGSearchResponse)
async def search(
    search_request: RAGSearchRequest,
    db = Depends(get_database),
    openai_client: AsyncAzureOpenAI = Depends(get_openai_client)
):
    """
    Search for relevant document chunks using vector similarity
    
    This endpoint:
    1. Generates an embedding for the query text
    2. Performs vector similarity search in MongoDB
    3. Returns ranked results with source file metadata
    """
    try:
        start_time = datetime.now()
        
        logger.info(f"RAG search query: {search_request.query[:100]}...")
        
        # Generate query embedding
        try:
            response = await openai_client.embeddings.create(
                model=openai_client._custom_query.get("deployment_name", "text-embedding-3-large"),
                input=[search_request.query]
            )
            query_embedding = response.data[0].embedding
            logger.info(f"Generated query embedding with {len(query_embedding)} dimensions")
        except Exception as e:
            logger.error(f"Failed to generate query embedding: {e}")
            raise HTTPException(status_code=500, detail="Failed to generate query embedding")
        
        # Build aggregation pipeline for vector search
        pipeline = []
        
        # Vector search stage (MongoDB Atlas Search)
        vector_search_stage = {
            "$search": {
                "index": "vector_index",  # Ensure this index exists in MongoDB Atlas
                "knnBeta": {
                    "vector": query_embedding,
                    "path": "embedding",
                    "k": search_request.top_k * 2  # Get more results for filtering
                }
            }
        }
        pipeline.append(vector_search_stage)
        
        # Add score
        pipeline.append({
            "$addFields": {
                "score": {"$meta": "searchScore"}
            }
        })
        
        # Join with file metadata
        pipeline.append({
            "$lookup": {
                "from": "dropbox_files",
                "localField": "file_id",
                "foreignField": "_id",
                "as": "file_info"
            }
        })
        
        # Unwind file info
        pipeline.append({"$unwind": "$file_info"})
        
        # Filter by file types if specified
        if search_request.file_types:
            pipeline.append({
                "$match": {
                    "file_info.file_type": {"$in": search_request.file_types}
                }
            })
        
        # Filter by file IDs if specified
        if search_request.file_ids:
            file_object_ids = [ObjectId(fid) for fid in search_request.file_ids]
            pipeline.append({
                "$match": {
                    "file_info._id": {"$in": file_object_ids}
                }
            })
        
        # Filter by minimum score if specified
        if search_request.min_score is not None:
            pipeline.append({
                "$match": {
                    "score": {"$gte": search_request.min_score}
                }
            })
        
        # Limit results
        pipeline.append({"$limit": search_request.top_k})
        
        # Project fields
        projection = {
            "$project": {
                "_id": 1,
                "file_id": 1,
                "chunk_index": 1,
                "score": 1,
                "metadata": 1,
                "filename": "$file_info.filename",
                "file_type": "$file_info.file_type",
                "dropbox_path": "$file_info.dropbox_path"
            }
        }
        
        # Include content if requested
        if search_request.include_content:
            projection["$project"]["content"] = 1
        
        pipeline.append(projection)
        
        # Execute search
        try:
            cursor = db.dropbox_chunks.aggregate(pipeline)
            results = await cursor.to_list(length=search_request.top_k)
        except Exception as e:
            logger.error(f"Vector search failed: {e}")
            # Fallback to simple search if vector index doesn't exist
            logger.warning("Falling back to text search")
            results = await fallback_text_search(
                db,
                search_request.query,
                search_request.top_k,
                search_request.file_types,
                search_request.file_ids,
                search_request.include_content
            )
        
        # Convert to response models
        search_results = []
        for result in results:
            search_results.append(RAGSearchResult(
                chunk_id=str(result["_id"]),
                file_id=str(result["file_id"]),
                filename=result.get("filename", "Unknown"),
                file_type=result.get("file_type", "unknown"),
                dropbox_path=result.get("dropbox_path", ""),
                chunk_index=result["chunk_index"],
                content=result.get("content") if search_request.include_content else None,
                score=result.get("score", 0.0),
                metadata=result.get("metadata", {})
            ))
        
        search_time = (datetime.now() - start_time).total_seconds() * 1000
        
        logger.info(f"RAG search completed: {len(search_results)} results in {search_time:.2f}ms")
        
        return RAGSearchResponse(
            query=search_request.query,
            results=search_results,
            total_results=len(search_results),
            search_time_ms=search_time
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"RAG search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def fallback_text_search(
    db,
    query: str,
    top_k: int,
    file_types: List[str] = None,
    file_ids: List[str] = None,
    include_content: bool = True
) -> List[dict]:
    """
    Fallback text search when vector index is not available
    Uses MongoDB text search on content field
    """
    try:
        # Build filter
        filters = {}
        
        if file_types or file_ids:
            # Need to join with files to filter
            pipeline = []
            
            # Join with files
            pipeline.append({
                "$lookup": {
                    "from": "dropbox_files",
                    "localField": "file_id",
                    "foreignField": "_id",
                    "as": "file_info"
                }
            })
            pipeline.append({"$unwind": "$file_info"})
            
            # Apply filters
            match_filters = {}
            if file_types:
                match_filters["file_info.file_type"] = {"$in": file_types}
            if file_ids:
                file_object_ids = [ObjectId(fid) for fid in file_ids]
                match_filters["file_info._id"] = {"$in": file_object_ids}
            
            if match_filters:
                pipeline.append({"$match": match_filters})
            
            # Text search on content
            pipeline.append({
                "$match": {
                    "content": {"$regex": query, "$options": "i"}
                }
            })
            
            # Project fields
            projection = {
                "_id": 1,
                "file_id": 1,
                "chunk_index": 1,
                "metadata": 1,
                "filename": "$file_info.filename",
                "file_type": "$file_info.file_type",
                "dropbox_path": "$file_info.dropbox_path",
                "score": {"$literal": 0.5}  # Default score for text search
            }
            if include_content:
                projection["content"] = 1
            
            pipeline.append({"$project": projection})
            pipeline.append({"$limit": top_k})
            
            cursor = db.dropbox_chunks.aggregate(pipeline)
            results = await cursor.to_list(length=top_k)
        else:
            # Simple text search without filters
            filters["content"] = {"$regex": query, "$options": "i"}
            
            cursor = db.dropbox_chunks.find(filters).limit(top_k)
            chunks = await cursor.to_list(length=top_k)
            
            # Fetch file info for each chunk
            results = []
            for chunk in chunks:
                file = await db.dropbox_files.find_one({"_id": chunk["file_id"]})
                result = {
                    "_id": chunk["_id"],
                    "file_id": chunk["file_id"],
                    "chunk_index": chunk["chunk_index"],
                    "metadata": chunk.get("metadata", {}),
                    "filename": file.get("filename", "Unknown") if file else "Unknown",
                    "file_type": file.get("file_type", "unknown") if file else "unknown",
                    "dropbox_path": file.get("dropbox_path", "") if file else "",
                    "score": 0.5
                }
                if include_content:
                    result["content"] = chunk.get("content", "")
                results.append(result)
        
        return results
        
    except Exception as e:
        logger.error(f"Fallback text search failed: {e}")
        return []


@router.get("/health")
async def health_check(db = Depends(get_database)):
    """Health check endpoint for RAG service"""
    try:
        # Check MongoDB connection
        await db.command("ping")
        
        # Get stats
        file_count = await db.dropbox_files.count_documents({})
        chunk_count = await db.dropbox_chunks.count_documents({})
        completed_count = await db.dropbox_files.count_documents({"processing_status": "completed"})
        
        return {
            "status": "healthy",
            "database": "connected",
            "stats": {
                "total_files": file_count,
                "completed_files": completed_count,
                "total_chunks": chunk_count
            }
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(status_code=503, detail="Service unhealthy")

