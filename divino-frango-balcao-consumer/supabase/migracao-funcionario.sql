-- Usuário "atendente" (funcionário): só enxerga as abas Pedidos, Balcão, Cardápio e Contatos.
-- O administrador (tabela admins) continua vendo tudo, inclusive os pedidos lançados pelo atendente.
-- Rodar DEPOIS de migracao-seguranca.sql e migracao-balcao-reservas.sql. Pode rodar mais de uma vez.
-- Este arquivo já inclui o que faz o migracao-balcao-gatilhos.sql (pode rodar os dois, a ordem não importa).

-- 1) Quem é atendente. Sem policies: ninguém lê nem grava direto; o acesso é só pelas funções abaixo.
create table if not exists public.atendentes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.atendentes enable row level security;

-- 2) Funções de perfil
create or replace function public.eh_atendente()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.atendentes where user_id = auth.uid());
$$;

create or replace function public.meu_perfil()
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v boolean := false;
begin
  if to_regprocedure('public.eh_admin()') is null then
    return 'admin';
  end if;
  execute 'select public.eh_admin()' into v;
  if coalesce(v, false) then
    return 'admin';
  end if;
  if exists (select 1 from public.atendentes where user_id = auth.uid()) then
    return 'atendente';
  end if;
  return 'nenhum';
end; $$;

-- administrador ou atendente: quem pode lançar pedido pelo painel (usada nas travas de pedidos)
create or replace function public.pode_lancar_pedido_painel()
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v boolean := false;
begin
  if to_regprocedure('public.eh_admin()') is null then
    return true;
  end if;
  execute 'select public.eh_admin()' into v;
  if coalesce(v, false) then
    return true;
  end if;
  return exists (select 1 from public.atendentes where user_id = auth.uid());
end; $$;

