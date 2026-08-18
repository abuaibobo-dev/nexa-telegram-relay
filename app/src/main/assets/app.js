const $ = id => document.getElementById(id);
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function showConfirm(msg, onOk) {
  var overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = '<div class="confirm-box"><p>' + esc(msg) + '</p><div class="confirm-actions"><button class="confirm-cancel" id="_cfm_no">取消</button><button class="confirm-ok" id="_cfm_yes">确定</button></div></div>';
  document.body.appendChild(overlay);
  overlay.querySelector('#_cfm_no').onclick = function() { overlay.remove(); };
  overlay.querySelector('#_cfm_yes').onclick = function() { overlay.remove(); onOk(); };
}

function showToast(msg, duration) {
  duration = duration || 2200;
  var existing = document.querySelector('.toast-capsule');
  if (existing) existing.remove();
  var t = document.createElement('div');
  t.className = 'toast-capsule';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(function() { t.classList.add('show'); });
  setTimeout(function() { t.classList.remove('show'); setTimeout(function() { t.remove(); }, 300); }, duration);
}

window.applyTemplate = function(type) {
  $('mediaType').value = type;
  document.querySelectorAll('.tpl-btn').forEach(function(b) { b.classList.remove('active'); });
  event.target.classList.add('active');
};

window.toggleFold = function(el) {
  var body = el.nextElementSibling;
  var arrow = el.querySelector('.fold-arrow');
  var isOpen = body.classList.contains('open');
  body.classList.toggle('open');
  arrow.classList.toggle('open');
};

// Long press on source items to quick bind
document.addEventListener('touchstart', function(e) {
  var item = e.target.closest('.ch-item');
  if (!item) return;
  var chId = item.querySelector('[onclick*="quickBind"]');
  if (!chId) return;
  var timer = setTimeout(function() {
    var match = chId.getAttribute('onclick').match(/quickBind\('(.+?)'\)/);
    if (match) window.quickBind(match[1]);
  }, 500);
  var cancel = function() { clearTimeout(timer); document.removeEventListener('touchend', cancel); document.removeEventListener('touchmove', cancel); };
  document.addEventListener('touchend', cancel);
  document.addEventListener('touchmove', cancel);
}, {passive: true});

function updateProgress() {
  var total = Number($('collected').textContent) || 0;
  var done = Number($('forwarded').textContent) || 0;
  var pct = total > 0 ? Math.round(done / total * 100) : 0;
  if ($('progressFill')) $('progressFill').style.width = pct + '%';
  if ($('progressText')) $('progressText').textContent = done + ' / ' + total + ' (' + pct + '%)';
}

let chTab = 'source';


function getChannelInfo(telegramId) {
  return channelInfo[telegramId] || null;
}

document.querySelectorAll('.ch-tab').forEach(function(btn) {
  btn.onclick = function() {
    document.querySelectorAll('.ch-tab').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    chTab = btn.dataset.tab;
    renderChannelList();
  };
});

let channels = read('channels', []);
let channelInfo = read('channelInfo', {});
let rules = read('rules', []);
let logs = read('logs', []);
let running = window.NexaNative ? NexaNative.relayServiceEnabled() : false;
const activeRules = new Set();

document.querySelectorAll('nav button').forEach(button => button.onclick = () => {
  document.querySelectorAll('nav button,.page').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  $(button.dataset.page).classList.add('active');
});

function addLog(message) {
  const stamp = new Date().toLocaleString('zh-CN', {hour12:false});
  logs.unshift(`[${stamp}] ${message}`);
  logs = logs.slice(0, 20);
  save('logs', logs);
  render();
}

