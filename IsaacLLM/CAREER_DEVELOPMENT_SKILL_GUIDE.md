# Isaac Career Development Skill

## Overview

The Career Development Skill is a specialized RAG-based capability that helps Isaac consultants create, manage, and execute professional Development Plans. It implements the proven methodology you've successfully used in ChatGPT, now integrated directly into the IsaacLLM bot.

## What It Does

The skill acts as your **Isaac Professional Development Assistant (PDA)** and helps with:

1. **Creating Development Plans** - Turn appraisal feedback into structured, actionable plans
2. **DPR Support** - Generate specific actions for bi-weekly Development Plan Reviews
3. **Progress Tracking** - Monitor milestones and adjust plans based on progress
4. **Competency Navigation** - Guide you through the hierarchy of competence stages
5. **Objective Analysis** - Help identify if objectives are Skill, Behavior, or Mindset-based

## Key Features

- **Smart Activation**: Automatically detects career development queries using keywords like "development plan", "DPR", "appraisal", "competency", "milestone"
- **Structured Workflow**: Follows the AI-SUGGESTED-WORKFLOW from your RAG context
- **Module References**: Cites specific methodology modules like [[CREATING-A-DEVELOPMENT-PLAN]]
- **Context-Aware**: Adapts responses based on whether you're creating a new plan or reviewing progress

## Setup Instructions

### Step 1: Index the Development Context

The skill requires the Isaac Development RAG Context to be indexed in Azure AI Search. Run the indexing script:

```bash
cd IsaacLLM
node src/indexers/indexCareerDevelopmentContext.js
```

The script will:
- Find your `Isaac_Dev_RAG_Context_V2.md` file
- Parse it into 16+ searchable modules
- Generate embeddings using Azure OpenAI
- Upload to your Azure AI Search index with category `career-development`

**Prerequisites:**
- Azure AI Search configured in `.localConfigs`
- Azure OpenAI embeddings deployment configured
- `Isaac_Dev_RAG_Context_V2 (1).md` file in project root

### Step 2: Verify Installation

The skill is already integrated into `app.js`. When the bot starts, you should see:

```
[SimpleRouter] Initialized with 4 skills: career_development, rag_search, file_processing, web_search
```

### Step 3: Test the Skill

Ask Isaac questions like:
- "Help me create a development plan"
- "I need to prepare for my DPR"
- "What's the hierarchy of competence?"
- "How do I work on a behavior-based objective?"
- "Guide me through creating milestones"

## How It Works

### Architecture

```
User Query
    ↓
SimpleRouter (evaluates all skills)
    ↓
CareerDevelopmentSkill.canHandle()
    ↓ (if career dev query detected)
CareerDevelopmentSkill.execute()
    ↓
Azure AI Search (RAG query with enhanced terms)
    ↓
Format context with workflow instructions
    ↓
LLM generates structured response
```

### Query Detection

The skill activates when it detects:

**Trigger Keywords:**
- development plan, development objective, DPR
- appraisal, competency, milestone
- hierarchy of competence stages
- skill/behavior/mindset based
- failure mode, workstream review (WSR)

**Common Patterns:**
- "How do I create/build/make..."
- "Help me with..."
- "What is my..."
- "Guide me through..."

### Response Structure

The skill formats responses according to the PDA guidelines:

```
**Objective:** Clear statement of the development focus
**Stage:** Current competency hierarchy stage (with rationale)
**What Good Looks Like:** Vision for the next stage
**Milestones:** 3-4 numbered items with target dates
**DPR Actions (next 2 weeks):** Specific, observable tasks
**Reflection Focus:** Key questions to consider
**Next Steps:** 2-3 decisive actions
```

## Usage Examples

### Example 1: Creating a New Development Plan

**User:** "I just had my appraisal and need help creating a development plan for improving my stakeholder communication"

**Bot Response:**
```
Let me help you create a structured Development Plan! First, I need to understand your context:

1. What's your current role at Isaac Operations?
   - Consultant
   - Sr. Consultant
   - Lead Consultant
   - Principal Consultant
   - Other

2. What's your current working situation?
   - On a Project
   - On a Diagnostic
   - In between Projects "On the Beach"
   - Other

3. How much time can you devote to development over the next two weeks?

Also, do you have any external resources like PRINT Scores or Clifton Strengths that might help personalize your plan?
```

### Example 2: DPR Check-In

**User:** "Let's do my bi-weekly DPR review"

**Bot Response:**
```
Great! Let's review your progress. For this DPR Check-In, I need to know:

**Actions from Last DPR:**
- What actions did you complete? ✅
- What did you miss or adjust? ⚠️🔁
- What were the key blockers or helps?

**Progress Update:**
- Any breakthroughs or insights?
- Where are you stuck?

Once I understand your progress, I'll:
1. Summarize completed/missed/adjusted actions
2. Highlight helps, blockers, and learnings
3. Generate 3-4 new DPR actions for the next two weeks
4. Suggest the next DPR date

What actions have you been working on?
```

