const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../extension/core.js');
const sentences = [{id:'s0',text:'We modify code.',language:'en'}];
const translations = [{id:'t0',text:'背景介绍。我们修改代码，然后评估。',sourceIds:['s0']}];
const annotation = {id:'s0',role:'mechanism',priority:'core',reason:'关键方法。',matches:[{id:'t0',quote:'我们修改代码，然后评估。'}]};
test('translation spans inherit the source decision and locate exact visible quotes', () => {
 const rows = core.parseAnnotations(JSON.stringify({annotations:[annotation]}), sentences, translations);
 assert.deepEqual(rows[0].matches,[{id:'t0',quote:'我们修改代码，然后评估。',start:5,end:17}]);
 const messages=core.buildMessages({},sentences,[],translations);
 assert.deepEqual(JSON.parse(messages[1].content).translations.map(({segments,...target})=>target),translations);
 assert.match(messages[0].content,/沿用英文/);
});
test('alignment rejects fabricated, ambiguous or unrelated Chinese matches', () => {
 for (const targets of [translations,[{...translations[0],text:'我们修改代码，然后评估。我们修改代码，然后评估。'}],[{...translations[0],sourceIds:['other']}],[]]) {
  const bad = {...annotation,matches:[{id:'t0',quote:targets===translations?'不存在':annotation.matches[0].quote}]};
  const rows=core.parseAnnotations(JSON.stringify({annotations:[bad]}),sentences,targets);
  assert.equal(rows[0].priority,'core');
  assert.deepEqual(rows[0].matches,[]);
 }
 assert.deepEqual(core.parseAnnotations(JSON.stringify({annotations:[{...annotation,matches:undefined}]}),sentences,translations)[0].matches,[]);
});

test('conflicting source decisions cannot claim overlapping Chinese spans', () => {
 const sources=[...sentences,{id:'s1',text:'We do not train models.'}];
 const targets=[{...translations[0],sourceIds:['s0','s1']}];
 const rows=[annotation,{...annotation,id:'s1',role:'limitation',reason:'边界。'}];
 const parsed=core.parseAnnotations(JSON.stringify({annotations:rows}),sources,targets);
 assert.ok(parsed.every(row=>row.matches.length===0));
 assert.deepEqual(parsed.map(row=>row.role),['mechanism','limitation']);
});

test('whitespace variations locate actual DOM offsets while altered wording stays unmarked', () => {
 const target={...translations[0],text:'背景。我们 修改代码，\u00a0然后评估。'};
 const parsed=core.parseAnnotations(JSON.stringify({annotations:[annotation]}),sentences,[target]);
 assert.deepEqual(parsed[0].matches,[{id:'t0',quote:'我们 修改代码，\u00a0然后评估。',start:3,end:17}]);
 const bad={...annotation,matches:[{id:'t0',quote:'我们重写代码，然后评估。'},null]};
 assert.deepEqual(core.parseAnnotations(JSON.stringify({annotations:[bad]}),sentences,[target])[0].matches,[]);
});

test('non-core translation suggestions cannot erase a valid core highlight',()=>{
 const sources=[...sentences,{id:'s1',text:'Background.'}];
 const targets=[{...translations[0],sourceIds:['s0','s1']}];
 const rows=core.parseAnnotations(JSON.stringify({annotations:[annotation,{...annotation,id:'s1',priority:'background'}]}),sources,targets);
 assert.equal(rows[0].matches.length,1);assert.equal(rows[1].matches.length,0);
});

test('Chinese sentence IDs locate repeated text without asking the model to copy it',()=>{
 const target={...translations[0],text:'我们修改代码。我们修改代码。'};
 const options=core.translationSegments(target);
 assert.equal(options.length,2);
 const row={...annotation,matches:[{id:'t0',sentenceIds:[options[1].id]}]};
 const result=core.parseAnnotations(JSON.stringify({annotations:[row]}),sentences,[target]);
 assert.deepEqual(result[0].matches,[{id:'t0',quote:'我们修改代码。',start:7,end:14}]);
 assert.equal(result[0].alignmentIssues,0);
 const payload=JSON.parse(core.buildMessages({},sentences,[],[target])[1].content);
 assert.equal(payload.translations[0].segments[1].id,options[1].id);
});
