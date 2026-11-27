import { expect } from 'chai';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/app.mjs';
import { User, Note, Course, Conversation, ChatQuota } from '../../src/db.mjs';
import { StudyScopeResolver } from '../../src/retrieval/scope.mjs';
import { StudySearchService } from '../../src/retrieval/service.mjs';
import { ChatService } from '../../src/chat/service.mjs';
import { ChatRepository } from '../../src/chat/repository.mjs';
import { CHAT_RUN_LEASE_MS, CHAT_MAX_MESSAGES } from '../../src/chat/policy.mjs';
import { createIndexingJob } from '../../src/documents/indexing-policy.mjs';

const integration = process.env.TEST_DSN ? describe : describe.skip;
const events = response => response.text.split('\n\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
describe('Chat authentication', () => {
  it('requires Passport for every history and streaming operation', async () => {
    const app = createApp();
    for (const path of ['/api/chat', '/api/chat/config', '/api/chat/options', '/api/chat/'+new mongoose.Types.ObjectId()]) {
      await request(app).get(path).expect(401);
    }
    await request(app).post('/api/chat').send({selection:{library:true}}).expect(401);
    await request(app).post('/api/chat/'+new mongoose.Types.ObjectId()+'/messages').send({content:'Hello',requestId:randomUUID()}).expect(401);
  });
});

integration('Durable scoped study chat (requires TEST_DSN)', () => {
  let user, other, alice, bob, app, service, repository, search, now, reference, passage, calls, client;
  before(async () => {
    if (!new URL(process.env.TEST_DSN).pathname.endsWith('_test')) { throw new Error('Use a disposable test database.'); }
    await mongoose.connect(process.env.TEST_DSN);
  });
  after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  beforeEach(async () => {
    await Promise.all([User,Note,Course,Conversation,ChatQuota].map(model => model.deleteMany({})));
    now = new Date(); calls = 0;
    const password = await bcrypt.hash('test-password123',4);
    [user,other] = await User.create([{username:'chat-student',email:'chat@example.test',password},{username:'chat-other',email:'other@example.test',password}]);
    const note = await Note.create({user:user._id,title:'Cell energy',content:'Mitochondria supply ATP.'});
    reference = {source_id:String(note._id),source_type:'note',source_version:note.sourceVersion,index_generation:randomUUID()};
    passage = {text:note.content,citation:{chunk_id:'note-'+'a'.repeat(64),source:reference,locator:'paragraph 2',page_start:null,page_end:null}};
    await Note.updateOne({_id:note._id},{indexing:{...createIndexingJob(user._id,note.sourceVersion,now),status:'ready',activeGeneration:reference.index_generation,
      embeddingModel:'test-model',indexVersion:'test-index',passages:[passage]}});
    repository = new ChatRepository({clock:()=>now});
    search = new StudySearchService({resolver:new StudyScopeResolver({profile:async()=>({embedding_model:'test-model',index_version:'test-index'})}),client:{}});
    client = {async config(){return {enabled:true,model:'test-model'};},async *stream(){calls++;yield {type:'mode',mode:'grounded'};yield {type:'delta',text:'Mitochondria supply ATP [1].'};yield {type:'final',answer:'Mitochondria supply ATP [1].',mode:'grounded',citations:[{...passage.citation,number:1}],model:'test-model',usage:{input_tokens:20,output_tokens:10}};}};
    service = new ChatService({repository,search,client});
    app = createApp({chatService:service,studySearchService:search}); alice=request.agent(app);bob=request.agent(app);
    await alice.post('/api/auth/login').send({username:user.username,password:'test-password123'}).expect(200);
    await bob.post('/api/auth/login').send({username:other.username,password:'test-password123'}).expect(200);
  });
  async function conversation(extra={}) { return (await alice.post('/api/chat').send({selection:{notes:[reference.source_id]},...extra}).expect(201)).body.conversation; }
  const send = (id, requestId=randomUUID(), content='What supplies ATP?') => alice.post(`/api/chat/${id}/messages`).send({content,requestId});

  it('streams and persists canonical answers/citations, and restores history after logout', async () => {
    const convo=await conversation(), result=await send(convo._id).expect(200);
    expect(result.headers['content-type']).to.include('text/event-stream');
    const stream=events(result);expect(stream[0].type).to.equal('start');expect(stream.some(e=>e.type==='delta')).to.equal(true);
    const done=stream.find(e=>e.type==='done');expect(done.message.citations[0]).to.include({title:'Cell energy',locator:'paragraph 2'});
    expect(done.message.citations[0].href).to.equal(`/notes/${reference.source_id}`);
    expect((await Conversation.findById(convo._id)).messages).to.have.length(2);
    await alice.post('/api/auth/logout').expect(204);
    await alice.get(`/api/chat/${convo._id}`).expect(401);
    await alice.post('/api/auth/login').send({username:user.username,password:'test-password123'}).expect(200);
    const restored=(await alice.get(`/api/chat/${convo._id}`).expect(200)).body.conversation;
    expect(restored.messages[1].content).to.equal(done.message.content);expect(restored.busy).to.equal(false);
    const source=await alice.get(`/api/chat/${convo._id}/sources/${done.message.id}/1`).expect(200);
    expect(source.body.passage.text).to.equal(passage.text);
    expect(result.text).not.to.match(/leaseToken|service_token|OPENAI_API_KEY/);
  });
  it('isolates conversations, source previews, cancellation, and writes by owner', async () => {
    const convo=await conversation();await send(convo._id).expect(200);
    for(const method of ['get','patch','delete']) { await bob[method](`/api/chat/${convo._id}`).send({title:'Private'}).expect(404); }
    await bob.post(`/api/chat/${convo._id}/messages`).send({content:'Read private data',requestId:randomUUID()}).expect(404);
    await bob.post(`/api/chat/${convo._id}/cancel`).send({runId:randomUUID()}).expect(404);
    expect((await bob.get('/api/chat').expect(200)).body.conversations).to.deep.equal([]);
    await alice.post('/api/chat').send({selection:{notes:[new mongoose.Types.ObjectId().toString()]}}).expect(404);
  });
  it('paginates saved conversations without losing older history or exposing another owner', async () => {
    const documents=Array.from({length:53},(_,i)=>({user:user._id,title:'Chat '+i,selection:{library:true}}));
    await Conversation.insertMany(documents);
    const first=(await alice.get('/api/chat').expect(200)).body;
    expect(first.conversations).to.have.length(50);expect(first.nextCursor).to.be.a('string');
    const second=(await alice.get('/api/chat').query({cursor:first.nextCursor}).expect(200)).body;
    expect(second.conversations).to.have.length(3);expect(second.nextCursor).to.equal(null);
    expect(new Set([...first.conversations,...second.conversations].map(c=>c._id)).size).to.equal(53);
    expect((await bob.get('/api/chat').query({cursor:first.nextCursor}).expect(200)).body.conversations).to.deep.equal([]);
    await alice.get('/api/chat').query({cursor:'malformed'}).expect(400);
  });
  it('revalidates the active conversation and rejects a broadened tool scope', async () => {
    const convo=await conversation(),started=await service.prepare(user._id,convo._id,{content:'Question?',requestId:randomUUID()});
    const context={user_id:String(user._id),conversation_id:convo._id,run_id:started.run.id,scope:{scope_id:'chat',selection:convo.selection,sources:[reference]}};
    expect((await search.resolver.refresh(context)).scope.sources).to.have.length(1);
    try {await search.resolver.refresh({...context,scope:{...context.scope,selection:{library:true}}});expect.fail('Expected scope rejection');}
    catch(error){expect(error.code).to.equal('scope_changed');}
    await service.cancel(user._id,convo._id,started.run.id);
    try {await search.resolver.refresh(context);expect.fail('Expected cancelled-run rejection');}
    catch(error){expect(error.code).to.equal('scope_changed');}
  });
  it('deduplicates requests without repeated model calls and rejects conflicting content', async () => {
    const convo=await conversation(), id=randomUUID();await send(convo._id,id).expect(200);await send(convo._id,id).expect(200);
    expect(calls).to.equal(1);expect((await Conversation.findById(convo._id)).messageCount).to.equal(2);
    await send(convo._id,id,'Different question').expect(409);
  });
  it('allows only one active turn, with durable cancellation and no late overwrite', async () => {
    const convo=await conversation();const started=await service.prepare(user._id,convo._id,{content:'Question?',requestId:randomUUID()});
    await send(convo._id).expect(409);await alice.patch(`/api/chat/${convo._id}`).send({topic:'Another topic'}).expect(409);
    await alice.post(`/api/chat/${convo._id}/cancel`).send({runId:started.run.id}).expect(200);
    expect(await repository.finish(user._id,convo._id,started.run,{content:'Late answer',status:'completed'})).to.equal(null);
    const saved=await Conversation.findById(convo._id);expect(saved.messages[1].status).to.equal('cancelled');expect(saved.messages[1].content).to.equal('');
  });
  it('recovers an interrupted run after a process restart without losing the question', async () => {
    const convo=await conversation();await service.prepare(user._id,convo._id,{content:'Keep this question',requestId:randomUUID()});
    now=new Date(now.getTime()+CHAT_RUN_LEASE_MS+1);
    const fresh=new ChatRepository({clock:()=>now}), saved=await fresh.get(user._id,convo._id);
    expect(saved.activeRun).to.equal(null);expect(saved.messages[0].content).to.equal('Keep this question');expect(saved.messages[1].status).to.equal('interrupted');
  });
  it('rejects forged citations and refuses unsupported general responses', async () => {
    const convo=await conversation();client.stream=async function*(){yield {type:'final',answer:'Unsupported [9].',mode:'grounded',citations:[{...passage.citation,number:1}]};};
    expect(events(await send(convo._id).expect(200)).find(e=>e.type==='error').code).to.equal('response_invalid');
    client.stream=async function*(){yield {type:'final',answer:'General knowledge.',mode:'general',citations:[]};};
    await send(convo._id).expect(200);const saved=await Conversation.findById(convo._id);expect(saved.messages.at(-1).status).to.equal('failed');
  });
  it('refuses a changed source at final publication and when reopening a historic citation', async () => {
    const convo=await conversation();const first=events(await send(convo._id).expect(200)).find(e=>e.type==='done');
    await Note.updateOne({_id:reference.source_id},{sourceVersion:randomUUID()});
    await alice.get(`/api/chat/${convo._id}/sources/${first.message.id}/1`).expect(410);
    expect((await alice.get(`/api/chat/${convo._id}`).expect(200)).body.conversation.messages[1].content).to.equal(first.message.content);
    client.stream=async function*(){yield {type:'final',answer:'Old answer [1].',mode:'grounded',citations:[{...passage.citation,number:1}]};};
    expect(events(await send(convo._id).expect(200)).find(e=>e.type==='error').code).to.equal('source_changed');
  });
  it('deletes the whole saved history atomically and fences a delayed response', async () => {
    const convo=await conversation();const started=await service.prepare(user._id,convo._id,{content:'Question?',requestId:randomUUID()});
    await alice.delete(`/api/chat/${convo._id}`).expect(204);await alice.get(`/api/chat/${convo._id}`).expect(404);
    expect(await repository.finish(user._id,convo._id,started.run,{content:'Must not return',status:'completed'})).to.equal(null);
    expect(await Conversation.findById(convo._id)).to.equal(null);
  });
  it('bounds messages, history size, identity overrides, and daily provider calls', async () => {
    const convo=await conversation();
    await alice.post(`/api/chat/${convo._id}/messages`).send({content:'Question?',requestId:randomUUID(),user_id:String(other._id)}).expect(400);
    await send(convo._id,randomUUID(),'x'.repeat(4001)).expect(400);
    service.dailyTurns=1;await send(convo._id).expect(200);
    expect(events(await send(convo._id).expect(200)).find(e=>e.type==='error').code).to.equal('daily_limit');expect(calls).to.equal(1);
    await Conversation.updateOne({_id:convo._id},{messageCount:CHAT_MAX_MESSAGES});await send(convo._id).expect(409);
  });
  it('excludes stale material-based assistant text from future model prompts', async () => {
    const old={role:'assistant',status:'completed',content:'Old private source content',mode:'grounded',citations:[{...passage.citation,number:1}]};
    expect(service.history([old],[],false)[0].content).not.to.include('Old private');
    expect(service.history([old],[reference],false)[0].content).to.equal(old.content);
  });
});
