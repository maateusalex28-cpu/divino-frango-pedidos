// Cálculos da aba Caixa. Funções puras: não usam React nem banco, para poderem ser testadas
// com `node tests/caixaCalculos.test.mjs`.
//
// As "linhas" vêm da função SQL caixa_dias (supabase/migracao-caixa.sql): uma linha por dia
// com movimento. Dinheiro físico = vendas em dinheiro + suprimentos − compras/despesas PAGAS
// em dinheiro − sangrias. Cartão, Pix e contas pendentes nunca entram nesse saldo.

// busca o histórico a partir daqui para encadear o saldo de um mês para o outro
export const INICIO_HISTORICO = "2024-01-01";

const pad = (n) => String(n).padStart(2, "0");

export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const parseDia = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12); // meio-dia: evita virar o dia por causa de horário de verão
};
export const isoDe = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDias = (s, n) => {
  const d = parseDia(s);
  d.setDate(d.getDate() + n);
  return isoDe(d);
};

// "2026-10-26" -> "2026-10-01"
export const mesDe = (iso) => `${iso.slice(0, 7)}-01`;

export const somarMeses = (mes, n) => {
  const [y, m] = mes.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}-01`;
};

export const ultimoDiaDoMes = (mes) => {
  const [y, m] = mes.split("-").map(Number);
  return `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
};

// mesmas regras da função SQL fin_forma: agrupa o texto livre da forma de pagamento
export const formaDe = (texto) => {
  const t = String(texto == null ? "" : texto).toLowerCase();
  if (texto == null) return "Outros";
  if (t.includes("pix")) return "Pix";
  if (t.includes("dinheiro")) return "Dinheiro";
  if (t.includes("cart") || /cr.dito/.test(t) || /d.bito/.test(t)) return "Cartão";
  return "Outros";
};

export const periodoPreset = (id, hoje) => {
  const h = parseDia(hoje);
  switch (id) {
    case "hoje": return [hoje, hoje];
    case "ontem": { const o = addDias(hoje, -1); return [o, o]; }
    case "mes": return [mesDe(hoje), hoje];
    case "mes_anterior": {
      const ini = somarMeses(mesDe(isoDe(h)), -1);
      return [ini, ultimoDiaDoMes(ini)];
    }
    default: return [hoje, hoje];
  }
};

// linha vinda do banco -> números
export const normalizarLinha = (l) => ({
  dia: String(l.dia).slice(0, 10),
  vDinheiro: Number(l.vendas_dinheiro) || 0,
  vCartao: Number(l.vendas_cartao) || 0,
  vPix: Number(l.vendas_pix) || 0,
  vOutros: Number(l.vendas_outros) || 0,
  suprimentos: Number(l.suprimentos) || 0,
  sangrias: Number(l.sangrias) || 0,
  pagoTotal: Number(l.pago_total) || 0,
  pagoDinheiro: Number(l.pago_dinheiro) || 0,
  pendente: Number(l.pendente) || 0,
});

// soma as linhas entre duas datas (inclusive)
export const totaisDasLinhas = (linhas, de, ate) => {
  const t = {
    vDinheiro: 0, vCartao: 0, vPix: 0, vOutros: 0, suprimentos: 0, sangrias: 0,
    pagoTotal: 0, pagoDinheiro: 0, pendente: 0,
  };
  for (const l of linhas) {
    if (de && l.dia < de) continue;
    if (ate && l.dia > ate) continue;
    for (const k of Object.keys(t)) t[k] += l[k];
  }
  for (const k of Object.keys(t)) t[k] = r2(t[k]);
  t.vTotal = r2(t.vDinheiro + t.vCartao + t.vPix + t.vOutros);
  t.entradasDinheiro = r2(t.vDinheiro + t.suprimentos);
  t.saidasDinheiro = r2(t.pagoDinheiro + t.sangrias);
  return t;
};

// Saldo do dinheiro físico do mês que contém `ate`.
//  fechamentos: [{ mes: "2026-10-01", saldo_inicial, dinheiro_contado }]
//  linhas: linhas normalizadas desde INICIO_HISTORICO (ou antes) até pelo menos `ate`
// Saldo inicial de um mês = o valor informado no fechamento; se não houver, o dinheiro contado
// do mês anterior (se foi informado) ou o saldo calculado dele; no primeiro mês de todos, zero.
export function calcularDinheiro({ ate, fechamentos = [], linhas = [] }) {
  const mesAlvo = mesDe(ate);
  const porMes = new Map(fechamentos.map((f) => [f.mes, f]));

  const candidatos = [
    mesAlvo,
    ...linhas.map((l) => mesDe(l.dia)),
    ...fechamentos.filter((f) => f.mes <= mesAlvo).map((f) => f.mes),
  ];
  const primeiro = candidatos.reduce((a, b) => (a < b ? a : b));

  let anterior = null; // saldo final do mês anterior (contado, se informado; senão o calculado)
  let resultado = null;
  for (let m = primeiro; m <= mesAlvo; m = somarMeses(m, 1)) {
    const f = porMes.get(m);
    const auto = anterior != null ? anterior : 0;
    const manual = !!f && f.saldo_inicial != null;
    const abertura = manual ? Number(f.saldo_inicial) : auto;
    const mov = totaisDasLinhas(linhas, m, ultimoDiaDoMes(m));
    const finalMes = r2(abertura + mov.entradasDinheiro - mov.saidasDinheiro);
    if (m === mesAlvo) {
      const ate_ = totaisDasLinhas(linhas, m, ate);
      resultado = {
        mes: m,
        saldoInicial: r2(abertura),
        saldoInicialAuto: r2(auto),
        saldoInicialManual: manual,
        entradas: mov.entradasDinheiro,
        saidas: mov.saidasDinheiro,
        saldoFinal: finalMes, // mês inteiro
        saldoAte: r2(abertura + ate_.entradasDinheiro - ate_.saidasDinheiro), // até a data `ate`
        dinheiroContado: f && f.dinheiro_contado != null ? Number(f.dinheiro_contado) : null,
      };
    }
    anterior = f && f.dinheiro_contado != null ? Number(f.dinheiro_contado) : finalMes;
  }
  return resultado;
}

// ---------- dinheiro digitado (centavos) ----------
export const centavos = (reais) => Math.round((Number(reais) || 0) * 100);
export const reais = (cents) => (Number(cents) || 0) / 100;
