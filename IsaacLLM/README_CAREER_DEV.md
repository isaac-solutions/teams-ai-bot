# 🎯 Isaac Career Development Skill

> **Transform your ChatGPT development workflow into an integrated Teams bot capability**

Your proven methodology for creating Development Plans and conducting DPR reviews is now built directly into Isaac bot, powered by RAG over your context file.

---

## 🚀 One-Time Setup (2 minutes)

```bash
cd IsaacLLM
node src/indexers/indexCareerDevelopmentContext.js
npm start
```

That's it! The skill is now active. 🎉

---

## 💬 Try It Out

Open Microsoft Teams and message Isaac:

```
"Help me create a development plan"
"I need to prepare for my DPR"  
"What's the hierarchy of competence?"
"How do I work on a behavior-based objective?"
```

Isaac will guide you through the complete AI-SUGGESTED-WORKFLOW with:
- ✅ Role and situation confirmation
- ✅ Competency stage identification
- ✅ Milestone creation with dates
- ✅ Specific DPR actions
- ✅ Module citations like [[CREATING-A-DEVELOPMENT-PLAN]]
- ✅ Structured Next Steps

---

## 📚 What You Get

### **1. Development Plan Creation**
Turn appraisal feedback into actionable plans
```
Isaac guides you through 9 steps:
1. Confirm role (Consultant, Sr. Consultant, etc.)
2. Understand working situation (Project, Diagnostic, Beach)
3. Gather resources (PRINT Scores, Clifton Strengths)
4. Define Development Objectives
5. Identify competency stage
6. Define "what good looks like"
7. Create 3-4 milestones with dates
8. Generate specific DPR actions
9. Summarize with Next Steps
```

### **2. DPR Support**
Bi-weekly check-ins with progress tracking
```
- Summarize completed ✅, missed ⚠️, adjusted 🔁 actions
- Identify blockers and helps
- Generate 3-4 new actions for next two weeks
- Suggest next DPR date
```

### **3. Competency Navigation**
Understand and progress through stages
```
Unconsciously Incompetent → Recognition & feedback
Consciously Incompetent → Define good, create structures
Consciously Competent → Refine operating system
Unconsciously Competent → Second nature
```

### **4. Objective Strategies**
Type-specific guidance
```
Skill-Based → Study, practice, feedback, refine
Behavior-Based → Awareness, triggers, replacement habits
Mindset-Based → Self-awareness, role models, experiments
```

---

## 🏗️ What Was Built

### **Files Created:**
```
📁 IsaacLLM/
├── 📄 src/app/skills/careerDevelopmentSkill.js       [Core skill]
├── 📄 src/indexers/indexCareerDevelopmentContext.js  [Setup script]
├── 📖 CAREER_DEVELOPMENT_SKILL_GUIDE.md              [Full docs]
├── 📖 CAREER_DEV_QUICKSTART.md                       [Quick start]
├── 📖 CAREER_DEV_IMPLEMENTATION_SUMMARY.md           [Tech details]
└── 📖 README_CAREER_DEV.md                           [This file]
```

### **Files Modified:**
```
✏️ src/app/app.js                [+3 lines - skill integration]
✏️ src/app/instructions.txt      [+50 lines - PDA guidelines]
```

---

## 🎯 Key Features

| Feature | Description |
|---------|-------------|
| **Auto-Detection** | Triggers on 20+ keywords (development plan, DPR, appraisal, etc.) |
| **RAG-Powered** | Retrieves relevant modules from Isaac methodology |
| **Module Citations** | References [[CREATING-A-DEVELOPMENT-PLAN]] style modules |
| **Structured Output** | Objective → Stage → Milestones → Actions → Next Steps |
| **Workflow-Aware** | Adapts to plan creation, DPR review, or methodology questions |
| **Conversational** | Maintains context across your development journey |

---

## 📊 Architecture

```
User Query: "Help me create a development plan"
    ↓
Simple Router evaluates all skills
    ↓
Career Dev Skill detects keywords → Activates
    ↓
Enhances query for better RAG search
    ↓
Azure AI Search retrieves relevant modules
    ↓
Formats context with PDA instructions
    ↓
LLM generates structured guidance
    ↓
You get expert development planning help!
```

---

## 🔧 Maintenance

### Update Methodology
```bash
1. Edit Isaac_Dev_RAG_Context_V2 (1).md
2. Run: node src/indexers/indexCareerDevelopmentContext.js
3. Done! (No code changes needed)
```

