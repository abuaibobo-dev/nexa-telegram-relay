
const $=id=>document.getElementById(id);
const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k))??f}catch{return f}};
const save=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const uid=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// === TDLib Status ===
let tdlibStatus = 'uninitialized'; // uninitialized/connecting/ready/error
function setTdlibStatus(s) {
  tdlibStatus = s;
  var input = $('chatInput');
  var send = $('sendBtn');
  if (s === 'ready') {
    input.disabled = false; input.placeholder = '说点什么...';
    send.disabled = false; send.style.opacity = '1';
  } else {
    input.disabled = true; input.placeholder = s === 'connecting' ? '正在连接 Telegram...' : s === 'error' ? 'Telegram 连接失败' : '请先连接 Telegram';
    send.disabled = true; send.style.opacity = '0.4';
  }
  updateStatus();
}

// === Message Queue ===
let msgQueue = [];
let msgProcessing = false;
function enqueueMsg(fn) {
  if (msgQueue.length > 20) { showToast('⚠ 队列已满，请稍后再试'); return; }
  msgQueue.push(fn);
  processQueue();
}
// === Loading progress ===
function showProgress(total, done, label) {
  var pct = total > 0 ? Math.round(done / total * 100) : 0;
  var el = document.getElementById('progressCard');
  if (!el) {
    el = document.createElement('div'); el.id = 'progressCard'; el.className = 'msg msg-sys';
    $('chatMessages').appendChild(el);
  }
  el.innerHTML = '📊 ' + (label||'处理中') + '：' + done + '/' + total + ' (' + pct + '%)';
  scrollChat();
}
function hideProgress() { var el = document.getElementById('progressCard'); if (el) el.remove(); }

// === Rate limit display ===
function showRateLimit(seconds) {
  addSystemMsg('⏳ Telegram 速率限制，暂停 ' + seconds + ' 秒');
  var countdown = seconds;
  var timer = setInterval(function() {
    countdown--;
    if (countdown <= 0) { clearInterval(timer); addSystemMsg('✅ 限速解除，继续采集'); return; }
    var el = document.getElementById('rateLimitMsg');
    if (el) el.textContent = '⏳ 限速中... 剩余 ' + countdown + ' 秒';
  }, 1000);
}

// === Help system ===
const HELP_TEXT = [
  '📱 频道操作：',
  '  同步频道 - 在设置中连接 Telegram 后同步',
  '  绑定来源 - 说"把XX绑定到YY"',
  '',
  '🔄 采集控制：',
  '  /start - 启动采集',
  '  /stop - 停止采集',
  '  /status - 查看状态',
  '',
  '📋 规则管理：',
  '  "只转图片" - 修改采集类型',
  '  "暂停来源A" - 暂停指定规则',
  '  "删除规则" - 删除所有规则',
  '',
  '💡 示例：',
  '  "把频道A的所有内容转到频道B"',
  '  "只转发频道C的图片到频道D"',
  '  "启动采集"',
  '  "看看现在采了多少"',
].join('\n');

function processQueue() {
  if (msgProcessing || !msgQueue.length) return;
  msgProcessing = true;
  var fn = msgQueue.shift();
  fn().finally(function() { msgProcessing = false; processQueue(); });
}

// === Session expiry ===
window.nexaSessionExpired = function() {
  setTdlibStatus('connecting');
  addSystemMsg('⚠️ 登录已过期，正在重新连接...');
  addLogLine('Session expired, reconnecting...');
  setTimeout(function() { NexaNative?.startTelegram(); }, 2000);
};

// === Local command fallback ===
function localCommand(text) {
  var t = text.toLowerCase().trim();
  if (/^(启动|开始|start)/.test(t)) { executeAction({action:'start'}); return true; }
  if (/^(停止|暂停|stop|pause)/.test(t)) { executeAction({action:'stop'}); return true; }
  if (/^(状态|进度|status)/.test(t)) {
    var n = rules.filter(r=>r.enabled).length;
    var total = rules.length;
    addMsg('ai', '📊 当前状态：' + (running?'运行中':'已停止') + '，共 '+total+' 条规则，'+n+' 条启用');
    return true;
  }
  if (/^\/help/.test(t)) {
    addMsg('ai', '可用命令：\n/status - 查看状态\n/start - 启动采集\n/stop - 停止采集\n/bind - 绑定频道\n/help - 帮助');
    return true;
  }
  return false;
}