-- 3) Gerenciar atendentes (só administrador)
create or replace function public.registrar_atendente(p_email text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_adm boolean := false;
begin
  if to_regprocedure('public.eh_admin()') is not null then
    execute 'select public.eh_admin()' into v_adm;
  end if;
  if not coalesce(v_adm, false) then
    raise exception 'Sem permissão';
  end if;
  select id into v_id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_id is null then
    raise exception 'Usuário não encontrado';
  end if;
  if to_regclass('public.admins') is not null and exists (select 1 from public.admins where user_id = v_id) then
    raise exception 'Este usuário já é administrador';
  end if;
  insert into public.atendentes (user_id) values (v_id) on conflict do nothing;
  update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = v_id;
end; $$;

create or replace function public.listar_atendentes()
returns table (user_id uuid, email text, criado_em timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_adm boolean := false;
begin
  if to_regprocedure('public.eh_admin()') is not null then
    execute 'select public.eh_admin()' into v_adm;
  end if;
  if not coalesce(v_adm, false) then
    raise exception 'Sem permissão';
  end if;
  return query
    select a.user_id, u.email::text, a.created_at
    from public.atendentes a
    join auth.users u on u.id = a.user_id
    order by a.created_at;
end; $$;

create or replace function public.remover_atendente(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_adm boolean := false;
begin
  if to_regprocedure('public.eh_admin()') is not null then
    execute 'select public.eh_admin()' into v_adm;
  end if;
  if not coalesce(v_adm, false) then
    raise exception 'Sem permissão';
  end if;
  delete from public.atendentes where user_id = p_user_id;
end; $$;

revoke all on function public.registrar_atendente(text) from public, anon;
revoke all on function public.listar_atendentes() from public, anon;
revoke all on function public.remover_atendente(uuid) from public, anon;
revoke all on function public.meu_perfil() from public, anon;
revoke all on function public.eh_atendente() from public, anon;
grant execute on function public.registrar_atendente(text) to authenticated;
grant execute on function public.listar_atendentes() to authenticated;
grant execute on function public.remover_atendente(uuid) to authenticated;
grant execute on function public.meu_perfil() to authenticated;
grant execute on function public.eh_atendente() to authenticated;

-- 4) O que o atendente pode ler e gravar (só estas tabelas; sem caixa, compras, equipe, financeiro)
do $do$
begin
  if to_regclass('public.pedidos') is not null then
    execute 'drop policy if exists "atendente pedidos ver" on public.pedidos';
    execute 'create policy "atendente pedidos ver" on public.pedidos for select to authenticated using (public.eh_atendente())';
    execute 'drop policy if exists "atendente pedidos criar" on public.pedidos';
    execute 'create policy "atendente pedidos criar" on public.pedidos for insert to authenticated with check (public.eh_atendente())';
    execute 'drop policy if exists "atendente pedidos editar" on public.pedidos';
    execute 'create policy "atendente pedidos editar" on public.pedidos for update to authenticated using (public.eh_atendente()) with check (public.eh_atendente())';
  end if;
  if to_regclass('public.cardapio') is not null then
    execute 'drop policy if exists "atendente cardapio" on public.cardapio';
    execute 'create policy "atendente cardapio" on public.cardapio for all to authenticated using (public.eh_atendente()) with check (public.eh_atendente())';
  end if;
  if to_regclass('public.contatos') is not null then
    execute 'drop policy if exists "atendente contatos" on public.contatos';
    execute 'create policy "atendente contatos" on public.contatos for all to authenticated using (public.eh_atendente()) with check (public.eh_atendente())';
  end if;
  -- só leitura: horários/taxa padrão e bairros de entrega (o Balcão usa para calcular a taxa)
  if to_regclass('public.configuracoes') is not null then
    execute 'drop policy if exists "atendente configuracoes ver" on public.configuracoes';
    execute 'create policy "atendente configuracoes ver" on public.configuracoes for select to authenticated using (public.eh_atendente())';
  end if;
  if to_regclass('public.bairros_entrega') is not null then
    execute 'drop policy if exists "atendente bairros ver" on public.bairros_entrega';
    execute 'create policy "atendente bairros ver" on public.bairros_entrega for select to authenticated using (public.eh_atendente())';
  end if;
end
$do$;

-- fotos do cardápio (bucket "cardapio")
do $do$
begin
  execute 'drop policy if exists "atendente cardapio fotos" on storage.objects';
  execute $p$create policy "atendente cardapio fotos" on storage.objects for all to authenticated
    using (bucket_id = 'cardapio' and public.eh_atendente())
    with check (bucket_id = 'cardapio' and public.eh_atendente())$p$;
exception when others then
  raise notice 'Não consegui criar a regra das fotos do cardápio para o atendente (%). O resto foi aplicado.', sqlerrm;
end
$do$;

-- 5) Travas do pedido: pedido do painel (admin ou atendente) passa com telefone opcional, bairro livre e loja fechada
create or replace function public.bloquear_pedido_loja_fechada()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if coalesce(new.origem, 'site') = 'balcao' and coalesce(auth.role(), '') = 'authenticated'
     and public.pode_lancar_pedido_painel() then
    return new;
  end if;
  if exists (select 1 from configuracoes where id = 1 and loja_fechada) then
    raise exception 'Loja fechada: pedidos pausados no momento.';
  end if;
  return new;
end; $fn$;

do $do$
declare
  def text;
  pos int;
  achado text;
  velho text := $v$execute 'select public.eh_admin()' into v_adm_bal;$v$;
  novo text := $n$execute 'select public.pode_lancar_pedido_painel()' into v_adm_bal;$n$;
  injecao text := $inj$
  declare
    v_adm_bal boolean := false;
  begin
    -- bypass_balcao
    if coalesce(new.origem, 'site') = 'balcao' and coalesce(auth.role(), '') = 'authenticated' then
      execute 'select public.pode_lancar_pedido_painel()' into v_adm_bal;
      if v_adm_bal then
        if new.itens is null or jsonb_typeof(new.itens) <> 'array' or jsonb_array_length(new.itens) = 0 then
          raise exception 'Pedido sem itens válidos';
        end if;
        new.cliente_nome := left(trim(coalesce(nullif(trim(new.cliente_nome), ''), 'Balcão')), 120);
        new.cliente_telefone := left(trim(coalesce(new.cliente_telefone, '')), 20);
        new.forma_pagamento := left(coalesce(new.forma_pagamento, ''), 40);
        return new;
      end if;
    end if;
  end;
$inj$;
begin
  def := pg_get_functiondef('public.validar_pedido()'::regprocedure);
  if position('bypass_balcao' in def) > 0 then
    -- já tem o bloco do balcão (versão antiga liberava só admin): troca para admin ou atendente
    if position(velho in def) > 0 then
      execute replace(def, velho, novo);
    end if;
    return;
  end if;
  achado := (regexp_match(def, E'\\n[ \\t]*begin[ \\t]*\\r?\\n'))[1];
  if achado is null then
    raise exception 'Não encontrei o início da função validar_pedido; nada foi alterado. Trecho: [%]',
      replace(replace(substr(def, greatest(position('begin' in lower(def)) - 20, 1), 90), E'\r', '<CR>'), E'\n', '<LF>');
  end if;
  pos := position(achado in def);
  def := substr(def, 1, pos - 1 + length(achado)) || injecao || substr(def, pos + length(achado));
  execute def;
end
$do$;
