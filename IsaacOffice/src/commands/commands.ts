import { insertBlueParagraphInWord } from "./word";
import { setRangeColorInExcel } from "./excel";
import { insertTextInPowerPoint } from "./powerpoint";
import { setNotificationInOutlook, summarizeEmail, generateReply, extractTasks } from "./outlook";

/* global Office */

// Register the add-in commands with the Office host application.
Office.onReady(async (info) => {
  switch (info.host) {
    case Office.HostType.Word:
      Office.actions.associate("action", insertBlueParagraphInWord);
      break;
    case Office.HostType.Excel:
      Office.actions.associate("action", setRangeColorInExcel);
      break;
    case Office.HostType.PowerPoint:
      Office.actions.associate("action", insertTextInPowerPoint);
      break;
    case Office.HostType.Outlook:
      Office.actions.associate("action", setNotificationInOutlook);
      Office.actions.associate("summarizeEmail", summarizeEmail);
      Office.actions.associate("generateReply", generateReply);
      Office.actions.associate("extractTasks", extractTasks);
      break;
    default: {
      throw new Error(`${info.host} not supported.`);
    }
  }
});