### Example 3: Understanding Competency Stages

**User:** "What's the hierarchy of competence?"

**Bot Response:**
```
The Hierarchy of Competence [[HIERARCHY-OVERVIEW]] is a model that explains the four stages we go through when learning any new skill:

**1. Unconsciously Incompetent**
- You don't know what you don't know
- Goal: Become aware of the gap
- Focus: Recognition and feedback systems

**2. Consciously Incompetent**
- You're aware of the gap and experimenting
- Goal: Develop working structures
- Focus: Define "what good looks like", identify failure modes, create support structures

**3. Consciously Competent**
- You can do it, but it requires effort and structures
- Goal: Lock in progress, reduce upkeep
- Focus: Refine operating system, make it second nature

**4. Unconsciously Competent**
- It's second nature, automatic
- Goal: Maintain and teach others
- Focus: Sustained excellence

**Next Steps:**
1. Identify which stage you're in for your current Development Objective
2. Review the specific module for that stage (e.g., [[CONSCIOUSLY-INCOMPETENT]])
3. Let me know which objective you're working on and I'll help you build a plan!
```

## Module Reference

The skill can retrieve and cite from these context modules:

**Governance:**
- LLM ANSWER STYLE

**Core Development:**
- WHAT-IS-ISAAC
- ISAAC-STRUCTURES
- DEVELOPMENT-AT-ISAAC
- CREATING-A-DEVELOPMENT-PLAN
- AI-SUGGESTED-WORKFLOW

**Competency Hierarchy:**
- HIERARCHY-OVERVIEW
- UNCONSCIOUSLY-INCOMPETENT
- CONSCIOUSLY-INCOMPETENT
- CONSCIOUSLY-COMPETENT

**Development Objectives:**
- WORKING-THROUGH-OBJECTIVES
- SKILL-BASED
- BEHAVIOUR-BASED
- MINDSET-BASED

**Examples:**
- EXAMPLE-MILESTONES
- EXAMPLE-DPR-ACTIONS

## Troubleshooting

### Skill Not Activating

If the skill doesn't activate for development queries:

1. **Check logs** - Look for `[CareerDevelopmentSkill] Activated for development query`
2. **Use explicit keywords** - Include "development plan" or "DPR" in your query
3. **Verify indexing** - Run the indexer script to ensure documents are in search index

### No Context Retrieved

If skill activates but finds no context:

```bash
# Re-run the indexer
node src/indexers/indexCareerDevelopmentContext.js

# Check Azure AI Search in Azure Portal
# Verify documents with category='career-development' exist
```

### Response Not Following PDA Format

The system instructions guide the LLM on formatting. If responses aren't structured:

1. Check `instructions.txt` has the career development section
2. Ensure the context wrapper in `careerDevelopmentSkill.js` is being applied
3. Try more specific queries (e.g., "Create a development plan for..." vs "Help")

## Customization

### Add New Trigger Keywords

Edit `careerDevelopmentSkill.js`:

```javascript
this.triggerKeywords = [
  'development plan',
  'your-new-keyword',
  // ... existing keywords
];
```

### Modify Workflow Instructions

Edit the `formatCareerDevelopmentContext()` method to adjust how the skill frames responses for different query types.

### Update Context Modules

1. Edit `Isaac_Dev_RAG_Context_V2.md`
2. Re-run the indexer: `node src/indexers/indexCareerDevelopmentContext.js`
3. The skill will now retrieve updated content

## Maintenance

### Updating the Context

When Isaac's development methodology changes:

1. Update `Isaac_Dev_RAG_Context_V2.md` with new content
2. Run the indexer to update the search index
3. No code changes needed - RAG handles the rest!

### Adding New Features

The skill is designed to be extensible:
- Add new `canHandle()` conditions for different query types
- Enhance `enhanceQueryForRAG()` for better retrieval
- Modify `formatCareerDevelopmentContext()` for custom formatting

## Benefits Over ChatGPT

- **Integrated**: No context switching, works right in Teams
- **Persistent**: Bot remembers your conversation and progress
- **Hybrid**: Can combine with file uploads (appraisal docs, PRINT scores)
- **Secured**: Uses your company's Azure infrastructure
- **Customizable**: Tailored to Isaac's exact methodology

## Next Steps

1. ✅ Run the indexer: `node src/indexers/indexCareerDevelopmentContext.js`
2. ✅ Start the bot: `npm start`
3. ✅ Test with a development query
4. ✅ Share with your team!

---

**Questions or Issues?**
Check the logs for `[CareerDevelopmentSkill]` messages or review the code in `src/app/skills/careerDevelopmentSkill.js`.