function render() {
  const bound = new Set(rules.map(rule => rule.source));
  // Channel list with tabs
  var filtered = channels.filter(function(ch) {
    if (chTab === 'unassigned') return ch.role === 'unassigned';
    return ch.role === chTab;
  });
  // Sort: bound sources first
  filtered.sort(function(a, b) {
    var aBound = a.role === 'source' && boundSrc.has(a.id) ? 0 : 1;
    var bBound = b.role === 'source' && boundSrc.has(b.id) ? 0 : 1;
    return aBound - bBound;
  });
  var boundSrc = new Set(rules.map(function(r) { return r.source; }));
  $('srcCount').textContent = channels.filter(function(c) { return c.role === 'source'; }).length;
  $('tgtCount').textContent = channels.filter(function(c) { return c.role === 'target'; }).length;
  $('unCount').textContent = channels.filter(function(c) { return c.role === 'unassigned'; }).length;
  $('channelList').innerHTML = filtered.length ? filtered.map(function(channel) {
    var isBound = channel.role === 'source' && boundSrc.has(channel.id);
    var info = getChannelInfo(channel.telegramId);
    var infoLine = info ? (info.members ? info.members + ' 成员' : '') + (info.description ? ' · ' + info.description.slice(0,30) : '') : '';
    var roleTag = channel.role === 'source' ? (isBound ? '已绑定' : '来源') : channel.role === 'target' ? '目标' : '待分配';
    var tagCls = isBound ? 'tag bound' : 'tag ' + channel.role;
    var actions = '';
    if (channel.role === 'unassigned') {
      actions = '<button onclick="assignRole(\'' + channel.id + '\',\'source\')">来源</button><button onclick="assignRole(\'' + channel.id + '\',\'target\')">目标</button>';
    } else if (channel.role === 'source' && !isBound) {
      actions = '<button class="bind-src" onclick="quickBind(\'' + channel.id + '\')">绑定目标</button>';
    }
    actions += '<button onclick="showChInfo(\'' + channel.id + '\')">详情</button>';
    actions += '<button onclick="removeChannel(\'' + channel.id + '\')">删除</button>';
    return '<div class="item ch-item' + (isBound ? ' item-bound' : '') + '"><div class="item-head"><div><b>' + esc(channel.name) + '</b><small>' + (infoLine || (channel.role === 'unassigned' ? '待分配' : roleTag)) + '</small></div><span class="' + tagCls + '">' + roleTag + '</span></div><div class="item-actions">' + actions + '</div></div>';
  }).join('') : '<div class="notice">暂无' + (chTab === 'source' ? '来源' : chTab === 'target' ? '目标' : '待分配') + '频道</div>';

  const targets = channels.filter(channel => channel.role === 'target');
  const available = channels.filter(channel => channel.role === 'source' && !bound.has(channel.id));
  const allSources = channels.filter(channel => channel.role === 'source');
  $('ruleTarget').innerHTML = targets.length ? targets.map(channel => {
    return `<label class="check-item"><input type="checkbox" class="target-check" value="${channel.id}"><span>${esc(channel.name)}</span></label>`;
  }).join('') : '<div class="notice">暂无目标频道，请先同步并设置目标身份</div>';
  $('ruleSource').innerHTML = available.length ? available.map(channel => `<option value="${channel.id}">${esc(channel.name)}</option>`).join('') : '<option disabled>所有来源频道均已绑定</option>';
  // Show bound sources in the channel list with visual indicator
  if (allSources.length > available.length) {
    var boundSources = allSources.filter(ch => bound.has(ch.id));
    // Will be shown in channelList render above
  }
  $('ruleList').innerHTML = rules.length ? rules.map(rule => {
    const source = channels.find(channel => channel.id === rule.source);
    const target = channels.find(channel => channel.id === rule.target);
    return `<div class="item"><div class="item-head"><div><b>${esc(rule.note || source?.name || '未命名规则')}</b><small>${esc(source?.name || '已删除来源')} → ${esc(target?.name || '已删除目标')} · ${esc(rule.type)} · ${rule.checkpoint ? `断点 ${esc(rule.checkpoint)}` : esc(rule.startMode || '最早消息')}</small></div><span class="tag">${rule.enabled ? '运行' : '暂停'}</span></div><div class="item-actions"><button onclick="showRule('${rule.id}')">详情</button><button onclick="toggleRule('${rule.id}')">${rule.enabled ? '暂停' : '启用'}</button><button onclick="deleteRule('${rule.id}')">解除绑定</button></div></div>`;
  }).join('') : '<div class="notice">还没有采集规则。</div>';

  updateProgress(); if ($('logList')) $('logList').innerHTML = logs.length ? logs.map(function(l) { return '<div class="log-line">' + esc(l) + '</div>'; }).join('') : '<div class="log-empty">暂无记录</div>';
  $('running').textContent = rules.filter(rule => rule.enabled).length;
  $('health').textContent = running ? '后台安全运行中' : rules.length ? '配置就绪' : '待配置';
  const invalidRules = rules.filter(rule => rule.enabled).filter(rule => !channels.find(channel => channel.id === rule.source)?.telegramId || !channels.find(channel => channel.id === rule.target)?.telegramId).length;
  $('systemAlert').classList.toggle('error', invalidRules > 0);
  $('systemAlert').textContent = invalidRules ? `${invalidRules} 条启用规则使用了规划频道，无法执行` : running ? '服务正常运行；异常会在这里优先提示' : rules.length ? '规则已就绪，可以启动采集' : '请按四步引导完成首次配置';
}

