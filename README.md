# Diário de Segurança

## Como rodar
1. Crie um projeto no Neon (neon.tech) e copie a connection string.
2. `cp .env.example .env` e preencha DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_SENHA.
3. `npm install`
4. `npm start` e abra http://localhost:3000

As tabelas e a conta admin são criadas sozinhas na primeira execução.
Para publicar: Render, Railway ou Fly.io (defina as mesmas variáveis de ambiente e NODE_ENV=production).

## Regras
- Admin: vê os registros de todos (filtro por técnico e dia), cria/desativa técnicos, troca senhas.
- Técnico: registra atividades e vê só os próprios registros.
- A comprovação é um link opcional (Drive, OneDrive, etc.). O sistema não guarda imagens.
