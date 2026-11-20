import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && key ? createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
}) : null;

export function backendSetupError() {
  return new Error('A conexão com o Supabase não está configurada. Confira o arquivo .env.local e reinicie o app.');
}

export function readableSupabaseError(error) {
  const message = error?.message || '';
  if (/Invalid API key|Invalid JWT|JWT/i.test(message)) return 'A chave pública do Supabase está incorreta. Confira VITE_SUPABASE_ANON_KEY.';
  if (/Failed to fetch|NetworkError|fetch/i.test(message)) return 'Não foi possível conectar ao Supabase. Confira sua internet e a URL do projeto.';
  if (/relation .* does not exist|schema cache/i.test(message)) return 'As tabelas do RPG Hub ainda não foram criadas. Execute supabase/schema.sql no SQL Editor do projeto.';
  if (/function .* does not exist|Could not find the function/i.test(message)) return 'As funções do RPG Hub ainda não foram configuradas. Execute supabase/schema.sql no SQL Editor do projeto.';
  if (/Anonymous sign-ins are disabled|anonymous sign-ins/i.test(message)) return 'Ative o acesso anônimo em Supabase → Authentication → Sign In / Providers → Anonymous.';
  return message || 'Não foi possível concluir a operação. Tente novamente.';
}