$('addChannel').onclick = () => {
  const name = $('channelName').value.trim();
  if (!name) return alert('请输入频道名称或用户名');
  channels.push({id:uid(), name, role:$('channelRole').value});
  save('channels', channels); $('channelName').value = '';
  addLog(`添加${channels.at(-1).role === 'source' ? '来源' : '目标'}频道：${name}`);
};

window.removeChannel = id => {
  if (rules.some(rule => rule.source === id || rule.target === id)) return alert('请先解除该频道的绑定规则');
  channels = channels.filter(channel => channel.id !== id); save('channels', channels); render();
};
window.assignRole = (id, role) => {
  const channel = channels.find(item => item.id === id); if (!channel) return;
  channel.role = role; save('channels', channels); addLog(`${channel.name} 已标记为${role === 'source' ? '来源频道' : '目标频道'}`);
};

$('bindRule').onclick = () => {
  const source = $('ruleSource').value, target = $('ruleTarget').value;
  if (!source || !target) return alert('需要一个未绑定来源和一个目标频道');
  rules.push({id:uid(), source, target, note:$('ruleNote').value.trim(), startMode:$('startMode').value, startMessageId:$('startMessageId').value.trim(), type:$('mediaType').value, album:$('albumMode').value, captionMode:$('captionMode').value, keywords:$('keywords').value.trim(), dailyLimit:Number($('dailyLimit').value)||0, runFrom:Number($('runFrom').value)||0, runTo:Number($('runTo').value)||24, enabled:true, checkpoint:null, processed:0});
  save('rules', rules); addLog('创建采集规则并完成来源唯一绑定');
};

window.toggleRule = id => {
  const rule = rules.find(item => item.id === id); if (!rule) return;
  rule.enabled = !rule.enabled;
  if (!rule.enabled) { activeRules.delete(id); window.NexaNative?.stopRelayRule(id); }
  else if (running) runNativeRule(rule);
  save('rules', rules); addLog(`规则已${rule.enabled ? '启用' : '暂停'}`);
};
window.deleteRule = id => {
  showConfirm('解除绑定后可重新创建规则？', function() {
    activeRules.delete(id); window.NexaNative?.stopRelayRule(id);
    rules = rules.filter(rule => rule.id !== id); save('rules', rules);
    showToast('✅ 已解除绑定'); addLog('解除频道绑定');
  });
};
window.clearMemory = id => {
  showConfirm('确认清空断点？下次启用从历史最早消息重新扫描。', function() {
    const rule = rules.find(item => item.id === id); if (!rule) return;
    rule.enabled = false; rule.checkpoint = null; rule.processed = 0;
    activeRules.delete(id); window.NexaNative?.stopRelayRule(id); window.NexaNative?.clearRelayCheckpoint(id);
    save('rules', rules); showToast('✅ 断点已清空'); addLog('已清空断点记忆，规则自动暂停');
  });
};
window.showRule = id => { const rule = rules.find(item => item.id === id); if (rule) alert(JSON.stringify(rule, null, 2)); };

