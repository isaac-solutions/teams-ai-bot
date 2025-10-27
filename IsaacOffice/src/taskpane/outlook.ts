/*
 * Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
 * See LICENSE in the project root for license information.
 */

/* global document, Office */

// Azure AI Foundry agent endpoint
const AZURE_AGENT_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZURE_OPENAI_API_KEY = process.env.SECRET_AZURE_OPENAI_API_KEY;
const AZURE_OPENAI_DEPLOYMENT_NAME = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;

Office.onReady((info) => {
  if (info.host === Office.HostType.Outlook) {
    document.getElementById("sideload-msg").style.display = "none";
    document.getElementById("app-body").style.display = "flex";
    document.getElementById("run").onclick = runOutlook;
    
    // Add AI functionality buttons
    setupAIFeatures();
  }
});

export async function runOutlook() {
  /**
   * Insert your Outlook code here
   */

  const item = Office.context.mailbox.item;
  let insertAt = document.getElementById("item-subject");
  let label = document.createElement("b").appendChild(document.createTextNode("Subject: "));
  insertAt.appendChild(label);
  insertAt.appendChild(document.createElement("br"));
  insertAt.appendChild(document.createTextNode(item.subject));
  insertAt.appendChild(document.createElement("br"));
}

/**
 * Setup AI features in the task pane
 */
function setupAIFeatures() {
  const appBody = document.getElementById("app-body");
  
  // Create AI section
  const aiSection = document.createElement("div");
  aiSection.innerHTML = `
    <div style="margin-top: 20px; padding: 15px; background-color: #f8f9fa; border-radius: 8px;">
      <h3 style="color: #0078d4; margin-top: 0;">AI Email Assistant</h3>
      <p style="color: #666; font-size: 14px;">Use AI to analyze and respond to emails</p>
      
      <div style="display: flex; flex-direction: column; gap: 10px;">
        <button id="summarize-btn" style="
          background-color: #0078d4; 
          color: white; 
          border: none; 
          padding: 10px 15px; 
          border-radius: 4px; 
          cursor: pointer;
          font-size: 14px;
        ">📝 Summarize Email</button>
        
        <button id="reply-btn" style="
          background-color: #28a745; 
          color: white; 
          border: none; 
          padding: 10px 15px; 
          border-radius: 4px; 
          cursor: pointer;
          font-size: 14px;
        ">✍️ Generate Reply Draft</button>
        
        <button id="tasks-btn" style="
          background-color: #ffc107; 
          color: #333; 
          border: none; 
          padding: 10px 15px; 
          border-radius: 4px; 
          cursor: pointer;
          font-size: 14px;
        ">✅ Extract My Tasks</button>
      </div>
      
      <div id="ai-result" style="
        margin-top: 15px; 
        padding: 10px; 
        background-color: white; 
        border-radius: 4px; 
        border-left: 4px solid #0078d4;
        display: none;
      ">
        <h4 style="margin-top: 0; color: #0078d4;">AI Response:</h4>
        <pre id="ai-output" style="
          white-space: pre-wrap; 
          word-wrap: break-word; 
          font-size: 13px; 
          line-height: 1.4;
          margin: 0;
        "></pre>
        <button id="copy-result" style="
          background-color: #6c757d; 
          color: white; 
          border: none; 
          padding: 5px 10px; 
          border-radius: 3px; 
          cursor: pointer;
          font-size: 12px;
          margin-top: 8px;
        ">Copy Result</button>
      </div>
    </div>
  `;
  
  appBody.appendChild(aiSection);
  
  // Add event listeners
  document.getElementById("summarize-btn").onclick = () => performAIAction("summarize");
  document.getElementById("reply-btn").onclick = () => performAIAction("draft_reply");
  document.getElementById("tasks-btn").onclick = () => performAIAction("extract_tasks");
  document.getElementById("copy-result").onclick = copyResult;
}

/**
 * Perform AI action from task pane
 * @param action The AI action to perform
 */
async function performAIAction(action: string) {
  const resultDiv = document.getElementById("ai-result");
  const outputPre = document.getElementById("ai-output");
  const buttons = document.querySelectorAll("#app-body button");
  
  try {
    // Show loading state
    outputPre.textContent = `Processing ${action}...`;
    resultDiv.style.display = "block";
    buttons.forEach(btn => (btn as HTMLButtonElement).disabled = true);
    
    // Get current email data
    const email = await getCurrentEmail();
    
    // Call Azure AI Foundry agent
    const result = await callAgentAPI(action, email);
    
    // Display result
    outputPre.textContent = result;
    
  } catch (error) {
    console.error("Error performing AI action:", error);
    outputPre.textContent = `Error: ${error.message}`;
    resultDiv.style.display = "block";
  } finally {
    // Re-enable buttons
    buttons.forEach(btn => (btn as HTMLButtonElement).disabled = false);
  }
}

