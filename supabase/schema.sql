-- Divino Frango — Pedidos (projeto independente)
-- Cole este arquivo inteiro no SQL Editor do seu NOVO projeto Supabase e execute (Run).

create extension if not exists "pgcrypto";

-- ---------- cardápio público (o que o cliente vê no site de pedidos) ----------
create table if not exists cardapio (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  preco numeric(12,2) not null,
  foto_url text,
  categoria text,
  disponivel boolean not null default true,
  estoque integer,  -- deixe vazio (null) para estoque ilimitado
  created_at timestamptz not null default now()
);

-- ---------- pedidos feitos pelos clientes no site público ----------
create table if not exists pedidos (
  id uuid primary key default gen_random_uuid(),
  cliente_nome text not null,
  cliente_telefone text not null,
  tipo_entrega text not null,       -- 'retirada' ou 'entrega'
  cep text,
  endereco text,
  bairro text,
  referencia text,
  forma_pagamento text not null,
  precisa_troco boolean not null default false,
  troco_para numeric(12,2),
  itens jsonb not null default '[]'::jsonb,  -- [{nome, preco, qtd}, ...]
  subtotal numeric(12,2),
  taxa_entrega numeric(12,2) not null default 0,
  cupom_codigo text,
  desconto numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  observacao text,
  status text not null default 'pendente',   -- pendente | aceito | preparando | pronto | concluido | recusado
  created_at timestamptz not null default now()
);
create index if not exists pedidos_status_idx on pedidos (status);
create index if not exists pedidos_created_idx on pedidos (created_at);

-- ---------- cupons de desconto ----------
create table if not exists cupons (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  tipo text not null,              -- percentual | valor
  valor numeric(12,2) not null,
  ativo boolean not null default true,
  validade date,
  usos_maximos integer,
  usos_atual integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- configurações do sistema (taxa de entrega, horário de funcionamento) ----------
create table if not exists configuracoes (
  id int primary key default 1,
  taxa_entrega numeric(12,2) not null default 0,
  horarios jsonb not null default '{
    "0": {"aberto": true,  "abre": "08:00", "fecha": "14:00", "entregaAbre": "11:00", "entregaFecha": "14:00"},
    "1": {"aberto": false, "abre": "08:00", "fecha": "14:00", "entregaAbre": "11:00", "entregaFecha": "14:00"},
    "2": {"aberto": false, "abre": "08:00", "fecha": "14:00", "entregaAbre": "11:00", "entregaFecha": "14:00"},
    "3": {"aberto": false, "abre": "08:00", "fecha": "14:00", "entregaAbre": "11:00", "entregaFecha": "14:00"},
    "4": {"aberto": false, "abre": "08:00", "fecha": "14:00", "entregaAbre": "11:00", "entregaFecha": "14:00"},
    "5": {"aberto": false, "abre": "08:00", "fecha": "14:00", "entregaAbre": "11:00", "entregaFecha": "14:00"},
    "6": {"aberto": true,  "abre": "08:00", "fecha": "14:00", "entregaAbre": "11:00", "entregaFecha": "14:00"}
  }'::jsonb,
  updated_at timestamptz not null default now()
);
insert into configuracoes (id, taxa_entrega) values (1, 0) on conflict (id) do nothing;

-- habilita o Supabase Realtime para a tabela de pedidos (o painel avisa na hora, com som)
alter publication supabase_realtime add table pedidos;

-- ---------- segurança (RLS) ----------
-- O cliente (site público) só pode LER o cardápio/configurações e CRIAR pedidos.
-- Só quem estiver logado (login criado no painel /admin) pode alterar cardápio,
-- configurações, status de pedidos, e usar o Caixa. Veja o passo "Criar o login
-- do admin" no README para criar seu usuário e senha.
alter table cardapio enable row level security;
alter table pedidos enable row level security;
alter table configuracoes enable row level security;
alter table cupons enable row level security;

create policy "cardapio leitura publica" on cardapio for select using (true);
create policy "cardapio escrita autenticada" on cardapio for insert with check (auth.role() = 'authenticated');
create policy "cardapio update autenticada" on cardapio for update using (auth.role() = 'authenticated');
create policy "cardapio delete autenticada" on cardapio for delete using (auth.role() = 'authenticated');

create policy "pedidos leitura publica" on pedidos for select using (true);
create policy "pedidos insercao publica" on pedidos for insert with check (true);
create policy "pedidos update autenticada" on pedidos for update using (auth.role() = 'authenticated');

create policy "configuracoes leitura publica" on configuracoes for select using (true);
create policy "configuracoes update autenticada" on configuracoes for update using (auth.role() = 'authenticated');

create policy "cupons leitura publica" on cupons for select using (true);
create policy "cupons escrita autenticada" on cupons for insert with check (auth.role() = 'authenticated');
create policy "cupons update autenticada" on cupons for update using (auth.role() = 'authenticated');
create policy "cupons delete autenticada" on cupons for delete using (auth.role() = 'authenticated');

