-- Fila de impressão: o celular manda a comanda, o computador da loja imprime
create table if not exists fila_impressao (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null,
  created_at timestamptz not null default now(),
  impresso_em timestamptz
);
create index if not exists fila_impressao_pendente_idx on fila_impressao (created_at) where impresso_em is null;

alter table fila_impressao enable row level security;
drop policy if exists "admin total" on fila_impressao;
create policy "admin total" on fila_impressao for all using (eh_admin()) with check (eh_admin());

do $$
begin
  alter publication supabase_realtime add table fila_impressao;
exception when duplicate_object then null;
end $$;
