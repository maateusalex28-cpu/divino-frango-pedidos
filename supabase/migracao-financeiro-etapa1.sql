-- =====================================================================
-- FINANCEIRO — ETAPA 1: base financeira + vendas do dia
--
-- Rode DEPOIS de migracao-seguranca.sql e migracao-financeiro.sql (usa eh_admin() e fin_forma()).
-- Supabase: SQL Editor -> New query -> cole tudo -> Run. Pode rodar de novo sem estragar nada.
-- Nada existente é apagado: só são criadas tabelas/funções novas e a função
-- financeiro_diario passa a somar também os fechamentos de vendas.
--
-- O que este arquivo cria:
--  1. fechamentos_vendas            -> total do dia em dinheiro, cartão e Pix (1 por data + turno)
--  2. fechamentos_vendas_historico  -> quem alterou o quê, quando e por quê (automático)
--  3. movimentacoes_financeiras     -> base central de entradas e saídas, ligada à origem
--  4. salvar_fechamento_vendas()    -> único jeito de gravar (valida tudo no banco, em transação)
--
-- Regras:
--  * Dinheiro e Pix entram como efetivados na data das vendas.
--  * Cartão entra como "a_receber": o sistema NÃO sabe quando a operadora paga, então não
--    assume que o dinheiro já está disponível.
--  * Ninguém escreve direto nas tabelas novas (só leitura para administradores);
--    toda gravação passa pela função, que confere administrador, datas e valores.
-- =====================================================================


-- ---------- 1. fechamento de vendas ----------
create table if not exists fechamentos_vendas (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  turno text not null default 'unico' check (turno in ('unico', 'manha', 'tarde', 'noite')),
  dinheiro numeric(12,2) not null default 0 check (dinheiro >= 0),
  cartao   numeric(12,2) not null default 0 check (cartao   >= 0),
  pix      numeric(12,2) not null default 0 check (pix      >= 0),
  total    numeric(12,2) generated always as (dinheiro + cartao + pix) stored,
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fechamentos_vendas_data_turno_uk unique (data, turno)
);
create index if not exists fechamentos_vendas_data_idx on fechamentos_vendas (data);


-- ---------- 2. histórico de alterações ----------
create table if not exists fechamentos_vendas_historico (
  id uuid primary key default gen_random_uuid(),
  fechamento_id uuid not null,            -- sem FK de propósito: o histórico sobrevive a qualquer exclusão
  acao text not null check (acao in ('criado', 'alterado', 'apagado')),
  motivo text,
  usuario uuid,
  antes jsonb,
  depois jsonb,
  created_at timestamptz not null default now()
);
create index if not exists fechamentos_vendas_hist_idx on fechamentos_vendas_historico (fechamento_id, created_at);

create or replace function fin_vendas_antes_update()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists trg_fv_updated_at on fechamentos_vendas;
create trigger trg_fv_updated_at before update on fechamentos_vendas
  for each row execute function fin_vendas_antes_update();

create or replace function fin_vendas_historico()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_motivo text := nullif(trim(coalesce(current_setting('app.motivo', true), '')), '');
begin
  if tg_op = 'INSERT' then
    insert into fechamentos_vendas_historico (fechamento_id, acao, motivo, usuario, antes, depois)
    values (new.id, 'criado', v_motivo, auth.uid(), null, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) - 'updated_at' is distinct from to_jsonb(old) - 'updated_at' then
      insert into fechamentos_vendas_historico (fechamento_id, acao, motivo, usuario, antes, depois)
      values (new.id, 'alterado', v_motivo, auth.uid(), to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    insert into fechamentos_vendas_historico (fechamento_id, acao, motivo, usuario, antes, depois)
    values (old.id, 'apagado', v_motivo, auth.uid(), to_jsonb(old), null);
    return old;
  end if;
end; $$;

drop trigger if exists trg_fv_historico on fechamentos_vendas;
create trigger trg_fv_historico after insert or update or delete on fechamentos_vendas
  for each row execute function fin_vendas_historico();


-- ---------- 3. base financeira central ----------
create table if not exists movimentacoes_financeiras (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('entrada', 'saida')),
  categoria text not null,
  descricao text not null,
  valor numeric(12,2) not null check (valor >= 0),
  data_competencia date not null,         -- dia a que o valor pertence
  data_efetiva date,                      -- dia em que o dinheiro realmente entrou/saiu
  forma_pagamento text check (forma_pagamento in ('dinheiro', 'pix', 'cartao', 'outro')),
  origem text not null,                   -- venda_diaria | compra | diaria | despesa | manual ...
  origem_id uuid,                         -- id do registro de origem
  chave_origem text unique,               -- impede duplicar a mesma movimentação da mesma origem
  status text not null default 'efetivada' check (status in ('efetivada', 'a_receber', 'pendente', 'cancelada')),
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mov_fin_efetiva_chk check (status <> 'efetivada' or data_efetiva is not null)
);
create index if not exists mov_fin_competencia_idx on movimentacoes_financeiras (data_competencia);
create index if not exists mov_fin_origem_idx on movimentacoes_financeiras (origem, origem_id);


