const STORAGE_KEY = 'rpghub-v1';

// A camada de dados pode ser substituída por Supabase/Firebase sem alterar as telas.
export class LocalRepository {
  constructor() {
    this.state = this.load();
  }

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved?.users && saved?.campaigns) return saved;
    } catch (error) {
      console.warn('Não foi possível ler os dados locais.', error);
    }
    return { users: [], currentUserId: null, campaigns: [] };
  }

  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    window.dispatchEvent(new CustomEvent('rpg:data-changed'));
  }

  get user() { return this.state.users.find((item) => item.id === this.state.currentUserId) || null; }
  get campaigns() { return this.state.campaigns; }
  getCampaign(id) { return this.state.campaigns.find((item) => item.id === id); }
  getCharacter(campaign, userId = this.state.currentUserId) { return campaign.characters.find((item) => item.userId === userId); }

  deleteCampaign(campaignId) {
    const campaign = this.getCampaign(campaignId);
    if (!campaign) throw new Error('Esta campanha não existe mais.');
    if (!this.user || campaign.gmId !== this.user.id) throw new Error('Somente o Mestre pode excluir esta campanha.');
    this.state.campaigns = this.state.campaigns.filter((item) => item.id !== campaignId);
    this.save();
  }

  signIn(name) {
    let user = this.state.users.find((item) => item.name.toLowerCase() === name.trim().toLowerCase());
    if (!user) {
      user = { id: crypto.randomUUID(), name: name.trim(), avatar: '' };
      this.state.users.push(user);
    }
    this.state.currentUserId = user.id;
    this.save();
    return user;
  }

  signOut() { this.state.currentUserId = null; this.save(); }

  createCampaign({ name, description, cover, fields }) {
    const user = this.user;
    if (!user) throw new Error('Entre na sua conta antes de criar uma campanha.');
    const campaign = {
      id: crypto.randomUUID(), name, description, cover,
      gmId: user.id, gmName: user.name,
      inviteCode: this.uniqueCode(), fields, members: [user.id], characters: [], messages: [],
      createdAt: new Date().toISOString()
    };
    campaign.messages.push({ id: crypto.randomUUID(), userId: 'system', name: 'RPG Hub', role: 'system', text: `A aventura “${name}” começa. O mestre pode compartilhar o código ${campaign.inviteCode} com os jogadores.`, time: Date.now() });
    this.state.campaigns.unshift(campaign);
    this.save();
    return campaign;
  }

  uniqueCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do { code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
    while (this.state.campaigns.some((item) => item.inviteCode === code));
    return code;
  }

  joinCampaign(code) {
    const campaign = this.state.campaigns.find((item) => item.inviteCode.toUpperCase() === code.trim().toUpperCase());
    if (!campaign) throw new Error('Código não encontrado. Confira com o mestre e tente novamente.');
    if (!campaign.members.includes(this.state.currentUserId)) campaign.members.push(this.state.currentUserId);
    this.save();
    return campaign;
  }

  saveCharacter(campaignId, values, portrait) {
    const campaign = this.getCampaign(campaignId);
    const existing = this.getCharacter(campaign);
    const character = { id: existing?.id || crypto.randomUUID(), userId: this.state.currentUserId, name: values.name || this.user.name, values, portrait: portrait ?? existing?.portrait ?? '' };
    if (existing) campaign.characters[campaign.characters.indexOf(existing)] = character;
    else campaign.characters.push(character);
    this.save();
    return character;
  }

  sendMessage(campaignId, message) {
    const campaign = this.getCampaign(campaignId);
    campaign.messages.push({ id: crypto.randomUUID(), userId: this.state.currentUserId, name: message.name, portrait: message.portrait || '', role: message.role || 'player', text: message.text, time: Date.now(), type: message.type || 'text' });
    this.save();
  }
}

export const DEFAULT_FIELDS = ['Nome', 'Idade', 'Raça / espécie', 'Classe / profissão', 'Aparência', 'Personalidade', 'História', 'Objetivos', 'Atributos', 'Inventário'];