// === Rule conflict detection ===
function checkConflict(srcId, tgtId, type) {
  var conflicts = rules.filter(function(r) {
    return r.source === srcId && r.target === tgtId && r.enabled;
  });
  if (conflicts.length > 0) {
    var existing = conflicts[0];
    if (existing.type !== type) {
      return '检测到冲突：已有规则（' + existing.type + '）和新规则（' + type + '）不能同时启用。要替换还是保留原有？';
    }
  }
  return null;
}

let channels=read('channels',[]);
let rules=read('rules',[]);
let logs=read('logs',[]);
let running=window.NexaNative?NexaNative.relayServiceEnabled():false;
let channelInfo=read('channelInfo',{});
let deepseekKey=localStorage.getItem('deepseek_key')||'';
let chatHistory=[];
let logStreamOpen=true;

// === Toast ===
function showToast(msg,dur){
  dur=dur||2200;
  var old=document.querySelector('.toast-capsule');if(old)old.remove();
  var t=document.createElement('div');t.className='toast-capsule';t.textContent=msg;
  document.body.appendChild(t);requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),300)},dur);
}

// === Sidebar ===
function openSidebar(){$('sidebar').classList.add('open');$('sidebarMask').classList.add('show')}
function closeSidebar(){$('sidebar').classList.remove('open');$('sidebarMask').classList.remove('show')}

// === Page overlay ===
function openPage(name){
  closeSidebar();
  var pages={
    channels:{title:'频道管理',render:renderChannelsPage},
    rules:{title:'采集规则',render:renderRulesPage},
    settings:{title:'设置',render:renderSettingsPage}
  };
  var p=pages[name];if(!p)return;
  $('pageTitle').textContent=p.title;
  $('pageBody').innerHTML='';
  p.render($('pageBody'));
  $('pageOverlay').classList.add('open');
}
function closePage(){$('pageOverlay').classList.remove('open')}

// === Chat ===
function addMsg(role,content,extra){
  var div=document.createElement('div');
  div.className='msg msg-'+role;
  if(extra)div.className+=' '+extra;
  div.innerHTML=content;
  $('chatMessages').appendChild(div);
  scrollChat();
  return div;
}
function addLogMsg(text){
  var div=document.createElement('div');
  div.className='msg msg-log';
  div.textContent=text;
  $('chatMessages').appendChild(div);
  scrollChat();
}
function addSystemMsg(text){addMsg('sys',text)}
function scrollChat(){
  var area=$('chatArea');
  area.scrollTop=area.scrollHeight;
}
function showTyping(){
  var d=document.createElement('div');d.className='typing';d.id='typingIndicator';
  d.innerHTML='<span></span><span></span><span></span>';
  $('chatMessages').appendChild(d);scrollChat();
}
function hideTyping(){var t=$('typingIndicator');if(t)t.remove()}

// === Log stream ===
function addLogLine(text){
  logs.unshift(`[${new Date().toLocaleTimeString('zh-CN',{hour12:false})}] ${text}`);
  logs=logs.slice(0,20);save('logs',logs);
  var line=document.createElement('div');line.className='log-line';line.textContent=text;
  $('logBody').appendChild(line);
  if(logStreamOpen)$('logBody').scrollTop=$('logBody').scrollHeight;
}
function toggleLogStream(){
  logStreamOpen=!logStreamOpen;
  $('logBody').classList.toggle('open',logStreamOpen);
  $('logArrow').classList.toggle('open',logStreamOpen);
}

// === AI Agent ===
const SYSTEM_PROMPT=`你是 Relay，一个 Telegram 频道采集助手。你能帮用户管理频道采集规则。

你能做的事：
- 创建采集规则（绑定来源→目标频道）
- 启动/停止/暂停采集
- 查看采集状态和统计
- 修改采集类型（图片/视频/文本/全部）
- 管理频道（设置来源/目标身份）

当前状态变量：
- channels: 所有已同步的频道（id, telegramId, name, role）
- rules: 所有采集规则（source, target, type, enabled, checkpoint, processed）
- running: 采集是否运行中

回复规则：
1. 如果用户要创建规则，先确认来源和目标频道，然后返回 JSON 指令
2. 如果用户要启动/停止，直接返回对应指令
3. 如果用户问状态，读取变量并用简洁中文回答
4. 如果操作需要确认，先问用户

指令格式（需要执行操作时返回 JSON）：
{"action":"bind","source":"频道ID","targets":["目标ID1","目标ID2"],"type":"采集类型"}
{"action":"start"}
{"action":"stop"}
{"action":"pause"}
{"action":"status"}
{"action":"modify_rule","ruleId":"规则ID","type":"新采集类型"}

用简洁中文回复，不要用 markdown。`;

