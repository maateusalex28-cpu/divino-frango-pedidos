-- Aba Balcão: pedidos lançados no balcão + reservas (encomendas para retirar).
-- Pode rodar mais de uma vez; não apaga nada.

-- 1) Origem do pedido: 'site' (cliente) ou 'balcao' (lançado no painel).
alter table pedidos add column if not exists origem text not null default 'site';

-- Entregador do pedido (nome de quem levou a entrega).
alter table pedidos add column if not exists entregador text;

-- 2) Reservas / encomendas para retirar.
create table if not exists reservas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cliente_nome text not null,
  cliente_telefone text,
  data_retirada date not null,
  hora_retirada text,
  descricao text not null default '',
  total numeric(12,2) not null default 0,
  sinal_pago numeric(12,2) not null default 0,
  observacao text,
  status text not null default 'pendente'
    check (status in ('pendente', 'confirmada', 'retirada', 'cancelada'))
);

create index if not exists reservas_data_idx on reservas (data_retirada);

alter table reservas enable row level security;

-- Só quem está logado no painel mexe nas reservas.
-- Usa eh_admin() se ela existir (migracao-seguranca); senão, usuário autenticado.
do $$
begin
  drop policy if exists "reservas admin" on reservas;
  if exists (select 1 from pg_proc where proname = 'eh_admin') then
    execute 'create policy "reservas admin" on reservas for all using (eh_admin()) with check (eh_admin())';
  else
    execute 'create policy "reservas admin" on reservas for all using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'')';
  end if;
end $$;
