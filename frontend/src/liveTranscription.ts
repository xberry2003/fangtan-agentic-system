export type LiveSession = { stop:()=>Promise<void> };
export function openLiveTranscription(pid:string, stream:MediaStream, onText:(text:string,final:boolean,id:string)=>void, onStatus:(status:string)=>void):LiveSession {
  const socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/api/projects/${pid}/live-transcription`);
  const prefix=crypto.randomUUID();
  let context:AudioContext|null=null, node:AudioWorkletNode|null=null, source:MediaStreamAudioSourceNode|null=null;
  let stopped=false, ready=false, complete:()=>void=()=>{};
  const completed=new Promise<void>(resolve=>{complete=resolve});
  const timer=window.setTimeout(()=>{onStatus('实时转写连接超时，原始录音继续');void stop()},25000);
  onStatus('正在连接实时转写…');
  async function stop(){
    if(stopped)return completed;
    stopped=true;clearTimeout(timer);
    source?.disconnect();
    node?.port.postMessage('flush');
    // Allow the worklet to deliver its last PCM buffer before finish-task.
    await new Promise(resolve=>setTimeout(resolve,40));
    node?.disconnect();
    if(context)void context.close().catch(()=>{});
    if(socket.readyState===WebSocket.OPEN&&ready){socket.send(JSON.stringify({finish:true}));await Promise.race([completed,new Promise(resolve=>setTimeout(resolve,4000))]);}
    if(socket.readyState===WebSocket.OPEN||socket.readyState===WebSocket.CONNECTING)socket.close();
    complete();
  }
  socket.onopen=async()=>{
    try{
      context=new AudioContext({sampleRate:16000});
      await context.audioWorklet.addModule('/pcm-capture.js');
      if(stopped){void context.close();return}
      socket.send(JSON.stringify({sample_rate:context.sampleRate,consent:true}));
    }catch{onStatus('当前环境无法开启实时转写，原始录音继续');void stop()}
  };
  socket.onmessage=async event=>{
    try{
      const data=JSON.parse(event.data);
      if(data.error){onStatus(data.error);void stop();return}
      if(data.ready&&!stopped&&context){
        ready=true;clearTimeout(timer);
        node=new AudioWorkletNode(context,'pcm-capture');
        node.port.onmessage=event=>{if(socket.readyState===WebSocket.OPEN){if(socket.bufferedAmount>512000){onStatus('实时转写网络拥堵，原始录音继续');void stop();return}socket.send(event.data)}};
        source=context.createMediaStreamSource(stream);source.connect(node);node.connect(context.destination);
        await context.resume();onStatus('实时转写中 · 已问问题自动标记');
      }
      if(typeof data.text==='string')onText(data.text,!!data.final,prefix+':'+data.begin);
      if(data.done){complete();socket.close()}
    }catch{onStatus('实时转写响应异常，原始录音继续');void stop()}
  };
  socket.onerror=()=>{onStatus('实时转写连接失败，原始录音继续');void stop()};
  socket.onclose=()=>{clearTimeout(timer);complete();if(!stopped){onStatus('实时转写已断开，原始录音继续');void stop()}};
  return {stop};
}
