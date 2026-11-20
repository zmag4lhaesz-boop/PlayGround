import './style.css';
import { LocalRepository, DEFAULT_FIELDS } from './storage.js';
import { avatar, escapeHtml, icon, toast } from './components.js';

const repo = new LocalRepository();
const app = document.querySelector('#app');
const ui = { screen: 'lobby', campaignId: null, query: '', modal: '', pendingCover: '', pendingPortrait: '', fieldDraft: [...DEFAULT_FIELDS], pressTimer: null, pressedCard: null, pressOrigin: null, ignoreNextClick: false };

// Escapa textos antes de mostrá-los e reutiliza as mesmas funções de tela entre navegações.
function render() {
  if (!repo.user) return renderAuth();
  if (ui.screen === 'sheet') return renderSheet();
  if (ui.screen === 'chat') return renderChat();
  return renderLobby();
}
function topbar() {
  return `<header class="topbar"><button class="brand" data-action="home"><span class="brand-mark">${icon('book',20)}</span><span><span class="brand-title">RPG Hub</span><span class="brand-sub">sua mesa, sua história</span></span></button><div class="top-actions">${ui.screen === 'lobby' ? `<label class="search-wrap">${icon('search',17)}<input id="search" type="search" placeholder="Buscar aventuras..." value="${escapeHtml(ui.query)}" aria-label="Buscar RPGs"></label>` : ''}<div class="user-chip">${avatar(repo.user.name, repo.user.avatar)}<span>${escapeHtml(repo.user.name)}</span><button data-action="logout">Sair</button></div></div></header>`;
}
function renderAuth() {
  app.innerHTML = `<main class="auth-screen"><section class="auth-card"><div class="auth-logo"><span class="brand-mark">${icon('book',22)}</span><span><span class="brand-title">RPG Hub</span><span class="brand-sub">sua mesa, sua história</span></span></div><div class="eyebrow">A aventura começa aqui</div><h1>Entre para jogar.</h1><p>Escolha um nome de jogador para criar ou encontrar sua mesa. Nesta versão, sua conta e suas aventuras ficam salvas neste dispositivo.</p><form id="auth-form"><div class="field"><label for="username">Nome de jogador</label><input id="username" name="username" maxlength="24" autocomplete="nickname" placeholder="Ex.: Lira da Lua" required /></div><button class="button" type="submit">${icon('spark',17)} Entrar na taverna</button></form><div class="auth-foot">Versão local para prototipagem. O acesso entre dispositivos será habilitado com um backend em tempo real.</div></section></main>`;
}
function renderLobby() {
  const filtered = repo.campaigns.filter((campaign) => `${campaign.name} ${campaign.description}`.toLowerCase().includes(ui.query.toLowerCase()));
  app.innerHTML = `<main class="app-shell">${topbar()}<section class="hero"><div><div class="eyebrow">Bem-vindo à mesa, ${escapeHtml(repo.user.name)}</div><h1>Que história vamos<br class="desktop-break"/> contar hoje?</h1><p>Suas campanhas e aventuras esperam por você.</p></div><div class="hero-note">${icon('dice',17)}<br/>Reúna o grupo. Role os dados.<br/>Crie algo lendário.</div></section><div class="section-row"><h2>${ui.query ? 'Resultados da busca' : 'Suas aventuras'}</h2><span>${filtered.length} ${filtered.length === 1 ? 'campanha' : 'campanhas'}</span></div><section class="campaign-grid">${filtered.length ? filtered.map(campaignCard).join('') : `<div class="empty-state"><div class="empty-emblem">${icon('book',22)}</div><h3>${ui.query ? 'Nenhuma aventura encontrada' : 'Sua próxima aventura começa aqui'}</h3><p>${ui.query ? 'Tente buscar por outro nome ou descrição.' : 'Crie um mundo para seus amigos ou entre em uma mesa com um código de convite.'}</p>${ui.query ? '' : `<button class="button small" data-action="create">${icon('plus',15)} Criar primeira campanha</button> <button class="button small secondary" data-action="join">Entrar com código</button>`}</div>`}</section><button class="button fab" data-action="create">${icon('plus',21)} Nova campanha</button></main>`;
  const search = document.querySelector('#search');
  search?.addEventListener('input', (event) => { const cursor = event.target.selectionStart; ui.query = event.target.value; renderLobby(); const next = document.querySelector('#search'); next?.focus(); next?.setSelectionRange(cursor, cursor); });
}
function campaignCard(campaign) {
  const isGM = repo.user.id === campaign.gmId;
  const members = campaign.members.map((id) => repo.state.users.find((user) => user.id === id)).filter(Boolean).slice(0, 4);
  return `<article class="campaign-card${isGM ? ' long-pressable' : ''}" data-action="open-campaign" data-id="${campaign.id}"${isGM ? ' aria-label="Segure para excluir esta campanha"' : ''}><div class="campaign-cover">${campaign.cover ? `<img src="${campaign.cover}" alt="Capa de ${escapeHtml(campaign.name)}"/>` : `<div class="cover-art"><span class="cover-symbol">✦</span><span class="cover-label">Crônicas · ${escapeHtml(campaign.name)}</span></div>`}<span class="role-pill">${isGM ? '✧ MESTRE' : '✦ JOGADOR'}</span></div><div class="card-body"><div class="card-title-row"><h3>${escapeHtml(campaign.name)}</h3><span class="card-count">${campaign.members.length} ${campaign.members.length === 1 ? 'membro' : 'membros'}</span></div><p>${escapeHtml(campaign.description || 'Uma aventura aguarda seus heróis.')}</p><div class="card-footer"><div class="avatars">${members.map((user) => avatar(user.name, user.avatar)).join('')}</div><span>Mestre: ${escapeHtml(campaign.gmName)}</span></div></div></article>`;
}
function renderSheet() {
  const campaign = repo.getCampaign(ui.campaignId);
  if (!campaign) { ui.screen = 'lobby'; return render(); }
  const character = repo.getCharacter(campaign);
  const values = character?.values || {};
  const fields = campaign.fields?.length ? campaign.fields : DEFAULT_FIELDS;
  app.innerHTML = `<main class="app-shell">${topbar()}<section class="page-heading"><button class="back-link" data-action="back-lobby">${icon('back',16)} Voltar às aventuras</button><div class="eyebrow">${escapeHtml(campaign.name)}</div><h1>Character Sheet</h1><p>${character ? 'Sua ficha de personagem. Edite seus detalhes e salve quando estiver pronto.' : 'Crie seu herói para entrar na aventura.'}</p></section><form id="sheet-form" class="sheet-layout"><aside class="sheet-aside"><label class="portrait-upload" for="portrait-file">${ui.pendingPortrait || character?.portrait ? `<img src="${ui.pendingPortrait || character.portrait}" alt="Retrato do personagem"/>` : `<span class="portrait-empty"><span>${icon('image',23)}</span><small>Adicionar retrato</small></span>`}<input id="portrait-file" type="file" accept="image/*"/></label><h3>${escapeHtml(values.Nome || character?.name || 'Novo herói')}</h3><p>Retrato visível para todos os jogadores na mesa.</p></aside><section class="sheet-main"><h2>Ficha do personagem</h2><p>Preencha o que fizer sentido para a sua história. Campos definidos pelo mestre.</p><div class="sheet-grid">${fields.map((field) => sheetField(field, values[field] || '')).join('')}</div><div class="sticky-save"><button class="button" type="submit">${icon('shield',16)} Salvar e entrar na mesa</button></div></section></form></main>`;
  document.querySelector('#portrait-file')?.addEventListener('change', async (event) => { ui.pendingPortrait = await readImage(event.target.files[0]); renderSheet(); });
}
function sheetField(name, value) {
  const long = /história|aparência|personalidade|objetivo|inventário|atributo/i.test(name);
  return `<div class="field"><label for="sheet-${escapeHtml(name)}">${escapeHtml(name)}${name === 'Nome' ? ' <span>obrigatório</span>' : ''}</label>${long ? `<textarea id="sheet-${escapeHtml(name)}" name="${escapeHtml(name)}" placeholder="Conte um pouco...">${escapeHtml(value)}</textarea>` : `<input id="sheet-${escapeHtml(name)}" name="${escapeHtml(name)}" value="${escapeHtml(value)}" placeholder="${name === 'Nome' ? 'Nome do personagem' : `Adicionar ${name.toLowerCase()}`}" ${name === 'Nome' ? 'required' : ''}/>`}</div>`;
}
function renderChat() {
  const campaign = repo.getCampaign(ui.campaignId);
  if (!campaign) { ui.screen = 'lobby'; return render(); }
  const character = repo.getCharacter(campaign);
  if (!character) { ui.screen = 'sheet'; return render(); }
  const isGM = repo.user.id === campaign.gmId;
  app.innerHTML = `<main class="app-shell">${topbar()}<section class="page-heading"><button class="back-link" data-action="back-lobby">${icon('back',16)} Voltar às aventuras</button><div class="eyebrow">Mesa virtual · ${campaign.members.length} jogadores</div><h1>${escapeHtml(campaign.name)}</h1><p>Uma história compartilhada, uma rolagem de cada vez.</p></section><section class="chat-layout"><div class="chat-panel"><div class="chat-top"><div class="chat-campaign"><span class="brand-mark">${icon('dice',17)}</span><div><strong>${escapeHtml(campaign.name)}</strong><small><span class="live-dot"></span> Mesa ativa · Mestre ${escapeHtml(campaign.gmName)}</small></div></div><div class="chat-actions"><button class="ghost-btn small invite-inline" data-action="character">${icon('user',15)} Minha ficha</button><button class="icon-btn" data-action="members" aria-label="Mostrar membros">${icon('user',17)}</button></div></div><div class="chat-scroll" id="chat-scroll">${renderMessages(campaign)}</div><form class="composer" id="chat-form"><p class="command-hint">Use <b>/d20</b> ou <b>/2d6+3</b> para rolar dados · ${isGM ? '<b>!gm</b> para narrar como mestre' : 'ações entre *asteriscos* aparecem em itálico'}</p><div class="composer-row"><textarea id="chat-input" rows="1" placeholder="Escreva sua mensagem..." maxlength="1200" aria-label="Mensagem"></textarea><button class="button send-btn" type="submit" aria-label="Enviar">${icon('send',17)}</button></div></form></div><aside class="side-stack"><section class="sidebar-panel"><h3>Jogadores na mesa</h3>${campaign.members.map((id) => memberRow(campaign, id)).join('')}</section><section class="sidebar-panel"><h3>Código de convite</h3><div class="invite-code"><span>${campaign.inviteCode}</span><button data-action="copy" aria-label="Copiar código">${icon('copy',16)}</button></div><p class="invite-caption">Compartilhe este código com seus amigos para que entrem nesta campanha.</p></section></aside></section>${isGM ? `<button class="gm-tools" data-action="suggestions" aria-label="Sugestões privadas do mestre"><span class="icon-btn">${icon('bulb',19)}</span></button>` : ''}</main>`;
  const scroll = document.querySelector('#chat-scroll');
  scroll.scrollTop = scroll.scrollHeight;
  document.querySelector('#chat-input')?.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); document.querySelector('#chat-form').requestSubmit(); } });
}
function memberRow(campaign, id) {
  const user = repo.state.users.find((item) => item.id === id);
  if (!user) return '';
  const char = repo.getCharacter(campaign, id);
  return `<div class="member-row">${avatar(char?.name || user.name, char?.portrait || user.avatar)}<span><strong>${escapeHtml(char?.name || user.name)}</strong><small>${id === campaign.gmId ? 'Mestre do jogo' : char ? 'Jogador' : 'Preparando personagem'}</small></span></div>`;
}
function renderMessages(campaign) {
  if (!campaign.messages.length) return '<div class="day-divider">A aventura começa</div>';
  return `<div class="day-divider">Registro da aventura</div>${campaign.messages.map((message) => {
    if (message.role === 'system') return `<div class="message system"><div class="bubble">${escapeHtml(message.text)}</div></div>`;
    const own = message.userId === repo.user.id;
    const type = message.type === 'dice' ? 'dice' : '';
    const gm = message.role === 'gm' ? 'gm' : '';
    const action = message.text.startsWith('*') && message.text.endsWith('*');
    const time = new Date(message.time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `<article class="message ${own ? 'own' : ''} ${gm} ${type}">${avatar(message.name, message.portrait)}<div class="message-content"><div class="message-meta"><strong>${escapeHtml(message.name)}${message.role === 'gm' ? ' · MESTRE' : ''}</strong>${time}</div><div class="bubble ${action ? 'message-action' : ''}">${escapeHtml(message.text)}</div></div></article>`;
  }).join('')}`;
}

