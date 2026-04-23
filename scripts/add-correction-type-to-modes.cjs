const fs = require('fs');
const path = require('path');

const modesDir = path.join(__dirname, '..', 'plugin', 'modes');
const files = fs.readdirSync(modesDir).filter(f => f.endsWith('.json'));

const correctionType = {
  id: 'correction',
  label: 'Correction',
  description: 'Mistake made and corrected by user',
  emoji: '🔴',
  work_emoji: '🔴'
};

let updated = 0;
for (const file of files) {
  const filePath = path.join(modesDir, file);
  const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (Array.isArray(content.observation_types)) {
    // Check if correction already exists (as string or object)
    const hasCorrectionString = content.observation_types.includes('correction');
    const hasCorrectionObject = content.observation_types.some(t => typeof t === 'object' && t.id === 'correction');

    if (!hasCorrectionObject) {
      // Remove bare string if it exists
      if (hasCorrectionString) {
        content.observation_types = content.observation_types.filter(t => t !== 'correction');
      }
      // Add object form
      content.observation_types.push(correctionType);
      fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n');
      updated++;
    }
  }
}
console.log(`Updated ${updated}/${files.length} mode files`);
