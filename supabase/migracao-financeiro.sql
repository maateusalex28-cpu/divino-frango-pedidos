-- =====================================================================
-- FINANCEIRO do Divino Frango
--
-- Rode DEPOIS de migracao-seguranca.sql (usa a função eh_admin() criada lá).
-- Supabase: SQL Editor -> New query -> cole tudo -> Run. Pode rodar de novo.
--
-- O que este arquivo faz (nada existente é apagado ou alterado, só acrescentado):
--  1. Cria a tabela "despesas" (outras despesas lançadas à mão: aluguel, energia...).
--  2. Cria a coluna opcional movimentacoes_caixa.data_referencia, para lançar o
--     "total do dia" de um dia anterior no dia certo. Vazia = vale o dia do lançamento.
--  3. Cria 3 funções que somam tudo NO BANCO (vendas, diárias, compras e despesas)
--     e devolvem poucas linhas para a aba Financeiro:
--       financeiro_diario, financeiro_despesas_categoria, financeiro_saidas
--     Só administradores conseguem executá-las.
--
-- Regras de cálculo (datas no fuso de São Paulo):
--  * Faturamento = fechamento do dia (movimentacoes_caixa, tipo 'venda').
--                  Os pedidos do site NÃO são somados: o fechamento do dia já inclui
--                  essas vendas (lançadas pelo relatório de cartão e Pix).
--  * Despesas    = diárias + compras (movimentacoes_caixa, tipo 'compra') + despesas.
--  * Suprimento e sangria NÃO entram (são movimento de dinheiro, não venda nem gasto).
--  * Resultado   = faturamento - despesas (resultado de caixa, não lucro contábil).
-- =====================================================================


-- ---------- 1. outras despesas ----------
create table if not exists despesas (
  id uuid primary key default gen_random_uuid(),
  descricao text not null,
  categoria text not null default 'Outros',
  valor numeric(12,2) not null check (valor > 0),
  data date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  forma_pagamento text,
  observacao text,
  created_at timestamptz not null default now()
);
create index if not exists despesas_data_idx on despesas (data);

alter table despesas enable row level security;
drop policy if exists "admin total" on despesas;
create policy "admin total" on despesas for all using (eh_admin()) with check (eh_admin());


-- ---------- 2. data própria para o "total do dia" ----------
alter table movimentacoes_caixa add column if not exists data_referencia date;
create index if not exists movimentacoes_caixa_tipo_created_idx on movimentacoes_caixa (tipo, created_at);


-- ---------- 3. cálculo no banco ----------

-- agrupa o texto livre de forma_pagamento em Pix / Cartão / Dinheiro / Outros
create or replace function fin_forma(p text)
returns text language sql immutable as $$
  select case
    when p is null then 'Outros'
    when lower(p) like '%pix%' then 'Pix'
    when lower(p) like '%dinheiro%' then 'Dinheiro'
    when lower(p) like '%cart%' or lower(p) like '%cr_dito%' or lower(p) like '%d_bito%' then 'Cartão'
    else 'Outros'
  end
$$;

-- uma linha por dia do período (inclusive dias sem movimento)
-- (drop: se uma versão anterior desta função já foi criada, o formato de retorno mudou)
drop function if exists financeiro_diario(date, date);
create or replace function financeiro_diario(p_inicio date, p_fim date)
returns table (
  dia date,
  pix numeric, cartao numeric, dinheiro numeric, outros_pgto numeric,
  faturamento numeric,
  diarias numeric, compras numeric, outras_despesas numeric,
  despesas numeric, resultado numeric
)
language plpgsql stable set search_path = public as $$
#variable_conflict use_column
begin
  if not eh_admin() then raise exception 'Acesso restrito a administradores'; end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio then raise exception 'Período inválido'; end if;
  if p_fim - p_inicio > 800 then raise exception 'Período muito longo (máximo 800 dias)'; end if;

  return query
  with vendas as (
    select coalesce(m.data_referencia, (m.created_at at time zone 'America/Sao_Paulo')::date) as d,
           fin_forma(m.forma_pagamento) as forma, m.valor as v
    from public.movimentacoes_caixa m
    where m.tipo = 'venda'
  ),
  vf as (
    select x.d,
      coalesce(sum(x.v) filter (where x.forma = 'Pix'), 0)      as v_pix,
      coalesce(sum(x.v) filter (where x.forma = 'Cartão'), 0)   as v_cartao,
      coalesce(sum(x.v) filter (where x.forma = 'Dinheiro'), 0) as v_dinheiro,
      coalesce(sum(x.v) filter (where x.forma = 'Outros'), 0)   as v_outros,
      coalesce(sum(x.v), 0)                                     as v_total
    from vendas x
    where x.d between p_inicio and p_fim
    group by x.d
  ),
  dg as (
    select di.data as d, sum(di.valor) as v
    from public.diarias di
    where di.data between p_inicio and p_fim
    group by di.data
  ),
  cg as (
    select c.d, sum(c.v) as v
    from (
      select coalesce(m.data_compra::date, (m.created_at at time zone 'America/Sao_Paulo')::date) as d, m.valor as v
      from public.movimentacoes_caixa m
      where m.tipo = 'compra'
    ) c
    where c.d between p_inicio and p_fim
    group by c.d
  ),
  og as (
    select de.data as d, sum(de.valor) as v
    from public.despesas de
    where de.data between p_inicio and p_fim
    group by de.data
  )
  select dias.d as dia,
    coalesce(vf.v_pix, 0), coalesce(vf.v_cartao, 0), coalesce(vf.v_dinheiro, 0), coalesce(vf.v_outros, 0),
    coalesce(vf.v_total, 0),
    coalesce(dg.v, 0), coalesce(cg.v, 0), coalesce(og.v, 0),
    coalesce(dg.v, 0) + coalesce(cg.v, 0) + coalesce(og.v, 0),
    coalesce(vf.v_total, 0) - (coalesce(dg.v, 0) + coalesce(cg.v, 0) + coalesce(og.v, 0))
  from (select generate_series(p_inicio::timestamp, p_fim::timestamp, interval '1 day')::date as d) dias
  left join vf on vf.d = dias.d
  left join dg on dg.d = dias.d
  left join cg on cg.d = dias.d
  left join og on og.d = dias.d
  order by dias.d;