-- ---------- 4. segurança: leitura só para administradores, escrita só pelas funções ----------
alter table fechamentos_vendas enable row level security;
alter table fechamentos_vendas_historico enable row level security;
alter table movimentacoes_financeiras enable row level security;

drop policy if exists "admin leitura" on fechamentos_vendas;
create policy "admin leitura" on fechamentos_vendas for select using (eh_admin());
drop policy if exists "admin leitura" on fechamentos_vendas_historico;
create policy "admin leitura" on fechamentos_vendas_historico for select using (eh_admin());
drop policy if exists "admin leitura" on movimentacoes_financeiras;
create policy "admin leitura" on movimentacoes_financeiras for select using (eh_admin());

revoke all on fechamentos_vendas, fechamentos_vendas_historico, movimentacoes_financeiras from public, anon;
revoke insert, update, delete, truncate on fechamentos_vendas, fechamentos_vendas_historico, movimentacoes_financeiras from authenticated;
grant select on fechamentos_vendas, fechamentos_vendas_historico, movimentacoes_financeiras to authenticated;


-- ---------- 5. gera/atualiza as movimentações de um fechamento ----------
create or replace function fin_sincronizar_venda(f fechamentos_vendas)
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_turno text := case f.turno when 'manha' then ' (manhã)' when 'tarde' then ' (tarde)' when 'noite' then ' (noite)' else '' end;
begin
  for r in
    select * from (values ('dinheiro', f.dinheiro, 'Dinheiro'), ('cartao', f.cartao, 'Cartão'), ('pix', f.pix, 'Pix'))
      as t(forma, valor, rotulo)
  loop
    insert into movimentacoes_financeiras
      (tipo, categoria, descricao, valor, data_competencia, data_efetiva, forma_pagamento,
       origem, origem_id, chave_origem, status)
    values
      ('entrada', 'Vendas',
       'Vendas do dia ' || to_char(f.data, 'DD/MM/YYYY') || v_turno || ' — ' || r.rotulo,
       r.valor, f.data,
       case when r.forma = 'cartao' then null else f.data end,
       r.forma, 'venda_diaria', f.id, 'venda_diaria:' || f.id || ':' || r.forma,
       case when r.valor = 0 then 'cancelada' when r.forma = 'cartao' then 'a_receber' else 'efetivada' end)
    on conflict (chave_origem) do update set
      valor = excluded.valor,
      descricao = excluded.descricao,
      data_competencia = excluded.data_competencia,
      status = case
        when excluded.status = 'cancelada' then 'cancelada'
        when movimentacoes_financeiras.forma_pagamento = 'cartao' and movimentacoes_financeiras.status = 'efetivada' then 'efetivada'
        else excluded.status end,
      data_efetiva = case
        when movimentacoes_financeiras.forma_pagamento = 'cartao' then movimentacoes_financeiras.data_efetiva
        when excluded.status = 'efetivada' then excluded.data_efetiva
        else movimentacoes_financeiras.data_efetiva end,
      updated_at = now();
  end loop;
end; $$;