function showModal(title, subtitle, content) {
  document.querySelector('.modal-backdrop')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-action="dismiss-modal"><section class="modal" role="dialog" aria-modal="true"><header class="modal-head"><div><div class="eyebrow">RPG Hub</div><h2>${title}</h2><p>${subtitle}</p></div><button class="icon-btn" data-action="close-modal" aria-label="Fechar">${icon('close',18)}</button></header><div class="modal-content">${content}</div></section></div>`);
}
function showDeleteConfirmation(campaignId) {
  const campaign = repo.getCampaign(campaignId);
  if (!campaign || campaign.gmId !== repo.user?.id) return;
  showModal('Excluir campanha?', `Tem certeza que deseja excluir “${escapeHtml(campaign.name)}”? Esta ação não pode ser desfeita.`, `<div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Não</button><button class="button danger" type="button" data-action="confirm-delete-campaign" data-id="${campaign.id}">Sim, excluir</button></div>`);
}

function showCreateModal() {
  ui.pendingCover = '';
  ui.fieldDraft = [...DEFAULT_FIELDS];
  showModal('Criar campanha', 'Defina o mundo e prepare a ficha dos personagens.', `<form id="create-form"><div class="field"><label for="campaign-name">Nome da campanha</label><input id="campaign-name" name="name" maxlength="50" placeholder="Ex.: As Cinzas de Eldoria" required /></div><div class="field"><label for="campaign-description">Descrição breve</label><textarea id="campaign-description" name="description" maxlength="220" placeholder="Uma pista do mundo, do tom ou da aventura..."></textarea></div><div class="field"><label>Capa da aventura <span style="color:#89867e;font-weight:400">(opcional)</span></label><div class="upload-row"><div class="upload-preview">${ui.pendingCover ? `<img src="${ui.pendingCover}" style="width:100%;height:100%;object-fit:cover;border-radius:9px"/>` : icon('image',20)}</div><div><label for="cover-file">${ui.pendingCover ? 'Trocar imagem' : 'Escolher da galeria'}</label><p>Imagem JPG ou PNG</p><input id="cover-file" type="file" accept="image/*"/></div></div></div><div class="field"><label>Campos da ficha de personagem</label><div class="chips" id="field-chips">${renderFieldChips()}</div><div class="add-field-row"><input class="text-input" id="new-field" placeholder="Novo campo personalizado" maxlength="35"/><button class="button secondary small" type="button" data-action="add-field">${icon('plus',15)} Adicionar</button></div><small>Toque no × para remover um campo. Os campos básicos já vêm incluídos.</small></div><div class="notice">Você será o Mestre do Jogo desta campanha. Seus amigos poderão entrar usando um código único.</div><div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancelar</button><button class="button" type="submit">${icon('spark',16)} Criar campanha</button></div></form>`);
  document.querySelector('#cover-file')?.addEventListener('change', async (event) => { ui.pendingCover = await readImage(event.target.files[0]); showCreateModalKeepFields(); });
}
function showCreateModalKeepFields() {
  const form = document.querySelector('#create-form');
  const data = form ? Object.fromEntries(new FormData(form).entries()) : {};
  const cover = ui.pendingCover;
  const fields = [...ui.fieldDraft];
  showCreateModal();
  ui.pendingCover = cover;
  ui.fieldDraft = fields;
  const preview = document.querySelector('.upload-preview');
  if (preview && cover) preview.innerHTML = `<img src="${cover}" style="width:100%;height:100%;object-fit:cover;border-radius:9px"/>`;
  refreshFieldChips();
  for (const [key, value] of Object.entries(data)) { const input = document.querySelector(`[name="${key}"]`); if (input) input.value = value; }
}
function renderFieldChips() {
  return ui.fieldDraft.map((field, index) => `<span class="field-chip">${escapeHtml(field)}<button type="button" data-action="remove-field" data-index="${index}" aria-label="Remover ${escapeHtml(field)}">${icon('close',13)}</button></span>`).join('');
}
function refreshFieldChips() {
  const target = document.querySelector('#field-chips');
  if (target) target.innerHTML = renderFieldChips();
}
function showJoinModal() {
  showModal('Entrar em uma mesa', 'Insira o código de convite compartilhado pelo mestre.', `<form id="join-form"><div class="field"><label for="invite-code-input">Código de convite</label><input id="invite-code-input" name="code" maxlength="6" autocomplete="off" placeholder="Ex.: F8K2LP" style="text-transform:uppercase;letter-spacing:4px;font-weight:700" required /></div><div class="notice">O código dá acesso à campanha neste dispositivo. Para contas em dispositivos diferentes, será necessário ativar um backend.</div><div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancelar</button><button class="button" type="submit">Encontrar campanha</button></div></form>`);
}
function showSuggestions() {
  const campaign = repo.getCampaign(ui.campaignId);
  if (!campaign || repo.user.id !== campaign.gmId) return;
  const recent = campaign.messages.filter((message) => message.role !== 'system').slice(-8);
  const summary = recent.length ? recent.map((message) => `${message.name}: ${message.text}`).join(' · ').slice(0, 330) : 'A aventura ainda está começando. Apresente o cenário e convide os personagens a tomar uma decisão.';
  const ideas = [
    ['Próximo acontecimento', 'Um mensageiro chega com uma notícia que contradiz a versão conhecida dos fatos. Ele carrega um selo ligado a alguém do passado do grupo.'],
    ['NPC para a cena', 'Maelis, uma cartógrafa que desenha mapas de lugares que ainda não existem. Ela pede proteção em troca de revelar um caminho secreto.'],
    ['Local & encontro', 'Uma ponte de pedra coberta por sinos rachados. A cada rodada, um sino desperta uma memória diferente — e algo se move sob o rio.'],
    ['Lembrete de regras', 'Quando a ação tiver risco e consequência, peça um teste apropriado: defina a característica, a dificuldade e o que muda em caso de sucesso ou falha. Ajuste ao sistema da mesa.'],
    ['Resumo da sessão', summary]
  ];
  showModal('Conselho do Mestre', 'Sugestões privadas · nada será enviado sem sua autorização.', `<div class="notice">Estas ideias são rascunhos de apoio, não regras nem mensagens públicas. Revise e adapte ao seu mundo.</div><div class="suggestion-list">${ideas.map(([heading, text], index) => `<article class="suggestion-card"><h3>${heading}</h3><p>${escapeHtml(text)}</p>${index < 4 ? `<button type="button" data-action="prepare-suggestion" data-index="${index}">Preparar no chat →</button>` : ''}</article>`).join('')}</div>`);
  ui.suggestions = ideas;
}

function rollDice(command) {
  const match = command.match(/^\/(\d*)d(\d+)([+-]\d+)?$/i);
  if (!match) return null;
  const count = Number(match[1] || 1), sides = Number(match[2]), modifier = Number(match[3] || 0);
  if (count < 1 || count > 20 || sides < 2 || sides > 1000) return { error: 'Use de 1 a 20 dados, com lados entre 2 e 1000 (ex.: /2d6+3).' };
  const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
  const total = rolls.reduce((sum, roll) => sum + roll, 0) + modifier;
  return { text: `🎲 ${command} → [${rolls.join(', ')}]${modifier ? ` ${modifier > 0 ? '+' : ''}${modifier}` : ''} = ${total}`, type: 'dice' };
}
function postChat(text) {
  const campaign = repo.getCampaign(ui.campaignId);
  const character = repo.getCharacter(campaign);
  let role = 'player';
  if (repo.user.id === campaign.gmId && text.startsWith('!gm ')) { role = 'gm'; text = text.slice(4).trim(); }
  const dice = rollDice(text);
  if (dice?.error) { toast(dice.error); return; }
  repo.sendMessage(campaign.id, { name: character.name, portrait: character.portrait, text: dice?.text || text, type: dice?.type || 'text', role });
  renderChat();
}

function cancelCampaignPress() {
  if (ui.pressTimer) window.clearTimeout(ui.pressTimer);
  ui.pressTimer = null;
  ui.pressedCard = null;
  ui.pressOrigin = null;
}

function startCampaignPress(card, x, y) {
  if (!card) return;
  cancelCampaignPress();
  ui.pressedCard = card;
  ui.pressOrigin = { x, y };
  ui.pressTimer = window.setTimeout(() => {
    if (!card.isConnected) return cancelCampaignPress();
    const campaign = repo.getCampaign(card.dataset.id);
    if (!campaign || campaign.gmId !== repo.user?.id) return cancelCampaignPress();
    ui.pressTimer = null;
    ui.ignoreNextClick = true;
    showDeleteConfirmation(campaign.id);
  }, 650);
}

function moveCampaignPress(x, y) {
  if (!ui.pressTimer || !ui.pressOrigin) return;
  if (Math.hypot(x - ui.pressOrigin.x, y - ui.pressOrigin.y) > 12) cancelCampaignPress();
}

document.addEventListener('pointerdown', (event) => {
  // O próximo gesto é uma ação nova; o clique sintético do toque anterior já teria ocorrido.
  ui.ignoreNextClick = false;
  if (event.pointerType === 'touch') return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  startCampaignPress(event.target.closest('.campaign-card.long-pressable'), event.clientX, event.clientY);
}, { passive: true });
document.addEventListener('pointermove', (event) => moveCampaignPress(event.clientX, event.clientY), { passive: true });
for (const eventName of ['pointerup', 'pointercancel']) document.addEventListener(eventName, cancelCampaignPress, { passive: true });

document.addEventListener('touchstart', (event) => {
  ui.ignoreNextClick = false;
  const touch = event.changedTouches[0];
  if (touch) startCampaignPress(event.target.closest('.campaign-card.long-pressable'), touch.clientX, touch.clientY);
}, { passive: true });
document.addEventListener('touchmove', (event) => {
  const touch = event.changedTouches[0];
  if (touch) moveCampaignPress(touch.clientX, touch.clientY);
}, { passive: true });
for (const eventName of ['touchend', 'touchcancel']) document.addEventListener(eventName, cancelCampaignPress, { passive: true });
document.addEventListener('contextmenu', (event) => {
  if (event.target.closest('.campaign-card.long-pressable')) event.preventDefault();
});

document.addEventListener('click', async (event) => {
  if (ui.ignoreNextClick) {
    ui.ignoreNextClick = false;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'dismiss-modal' && event.target !== button) return;
  if (action === 'home' || action === 'back-lobby') { ui.screen = 'lobby'; ui.query = ''; ui.pendingPortrait = ''; render(); }
  if (action === 'logout') { repo.signOut(); ui.screen = 'lobby'; render(); }
  if (action === 'create') showCreateModal();
  if (action === 'join') showJoinModal();
  if (action === 'close-modal' || action === 'dismiss-modal') document.querySelector('.modal-backdrop')?.remove();
  if (action === 'confirm-delete-campaign') {
    try {
      repo.deleteCampaign(button.dataset.id);
      document.querySelector('.modal-backdrop')?.remove();
      renderLobby();
      toast('Campanha excluída.');
    } catch (error) { toast(error.message); }
  }
  if (action === 'add-field') {
    const input = document.querySelector('#new-field');
    const name = input?.value.trim();
    if (!name) return;
    if (ui.fieldDraft.some((field) => field.toLowerCase() === name.toLowerCase())) { toast('Esse campo já existe.'); return; }
    ui.fieldDraft.push(name); refreshFieldChips(); input.value = ''; input.focus();
  }
  if (action === 'remove-field') { ui.fieldDraft.splice(Number(button.dataset.index), 1); refreshFieldChips(); }
  if (action === 'open-campaign') {
    ui.campaignId = button.dataset.id;
    const campaign = repo.getCampaign(ui.campaignId);
    if (!campaign.members.includes(repo.user.id)) { toast('Entre nesta campanha com o código de convite.'); return; }
    ui.pendingPortrait = '';
    ui.screen = repo.getCharacter(campaign) ? 'chat' : 'sheet';
    render();
  }
  if (action === 'character') { ui.pendingPortrait = ''; ui.screen = 'sheet'; render(); }
  if (action === 'members') document.querySelector('.chat-layout')?.classList.toggle('show-members');
  if (action === 'copy') {
    const campaign = repo.getCampaign(ui.campaignId);
    try { await navigator.clipboard.writeText(campaign.inviteCode); toast('Código copiado!'); }
    catch { toast(`Código: ${campaign.inviteCode}`); }
  }
  if (action === 'suggestions') showSuggestions();
  if (action === 'prepare-suggestion') {
    const text = ui.suggestions?.[Number(button.dataset.index)]?.[1];
    document.querySelector('.modal-backdrop')?.remove();
    const input = document.querySelector('#chat-input');
    if (input) { input.value = text; input.focus(); toast('Rascunho privado no chat. Envie apenas se quiser compartilhar.'); }
  }
});

document.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  if (form.id === 'auth-form') {
    const name = new FormData(form).get('username')?.trim();
    if (name) { repo.signIn(name); ui.screen = 'lobby'; render(); }
  }
  if (form.id === 'create-form') {
    const data = Object.fromEntries(new FormData(form).entries());
    if (!data.name.trim()) return;
    try {
      const campaign = repo.createCampaign({ name: data.name.trim(), description: data.description.trim(), cover: ui.pendingCover, fields: [...ui.fieldDraft] });
      document.querySelector('.modal-backdrop')?.remove();
      ui.campaignId = campaign.id; ui.screen = 'sheet'; ui.pendingPortrait = ''; render();
      toast(`Campanha criada! Código: ${campaign.inviteCode}`);
    } catch (error) { toast(error.message); }
  }
  if (form.id === 'join-form') {
    try {
      const campaign = repo.joinCampaign(new FormData(form).get('code'));
      document.querySelector('.modal-backdrop')?.remove();
      ui.campaignId = campaign.id; ui.screen = repo.getCharacter(campaign) ? 'chat' : 'sheet'; render();
    } catch (error) { toast(error.message); }
  }
  if (form.id === 'sheet-form') {
    const campaign = repo.getCampaign(ui.campaignId);
    const values = Object.fromEntries(new FormData(form).entries());
    if (!values.Nome?.trim()) { toast('Dê um nome ao seu personagem.'); return; }
    repo.saveCharacter(campaign.id, values, ui.pendingPortrait || undefined);
    ui.pendingPortrait = ''; ui.screen = 'chat'; render(); toast('Personagem salvo. Bem-vindo à mesa!');
  }
  if (form.id === 'chat-form') {
    const input = document.querySelector('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    postChat(text);
  }
});

// Atualiza outras abas abertas no mesmo navegador; um backend futuro substituirá esta sincronização local.
window.addEventListener('storage', () => { repo.state = repo.load(); render(); });
render();

async function readImage(file) {
  if (!file) return '';
  if (!file.type.startsWith('image/')) { toast('Escolha um arquivo de imagem.'); return ''; }
  // Redimensiona imagens para manter o armazenamento local leve e evitar exceder a cota do navegador.
  const source = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => { const scale = Math.min(1, 1200 / Math.max(image.width, image.height)); const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale); canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL('image/jpeg', 0.78)); };
    image.onerror = () => resolve(source);
    image.src = source;
  });
}
