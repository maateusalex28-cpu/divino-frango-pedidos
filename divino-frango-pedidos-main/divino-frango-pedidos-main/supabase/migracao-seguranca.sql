-- =====================================================================
-- SEGURANÇA GERAL do Divino Frango
--
-- Rode por ÚLTIMO, depois de migracao-loja-e-entrega.sql e migracao-contatos.sql,
-- e só com a versão nova do site já publicada.
-- Supabase: SQL Editor -> New query -> cole tudo -> Run. Pode rodar de novo.
--
-- O que este arquivo fecha:
--  1. Painel só para administradores cadastrados (tabela "admins"). Antes, qualquer
--     pessoa que criasse uma conta tinha acesso total a pedidos, caixa, cardápio...
--  2. Pedidos: ninguém de fora lê a tabela (nome, telefone, endereço dos clientes).
--  3. Pedido recalculado pelo banco: preço, taxa, desconto e total vêm do cardápio
--     e das configurações, não do navegador (impede pedido de R$ 1 "editado").
--  4. Estoque e uso de cupom baixados pelo próprio banco, ao gravar o pedido; as
--     funções antigas que qualquer um podia chamar (zerar estoque) foram travadas.
--  5. Cupons: a lista de códigos não fica mais pública; o site só valida um código.
--  6. Todas as tabelas com proteção ligada; regras antigas soltas são apagadas.
--  7. Fotos das notas fiscais: só o painel acessa.
--
-- DEPOIS DE RODAR, faça também no painel do Supabase:
--  * Authentication -> Sign In / Providers -> desligue "Allow new users to sign up".
--  * Authentication -> Users: confira se só aparecem pessoas da loja. Quem estiver
--    lá agora vira administrador (passo 1 abaixo); apague quem não conhecer e rode
--    de novo este arquivo.
-- Para adicionar um administrador novo no futuro (depois de criar o usuário em
-- Authentication -> Users -> Add user):
--    insert into admins (user_id) select id from auth.users where email = 'email@da.pessoa';
-- =====================================================================


-- ---------- 1. administradores ----------
create table if not exists admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  criado_em timestamptz not null default now()
);
alter table admins enable row level security;  -- sem regras: ninguém lê/edita pela internet

-- todos os usuários que existem hoje no Authentication viram administradores
insert into admins (user_id) select id from auth.users on conflict do nothing;

create or replace function eh_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;
grant execute on function eh_admin() to anon, authenticated;


-- ---------- 6. regras de acesso de TODAS as tabelas ----------
-- apaga todas as regras atuais (inclusive antigas tipo "acesso total") e liga a proteção;
-- depois cada tabela ganha "só administrador" + as exceções públicas abaixo
do $$
declare t record; p record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'admins' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t.tablename loop
      execute format('drop policy %I on public.%I', p.policyname, t.tablename);
    end loop;
    execute format('create policy "admin total" on public.%I for all using (eh_admin()) with check (eh_admin())', t.tablename);
  end loop;
end $$;

-- exceções públicas (o site precisa): ver cardápio, configurações e bairros; criar pedido
create policy "leitura publica" on cardapio for select using (true);
create policy "leitura publica" on configuracoes for select using (true);
do $$ begin
  if to_regclass('public.bairros_entrega') is not null then
    execute 'create policy "leitura publica" on bairros_entrega for select using (true)';
  end if;
end $$;
create policy "site cria pedido" on pedidos for insert with check (true);