window.quickBind = function(chId) {
  var source = channels.find(function(c) { return c.id === chId; });
  if (!source) return;
  var targets = channels.filter(function(c) { return c.role === 'target'; });
  if (!targets.length) return showToast('⚠ 请先添加目标频道');
  // Create inline bind panel
  var existing = document.querySelector('.bind-panel');
  if (existing) existing.remove();
  var panel = document.createElement('div');
  panel.className = 'bind-panel';
  panel.innerHTML = '<div class="bind-panel-inner"><div class="bind-title">绑定 ' + esc(source.name) + ' 到目标</div>' +
    targets.map(function(t) {
      var bound = rules.some(function(r) { return r.source === chId && r.target === t.id; });
      return '<label class="check-item"><input type="checkbox" class="target-check" value="' + t.id + '"' + (bound ? ' checked disabled' : '') + '><span>' + esc(t.name) + (bound ? ' (已绑定)' : '') + '</span></label>';
    }).join('') +
    '<div class="bind-actions"><button class="confirm-cancel" onclick="this.closest(\'.bind-panel\').remove()">取消</button><button class="confirm-ok" onclick="doQuickBind(\'' + chId + '\', this)">确认绑定</button></div></div>';
  document.body.appendChild(panel);
};

window.doQuickBind = function(chId, btn) {
  var checks = document.querySelectorAll('.bind-panel .target-check:checked:not(:disabled)');
  var targets = Array.from(checks).map(function(cb) { return cb.value; });
  if (!targets.length) return showToast('⚠ 请选择目标频道');
  targets.forEach(function(t) {
    rules.push({
      id: uid(), source: chId, target: t, note: '', startMode: '最早消息', startMessageId: '',
      type: '全部内容', album: '整组保留', captionMode: '保留说明', keywords: '',
      dailyLimit: 0, runFrom: 0, runTo: 24, enabled: true, checkpoint: null, processed: 0,
    });
  });
  save('rules', rules);
  document.querySelector('.bind-panel').remove();
  showToast('✅ 已绑定 ' + targets.length + ' 个目标');
  render();
};

window.showChInfo = function(chId) {
  var ch = channels.find(function(c) { return c.id === chId; });
  if (!ch) return;
  var info = getChannelInfo(ch.telegramId);
  var bound = rules.some(function(r) { return r.source === chId; });
  var ruleCount = rules.filter(function(r) { return r.source === chId || r.target === chId; }).length;
  var overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = '<div class="confirm-box ch-info-box"><p><b>' + esc(ch.name) + '</b></p>' +
    '<div class="ch-info-detail">' +
    '<div>身份：' + (ch.role === 'source' ? '来源频道' : ch.role === 'target' ? '目标频道' : '待分配') + '</div>' +
    (info ? '<div>成员：' + (info.members || '未知') + '</div>' : '') +
    (info && info.description ? '<div>简介：' + esc(info.description.slice(0,80)) + '</div>' : '') +
    '<div>关联规则：' + ruleCount + ' 条</div>' +
    '<div>绑定状态：' + (bound ? '已绑定' : '未绑定') + '</div>' +
    '</div><div class="confirm-actions"><button class="confirm-ok" onclick="this.closest(\'.confirm-overlay\').remove()">关闭</button></div></div>';
  document.body.appendChild(overlay);
};

