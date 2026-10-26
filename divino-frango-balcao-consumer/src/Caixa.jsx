import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Loader2, Trash2, Pencil, Check, X } from "lucide-react";
import {
  INICIO_HISTORICO, r2, mesDe, ultimoDiaDoMes, formaDe, periodoPreset,
  normalizarLinha, totaisDasLinhas, calcularDinheiro, centavos, reais,
} from "./caixaCalculos";

// Aba "Caixa" do painel. Três usos: lançar as vendas do dia (dinheiro, cartão e Pix), lançar compras
// e despesas e consultar o fechamento do mês. Não guarda nada em tabela duplicada:
//  * vendas  -> movimentacoes_caixa (tipo 'venda'), pela função salvar_vendas_dia
//  * compras da aba Compras -> movimentacoes_caixa (tipo 'compra'); outras despesas -> tabela despesas
//  * fechamento mensal -> fechamentos_caixa (saldo inicial e dinheiro contado)
// Os totais são somados no banco (funções caixa_dias e caixa_lancamentos, em supabase/migracao-caixa.sql).

const CATEGORIAS = [
  "Frangos e carnes", "Alimentos e ingredientes", "Embalagens", "Bebidas", "Gás", "Energia elétrica",
  "Aluguel", "Pagamento de equipe", "Entregador", "Materiais de limpeza", "Manutenção", "Outras despesas",
];
const FORMAS = ["Dinheiro", "Pix", "Cartão", "Outro"];
const PRESETS = [
  { id: "hoje", label: "Hoje" },
  { id: "ontem", label: "Ontem" },
  { id: "mes", label: "Este mês" },
  { id: "mes_anterior", label: "Mês anterior" },
  { id: "custom", label: "Período" },
];
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const ehErroMigracao = (err) =>
  /could not find|schema cache|does not exist|PGRST20\d|42P01|42703|42883/i.test(`${err?.code || ""} ${err?.message || ""}`);

