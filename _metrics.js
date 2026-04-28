const fs = require('fs');
const t = fs.readFileSync('C:/Users/叶晓雯/.claude/skills/copy-workflow/input/research-report.md','utf8');
const dims = ['Target Audience','Pain','Differentiation','Alternative','Marketing Copy','R&D','Competitive Landscape','Keyword','Buyer Journey','Trust Architecture','Investment','ROI','Urgency','Scarcity','Emotional','Usage Scenario','Data Source','Pre-Purchase','Post-Purchase','Purchase Psychology','User Evaluation','Authority','Ingredient','Objection','Brand Story','Brand Architecture'];
const tables = (t.match(/^\| --- /gm) || []).length;
const blockquotes = (t.match(/^> /gm) || []).length;
const para_breaks = (t.match(/\n\n/g) || []).length;
console.log(JSON.stringify({
  char_count: t.length,
  section_count: (t.match(/^## /gm) || []).length,
  references_count: (t.match(/https?:\/\/[^\s\)\)）]+/g) || []).length,
  dimensions_covered: dims.filter(d => t.toLowerCase().includes(d.toLowerCase())).length,
  tables_restored: tables,
  blockquotes: blockquotes,
  paragraph_breaks: para_breaks
}, null, 2));
