/*
 * Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
 * See LICENSE in the project root for license information.
 */

/* global Office */

// Azure AI Foundry agent endpoint
const AZURE_AGENT_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZURE_OPENAI_API_KEY = process.env.SECRET_AZURE_OPENAI_API_KEY;
const AZURE_OPENAI_DEPLOYMENT_NAME = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;

/**
 * Show an outlook notification when the add-in command is executed.
 * @param event
 */
export function setNotificationInOutlook(event: Office.AddinCommands.Event) {
  const message = {
    type: Office.MailboxEnums.ItemNotificationMessageType.InformationalMessage,
    message: "Performed action.",
    icon: "Icon.80x80",
    persistent: true,
  };

  // Show a notification message.
  Office.context.mailbox.item.notificationMessages.replaceAsync("ActionPerformanceNotification", message);

  // Be sure to indicate when the add-in command function is complete.
  event.completed();
}

/**
 * Summarize the current email using AI
 * @param event
 */
export function summarizeEmail(event: Office.AddinCommands.Event) {
  performAIAction("summarize", event);
}

/**
 * Generate a reply draft using AI
 * @param event
 */
export function generateReply(event: Office.AddinCommands.Event) {
  performAIAction("draft_reply", event);
}

/**
 * Extract tasks from the current email using AI
 * @param event
 */
export function extractTasks(event: Office.AddinCommands.Event) {
  performAIAction("extract_tasks", event);
}

/**
 * Common function to perform AI actions
 * @param action The AI action to perform
 * @param event The Office event object
 */
async function performAIAction(action: string, event: Office.AddinCommands.Event) {
  try {
    // Show loading notification
    const loadingMessage = {
      type: Office.MailboxEnums.ItemNotificationMessageType.InformationalMessage,
      message: `Processing ${action}...`,
      icon: "Icon.80x80",
      persistent: true,
    };
    Office.context.mailbox.item.notificationMessages.replaceAsync("AIActionNotification", loadingMessage);

    // Get current email data
    const email = await getCurrentEmail();
    
    // Call Azure AI Foundry agent
    const result = await callAgentAPI(action, email);
    
    // Show result in dialog
    showResponse(result);
    
    // Clear loading notification
    Office.context.mailbox.item.notificationMessages.removeAsync("AIActionNotification");
    
  } catch (error) {
    console.error("Error performing AI action:", error);
    
    // Show error notification
    const errorMessage = {
      type: Office.MailboxEnums.ItemNotificationMessageType.ErrorMessage,
      message: `Error: ${error.message}`,
      icon: "Icon.80x80",
      persistent: true,
    };
    Office.context.mailbox.item.notificationMessages.replaceAsync("AIActionNotification", errorMessage);
  } finally {
    // Always complete the event
    event.completed();
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
 * Show the AI response in a dialog
 * @param result The result to display
 */
function showResponse(result: string) {
  const encodedResult = encodeURIComponent(result);
  const dialogUrl = `${window.location.origin}/dialog.html?result=${encodedResult}`;
  
  Office.context.ui.displayDialogAsync(dialogUrl, {
    height: 60,
    width: 40,
    displayInIframe: true
  }, (asyncResult) => {
    if (asyncResult.status === Office.AsyncResultStatus.Failed) {
      console.error("Failed to open dialog:", asyncResult.error);
      
      // Fallback: show in notification
      const message = {
        type: Office.MailboxEnums.ItemNotificationMessageType.InformationalMessage,
        message: result.substring(0, 200) + (result.length > 200 ? "..." : ""),
        icon: "Icon.80x80",
        persistent: true,
      };
      Office.context.mailbox.item.notificationMessages.replaceAsync("AIResultNotification", message);
    }
  });
}