/**
 * Get the current email's data and user information
 */
async function getCurrentEmail(): Promise<any> {
  return new Promise((resolve, reject) => {
    const item = Office.context.mailbox.item;
    
    if (!item) {
      reject(new Error("No email item available"));
      return;
    }

    item.body.getAsync("text", (bodyResult) => {
      if (bodyResult.status === Office.AsyncResultStatus.Succeeded) {
        // Get user information from Office context
        const userProfile = Office.context.mailbox.userProfile;
        
        resolve({
          subject: item.subject,
          from: item.from?.emailAddress,
          body: bodyResult.value,
          user: {
            displayName: userProfile?.displayName || "Unknown User",
            emailAddress: userProfile?.emailAddress || "unknown@example.com"
          }
        });
      } else {
        reject(new Error("Failed to get email body"));
      }
    });
  });
}

/**
 * Call the Azure AI Foundry agent API
 * @param action The action to perform
 * @param email The email data
 */
async function callAgentAPI(action: string, email: any): Promise<string> {
  if (!AZURE_OPENAI_API_KEY) {
    throw new Error("Azure OpenAI API key is missing. Please check environment variables.");
  }

  // Use a working deployment endpoint
  const endpoint = "https://aisaac.cognitiveservices.azure.com/openai/deployments/gpt-4.1-mini/chat/completions?api-version=2024-05-01-preview";

  const systemPrompt = `Role:
You are Isaac, a professional assistant built for Isaac Operations, a consulting company focused on helping organizations unlock the full potential of their existing operations through smart, data-driven problem solving. You support consultants by summarizing communications, drafting professional replies, and extracting actionable tasks from emails.

Company Context:
Isaac Operations is a collection of over one hundred engineers, creators, and innovators who work with clients to simplify the complex, realize untapped potential, and uncover opportunities. From alignment and scoping to trials and implementation, our approach is designed to unlock existing potential in organizations and create lasting impact.
We focus on outcomes, not just solutions — identifying high-impact opportunities and helping clients get more out of the resources they already have.

Your tone should reflect this: clear, professional, concise, and confident — never overly casual or verbose. Responses should sound human, collaborative, and thoughtful.

Behavior Guidelines:
Always operate on the email content and metadata provided.
Never fabricate or infer sender or recipient names, titles, or organizations — only use what's explicitly given.

If user identity is provided (e.g., "requested by John Doe, Senior Consultant, Isaac Operations"), personalize responses to reflect their role.
Assume the user is a consultant preparing insights, drafting communication, or identifying follow-ups related to client work.
When uncertain, clearly indicate that context is missing rather than making assumptions.
Be concise and actionable — prioritize clarity and usability.

Button Action Intents:

Summarize This Email
Provide a structured, professional summary of the email.
Include main points, key decisions, and any actions requested.
Format output as:
Summary:
Key Points:
Next Steps (if any):

Generate Reply Draft:
Draft a clear, professional, and client-appropriate reply.
Use the email body and any user metadata to inform tone and formality.
Keep replies concise and helpful — default to an "Isaac Operations" consulting tone.
If context is missing (e.g., no clear question in the email), prompt the user for clarification rather than guessing.

Extract My Tasks
Identify actionable items directed at the user or their team.
Include who the action is for (if stated), what needs to be done, and any dates/deadlines mentioned.
Format output as a simple task list:
Task description (Due: date if applicable)`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      "api-key": AZURE_OPENAI_API_KEY
    },
    body: JSON.stringify({
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: `Action: ${action}\n\nRequested by: ${email.user.displayName} (${email.user.emailAddress})\n\nEmail Data:\nSubject: ${email.subject}\nFrom: ${email.from}\nBody: ${email.body}`
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`API call failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "No response from AI agent";
}

/**
 * Copy result to clipboard
 */
function copyResult() {
  const outputText = (document.getElementById("ai-output") as HTMLPreElement).textContent;
  
  navigator.clipboard.writeText(outputText).then(() => {
    const button = document.getElementById("copy-result") as HTMLButtonElement;
    const originalText = button.textContent;
    button.textContent = "Copied!";
    button.style.backgroundColor = "#28a745";
    
    setTimeout(() => {
      button.textContent = originalText;
      button.style.backgroundColor = "#6c757d";
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy text: ', err);
    alert('Failed to copy to clipboard');
  });
}
