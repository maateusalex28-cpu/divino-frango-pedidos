-- =====================================================================
-- FINANCEIRO e RELATÓRIOS passam a somar os PEDIDOS FINALIZADOS (site e loja) sozinhos.
--
-- Rode no Supabase: SQL Editor -> New query -> cole tudo -> Run. Pode rodar de novo.
--
-- Regra:
--  * Até o dia anterior à data de corte: continua valendo o "total do dia" lançado no Caixa.
--  * A partir da data de corte: o faturamento é a soma dos pedidos com status 'concluido'
--    (Finalizar pedido), por dia do pedido e forma de pagamento. Cancelados e recusados não entram.
--  * Os lançamentos manuais de venda da data de corte em diante deixam de contar (evita somar duas vezes).
--  * O valor é o total do pedido (inclui a taxa de entrega).
-- Para mudar a data de corte, troque a data abaixo e rode este arquivo de novo.
-- =====================================================================

create or replace function fin_data_corte()
returns date language sql immutable as $$ select date '2026-11-16' $$;

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
    -- antes da data de corte: total do dia lançado à mão no Caixa
    select x.d, x.forma, x.v from (
      select coalesce(m.data_referencia, (m.created_at at time zone 'America/Sao_Paulo')::date) as d,
             fin_forma(m.forma_pagamento) as forma, m.valor as v
      from public.movimentacoes_caixa m
      where m.tipo = 'venda'
    ) x
    where x.d < fin_data_corte()
    union all
    -- a partir da data de corte: pedidos FINALIZADOS (site e loja), automático
    select coalesce(pe.data_pedido, (pe.created_at at time zone 'America/Sao_Paulo')::date) as d,
           fin_forma(pe.forma_pagamento) as forma, pe.total as v
    from public.pedidos pe
    where pe.status = 'concluido'
      and coalesce(pe.data_pedido, (pe.created_at at time zone 'America/Sao_Paulo')::date) >= fin_data_corte()
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


notify pgrst, 'reload schema';
