# RPG Hub

Aplicativo PWA mobile-first para organizar e jogar campanhas de RPG de mesa. A interface e as explicações estão em português, com tema escuro de fantasia medieval.

## Estrutura do projeto

```text
.
├── index.html                 # Documento principal e metadados PWA
├── manifest.webmanifest       # Configuração para instalação na tela inicial
├── icon.svg                   # Ícone do aplicativo
├── package.json               # Scripts e dependências
└── src/
    ├── main.js                # Telas, navegação, formulários e interação do jogo
    ├── storage.js             # Repositório local e regras de persistência
    ├── components.js          # Componentes visuais compartilhados e utilitários
    └── style.css              # Tema responsivo para celular e desktop
```

## Recursos implementados

- Login simples por nome de jogador, com várias contas locais no mesmo navegador.
- Lobby com busca por nome/descrição, cards de campanha, capa opcional e papéis de Mestre/Jogador.
- Criação de campanha e edição dos campos personalizados da ficha; inclui os dez campos padrão.
- Convite com código único de seis caracteres para adicionar jogadores locais à campanha.
- Ficha individual vinculada à campanha e ao usuário, com retrato escolhido da galeria.
- Chat persistido com autor, retrato, horário e destaque de narração do Mestre (`!gm texto`).
- Rolagens de dados como `/d20`, `/2d6+3` e até 20 dados por comando.
- Ações em itálico usando `*texto da ação*`.
- Painel privado do Mestre com ganchos, NPCs, locais, lembrete de regras e resumo. Preparar uma sugestão só coloca um rascunho no campo de mensagem; é preciso enviar explicitamente para compartilhá-la.
- Imagens são reduzidas no navegador antes de salvar, para usar menos armazenamento.
- PWA instalável e navegação responsiva, com espaçamento para a área segura/barras do sistema no celular.

## Executar no computador

Requer Node.js 18 ou superior.

```bash
npm install
npm run dev
```

Abra o endereço exibido pelo Vite (normalmente `http://localhost:5173`). Para validar a versão de produção:

```bash
npm run build
npm run preview
```

## Executar em um celular

### Android (Chrome)

1. Conecte o computador e o celular à mesma rede Wi-Fi.
2. Execute `npm run dev -- --host 0.0.0.0`.
3. Encontre o IP local do computador e abra `http://IP-DO-COMPUTADOR:5173` no Chrome do Android. Se necessário, permita a porta 5173 no firewall.
4. No menu do Chrome, escolha **Instalar app** ou **Adicionar à tela inicial**.
5. Abra RPG Hub pelo novo ícone. Os dados permanecem no armazenamento do navegador desse dispositivo.

### iPhone/iPad (Safari)

1. Publique o site em um host com HTTPS (por exemplo, Vercel, Netlify ou seu próprio servidor) ou use uma URL HTTPS de desenvolvimento acessível pelo aparelho.
2. Abra no Safari, toque em **Compartilhar** e escolha **Adicionar à Tela de Início**.
3. Inicie pelo ícone instalado.

O modo PWA exige HTTPS em dispositivos móveis, exceto em `localhost`. Expo Go não é necessário porque esta entrega usa PWA. Para gerar um APK nativo, uma próxima etapa pode empacotar o PWA com Capacitor ou PWABuilder.

## Armazenamento e arquitetura para backend

A primeira versão usa `LocalRepository` em `src/storage.js`, com dados no `localStorage` do navegador. A separação entre repositório, componentes e telas foi feita para permitir substituir a camada de persistência por Supabase ou Firebase sem reconstruir a interface. O contrato atual reúne operações de autenticação, campanhas, associação por convite, fichas e mensagens. Uma integração real deverá adicionar autenticação segura, políticas de acesso por campanha, armazenamento de imagens e listeners de tempo real.

**Limitação importante:** no protótipo local, as contas e campanhas existem somente no navegador/dispositivo onde foram criadas. O código de convite só funciona para usuários que compartilham a mesma instalação e os dados não sincronizam entre aparelhos. O chat persiste localmente e atualiza abas do mesmo navegador, mas não é um chat de rede em tempo real. Não use dados sensíveis.

## Próximas melhorias planejadas

1. Autenticação por e-mail e login seguro com Supabase Auth/Firebase Auth.
2. Banco de dados com sincronização de campanhas, presença e chat em tempo real.
3. Convites por link, expiração/revogação de códigos e permissões configuráveis.
4. Upload de capas e retratos para storage remoto, com quotas e moderação.
5. Rolagem com histórico auditável, vantagem/desvantagem e sistemas de regras configuráveis.
6. Integração opcional com um provedor de IA, mantendo o painel privado e exigindo confirmação antes de publicar.
7. Exportação/backup de campanha, notificações, acessibilidade ampliada e pacote Android APK.
