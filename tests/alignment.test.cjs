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
 assert.deepEqual(JSON.parse(messages[1].content).translations,translations);
 assert.match(messages[0].content,/沿用英文/);
});
test('alignment rejects fabricated, ambiguous or unrelated Chinese matches', () => {
 for (const targets of [translations,[{...translations[0],text:'我们修改代码，然后评估。我们修改代码，然后评估。'}],[{...translations[0],sourceIds:['other']}],[]]) {
  const bad = {...annotation,matches:[{id:'t0',quote:targets===translations?'不存在':annotation.matches[0].quote}]};
  assert.throws(()=>core.parseAnnotations(JSON.stringify({annotations:[bad]}),sentences,targets),/对应/);
 }
 assert.throws(()=>core.parseAnnotations(JSON.stringify({annotations:[{...annotation,matches:undefined}]}),sentences,translations),/对应/);
});

test('conflicting source decisions cannot claim overlapping Chinese spans', () => {
 const sources=[...sentences,{id:'s1',text:'We do not train models.'}];
 const targets=[{...translations[0],sourceIds:['s0','s1']}];
 const rows=[annotation,{...annotation,id:'s1',role:'limitation',reason:'边界。'}];
 assert.throws(()=>core.parseAnnotations(JSON.stringify({annotations:rows}),sources,targets),/重叠/);
});
