# Diário de Segurança — Edição Social

Plataforma de registros de segurança com interface de feed social, visual responsivo e navegação flutuante translúcida.

## Novidades
- Nova interface para desktop e celular, com navegação em vidro translúcido inspirada em interfaces móveis modernas.
- Feed compartilhado entre os usuários autenticados; "Meus registros" separa as publicações do usuário.
- Curtidas e comentários persistidos no PostgreSQL, com contagem e verificação de acesso.
- Indicadores de atividades, busca no feed, filtros por data e, para administradores, por técnico.
- Gerenciamento de técnicos, senhas e estado das contas mantido.
- Comprovantes por links externos mantidos. Os arquivos não são hospedados no sistema.

## Instalação
1. Copie `.env.example` para `.env` e configure `DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_SENHA`.
2. Execute `npm install` e `npm start`.
3. Abra `http://localhost:3000`.

Na primeira chamada de API, o sistema cria as tabelas se estiverem ausentes. As tabelas antigas de usuários e registros **não são apagadas**. As novas tabelas `curtidas` e `comentarios` são criadas automaticamente.

## Hospedagem
Configure no provedor as mesmas variáveis de ambiente, mantendo `NODE_ENV=production`. Para Neon use de preferência a conexão pooled.

## Permissões
- Todos os usuários autenticados podem visualizar e interagir com as publicações do feed.
- Administradores podem cadastrar e gerenciar técnicos, além de filtrar os registros por autor.
- A página "Meus registros" mostra exclusivamente as atividades do usuário conectado.

## Observações
- A busca textual funciona sobre os 500 registros mais recentes retornados pela API.
- Não há upload direto de mídias: a comprovação permanece por URL, como na versão original.
- O link de compartilhamento é um atalho para a página e não torna as publicações públicas sem login.

## Privacidade de registros

- Administradores podem consultar os registros publicados por todos os técnicos e filtrar por técnico.
- Técnicos podem consultar **somente seus próprios registros**.
- A regra é validada nas rotas de API para listar registros, curtir e consultar/publicar comentários, inclusive se o link da publicação de outro técnico for conhecido.
- Registros anteriores são preservados; nenhuma migração de dados é necessária.
