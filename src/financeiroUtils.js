// Funções puras do módulo financeiro (sem React), para poderem ser testadas à parte.

export const TURNOS = [
  { id: "unico", label: "Dia todo" },
  { id: "manha", label: "Manhã" },
  { id: "tarde", label: "Tarde" },
  { id: "noite", label: "Noite" },
];
export const rotuloTurno = (id) => (TURNOS.find((t) => t.id === id) || TURNOS[0]).label;

const pad = (n) => String(n).padStart(2, "0");
export const isoData = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// meio-dia: evita virar o dia por causa de horário de verão
export const parseDia = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
};
export const addDias = (s, n) => {
  const d = parseDia(s);
  d.setDate(d.getDate() + n);
  return isoData(d);
};
export const fmtDiaCompleto = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "");
export const diaSemana = (s) => parseDia(s).toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");

export const PRESETS_VENDAS = [
  { id: "hoje", label: "Hoje" },
  { id: "semana", label: "Esta semana" },
  { id: "mes", label: "Este mês" },
  { id: "mes_anterior", label: "Mês anterior" },
  { id: "custom", label: "Período" },
];
// semana comercial: de segunda-feira até hoje
export const periodoPreset = (id, hoje) => {
  const h = parseDia(hoje);
  switch (id) {
    case "hoje": return [hoje, hoje];
    case "semana": return [addDias(hoje, -((h.getDay() + 6) % 7)), hoje];
    case "mes": return [`${h.getFullYear()}-${pad(h.getMonth() + 1)}-01`, hoje];
    case "mes_anterior": {
      const ini = new Date(h.getFullYear(), h.getMonth() - 1, 1, 12);
      const fim = new Date(h.getFullYear(), h.getMonth(), 0, 12);
      return [isoData(ini), isoData(fim)];
    }
    default: return [hoje, hoje];
  }
};

// "1.234,56" | "1234,56" | "1234.56" | "" -> número (vazio = 0). Texto inválido -> NaN.
export const numBR = (txt) => {
  let s = String(txt ?? "").trim().replace(/^R\$\s*/i, "");
  if (!s) return 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); // "1.234" = mil duzentos e trinta e quatro
  if (!/^\d+(\.\d{1,})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100) / 100;
};
export const numParaCampo = (n) => (Number(n) ? String(Number(n)).replace(".", ",") : "");
export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const somarLinhas = (linhas) => {
  const t = { dinheiro: 0, cartao: 0, pix: 0, total: 0 };
  linhas.forEach((l) => {
    t.dinheiro += Number(l.dinheiro) || 0;
    t.cartao += Number(l.cartao) || 0;
    t.pix += Number(l.pix) || 0;
  });
  t.dinheiro = r2(t.dinheiro); t.cartao = r2(t.cartao); t.pix = r2(t.pix);
  t.total = r2(t.dinheiro + t.cartao + t.pix);
  return t;
};

// agrupa os fechamentos por data (mais recente primeiro); vários turnos do mesmo dia viram um total do dia
export const agruparPorDia = (linhas) => {
  const mapa = new Map();
  linhas.forEach((l) => {
    if (!mapa.has(l.data)) mapa.set(l.data, []);
    mapa.get(l.data).push(l);
  });
  return [...mapa.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([data, ls]) => ({ data, linhas: ls, ...somarLinhas(ls) }));
};

// texto das mudanças entre duas versões de um fechamento (para o histórico)
export const descreverMudancas = (antes, depois, fmt) => {
  if (!antes || !depois) return [];
  const out = [];
  if (antes.data !== depois.data) out.push(`Data: ${fmtDiaCompleto(antes.data)} → ${fmtDiaCompleto(depois.data)}`);
  if (antes.turno !== depois.turno) out.push(`Turno: ${rotuloTurno(antes.turno)} → ${rotuloTurno(depois.turno)}`);
  [["dinheiro", "Dinheiro"], ["cartao", "Cartão"], ["pix", "Pix"]].forEach(([k, nome]) => {
    if (Number(antes[k]) !== Number(depois[k])) out.push(`${nome}: ${fmt(Number(antes[k]))} → ${fmt(Number(depois[k]))}`);
  });
  if ((antes.observacao || "") !== (depois.observacao || "")) out.push("Observação alterada");
  return out;
};