async function callDeepSeek(messages){
  if(!deepseekKey){showToast('⚠ 请先在设置中配置 DeepSeek Key');return null;}
  try{
    var resp=await fetch('https://api.deepseek.com/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+deepseekKey},
      body:JSON.stringify({model:'deepseek-chat',messages:[{role:'system',content:SYSTEM_PROMPT},...messages],temperature:0.3,max_tokens:1024})
    });
    var data=await resp.json();
    return data.choices?.[0]?.message?.content||null;
  }catch(e){showToast('⚠ AI 请求失败');return null;}
}

function parseAction(text){
  try{
    var m=text.match(/\{[\s\S]*\}/);
    if(m)return JSON.parse(m[0]);
  }catch{}
  return null;
}

function executeAction(action){
  if(!action)return;
  if(action.action==='bind'){
    var src=channels.find(c=>c.id===action.source||c.telegramId==action.source);
    if(!src){showToast('⚠ 来源频道不存在');return;}
    (action.targets||[]).forEach(function(tid){
      var tgt=channels.find(c=>c.id===tid||c.telegramId==tid);
      if(!tgt)return;
      rules.push({id:uid(),source:src.id,target:tgt.id,note:'',startMode:'最早消息',startMessageId:'',type:action.type||'全部内容',album:'整组保留',captionMode:'保留说明',keywords:'',dailyLimit:0,runFrom:0,runTo:24,enabled:true,checkpoint:null,processed:0});
      addLogLine('创建规则: '+src.name+' → '+tgt.name);
    });
    save('rules',rules);
    showToast('✅ 已绑定 '+action.targets.length+' 个目标');
  }else if(action.action==='start'){
    running=true;NexaNative?.setRelayService(true);
    rules.filter(r=>r.enabled).forEach(runNativeRule);
    addLogLine('采集已启动');
    showToast('🟢 采集已启动');
  }else if(action.action==='stop'||action.action==='pause'){
    running=false;NexaNative?.setRelayService(false);
    rules.forEach(r=>r.enabled=false);activeRules.clear();
    save('rules',rules);addLogLine('采集已停止');showToast('⏹ 已停止');
  }
  updateStatus();
}

async function sendChat(){
  var input=$('chatInput');
  var text=input.value.trim();if(!text)return;
  input.value='';autoResize(input);
  addMsg('user',esc(text));
  chatHistory.push({role:'user',content:text});
  // Try local command first (works offline)
  if(localCommand(text))return;
  // Queue AI call
  enqueueMsg(async function(){
    showTyping();
    var reply=await callDeepSeek(chatHistory);
    hideTyping();
    if(!reply){
      // Fallback: suggest local commands
      addMsg('ai','⚠ AI 离线，可用本地命令：\n/status 查看状态\n/start 启动\n/stop 停止\n/help 帮助');
      return;
    }
    addMsg('ai',esc(reply).replace(/\n/g,'<br>'));
    chatHistory.push({role:'assistant',content:reply});
    var action=parseAction(reply);
    if(action)executeAction(action);
  });
}

function sendQuickCmd(cmd){
  $('chatInput').value=cmd;sendChat();
}

// === Auto resize textarea ===
function autoResize(el){
  el.style.height='auto';
  el.style.height=Math.min(el.scrollHeight,100)+'px';
}

// === Status update ===
function updateStatus(){
  var n=rules.filter(r=>r.enabled).length;
  $('topStatus').textContent=n+' 条规则';
  $('svcDot').className='dot '+(running?'on':'');
  $('svcText').textContent=running?'运行中':'已停止';
}

