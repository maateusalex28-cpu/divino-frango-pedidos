-- =====================================================================
-- Segurança: fecha a leitura pública da tabela de pedidos
--
-- Antes: qualquer pessoa com o link do site conseguia baixar nome, telefone e
-- endereço de TODOS os clientes (a chave pública fica dentro do site).
-- Depois: só o painel logado lê os pedidos. O cliente continua acompanhando
-- o próprio pedido pela função status_pedido, que só devolve o status de um
-- pedido cujo id (código aleatório de 36 caracteres) ele já conhece.
--
-- IMPORTANTE: rode só DEPOIS que a versão nova do site estiver publicada
-- (a versão antiga lia a tabela direto e pararia de acompanhar os pedidos).
--
-- Rode no Supabase: SQL Editor -> New query -> cole tudo -> Run.
-- Pode rodar de novo sem problema.
-- =====================================================================

-- remove todas as regras de leitura de pedidos que existirem hoje (qualquer nome)
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'pedidos' and cmd in ('SELECT', 'ALL')
  loop
    execute format('drop policy %I on public.pedidos', r.policyname);
  end loop;
end $$;

alter table pedidos enable row level security;

-- leitura: só o painel (usuário logado)
drop policy if exists "pedidos leitura autenticada" on pedidos;
create policy "pedidos leitura autenticada" on pedidos for select using (auth.role() = 'authenticated');

-- criar pedido continua liberado para o site; alterar continua só para o painel
drop policy if exists "pedidos insercao publica" on pedidos;
create policy "pedidos insercao publica" on pedidos for insert with check (true);
drop policy if exists "pedidos update autenticada" on pedidos;
create policy "pedidos update autenticada" on pedidos for update using (auth.role() = 'authenticated');

-- o cliente consulta só o status do próprio pedido (sem nome, telefone ou endereço)
create or replace function status_pedido(p_id uuid)
returns table (id uuid, status text, tipo_entrega text, total numeric, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.status, p.tipo_entrega, p.total, p.created_at from pedidos p where p.id = p_id;
$$;
grant execute on function status_pedido(uuid) to anon, authenticated;