function runNativeRule(rule) {
  if (!running || !rule.enabled || !window.NexaNative || activeRules.has(rule.id)) return;
  const source = channels.find(channel => channel.id === rule.source);
  const target = channels.find(channel => channel.id === rule.target);
  if (!source?.telegramId || !target?.telegramId) return;
  activeRules.add(rule.id);
  NexaNative.runRelayRule(JSON.stringify({...rule, sourceChatId:source.telegramId, targetChatId:target.telegramId, checkpoint:/^\d+$/.test(String(rule.checkpoint)) ? String(rule.checkpoint) : '0'}));
}

$('pauseAll').onclick = () => { rules.forEach(rule => { rule.enabled=false; window.NexaNative?.stopRelayRule(rule.id); }); activeRules.clear(); save('rules', rules); showToast('⏸ 已暂停全部'); addLog('已暂停全部规则'); };
$('resumeAll').onclick = () => { rules.forEach(rule => rule.enabled=true); save('rules', rules); if (running) rules.forEach(runNativeRule); showToast('▶ 已恢复全部'); addLog('已恢复全部规则'); };
$('exportConfig').onclick = () => prompt('复制并妥善保存配置 JSON', JSON.stringify({version:1,channels,rules}, null, 2));
$('importConfig').onclick = () => { const value=prompt('粘贴配置 JSON'); if (!value) return; try { const data=JSON.parse(value); if (!Array.isArray(data.channels)||!Array.isArray(data.rules)) throw new Error(); channels=data.channels; rules=data.rules; save('channels',channels); save('rules',rules); showToast('✅ 配置已导入'); addLog('配置导入成功'); } catch { showToast('⚠ 配置格式无效'); } };
if ($('exportLogs')) $('exportLogs').onclick = function() { prompt('复制日志', logs.join('\n')); };
if ($('clearLogs')) $('clearLogs').onclick = function() { showConfirm('确定清空日志？', function() { logs=[]; save('logs',logs); render(); showToast('✅ 日志已清空'); }); };

$('toggleRun').onclick = () => {
  if (!rules.length) return showToast('⚠ 请先创建采集规则');
  if (!window.NexaNative) return showToast('⚠ 当前环境不支持采集');
  const invalid = rules.filter(rule => rule.enabled).some(rule => !channels.find(channel => channel.id === rule.source)?.telegramId || !channels.find(channel => channel.id === rule.target)?.telegramId);
  if (invalid) return showToast('⚠ 包含未同步频道，无法采集');
  running = !running;
  NexaNative.setRelayService(running);
  $('service').classList.toggle('on', running);
  $('service').innerHTML = `<i></i>${running ? '后台运行中' : '已停止'}`;
  $('toggleRun').textContent = running ? '停止采集' : '启动安全采集';
  if (running) rules.filter(rule => rule.enabled).forEach(runNativeRule);
  else { activeRules.clear(); NexaNative.stopAllRelayRules(); }
  showToast(running ? '🟢 采集已启动' : '⏹ 采集已停止'); addLog(running ? '启动原生后台采集与安全限速' : '停止全部采集规则');
};
$('emergencyStop').onclick = () => {
  showConfirm('紧急停止全部任务？', function() {
    running=false; rules.forEach(rule=>rule.enabled=false); activeRules.clear(); save('rules',rules);
    if (window.NexaNative) { NexaNative.stopAllRelayRules(); NexaNative.setRelayService(false); }
    showToast('🛑 已紧急停止'); addLog('已执行紧急停止，全部规则暂停');
  });
};