// === Channel page ===
function renderChannelsPage(container){
  var bound=new Set(rules.map(r=>r.source));
  var html='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><b>频道列表</b><button onclick="NexaNative?.syncTelegramChannels();showToast(\'⟳ 同步中...\')">⟳ 同步</button></div>';
  html+='<div style="display:flex;gap:6px;margin-bottom:12px">';
  html+='<button class="qcmd" onclick="filterCh(\'all\',this)">全部</button>';
  html+='<button class="qcmd" onclick="filterCh(\'source\',this)">来源</button>';
  html+='<button class="qcmd" onclick="filterCh(\'target\',this)">目标</button>';
  html+='</div><div id="chList">';
  channels.forEach(function(ch){
    var isBound=ch.role==='source'&&bound.has(ch.id);
    var tag=ch.role==='source'?(isBound?'已绑定':'来源'):ch.role==='target'?'目标':'待分配';
    var cls=isBound?'item-bound':'';
    html+='<div class="item '+cls+'" data-role="'+ch.role+'"><div class="item-head"><div><b>'+esc(ch.name)+'</b><small>'+tag+'</small></div></div><div class="item-actions">';
    if(ch.role==='unassigned'){
      html+='<button onclick="setRole(\''+ch.id+'\',\'source\')">来源</button><button onclick="setRole(\''+ch.id+'\',\'target\')">目标</button>';
    }else if(ch.role==='source'&&!isBound){
      html+='<button onclick="quickBind(\''+ch.id+'\')">绑定</button>';
    }
    html+='<button onclick="showChDetail(\''+ch.id+'\')">详情</button>';
    html+='</div></div>';
  });
  html+='</div>';
  container.innerHTML=html;
}

function filterCh(role,btn){
  document.querySelectorAll('.qcmd').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('#chList .item').forEach(item=>{
    item.style.display=(role==='all'||item.dataset.role===role)?'':'none';
  });
}

window.setRole=function(id,role){
  var ch=channels.find(c=>c.id===id);if(!ch)return;
  ch.role=role;save('channels',channels);
  showToast('✅ 已设为'+(role==='source'?'来源':'目标'));
  openPage('channels');
};

window.quickBind=function(chId){
  var src=channels.find(c=>c.id===chId);if(!src)return;
  var tgts=channels.filter(c=>c.role==='target');
  if(!tgts.length){showToast('⚠ 请先添加目标频道');return;}
  var overlay=document.createElement('div');overlay.className='confirm-overlay';
  var inner='<div class="confirm-box" style="text-align:left"><p>绑定 '+esc(src.name)+' 到：</p>';
  tgts.forEach(function(t){
    var bound=rules.some(r=>r.source===chId&&r.target===t.id);
    inner+='<label style="display:flex;align-items:center;gap:8px;margin:6px 0"><input type="checkbox" class="bind-check" value="'+t.id+'"'+(bound?' checked disabled':'')+'><span>'+esc(t.name)+(bound?' ✓':'')+'</span></label>';
  });
  inner+='<div class="confirm-actions" style="margin-top:14px"><button class="confirm-cancel" onclick="this.closest(\'.confirm-overlay\').remove()">取消</button><button class="confirm-ok" onclick="doBind(\''+chId+'\')">确认</button></div></div>';
  overlay.innerHTML=inner;document.body.appendChild(overlay);
};

window.doBind=function(chId){
  var checks=document.querySelectorAll('.bind-check:checked:not(:disabled)');
  var targets=Array.from(checks).map(c=>c.value);
  if(!targets.length)return showToast('⚠ 请选择目标');
  targets.forEach(function(t){
    rules.push({id:uid(),source:chId,target:t,note:'',startMode:'最早消息',startMessageId:'',type:'全部内容',album:'整组保留',captionMode:'保留说明',keywords:'',dailyLimit:0,runFrom:0,runTo:24,enabled:true,checkpoint:null,processed:0});
  });
  save('rules',rules);document.querySelector('.confirm-overlay')?.remove();
  showToast('✅ 已绑定 '+targets.length+' 个目标');updateStatus();
};

window.showChDetail=function(chId){
  var ch=channels.find(c=>c.id===chId);if(!ch)return;
  var info=channelInfo[ch.telegramId]||{};
  var ruleCount=rules.filter(r=>r.source===chId||r.target===chId).length;
  var overlay=document.createElement('div');overlay.className='confirm-overlay';
  overlay.innerHTML='<div class="confirm-box" style="text-align:left"><p><b>'+esc(ch.name)+'</b></p><div style="font-size:11px;color:#aaa;line-height:1.8"><div>身份：'+(ch.role==='source'?'来源':ch.role==='target'?'目标':'待分配')+'</div>'+(info.members?'<div>成员：'+info.members+'</div>':'')+(info.description?'<div>简介：'+esc(info.description.slice(0,60))+'</div>':'')+'<div>关联规则：'+ruleCount+' 条</div></div><div class="confirm-actions" style="margin-top:14px"><button class="confirm-ok" onclick="this.closest(\'.confirm-overlay\').remove()">关闭</button></div></div>';
  document.body.appendChild(overlay);
};