revoke all on function fin_sincronizar_venda(fechamentos_vendas) from public, anon, authenticated;


-- ---------- 6. única porta de gravação das vendas do dia ----------
-- p_id nulo = novo lançamento; com p_id = edição.
-- p_versao (opcional na edição): o updated_at que a tela leu. Se alguém alterou nesse meio tempo, recusa.
create or replace function salvar_fechamento_vendas(
  p_id uuid, p_data date, p_turno text,
  p_dinheiro numeric, p_cartao numeric, p_pix numeric,
  p_observacao text default null, p_motivo text default null, p_versao timestamptz default null
)
returns fechamentos_vendas
language plpgsql security definer set search_path = public as $$
declare
  v_row fechamentos_vendas;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_din numeric(12,2) := round(coalesce(p_dinheiro, 0), 2);
  v_car numeric(12,2) := round(coalesce(p_cartao, 0), 2);
  v_pix numeric(12,2) := round(coalesce(p_pix, 0), 2);
  v_atual fechamentos_vendas;
begin
  if not eh_admin() then raise exception 'Acesso restrito a administradores'; end if;
  if p_data is null then raise exception 'Informe a data das vendas'; end if;
  if p_data > v_hoje then raise exception 'A data das vendas não pode ser futura'; end if;
  if p_turno is null or p_turno not in ('unico', 'manha', 'tarde', 'noite') then raise exception 'Turno inválido'; end if;
  if v_din < 0 or v_car < 0 or v_pix < 0 then raise exception 'Os valores não podem ser negativos'; end if;
  if v_din + v_car + v_pix <= 0 then raise exception 'Informe o valor de pelo menos uma forma de pagamento'; end if;

  perform set_config('app.motivo', coalesce(trim(p_motivo), ''), true);

  if p_id is null then
    insert into fechamentos_vendas (data, turno, dinheiro, cartao, pix, observacao)
    values (p_data, p_turno, v_din, v_car, v_pix, nullif(trim(coalesce(p_observacao, '')), ''))
    returning * into v_row;
  else
    select * into v_atual from fechamentos_vendas where id = p_id for update;  -- trava contra edição simultânea
    if not found then raise exception 'Lançamento não encontrado'; end if;
    if p_versao is not null and v_atual.updated_at <> p_versao then
      raise exception 'Este lançamento foi alterado por outra pessoa. Recarregue e tente de novo.' using hint = 'CONFLITO';
    end if;
    update fechamentos_vendas set
      data = p_data, turno = p_turno, dinheiro = v_din, cartao = v_car, pix = v_pix,
      observacao = nullif(trim(coalesce(p_observacao, '')), '')
    where id = p_id
    returning * into v_row;
  end if;

  perform fin_sincronizar_venda(v_row);
  return v_row;
exception when unique_violation then
  raise exception 'Já existe um lançamento para esta data e turno' using hint = 'DUPLICADO';
end; $$;

revoke all on function salvar_fechamento_vendas(uuid, date, text, numeric, numeric, numeric, text, text, timestamptz) from public, anon;
grant execute on function salvar_fechamento_vendas(uuid, date, text, numeric, numeric, numeric, text, text, timestamptz) to authenticated;


-- ---------- 7. a visão Financeiro passa a somar também os fechamentos ----------
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
    -- vendas antigas, lançadas uma a uma no Caixa (continuam contando; o formulário antigo não grava mais nada)
    select coalesce(m.data_referencia, (m.created_at at time zone 'America/Sao_Paulo')::date) as d,
           fin_forma(m.forma_pagamento) as forma, m.valor as v
    from public.movimentacoes_caixa m
    where m.tipo = 'venda'
    union all
    -- fechamentos do dia (nova tela "Vendas do dia")
    select f.data, 'Dinheiro'::text, f.dinheiro from public.fechamentos_vendas f
    union all
    select f.data, 'Cartão'::text, f.cartao from public.fechamentos_vendas f
    union all
    select f.data, 'Pix'::text, f.pix from public.fechamentos_vendas f
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

revoke all on function financeiro_diario(date, date) from public, anon;
grant execute on function financeiro_diario(date, date) to authenticated;
