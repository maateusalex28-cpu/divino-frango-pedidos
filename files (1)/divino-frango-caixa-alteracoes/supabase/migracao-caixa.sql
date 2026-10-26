-- =====================================================================
-- CAIXA do Divino Frango (nova aba Caixa: vendas do dia, compras e despesas, fechamento mensal)
--
-- Rode DEPOIS de migracao-seguranca.sql e migracao-financeiro.sql (usa eh_admin() e fin_forma()).
-- Supabase: SQL Editor -> New query -> cole tudo -> Run. Pode rodar de novo (é idempotente).
-- Nada existente é apagado: só colunas/tabelas/funções novas e um campo que deixa de ser obrigatório.
--
-- O que este arquivo faz:
--  1. movimentacoes_caixa.caixa_id deixa de ser obrigatório: o caixa novo não depende de "turno"
--     aberto. Os registros antigos continuam com o turno deles.
--  2. Garante (add column if not exists) as colunas que o código já usa e que talvez só existam
--     no seu Supabase: itens, data_compra, observacao, nota_foto_path, data_referencia.
--  3. Cria as colunas de situação do pagamento:
--       movimentacoes_caixa (compras): categoria, situacao, data_pagamento
--       despesas:                       situacao, data_pagamento
--     Tudo que já existe fica "pago" (situacao = 'pago'), como era tratado antes.
--  4. Cria a tabela fechamentos_caixa (saldo inicial e dinheiro contado de cada mês).
--  5. Cria as funções: caixa_dias, caixa_lancamentos e salvar_vendas_dia.
--  6. Atualiza as 3 funções do Financeiro para só contar despesa PAGA (na data do pagamento),
--     para uma compra pendente não aparecer como saída antes de ser paga.
--
-- Fonte oficial de cada informação (não duplica nada):
--  * Vendas ............ movimentacoes_caixa, tipo 'venda' (uma linha por forma de pagamento e dia)
--  * Compras da aba Compras ... movimentacoes_caixa, tipo 'compra'
--  * Outras despesas ... tabela despesas
--  * Diárias da equipe . tabela diarias (continuam na aba Equipe; não entram no Caixa)
-- =====================================================================


-- ---------- 1 e 2. movimentacoes_caixa ----------
alter table movimentacoes_caixa alter column caixa_id drop not null;

alter table movimentacoes_caixa add column if not exists itens jsonb;
alter table movimentacoes_caixa add column if not exists data_compra date;
alter table movimentacoes_caixa add column if not exists observacao text;
alter table movimentacoes_caixa add column if not exists nota_foto_path text;
alter table movimentacoes_caixa add column if not exists data_referencia date;


-- ---------- 3. situação do pagamento ----------
alter table movimentacoes_caixa add column if not exists categoria text;
alter table movimentacoes_caixa add column if not exists situacao text not null default 'pago';
alter table movimentacoes_caixa add column if not exists data_pagamento date;

