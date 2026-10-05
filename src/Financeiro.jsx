import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Loader2, Trash2, Plus, X, Check } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, LabelList, Legend,
} from "recharts";

// Aba "Financeiro" do painel. Não guarda nem recalcula vendas, diárias ou compras:
// tudo vem de funções SQL (supabase/migracao-financeiro.sql) que somam os dados que já existem.
// Só as "outras despesas" (aluguel, energia...) são gravadas aqui, na tabela "despesas".

const LIMITE_SAIDAS = 300;
const CATEGORIAS_DESPESA = ["Compras", "Funcionários", "Aluguel", "Energia", "Água", "Manutenção", "Impostos", "Contador", "Outros"];
const FORMAS_PAGAMENTO = ["Dinheiro", "Pix", "Cartão", "Outro"];
const PRESETS = [
  { id: "hoje", label: "Hoje" },
  { id: "ontem", label: "Ontem" },
  { id: "semana", label: "Esta semana" },
  { id: "mes", label: "Este mês" },
  { id: "mes_anterior", label: "Mês anterior" },
  { id: "ano", label: "Este ano" },
  { id: "custom", label: "Período" },
];

// <helpers>
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDia = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12); // meio-dia: evita virar o dia por causa de horário de verão
};
const addDias = (s, n) => {
  const d = parseDia(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmtPct = (n, casas = 1) =>
  `${n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

// semana comercial: de segunda-feira até hoje
const periodoPreset = (id, hoje) => {
  const h = parseDia(hoje);
  switch (id) {
    case "hoje": return [hoje, hoje];
    case "ontem": { const o = addDias(hoje, -1); return [o, o]; }
    case "semana": return [addDias(hoje, -((h.getDay() + 6) % 7)), hoje];
    case "mes": return [`${h.getFullYear()}-${pad(h.getMonth() + 1)}-01`, hoje];
    case "mes_anterior": {
      const ini = new Date(h.getFullYear(), h.getMonth() - 1, 1, 12);
      const fim = new Date(h.getFullYear(), h.getMonth(), 0, 12);
      return [iso(ini), iso(fim)];
    }
    case "ano": return [`${h.getFullYear()}-01-01`, hoje];
    default: return [hoje, hoje];
  }
};

const totaisDoPeriodo = (linhas) => {
  const t = { pix: 0, cartao: 0, dinheiro: 0, outros: 0, fat: 0, diarias: 0, compras: 0, outras: 0, desp: 0 };
  linhas.forEach((l) => {
    t.pix += l.pix; t.cartao += l.cartao; t.dinheiro += l.dinheiro; t.outros += l.outros;
    t.fat += l.fat;
    t.diarias += l.diarias; t.compras += l.compras; t.outras += l.outras; t.desp += l.desp;
  });
  Object.keys(t).forEach((k) => { t[k] = r2(t[k]); });
  t.res = r2(t.fat - t.desp);
  t.margem = t.fat > 0 ? (t.res / t.fat) * 100 : null;
  return t;
};
// </helpers>

const fmtDia = (s, comAno) => `${s.slice(8, 10)}/${s.slice(5, 7)}${comAno ? `/${s.slice(2, 4)}` : ""}`;
const eixoK = (v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v));

function Titulo({ C, children }) {
  return (
    <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textSoft, textTransform: "uppercase", letterSpacing: 0.5, margin: "20px 2px 8px" }}>
      {children}
    </div>
  );
}

function Kpi({ C, label, value, cor, borda, fundo, sub }) {
  return (
    <div style={{ background: fundo || C.card, border: `1px solid ${borda || C.border}`, borderRadius: 14, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ fontSize: 10.5, color: C.textSoft, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 }}>{label}</div>
      <div className="mono" style={{ fontSize: 19, fontWeight: 800, color: cor || C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.textFaint, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function LinhaValor({ C, label, valor, cor, forte, recuo }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0", paddingLeft: recuo ? 12 : 0 }}>
      <span style={{ fontSize: forte ? 13.5 : 13, fontWeight: forte ? 700 : 500, color: forte ? C.text : C.textSoft }}>{label}</span>
      <span className="mono" style={{ fontSize: forte ? 14.5 : 13, fontWeight: forte ? 800 : 600, color: cor || C.text }}>{valor}</span>
    </div>
  );
}

export default function Financeiro({
  supabase, C, fmt, Card, FieldLabel, EmptyState, inputStyle, btnPrimary, btnOutline, iconBtnStyle, showToast, dataLocalISO,
}) {
  const hoje = dataLocalISO();
  const [preset, setPreset] = useState("mes");
  const [custIni, setCustIni] = useState(hoje);
  const [custFim, setCustFim] = useState(hoje);
  const [inicio, fim] = useMemo(
    () => (preset === "custom" ? [custIni, custFim] : periodoPreset(preset, hoje)),
    [preset, custIni, custFim, hoje]
  );

  const [linhas, setLinhas] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [saidas, setSaidas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const reqId = useRef(0);

  const carregar = useCallback(async (silencioso = false) => {
    if (!inicio || !fim || fim < inicio) {
      setErro("Período inválido: a data final é anterior à inicial.");
      setCarregando(false);
      return;
    }
    const id = ++reqId.current;
    if (!silencioso) setCarregando(true);
    setErro("");
    try {
      const args = { p_inicio: inicio, p_fim: fim };
      const [d, c, s] = await Promise.all([
        supabase.rpc("financeiro_diario", args),
        supabase.rpc("financeiro_despesas_categoria", args),
        supabase.rpc("financeiro_saidas", { ...args, p_limite: LIMITE_SAIDAS }),
      ]);
      if (id !== reqId.current) return; // chegou uma resposta de um período que já foi trocado
      const err = d.error || c.error || s.error;
      if (err) {
        console.error(err);
        setErro(/could not find|schema cache|does not exist|PGRST202/i.test(err.message || "") ? "MIGRACAO" : err.message || "Erro ao carregar o financeiro");
        return;
      }
      setLinhas(
        (d.data || []).map((l) => ({
          dia: String(l.dia).slice(0, 10),
          pix: Number(l.pix) || 0, cartao: Number(l.cartao) || 0, dinheiro: Number(l.dinheiro) || 0, outros: Number(l.outros_pgto) || 0,
          fat: Number(l.faturamento) || 0,
          diarias: Number(l.diarias) || 0, compras: Number(l.compras) || 0, outras: Number(l.outras_despesas) || 0,
          desp: Number(l.despesas) || 0, res: Number(l.resultado) || 0,
        }))
      );
      setCategorias((c.data || []).map((x) => ({ categoria: x.categoria, total: r2(x.total) })));
      setSaidas(s.data || []);
    } catch (e) {
      if (id === reqId.current) setErro(e.message || "Erro ao carregar o financeiro");
    } finally {
      if (id === reqId.current) setCarregando(false);
    }
  }, [supabase, inicio, fim]);

  useEffect(() => { carregar(); }, [carregar]);

  const tot = useMemo(() => totaisDoPeriodo(linhas), [linhas]);
  const positivo = tot.res >= 0;
  const corRes = positivo ? C.green : C.red;
  const comAno = inicio.slice(0, 4) !== fim.slice(0, 4);

  // gráficos: por dia; em períodos longos (mais de 62 dias) agrupa por mês para não ficar ilegível
  const porMes = linhas.length > 62;
  const serie = useMemo(() => {
    if (!porMes) return linhas.map((l) => ({ label: fmtDia(l.dia), faturamento: r2(l.fat), despesas: r2(l.desp) }));
    const m = new Map();
    linhas.forEach((l) => {
      const k = l.dia.slice(0, 7);
      const b = m.get(k) || { label: `${k.slice(5, 7)}/${k.slice(2, 4)}`, faturamento: 0, despesas: 0 };
      b.faturamento += l.fat;
      b.despesas += l.desp;
      m.set(k, b);
    });
    return [...m.values()].map((b) => ({ ...b, faturamento: r2(b.faturamento), despesas: r2(b.despesas) }));
  }, [linhas, porMes]);

  const linhasComMovimento = useMemo(() => linhas.filter((l) => l.fat !== 0 || l.desp !== 0), [linhas]);
  const semMovimento = !carregando && !erro && tot.fat === 0 && tot.desp === 0;

  const formas = [
    { nome: "Pix", valor: tot.pix },
    { nome: "Cartão", valor: tot.cartao },
    { nome: "Dinheiro", valor: tot.dinheiro },
    ...(tot.outros > 0 ? [{ nome: "Outros", valor: tot.outros }] : []),
  ];

  const tipStyle = { background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 12 };
  const eixo = { fill: C.textFaint, fontSize: 10 };

  // ---------- adicionar / apagar despesa ----------
  const formVazio = () => ({ descricao: "", categoria: "Outros", valor: "", data: dataLocalISO(), forma: "", obs: "" });
  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState(formVazio);
  const [salvando, setSalvando] = useState(false);

  const salvarDespesa = async () => {
    const valor = Number(String(form.valor).replace(",", "."));
    if (!form.descricao.trim()) { showToast("Informe a descrição da despesa"); return; }
    if (!(valor > 0)) { showToast("Informe um valor maior que zero"); return; }
    if (!form.data) { showToast("Informe a data da despesa"); return; }
    setSalvando(true);
    const { error } = await supabase.from("despesas").insert({
      descricao: form.descricao.trim(),
      categoria: form.categoria,
      valor,
      data: form.data,
      forma_pagamento: form.forma || null,
      observacao: form.obs.trim() || null,
    });
    setSalvando(false);
    if (error) { showToast(`Erro ao salvar a despesa: ${error.message}`); return; }
    showToast("Despesa adicionada");
    setForm(formVazio());
    setMostrarForm(false);
    carregar(true);
  };

  const removerDespesa = async (s) => {
    if (!window.confirm(`Apagar a despesa "${s.descricao}" (${fmt(Number(s.valor))})?`)) return;
    const { error } = await supabase.from("despesas").delete().eq("id", s.id);
    if (error) { showToast(`Erro ao apagar: ${error.message}`); return; }
    showToast("Despesa apagada");
    carregar(true);
  };

  const escolherPeriodo = (id) => {
    if (id === "custom") { setCustIni(inicio); setCustFim(fim); }
    setPreset(id);
  };

  const th = { padding: "8px 10px", fontSize: 10.5, fontWeight: 700, color: C.textSoft, textTransform: "uppercase", letterSpacing: 0.3, textAlign: "right", whiteSpace: "nowrap", background: C.cardAlt };
  const td = { padding: "8px 10px", fontSize: 12.5, textAlign: "right", whiteSpace: "nowrap", borderTop: `1px solid ${C.borderSoft}`, color: C.text };

  return (
    <div>
      <div className="display" style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 12 }}>Financeiro</div>

      {/* período */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, marginBottom: 6 }}>
        {PRESETS.map((p) => {
          const ativo = preset === p.id;
          return (
            <button
              key={p.id}
              onClick={() => escolherPeriodo(p.id)}
              style={{
                flexShrink: 0, padding: "8px 13px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap",
                background: ativo ? C.orange : C.card, color: ativo ? "#0E0E10" : C.textSoft,
                border: `1px solid ${ativo ? C.orange : C.border}`,
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      {preset === "custom" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <FieldLabel>De</FieldLabel>
            <input type="date" value={custIni} max={custFim || undefined} onChange={(e) => setCustIni(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <FieldLabel>Até</FieldLabel>
            <input type="date" value={custFim} min={custIni || undefined} onChange={(e) => setCustFim(e.target.value)} style={inputStyle} />
          </div>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: C.textFaint, marginBottom: 12 }}>
        {inicio === fim ? fmtDia(inicio, true) : `${fmtDia(inicio, true)} a ${fmtDia(fim, true)}`}
      </div>

      {erro === "MIGRACAO" && (
        <Card style={{ borderColor: C.orange }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.orangeText, marginBottom: 6 }}>Falta ativar o Financeiro no banco</div>
          <div style={{ fontSize: 13, color: C.textSoft, lineHeight: 1.5 }}>
            Rode o arquivo <b style={{ color: C.text }}>supabase/migracao-financeiro.sql</b> no SQL Editor do Supabase (depois do migracao-seguranca.sql) e volte para esta tela.
          </div>
        </Card>
      )}
      {erro && erro !== "MIGRACAO" && (
        <Card style={{ borderColor: C.red }}>
          <div style={{ fontSize: 13, color: C.red, marginBottom: 10 }}>{erro}</div>
          <button onClick={() => carregar()} style={{ ...btnOutline, width: "100%" }}>Tentar de novo</button>
        </Card>
      )}

      {carregando && !erro && (
        <div style={{ textAlign: "center", padding: "40px 0", color: C.textSoft }}><Loader2 size={20} className="spin" /></div>
      )}

      {!carregando && !erro && (
        <>
          {/* cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Kpi C={C} label="Faturamento" value={fmt(tot.fat)} cor={C.green} sub="o que entrou" />
            <Kpi C={C} label="Despesas" value={fmt(tot.desp)} cor={C.orangeText} sub="o que saiu" />
            <Kpi
              C={C} label="Resultado de caixa" value={`${positivo ? "" : "− "}${fmt(Math.abs(tot.res))}`} cor={corRes}
              borda={corRes} fundo={positivo ? C.greenSoft : C.redSoft} sub={positivo ? "sobrou no período" : "saiu mais do que entrou"}
            />
            <Kpi
              C={C} label="Margem" value={tot.margem == null ? "—" : fmtPct(tot.margem, 2)} cor={tot.margem == null ? C.textSoft : corRes}
              sub={tot.margem == null ? "sem faturamento" : "resultado ÷ faturamento"}
            />
          </div>
          <div style={{ fontSize: 11.5, color: C.textFaint, lineHeight: 1.5, margin: "10px 2px 0" }}>
            Resultado de caixa = faturamento − despesas pagas no período. Não é lucro contábil: a compra de estoque entra no dia em que foi paga, não quando o produto é vendido.
          </div>

          {semMovimento && <div style={{ marginTop: 16 }}><EmptyState text="Nenhuma venda ou despesa neste período." /></div>}

          {!semMovimento && (
            <>
              {/* formas de pagamento */}
              <Titulo C={C}>De onde veio o dinheiro</Titulo>
              <Card>
                {formas.map((f) => {
                  const pct = tot.fat > 0 ? (f.valor / tot.fat) * 100 : 0;
                  return (
                    <div key={f.nome} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{f.nome}</span>
                        <span className="mono" style={{ fontSize: 13, color: C.text }}>
                          {fmt(f.valor)} <span style={{ color: C.textSoft }}>· {fmtPct(pct)}</span>
                        </span>
                      </div>
                      <div style={{ height: 6, background: C.cardAlt, borderRadius: 99 }}>
                        <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: C.green, borderRadius: 99 }} />
                      </div>
                    </div>
                  );
                })}
                {tot.outros > 0 && (
                  <div style={{ fontSize: 11.5, color: C.textFaint, lineHeight: 1.45 }}>
                    "Outros" são vendas lançadas sem forma de pagamento Pix, Cartão ou Dinheiro.
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${C.borderSoft}`, paddingTop: 10, marginTop: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Total</span>
                  <span className="mono" style={{ fontSize: 13.5, fontWeight: 800, color: C.green }}>{fmt(tot.fat)}</span>
                </div>
              </Card>

              {/* gráficos */}
              <Titulo C={C}>Faturamento {porMes ? "por mês" : "por dia"}</Titulo>
              <Card style={{ padding: "14px 8px 8px" }}>
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={serie} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={C.borderSoft} vertical={false} />
                    <XAxis dataKey="label" tick={eixo} tickLine={false} axisLine={{ stroke: C.border }} interval="preserveStartEnd" />
                    <YAxis tick={eixo} tickLine={false} axisLine={false} width={40} tickFormatter={eixoK} />
                    <Tooltip contentStyle={tipStyle} labelStyle={{ color: C.textSoft }} cursor={{ fill: "rgba(255,255,255,0.04)" }} formatter={(v) => fmt(v)} />
                    <Bar dataKey="faturamento" name="Faturamento" fill={C.green} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Titulo C={C}>Entradas x saídas</Titulo>
              <Card style={{ padding: "14px 8px 8px" }}>
                <ResponsiveContainer width="100%" height={210}>
                  <LineChart data={serie} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={C.borderSoft} vertical={false} />
                    <XAxis dataKey="label" tick={eixo} tickLine={false} axisLine={{ stroke: C.border }} interval="preserveStartEnd" />
                    <YAxis tick={eixo} tickLine={false} axisLine={false} width={40} tickFormatter={eixoK} />
                    <Tooltip contentStyle={tipStyle} labelStyle={{ color: C.textSoft }} formatter={(v) => fmt(v)} />
                    <Legend wrapperStyle={{ fontSize: 12, color: C.textSoft }} />
                    <Line type="monotone" dataKey="faturamento" name="Faturamento" stroke={C.green} strokeWidth={2.2} dot={serie.length <= 31} />
                    <Line type="monotone" dataKey="despesas" name="Despesas" stroke={C.orange} strokeWidth={2.2} dot={serie.length <= 31} />
                  </LineChart>
                </ResponsiveContainer>
              </Card>

              {/* fluxo de caixa */}
              <Titulo C={C}>Fluxo de caixa</Titulo>
              <Card>
                <LinhaValor C={C} label="Entradas" valor={fmt(tot.fat)} cor={C.green} forte />
                <LinhaValor C={C} label="Vendas (fechamento do dia)" valor={fmt(tot.fat)} recuo />
                <div style={{ borderTop: `1px solid ${C.borderSoft}`, margin: "6px 0" }} />
                <LinhaValor C={C} label="Saídas" valor={fmt(tot.desp)} cor={C.orangeText} forte />
                <LinhaValor C={C} label="Diárias" valor={fmt(tot.diarias)} recuo />
                <LinhaValor C={C} label="Compras" valor={fmt(tot.compras)} recuo />
                <LinhaValor C={C} label="Outras despesas" valor={fmt(tot.outras)} recuo />
                <div style={{ borderTop: `1px solid ${C.borderSoft}`, margin: "6px 0" }} />
                <LinhaValor C={C} label="Resultado" valor={`${positivo ? "" : "− "}${fmt(Math.abs(tot.res))}`} cor={corRes} forte />
              </Card>

              {/* despesas por categoria */}
              <Titulo C={C}>Onde o dinheiro foi gasto</Titulo>
              <Card style={{ padding: "14px 10px 10px" }}>
                {categorias.length === 0 ? (
                  <div style={{ fontSize: 13, color: C.textFaint, textAlign: "center", padding: "10px 0" }}>Nenhuma despesa no período.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(110, categorias.length * 40)}>
                    <BarChart data={categorias} layout="vertical" margin={{ top: 0, right: 78, left: 0, bottom: 0 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="categoria" width={96} tick={{ fill: C.textSoft, fontSize: 12 }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={tipStyle} labelStyle={{ color: C.textSoft }} cursor={{ fill: "rgba(255,255,255,0.04)" }} formatter={(v) => fmt(v)} />
                      <Bar dataKey="total" name="Total" fill={C.orange} radius={[0, 4, 4, 0]} barSize={18}>
                        <LabelList dataKey="total" position="right" formatter={(v) => fmt(v)} style={{ fill: C.text, fontSize: 11.5 }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${C.borderSoft}`, paddingTop: 10, marginTop: 6, paddingLeft: 4, paddingRight: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Total</span>
                  <span className="mono" style={{ fontSize: 13.5, fontWeight: 800, color: C.orangeText }}>{fmt(tot.desp)}</span>
                </div>
              </Card>

              {/* resultado por dia */}
              <Titulo C={C}>Resultado por dia</Titulo>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ overflow: "auto", maxHeight: 420 }}>
                  <table style={{ width: "100%", minWidth: tot.outros > 0 ? 640 : 560, borderCollapse: "collapse" }}>
                    <thead style={{ position: "sticky", top: 0 }}>
                      <tr>
                        <th style={{ ...th, textAlign: "left" }}>Data</th>
                        <th style={th}>Pix</th>
                        <th style={th}>Cartão</th>
                        <th style={th}>Dinheiro</th>
                        {tot.outros > 0 && <th style={th}>Outros</th>}
                        <th style={th}>Faturamento</th>
                        <th style={th}>Despesas</th>
                        <th style={th}>Resultado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linhasComMovimento.map((l) => (
                        <tr key={l.dia}>
                          <td className="mono" style={{ ...td, textAlign: "left", fontWeight: 600 }}>{fmtDia(l.dia, comAno)}</td>
                          <td className="mono" style={td}>{fmt(l.pix)}</td>
                          <td className="mono" style={td}>{fmt(l.cartao)}</td>
                          <td className="mono" style={td}>{fmt(l.dinheiro)}</td>
                          {tot.outros > 0 && <td className="mono" style={td}>{fmt(l.outros)}</td>}
                          <td className="mono" style={{ ...td, color: C.green, fontWeight: 700 }}>{fmt(l.fat)}</td>
                          <td className="mono" style={{ ...td, color: C.orangeText }}>{fmt(l.desp)}</td>
                          <td className="mono" style={{ ...td, fontWeight: 700, color: l.res >= 0 ? C.green : C.red }}>
                            {l.res < 0 ? "− " : ""}{fmt(Math.abs(l.res))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot style={{ position: "sticky", bottom: 0 }}>
                      <tr>
                        <td style={{ ...td, textAlign: "left", fontWeight: 800, background: C.cardAlt }}>Total</td>
                        <td className="mono" style={{ ...td, fontWeight: 700, background: C.cardAlt }}>{fmt(tot.pix)}</td>
                        <td className="mono" style={{ ...td, fontWeight: 700, background: C.cardAlt }}>{fmt(tot.cartao)}</td>
                        <td className="mono" style={{ ...td, fontWeight: 700, background: C.cardAlt }}>{fmt(tot.dinheiro)}</td>
                        {tot.outros > 0 && <td className="mono" style={{ ...td, fontWeight: 700, background: C.cardAlt }}>{fmt(tot.outros)}</td>}
                        <td className="mono" style={{ ...td, fontWeight: 800, color: C.green, background: C.cardAlt }}>{fmt(tot.fat)}</td>
                        <td className="mono" style={{ ...td, fontWeight: 800, color: C.orangeText, background: C.cardAlt }}>{fmt(tot.desp)}</td>
                        <td className="mono" style={{ ...td, fontWeight: 800, color: corRes, background: C.cardAlt }}>{positivo ? "" : "− "}{fmt(Math.abs(tot.res))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>
            </>
          )}

          {/* saídas detalhadas + adicionar despesa */}
          <Titulo C={C}>Saídas do período</Titulo>
          {!mostrarForm ? (
            <button onClick={() => setMostrarForm(true)} style={{ ...btnPrimary, width: "100%", marginBottom: 10 }}>
              <Plus size={16} /> Adicionar despesa
            </button>
          ) : (
            <Card style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Nova despesa</div>
                <button onClick={() => setMostrarForm(false)} style={iconBtnStyle} aria-label="Fechar"><X size={16} color={C.textFaint} /></button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <FieldLabel>Descrição</FieldLabel>
                  <input placeholder="Ex: conta de luz de setembro" value={form.descricao} onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))} style={inputStyle} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <FieldLabel>Categoria</FieldLabel>
                    <select value={form.categoria} onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))} style={inputStyle}>
                      {CATEGORIAS_DESPESA.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <FieldLabel>Valor (R$)</FieldLabel>
                    <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="0,00" value={form.valor} onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))} style={inputStyle} />
                  </div>
                </div>
                {(form.categoria === "Compras" || form.categoria === "Funcionários") && (
                  <div style={{ fontSize: 11.5, color: C.orangeText, lineHeight: 1.45 }}>
                    Compras lançadas no Caixa e diárias lançadas na Equipe já entram sozinhas. Use esta categoria só para gastos que não foram lançados lá, senão o valor conta duas vezes.
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <FieldLabel>Data</FieldLabel>
                    <input type="date" value={form.data} onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))} style={inputStyle} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <FieldLabel>Forma de pagamento</FieldLabel>
                    <select value={form.forma} onChange={(e) => setForm((f) => ({ ...f, forma: e.target.value }))} style={inputStyle}>
                      <option value="">Não informar</option>
                      {FORMAS_PAGAMENTO.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <FieldLabel>Observação (opcional)</FieldLabel>
                  <textarea rows={2} value={form.obs} onChange={(e) => setForm((f) => ({ ...f, obs: e.target.value }))} style={{ ...inputStyle, resize: "vertical" }} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setMostrarForm(false)} disabled={salvando} style={{ ...btnOutline, flex: 1 }}>Cancelar</button>
                  <button onClick={salvarDespesa} disabled={salvando} style={{ ...btnPrimary, flex: 2, opacity: salvando ? 0.7 : 1 }}>
                    {salvando ? <Loader2 size={16} className="spin" /> : <Check size={16} />} {salvando ? "Salvando…" : "Salvar despesa"}
                  </button>
                </div>
              </div>
            </Card>
          )}

          {saidas.length === 0 ? (
            <EmptyState text="Nenhuma saída neste período." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {saidas.map((s) => (
                <div key={`${s.origem}-${s.id}`} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="mono" style={{ fontSize: 11.5, color: C.textFaint, flexShrink: 0, width: comAno ? 62 : 40 }}>{fmtDia(String(s.dia).slice(0, 10), comAno)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: C.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.descricao}</div>
                    <div style={{ fontSize: 11, color: C.textSoft }}>
                      {s.origem === "compra" ? "Compra (Caixa)" : s.origem === "diaria" ? "Diária (Equipe)" : s.categoria}
                      {s.origem === "despesa" && s.forma_pagamento ? ` · ${s.forma_pagamento}` : ""}
                    </div>
                  </div>
                  <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: C.orangeText, flexShrink: 0 }}>{fmt(Number(s.valor))}</div>
                  {s.origem === "despesa" && (
                    <button onClick={() => removerDespesa(s)} style={iconBtnStyle} aria-label="Apagar despesa"><Trash2 size={14} color={C.textFaint} /></button>
                  )}
                </div>
              ))}
              {saidas.length >= LIMITE_SAIDAS && (
                <div style={{ fontSize: 11.5, color: C.textFaint, textAlign: "center", padding: "4px 0" }}>
                  Mostrando as {LIMITE_SAIDAS} saídas mais recentes do período. Os totais acima consideram todas.
                </div>
              )}
              <div style={{ fontSize: 11.5, color: C.textFaint, lineHeight: 1.45, padding: "2px 2px 0" }}>
                Compras e diárias são editadas nas abas Compras e Equipe; só as despesas lançadas aqui podem ser apagadas aqui.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
