import readline from 'node:readline';
import { toolAllowed } from './skill-tools.mjs';
import { formatFailure } from './failures.mjs';
import { Agent } from '@earendil-works/pi-agent-core';
import { createModels, createProvider, envApiKeyAuth } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { Type } from 'typebox';

const output = event => process.stdout.write(JSON.stringify(event) + '\n');
const lines = readline.createInterface({input:process.stdin});
const iterator = lines[Symbol.asyncIterator]();
let requestKey='', requestModel='', runtimePhase='startup';
try {
  const request = JSON.parse((await iterator.next()).value);
  requestKey=request.key;requestModel=request.model;
  const outputTokens=request.report_required?16000:8000;
  const models = createModels({authContext:{env:async name=>name==='STUDIO_KEY'?request.key:undefined,fileExists:async()=>false}});
  models.setProvider(createProvider({id:'studio-kimi',baseUrl:request.base,
    auth:{apiKey:envApiKeyAuth('Kimi',['STUDIO_KEY'])},api:openAICompletionsApi(),
    models:[{id:request.model,name:request.model,api:'openai-completions',provider:'studio-kimi',baseUrl:request.base,reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:262144,maxTokens:outputTokens,compat:{maxTokensField:'max_tokens',supportsStore:false,supportsDeveloperRole:false,supportsReasoningEffort:false}}]}));
  const model=models.getModel('studio-kimi',request.model);
  const definitions=[
    ['start_interview_outline','加载访谈提纲技能，开启原系统目标与方案选择清单；用户确认前不生成最终提纲，不使用报告模板。',Type.Object({topic:Type.Optional(Type.String()),scenario:Type.Optional(Type.Union([Type.Literal('market'),Type.Literal('enterprise')])),restart:Type.Optional(Type.Boolean())})],
    ['save_interview_outline','用户确认研究范围后，按interview-outline技能生成完整Markdown提纲并保存为可编辑文档，同时归档到材料的访前准备。',Type.Object({flow_id:Type.String(),revision:Type.Number(),name:Type.String(),content:Type.String()})],
    ['list_report_templates','列出从原系统迁入的报告模板和章节说明',Type.Object({})],
    ['read_report_template','读取选定模板的完整章节结构及证据规则',Type.Object({template_id:Type.String()})],
    ['create_report','根据已读取材料生成报告后保存到报告页并归档到材料。仅用户选择模板或明确不套模板后使用；content为完整Markdown报告。套模板须完整保留章节；source_ids必须是本轮已读取的真实材料ID。',Type.Object({name:Type.String(),content:Type.String(),source_ids:Type.Array(Type.String()),template_id:Type.String({description:'选定模板ID；用户不套模板时填none'}),images:Type.Optional(Type.Array(Type.Object({file_id:Type.String(),heading:Type.String(),caption:Type.String()})))})],
    ['inspect_image','使用Kimi图片能力解读当前项目真实照片，返回可见事实、不确定性和插图地址；用户要求报告含照片时必须逐张调用。',Type.Object({file_id:Type.String(),question:Type.Optional(Type.String())})],
    ['list_materials','列出当前项目材料的真实文件ID和名称',Type.Object({})],
    ['read_document','提取当前项目的文本、DOCX、文字型PDF内容，返回段落编号及版本哈希',Type.Object({file_id:Type.String()})],
    ['create_document','用户要求新建、生成或保存文档时，在当前项目新建 Markdown 文件',Type.Object({name:Type.String(),content:Type.String()})],
    ['update_document','用户要求修改文档时使用，必须先读取该文件并提供返回的版本哈希',Type.Object({file_id:Type.String(),expected_hash:Type.String(),content:Type.String()})],
  ];
  let calls=0, turns=0, reportSaved=false, nudges=0, needsNudge=false;
  const available=definitions.filter(([name])=>toolAllowed(request.task,name));
  const tools=available.map(([name,description,parameters])=>({name,label:name,description,parameters,executionMode:'sequential',execute:async(id,args)=>{
    if(++calls>12)throw new Error('工具调用已达到本轮上限');
    runtimePhase='tool:'+name;
    output({tool_request:true,id,name,args});
    const line=await iterator.next();if(line.done)throw new Error('connection_closed');
    const result=JSON.parse(line.value);
    if(name==='create_report'&&result.saved&&!result.error)reportSaved=true;
    return {content:[{type:'text',text:JSON.stringify(result)}],isError:!!result.error,details:{}};
  }}));
  const agent=new Agent({initialState:{model,tools,messages:[],thinkingLevel:'off'},toolExecution:'sequential',
    streamFn:(m,context,options)=>models.streamSimple(m,context,{...options,maxTokens:outputTokens,maxRetries:1,timeoutMs:request.report_required?180000:120000,onPayload:p=>{const next={...p,max_tokens:outputTokens,stream:true};delete next.max_completion_tokens;delete next.temperature;delete next.store;if(request.model.startsWith('kimi-k3'))next.reasoning_effort='low';return next}}),
    prepareRequest:async({context})=>{runtimePhase='model';if(++turns>(request.report_required?14:10))throw new Error('本轮处理已达到上限');if(needsNudge){needsNudge=false;return {context:{...context,messages:[...context.messages,{role:'system',content:'报告尚未保存。不要只说准备读取或开始整合；继续使用工具读取指定材料和模板并调用create_report。若确实缺少信息或工具失败，请具体说明并提出必要澄清。'}]}}}},
    finishTurn:async({message})=>{
      if(!request.report_required||reportSaved||message.stopReason!=='stop')return;
      const body=message.content.filter(part=>part.type==='text').map(part=>part.text).join('');
      const clarification=/[？?]|请.{0,20}(?:选择|确认|提供|上传)|无法|失败|不支持|未找到|没有找到|没有材料/.test(body);
      if(!clarification&&nudges<2){nudges++;needsNudge=true;return {action:'continue'}}
    },
  });
  agent.subscribe(event=>{if(event.type==='message_update'&&event.assistantMessageEvent.type==='text_delta')output({text:event.assistantMessageEvent.delta});});
  const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
  await agent.prompt([{role:'system',content:request.system},...request.messages.map(m=>m.role==='assistant'?{role:'assistant',content:[{type:'text',text:m.content}],api:model.api,provider:model.provider,model:model.id,usage,stopReason:'stop',timestamp:Date.now()}:{...m,timestamp:Date.now()})]);
  const last=agent.state.messages.at(-1);
  if(last?.role!=='assistant'||last.stopReason!=='stop'){const failure=new Error(last?.errorMessage||'模型回复未完成');failure.stopReason=last?.stopReason;throw failure}
  const finalText=last.content.filter(c=>c.type==='text').map(c=>c.text).join('');
  if(request.report_required&&!reportSaved&&nudges>=2&&!/[？?]|请.{0,20}(?:选择|确认|提供|上传)|无法|失败|不支持|未找到|没有材料/.test(finalText))output({error:'本轮未完成报告保存，材料仍保留，请重试或缩小材料范围。'});
  else output({complete:true,content:finalText});
} catch (error) {
  output(formatFailure(error,requestKey,requestModel,runtimePhase));
} finally {lines.close();}
