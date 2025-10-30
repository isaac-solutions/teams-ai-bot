# Career Development Skill - Quick Start

## 🚀 What You Need to Do

### 1. Index Your Development Context (One-Time Setup)

```bash
cd IsaacLLM
node src/indexers/indexCareerDevelopmentContext.js
```

This will find your `Isaac_Dev_RAG_Context_V2 (1).md` file and index all 16+ modules into Azure AI Search.

**Expected Output:**
```
==================================================
Isaac Career Development Context Indexer
==================================================
✅ Found context file: [path]

Parsing modules...
✅ Successfully indexed: LLM ANSWER STYLE
✅ Successfully indexed: WHAT-IS-ISAAC
... (16+ modules)

✅ Indexing complete!
Career Development context is now available!
==================================================
```

### 2. Start Your Bot

```bash
npm start
```

### 3. Test the Skill

Open Microsoft Teams and message Isaac:

**Try these queries:**
- "Help me create a development plan"
- "I need to prepare for my DPR" 
- "What's the hierarchy of competence?"
- "Guide me through working on a behavior-based objective"
- "I want to set milestones for improving my delegation"

## 📋 What Was Created

### New Files:
1. **`src/app/skills/careerDevelopmentSkill.js`**
   - Main skill implementation
   - Detects career dev queries
   - Retrieves RAG context
   - Formats responses per PDA guidelines

2. **`src/indexers/indexCareerDevelopmentContext.js`**
   - One-time setup script
   - Parses `Isaac_Dev_RAG_Context_V2.md`
   - Indexes into Azure AI Search

3. **`CAREER_DEVELOPMENT_SKILL_GUIDE.md`**
   - Comprehensive documentation
   - Architecture details
   - Usage examples
   - Troubleshooting

### Modified Files:
1. **`src/app/app.js`**
   - Added CareerDevelopmentSkill import
   - Integrated skill into router

2. **`src/app/instructions.txt`**
   - Added career development capabilities
   - Included PDA response guidelines
   - Added workflow instructions

## ✨ Key Features

### Automatic Detection
The skill automatically activates when you mention:
- development plan
- DPR (Development Plan Review)
- appraisal
- competency hierarchy
- milestones
- development objectives
- skill/behavior/mindset based

### Structured Responses
Every response follows the proven format:
- **Objective** - Clear focus
- **Stage** - Current competency level
- **What Good Looks Like** - Vision
- **Milestones** - 3-4 with dates
- **DPR Actions** - Specific 2-week tasks
- **Next Steps** - 2-3 decisive actions

### Module Citations
References methodology modules like:
- [[CREATING-A-DEVELOPMENT-PLAN]]
- [[HIERARCHY-OVERVIEW]]
- [[CONSCIOUSLY-INCOMPETENT]]
- [[SKILL-BASED]]

## 🎯 Common Use Cases

### Creating a New Development Plan
```
You: "I just had my appraisal and need to create a development 
      plan for improving my analytical rigor"

Isaac: Guides you through AI-SUGGESTED-WORKFLOW:
       1. Confirms role and working situation
       2. Asks for PRINT Scores/Clifton Strengths
       3. Identifies competency stage
       4. Defines what good looks like
       5. Creates 3-4 milestones
       6. Generates specific DPR actions
       7. Summarizes with next steps
```

### Bi-Weekly DPR Review
```
You: "Let's do my DPR review"

Isaac: 1. Asks about completed/missed actions
       2. Identifies blockers and helps
       3. Generates 3-4 new actions
       4. Suggests next DPR date
```

### Understanding Methodology
```
You: "What are the stages of the competency hierarchy?"

Isaac: Explains all 4 stages with:
       - What each stage means
       - Goals for each stage  
       - Focus areas
       - Cites [[HIERARCHY-OVERVIEW]]
```

### Working on Specific Objectives
```
You: "How do I work on a mindset-based objective?"

Isaac: Retrieves [[MINDSET-BASED]] module:
       - Definition and examples
       - Keys to success
       - Tips & tricks
       - Watch-outs
       - Specific strategies
```

## 🔧 Troubleshooting

### "No relevant development context found"

**Solution:** Run the indexer
```bash
node src/indexers/indexCareerDevelopmentContext.js
```

### Skill not activating

**Solution:** Use explicit keywords:
- ❌ "Help me"
- ✅ "Help me with my development plan"
- ✅ "I need DPR guidance"

### Want to update the methodology

1. Edit `Isaac_Dev_RAG_Context_V2 (1).md`
2. Re-run indexer
3. Changes take effect immediately (no code changes!)

## 📚 Full Documentation

See `CAREER_DEVELOPMENT_SKILL_GUIDE.md` for:
- Detailed architecture
- Complete examples
- Customization options
- Module reference

## ✅ Checklist

- [ ] Run indexer: `node src/indexers/indexCareerDevelopmentContext.js`
- [ ] Verify success (16+ modules indexed)
- [ ] Start bot: `npm start`
- [ ] Test with "Help me create a development plan"
- [ ] Verify response includes module citations like [[MODULE-NAME]]
- [ ] Share with your team!

---

**You're all set!** Your Isaac bot now has the same powerful career development capabilities you've been using in ChatGPT, integrated right into Teams. 🎉