end; $$;

-- total por categoria de despesa (compras e diárias automáticas + categorias lançadas à mão)
create or replace function financeiro_despesas_categoria(p_inicio date, p_fim date)
returns table (categoria text, total numeric)
language plpgsql stable set search_path = public as $$
#variable_conflict use_column
begin
  if not eh_admin() then raise exception 'Acesso restrito a administradores'; end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio then raise exception 'Período inválido'; end if;
  if p_fim - p_inicio > 800 then raise exception 'Período muito longo (máximo 800 dias)'; end if;

  return query
  select t.categoria, sum(t.v) as total
  from (
    select 'Compras'::text as categoria, m.valor as v,
           coalesce(m.data_compra::date, (m.created_at at time zone 'America/Sao_Paulo')::date) as d
    from public.movimentacoes_caixa m
    where m.tipo = 'compra'
    union all
    select 'Funcionários'::text, di.valor, di.data
    from public.diarias di
    union all
    select coalesce(nullif(trim(de.categoria), ''), 'Outros')::text, de.valor, de.data
    from public.despesas de
  ) t
  where t.d between p_inicio and p_fim
  group by t.categoria
  having sum(t.v) <> 0
  order by sum(t.v) desc;
end; $$;

-- lista das saídas do período (mais recentes primeiro)
create or replace function financeiro_saidas(p_inicio date, p_fim date, p_limite integer default 300)
returns table (
  origem text, id uuid, dia date, categoria text,
  descricao text, valor numeric, forma_pagamento text
)
language plpgsql stable set search_path = public as $$
#variable_conflict use_column
begin
  if not eh_admin() then raise exception 'Acesso restrito a administradores'; end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio then raise exception 'Período inválido'; end if;
  if p_fim - p_inicio > 800 then raise exception 'Período muito longo (máximo 800 dias)'; end if;

  return query
  select s.origem, s.id, s.dia, s.categoria, s.descricao, s.valor, s.forma_pagamento
  from (
    select 'compra'::text as origem, m.id as id,
           coalesce(m.data_compra::date, (m.created_at at time zone 'America/Sao_Paulo')::date) as dia,
           'Compras'::text as categoria,
           coalesce(nullif(trim(m.descricao), ''), 'Compra')::text as descricao,
           m.valor as valor, 'Caixa'::text as forma_pagamento, m.created_at as ordem
    from public.movimentacoes_caixa m
    where m.tipo = 'compra'
    union all
    select 'diaria'::text, di.id, di.data, 'Funcionários'::text, di.funcionario_nome::text,
           di.valor, null::text, di.created_at
    from public.diarias di
    union all
    select 'despesa'::text, de.id, de.data, de.categoria::text, de.descricao::text,
           de.valor, de.forma_pagamento::text, de.created_at
    from public.despesas de
  ) s
  where s.dia between p_inicio and p_fim
  order by s.dia desc, s.ordem desc
  limit greatest(least(coalesce(p_limite, 300), 1000), 1);
end; $$;

-- só quem está logado chama; dentro de cada função eh_admin() confere o administrador
revoke all on function financeiro_diario(date, date) from public, anon;
revoke all on function financeiro_despesas_categoria(date, date) from public, anon;
revoke all on function financeiro_saidas(date, date, integer) from public, anon;
grant execute on function financeiro_diario(date, date) to authenticated;
grant execute on function financeiro_despesas_categoria(date, date) to authenticated;
grant execute on function financeiro_saidas(date, date, integer) to authenticated;
