import { supabase, backendSetupError, readableSupabaseError } from './supabase.js';

const SESSION_KEY = 'rpghub-online-session';

export class SupabaseRepository {
  constructor() {
    this.state = { users: [], currentUserId: null, campaigns: [] };
    this.authUserId = null;
    this.channel = null;
  }

  get user() { return this.state.users.find((item) => item.id === this.state.currentUserId) || null; }
  get campaigns() { return this.state.campaigns; }
  getCampaign(id) { return this.state.campaigns.find((item) => item.id === id); }
  getCharacter(campaign, userId = this.state.currentUserId) { return campaign?.characters?.find((item) => item.userId === userId); }

  async initialize() {
    if (!supabase) throw backendSetupError();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error(readableSupabaseError(error));
    this.authUserId = data.session?.user?.id || null;
    if (this.authUserId && localStorage.getItem(SESSION_KEY) === 'active') {
      const { data: profile, error: profileError } = await supabase.from('profiles').select('id,name,avatar').eq('id', this.authUserId).maybeSingle();
      if (profileError) throw new Error(readableSupabaseError(profileError));
      if (profile) {
        this.state.currentUserId = this.authUserId;
        this.state.users = [profile];
        await this.refreshData();
        this.subscribe();
      }
    }
  }

  async signIn(name) {
    if (!supabase) throw backendSetupError();
    const cleanName = name.trim().slice(0, 24);
    if (!cleanName) throw new Error('Digite um nome de jogador.');
    if (!this.authUserId) {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw new Error(readableSupabaseError(error));
      this.authUserId = data.user.id;
    }
    const profile = { id: this.authUserId, name: cleanName, avatar: '' };
    const { error } = await supabase.from('profiles').upsert(profile, { onConflict: 'id' });
    if (error) throw new Error(readableSupabaseError(error));
    localStorage.setItem(SESSION_KEY, 'active');
    this.state.currentUserId = this.authUserId;
    this.state.users = [profile];
    await this.refreshData();
    this.subscribe();
    this.notify();
    return profile;
  }

  signOut() {
    // Mantém a identidade anônima neste dispositivo para que desconectar não apague o acesso às campanhas.
    localStorage.removeItem(SESSION_KEY);
    this.state = { users: [], currentUserId: null, campaigns: [] };
    this.notify();
  }

  async refreshData() {
    if (!supabase || !this.state.currentUserId) return;
    const { data: rows, error } = await supabase.from('campaigns').select('id,gm_id,invite_code,members,data,created_at').order('created_at', { ascending: false });
    if (error) throw new Error(readableSupabaseError(error));
    this.state.campaigns = (rows || []).map((row) => this.mapCampaign(row));
    const ids = [...new Set([this.state.currentUserId, ...this.state.campaigns.flatMap((campaign) => campaign.members)])];
    if (ids.length) {
      const { data: profiles, error: profileError } = await supabase.from('profiles').select('id,name,avatar').in('id', ids);
      if (profileError) throw new Error(readableSupabaseError(profileError));
      const byId = new Map((profiles || []).map((profile) => [profile.id, profile]));
      if (!byId.has(this.state.currentUserId)) {
        const own = this.state.users.find((item) => item.id === this.state.currentUserId);
        if (own) byId.set(own.id, own);
      }
      this.state.users = [...byId.values()];
    }
    this.notify();
  }

  mapCampaign(row) {
    const data = row.data || {};
    return {
      ...data,
      id: row.id,
      gmId: row.gm_id,
      inviteCode: row.invite_code,
      members: row.members || [],
      fields: data.fields || [],
      characters: data.characters || [],
      messages: data.messages || [],
      createdAt: row.created_at || data.createdAt
    };
  }

