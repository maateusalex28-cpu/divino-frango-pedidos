# Divino Frango — Pedidos

Sistema **independente** do painel de vendas/compras (aquele projeto continua existindo separado, sem nenhuma ligação com este). Este projeto tem só uma função: **clientes fazem pedidos pela internet, e você aceita ou recusa em tempo real.**

Dois sites em um projeto:

- **`/` (raiz)** — site público do cliente: cardápio, carrinho, formulário de pedido. É esse link que você compartilha.
- **`/admin`** — painel privado onde você vê os pedidos chegando (com som de aviso) e aceita, recusa, conclui ou imprime.

---

## 1. Criar o projeto no Supabase (novo, separado do outro)

1. Em [supabase.com](https://supabase.com), clique em **New project**.
2. Dê um nome diferente do outro, tipo `divino-frango-pedidos`, escolha uma senha e a região **South America (São Paulo)**.
3. Espere o projeto ficar pronto (1–2 min).
4. Vá em **SQL Editor → New query**, cole todo o conteúdo de [`supabase/schema.sql`](./supabase/schema.sql) e clique em **Run**. Isso cria as tabelas `cardapio` e `pedidos`, ativa o Realtime (para o painel avisar na hora) e cria o espaço de armazenamento das fotos.
5. Vá em **Project Settings → API** e copie a **Project URL** e a **anon public key** — vai precisar delas no passo 3.

---

## 2. Testar localmente (opcional)

```bash
npm install
cp .env.example .env
# edite o .env com a URL/chave do NOVO projeto Supabase
npm run dev
```

- Site do cliente: `http://localhost:5173/`
- Painel do dono: `http://localhost:5173/admin`

---

## 3. Publicar na Vercel

1. Suba esta pasta para um repositório novo no GitHub (ex: `divino-frango-pedidos`).
2. Na Vercel → **Add New… → Project** → selecione o repositório.
3. Zero-config (Vite é detectado automaticamente).
4. Em **Environment Variables**, adicione:
   | Nome | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | URL do **novo** projeto Supabase |
   | `VITE_SUPABASE_ANON_KEY` | anon key do **novo** projeto Supabase |
5. **Deploy**.
6. Depois de publicado: `https://SEU-SITE.vercel.app/` é o site do cliente, e `https://SEU-SITE.vercel.app/admin` é o seu painel.

## Publicar na Netlify (alternativa)

Mesmo processo do outro projeto: importar o repositório, adicionar as duas variáveis de ambiente em **Site settings → Environment variables**, e publicar. O `netlify.toml` já cuida do resto.

---

## Novidades: segurança com login, relatórios, aviso persistente, estoque e cupons

### 1. Rode isso no SQL Editor do Supabase (tudo de uma vez)

```sql
-- Caixa/PDV (se ainda não tiver rodado antes)
create table if not exists caixas (
  id uuid primary key default gen_random_uuid(),
  aberto_em timestamptz not null default now(),
  fechado_em timestamptz,
  valor_abertura numeric(12,2) not null default 0,
  valor_fechamento_informado numeric(12,2),
  status text not null default 'aberto',
  observacao text,
  created_at timestamptz not null default now()
);
create index if not exists caixas_status_idx on caixas (status);

create table if not exists movimentacoes_caixa (
  id uuid primary key default gen_random_uuid(),
  caixa_id uuid not null references caixas(id) on delete cascade,
  tipo text not null,
  valor numeric(12,2) not null,
  forma_pagamento text,
  descricao text,
  created_at timestamptz not null default now()
);
create index if not exists movimentacoes_caixa_caixa_idx on movimentacoes_caixa (caixa_id);

-- Estoque no cardápio
alter table cardapio add column if not exists estoque integer;

-- Cupom + desconto no pedido
alter table pedidos add column if not exists cupom_codigo text;
alter table pedidos add column if not exists desconto numeric(12,2) not null default 0;

-- Cupons de desconto
create table if not exists cupons (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  tipo text not null,
  valor numeric(12,2) not null,
  ativo boolean not null default true,
  validade date,
  usos_maximos integer,
  usos_atual integer not null default 0,
  created_at timestamptz not null default now()
);
alter table cupons enable row level security;
create policy "cupons leitura publica" on cupons for select using (true);
create policy "cupons escrita autenticada" on cupons for insert with check (auth.role() = 'authenticated');
create policy "cupons update autenticada" on cupons for update using (auth.role() = 'authenticated');
create policy "cupons delete autenticada" on cupons for delete using (auth.role() = 'authenticated');

-- Funções seguras chamadas pelo site público (baixar estoque e contar uso de cupom)
create or replace function decrementar_estoque(p_item_id uuid, p_quantidade int)
returns void language plpgsql security definer set search_path = public as $$
begin
  update cardapio set estoque = greatest(estoque - p_quantidade, 0) where id = p_item_id and estoque is not null;
end; $$;
grant execute on function decrementar_estoque(uuid, int) to anon, authenticated;

create or replace function usar_cupom(p_codigo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update cupons set usos_atual = usos_atual + 1 where lower(codigo) = lower(p_codigo);
end; $$;
grant execute on function usar_cupom(text) to anon, authenticated;

-- Segurança: troca as políticas "acesso total" por políticas que exigem login
-- para qualquer ação de escrita (menos criar pedido e ler cardápio, que continuam públicas)
drop policy if exists "acesso total cardapio" on cardapio;
create policy "cardapio leitura publica" on cardapio for select using (true);
create policy "cardapio escrita autenticada" on cardapio for insert with check (auth.role() = 'authenticated');
create policy "cardapio update autenticada" on cardapio for update using (auth.role() = 'authenticated');
create policy "cardapio delete autenticada" on cardapio for delete using (auth.role() = 'authenticated');

drop policy if exists "acesso total pedidos" on pedidos;
create policy "pedidos leitura publica" on pedidos for select using (true);
create policy "pedidos insercao publica" on pedidos for insert with check (true);
create policy "pedidos update autenticada" on pedidos for update using (auth.role() = 'authenticated');

drop policy if exists "acesso total configuracoes" on configuracoes;
create policy "configuracoes leitura publica" on configuracoes for select using (true);
create policy "configuracoes update autenticada" on configuracoes for update using (auth.role() = 'authenticated');

drop policy if exists "acesso total caixas" on caixas;
alter table caixas enable row level security;
create policy "caixas autenticada" on caixas for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "acesso total movimentacoes_caixa" on movimentacoes_caixa;
alter table movimentacoes_caixa enable row level security;
create policy "movimentacoes_caixa autenticada" on movimentacoes_caixa for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "cardapio foto upload" on storage.objects;
drop policy if exists "cardapio foto update" on storage.objects;
drop policy if exists "cardapio foto delete" on storage.objects;
create policy "cardapio foto upload autenticada" on storage.objects for insert with check (bucket_id = 'cardapio' and auth.role() = 'authenticated');
create policy "cardapio foto update autenticada" on storage.objects for update using (bucket_id = 'cardapio' and auth.role() = 'authenticated');
create policy "cardapio foto delete autenticada" on storage.objects for delete using (bucket_id = 'cardapio' and auth.role() = 'authenticated');
```

### 2. Criar o login do admin (você)

1. No painel do Supabase, vá em **Authentication → Users → Add user**.
2. Preencha seu e-mail e uma senha forte. Marque **"Auto Confirm User"** (assim não precisa confirmar por e-mail).
3. Clique em **Create user**.
4. Ainda em Authentication, vá em **Providers → Email** e **desative "Allow new users to sign up"** — isso impede que qualquer pessoa crie uma conta nova sozinha; só o usuário que você acabou de criar (e outros que você criar manualmente) conseguem entrar.

Pronto — agora `/admin` pede e-mail e senha antes de mostrar qualquer coisa.

### O que mudou

- **Segurança**: `/admin` agora exige login. Sem a senha, ninguém consegue aceitar pedidos, mexer no caixa ou editar o cardápio — o cliente continua conseguindo ver o cardápio e fazer pedidos normalmente, sem precisar de login.
- **Relatórios**: nova aba com faturamento de hoje (delivery + balcão separados), total dos últimos 30 dias, gráfico dos últimos 14 dias, e produtos mais vendidos.
- **Aviso persistente**: enquanto houver pedido pendente sem resposta, o som repete a cada 20 segundos e o título da aba do navegador pisca ("🔴 1 pedido aguardando!") — difícil de não perceber.
- **Estoque**: ao cadastrar um item no cardápio, o campo "Estoque" é opcional (vazio = ilimitado). Quando chega a zero, o item aparece como "Esgotado" pro cliente automaticamente.
- **Cupons de desconto**: crie cupons (percentual ou valor fixo, com validade e limite de usos opcionais) na tela de Configurações. O cliente aplica o código no checkout e o desconto entra no cálculo do total.

## Novidades: taxa por bairro, pedido fora do horário, e melhorias no Caixa

Rode isso no SQL Editor do Supabase:

```sql
-- Taxa de entrega por bairro
create table if not exists bairros_entrega (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  taxa numeric(12,2) not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table bairros_entrega enable row level security;
create policy "bairros_entrega leitura publica" on bairros_entrega for select using (true);
create policy "bairros_entrega escrita autenticada" on bairros_entrega for insert with check (auth.role() = 'authenticated');
create policy "bairros_entrega update autenticada" on bairros_entrega for update using (auth.role() = 'authenticated');
create policy "bairros_entrega delete autenticada" on bairros_entrega for delete using (auth.role() = 'authenticated');

-- Data agendada do pedido (quando feito fora do horário)
alter table pedidos add column if not exists data_pedido date;
```

### O que mudou

- **Taxa de entrega por bairro**: em Configurações → "Taxa de entrega por bairro", cadastre o nome do bairro e o valor. Se o bairro que o cliente digitar (ou vier do CEP) bater com um da lista, essa taxa é usada; senão, usa a taxa geral.
- **Pedido fora do horário**: o cliente não é mais bloqueado. Se fizer o pedido fora do horário de funcionamento, aparece um aviso "Fora do horário de atendimento" e ele escolhe para qual dia (dos dias configurados como abertos, ex: Sábado ou Domingo) o pedido é. O texto avisa dinamicamente a que horas a entrega começa nesse dia. No painel, pedidos agendados mostram "Agendado para [dia]" no card.
- **Observação em branco**: o campo de observação do pedido não mostra mais texto de exemplo.
- **Caixa — Compras**: novo campo pra lançar compras (descrição + valor), contabilizado como saída do caixa.
- **Caixa — Lançar vendas do dia**: novo campo pra fechar o dia de uma vez, informando o total vendido em Dinheiro, Cartão e Pix — sem precisar lançar venda por venda.

## Novidades: bairros restritos, cupom opcional, aceite automático e novo visual

Rode isso no SQL Editor do Supabase (se o projeto já existia; se for um projeto novo, o `schema.sql` completo já inclui isso):

```sql
alter table configuracoes add column if not exists cupom_ativo boolean not null default true;
alter table configuracoes add column if not exists aceitar_pedidos_automatico boolean not null default false;
```

### O que mudou

- **Bairro obrigatório da lista**: em Configurações → "Taxa de entrega por bairro", os bairros cadastrados agora aparecem como uma lista de seleção no checkout do cliente — ele só consegue escolher "Entrega" para um bairro que você cadastrou (o CEP continua preenchendo a rua e tentando encontrar o bairro correspondente automaticamente). Se você não cadastrar nenhum bairro, a entrega continua liberada para qualquer endereço, usando a taxa geral.
- **Cupom pode ser ocultado**: em Configurações → "Cupons de desconto", um botão "Visível no site" / "Oculto no site" controla se o campo de cupom aparece no checkout do cliente. Os cupons continuam cadastrados, só o campo some da tela.
- **Som do pedido novo a cada 2 segundos**: enquanto houver pedido pendente sem resposta, o alerta sonoro repete a cada 2 segundos (antes era a cada 20s).
- **Aceitar pedidos automaticamente**: novo botão na aba Pedidos ("Aceitar pedidos novos automaticamente") — quando ligado, todo pedido novo já entra como "Aceito" assim que chega, sem precisar tocar em nada. Pode ligar e desligar quando quiser.
- **Visual do site do cliente**: novo fundo com foto de frango assado atrás do cabeçalho (com um leve escurecido pra manter a leitura fácil), cabeçalho maior com a frase "Frango assado na hora, do jeito que só o Divino faz" na tela do cardápio.

## Domínio próprio

Em vez de `SEU-SITE.vercel.app`, você pode usar um domínio seu (ex: `pedidos.divinofrango.com.br` ou `divinofrangopedidos.com`).

1. **Compre um domínio** — em [registro.br](https://registro.br) (para `.com.br`, mais barato e é o registro oficial no Brasil) ou em [Namecheap](https://namecheap.com)/GoDaddy (para `.com`).
2. Na Vercel, entra no projeto → **Settings → Domains**.
3. Digita o domínio que você comprou e clica em **Add**.
4. A Vercel mostra um ou dois registros de DNS pra você configurar (geralmente um **CNAME** apontando para `cname.vercel-dns.com`, ou um **A record** com um IP). 
5. Vai até o painel do lugar onde você comprou o domínio (registro.br, Namecheap, etc.) → área de **DNS** → adiciona esses registros exatamente como a Vercel mostrou.
6. Espera propagar (de alguns minutos até algumas horas). A Vercel confirma automaticamente quando estiver certo.

Se quiser fazer essa parte, me chama que eu te guio passo a passo igual fizemos com o Supabase e a Vercel.

## Estrutura

```
├── index.html              # site do cliente (raiz)
├── admin.html               # painel do dono (/admin)
├── src/
│   ├── main.jsx              # entrada do site do cliente
│   ├── admin-main.jsx         # entrada do painel do dono
│   ├── PedidoApp.jsx           # lógica/telas do site do cliente
│   ├── AdminApp.jsx             # lógica/telas do painel (pedidos + cardápio)
│   ├── supabaseClient.js         # conexão com o Supabase deste projeto
│   └── logo.js                    # logo do Divino Frango em base64
├── supabase/schema.sql       # script único para criar tudo no Supabase
├── vercel.json / netlify.toml  # URLs amigáveis (/admin)
├── package.json
└── vite.config.js
```

## Rodada 2 (Caixa, pedidos ativos/histórico, loja aberta/fechada)

**Painel (`AdminApp.jsx`)**
- **Caixa → Compras:** produto(s), quantidade, unidade (Unidade/Kg), valor, data, observação e foto da nota fiscal. A foto vai para o bucket privado `notas-fiscais` (caminho salvo em `nota_foto_path`) e é aberta com link temporário ("Ver nota fiscal"), inclusive em "Compras recentes", depois que o caixa fecha. Sem leitura automática (OCR) por enquanto.
- **Sangria** saiu da tela (lançamentos antigos continuam no banco e no saldo). Suprimento continua.
- **Pedidos:** duas áreas, *Pedidos ativos* e *Histórico de pedidos* (busca por cliente/nº/produto, filtro por status e por data). Cada pedido mostra data e hora originais (`created_at`).
- **Saiu para entrega:** grava `pronto_em` (status continua `pronto`) e o pedido vai para o histórico. Retirada "pronta" continua nos ativos até concluir.
- **Cancelar pedido:** confirmação + motivo opcional; grava `status = cancelado`, `cancelado_em`, `motivo_cancelamento`. Nada é apagado.
- **Configurações:** botão grande LOJA ABERTA / FECHADA (`loja_fechada`), mensagem de loja fechada (`mensagem_loja_fechada`) e tempo estimado de entrega (`tempo_entrega_min`, `tempo_entrega_max`, `mostrar_tempo_entrega`).

**Site do cliente (`PedidoApp.jsx`)**
- Loja fechada: aviso com a mensagem, sem botões de adicionar e sem checkout (a proteção do banco continua valendo).
- Tempo estimado de entrega ("40–60 min") quando ligado no painel.
- "Outros" não aparece para o cliente; produtos sem categoria ficam na aba *Todos*.
- Cards de produto redesenhados; tela própria para pedido cancelado.

O banco usa as estruturas criadas pela migração da rodada 2 (executada à parte). O `supabase/schema.sql` deste projeto **não** foi atualizado com essas colunas.

## Rodada 3 (novo visual do site do cliente, WhatsApp, loja aberta/fechada no banco)

**Rode no SQL Editor do Supabase:** o arquivo [`supabase/migracao-loja-e-entrega.sql`](./supabase/migracao-loja-e-entrega.sql). Ele cria as colunas `loja_fechada`, `mensagem_loja_fechada`, `tempo_entrega_min`, `tempo_entrega_max` e `mostrar_tempo_entrega`, mais a trava que recusa pedidos com a loja fechada. Sem ele, o "Salvar configurações" do painel dá erro e o botão LOJA ABERTA / FECHADA não funciona. O `schema.sql` já inclui isso para projetos novos.

**Site do cliente (`PedidoApp.jsx`)**
- Topo com as fotos dos frangos e combos do cardápio passando sozinhas (estilo stories), com nome, preço e botão de adicionar.
- Selo no cabeçalho com o horário do dia ("Aberto até 14:00", "Fecha em 35 min", "Aceitando encomendas", "Fechado agora"), lido dos horários do painel.
- "Só restam N" quando o estoque cadastrado é 5 ou menos.
- Sugestões de acompanhamentos e bebidas no carrinho.
- Botão do WhatsApp (47) 99705-0828 para dúvidas (número em `WHATSAPP_NUMERO`, no topo do arquivo).
- Fotos do cardápio carregadas em versão reduzida pelo serviço de imagens do Supabase (com volta automática para a original se falhar).

## Contatos de clientes (aba Contatos do painel)

**Rode no SQL Editor do Supabase:** [`supabase/migracao-contatos.sql`](./supabase/migracao-contatos.sql). Cria a tabela `contatos` (só o painel logado lê), a função `registrar_contato` usada pelo site e já importa quem fez pedido antes.

- O site grava nome + WhatsApp assim que a pessoa preenche os dois no checkout, mesmo se ela desistir, e marca "fez pedido" quando envia.
- No painel: busca, filtros (todos / fizeram pedido / não finalizaram pedido), botão para abrir a conversa e botão **Excel** que baixa a lista filtrada em `.csv`.

## Segurança: pedidos só visíveis no painel

**Rode no SQL Editor do Supabase (depois do site novo publicado):** [`supabase/migracao-seguranca-pedidos.sql`](./supabase/migracao-seguranca-pedidos.sql). Antes dele, qualquer pessoa com a chave pública do site conseguia ler nome, telefone e endereço de todos os pedidos. Depois, só o painel logado lê a tabela `pedidos`; o site grava o pedido com um id gerado no navegador e acompanha o status pela função `status_pedido` (consulta a cada 10 segundos).

## O que já foi verificado

Sintaxe de todo o JSX/JS validada (parsing completo, sem erros). Na rodada 2 os dois apps também foram renderizados num navegador de teste, contra um banco simulado, cobrindo pedidos ativos/histórico, cancelamento, compras com foto, loja fechada e tempo de entrega.

## O que só dá pra confirmar depois do deploy

Este ambiente não tem acesso à internet, então não foi possível rodar `npm install`/`npm run build` de verdade aqui. As dependências são padrão e estáveis — o teste real acontece no primeiro `npm install` + `npm run build`, seja no seu computador ou automaticamente na Vercel/Netlify. Qualquer erro nesse momento, me manda a mensagem que eu ajusto.