### Add Trigger Keywords
```javascript
// Edit: src/app/skills/careerDevelopmentSkill.js
this.triggerKeywords = [
  // ... existing
  'your-new-keyword',
];
```

---

## 📖 Documentation

| Document | Purpose |
|----------|---------|
| **CAREER_DEV_QUICKSTART.md** | 5-minute getting started guide |
| **CAREER_DEVELOPMENT_SKILL_GUIDE.md** | Complete documentation with examples |
| **CAREER_DEV_IMPLEMENTATION_SUMMARY.md** | Technical implementation details |
| **README_CAREER_DEV.md** | This overview |

---

## 🎓 Example Conversation

**You:** "I just had my appraisal and need to create a development plan for improving my stakeholder communication"

**Isaac:** 
```
Great! Let me help you create a structured Development Plan 
using the AI-SUGGESTED-WORKFLOW [[AI-SUGGESTED-WORKFLOW]].

First, let me understand your context:

1. What's your current role at Isaac Operations?
   - Consultant / Sr. Consultant / Lead / Principal / Partner

2. What's your working situation?
   - On Project / Diagnostic / On the Beach

3. How much time can you devote to development weekly?

Do you have any external resources like PRINT Scores or 
Clifton Strengths that might help personalize your plan?
```

**You:** "Sr. Consultant, on a project, about 2-3 hours per week. I have my PRINT scores."

**Isaac:**
```
Perfect! Based on your role and situation [[DEVELOPMENT-AT-ISAAC]], 
let's structure your "Stakeholder Communication" objective.

**Objective:** Improve stakeholder communication and influence

**Current Stage:** Consciously Incompetent 
([[CONSCIOUSLY-INCOMPETENT]])
- You're aware communication could be stronger and experimenting 
  with approaches

**What Good Looks Like (Consciously Competent):**
- Clear, concise updates that land with stakeholders
- Proactive communication before issues escalate  
- Stakeholders actively seek your input
- You can adapt style to different audience types

**Milestones:**
1. **Map Communication Patterns** (Nov 15)
   - Document current state vs ideal state for key stakeholders
   
2. **Create Communication Structures** (Dec 1)
   - Build templates and rhythms for different update types
   
3. **Trial & Refine Consistently** (Dec 22)
   - Use structures across 3+ stakeholder interactions
   
4. **Demonstrate Improvement** (Jan 15)
   - Get positive feedback from lead and stakeholders

**DPR Actions (Next 2 Weeks):**
1. **Daily:** After each stakeholder interaction, note what 
   worked and what didn't (2 min log)
   
2. **Weekly:** Review one example with your lead in WSR - 
   get specific feedback
   
3. **Case-triggered:** Before important updates, prep using 
   "Audience-Message-Medium" framework
   
4. **By Friday:** Share communication patterns doc with lead

**Next Steps:**
1. Start your daily interaction log today
2. Schedule WSR discussion on communication for this week
3. Book next DPR for two weeks from today

Would you like me to help you create a tracking template or 
discuss strategies from [[SKILL-BASED]] for this objective?
```

---

## ✅ Success Checklist

Before rolling out to your team:

- [ ] Run indexer (see 16+ modules indexed)
- [ ] Start bot (see career_development in skills list)
- [ ] Test: "Help me create a development plan"
- [ ] Verify module citations appear [[LIKE-THIS]]
- [ ] Test: "I need DPR support"
- [ ] Test: "What's the hierarchy of competence?"
- [ ] Confirm structured responses (Milestones, Actions, Next Steps)
- [ ] Share Quick Start guide with team

---

## 🎊 Why This Is Better Than ChatGPT

✅ **Integrated** - No context switching, lives in Teams  
✅ **Persistent** - Bot remembers your development journey  
✅ **Hybrid** - Works with uploaded files (appraisals, PRINT scores)  
✅ **Secure** - Your Azure infrastructure, not public ChatGPT  
✅ **Always Updated** - Edit methodology, re-run indexer, done!  
✅ **Multi-modal** - Combines RAG + files + web search  
✅ **Team-wide** - Everyone gets the same expert guidance  

---

## 🚀 Get Started Now

```bash
cd IsaacLLM
node src/indexers/indexCareerDevelopmentContext.js
npm start
```

Then message Isaac: **"Help me create a development plan"**

---

**Questions?** Check `CAREER_DEVELOPMENT_SKILL_GUIDE.md` for complete documentation.

**Need help?** Look for `[CareerDevelopmentSkill]` in logs.

**Happy Developing!** 🎯✨

