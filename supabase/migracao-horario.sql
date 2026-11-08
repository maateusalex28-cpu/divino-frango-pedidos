-- Horário que o cliente quer receber o pedido (preenchido só no painel, aba Balcão)
alter table pedidos add column if not exists horario_desejado time;