-- ---------- funções seguras chamadas pelo site público ----------
-- Diminuem o estoque e contam o uso de cupom sem dar ao site público acesso
-- de escrita direto nas tabelas (só essas duas ações pontuais são permitidas).
create or replace function decrementar_estoque(p_item_id uuid, p_quantidade int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update cardapio
  set estoque = greatest(estoque - p_quantidade, 0)
  where id = p_item_id and estoque is not null;
end;
$$;
grant execute on function decrementar_estoque(uuid, int) to anon, authenticated;

create or replace function usar_cupom(p_codigo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update cupons
  set usos_atual = usos_atual + 1
  where lower(codigo) = lower(p_codigo);
end;
$$;
grant execute on function usar_cupom(text) to anon, authenticated;

-- ---------- espaço de armazenamento das fotos do cardápio ----------
insert into storage.buckets (id, name, public)
values ('cardapio', 'cardapio', true)
on conflict (id) do nothing;

create policy "cardapio foto leitura publica" on storage.objects for select using (bucket_id = 'cardapio');
create policy "cardapio foto upload autenticada" on storage.objects for insert with check (bucket_id = 'cardapio' and auth.role() = 'authenticated');
create policy "cardapio foto update autenticada" on storage.objects for update using (bucket_id = 'cardapio' and auth.role() = 'authenticated');
create policy "cardapio foto delete autenticada" on storage.objects for delete using (bucket_id = 'cardapio' and auth.role() = 'authenticated');

-- ---------- caixa: turnos de abertura/fechamento e movimentações financeiras ----------
create table if not exists caixas (
  id uuid primary key default gen_random_uuid(),
  aberto_em timestamptz not null default now(),
  fechado_em timestamptz,
  valor_abertura numeric(12,2) not null default 0,
  valor_fechamento_informado numeric(12,2),
  status text not null default 'aberto', -- aberto | fechado
  observacao text,
  created_at timestamptz not null default now()
);
create index if not exists caixas_status_idx on caixas (status);

create table if not exists movimentacoes_caixa (
  id uuid primary key default gen_random_uuid(),
  caixa_id uuid not null references caixas(id) on delete cascade,
  tipo text not null,              -- venda | sangria | suprimento
  valor numeric(12,2) not null,
  forma_pagamento text,            -- só para tipo = venda
  descricao text,
  created_at timestamptz not null default now()
);
create index if not exists movimentacoes_caixa_caixa_idx on movimentacoes_caixa (caixa_id);

alter table caixas enable row level security;
alter table movimentacoes_caixa enable row level security;
create policy "caixas autenticada" on caixas for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "movimentacoes_caixa autenticada" on movimentacoes_caixa for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ---------- equipe: funcionários e pagamento de diária ----------
create table if not exists funcionarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  funcao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists diarias (
  id uuid primary key default gen_random_uuid(),
  funcionario_nome text not null,
  valor numeric(12,2) not null,
  data date not null,
  created_at timestamptz not null default now()
);
create index if not exists diarias_data_idx on diarias (data);

alter table funcionarios enable row level security;
alter table diarias enable row level security;
create policy "funcionarios autenticada" on funcionarios for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "diarias autenticada" on diarias for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ---------- taxa de entrega por bairro ----------
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

-- ---------- pedido agendado para um dia de funcionamento futuro ----------
alter table pedidos add column if not exists data_pedido date;

-- ---------- cupom visível no site / aceite automático de pedidos ----------
alter table configuracoes add column if not exists cupom_ativo boolean not null default true;
alter table configuracoes add column if not exists aceitar_pedidos_automatico boolean not null default false;

-- ---------- loja aberta/fechada e tempo de entrega (igual a supabase/migracao-loja-e-entrega.sql) ----------
alter table configuracoes add column if not exists loja_fechada boolean not null default false;
alter table configuracoes add column if not exists mensagem_loja_fechada text;
alter table configuracoes add column if not exists tempo_entrega_min integer not null default 40;
alter table configuracoes add column if not exists tempo_entrega_max integer not null default 60;
alter table configuracoes add column if not exists mostrar_tempo_entrega boolean not null default false;

-- proteção no banco: com a loja fechada no painel, nenhum pedido novo entra,
-- mesmo que o cliente esteja com o site aberto há horas sem recarregar
create or replace function bloquear_pedido_loja_fechada()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from configuracoes where id = 1 and loja_fechada) then
    raise exception 'Loja fechada: pedidos pausados no momento.';
  end if;
  return new;
end; $$;

drop trigger if exists pedidos_bloqueia_loja_fechada on pedidos;
create trigger pedidos_bloqueia_loja_fechada
  before insert on pedidos
  for each row execute function bloquear_pedido_loja_fechada();
