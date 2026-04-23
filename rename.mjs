import fs from 'fs';
import path from 'path';

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    if (isDirectory) {
      if (f !== 'node_modules' && f !== '.git' && f !== 'dist') {
        walkDir(dirPath, callback);
      }
    } else {
      callback(dirPath);
    }
  });
}

const replacements = [
  { from: /BrainCode/g, to: 'BrainCode' },
  { from: /BrainCode/g, to: 'BrainCode' },
  { from: /BRAINCODE/g, to: 'BRAINCODE' },
  { from: /braincode/g, to: 'braincode' },
  { from: /braincode/g, to: 'braincode' }
];

let updatedFiles = 0;
walkDir('.', (filePath) => {
  if (filePath.endsWith('.ts') || filePath.endsWith('.js') || filePath.endsWith('.json') || filePath.endsWith('.md') || filePath.endsWith('.mjs') || filePath.endsWith('.sh') || filePath.endsWith('.txt')) {
    // skip package-lock.json
    if (filePath.includes('package-lock.json')) return;
    
    let content = fs.readFileSync(filePath, 'utf8');
    let newContent = content;
    for (let r of replacements) {
      newContent = newContent.replace(r.from, r.to);
    }
    if (newContent !== content) {
      fs.writeFileSync(filePath, newContent, 'utf8');
      console.log('Updated: ' + filePath);
      updatedFiles++;
    }
  }
});
console.log('Total files updated: ' + updatedFiles);
