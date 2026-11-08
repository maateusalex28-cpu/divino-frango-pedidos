-- Marca de pedido pago (painel, aba Balcão)
alter table pedidos add column if not exists pago boolean not null default false;