function installSettingsPanels() {
  const settingsPanel = $('saveSettings') ? $('saveSettings').closest('.fold-body') : null;
  if (!settingsPanel) return;
  // Add Telegram login controls to the Telegram fold section
  const tgStatus = $('tgStatus');
  if (tgStatus) {
    tgStatus.innerHTML = '<div id="tgState" class="tg-state">未连接</div><label id="tgInputLabel" style="display:none">手机号<input id="tgInput" placeholder="+86 13800000000"></label><button class="primary" id="tgAction" style="margin-top:10px">连接 Telegram</button><button class="primary secondary" id="tgSync" style="margin-top:6px">⟳ 同步频道</button>';
  }

  let tgStep = 'start';
  const configureStep = step => {
    tgStep = step;
    const states = {starting:['正在启动','',false], phone:['输入手机号','+86 13800000000',true], code:['输入验证码','Telegram 验证码',true], password:['输入二次密码','两步验证密码',true], ready:['已登录','',false], closed:['会话已关闭','',false], unsupported_auth_step:['需要其他验证步骤','',false]};
    const state = states[step] || ['等待连接','',false];
    $('tgState').textContent = state[0]; $('tgInputLabel').style.display = state[2] ? 'block' : 'none';
    $('tgInput').placeholder = state[1]; $('tgInput').value = ''; $('tgInput').type = step === 'password' ? 'password' : 'text';
    $('tgAction').textContent = step === 'start' ? '连接 Telegram' : step === 'phone' ? '发送验证码' : step === 'code' ? '验证登录' : step === 'password' ? '提交密码' : step === 'ready' ? '已连接' : '重新连接';
  };
  $('tgAction').onclick = () => {
    if (['start','closed','unsupported_auth_step'].includes(tgStep)) { if (!NexaNative.startTelegram()) showToast('⚠ 请先保存 API 配置'); }
    else if (tgStep === 'phone') NexaNative.submitTelegramPhone($('tgInput').value);
    else if (tgStep === 'code') NexaNative.submitTelegramCode($('tgInput').value);
    else if (tgStep === 'password') NexaNative.submitTelegramPassword($('tgInput').value);
  };
  $('tgSync').onclick = function() { showToast('⟳ 正在同步...'); NexaNative.syncTelegramChannels(); };
  $('testAi').onclick = () => { $('aiResult').textContent = '分析中…'; NexaNative.analyzeContent($('aiSample').value); };
  window.nexaTelegramState = configureStep;
  configureStep('start');
}

$('saveSettings').onclick = () => {
  if (!window.NexaNative) return showToast('⚠ 当前环境不支持安全存储');
  const apiId = $('apiId').value.trim(), apiHash = $('apiHash').value.trim(), deepSeek = $('deepseekKey').value.trim();
  if (apiId && !/^\d+$/.test(apiId)) return alert('Telegram API ID 必须是数字');
  if (!apiId || !apiHash) return showToast('⚠ 请填写 API ID 和 API Hash');
  if (NexaNative.saveSecrets(apiId, apiHash, deepSeek)) { $('apiHash').value = ''; $('deepseekKey').value = ''; showToast('✅ 配置已安全保存'); addLog('敏感配置已写入 Android Keystore 加密存储'); }
};
$('saveProxy').onclick = () => {
  const type=$('proxyType').value, server=$('proxyServer').value.trim(), port=Number($('proxyPort').value)||0;
  if (type !== '关闭' && (!server || port < 1 || port > 65535)) return showToast('⚠ 请填写有效的代理地址');
  if (NexaNative.saveProxy(type, server, port, $('proxyUser').value, $('proxyPassword').value)) { $('proxyPassword').value=''; showToast('✅ 代理已保存'); addLog(type === '关闭' ? '代理已关闭' : `${type} 代理已保存并应用`); }
};