// === Rules page ===
function renderRulesPage(container){
  var html='';
  if(!rules.length){html='<div style="color:var(--muted);font-size:12px;text-align:center;padding:40px 0">还没有规则<br>在聊天中说"帮我把XX转发到YY"即可创建</div>';}
  rules.forEach(function(r){
    var src=channels.find(c=>c.id===r.source);
    var tgt=channels.find(c=>c.id===r.target);
    html+='<div class="item"><div class="item-head"><div><b>'+(src?.name||'?')+' → '+(tgt?.name||'?')+'</b><small>'+r.type+' · '+(r.enabled?'运行中':'已暂停')+'</small></div><span class="tag" style="border-color:'+(r.enabled?'#555':'#333')+';color:'+(r.enabled?'#fff':'#888')+'">'+(r.enabled?'运行':'暂停')+'</span></div><div class="item-actions"><button onclick="toggleRule(\''+r.id+'\')">'+(r.enabled?'暂停':'启用')+'</button><button onclick="delRule(\''+r.id+'\')">删除</button></div></div>';
  });
  container.innerHTML=html;
}

window.toggleRule=function(id){
  var r=rules.find(x=>x.id===id);if(!r)return;
  r.enabled=!r.enabled;save('rules',rules);updateStatus();
  showToast(r.enabled?'▶ 已启用':'⏸ 已暂停');openPage('rules');
};
window.delRule=function(id){
  rules=rules.filter(x=>x.id!==id);save('rules',rules);updateStatus();
  showToast('✅ 已删除');openPage('rules');
};

// === Settings page ===
function renderSettingsPage(container){
  var html='';
  html+='<div class="fold"><div class="fold-head" onclick="toggleFold(this)"><span>🔐 Telegram API</span><span class="fold-arrow">›</span></div><div class="fold-body">';
  html+='<label>API ID<input id="cfgApiId" value="'+(localStorage.getItem("tg_api_id")||"")+'" placeholder="从 my.telegram.org 获取"></label>';
  html+='<label>API Hash<input id="cfgApiHash" type="password" placeholder="加密保存"></label>';
  html+='<button class="primary" onclick="saveApiConfig()">保存</button>';
  html+='<div style="margin-top:10px"><button onclick="NexaNative?.startTelegram();showToast(\'⟳ 连接中...\')">连接 Telegram</button></div>';
  html+='</div></div>';
  html+='<div class="fold"><div class="fold-head" onclick="toggleFold(this)"><span>🤖 DeepSeek</span><span class="fold-arrow">›</span></div><div class="fold-body">';
  html+='<label>API Key<input id="cfgDsKey" type="password" value="'+deepseekKey+'" placeholder="用于 AI 助手"></label>';
  html+='<button class="primary" onclick="deepseekKey=$(\'cfgDsKey\').value;localStorage.setItem(\'deepseek_key\',deepseekKey);showToast(\'✅ 已保存\')">保存</button>';
  html+='</div></div>';
  html+='<div class="fold"><div class="fold-head" onclick="toggleFold(this)"><span>🌐 代理</span><span class="fold-arrow">›</span></div><div class="fold-body">';
  html+='<label>类型<select id="cfgProxyType"><option>关闭</option><option>SOCKS5</option><option>HTTP</option></select></label>';
  html+='<label>服务器<input id="cfgProxyHost" placeholder="127.0.0.1"></label>';
  html+='<label>端口<input id="cfgProxyPort" type="number" placeholder="1080"></label>';
  html+='<button class="primary" onclick="saveProxyCfg()">保存代理</button>';
  html+='</div></div>';
  container.innerHTML=html;
}

window.toggleFold=function(el){
  var body=el.nextElementSibling;body.classList.toggle('open');
  el.querySelector('.fold-arrow').classList.toggle('open');
};
window.saveApiConfig=function(){
  var id=$('cfgApiId').value.trim(),hash=$('cfgApiHash').value.trim();
  if(!id||!hash)return showToast('⚠ 请填写完整');
  localStorage.setItem('tg_api_id',id);
  NexaNative?.saveSecrets(id,hash,'');
  $('cfgApiHash').value='';showToast('✅ 已保存');
};
// === Proxy test ===
window.testProxy = function() {
  addSystemMsg('🌐 正在测试代理连接...');
  // NativeBridge will handle the actual test
  showToast('🌐 测试中...');
};

