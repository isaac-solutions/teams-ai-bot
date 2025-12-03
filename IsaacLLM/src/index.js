const fs = require('fs');
const path = require('path');

// Load .localConfigs file if it exists (fallback if env-cmd didn't load it)
function loadLocalConfigs() {
  const configPath = path.join(__dirname, '..', '.localConfigs');
  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, 'utf-8');
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      
      // Parse KEY=VALUE format
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();
        // Only set if not already set (env-cmd takes precedence)
        if (!process.env[key] && value) {
          process.env[key] = value;
        }
      }
    }
  }
}

// Load local configs before requiring app
loadLocalConfigs();

const app = require("./app/app");

// Start the application
(async () => {
  await app.start(process.env.PORT || process.env.port || 3978);
  console.log(`\nAgent started, app listening to`, process.env.PORT || process.env.port || 3978);
})();
