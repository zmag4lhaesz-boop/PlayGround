# RPG Hub

Aplicativo PWA mobile-first para organizar e jogar campanhas de RPG de mesa. A interface e as explicações estão em português, com tema escuro de fantasia medieval. As campanhas, fichas e mensagens são armazenadas no Supabase e sincronizadas entre dispositivos.

## Recursos

- Acesso com nome de jogador e autenticação anônima do Supabase.
- Lobby com busca, campanhas, capa opcional e papéis de Mestre/Jogador.
- Criação de campanhas, campos personalizados de ficha e convite por código de seis caracteres.
- Ficha individual por jogador, com retrato escolhido da galeria.
- Chat sincronizado em tempo real, com autor, retrato, horário e narração do Mestre (`!gm texto`).
- Rolagens compartilhadas como `/d20`, `/2d6+3` e até 20 dados por comando; o botão de dado aparece para jogadores.
- Ações em itálico usando `*texto da ação*`.
- Painel privado do Mestre com ganchos, NPCs, locais, lembrete de regras e resumo. Sugestões ficam como rascunho até serem enviadas explicitamente.
- PWA instalável e interface responsiva para celular e desktop.
- Empacotamento Android por Capacitor.

## Requisitos

- Node.js 18 ou superior.
- Um projeto Supabase gratuito.
- Para compilar o APK: Android SDK e Java compatíveis com o Gradle/Android Gradle Plugin do projeto.

## Configurar o Supabase

1. No painel do Supabase, crie um projeto e ative o provedor de **autenticação anônima** em **Authentication → Sign In / Providers → Anonymous**.
2. No **SQL Editor**, execute todo o arquivo `supabase/schema.sql`. Ele cria as tabelas, políticas de acesso, funções do app e publicação realtime.
3. Copie `.env.example` para `.env.local` e preencha as credenciais do projeto:

   ```env
   VITE_SUPABASE_URL=https://SEU_PROJETO.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_...
   ```

   A chave publicável (ou a chave `anon` legada) é destinada ao cliente. **Nunca** coloque uma chave `secret`/`service_role` ou senha do banco no aplicativo.
4. Reinicie o servidor de desenvolvimento ou gere novamente o build para que o Vite leia as variáveis.

O arquivo `.env.local` é ignorado pelo Git. As credenciais são incorporadas ao build de frontend; a proteção dos dados depende das políticas RLS e das funções do esquema. O nome de perfil é visível aos usuários autenticados. Não armazene dados sensíveis.

A autenticação é anônima: a sessão fica neste navegador/dispositivo. Desconectar oculta a sessão no app sem apagar a identidade local, mas limpar os dados do navegador ou reinstalar pode impedir a recuperação desse acesso e das campanhas associadas.

## Executar no computador

```bash
npm install
npm run dev
```

Abra o endereço exibido pelo Vite (normalmente `http://localhost:5173`). Para validar a versão de produção:

```bash
npm run build
npm run preview
```

## Usar em dispositivos

### PWA (Android, iPhone e iPad)

Publique o site em um host com HTTPS (por exemplo, Vercel ou Netlify), configurando as mesmas variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no ambiente de build. No Android, abra no Chrome e escolha **Instalar app** ou **Adicionar à tela inicial**. No iPhone/iPad, abra no Safari, toque em **Compartilhar** e escolha **Adicionar à Tela de Início**. Expo Go não é necessário.

### APK Android de depuração

Com `.env.local` configurado e o ambiente Android instalado, execute:

```bash
npm run apk:debug
```

O APK é gerado em `android/app/build/outputs/apk/debug/app-debug.apk`. Instale-o no aparelho para testar. O script também atualiza a cópia web usada pelo Capacitor.

## Estrutura principal

```text
src/main.js          # Telas, navegação, formulários e interação do jogo
src/storage.js       # Repositório Supabase, autenticação e sincronização realtime
src/supabase.js      # Cliente e mensagens de erro do Supabase
src/components.js    # Componentes visuais compartilhados e utilitários
src/style.css        # Tema responsivo
supabase/schema.sql  # Tabelas, RLS, funções RPC e configuração realtime
.env.example         # Modelo das variáveis de ambiente
capacitor.config.json
android/             # Projeto nativo Android do Capacitor
```

## Limitações

- O acesso anônimo não tem recuperação de conta; proteja a sessão do navegador/dispositivo.
- Convites usam um código curto. Compartilhe-o somente com quem deve participar da campanha.
- A rolagem atual é prática para o jogo casual, não um mecanismo auditável ou à prova de adulteração.
- Capas e retratos são guardados nos dados da campanha; prefira imagens pequenas.