alter table despesas add column if not exists situacao text not null default 'pago';
alter table despesas add column if not exists data_pagamento date;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'movimentacoes_caixa_situacao_chk') then
    alter table movimentacoes_caixa add constraint movimentacoes_caixa_situacao_chk check (situacao in ('pago', 'pendente'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'despesas_situacao_chk') then
    alter table despesas add constraint despesas_situacao_chk check (situacao in ('pago', 'pendente'));
  end if;
end $$;

create index if not exists despesas_situacao_idx on despesas (situacao) where situacao = 'pendente';
create index if not exists movimentacoes_caixa_pendentes_idx on movimentacoes_caixa (situacao) where situacao = 'pendente';


-- ---------- 4. fechamento mensal ----------
create table if not exists fechamentos_caixa (
  id uuid primary key default gen_random_uuid(),
  mes date not null unique check (extract(day from mes) = 1),   -- sempre o dia 1 do mês
  saldo_inicial numeric(12,2),        -- vazio = usa o dinheiro contado (ou calculado) do mês anterior
  dinheiro_contado numeric(12,2),     -- dinheiro físico contado no fechamento
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table fechamentos_caixa enable row level security;
drop policy if exists "admin total" on fechamentos_caixa;
create policy "admin total" on fechamentos_caixa for all using (eh_admin()) with check (eh_admin());


-- ---------- 5. funções da aba Caixa ----------

-- mesma regra da migracao-financeiro.sql (repetida aqui só para este arquivo funcionar sozinho)
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

-- Uma linha por dia COM movimento. Regras:
--  * venda ......... no dia da venda (data_referencia, ou o dia do lançamento se vazio)
--  * suprimento/sangria no dia do lançamento
--  * compra/despesa PAGA ..... no dia do PAGAMENTO (data_pagamento; se vazio, a data da compra)
--  * compra/despesa PENDENTE . na data da compra (ainda não saiu do caixa)
--  * "dinheiro físico": só forma Dinheiro. Compra antiga sem forma de pagamento conta como dinheiro
--    (era assim que o caixa já tratava). Cartão e Pix nunca entram no dinheiro físico.
create or replace function caixa_dias(p_inicio date, p_fim date)
returns table (
  dia date,
  vendas_dinheiro numeric, vendas_cartao numeric, vendas_pix numeric, vendas_outros numeric,
  suprimentos numeric, sangrias numeric,
  pago_total numeric, pago_dinheiro numeric, pendente numeric
)
language plpgsql stable set search_path = public as $$
#variable_conflict use_column
begin
  if not eh_admin() then raise exception 'Acesso restrito a administradores'; end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio then raise exception 'Período inválido'; end if;
  if p_fim - p_inicio > 4000 then raise exception 'Período muito longo'; end if;

  return query
  with ev as (
    select m.tipo::text as kind,
           case
             when m.tipo = 'compra' and m.situacao = 'pago'
               then coalesce(m.data_pagamento, m.data_compra::date, (m.created_at at time zone 'America/Sao_Paulo')::date)
             when m.tipo = 'compra'
               then coalesce(m.data_compra::date, (m.created_at at time zone 'America/Sao_Paulo')::date)
             else coalesce(m.data_referencia, (m.created_at at time zone 'America/Sao_Paulo')::date)
           end as d,
           case
             when m.tipo = 'compra' then fin_forma(coalesce(nullif(trim(m.forma_pagamento), ''), 'Dinheiro'))
             else fin_forma(m.forma_pagamento)
           end as forma,
           m.valor as v,
           case when m.tipo = 'compra' then m.situacao else 'pago' end as sit
    from public.movimentacoes_caixa m
    where m.tipo in ('venda', 'suprimento', 'sangria', 'compra')
    union all
    select 'compra'::text,
           case when de.situacao = 'pago' then coalesce(de.data_pagamento, de.data) else de.data end,
           fin_forma(coalesce(nullif(trim(de.forma_pagamento), ''), 'Outro')),
           de.valor,
           de.situacao
    from public.despesas de
  )
  select e.d as dia,
    coalesce(sum(e.v) filter (where e.kind = 'venda' and e.forma = 'Dinheiro'), 0),
    coalesce(sum(e.v) filter (where e.kind = 'venda' and e.forma = 'Cartão'), 0),
    coalesce(sum(e.v) filter (where e.kind = 'venda' and e.forma = 'Pix'), 0),
    coalesce(sum(e.v) filter (where e.kind = 'venda' and e.forma = 'Outros'), 0),
    coalesce(sum(e.v) filter (where e.kind = 'suprimento'), 0),
    coalesce(sum(e.v) filter (where e.kind = 'sangria'), 0),
    coalesce(sum(e.v) filter (where e.kind = 'compra' and e.sit = 'pago'), 0),
    coalesce(sum(e.v) filter (where e.kind = 'compra' and e.sit = 'pago' and e.forma = 'Dinheiro'), 0),
    coalesce(sum(e.v) filter (where e.kind = 'compra' and e.sit = 'pendente'), 0)
  from ev e
  where e.d between p_inicio and p_fim
  group by e.d
  order by e.d;
end; $$;

-- Lista única de compras (aba Compras) + despesas, para o histórico da aba Caixa.
-- "dia" = dia que conta para o período (pagamento, se pago; data da compra, se pendente).
create or replace function caixa_lancamentos(p_inicio date, p_fim date, p_limite integer default 500)
returns table (
  origem text, id uuid, dia date, data_lancamento date,
  descricao text, categoria text, valor numeric, forma_pagamento text,
  situacao text, data_pagamento date, observacao text
)
language plpgsql stable set search_path = public as $$
#variable_conflict use_column
begin
  if not eh_admin() then raise exception 'Acesso restrito a administradores'; end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio then raise exception 'Período inválido'; end if;
  if p_fim - p_inicio > 4000 then raise exception 'Período muito longo'; end if;

  return query
  select s.origem, s.id, s.dia, s.data_lancamento, s.descricao, s.categoria, s.valor,
         s.forma_pagamento, s.situacao, s.data_pagamento, s.observacao
  from (
    select 'compra'::text as origem, m.id as id,
           case
             when m.situacao = 'pago'
               then coalesce(m.data_pagamento, m.data_compra::date, (m.created_at at time zone 'America/Sao_Paulo')::date)
             else coalesce(m.data_compra::date, (m.created_at at time zone 'America/Sao_Paulo')::date)
           end as dia,
           coalesce(m.data_compra::date, (m.created_at at time zone 'America/Sao_Paulo')::date) as data_lancamento,
           coalesce(nullif(trim(m.descricao), ''), 'Compra')::text as descricao,
           coalesce(nullif(trim(m.categoria), ''), 'Compras')::text as categoria,
           m.valor as valor,
           coalesce(nullif(trim(m.forma_pagamento), ''), 'Dinheiro')::text as forma_pagamento,
           m.situacao::text as situacao,
           m.data_pagamento as data_pagamento,
           m.observacao::text as observacao,
           m.created_at as ordem
    from public.movimentacoes_caixa m
    where m.tipo = 'compra'
    union all
    select 'despesa'::text, de.id,
           case when de.situacao = 'pago' then coalesce(de.data_pagamento, de.data) else de.data end,
           de.data,
           de.descricao::text,
           coalesce(nullif(trim(de.categoria), ''), 'Outras despesas')::text,
           de.valor,
           coalesce(nullif(trim(de.forma_pagamento), ''), 'Outro')::text,
           de.situacao::text,
           de.data_pagamento,
           de.observacao::text,
           de.created_at
    from public.despesas de
  ) s
  where s.dia between p_inicio and p_fim
  order by s.dia desc, s.ordem desc
  limit greatest(least(coalesce(p_limite, 500), 2000), 1);
end; $$;

-- Grava as vendas de UM dia (dinheiro, cartão e Pix) de uma vez e sem duplicar:
--  * se já existe lançamento da forma naquele dia, ATUALIZA o valor;
--  * se existir mais de uma linha antiga da mesma forma no mesmo dia, deixa só uma;
--  * valor 0 remove a linha daquela forma (correção);
--  * um bloqueio por data impede dois cliques/aparelhos criarem linhas repetidas ao mesmo tempo.
-- Continua gravando em movimentacoes_caixa (tipo 'venda'), então Relatórios e Financeiro enxergam igual.
create or replace function salvar_vendas_dia(
  p_data date, p_dinheiro numeric, p_cartao numeric, p_pix numeric, p_obs text default null
)
returns void
language plpgsql set search_path = public as $$
declare
  f record;
  v_id uuid;
  v_obs text := nullif(trim(coalesce(p_obs, '')), '');
begin
  if not eh_admin() then raise exception 'Acesso restrito a administradores'; end if;
  if p_data is null then raise exception 'Informe a data das vendas'; end if;
  if p_data > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'A data das vendas não pode ser futura'; end if;
  if coalesce(p_dinheiro, 0) < 0 or coalesce(p_cartao, 0) < 0 or coalesce(p_pix, 0) < 0 then
    raise exception 'Os valores não podem ser negativos';
  end if;

  perform pg_advisory_xact_lock(hashtext('vendas_dia_' || p_data::text));

  for f in
    select * from (values
      ('Dinheiro'::text, round(coalesce(p_dinheiro, 0), 2)),
      ('Cartão'::text,   round(coalesce(p_cartao, 0), 2)),
      ('Pix'::text,      round(coalesce(p_pix, 0), 2))
    ) as t(forma, valor)
  loop
    v_id := null;
    select m.id into v_id
    from movimentacoes_caixa m
    where m.tipo = 'venda'
      and fin_forma(m.forma_pagamento) = fin_forma(f.forma)
      and coalesce(m.data_referencia, (m.created_at at time zone 'America/Sao_Paulo')::date) = p_data
    order by m.created_at
    limit 1;

    if f.valor > 0 then
      if v_id is null then
        insert into movimentacoes_caixa (caixa_id, tipo, valor, forma_pagamento, descricao, data_referencia, observacao)
        values (null, 'venda', f.valor, f.forma, 'Total do dia', p_data, v_obs);
      else
        update movimentacoes_caixa
           set valor = f.valor, forma_pagamento = f.forma, data_referencia = p_data, observacao = v_obs
         where id = v_id;
        delete from movimentacoes_caixa m
         where m.tipo = 'venda'
           and fin_forma(m.forma_pagamento) = fin_forma(f.forma)
           and coalesce(m.data_referencia, (m.created_at at time zone 'America/Sao_Paulo')::date) = p_data
           and m.id <> v_id;
      end if;
    else
      delete from movimentacoes_caixa m
       where m.tipo = 'venda'
         and fin_forma(m.forma_pagamento) = fin_forma(f.forma)
         and coalesce(m.data_referencia, (m.created_at at time zone 'America/Sao_Paulo')::date) = p_data;
    end if;
  end loop;
end; $$;


-- ---------- 6. Financeiro: só despesa PAGA conta, na data do pagamento ----------
-- (mesmas funções de migracao-financeiro.sql, com a regra da situação do pagamento)

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
      select coalesce(m.data_pagamento, m.data_compra::date, (m.created_at at time zone 'America/Sao_Paulo')::date) as d, m.valor as v
      from public.movimentacoes_caixa m
      where m.tipo = 'compra' and m.situacao = 'pago'
    ) c
    where c.d between p_inicio and p_fim
    group by c.d
  ),
  og as (
    select coalesce(de.data_pagamento, de.data) as d, sum(de.valor) as v
    from public.despesas de
    where de.situacao = 'pago' and coalesce(de.data_pagamento, de.data) between p_inicio and p_fim
    group by coalesce(de.data_pagamento, de.data)
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
    select coalesce(nullif(trim(m.categoria), ''), 'Compras')::text as categoria, m.valor as v,
           coalesce(m.data_pagamento, m.data_compra::date, (m.created_at at time zone 'America/Sao_Paulo')::date) as d
    from public.movimentacoes_caixa m
    where m.tipo = 'compra' and m.situacao = 'pago'
    union all
    select 'Funcionários'::text, di.valor, di.data
    from public.diarias di
    union all
    select coalesce(nullif(trim(de.categoria), ''), 'Outros')::text, de.valor, coalesce(de.data_pagamento, de.data)
    from public.despesas de
    where de.situacao = 'pago'
  ) t
  where t.d between p_inicio and p_fim
  group by t.categoria
  having sum(t.v) <> 0
  order by sum(t.v) desc;