-- ---------- 2. status do pedido para o cliente (sem dados pessoais) ----------
create or replace function status_pedido(p_id uuid)
returns table (id uuid, status text, tipo_entrega text, total numeric, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.status, p.tipo_entrega, p.total, p.created_at from pedidos p where p.id = p_id;
$$;
grant execute on function status_pedido(uuid) to anon, authenticated;


-- ---------- 5. cupom: o site valida UM código, sem ver a lista ----------
create or replace function validar_cupom(p_codigo text)
returns table (codigo text, tipo text, valor numeric)
language sql stable security definer set search_path = public as $$
  select c.codigo, c.tipo, c.valor from cupons c
  where lower(c.codigo) = lower(trim(p_codigo))
    and c.ativo
    and (c.validade is null or c.validade >= current_date)
    and (c.usos_maximos is null or c.usos_atual < c.usos_maximos)
  limit 1;
$$;
grant execute on function validar_cupom(text) to anon, authenticated;


-- ---------- 3. pedido conferido e recalculado pelo banco ----------
create or replace function validar_pedido()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  v_item cardapio%rowtype;
  v_qtd integer;
  v_itens jsonb := '[]'::jsonb;
  v_sub numeric := 0;
  v_taxa numeric := 0;
  v_desc numeric := 0;
  v_cfg configuracoes%rowtype;
  v_cupom record;
  v_bairro_taxa numeric;
  v_tem_bairros boolean := false;
begin
  if new.itens is null or jsonb_typeof(new.itens) <> 'array' or jsonb_array_length(new.itens) = 0 or jsonb_array_length(new.itens) > 50 then
    raise exception 'Pedido sem itens válidos';
  end if;

  for it in select * from jsonb_array_elements(new.itens) loop
    v_qtd := floor((it->>'qtd')::numeric);
    if v_qtd is null or v_qtd < 1 or v_qtd > 99 then
      raise exception 'Quantidade inválida';
    end if;
    v_item := null;
    if (it->>'id') ~* '^[0-9a-f-]{36}$' then
      select * into v_item from cardapio where id = (it->>'id')::uuid;
    end if;
    if v_item.id is null then
      select * into v_item from cardapio where nome = it->>'nome' order by created_at limit 1;
    end if;
    if v_item.id is null or not v_item.disponivel then
      raise exception 'Item indisponível: %', coalesce(it->>'nome', '?');
    end if;
    if v_item.estoque is not null and v_item.estoque < v_qtd then
      raise exception 'Estoque insuficiente: %', v_item.nome;
    end if;
    v_itens := v_itens || jsonb_build_array(jsonb_build_object('id', v_item.id, 'nome', v_item.nome, 'preco', v_item.preco, 'qtd', v_qtd));
    v_sub := v_sub + v_item.preco * v_qtd;
  end loop;

  select * into v_cfg from configuracoes where id = 1;

  if new.tipo_entrega = 'retirada' then
    v_taxa := 0;
  elsif new.tipo_entrega = 'entrega' then
    if to_regclass('public.bairros_entrega') is not null then
      execute 'select exists (select 1 from bairros_entrega where ativo)' into v_tem_bairros;
      execute 'select taxa from bairros_entrega where ativo and lower(trim(nome)) = lower(trim($1)) limit 1'
        into v_bairro_taxa using coalesce(new.bairro, '');
    end if;
    if v_tem_bairros and v_bairro_taxa is null then
      raise exception 'Bairro fora da área de entrega';
    end if;
    v_taxa := coalesce(v_bairro_taxa, v_cfg.taxa_entrega, 0);
  else
    raise exception 'Tipo de entrega inválido';
  end if;

  new.cupom_codigo := nullif(trim(coalesce(new.cupom_codigo, '')), '');
  if new.cupom_codigo is not null and coalesce(v_cfg.cupom_ativo, true) then
    select * into v_cupom from validar_cupom(new.cupom_codigo);
    if v_cupom.codigo is null then
      raise exception 'Cupom inválido';
    end if;
    v_desc := round(least(case when v_cupom.tipo = 'percentual' then v_sub * v_cupom.valor / 100 else v_cupom.valor end, v_sub), 2);
    new.cupom_codigo := v_cupom.codigo;
  else
    new.cupom_codigo := null;
  end if;

  if length(regexp_replace(coalesce(new.cliente_telefone, ''), '\D', '', 'g')) not in (10, 11) then
    raise exception 'Telefone inválido';
  end if;
  if length(trim(coalesce(new.cliente_nome, ''))) < 2 then
    raise exception 'Nome inválido';
  end if;

  new.itens := v_itens;
  new.subtotal := v_sub;
  new.taxa_entrega := v_taxa;
  new.desconto := v_desc;
  new.total := v_sub - v_desc + v_taxa;
  new.status := 'pendente';
  new.created_at := now();
  new.cliente_nome := left(trim(new.cliente_nome), 120);
  new.cliente_telefone := left(trim(new.cliente_telefone), 20);
  new.forma_pagamento := left(coalesce(new.forma_pagamento, ''), 40);
  new.cep := left(new.cep, 9);
  new.endereco := left(new.endereco, 200);
  new.bairro := left(new.bairro, 100);
  new.referencia := left(new.referencia, 200);
  new.observacao := left(new.observacao, 500);
  if new.forma_pagamento <> 'Dinheiro' then
    new.precisa_troco := false;
    new.troco_para := null;
  end if;
  return new;
end; $$;

drop trigger if exists pedidos_valida on pedidos;
create trigger pedidos_valida before insert on pedidos for each row execute function validar_pedido();


-- ---------- 4. estoque e uso de cupom baixados pelo banco ----------
create or replace function baixar_estoque_pedido()
returns trigger language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  for it in select * from jsonb_array_elements(new.itens) loop
    update cardapio set estoque = greatest(estoque - (it->>'qtd')::integer, 0)
    where id = (it->>'id')::uuid and estoque is not null;
  end loop;
  if new.cupom_codigo is not null then
    update cupons set usos_atual = usos_atual + 1 where lower(codigo) = lower(new.cupom_codigo);
  end if;
  return null;
end; $$;

drop trigger if exists pedidos_baixa_estoque on pedidos;
create trigger pedidos_baixa_estoque after insert on pedidos for each row execute function baixar_estoque_pedido();

-- funções antigas que o site chamava direto: ninguém de fora pode mais usar
-- (sem isso, qualquer um zerava o estoque de qualquer produto)
do $$ begin
  if to_regprocedure('public.decrementar_estoque(uuid, integer)') is not null then
    revoke execute on function public.decrementar_estoque(uuid, integer) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.usar_cupom(text)') is not null then
    revoke execute on function public.usar_cupom(text) from public, anon, authenticated;
  end if;
end $$;


-- ---------- 7. arquivos (fotos do cardápio e notas fiscais) ----------
update storage.buckets set public = false where id = 'notas-fiscais';

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

create policy "cardapio fotos leitura publica" on storage.objects for select using (bucket_id = 'cardapio');
create policy "cardapio fotos admin" on storage.objects for all
  using (bucket_id = 'cardapio' and eh_admin()) with check (bucket_id = 'cardapio' and eh_admin());
create policy "notas fiscais admin" on storage.objects for all
  using (bucket_id = 'notas-fiscais' and eh_admin()) with check (bucket_id = 'notas-fiscais' and eh_admin());
