-- =====================================================================
-- Loja aberta/fechada + tempo estimado de entrega (controlados pelo /admin)
--
-- Rode UMA vez no Supabase: SQL Editor -> New query -> cole tudo -> Run.
-- Pode rodar de novo sem problema (tudo usa "if not exists" / "or replace").
--
-- Sem estas colunas, o botão "Salvar configurações" do painel dá erro
-- (inclusive para horários e taxa), e o botão LOJA ABERTA / FECHADA não funciona.
-- =====================================================================

-- campos novos na tabela de configurações
alter table configuracoes add column if not exists loja_fechada boolean not null default false;
alter table configuracoes add column if not exists mensagem_loja_fechada text;
alter table configuracoes add column if not exists tempo_entrega_min integer not null default 40;
alter table configuracoes add column if not exists tempo_entrega_max integer not null default 60;
alter table configuracoes add column if not exists mostrar_tempo_entrega boolean not null default false;

-- proteção no banco: com a loja fechada no painel, nenhum pedido novo entra,
-- mesmo que o cliente esteja com o site aberto há horas sem recarregar
create or replace function bloquear_pedido_loja_fechada()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from configuracoes where id = 1 and loja_fechada) then
    raise exception 'Loja fechada: pedidos pausados no momento.';
  end if;
  return new;
end; $$;

drop trigger if exists pedidos_bloqueia_loja_fechada on pedidos;
create trigger pedidos_bloqueia_loja_fechada
  before insert on pedidos
  for each row execute function bloquear_pedido_loja_fechada();
