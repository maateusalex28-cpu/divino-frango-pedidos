// Rode com:  node tests/caixaCalculos.test.mjs
import assert from "node:assert/strict";
import {
  calcularDinheiro, totaisDasLinhas, normalizarLinha, formaDe, mesDe, somarMeses,
  ultimoDiaDoMes, periodoPreset, addDias,
} from "../src/caixaCalculos.js";

let ok = 0;
const teste = (nome, fn) => { fn(); ok++; console.log("  ✓", nome); };

// monta uma linha como a função SQL caixa_dias devolve
const linha = (dia, o = {}) => normalizarLinha({
  dia, vendas_dinheiro: 0, vendas_cartao: 0, vendas_pix: 0, vendas_outros: 0, suprimentos: 0, sangrias: 0,
  pago_total: 0, pago_dinheiro: 0, pendente: 0, ...o,
});

console.log("Cálculos do Caixa");

teste("vendas: total = dinheiro + cartão + Pix (350 + 420 + 230 = 1000)", () => {
  const t = totaisDasLinhas([linha("2026-10-26", { vendas_dinheiro: 350, vendas_cartao: 420, vendas_pix: 230 })]);
  assert.equal(t.vTotal, 1000);
});

teste("cartão e Pix NÃO entram no dinheiro físico", () => {
  const r = calcularDinheiro({
    ate: "2026-10-26", fechamentos: [],
    linhas: [linha("2026-10-26", { vendas_dinheiro: 350, vendas_cartao: 420, vendas_pix: 230 })],
  });
  assert.equal(r.saldoAte, 350);
});

teste("compra paga em dinheiro reduz o saldo; paga no Pix não reduz", () => {
  const r = calcularDinheiro({
    ate: "2026-10-26", fechamentos: [],
    linhas: [linha("2026-10-26", {
      vendas_dinheiro: 350, pago_total: 100 + 80, pago_dinheiro: 100, // R$ 100 em dinheiro + R$ 80 no Pix
    })],
  });
  assert.equal(r.saldoAte, 250);
  assert.equal(totaisDasLinhas([linha("2026-10-26", { pago_total: 180, pago_dinheiro: 100 })]).pagoTotal, 180);
});

teste("compra pendente não desconta do dinheiro", () => {
  const r = calcularDinheiro({
    ate: "2026-10-26", fechamentos: [],
    linhas: [linha("2026-10-26", { vendas_dinheiro: 350, pendente: 500 })],
  });
  assert.equal(r.saldoAte, 350);
  assert.equal(totaisDasLinhas([linha("2026-10-26", { pendente: 500 })]).pendente, 500);
});

teste("pendente paga depois: sai do caixa uma vez só, na data do pagamento (outro mês)", () => {
  // compra de 500 lançada em 28/10 como pendente; paga em dinheiro em 05/11
  const linhas = [
    linha("2026-10-27", { vendas_dinheiro: 1000 }),
    linha("2026-10-28", { pendente: 500 }),
    linha("2026-11-05", { pago_total: 500, pago_dinheiro: 500 }),
  ];
  const out = calcularDinheiro({ ate: "2026-10-31", fechamentos: [], linhas });
  const nov = calcularDinheiro({ ate: "2026-11-30", fechamentos: [], linhas });
  assert.equal(out.saldoFinal, 1000);          // outubro: ainda não saiu
  assert.equal(nov.saldoInicial, 1000);         // novembro abre com o que sobrou de outubro
  assert.equal(nov.saldoFinal, 500);            // 1000 - 500, uma vez só
  assert.equal(totaisDasLinhas(linhas, "2026-10-01", "2026-10-31").pendente, 500);
  assert.equal(totaisDasLinhas(linhas, "2026-11-01", "2026-11-30").pagoTotal, 500);
});

teste("saldo inicial informado vale; dinheiro contado do mês anterior vira o saldo do seguinte", () => {
  const linhas = [linha("2026-09-10", { vendas_dinheiro: 1000, pago_dinheiro: 200, pago_total: 200 })];
  const fech = [
    { mes: "2026-09-01", saldo_inicial: 1700, dinheiro_contado: 2450 },
  ];
  const set = calcularDinheiro({ ate: "2026-09-30", fechamentos: fech, linhas });
  assert.equal(set.saldoInicial, 1700);
  assert.equal(set.saldoFinal, 2500);           // 1700 + 1000 - 200
  assert.equal(set.dinheiroContado, 2450);
  const out = calcularDinheiro({ ate: "2026-10-31", fechamentos: fech, linhas });
  assert.equal(out.saldoInicial, 2450);         // usa o contado de setembro
  assert.equal(out.saldoInicialManual, false);
});