window.saveProxyCfg=function(){
  var type=$('cfgProxyType').value,host=$('cfgProxyHost').value.trim(),port=Number($('cfgProxyPort').value)||0;
  NexaNative?.saveProxy(type,host,port,'','');
  showToast('✅ 代理已保存');
};

// === Relay ===
const activeRules=new Set();
function runNativeRule(rule){
  if(!running||!rule.enabled||!window.NexaNative||activeRules.has(rule.id))return;
  var src=channels.find(c=>c.id===rule.source);
  var tgt=channels.find(c=>c.id===rule.target);
  if(!src?.telegramId||!tgt?.telegramId)return;
  activeRules.add(rule.id);
  NexaNative.runRelayRule(JSON.stringify({...rule,sourceChatId:src.telegramId,targetChatId:tgt.telegramId,checkpoint:/^\d+$/.test(String(rule.checkpoint))?String(rule.checkpoint):'0'}));
}

// === Telegram callbacks ===
window.nexaTelegramError=function(v){showToast('⚠ '+v);addLogLine('❌ Telegram: '+v);addSystemMsg('❌ Telegram 错误：'+v);};
window.nexaTelegramChannel=function(v){
  try{
    var item=JSON.parse(v);
    if(!channels.some(c=>c.telegramId===item.id)){
      channels.push({id:uid(),telegramId:item.id,name:item.name,role:'unassigned',syncAt:Date.now()});
      addLogLine('发现频道: '+item.name);
    }
    channelInfo[item.id]={members:item.memberCount||null,description:item.description||'',type:item.type||''};
    save('channels',channels);save('channelInfo',channelInfo);
  }catch{}
};
window.nexaRelayEvent=function(v){
  try{
    var event=JSON.parse(v),rule=rules.find(x=>x.id===event.ruleId);if(!rule)return;
    if(['forwarded','filtered'].includes(event.status)&&event.checkpoint!=='0'){rule.checkpoint=event.checkpoint;rule.processed=(rule.processed||0)+(event.count||0);save('rules',rules);}
    if(event.status==='forwarded')addLogLine('转发 '+event.count+' 条: '+event.message);
    else if(event.status==='idle')addLogLine(event.message);
    else if(event.status==='error'){addLogLine('❌ 错误: '+event.message);addSystemMsg('❌ 采集错误：'+event.message);}
    if(event.status==='blocked'){rule.enabled=false;activeRules.delete(rule.id);save('rules',rules);addLogLine('规则已暂停: '+event.message);}
  }catch{}
};
window.nexaTelegramState=function(step){
  if(step==='ready')setTdlibStatus('ready');
  else if(step==='starting')setTdlibStatus('connecting');
  else if(step==='closed'||step==='unsupported_auth_step')setTdlibStatus('error');

  var map={starting:'连接中...',phone:'输入手机号',code:'输入验证码',password:'输入密码',ready:'已连接',closed:'已断开'};
  addLogLine('Telegram: '+(map[step]||step));
  if(step==='ready')addSystemMsg('✅ Telegram 已连接，可以开始同步频道了');
};

// === Keyboard enter to send ===
document.addEventListener('keydown',function(e){
  if(e.key==='Enter'&&!e.shiftKey&&document.activeElement===$('chatInput')){e.preventDefault();sendChat();}
});

// === Init ===
function init(){
  // Check TDLib status
  if(running)setTdlibStatus('ready');
  else setTdlibStatus('uninitialized');
  // Log stream
  $('logBody').innerHTML='';
  logs.slice(0,10).reverse().forEach(function(l){
    var line=document.createElement('div');line.className='log-line';line.textContent=l;$('logBody').appendChild(line);
  });
  // Welcome
  addSystemMsg('⚡ RELAY 已就绪');
  if(!deepseekKey)addSystemMsg('💡 请在设置中配置 DeepSeek Key 以启用 AI 助手');
  if(!channels.length)addSystemMsg('📱 请先在设置中连接 Telegram 并同步频道');
  else addSystemMsg('📱 已有 '+channels.length+' 个频道，'+rules.length+' 条规则');
  updateStatus();
}

window.NexaNative&&init();
