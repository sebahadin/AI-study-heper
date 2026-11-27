import {expect} from 'chai';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import {randomUUID} from 'node:crypto';
import {createApp} from '../../src/app.mjs';
import {User,Note,Book,Course,Conversation,ChatQuota,StudyArtifact} from '../../src/db.mjs';
import {createIndexingJob} from '../../src/documents/indexing-policy.mjs';
import {StudyScopeResolver} from '../../src/retrieval/scope.mjs';
import {StudySearchService} from '../../src/retrieval/service.mjs';
import {ChatRepository} from '../../src/chat/repository.mjs';
import {ChatService} from '../../src/chat/service.mjs';
import {StudyRepository} from '../../src/study-tools/repository.mjs';
import {StudyService} from '../../src/study-tools/service.mjs';
const integration=process.env.TEST_DSN?describe:describe.skip;
const events=response=>response.text.split('\n\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));
describe('Study tools authentication',()=>{it('requires Passport for every draft/library and confirmation endpoint',async()=>{
 const app=createApp(),id=new mongoose.Types.ObjectId();
 for(const path of ['/api/study-tools','/api/study-tools/config',`/api/study-tools/${id}`,`/api/study-tools/${id}/practice`]){await request(app).get(path).expect(401);}
 for(const suffix of ['','/generate','/confirmations','/actions','/feedback']){await request(app).post(`/api/study-tools/${id}${suffix}`).send({}).expect(401);}
});});
integration('Confirmed AI study sets (requires TEST_DSN)',()=>{
 let alice,bob,user,other,search,chat,service,repo,client,ref,passage,now,course,book,calls;
 before(async()=>{if(!new URL(process.env.TEST_DSN).pathname.endsWith('_test')){throw new Error('Use a disposable test database.');}await mongoose.connect(process.env.TEST_DSN);});
 after(async()=>{await mongoose.connection.dropDatabase();await mongoose.disconnect();});
 beforeEach(async()=>{
  await Promise.all([User,Note,Book,Course,Conversation,ChatQuota,StudyArtifact].map(model=>model.deleteMany({})));now=new Date();calls=0;
  const password=await bcrypt.hash('test-password123',4);[user,other]=await User.create([{username:'tools-student',email:'tools@example.test',password},{username:'tools-other',email:'tools-other@example.test',password}]);
  course=await Course.create({user:user._id,title:'Biology'});book=await Book.create({user:user._id,title:'Cells',author:'Test author',category:'Science',courses:[course._id]});
  const note=await Note.create({user:user._id,title:'Cell energy',content:'Mitochondria supply ATP.',book:book._id});
  ref={source_id:String(note._id),source_type:'note',source_version:note.sourceVersion,index_generation:randomUUID()};
  passage={text:note.content,citation:{chunk_id:'note-'+'a'.repeat(64),source:ref,locator:'paragraph 2',page_start:null,page_end:null}};
  await Note.updateOne({_id:note._id},{indexing:{...createIndexingJob(user._id,note.sourceVersion,now),status:'ready',activeGeneration:ref.index_generation,embeddingModel:'test-model',indexVersion:'test-index',passages:[passage]}});
  search=new StudySearchService({resolver:new StudyScopeResolver({profile:async()=>({embedding_model:'test-model',index_version:'test-index'})}),client:{}});
  repo=new StudyRepository({clock:()=>now});chat=new ChatService({repository:new ChatRepository({clock:()=>now}),search,client:{async config(){return{enabled:true,model:'test-model'};}}});
  client={async config(){return{enabled:true,defaultCount:5,maxCount:10};},async*stream(body){calls++;yield{type:'status',phase:'drafting'};yield{type:'final',draft:fixture(body.kind,body.count,body.format),model:'test-model',usage:{input_tokens:20,output_tokens:100}};}};
  service=new StudyService({repository:repo,search,chat,client});const app=createApp({chatService:chat,studyToolsService:service,studySearchService:search});alice=request.agent(app);bob=request.agent(app);
  await alice.post('/api/auth/login').send({username:user.username,password:'test-password123'}).expect(200);await bob.post('/api/auth/login').send({username:other.username,password:'test-password123'}).expect(200);
 });
 function fixture(kind='quiz',count=5,format='auto'){
  const base={kind,title:'Cell energy study set',body:'',cards:[],questions:[],citations:[{...passage.citation,number:1}],coverage:{passages:1,coveredSources:1,totalSources:1,excerpted:true}};
  if(['summary','explanation'].includes(kind)){base.body='Mitochondria supply ATP [1].';}
  if(kind==='flashcards'){base.cards=Array.from({length:count},(_,i)=>({front:'What supplies ATP? '+i,back:'Mitochondria.',explanation:'ATP supports cell activity.',citationNumbers:[1]}));}
  if(kind==='quiz'){base.questions=Array.from({length:count},(_,i)=>{
   const type=format==='auto'?['choice','written','code'][i%3]:format;
   return{kind:type,prompt:'Explain ATP production. '+i,options:type==='choice'?['Mitochondria','Nucleus']:[],correctIndex:type==='choice'?0:null,explanation:'The note identifies mitochondria.',referenceAnswer:type==='choice'?'':type==='code'?'print("ATP")':'Mitochondria supply ATP.',rubric:type==='choice'?[]:[{description:'Identify the correct organelle.',maxPoints:2}],language:type==='code'?'python':'',starterCode:type==='code'?'# Your answer':'',citationNumbers:[1]};
  });}return base;
 }
 async function create(kind='quiz',extra={}){return(await alice.post('/api/study-tools').send({kind,requestId:randomUUID(),selection:{notes:[ref.source_id]},instruction:'',...extra}).expect(201)).body.artifact;}
 async function generate(kind='quiz',extra={}){const row=await create(kind,extra),result=events(await alice.post(`/api/study-tools/${row._id}/generate`).send({}).expect(200));const done=result.find(e=>e.type==='done');expect(done,JSON.stringify(result)).to.exist;return done.artifact;}
 async function confirm(row,action='save'){return(await alice.post(`/api/study-tools/${row._id}/confirmations`).send({action,revision:row.revision}).expect(200)).body;}
 const apply=(row,confirmation)=>alice.post(`/api/study-tools/${row._id}/actions`).send({token:confirmation.token,revision:confirmation.revision,action:confirmation.action});
 it('generates all four grounded kinds as drafts, defaulting to five quiz questions',async()=>{
  for(const kind of ['summary','explanation','flashcards','quiz']){
   const row=await generate(kind);expect(row.status).to.equal('draft');expect(row.content).to.equal(null);expect(row.draft.citations[0].title).to.equal('Cell energy');
   if(kind==='quiz'){expect(row.draft.questions).to.have.length(5);expect(row.draft.questions.map(q=>q.kind)).to.include.members(['choice','written','code']);}
   expect(JSON.stringify(row)).not.to.match(/leaseUntil|confirmation.*hash|OPENAI_API_KEY/);
  }
  expect(await StudyArtifact.countDocuments({status:'saved'})).to.equal(0);
 });
 it('keeps numeric list indices separate from explicit per-question source references',async()=>{
  const row=await generate(),draft={...row.draft,questions:row.draft.questions.map((q,i)=>i===0?{...q,prompt:'What is values[0] when values = [1]?',explanation:'values[0] is the first item.'}:q)};
  const edited=(await alice.patch(`/api/study-tools/${row._id}`).send({revision:row.revision,draft}).expect(200)).body.artifact;
  expect(edited.draft.questions[0].prompt).to.include('values[0]');expect(edited.draft.questions[0].citationNumbers).to.deep.equal([1]);
 });
 it('requires exact user confirmation and handles concurrent repeated saves without duplicates',async()=>{
  const row=await generate();await alice.post(`/api/study-tools/${row._id}/actions`).send({action:'save',revision:row.revision}).expect(400);
  const confirmation=await confirm(row);await bob.post(`/api/study-tools/${row._id}/actions`).send({action:confirmation.action,revision:confirmation.revision,token:confirmation.token}).expect(404);
  const results=await Promise.all([apply(row,confirmation),apply(row,confirmation)]);expect(results.map(r=>r.status)).to.deep.equal([200,200]);
  expect(await StudyArtifact.countDocuments({status:'saved'})).to.equal(1);expect((await StudyArtifact.findById(row._id)).revision).to.equal(row.revision+1);
  await alice.post('/api/auth/logout').expect(204);await alice.post('/api/auth/login').send({username:user.username,password:'test-password123'}).expect(200);
  expect((await alice.get(`/api/study-tools/${row._id}`).expect(200)).body.artifact.content.questions).to.have.length(5);
 });
 it('isolates drafts, feedback, generation, source previews, and confirmations by owner',async()=>{
  const row=await generate();for(const suffix of ['','/practice','/sources/1']){await bob.get(`/api/study-tools/${row._id}${suffix}`).expect(404);}
  for(const suffix of ['/generate','/confirmations','/feedback']){await bob.post(`/api/study-tools/${row._id}${suffix}`).send({}).expect(404);}
  expect((await bob.get('/api/study-tools').expect(200)).body.artifacts).to.deep.equal([]);
  await alice.post('/api/study-tools').send({kind:'quiz',requestId:randomUUID(),selection:{notes:[new mongoose.Types.ObjectId().toString()]},instruction:''}).expect(404);
 });
 it('invalidates old confirmations after a draft edit and rejects forged source metadata',async()=>{
  const row=await generate('summary'),confirmation=await confirm(row),changed={...row.draft,body:'ATP is supplied by mitochondria [1].'};
  const edited=(await alice.patch(`/api/study-tools/${row._id}`).send({revision:row.revision,draft:changed}).expect(200)).body.artifact;
  await apply(row,confirmation).expect(409);expect(await StudyArtifact.countDocuments({status:'saved'})).to.equal(0);
  await alice.patch(`/api/study-tools/${row._id}`).send({revision:edited.revision,draft:{...changed,citations:[{...changed.citations[0],source:{...ref,source_id:String(other._id)}}]}}).expect(400);
  await apply(edited,await confirm(edited)).expect(200);
 });
 it('keeps saved content and practice stable until an edited draft is explicitly confirmed',async()=>{
  let row=await generate();row=(await apply(row,await confirm(row)).expect(200)).body.artifact;
  const practice=(await alice.get(`/api/study-tools/${row._id}/practice`).expect(200)).body;
  expect(JSON.stringify(practice)).not.to.match(/correctIndex|referenceAnswer|rubric|explanation/);
  const draft={...row.content,title:'Edited title',questions:row.content.questions.map((q,i)=>i===0?{...q,prompt:'Edited prompt'}:q)};
  const edited=(await alice.patch(`/api/study-tools/${row._id}`).send({revision:row.revision,draft}).expect(200)).body.artifact;
  expect(edited.content.title).to.equal(row.content.title);expect(edited.draft.title).to.equal('Edited title');
  await alice.post(`/api/study-tools/${row._id}/feedback`).send({revision:practice.revision,questionId:'q1',answer:0}).expect(200);
  await apply(edited,await confirm(edited,'update')).expect(200);
  await alice.post(`/api/study-tools/${row._id}/feedback`).send({revision:practice.revision,questionId:'q1',answer:0}).expect(409);
 });
 it('returns deterministic choice feedback and labeled written/code reference rubrics without executing code',async()=>{
  const row=await generate(),base={revision:row.revision};
  const choice=(await alice.post(`/api/study-tools/${row._id}/feedback`).send({...base,questionId:'q1',answer:0}).expect(200)).body;expect(choice.correct).to.equal(true);
  for(const questionId of ['q2','q3']){const feedback=(await alice.post(`/api/study-tools/${row._id}/feedback`).send({...base,questionId,answer:'My answer'}).expect(200)).body;expect(feedback.selfReview).to.equal(true);expect(feedback.rubric).to.have.length(1);expect(feedback).not.to.have.property('score');}
  const reveal=(await alice.post(`/api/study-tools/${row._id}/feedback`).send({...base,questionId:'q1',reveal:true}).expect(200)).body;expect(reveal.revealed).to.equal(true);expect(reveal.correct).to.equal(false);
 });
 it('rejects expired confirmations, stale source saves, and altered source previews',async()=>{
  const row=await generate(),confirmation=await confirm(row);now=new Date(now.getTime()+11*60000);await apply(row,confirmation).expect(409);
  const fresh=await confirm(row);await Note.updateOne({_id:ref.source_id},{sourceVersion:randomUUID()});await apply(row,fresh).expect(409);
  await alice.get(`/api/study-tools/${row._id}/sources/1`).expect(409);
  expect((await StudyArtifact.findById(row._id)).status).to.equal('draft');
 });
 it('requires confirmed deletion, preserves original sources, and deduplicates the delete',async()=>{
  const row=await generate(),confirmation=await confirm(row,'delete');await apply(row,confirmation).expect(200);await apply(row,confirmation).expect(200);
  await alice.get(`/api/study-tools/${row._id}`).expect(404);expect(await Note.exists({_id:ref.source_id})).to.exist;
  const tombstone=await StudyArtifact.findById(row._id);expect(tombstone.content).to.equal(null);expect(tombstone.draft).to.equal(null);expect(tombstone.request).to.deep.equal({});
 });
 it('recovers interrupted generation and prevents an old cancellation/final from overwriting a new run',async()=>{
  const row=await create(),first=await service.prepare(user._id,row._id);
  expect((await search.resolver.refresh({user_id:String(user._id),proposal_id:row._id,run_id:first.run.id,scope:{scope_id:'tools',selection:first.row.request.selection,sources:[ref]}})).scope.sources).to.have.length(1);
  now=new Date(now.getTime()+121000);expect((await service.owned(user._id,row._id)).errorCode).to.equal('interrupted');
  const second=await service.prepare(user._id,row._id);expect(await repo.cancel(user._id,row._id,first.run.id)).to.equal(null);expect(await repo.finish(user._id,row._id,first.run,{status:'draft',draft:fixture()})).to.equal(null);
  expect((await service.owned(user._id,row._id)).activeRun.id).to.equal(second.run.id);await repo.cancel(user._id,row._id,second.run.id);
 });
 it('uses a bounded canonical overview and discovers saved sets through current course/book/note links',async()=>{
  let row=await generate();row=(await apply(row,await confirm(row)).expect(200)).body.artifact;
  const found=(await alice.get('/api/study-tools').query({status:'saved',course:String(course._id)}).expect(200)).body.artifacts;expect(found.map(r=>r._id)).to.include(row._id);
  await bob.get('/api/study-tools').query({course:String(course._id)}).expect(404);
  const overview=await search.passages.overview({context:{user_id:String(user._id),run_id:'overview',scope:{scope_id:'overview',selection:{books:[String(book._id)]},sources:[ref]}}});expect(overview.passages).to.have.length(1);expect(overview.passages[0].text).to.equal(passage.text);
 });
 it('bounds generation inputs, rejects unknown identity fields, deduplicates requests and enforces shared quotas',async()=>{
  for(const extra of [{count:11},{count:1.5},{user_id:String(other._id)},{format:'invalid'}]){await alice.post('/api/study-tools').send({kind:'quiz',requestId:randomUUID(),selection:{notes:[ref.source_id]},instruction:'',...extra}).expect(400);}
  const requestId=randomUUID(),one=await create('quiz',{requestId}),two=await create('quiz',{requestId});expect(one._id).to.equal(two._id);
  await alice.post('/api/study-tools').send({kind:'summary',requestId,selection:{notes:[ref.source_id]},instruction:''}).expect(409);
  chat.dailyTurns=1;await alice.post(`/api/study-tools/${one._id}/generate`).send({}).expect(200);
  const next=await create();expect(events(await alice.post(`/api/study-tools/${next._id}/generate`).send({}).expect(200)).find(e=>e.type==='error').code).to.equal('daily_limit');expect(calls).to.equal(1);
 });
 it('adds a reviewable chat proposal without saving generated library content',async()=>{
  chat.client.stream=async function*(){yield{type:'final',mode:'draft',draft:fixture('flashcards',3),model:'test-model'};};
  const conversation=(await alice.post('/api/chat').send({selection:{notes:[ref.source_id]}}).expect(201)).body.conversation;
  const result=events(await alice.post(`/api/chat/${conversation._id}/messages`).send({content:'Generate three flashcards.',requestId:randomUUID()}).expect(200));
  const message=result.find(e=>e.type==='done').message;expect(message.mode).to.equal('draft');expect(message.proposalId).to.be.a('string');
  const proposal=(await alice.get(`/api/study-tools/${message.proposalId}`).expect(200)).body.artifact;expect(proposal.status).to.equal('draft');expect(proposal.draft.cards).to.have.length(3);expect(await StudyArtifact.countDocuments({status:'saved'})).to.equal(0);
 });
});
