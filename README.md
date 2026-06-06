# Évora Launch OS v5.0

Versão com autenticação real, controle de acesso, gestão de usuários/corretores, senhas, logs e banco de dados SQLite.

## Como rodar localmente

```bash
npm install
cp .env.example .env
npm start
```

Acesse:

```text
http://localhost:3000
```

Primeiro acesso:

```text
admin@evora.local
Evora@2026!
```

O sistema força troca de senha no primeiro acesso.

## O que foi incluído

- Tela de login.
- Sessão segura com cookies HTTP-only.
- Hash de senha com bcrypt.
- Banco SQLite em `data/evora_launch_os.sqlite`.
- Schema SQL em `database/schema.sql`.
- Administrador principal do sistema.
- Cadastro de usuários.
- Cadastro de corretores com CRECI e PDF obrigatório.
- Papéis e permissões configuráveis.
- Gestão de senhas.
- Redefinição de senha pelo administrador.
- Logs de auditoria.
- CRUD de leads.
- Administrador com permissão para alterar/excluir qualquer lead ou cadastro.
- Estrutura pronta para versionamento no GitHub.

## Observação de implantação

Este pacote é uma aplicação Node.js com backend. Ele deve ser colocado em um repositório GitHub, mas **não roda em GitHub Pages**, porque GitHub Pages é estático. Para produção, hospede em VPS, Render, Railway, Fly.io, DigitalOcean, AWS, Azure ou servidor próprio.
