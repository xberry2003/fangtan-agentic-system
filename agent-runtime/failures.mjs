export function formatFailure(error,key='',model='',phase='unknown') {
  let detail=String(error?.message||error);
  if(key)detail=detail.split(key).join('[redacted]');
  detail=detail.replace(/Bearer\s+[^\s"']+/gi,'Bearer [redacted]').slice(0,1200);
  const code=error?.stopReason==='length'?'output_limit':/429|rate.?limit|too many requests/i.test(detail)?'rate_limit':/timeout|timed out|abort/i.test(detail)?'timeout':/401|403|unauthorized|invalid.?api.?key/i.test(detail)?'authentication':/fetch failed|ECONN|socket|network|connection/i.test(detail)?'network':'provider_error';
  const messages={output_limit:'报告内容超过本轮输出上限，生成被截断，尚未保存。',rate_limit:'Kimi请求过于频繁，当前报告尚未完成，请稍后重试。',timeout:'Kimi生成超时，当前报告尚未完成，请重试。',authentication:'模型服务鉴权失败，请检查服务端密钥。',network:'连接Kimi服务时中断，当前报告尚未完成，请重试。',provider_error:'模型服务返回错误，当前报告尚未完成。'};
  return {error:messages[code]+' 已保存的文件仍保留。',error_code:code,diagnostic:{phase,model,stop_reason:error?.stopReason||null,detail}};
}