  subscribe() {
    if (!supabase || !this.state.currentUserId) return;
    if (this.channel) supabase.removeChannel(this.channel);
    this.channel = supabase.channel(`rpg-hub-${this.state.currentUserId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaigns' }, () => {
        this.refreshData().catch((error) => console.warn('Não foi possível atualizar as campanhas.', error));
      })
      .subscribe();
  }

  notify() {
    window.dispatchEvent(new CustomEvent('rpg:data-changed'));
  }

  async deleteCampaign(campaignId) {
    const campaign = this.getCampaign(campaignId);
    if (!campaign) throw new Error('Esta campanha não existe mais.');
    if (!this.user || campaign.gmId !== this.user.id) throw new Error('Somente o Mestre pode excluir esta campanha.');
    const { error } = await supabase.from('campaigns').delete().eq('id', campaignId);
    if (error) throw new Error(readableSupabaseError(error));
    this.state.campaigns = this.state.campaigns.filter((item) => item.id !== campaignId);
    this.notify();
  }

  uniqueCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  async createCampaign({ name, description, cover, fields }) {
    if (!this.user) throw new Error('Entre na sua conta antes de criar uma campanha.');
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const data = {
      name, description, cover, gmName: this.user.name, fields,
      characters: [],
      messages: [{ id: crypto.randomUUID(), userId: 'system', name: 'RPG Hub', role: 'system', text: `A aventura “${name}” começa. O mestre pode compartilhar o código com os jogadores.`, time: Date.now() }]
    };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const inviteCode = this.uniqueCode();
      const { data: row, error } = await supabase.from('campaigns').insert({
        id, gm_id: this.user.id, invite_code: inviteCode, members: [this.user.id], data, created_at: createdAt
      }).select('id,gm_id,invite_code,members,data,created_at').single();
      if (!error) {
        const campaign = this.mapCampaign(row);
        this.state.campaigns.unshift(campaign);
        this.notify();
        return campaign;
      }
      if (error.code !== '23505' || attempt === 3) throw new Error(readableSupabaseError(error));
    }
    throw new Error('Não foi possível gerar um código de convite. Tente novamente.');
  }

  async joinCampaign(code) {
    const cleanCode = String(code || '').trim().toUpperCase();
    if (!cleanCode) throw new Error('Digite o código de convite.');
    const { data, error } = await supabase.rpc('rpg_join_campaign', { p_code: cleanCode });
    if (error) {
      if (/not found|Código não encontrado/i.test(error.message)) throw new Error('Código não encontrado. Confira com o mestre e tente novamente.');
      throw new Error(readableSupabaseError(error));
    }
    const campaign = this.mapCampaign(data);
    this.state.campaigns = [campaign, ...this.state.campaigns.filter((item) => item.id !== campaign.id)];
    await this.refreshData();
    return this.getCampaign(campaign.id) || campaign;
  }

  async saveCharacter(campaignId, values, portrait) {
    const campaign = this.getCampaign(campaignId);
    if (!campaign) throw new Error('Esta campanha não existe mais.');
    const existing = this.getCharacter(campaign);
    const character = {
      id: existing?.id || crypto.randomUUID(),
      userId: this.state.currentUserId,
      name: values.Nome || this.user.name,
      values,
      portrait: portrait ?? existing?.portrait ?? ''
    };
    const { data, error } = await supabase.rpc('rpg_save_character', { p_campaign_id: campaignId, p_character: character });
    if (error) throw new Error(readableSupabaseError(error));
    const updated = this.mapCampaign(data);
    this.replaceCampaign(updated);
    return updated.characters.find((item) => item.userId === this.state.currentUserId) || character;
  }

  async sendMessage(campaignId, message) {
    const { data, error } = await supabase.rpc('rpg_send_message', {
      p_campaign_id: campaignId,
      p_message: { text: message.text, type: message.type || 'text', role: message.role || 'player' }
    });
    if (error) throw new Error(readableSupabaseError(error));
    const campaign = this.getCampaign(campaignId);
    if (campaign && data) campaign.messages.push(data);
    this.notify();
  }

  replaceCampaign(updated) {
    this.state.campaigns = this.state.campaigns.map((item) => item.id === updated.id ? updated : item);
    this.notify();
  }
}

export const DEFAULT_FIELDS = ['Nome', 'Idade', 'Raça / espécie', 'Classe / profissão', 'Aparência', 'Personalidade', 'História', 'Objetivos', 'Atributos', 'Inventário'];
