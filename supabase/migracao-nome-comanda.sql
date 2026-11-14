-- Nome do produto só na comanda impressa (o site continua mostrando o nome normal)
alter table cardapio add column if not exists nome_comanda text;