const fmtDia = (iso, comAno = true) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}${comAno ? `/${iso.slice(0, 4)}` : ""}` : "";

// ---------- campo de dinheiro: digite só os números (350 -> R$ 3,50; 35000 -> R$ 350,00) ----------
const MAX_CENTAVOS = 99999999999;
function MoneyInput({ cents, onChange, style, placeholder = "R$ 0,00", ariaLabel }) {
  const texto = cents == null ? "" : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={texto}
      onChange={(e) => {
        const digitos = e.target.value.replace(/\D/g, "");
        onChange(digitos === "" ? null : Math.min(parseInt(digitos, 10), MAX_CENTAVOS));
      }}
      style={style}
    />
  );
}

function Kpi({ C, label, value, cor, sub }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ fontSize: 10.5, color: C.textSoft, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 }}>{label}</div>
      <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: cor || C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.textFaint, marginTop: 4, lineHeight: 1.35 }}>{sub}</div>}
    </div>
  );
}

function Linha({ C, label, valor, cor, forte, recuo }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, padding: "5px 0", paddingLeft: recuo ? 12 : 0 }}>
      <span style={{ fontSize: forte ? 13.5 : 13, fontWeight: forte ? 700 : 500, color: forte ? C.text : C.textSoft }}>{label}</span>
      <span className="mono" style={{ fontSize: forte ? 14.5 : 13, fontWeight: forte ? 800 : 600, color: cor || C.text, whiteSpace: "nowrap" }}>{valor}</span>
    </div>
  );
}

export default function Caixa({
  supabase, C, fmt, Card, FieldLabel, EmptyState, inputStyle, btnPrimary, btnOutline, iconBtnStyle, showToast, dataLocalISO,
}) {
  const hoje = dataLocalISO();
  const toastRef = useRef(showToast);
  toastRef.current = showToast;
  const toast = (m) => toastRef.current && toastRef.current(m);

  const [versao, setVersao] = useState(0); // sobe a cada gravação: recarrega resumo, histórico e fechamento
  const recarregar = () => setVersao((v) => v + 1);
  const [erroMigracao, setErroMigracao] = useState(false);

  // ---------- período (resumo e histórico) ----------
  const [preset, setPreset] = useState("mes");
  const [custIni, setCustIni] = useState(hoje);
  const [custFim, setCustFim] = useState(hoje);
  const [ini, fim] = useMemo(
    () => (preset === "custom" ? [custIni, custFim] : periodoPreset(preset, hoje)),
    [preset, custIni, custFim, hoje]
  );
  const periodoValido = !!ini && !!fim && fim >= ini;

  // ---------- fechamentos salvos ----------
  const [fechamentos, setFechamentos] = useState([]);
  const [fechCarregado, setFechCarregado] = useState(false);
  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error } = await supabase.from("fechamentos_caixa").select("*").order("mes");
      if (!vivo) return;
      if (error) {
        if (ehErroMigracao(error)) setErroMigracao(true);
        else toast("Erro ao carregar os fechamentos do caixa");
        return;
      }
      setFechamentos((data || []).map((f) => ({
        ...f,
        mes: String(f.mes).slice(0, 10),
        saldo_inicial: f.saldo_inicial == null ? null : Number(f.saldo_inicial),
        dinheiro_contado: f.dinheiro_contado == null ? null : Number(f.dinheiro_contado),
      })));
      setFechCarregado(true);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, versao]);

  const buscarLinhas = useCallback(async (de, ate) => {
    const inicio = de < INICIO_HISTORICO ? de : INICIO_HISTORICO;
    const { data, error } = await supabase.rpc("caixa_dias", { p_inicio: inicio, p_fim: ate });
    if (error) throw error;
    return (data || []).map(normalizarLinha);
  }, [supabase]);

  // ---------- resumo do período (4 cartões) ----------
  const [resumo, setResumo] = useState(null);
  const [carregandoResumo, setCarregandoResumo] = useState(true);
  const reqResumo = useRef(0);
  useEffect(() => {
    if (!periodoValido) { setCarregandoResumo(false); return; }
    if (!fechCarregado) return;
    const id = ++reqResumo.current;
    setCarregandoResumo(true);
    (async () => {
      try {
        const [linhas, p1, p2] = await Promise.all([
          buscarLinhas(ini, fim),
          supabase.from("despesas").select("valor").eq("situacao", "pendente"),
          supabase.from("movimentacoes_caixa").select("valor").eq("tipo", "compra").eq("situacao", "pendente"),
        ]);
        if (id !== reqResumo.current) return;
        const err = p1.error || p2.error;
        if (err) throw err;
        const pendenteGeral = r2([...(p1.data || []), ...(p2.data || [])].reduce((s, r) => s + (Number(r.valor) || 0), 0));
        setResumo({
          periodo: totaisDasLinhas(linhas, ini, fim),
          dinheiro: calcularDinheiro({ ate: fim, fechamentos, linhas }),
          linhas,
          pendenteGeral,
        });
      } catch (e) {
        if (id !== reqResumo.current) return;
        if (ehErroMigracao(e)) setErroMigracao(true);
        else toast(`Erro ao carregar o resumo do caixa: ${e.message || ""}`);
      } finally {
        if (id === reqResumo.current) setCarregandoResumo(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ini, fim, periodoValido, fechamentos, fechCarregado, versao, buscarLinhas]);

  // ---------- 1) vendas do dia ----------
  const [vendaData, setVendaData] = useState(hoje);
  const [vf, setVf] = useState({ dinheiro: null, cartao: null, pix: null, obs: "" });
  const [vInfo, setVInfo] = useState({ carregando: true, existe: false, duplicados: false, outros: 0 });
  const [vendaVersao, setVendaVersao] = useState(0); // só muda ao trocar a data ou depois de salvar (não apaga o que está sendo digitado)
  const [salvandoVenda, setSalvandoVenda] = useState(false);
  const [mostrarVendas, setMostrarVendas] = useState(false);
  const vendasRef = useRef(null);
  const reqVenda = useRef(0);

  useEffect(() => {
    if (!vendaData) return;
    const id = ++reqVenda.current;
    setVInfo((i) => ({ ...i, carregando: true }));
    (async () => {
      const cols = "id,valor,forma_pagamento,observacao,created_at";
      const [a, b] = await Promise.all([
        supabase.from("movimentacoes_caixa").select(cols).eq("tipo", "venda").eq("data_referencia", vendaData),
        supabase.from("movimentacoes_caixa").select(cols).eq("tipo", "venda").is("data_referencia", null)
          .gte("created_at", `${vendaData}T00:00:00-03:00`).lte("created_at", `${vendaData}T23:59:59.999-03:00`),
      ]);
      if (id !== reqVenda.current) return;
      const err = a.error || b.error;
      if (err) {
        if (ehErroMigracao(err)) setErroMigracao(true);
        else toast("Erro ao consultar as vendas dessa data");
        setVInfo((i) => ({ ...i, carregando: false }));
        return;
      }
      const rows = [...(a.data || []), ...(b.data || [])];
      const soma = { Dinheiro: 0, "Cartão": 0, Pix: 0, Outros: 0 };
      const qtd = { Dinheiro: 0, "Cartão": 0, Pix: 0, Outros: 0 };
      rows.forEach((r) => { const f = formaDe(r.forma_pagamento); soma[f] += Number(r.valor) || 0; qtd[f] += 1; });
      setVf({
        dinheiro: qtd.Dinheiro ? centavos(soma.Dinheiro) : null,
        cartao: qtd["Cartão"] ? centavos(soma["Cartão"]) : null,
        pix: qtd.Pix ? centavos(soma.Pix) : null,
        obs: rows.map((r) => r.observacao).find(Boolean) || "",
      });
      setVInfo({
        carregando: false,
        existe: qtd.Dinheiro + qtd["Cartão"] + qtd.Pix > 0,
        duplicados: qtd.Dinheiro > 1 || qtd["Cartão"] > 1 || qtd.Pix > 1,
        outros: r2(soma.Outros),
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendaData, vendaVersao, supabase]);

  const totalVendaForm = (vf.dinheiro || 0) + (vf.cartao || 0) + (vf.pix || 0);

  const salvarVenda = async () => {
    if (salvandoVenda || vInfo.carregando) return;
    if (!vendaData) { toast("Informe a data das vendas"); return; }
    if (vendaData > hoje) { toast("A data das vendas não pode ser futura"); return; }
    if (totalVendaForm <= 0 && !vInfo.existe) { toast("Informe o valor de dinheiro, cartão ou Pix"); return; }
    if (totalVendaForm <= 0) {
      if (!window.confirm(`Todos os valores estão zerados. Isso APAGA o lançamento de vendas de ${fmtDia(vendaData)}. Continuar?`)) return;
    } else if (vInfo.duplicados) {
      if (!window.confirm(`Em ${fmtDia(vendaData)} há lançamentos antigos repetidos da mesma forma de pagamento. Ao salvar, eles serão unificados em um por forma (dinheiro, cartão e Pix), com os valores acima. Continuar?`)) return;
    }
    setSalvandoVenda(true);
    const { error } = await supabase.rpc("salvar_vendas_dia", {
      p_data: vendaData,
      p_dinheiro: reais(vf.dinheiro || 0),
      p_cartao: reais(vf.cartao || 0),
      p_pix: reais(vf.pix || 0),
      p_obs: vf.obs.trim() || null,
    });
    setSalvandoVenda(false);
    if (error) {
      if (ehErroMigracao(error)) setErroMigracao(true);
      toast(`Erro ao salvar as vendas: ${error.message}`);
      return;
    }
    toast(vInfo.existe ? "Vendas do dia atualizadas" : "Vendas do dia salvas");
    setVendaVersao((v) => v + 1);
    recarregar();
  };

  const diasComVenda = useMemo(
    () => (resumo ? resumo.linhas
      .filter((l) => l.dia >= ini && l.dia <= fim && l.vDinheiro + l.vCartao + l.vPix + l.vOutros > 0)
      .sort((a, b) => (a.dia < b.dia ? 1 : -1)) : []),
    [resumo, ini, fim]
  );

  // ---------- 2) compras e despesas ----------
  const formVazio = () => ({
    id: null, origem: null, data: hoje, descricao: "", categoria: "", valor: null,
    forma: "Dinheiro", situacao: "pago", dataPagamento: hoje, obs: "",
  });
  const [df, setDf] = useState(formVazio);
  const [salvandoDesp, setSalvandoDesp] = useState(false);
  const formRef = useRef(null);
  const editando = !!df.id;

  const opcoesCategoria = useMemo(
    () => (df.categoria && !CATEGORIAS.includes(df.categoria) ? [...CATEGORIAS, df.categoria] : CATEGORIAS),
    [df.categoria]
  );
  const opcoesForma = useMemo(
    () => (df.forma && !FORMAS.includes(df.forma) ? [...FORMAS, df.forma] : FORMAS),
    [df.forma]
  );

  const salvarDespesa = async () => {
    if (salvandoDesp) return;
    const valor = reais(df.valor || 0);
    if (!df.data) { toast("Informe a data da compra ou despesa"); return; }
    if (!df.descricao.trim()) { toast("Informe a descrição"); return; }
    if (!df.categoria) { toast("Escolha a categoria"); return; }
    if (!(valor > 0)) { toast("Informe um valor maior que zero"); return; }
    const pago = df.situacao === "pago";
    if (pago && editando && !df.dataPagamento) { toast("Informe a data do pagamento"); return; }
    const campos = {
      categoria: df.categoria,
      valor,
      forma_pagamento: df.forma,
      situacao: df.situacao,
      data_pagamento: pago ? (editando ? df.dataPagamento : df.data) : null,
      observacao: df.obs.trim() || null,
    };
    setSalvandoDesp(true);
    let error;
    if (editando && df.origem === "compra") {
      ({ error } = await supabase.from("movimentacoes_caixa")
        .update({ ...campos, descricao: df.descricao.trim(), data_compra: df.data }).eq("id", df.id));
    } else if (editando) {
      ({ error } = await supabase.from("despesas")
        .update({ ...campos, descricao: df.descricao.trim(), data: df.data }).eq("id", df.id));
    } else {
      ({ error } = await supabase.from("despesas").insert({ ...campos, descricao: df.descricao.trim(), data: df.data }));
    }
    setSalvandoDesp(false);
    if (error) {
      if (ehErroMigracao(error)) setErroMigracao(true);
      toast(`Erro ao salvar: ${error.message}`);
      return;
    }
    toast(editando ? "Lançamento atualizado" : pago ? "Despesa lançada" : "Despesa pendente lançada");
    setDf(formVazio());
    recarregar();
  };

  const iniciarEdicao = (l) => {
    setDf({
      id: l.id, origem: l.origem, data: l.data_lancamento, descricao: l.descricao, categoria: l.categoria,
      valor: centavos(l.valor), forma: l.forma_pagamento, situacao: l.situacao,
      dataPagamento: l.data_pagamento || l.dia || hoje, obs: l.observacao || "",
    });
    setPagandoId(null);
    setTimeout(() => formRef.current && formRef.current.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  // ---------- histórico ----------
  const [lanc, setLanc] = useState([]);
  const [carregandoLanc, setCarregandoLanc] = useState(true);
  const [fCat, setFCat] = useState("todas");
  const [fSit, setFSit] = useState("todas");
  const reqLanc = useRef(0);
  useEffect(() => {
    if (!periodoValido) return;
    const id = ++reqLanc.current;
    setCarregandoLanc(true);
    (async () => {
      const { data, error } = await supabase.rpc("caixa_lancamentos", { p_inicio: ini, p_fim: fim, p_limite: 1000 });
      if (id !== reqLanc.current) return;
      if (error) {
        if (ehErroMigracao(error)) setErroMigracao(true);
        else toast(`Erro ao carregar o histórico: ${error.message}`);
      } else {
        setLanc((data || []).map((l) => ({
          ...l,
          dia: String(l.dia).slice(0, 10),
          data_lancamento: String(l.data_lancamento).slice(0, 10),
          data_pagamento: l.data_pagamento ? String(l.data_pagamento).slice(0, 10) : null,
          valor: Number(l.valor) || 0,
        })));
      }
      setCarregandoLanc(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ini, fim, periodoValido, versao, supabase]);

  const categoriasDoHistorico = useMemo(() => {
    const extras = [...new Set(lanc.map((l) => l.categoria))].filter((c) => !CATEGORIAS.includes(c));
    return [...CATEGORIAS, ...extras];
  }, [lanc]);
  const filtrados = useMemo(
    () => lanc.filter((l) => (fCat === "todas" || l.categoria === fCat) && (fSit === "todas" || l.situacao === fSit)),
    [lanc, fCat, fSit]
  );
  const totalFiltrado = useMemo(() => r2(filtrados.reduce((s, l) => s + l.valor, 0)), [filtrados]);

  const excluir = async (l) => {
    if (!window.confirm(`Excluir "${l.descricao}" (${fmt(l.valor)})? Essa ação não pode ser desfeita.`)) return;
    const tabela = l.origem === "compra" ? "movimentacoes_caixa" : "despesas";
    const { error } = await supabase.from(tabela).delete().eq("id", l.id);
    if (error) { toast(`Erro ao excluir: ${error.message}`); return; }
    if (df.id === l.id) setDf(formVazio());
    toast("Lançamento excluído");
    recarregar();
  };

  // pagar uma compra/despesa pendente: atualiza a MESMA linha (não cria outra saída)
  const [pagandoId, setPagandoId] = useState(null);
  const [pg, setPg] = useState({ data: hoje, forma: "Dinheiro" });
  const [salvandoPag, setSalvandoPag] = useState(false);
  const abrirPagamento = (l) => {
    setPagandoId(l.id);
    setPg({ data: hoje, forma: FORMAS.includes(l.forma_pagamento) ? l.forma_pagamento : "Dinheiro" });
  };
  const confirmarPagamento = async (l) => {
    if (salvandoPag) return;
    if (!pg.data) { toast("Informe a data do pagamento"); return; }
    setSalvandoPag(true);
    const tabela = l.origem === "compra" ? "movimentacoes_caixa" : "despesas";
    const { data, error } = await supabase.from(tabela)
      .update({ situacao: "pago", data_pagamento: pg.data, forma_pagamento: pg.forma })
      .eq("id", l.id).eq("situacao", "pendente").select("id");
    setSalvandoPag(false);
    if (error) { toast(`Erro ao registrar o pagamento: ${error.message}`); return; }
    if (!data || data.length === 0) {
      toast("Esse lançamento já foi pago (ou não existe mais). Atualizei a lista.");
    } else {
      toast("Pagamento registrado");
    }
    setPagandoId(null);
    recarregar();
  };

  // ---------- 3) fechamento mensal ----------
  const [fMes, setFMes] = useState(mesDe(hoje));
  const [ff, setFf] = useState({ saldoInicial: null, contado: null, obs: "" });
  const [fCalc, setFCalc] = useState(null);
  const [carregandoFech, setCarregandoFech] = useState(true);
  const [salvandoFech, setSalvandoFech] = useState(false);
  const reqFech = useRef(0);

  // preenche os campos com o que já foi salvo para o mês escolhido (só refaz se o salvo mudou de verdade)
  const salvoFech = fechamentos.find((f) => f.mes === fMes);
  const salvoChave = salvoFech ? `${salvoFech.saldo_inicial}|${salvoFech.dinheiro_contado}|${salvoFech.observacao}` : "nenhum";
  useEffect(() => {
    const salvo = salvoFech;
    setFf({
      saldoInicial: salvo && salvo.saldo_inicial != null ? centavos(salvo.saldo_inicial) : null,
      contado: salvo && salvo.dinheiro_contado != null ? centavos(salvo.dinheiro_contado) : null,
      obs: (salvo && salvo.observacao) || "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fMes, salvoChave]);

  useEffect(() => {
    if (!fechCarregado) return;
    const id = ++reqFech.current;
    setCarregandoFech(true);
    const ultimo = ultimoDiaDoMes(fMes);
    (async () => {
      try {
        const linhas = await buscarLinhas(fMes, ultimo);
        if (id !== reqFech.current) return;
        setFCalc({
          totais: totaisDasLinhas(linhas, fMes, ultimo),
          dinheiro: calcularDinheiro({ ate: ultimo, fechamentos, linhas }),
        });
      } catch (e) {
        if (id !== reqFech.current) return;
        if (ehErroMigracao(e)) setErroMigracao(true);
        else toast(`Erro ao carregar o fechamento: ${e.message || ""}`);
      } finally {
        if (id === reqFech.current) setCarregandoFech(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fMes, fechamentos, fechCarregado, versao, buscarLinhas]);

  const abertura = fCalc ? (ff.saldoInicial != null ? reais(ff.saldoInicial) : fCalc.dinheiro.saldoInicialAuto) : 0;
  const saldoFinalCalc = fCalc ? r2(abertura + fCalc.dinheiro.entradas - fCalc.dinheiro.saidas) : 0;
  const diferenca = ff.contado != null ? r2(reais(ff.contado) - saldoFinalCalc) : null;

  const anos = useMemo(() => {
    const atual = Number(hoje.slice(0, 4));
    const inicio = Number(INICIO_HISTORICO.slice(0, 4));
    const lista = [];
    for (let a = atual; a >= inicio; a--) lista.push(String(a));
    return lista;
  }, [hoje]);

  const salvarFechamento = async () => {
    if (salvandoFech) return;
    setSalvandoFech(true);
    const { error } = await supabase.from("fechamentos_caixa").upsert({
      mes: fMes,
      saldo_inicial: ff.saldoInicial == null ? null : reais(ff.saldoInicial),
      dinheiro_contado: ff.contado == null ? null : reais(ff.contado),
      observacao: ff.obs.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "mes" });
    setSalvandoFech(false);
    if (error) {
      if (ehErroMigracao(error)) setErroMigracao(true);
      toast(`Erro ao salvar o fechamento: ${error.message}`);
      return;
    }
    toast("Fechamento do mês salvo");
    recarregar();
  };

  // ---------- visual ----------
  const secao = { marginBottom: 14 };
  const titulo = { fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 12 };
  const grade = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 };
  const campo = { marginBottom: 10 };
  const selectStyle = { ...inputStyle, appearance: "auto" };
  const moneyStyle = { ...inputStyle, fontWeight: 700 };
  const chip = (ativo) => ({
    flexShrink: 0, padding: "8px 13px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap",
    background: ativo ? C.orange : C.card, color: ativo ? "#0E0E10" : C.textSoft,
    border: `1px solid ${ativo ? C.orange : C.border}`,
  });
  const seg = (ativo, cor) => ({
    flex: 1, padding: "11px 10px", borderRadius: 10, fontSize: 14, fontWeight: 700,
    background: ativo ? cor : "transparent", color: ativo ? "#0E0E10" : C.textSoft,
    border: `1px solid ${ativo ? cor : C.border}`,
  });

  const saldoDin = resumo ? resumo.dinheiro : null;

  return (
    <div>
      <div className="display" style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 12 }}>Caixa</div>

      {erroMigracao && (
        <Card style={{ borderColor: C.orange, marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.orangeText, marginBottom: 6 }}>Falta ativar o novo Caixa no banco</div>
          <div style={{ fontSize: 13, color: C.textSoft, lineHeight: 1.5 }}>
            Rode o arquivo <b style={{ color: C.text }}>supabase/migracao-caixa.sql</b> no SQL Editor do Supabase (depois do migracao-seguranca.sql e do migracao-financeiro.sql) e recarregue esta tela.
          </div>
        </Card>
      )}

      {/* período */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, marginBottom: 6 }}>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => { if (p.id === "custom") { setCustIni(ini); setCustFim(fim); } setPreset(p.id); }}
            style={chip(preset === p.id)}
          >
            {p.label}
          </button>
        ))}
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
      <div style={{ fontSize: 11.5, color: periodoValido ? C.textFaint : C.red, marginBottom: 12 }}>
        {!periodoValido ? "Período inválido: a data final é anterior à inicial." : ini === fim ? fmtDia(ini) : `${fmtDia(ini)} a ${fmtDia(fim)}`}
      </div>

      {/* resumo: 4 cartões */}
      {carregandoResumo && !resumo && !erroMigracao ? (
        <div style={{ textAlign: "center", padding: "28px 0", color: C.textSoft }}><Loader2 size={20} className="spin" /></div>
      ) : resumo && (
        <div style={{ ...grade, gridTemplateColumns: "1fr 1fr", marginBottom: 6, opacity: carregandoResumo ? 0.6 : 1 }}>
          <Kpi C={C} label="Total de vendas" value={fmt(resumo.periodo.vTotal)} cor={C.green} sub="dinheiro + cartão + Pix" />
          <Kpi C={C} label="Compras e despesas pagas" value={fmt(resumo.periodo.pagoTotal)} cor={C.orangeText} sub="o que já foi pago no período" />
          <Kpi
            C={C} label="Contas pendentes" value={fmt(resumo.periodo.pendente)} cor={resumo.periodo.pendente > 0 ? C.red : C.text}
            sub={resumo.pendenteGeral > resumo.periodo.pendente ? `${fmt(resumo.pendenteGeral)} em aberto no total` : "ainda não pagas"}
          />
          <Kpi
            C={C} label="Saldo em dinheiro" value={fmt(saldoDin.saldoAte)} cor={saldoDin.saldoAte < 0 ? C.red : C.text}
            sub={`só dinheiro físico, até ${fmtDia(fim, false)} (sem cartão e Pix)`}
          />
        </div>
      )}

      {/* 1) vendas do dia */}
      <div ref={vendasRef} style={{ height: 14 }} />
      <Card style={secao}>
        <div style={titulo}>Vendas do dia</div>

        <div style={campo}>
          <FieldLabel>Data das vendas</FieldLabel>
          <input type="date" value={vendaData} max={hoje} onChange={(e) => setVendaData(e.target.value)} style={inputStyle} />
        </div>

        {vInfo.existe && !vInfo.carregando && (
          <div style={{ background: C.orangeSoft, border: `1px solid ${C.orange}`, borderRadius: 10, padding: "9px 11px", marginBottom: 12, fontSize: 12.5, color: C.orangeText, lineHeight: 1.45 }}>
            Já existe um lançamento de vendas em <b>{fmtDia(vendaData)}</b>. Os valores abaixo são os que estão salvos: corrija o que precisar e toque em “Atualizar vendas”.
          </div>
        )}

        <div style={grade}>
          <div>
            <FieldLabel>Dinheiro</FieldLabel>
            <MoneyInput ariaLabel="Vendas em dinheiro" cents={vf.dinheiro} onChange={(v) => setVf((f) => ({ ...f, dinheiro: v }))} style={moneyStyle} />
          </div>
          <div>
            <FieldLabel>Cartão</FieldLabel>
            <MoneyInput ariaLabel="Vendas no cartão" cents={vf.cartao} onChange={(v) => setVf((f) => ({ ...f, cartao: v }))} style={moneyStyle} />
          </div>
          <div>
            <FieldLabel>Pix</FieldLabel>
            <MoneyInput ariaLabel="Vendas no Pix" cents={vf.pix} onChange={(v) => setVf((f) => ({ ...f, pix: v }))} style={moneyStyle} />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", background: C.cardAlt, borderRadius: 10, padding: "10px 12px", margin: "12px 0" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.textSoft }}>Total vendido</span>
          <span className="mono" style={{ fontSize: 18, fontWeight: 800, color: C.green }}>{fmt(totalVendaForm / 100)}</span>
        </div>
        {vInfo.outros > 0 && (
          <div style={{ fontSize: 11.5, color: C.textFaint, marginBottom: 10 }}>
            Esta data também tem {fmt(vInfo.outros)} lançados em outra forma de pagamento (antigos); eles continuam nos relatórios e não aparecem aqui.
          </div>
        )}

        <div style={campo}>
          <FieldLabel>Observações (opcional)</FieldLabel>
          <input value={vf.obs} onChange={(e) => setVf((f) => ({ ...f, obs: e.target.value }))} placeholder="Ex: dia de chuva, evento…" style={inputStyle} maxLength={200} />
        </div>

        <button onClick={salvarVenda} disabled={salvandoVenda || vInfo.carregando} style={{ ...btnPrimary, width: "100%", opacity: salvandoVenda || vInfo.carregando ? 0.7 : 1 }}>
          {salvandoVenda ? <Loader2 size={15} className="spin" /> : <Check size={15} />} {vInfo.existe ? "Atualizar vendas" : "Salvar vendas"}
        </button>

        <button
          onClick={() => setMostrarVendas((v) => !v)}
          style={{ background: "none", border: "none", color: C.orangeText, fontSize: 12.5, fontWeight: 700, padding: "12px 0 0", width: "100%", textAlign: "left" }}
        >
          {mostrarVendas ? "Esconder" : "Ver"} vendas lançadas no período ({diasComVenda.length})
        </button>
        {mostrarVendas && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {diasComVenda.length === 0 && <div style={{ fontSize: 12.5, color: C.textSoft }}>Nenhuma venda lançada no período selecionado.</div>}
            {diasComVenda.map((l) => (
              <button
                key={l.dia}
                onClick={() => { setVendaData(l.dia); if (vendasRef.current) vendasRef.current.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 11px", textAlign: "left", color: C.text }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{fmtDia(l.dia)}</span>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: C.green }}>{fmt(r2(l.vDinheiro + l.vCartao + l.vPix + l.vOutros))}</span>
                </div>
                <div style={{ fontSize: 11.5, color: C.textSoft, marginTop: 2 }}>
                  Dinheiro {fmt(l.vDinheiro)} · Cartão {fmt(l.vCartao)} · Pix {fmt(l.vPix)}
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* 2) compras e despesas */}
      <div ref={formRef} />
      <Card style={secao}>
        <div style={titulo}>{editando ? "Editar compra ou despesa" : "Compras e despesas"}</div>

        {editando && (
          <div style={{ background: C.orangeSoft, border: `1px solid ${C.orange}`, borderRadius: 10, padding: "9px 11px", marginBottom: 12, fontSize: 12.5, color: C.orangeText, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span>Você está editando um lançamento{df.origem === "compra" ? " feito na aba Compras" : ""}.</span>
            <button onClick={() => setDf(formVazio())} style={{ ...iconBtnStyle, color: C.orangeText, fontSize: 12.5, fontWeight: 700 }}>Cancelar</button>
          </div>
        )}

        <div style={grade}>
          <div>
            <FieldLabel>Data da compra</FieldLabel>
            <input type="date" value={df.data} onChange={(e) => setDf((f) => ({ ...f, data: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <FieldLabel>Valor total</FieldLabel>
            <MoneyInput ariaLabel="Valor total" cents={df.valor} onChange={(v) => setDf((f) => ({ ...f, valor: v }))} style={moneyStyle} />
          </div>
        </div>

        <div style={{ ...campo, marginTop: 10 }}>
          <FieldLabel>Descrição</FieldLabel>
          <input value={df.descricao} onChange={(e) => setDf((f) => ({ ...f, descricao: e.target.value }))} placeholder="Ex: 20 kg de frango, botijão de gás…" style={inputStyle} maxLength={200} />
        </div>

        <div style={grade}>
          <div>
            <FieldLabel>Categoria</FieldLabel>
            <select value={df.categoria} onChange={(e) => setDf((f) => ({ ...f, categoria: e.target.value }))} style={selectStyle}>
              <option value="">Selecione…</option>
              {opcoesCategoria.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <FieldLabel>Forma de pagamento</FieldLabel>
            <select value={df.forma} onChange={(e) => setDf((f) => ({ ...f, forma: e.target.value }))} style={selectStyle}>
              {opcoesForma.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <FieldLabel>Situação do pagamento</FieldLabel>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => setDf((f) => ({ ...f, situacao: "pago" }))} style={seg(df.situacao === "pago", C.green)}>Pago</button>
            <button type="button" onClick={() => setDf((f) => ({ ...f, situacao: "pendente" }))} style={seg(df.situacao === "pendente", C.orange)}>Pendente</button>
          </div>
          {df.situacao === "pendente" && (
            <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 6 }}>Pendente não sai do dinheiro do caixa até você registrar o pagamento.</div>
          )}
        </div>

        {editando && df.situacao === "pago" && (
          <div style={{ marginTop: 10 }}>
            <FieldLabel>Data do pagamento</FieldLabel>
            <input type="date" value={df.dataPagamento} onChange={(e) => setDf((f) => ({ ...f, dataPagamento: e.target.value }))} style={inputStyle} />
          </div>
        )}

        <div style={{ ...campo, marginTop: 10 }}>
          <FieldLabel>Observações (opcional)</FieldLabel>
          <input value={df.obs} onChange={(e) => setDf((f) => ({ ...f, obs: e.target.value }))} style={inputStyle} maxLength={300} />
        </div>

        <button onClick={salvarDespesa} disabled={salvandoDesp} style={{ ...btnPrimary, width: "100%", opacity: salvandoDesp ? 0.7 : 1 }}>
          {salvandoDesp ? <Loader2 size={15} className="spin" /> : <Check size={15} />} {editando ? "Salvar alterações" : "Lançar compra ou despesa"}
        </button>
      </Card>

      {/* histórico */}
      <Card style={secao}>
        <div style={titulo}>Histórico de compras e despesas</div>
        <div style={{ fontSize: 11.5, color: C.textFaint, marginBottom: 10 }}>
          Período: {ini === fim ? fmtDia(ini) : `${fmtDia(ini)} a ${fmtDia(fim)}`} (muda lá em cima). Aparecem as pagas no período e as pendentes lançadas nele.
        </div>
        <div style={{ ...grade, marginBottom: 12 }}>
          <div>
            <FieldLabel>Categoria</FieldLabel>
            <select value={fCat} onChange={(e) => setFCat(e.target.value)} style={selectStyle}>
              <option value="todas">Todas</option>
              {categoriasDoHistorico.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <FieldLabel>Situação</FieldLabel>
            <select value={fSit} onChange={(e) => setFSit(e.target.value)} style={selectStyle}>
              <option value="todas">Todas</option>
              <option value="pago">Pagas</option>
              <option value="pendente">Pendentes</option>
            </select>
          </div>
        </div>

        {carregandoLanc ? (
          <div style={{ textAlign: "center", padding: "20px 0", color: C.textSoft }}><Loader2 size={18} className="spin" /></div>
        ) : filtrados.length === 0 ? (
          <EmptyState text="Nenhum lançamento neste período com esses filtros." />
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filtrados.map((l) => {
                const pendente = l.situacao === "pendente";
                return (
                  <div key={`${l.origem}-${l.id}`} style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 11px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text, wordBreak: "break-word" }}>{l.descricao}</div>
                        <div style={{ fontSize: 11.5, color: C.textSoft, marginTop: 2, lineHeight: 1.45 }}>
                          {fmtDia(l.data_lancamento)} · {l.categoria} · {l.forma_pagamento}
                          {!pendente && l.data_pagamento && l.data_pagamento !== l.data_lancamento ? ` · pago em ${fmtDia(l.data_pagamento)}` : ""}
                        </div>
                        {l.observacao && <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 2, wordBreak: "break-word" }}>{l.observacao}</div>}
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div className="mono" style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{fmt(l.valor)}</div>
                        <span style={{
                          display: "inline-block", marginTop: 4, fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                          background: pendente ? C.orangeSoft : C.greenSoft, color: pendente ? C.orangeText : C.green,
                        }}>
                          {pendente ? "Pendente" : "Pago"}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      {pendente && (
                        <button onClick={() => (pagandoId === l.id ? setPagandoId(null) : abrirPagamento(l))} style={{ ...btnOutline, padding: "6px 12px", fontSize: 12.5, borderColor: C.green, color: C.green }}>
                          Registrar pagamento
                        </button>
                      )}
                      <button onClick={() => iniciarEdicao(l)} style={iconBtnStyle} aria-label={`Editar ${l.descricao}`}><Pencil size={15} color={C.textSoft} /></button>
                      <button onClick={() => excluir(l)} style={iconBtnStyle} aria-label={`Excluir ${l.descricao}`}><Trash2 size={15} color={C.textFaint} /></button>
                    </div>
                    {pagandoId === l.id && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                        <div style={grade}>
                          <div>
                            <FieldLabel>Data do pagamento</FieldLabel>
                            <input type="date" value={pg.data} onChange={(e) => setPg((p) => ({ ...p, data: e.target.value }))} style={inputStyle} />
                          </div>
                          <div>
                            <FieldLabel>Pago com</FieldLabel>
                            <select value={pg.forma} onChange={(e) => setPg((p) => ({ ...p, forma: e.target.value }))} style={selectStyle}>
                              {FORMAS.map((f) => <option key={f} value={f}>{f}</option>)}
                            </select>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                          <button onClick={() => setPagandoId(null)} style={{ ...btnOutline, flex: 1 }}><X size={14} /> Cancelar</button>
                          <button onClick={() => confirmarPagamento(l)} disabled={salvandoPag} style={{ ...btnPrimary, flex: 1, opacity: salvandoPag ? 0.7 : 1 }}>
                            {salvandoPag ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Confirmar pagamento
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 10 }}>
              <Linha C={C} label={`${filtrados.length} lançamento${filtrados.length === 1 ? "" : "s"} na lista`} valor={fmt(totalFiltrado)} forte />
            </div>
          </>
        )}
      </Card>

      {/* 3) fechamento mensal */}
      <Card style={secao}>
        <div style={titulo}>Fechamento mensal</div>

        <div style={grade}>
          <div>
            <FieldLabel>Mês</FieldLabel>
            <select value={fMes.slice(5, 7)} onChange={(e) => setFMes(`${fMes.slice(0, 4)}-${e.target.value}-01`)} style={selectStyle}>
              {MESES.map((nome, i) => <option key={nome} value={String(i + 1).padStart(2, "0")}>{nome}</option>)}
            </select>
          </div>
          <div>
            <FieldLabel>Ano</FieldLabel>
            <select value={fMes.slice(0, 4)} onChange={(e) => setFMes(`${e.target.value}-${fMes.slice(5, 7)}-01`)} style={selectStyle}>
              {anos.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>

        {fechamentos.length > 0 && (
          <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "10px 0 2px" }}>
            {[...fechamentos].sort((a, b) => (a.mes < b.mes ? 1 : -1)).map((f) => (
              <button key={f.mes} onClick={() => setFMes(f.mes)} style={chip(f.mes === fMes)}>
                {f.mes.slice(5, 7)}/{f.mes.slice(0, 4)}
              </button>
            ))}
          </div>
        )}
        {fechamentos.length > 0 && <div style={{ fontSize: 11, color: C.textFaint, marginBottom: 4 }}>Meses com fechamento salvo</div>}

        {carregandoFech && !fCalc && !erroMigracao ? (
          <div style={{ textAlign: "center", padding: "20px 0", color: C.textSoft }}><Loader2 size={18} className="spin" /></div>
        ) : fCalc && (
          <div style={{ opacity: carregandoFech ? 0.6 : 1 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textSoft, textTransform: "uppercase", letterSpacing: 0.5, margin: "14px 0 4px" }}>Vendas do mês</div>
            <Linha C={C} label="Dinheiro" valor={fmt(fCalc.totais.vDinheiro)} recuo />
            <Linha C={C} label="Cartão" valor={fmt(fCalc.totais.vCartao)} recuo />
            <Linha C={C} label="Pix" valor={fmt(fCalc.totais.vPix)} recuo />
            {fCalc.totais.vOutros > 0 && <Linha C={C} label="Outras formas (lançamentos antigos)" valor={fmt(fCalc.totais.vOutros)} recuo />}
            <Linha C={C} label="Total geral de vendas" valor={fmt(fCalc.totais.vTotal)} cor={C.green} forte />

            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textSoft, textTransform: "uppercase", letterSpacing: 0.5, margin: "14px 0 4px" }}>Compras e despesas</div>
            <Linha C={C} label="Pagas no mês" valor={fmt(fCalc.totais.pagoTotal)} cor={C.orangeText} forte />
            <Linha C={C} label="Contas pendentes (lançadas no mês)" valor={fmt(fCalc.totais.pendente)} cor={fCalc.totais.pendente > 0 ? C.red : C.text} forte />
            <Linha
              C={C} label="Vendas − pagas (sem diárias da equipe)"
              valor={fmt(r2(fCalc.totais.vTotal - fCalc.totais.pagoTotal))}
              cor={fCalc.totais.vTotal - fCalc.totais.pagoTotal < 0 ? C.red : C.green}
            />

            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textSoft, textTransform: "uppercase", letterSpacing: 0.5, margin: "14px 0 4px" }}>Dinheiro físico</div>
            <div style={{ fontSize: 11.5, color: C.textFaint, marginBottom: 6 }}>Só entra dinheiro. Cartão, Pix e contas pendentes ficam de fora.</div>

            <div style={{ ...campo, marginTop: 8 }}>
              <FieldLabel>Saldo inicial do caixa</FieldLabel>
              <MoneyInput
                ariaLabel="Saldo inicial do caixa" cents={ff.saldoInicial}
                onChange={(v) => setFf((f) => ({ ...f, saldoInicial: v }))} style={moneyStyle}
                placeholder={fmt(fCalc.dinheiro.saldoInicialAuto)}
              />
              <div style={{ fontSize: 11, color: C.textFaint, marginTop: 4 }}>
                {ff.saldoInicial == null
                  ? `Automático: ${fmt(fCalc.dinheiro.saldoInicialAuto)} (o que sobrou no mês anterior). Digite para informar outro valor.`
                  : (
                    <>
                      Valor informado por você.{" "}
                      <button onClick={() => setFf((f) => ({ ...f, saldoInicial: null }))} style={{ background: "none", border: "none", padding: 0, color: C.orangeText, fontSize: 11, fontWeight: 700 }}>
                        Voltar ao automático ({fmt(fCalc.dinheiro.saldoInicialAuto)})
                      </button>
                    </>
                  )}
              </div>
            </div>

            <Linha C={C} label="Saldo inicial" valor={fmt(abertura)} />
            <Linha C={C} label="+ Entradas em dinheiro (vendas e outras entradas)" valor={fmt(fCalc.dinheiro.entradas)} cor={C.green} />
            <Linha C={C} label="− Saídas em dinheiro (pagas e outras saídas)" valor={fmt(fCalc.dinheiro.saidas)} cor={C.orangeText} />
            <Linha C={C} label="Saldo final calculado" valor={fmt(saldoFinalCalc)} forte />

            <div style={{ ...campo, marginTop: 12 }}>
              <FieldLabel>Dinheiro contado no caixa</FieldLabel>
              <MoneyInput ariaLabel="Dinheiro contado no caixa" cents={ff.contado} onChange={(v) => setFf((f) => ({ ...f, contado: v }))} style={moneyStyle} />
            </div>
            <Linha
              C={C} label="Diferença (contado − calculado)"
              valor={diferenca == null ? "—" : fmt(diferenca)}
              cor={diferenca == null ? C.textSoft : diferenca === 0 ? C.green : C.red} forte
            />

            <div style={{ ...campo, marginTop: 12 }}>
              <FieldLabel>Observações do fechamento (opcional)</FieldLabel>
              <input value={ff.obs} onChange={(e) => setFf((f) => ({ ...f, obs: e.target.value }))} style={inputStyle} maxLength={300} />
            </div>

            <button onClick={salvarFechamento} disabled={salvandoFech} style={{ ...btnPrimary, width: "100%", opacity: salvandoFech ? 0.7 : 1 }}>
              {salvandoFech ? <Loader2 size={15} className="spin" /> : <Check size={15} />} Salvar fechamento de {MESES[Number(fMes.slice(5, 7)) - 1]}/{fMes.slice(0, 4)}
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