teste("diferença do exemplo: calculado 2500, contado 2450 => -50", () => {
  const r = calcularDinheiro({
    ate: "2026-09-30",
    fechamentos: [{ mes: "2026-09-01", saldo_inicial: 1700, dinheiro_contado: 2450 }],
    linhas: [linha("2026-09-10", { vendas_dinheiro: 1000, pago_dinheiro: 200, pago_total: 200 })],
  });
  assert.equal(Math.round((r.dinheiroContado - r.saldoFinal) * 100) / 100, -50);
});

teste("saldo informado em um mês sobrepõe o carregado do anterior", () => {
  const linhas = [linha("2026-09-10", { vendas_dinheiro: 1000 })];
  const fech = [{ mes: "2026-10-01", saldo_inicial: 300, dinheiro_contado: null }];
  const r = calcularDinheiro({ ate: "2026-10-15", fechamentos: fech, linhas });
  assert.equal(r.saldoInicial, 300);
  assert.equal(r.saldoInicialAuto, 1000);
  assert.equal(r.saldoInicialManual, true);
});

teste("meses anteriores continuam sendo calculados (corrigir lançamento antigo atualiza o encadeamento)", () => {
  const base = [linha("2026-08-05", { vendas_dinheiro: 500 })];
  const antes = calcularDinheiro({ ate: "2026-10-31", fechamentos: [], linhas: base });
  const corrigido = calcularDinheiro({ ate: "2026-10-31", fechamentos: [], linhas: [linha("2026-08-05", { vendas_dinheiro: 700 })] });
  assert.equal(antes.saldoInicial, 500);
  assert.equal(corrigido.saldoInicial, 700);
});

teste("dia com saldo até a data não inclui movimentos posteriores do mesmo mês", () => {
  const linhas = [linha("2026-10-05", { vendas_dinheiro: 100 }), linha("2026-10-20", { vendas_dinheiro: 900 })];
  assert.equal(calcularDinheiro({ ate: "2026-10-10", fechamentos: [], linhas }).saldoAte, 100);
  assert.equal(calcularDinheiro({ ate: "2026-10-31", fechamentos: [], linhas }).saldoAte, 1000);
});

teste("sem nenhum dado: saldo zero", () => {
  const r = calcularDinheiro({ ate: "2026-10-26", fechamentos: [], linhas: [] });
  assert.equal(r.saldoAte, 0);
  assert.equal(r.saldoInicial, 0);
});

teste("centavos não acumulam erro de ponto flutuante", () => {
  const t = totaisDasLinhas([linha("2026-10-01", { vendas_dinheiro: 0.1 }), linha("2026-10-02", { vendas_dinheiro: 0.2 })]);
  assert.equal(t.vDinheiro, 0.3);
});

teste("formaDe segue as regras do banco (fin_forma)", () => {
  assert.equal(formaDe("Pix"), "Pix");
  assert.equal(formaDe("Dinheiro"), "Dinheiro");
  assert.equal(formaDe("Cartão"), "Cartão");
  assert.equal(formaDe("Cartão de crédito"), "Cartão");
  assert.equal(formaDe("Outro"), "Outros");
  assert.equal(formaDe(null), "Outros");
});

teste("datas e meses", () => {
  assert.equal(mesDe("2026-10-26"), "2026-10-01");
  assert.equal(somarMeses("2026-01-01", -1), "2025-12-01");
  assert.equal(somarMeses("2026-12-01", 1), "2027-01-01");
  assert.equal(ultimoDiaDoMes("2026-02-01"), "2026-02-28");
  assert.equal(ultimoDiaDoMes("2028-02-01"), "2028-02-29");
  assert.equal(addDias("2026-10-01", -1), "2026-09-30");
  assert.deepEqual(periodoPreset("mes", "2026-10-26"), ["2026-10-01", "2026-10-26"]);
  assert.deepEqual(periodoPreset("mes_anterior", "2026-10-26"), ["2026-09-01", "2026-09-30"]);
  assert.deepEqual(periodoPreset("ontem", "2026-10-01"), ["2026-09-30", "2026-09-30"]);
});

console.log(`\n${ok} testes passaram.`);
