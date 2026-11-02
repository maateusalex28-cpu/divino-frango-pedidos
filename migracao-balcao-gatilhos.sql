-- Pedidos lançados pelo painel (origem 'balcao', usuário logado) passam pelas travas do banco:
--  - telefone opcional, bairro livre, loja fechada não bloqueia;
--  - mantém o status, a taxa e o total enviados pelo painel (a trava normal força status 'pendente').
-- Pedidos do site (visitante sem login) continuam com TODAS as validações de antes.
-- Rodar depois de migracao-balcao-reservas.sql (precisa da coluna pedidos.origem). Pode rodar mais de uma vez.

-- 1) validar_pedido: insere um bloco no começo da função existente, sem reescrever o resto.
do $do$
declare
  def text;
  pos int;
  achado text;
  injecao text := $inj$
  declare
    v_adm_bal boolean := false;
  begin
    -- bypass_balcao
    if coalesce(new.origem, 'site') = 'balcao' and coalesce(auth.role(), '') = 'authenticated' then
      if to_regprocedure('public.eh_admin()') is not null then
        execute 'select public.eh_admin()' into v_adm_bal;
      else
        v_adm_bal := true;
      end if;
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
    return; -- já aplicado
  end if;
  -- acha a linha "begin" que abre o corpo da função (aceita fim de linha \n ou \r\n)
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

-- 2) bloquear_pedido_loja_fechada: pedido do painel passa mesmo com a loja fechada.
create or replace function public.bloquear_pedido_loja_fechada()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_adm boolean := false;
begin
  if coalesce(new.origem, 'site') = 'balcao' and coalesce(auth.role(), '') = 'authenticated' then
    if to_regprocedure('public.eh_admin()') is not null then
      execute 'select public.eh_admin()' into v_adm;
    else
      v_adm := true;
    end if;
    if v_adm then
      return new;
    end if;
  end if;
  if exists (select 1 from configuracoes where id = 1 and loja_fechada) then
    raise exception 'Loja fechada: pedidos pausados no momento.';
  end if;
  return new;
end; $fn$;
