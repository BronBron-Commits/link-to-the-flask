// dndbeyond_pdf_to_json.js
// Usage: node dndbeyond_pdf_to_json.js static/dndbeyondexample.pdf

const fs = require('fs');
const pdf = require('pdf-parse');

function extractStat(text, stat) {
  const regex = new RegExp(`${stat}\\s+(\\d+)`);
  const match = text.match(regex);
  return match ? parseInt(match[1]) : null;
}

function extractName(text) {
  // Try to match 'Name: <name>' or similar
  const match = text.match(/Name[:\s]+([A-Za-z0-9'\- ]+)/);
  return match ? match[1].trim() : null;
}

function extractLevel(text) {
  // Try to match 'Level <number>'
  const match = text.match(/Level\\s+(\\d+)/);
  return match ? parseInt(match[1]) : null;
}

function extractAbilities(text) {
  // Example: look for a section 'Features & Traits' and grab lines after it
  const abilities = [];
  const match = text.match(/Features & Traits([\s\S]+?)(?=Equipment|$)/);
  if (match) {
    const lines = match[1].split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.length > 2) abilities.push(line);
    }
  }
  return abilities;
}

function extractInventory(text) {
  // Example: look for 'Equipment' section
  const inventory = [];
  const match = text.match(/Equipment([\s\S]+?)(?=Attacks|$)/);
  if (match) {
    const lines = match[1].split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.length > 2) inventory.push(line);
    }
  }
  return inventory;
}

async function parseCharacterSheet(pdfPath) {
  const dataBuffer = fs.readFileSync(pdfPath);
  const data = await pdf(dataBuffer);
  const text = data.text;

  const character = {
    name: extractName(text),
    core: {
      hp: extractStat(text, 'Hit Points'),
      ac: extractStat(text, 'Armor Class'),
      level: extractLevel(text),
    },
    stats: {
      STR: extractStat(text, 'Strength'),
      DEX: extractStat(text, 'Dexterity'),
      CON: extractStat(text, 'Constitution'),
      INT: extractStat(text, 'Intelligence'),
      WIS: extractStat(text, 'Wisdom'),
      CHA: extractStat(text, 'Charisma'),
    },
    abilities: extractAbilities(text),
    inventory: extractInventory(text),
  };

  return character;
}

if (require.main === module) {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error('Usage: node dndbeyond_pdf_to_json.js <path-to-pdf>');
    process.exit(1);
  }
  parseCharacterSheet(pdfPath).then(character => {
    console.log(JSON.stringify(character, null, 2));
  });
}