window.nexaTelegramError = value => { alert(`Telegram：${value}`); addLog('Telegram 连接错误（敏感信息已隐藏）'); };
window.nexaTelegramChannel = value => { try { var item = JSON.parse(value); if (!channels.some(function(ch) { return ch.telegramId === item.id; })) { channels.push({id:uid(), telegramId:item.id, name:item.name, role:'unassigned', syncAt:Date.now()}); } channelInfo[item.id] = {members: item.memberCount || item.members || null, description: item.description || item.title || '', type: item.type || ''}; save('channels', channels); render(); } catch(e) {} };
window.nexaRelayEvent = value => {
  try {
    const event = JSON.parse(value), rule = rules.find(item => item.id === event.ruleId); if (!rule) return;
    if (['forwarded','filtered'].includes(event.status) && event.checkpoint !== '0') { rule.checkpoint = event.checkpoint; rule.processed = (rule.processed || 0) + (event.count || 0); save('rules', rules); }
    if (event.status === 'forwarded') { $('forwarded').textContent = Number($('forwarded').textContent || 0) + (event.count || 0); $('collected').textContent = Number($('collected').textContent || 0) + (event.count || 0); }
    else if (event.status === 'filtered') $('filtered').textContent = Number($('filtered').textContent || 0) + 1;
    else if (event.status === 'blocked') { rule.enabled = false; activeRules.delete(rule.id); save('rules', rules); }
    if (['blocked','error','flood_wait'].includes(event.status)) { $('systemAlert').classList.add('error'); $('systemAlert').textContent = event.message; }
    addLog(event.status === 'flood_wait' ? `触发 Telegram 限流，已自动退避：${event.message}` : event.message);
  } catch { addLog('采集回调解析失败'); }
};
window.nexaAiResult = value => { try { $('aiResult').textContent = JSON.stringify(JSON.parse(value), null, 2); } catch { $('aiResult').textContent = value; } addLog('完成一次 DeepSeek 广告分析'); };
window.nexaAiError = value => { $('aiResult').textContent = value; addLog('DeepSeek 分析失败'); };

function installMaintenancePanel() {
  const panel = document.createElement('section'); panel.className = 'glass panel maintenance';
  panel.innerHTML = '<div class="panel-title"><div><small>AI MAINTENANCE</small><h2>智能维护</h2></div><span id="maintenanceState">等待扫描</span></div><p class="maintenance-copy">只分析绑定、规则、断点和失败记录，不提供聊天功能，也不会自动执行高风险操作。</p><button class="primary" id="runMaintenance">运行健康扫描</button><pre id="maintenanceReport" class="ai-result">尚未生成维护报告</pre>';
  $('dashboard').appendChild(panel);
  $('runMaintenance').onclick = () => { $('maintenanceState').textContent = '扫描中'; $('maintenanceReport').textContent = '正在分析本地运行快照…'; NexaNative.runMaintenance(JSON.stringify({channels:channels.map(({id,role,name})=>({id,role,name})), rules, recentLogs:logs.slice(0,40), running})); };
  window.nexaMaintenanceResult = value => { try { const data = JSON.parse(value); $('maintenanceReport').textContent = JSON.stringify(data, null, 2); $('maintenanceState').textContent = data.health === 'healthy' ? '状态良好' : data.health === 'critical' ? '需要处理' : '发现建议'; } catch { $('maintenanceReport').textContent = value; $('maintenanceState').textContent = '报告完成'; } addLog('智能维护扫描完成'); };
  window.nexaMaintenanceError = value => { $('maintenanceReport').textContent = value; $('maintenanceState').textContent = '扫描失败'; };
}

if (window.NexaNative) { installSettingsPanels(); installMaintenancePanel(); }
if (window.NexaNative) {
  try {
    const snapshot = JSON.parse(NexaNative.runtimeSnapshot());
    $('forwarded').textContent = snapshot.forwarded || 0;
    $('filtered').textContent = snapshot.filtered || 0;
    $('collected').textContent = (snapshot.forwarded || 0) + (snapshot.filtered || 0);
    if (!logs.length && Array.isArray(snapshot.events)) {
      logs = snapshot.events.map(event => `[后台记录] ${event.message || event.status}`).slice(0, 100);
      save('logs', logs);
    }
  } catch {}
  $('service').classList.toggle('on', running);
  $('service').innerHTML = `<i></i>${running ? '后台运行中' : '已停止'}`;
  $('toggleRun').textContent = running ? '停止采集' : '启动采集';
}
render();