end; $$;

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
           coalesce(m.data_pagamento, m.data_compra::date, (m.created_at at time zone 'America/Sao_Paulo')::date) as dia,
           coalesce(nullif(trim(m.categoria), ''), 'Compras')::text as categoria,
           coalesce(nullif(trim(m.descricao), ''), 'Compra')::text as descricao,
           m.valor as valor, coalesce(nullif(trim(m.forma_pagamento), ''), 'Caixa')::text as forma_pagamento, m.created_at as ordem
    from public.movimentacoes_caixa m
    where m.tipo = 'compra' and m.situacao = 'pago'
    union all
    select 'diaria'::text, di.id, di.data, 'Funcionários'::text, di.funcionario_nome::text,
           di.valor, null::text, di.created_at
    from public.diarias di
    union all
    select 'despesa'::text, de.id, coalesce(de.data_pagamento, de.data), de.categoria::text, de.descricao::text,
           de.valor, de.forma_pagamento::text, de.created_at
    from public.despesas de
    where de.situacao = 'pago'
  ) s
  where s.dia between p_inicio and p_fim
  order by s.dia desc, s.ordem desc
  limit greatest(least(coalesce(p_limite, 300), 1000), 1);
end; $$;

-- ---------- permissões ----------
revoke all on function caixa_dias(date, date) from public, anon;
revoke all on function caixa_lancamentos(date, date, integer) from public, anon;
revoke all on function salvar_vendas_dia(date, numeric, numeric, numeric, text) from public, anon;
grant execute on function caixa_dias(date, date) to authenticated;
grant execute on function caixa_lancamentos(date, date, integer) to authenticated;
grant execute on function salvar_vendas_dia(date, numeric, numeric, numeric, text) to authenticated;
revoke all on function financeiro_diario(date, date) from public, anon;
revoke all on function financeiro_despesas_categoria(date, date) from public, anon;
revoke all on function financeiro_saidas(date, date, integer) from public, anon;
grant execute on function financeiro_diario(date, date) to authenticated;
grant execute on function financeiro_despesas_categoria(date, date) to authenticated;
grant execute on function financeiro_saidas(date, date, integer) to authenticated;
