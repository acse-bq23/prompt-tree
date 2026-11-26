'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {summarizeRetest} = require('../skills/prompttree/lib/retest.cjs');

test('retest ranks fresh complete rounds and keeps exact ties in frozen order', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'retest-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const write = (f,x)=>fs.writeFileSync(path.join(root,f),JSON.stringify(x));
  const ids = ['a','b','c'];
  const plan = {experiment:'E',metric:'accuracy',split:'validation',rounds:3,candidates:['A','B'].map(id=>({id,version_id:'V-'+id}))};
  const store = {root,events:[],contract:{experiment_id:'E',task:{primary_metric:'accuracy'},split_info:{validation:{count:3,ids}}}};
  const index = {plan:'plan.json',receipts:[]};
  const metric = n => ({numerator:n,denominator:3,value:n/3});
  for (const [i, {id,version_id}] of plan.candidates.entries()) {
    const screen = {run_id:id,request_id:'screen-'+id,version_id,split:'validation',kind:'candidate',status:'succeeded',
      result_path:id+'.json',template_hash:'effective-'+id,metrics:{accuracy:metric(i?3:1)}};
    store.events.push({type:'RESERVED',data:screen},{type:'RESULT',data:screen});
    write(screen.result_path,screen);
    for (let round=1;round<=3;round++) {
      const r={...screen,execution_kind:'real',case_ids:ids,coverage:{expected:3,completed:3,failed:0},request_id:id+round,
        metrics:{accuracy:metric((round+i)%3+1)},usage:{target_calls:1}};
      write(id+round+'.json',r);
      index.receipts.push({round,version_id,result:id+round+'.json'});
    }
  }
  write(index.plan,plan);
  const rank=()=>{write('index.json',index);return summarizeRetest(store,path.join(root,'index.json'));};
  assert.deepEqual(rank().tied,['A','B']);
  assert.equal(rank().selected,'A');
  index.receipts.pop();
  assert.throws(rank,{code:'INVALID_RETEST'});
  index.receipts.push(index.receipts[0]);
  assert.throws(rank,{code:'INVALID_RETEST'});
  index.receipts.pop();
  const stale=JSON.parse(fs.readFileSync(path.join(root,'B3.json')));
  stale.request_id='screen-B';
  write('B3.json',stale);
  index.receipts.push({round:3,version_id:'V-B',result:'B3.json'});
  assert.throws(rank,{code:'INVALID_RETEST'});
});

test('lock tiers use the mean leader, supported requests and the frozen rendered prompts', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'tier-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const write = (f,x)=>fs.writeFileSync(path.join(root,f),JSON.stringify(x));
  const ids = Array.from({length:100},(_,i)=>String(i));
  const gold = ids.map((case_id,i)=>({case_id,expected:i<50?'route':'oos'}));
  const policy = {min_gain_pp:1,false_rejection:{reject_labels:['oos'],min_gain_pp:1}};
  const plan = {experiment:'E',metric:'accuracy',split:'validation',rounds:2,candidates:[],selection_policy:policy};
  const store = {root,contract:{experiment_id:'E',task:{primary_metric:'accuracy'},split_info:{validation:{count:100,ids}}},events:[]};
  const index = {plan:'plan.json',receipts:[]};
  const metric = n=>({numerator:n,denominator:100,value:n/100});
  for (const [id,length,rejections,correct] of [
    ['A',90,[3,3],[90,90]], ['B',100,[1,1],[90,89]], ['C',80,[1,2],[89,90]], ['D',2,[0,0],[89,89]],
  ]) {
    const rendered={messages:[{role:'system',content:'x'.repeat(length)}]};
    const hash=require('../skills/prompttree/lib/core.cjs').hash(rendered);
    const version_id='V-'+hash;
    plan.candidates.push({id,version_id});
    write(id+'-v.json',{rendered});
    const screen = {run_id:id,request_id:'screen-'+id,version_id,split:'validation',status:'succeeded',
      result_path:id+'.json',template_hash:hash,metrics:{accuracy:metric(90)},cases:gold};
    store.events.push({type:'VERSION',data:{version_id,path:id+'-v.json'}},{type:'RESERVED',data:screen},{type:'RESULT',data:screen});
    write(screen.result_path,screen);
    for(let i=0;i<2;i++){
      const cases=gold.map((c,j)=>({...c,prediction:j<rejections[i]?'oos':j<100-correct[i]?'wrong':c.expected}));
      const result=id+i+'.json';
      write(result,{...screen,execution_kind:'real',request_id:id+i,case_ids:ids,coverage:{expected:100,completed:100,failed:0},
        usage:{target_calls:1},metrics:{accuracy:metric(correct[i])},cases});
      index.receipts.push({round:i+1,version_id,result});
    }
  }
  write('index.json',index);
  const rank=()=>{write('plan.json',plan);return summarizeRetest(store,path.join(root,'index.json'));};
  const r=rank();
  assert.deepEqual(r.decision.top_tier,['A','B','C']);
  assert.deepEqual(r.decision.length_finalists,['B']);
  assert.equal(r.selected,'B');
  assert.equal(r.decision.selected_mean,.895);
  assert.deepEqual(r.ranking[1].false_rejection,{rejected:2,supported:100,rate:.02});
  policy.false_rejection.min_gain_pp=1.1;
  assert.equal(rank().selected,'C');
  policy.min_gain_pp=.5;
  assert.equal(rank().selected,'A');
  policy.min_gain_pp=-1;
  assert.throws(rank,{code:'INVALID_RETEST'});
  policy.min_gain_pp=1;
  const file=path.join(root,'B0.json'), broken=JSON.parse(fs.readFileSync(file));
  broken.cases[0].expected='oos';write('B0.json',broken);
  assert.throws(rank,{code:'INVALID_RETEST'});
  delete policy.false_rejection;
  assert.equal(rank().selected,'C');
});
