const fs = require('fs');
const path = require('path');

const modesDir = path.join(__dirname, '..', 'plugin', 'modes');
const files = fs.readdirSync(modesDir).filter(f => f.endsWith('.json'));

let updated = 0;
for (const file of files) {
  const filePath = path.join(modesDir, file);
  const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (Array.isArray(content.observation_types) && !content.observation_types.includes('correction')) {
    content.observation_types.push('correction');
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n');
    updated++;
  }
}
console.log(`Updated ${updated}/${files.length} mode files`);
