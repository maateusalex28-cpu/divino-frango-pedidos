-- =====================================================================
-- Contatos de clientes (aba "Contatos" do /admin, com exportação para Excel)
--
-- Rode UMA vez no Supabase: SQL Editor -> New query -> cole tudo -> Run.
-- Pode rodar de novo sem problema.
--
-- O site grava nome + WhatsApp assim que a pessoa preenche os dois campos no
-- checkout (mesmo que ela desista antes de enviar o pedido), e atualiza quando
-- o pedido é enviado. Um telefone = um contato (sem duplicados).
-- =====================================================================

create table if not exists contatos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text not null unique,                       -- só os dígitos, com DDD (10 ou 11)
  fez_pedido boolean not null default false,           -- false = preencheu os dados e não enviou
  total_pedidos integer not null default 0,
  primeiro_contato timestamptz not null default now(),
  ultimo_contato timestamptz not null default now()
);
create index if not exists contatos_ultimo_idx on contatos (ultimo_contato desc);

-- só quem está logado no painel lê, edita ou apaga; o site público NÃO consegue ler a lista
alter table contatos enable row level security;
drop policy if exists "contatos leitura autenticada" on contatos;
drop policy if exists "contatos update autenticada" on contatos;
drop policy if exists "contatos delete autenticada" on contatos;
create policy "contatos leitura autenticada" on contatos for select using (auth.role() = 'authenticated');
create policy "contatos update autenticada" on contatos for update using (auth.role() = 'authenticated');
create policy "contatos delete autenticada" on contatos for delete using (auth.role() = 'authenticated');

-- o site grava por esta função (ele não tem permissão direta na tabela)
create or replace function registrar_contato(p_nome text, p_telefone text, p_fez_pedido boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_nome text := left(trim(coalesce(p_nome, '')), 120);
begin
  if length(v_tel) not in (10, 11) or length(v_nome) < 2 then
    return;
  end if;
  insert into contatos (nome, telefone, fez_pedido, total_pedidos)
  values (v_nome, v_tel, coalesce(p_fez_pedido, false), case when p_fez_pedido then 1 else 0 end)
  on conflict (telefone) do update set
    nome = excluded.nome,
    fez_pedido = contatos.fez_pedido or excluded.fez_pedido,
    total_pedidos = contatos.total_pedidos + excluded.total_pedidos,
    ultimo_contato = now();
end; $$;
grant execute on function registrar_contato(text, text, boolean) to anon, authenticated;

-- traz para a lista quem já fez pedido antes de existir esta tabela
insert into contatos (nome, telefone, fez_pedido, total_pedidos, primeiro_contato, ultimo_contato)
select distinct on (tel) cliente_nome, tel, true, qtd, primeiro, ultimo
from (
  select
    cliente_nome,
    regexp_replace(cliente_telefone, '\D', '', 'g') as tel,
    created_at,
    count(*) over (partition by regexp_replace(cliente_telefone, '\D', '', 'g')) as qtd,
    min(created_at) over (partition by regexp_replace(cliente_telefone, '\D', '', 'g')) as primeiro,
    max(created_at) over (partition by regexp_replace(cliente_telefone, '\D', '', 'g')) as ultimo
  from pedidos
) p
where length(tel) in (10, 11)
order by tel, created_at desc
on conflict (telefone) do nothing;
