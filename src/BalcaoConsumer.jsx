import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Plus, Minus, Trash2, Check, X, Search, Phone, Loader2, RefreshCw, CalendarPlus } from "lucide-react";

const FORMAS = ["Dinheiro", "Pix", "Cartão"];

const paraNumero = (v) => {
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const n = parseFloat(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : 0;
};
const arred = (n) => Math.round(n * 100) / 100;
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const agoraISO = () => new Date().toISOString();
const soDigitos = (v) => String(v || "").replace(/\D/g, "");

const fmtAbertura = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
};
const fmtDuracao = (ms) => {
  if (ms == null || ms < 0) return "—";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}min`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
};
const linkWhatsApp = (tel, texto) => {
  const d = String(tel || "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return `https://wa.me/${d.startsWith("55") ? d : "55" + d}?text=${encodeURIComponent(texto)}`;
};

const grupoPedido = (s) => (s === "concluido" ? "finalizado" : s === "cancelado" || s === "recusado" ? "cancelado" : "andamento");
const grupoReserva = (s) => (s === "retirada" ? "finalizado" : s === "cancelada" ? "cancelado" : "andamento");
const LABEL_RESERVA = { pendente: "Pendente", confirmada: "Confirmada", retirada: "Retirada", cancelada: "Cancelada" };

// Modal no nível do módulo, para os campos não perderem o foco a cada letra digitada
function Modal({ C, titulo, onClose, largura = 640, children }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 14 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, width: "100%", maxWidth: largura, maxHeight: "92vh", overflowY: "auto", padding: 16 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{titulo}</div>
          <button onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", color: C.textSoft, padding: 4, display: "flex" }}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function BalcaoConsumer({
  supabase, C, fmt, FieldLabel, EmptyState, inputStyle, btnPrimary, btnOutline, iconBtnStyle,
  showToast, dataLocalISO, cardapio, pedidos, codigoPedido, labelStatus, onPedidoCriado, atualizarStatusPedido,
  bairrosEntrega, taxaPadrao,
}) {
  const hoje = dataLocalISO();
  const [dia, setDia] = useState(hoje);
  const [pesquisa, setPesquisa] = useState("");
  const [filtroOrigem, setFiltroOrigem] = useState("todos"); // todos | site | balcao | reserva
  const [filtroStatus, setFiltroStatus] = useState("todos"); // todos | andamento | finalizado | cancelado
  const [agora, setAgora] = useState(Date.now());
  const [modal, setModal] = useState(null); // "pedido" | "reserva" | null
  const [detalheKey, setDetalheKey] = useState(null);

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const chip = (ativa) => ({
    padding: "7px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
    border: `1px solid ${ativa ? C.orange : C.border}`,
    background: ativa ? C.orangeSoft : "transparent", color: ativa ? C.orangeText : C.textSoft,
  });
  const corStatus = (g) =>
    g === "finalizado" ? { bg: C.greenSoft, fg: C.green } : g === "cancelado" ? { bg: C.redSoft, fg: C.red } : { bg: C.orangeSoft, fg: C.orangeText };

  // ---------------- Reservas (carga) ----------------
  const [reservas, setReservas] = useState([]);
  const [erroRes, setErroRes] = useState("");
  const [carregando, setCarregando] = useState(false);

  const carregarReservas = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase.from("reservas").select("*").order("data_retirada", { ascending: true });
    setCarregando(false);
    if (error) {
      console.error(error);
      setErroRes("Reservas indisponíveis: rode migracao-balcao-reservas.sql no Supabase.");
      return;
    }
    setErroRes("");
    setReservas(data || []);
  }, [supabase]);

  useEffect(() => { carregarReservas(); }, [carregarReservas]);

  // ---------------- Linhas da tabela (pedidos + reservas) ----------------
  const linhas = useMemo(() => {
    const doDia = (pedidos || []).filter((p) => (p.dataPedido || (p.createdAt ? dataLocalISO(new Date(p.createdAt)) : "")) === dia);
    const ps = doDia.map((p) => {
      const grupo = grupoPedido(p.status);
      const fim = p.concluidoEm || p.canceladoEm || null;
      return {
        key: `p${p.id}`, tipo: "pedido", ref: p, cod: codigoPedido(p), abertura: p.createdAt,
        duracao: grupo === "andamento" ? agora - new Date(p.createdAt).getTime() : fim ? new Date(fim).getTime() - new Date(p.createdAt).getTime() : null,
        andamento: grupo === "andamento",
        cliente: p.clienteNome, origem: p.origem || "site", grupo,
        statusTxt: (labelStatus && labelStatus[p.status]) || p.status,
        entrega: p.tipoEntrega === "entrega" ? "Entregar no endereço" : "Retirar no local",
        entregaSub: p.tipoEntrega === "entrega" ? [p.endereco, p.bairro].filter(Boolean).join(" - ") : "",
        pagamento: p.formaPagamento || "", total: p.total || 0, agendado: "",
      };
    });
    const rs = reservas.filter((r) => r.data_retirada === dia).map((r) => ({
      key: `r${r.id}`, tipo: "reserva", ref: r, cod: `R${String(r.id).slice(0, 3).toUpperCase()}`, abertura: r.created_at,
      duracao: null, andamento: false, cliente: r.cliente_nome, origem: "reserva", grupo: grupoReserva(r.status),
      statusTxt: LABEL_RESERVA[r.status] || r.status, entrega: "Retirar no local", entregaSub: r.descricao,
      pagamento: "", total: r.total || 0, agendado: r.hora_retirada || "Sem hora",
    }));
    const termo = semAcento(pesquisa);
    return [...ps, ...rs]
      .filter((l) => filtroOrigem === "todos" || l.origem === filtroOrigem)
      .filter((l) => filtroStatus === "todos" || l.grupo === filtroStatus)
      .filter((l) => !termo || semAcento(`${l.cod} ${l.cliente} ${l.entregaSub}`).includes(termo))
      .sort((a, b) => String(b.abertura).localeCompare(String(a.abertura)));
  }, [pedidos, reservas, dia, filtroOrigem, filtroStatus, pesquisa, agora, codigoPedido, dataLocalISO, labelStatus]);

  const validos = linhas.filter((l) => l.grupo !== "cancelado");
  const somaTotal = arred(validos.reduce((s, l) => s + l.total, 0));
  const detalhe = linhas.find((l) => l.key === detalheKey) || null;

  // ---------------- Novo pedido (retirar no balcão ou entrega) ----------------
  const [carrinho, setCarrinho] = useState([]);
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState("retirada"); // retirada | entrega
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [cep, setCep] = useState("");
  const [rua, setRua] = useState("");
  const [numeroEnd, setNumeroEnd] = useState("");
  const [compl, setCompl] = useState("");
  const [bairro, setBairro] = useState("");
  const [referencia, setReferencia] = useState("");
  const [taxaTxt, setTaxaTxt] = useState("");
  const [taxaManual, setTaxaManual] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [forma, setForma] = useState("Dinheiro");
  const [trocoPara, setTrocoPara] = useState("");
  const [obs, setObs] = useState("");
  const [entregueNaHora, setEntregueNaHora] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [contatos, setContatos] = useState([]);
  const [mostrarSug, setMostrarSug] = useState(false);

  // contatos já cadastrados (se a tabela existir); erros são ignorados
  useEffect(() => {
    if (modal !== "pedido" || contatos.length) return;
    supabase.from("contatos").select("nome, telefone").limit(500).then(({ data }) => {
      if (data) setContatos(data);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal]);

  // clientes = quem já fez pedido (site ou balcão) + contatos; o endereço vem do último pedido de entrega
  const clientes = useMemo(() => {
    const mapa = new Map();
    const chave = (n, t) => soDigitos(t) || semAcento(n);
    [...(pedidos || [])]
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .forEach((p) => {
        if (!p.clienteNome || p.clienteNome === "Balcão") return;
        const k = chave(p.clienteNome, p.clienteTelefone);
        const atual = mapa.get(k) || {};
        const novo = { ...atual, nome: p.clienteNome, telefone: p.clienteTelefone || atual.telefone || "" };
        if (p.tipoEntrega === "entrega" && p.endereco) {
          novo.cep = p.cep || ""; novo.endereco = p.endereco; novo.bairro = p.bairro || ""; novo.referencia = p.referencia || "";
        }
        mapa.set(k, novo);
      });
    (contatos || []).forEach((c) => {
      if (!c.nome) return;
      const k = chave(c.nome, c.telefone);
      if (!mapa.has(k)) mapa.set(k, { nome: c.nome, telefone: c.telefone || "" });
    });
    return Array.from(mapa.values());
  }, [pedidos, contatos]);

  const sugestoes = useMemo(() => {
    const t = nome.trim();
    if (!mostrarSug || t.length < 2) return [];
    const n = semAcento(t);
    const d = soDigitos(t);
    return clientes
      .filter((c) => semAcento(c.nome).includes(n) || (d.length >= 3 && soDigitos(c.telefone).includes(d)))
      .slice(0, 6);
  }, [clientes, nome, mostrarSug]);

  const escolherCliente = (c) => {
    setNome(c.nome);
    setTelefone(c.telefone || "");
    if (c.endereco) {
      setCep(c.cep || ""); setRua(c.endereco); setNumeroEnd(""); setCompl("");
      setBairro(c.bairro || ""); setReferencia(c.referencia || ""); setTaxaManual(false);
    }
    setMostrarSug(false);
  };

  const buscarCep = async (digitos) => {
    setBuscandoCep(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${digitos}/json/`);
      const d = await r.json();
      if (d.erro) {
        showToast("CEP não encontrado");
      } else {
        setRua(d.logradouro || "");
        setBairro(d.bairro || "");
        setTaxaManual(false);
      }
    } catch (e) {
      showToast("Não foi possível buscar o CEP");
    } finally {
      setBuscandoCep(false);
    }
  };
  const onCep = (v) => {
    const d = soDigitos(v).slice(0, 8);
    setCep(d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d);
    if (d.length === 8) buscarCep(d);
  };

  // taxa: a do bairro cadastrado; se não houver, a taxa padrão. Dá para editar na mão.
  const taxaSugerida = useMemo(() => {
    const b = (bairrosEntrega || []).find((x) => x.ativo !== false && semAcento(x.nome) === semAcento(bairro));
    return b ? Number(b.taxa) || 0 : Number(taxaPadrao) || 0;
  }, [bairrosEntrega, bairro, taxaPadrao]);
  const taxa = tipo === "entrega" ? (taxaManual ? paraNumero(taxaTxt) : taxaSugerida) : 0;

  const itensVisiveis = useMemo(
    () => (cardapio || []).filter((c) => c.disponivel !== false && (!busca || semAcento(c.nome).includes(semAcento(busca)))),
    [cardapio, busca]
  );
  const subtotalCarrinho = useMemo(() => arred(carrinho.reduce((s, x) => s + x.preco * x.qtd, 0)), [carrinho]);
  const totalPedido = arred(subtotalCarrinho + taxa);

  const adicionar = (item) =>
    setCarrinho((prev) => {
      const i = prev.findIndex((x) => x.id === item.id);
      if (i >= 0) return prev.map((x, idx) => (idx === i ? { ...x, qtd: x.qtd + 1 } : x));
      return [...prev, { id: item.id, nome: item.nome, preco: item.preco, qtd: 1 }];
    });
  const mudarQtd = (id, delta) =>
    setCarrinho((prev) => prev.map((x) => (x.id === id ? { ...x, qtd: x.qtd + delta } : x)).filter((x) => x.qtd > 0));

  const abrirPedido = () => { setBusca(""); setModal("pedido"); };

  useEffect(() => {
    const h = (e) => {
      if (e.key === "F2") { e.preventDefault(); setBusca(""); setModal("pedido"); }
      if (e.key === "Escape") setModal(null);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const limparPedido = () => {
    setCarrinho([]); setNome(""); setTelefone(""); setCep(""); setRua(""); setNumeroEnd(""); setCompl("");
    setBairro(""); setReferencia(""); setTaxaTxt(""); setTaxaManual(false); setTrocoPara(""); setObs("");
    setForma("Dinheiro"); setTipo("retirada"); setEntregueNaHora(true);
  };

  const lancarPedido = async () => {
    if (!carrinho.length) return showToast("Adicione pelo menos um item");
    if (tipo === "entrega") {
      if (!nome.trim()) return showToast("Informe o nome do cliente");
      if (!rua.trim()) return showToast("Informe o endereço de entrega");
    }
    setSalvando(true);
    const enderecoCompleto = `${[rua.trim(), numeroEnd.trim()].filter(Boolean).join(", ")}${compl.trim() ? ` - ${compl.trim()}` : ""}`;
    const valorTroco = paraNumero(trocoPara);
    const comTroco = forma === "Dinheiro" && valorTroco > 0;
    const concluir = tipo === "retirada" && entregueNaHora;
    const linha = {
      cliente_nome: nome.trim() || "Balcão",
      cliente_telefone: telefone.trim(),
      tipo_entrega: tipo,
      forma_pagamento: forma,
      precisa_troco: comTroco,
      troco_para: comTroco ? valorTroco : null,
      itens: carrinho.map(({ id, nome: n, qtd, preco }) => ({ id, nome: n, qtd, preco })),
      subtotal: subtotalCarrinho,
      taxa_entrega: arred(taxa),
      total: totalPedido,
      observacao: obs.trim() || null,
      status: concluir ? "concluido" : "aceito",
      origem: "balcao",
      data_pedido: hoje,
      ...(concluir ? { concluido_em: agoraISO() } : {}),
      ...(tipo === "entrega"
        ? { cep: cep || null, endereco: enderecoCompleto, bairro: bairro.trim() || null, referencia: referencia.trim() || null }
        : {}),
    };
    const { data, error } = await supabase.from("pedidos").insert(linha).select().single();
    setSalvando(false);
    if (error) {
      console.error(error);
      if (/origem/i.test(error.message || "")) showToast("Falta rodar migracao-balcao-reservas.sql no Supabase");
      else showToast(`Erro ao lançar pedido: ${error.message}`);
      return;
    }
    if (onPedidoCriado) onPedidoCriado(data);
    showToast(`Pedido #${data.numero ?? data.numero_pedido ?? String(data.id).slice(0, 4).toUpperCase()} lançado`);
    limparPedido();
    setDia(hoje);
    setModal(null);
  };

  // ---------------- Nova reserva ----------------
  const formVazio = { nome: "", tel: "", data: hoje, hora: "", descricao: "", valor: "", sinal: "", obs: "" };
  const [formRes, setFormRes] = useState(formVazio);
  const [salvandoRes, setSalvandoRes] = useState(false);

  const salvarReserva = async () => {
    if (!formRes.nome.trim()) return showToast("Informe o nome do cliente");
    if (!formRes.data) return showToast("Informe a data da retirada");
    if (!formRes.descricao.trim()) return showToast("Descreva o que foi encomendado");
    setSalvandoRes(true);
    const { data, error } = await supabase.from("reservas").insert({
      cliente_nome: formRes.nome.trim(),
      cliente_telefone: formRes.tel.trim() || null,
      data_retirada: formRes.data,
      hora_retirada: formRes.hora || null,
      descricao: formRes.descricao.trim(),
      total: arred(paraNumero(formRes.valor)),
      sinal_pago: arred(paraNumero(formRes.sinal)),
      observacao: formRes.obs.trim() || null,
      status: "pendente",
    }).select().single();
    setSalvandoRes(false);
    if (error) {
      console.error(error);
      showToast(`Erro ao salvar reserva: ${error.message}`);
      return;
    }
    setReservas((prev) => [...prev, data]);
    setDia(data.data_retirada);
    setFormRes(formVazio);
    setModal(null);
    showToast("Reserva salva");
  };

  const mudarStatusReserva = async (id, status) => {
    const { data, error } = await supabase.from("reservas").update({ status }).eq("id", id).select().single();
    if (error) {
      console.error(error);
      showToast(`Erro ao atualizar reserva: ${error.message}`);
      return;
    }
    setReservas((prev) => prev.map((r) => (r.id === id ? data : r)));
  };

  const excluirReserva = async (id) => {
    if (!window.confirm("Excluir esta reserva?")) return;
    const { error } = await supabase.from("reservas").delete().eq("id", id);
    if (error) {
      console.error(error);
      showToast(`Erro ao excluir reserva: ${error.message}`);
      return;
    }
    setReservas((prev) => prev.filter((r) => r.id !== id));
    setDetalheKey(null);
  };

  // ---------------- Ações do pedido (no detalhe) ----------------
  const acaoPedido = async (p, proximo) => {
    let extra = {};
    if (proximo === "pronto") extra = { pronto_em: agoraISO() };
    if (proximo === "concluido") extra = { concluido_em: agoraISO() };
    if (proximo === "cancelado" || proximo === "recusado") {
      const motivo = window.prompt(proximo === "recusado" ? "Motivo da recusa (opcional):" : "Motivo do cancelamento (opcional):");
      if (motivo === null) return;
      extra = { cancelado_em: agoraISO(), motivo_cancelamento: motivo.trim() || null };
    }
    const ok = await atualizarStatusPedido(p.id, proximo, extra);
    if (ok) setDetalheKey(null);
  };

  const th = { textAlign: "left", padding: "9px 10px", fontSize: 11.5, fontWeight: 800, color: C.textSoft, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
  const td = { padding: "10px 10px", fontSize: 13, borderBottom: `1px solid ${C.borderSoft}`, verticalAlign: "top" };

  // ---------------- Tela ----------------
  return (
    <>
      {/* barra de ações */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button onClick={abrirPedido} style={{ ...btnPrimary, flex: 1 }}><Plus size={16} /> Novo pedido (F2)</button>
        <button onClick={() => { setFormRes({ ...formVazio, data: dia }); setModal("reserva"); }} style={{ ...btnOutline, flex: 1 }}><CalendarPlus size={16} /> Nova reserva</button>
        <button onClick={carregarReservas} aria-label="Atualizar" style={{ ...btnOutline, padding: "11px 12px" }}>
          {carregando ? <Loader2 size={16} /> : <RefreshCw size={16} />}
        </button>
      </div>

      {/* busca e filtros */}
      <div style={{ position: "relative", marginBottom: 10 }}>
        <Search size={15} style={{ position: "absolute", left: 11, top: 13, color: C.textFaint }} />
        <input value={pesquisa} onChange={(e) => setPesquisa(e.target.value)} placeholder="Pesquisar por nº, cliente ou item" style={{ ...inputStyle, paddingLeft: 33 }} />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", overflowX: "auto", paddingBottom: 6, marginBottom: 6 }}>
        <input type="date" value={dia} onChange={(e) => setDia(e.target.value || hoje)} style={{ ...inputStyle, width: "auto", flexShrink: 0 }} />
        {[["todos", "Todos"], ["site", "Site"], ["balcao", "Balcão"], ["reserva", "Reservas"]].map(([id, label]) => (
          <button key={id} onClick={() => setFiltroOrigem(id)} style={chip(filtroOrigem === id)}>{label}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, marginBottom: 10 }}>
        {[["todos", "Qualquer status"], ["andamento", "Em andamento"], ["finalizado", "Finalizados"], ["cancelado", "Cancelados"]].map(([id, label]) => (
          <button key={id} onClick={() => setFiltroStatus(id)} style={chip(filtroStatus === id)}>{label}</button>
        ))}
      </div>
      {erroRes && <div style={{ color: C.red, fontSize: 12.5, marginBottom: 10 }}>{erroRes}</div>}

      {/* tabela */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 820, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Pedido</th>
              <th style={th}>Abertura</th>
              <th style={th}>Duração</th>
              <th style={th}>Cliente</th>
              <th style={th}>Origem</th>
              <th style={th}>Status</th>
              <th style={th}>Entrega</th>
              <th style={{ ...th, textAlign: "right" }}>Total</th>
              <th style={th}>Agendado para</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const cor = corStatus(l.grupo);
              return (
                <tr key={l.key} onClick={() => setDetalheKey(l.key)} style={{ cursor: "pointer" }}>
                  <td style={{ ...td, fontWeight: 800 }}>{l.cod}</td>
                  <td style={td}>{fmtAbertura(l.abertura)}</td>
                  <td style={{ ...td, fontWeight: 700, color: l.andamento && l.duracao > 3600000 ? C.red : C.text }}>{l.duracao == null ? "—" : fmtDuracao(l.duracao)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{l.cliente}</td>
                  <td style={td}>{l.origem === "balcao" ? "Balcão" : l.origem === "reserva" ? "Reserva" : "Site"}</td>
                  <td style={td}>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 9px", borderRadius: 999, background: cor.bg, color: cor.fg, whiteSpace: "nowrap" }}>{l.statusTxt}</span>
                  </td>
                  <td style={td}>
                    <div style={{ fontWeight: 700 }}>{l.entrega}</div>
                    {l.entregaSub && <div style={{ fontSize: 11.5, color: C.textSoft, maxWidth: 220 }}>{l.entregaSub}</div>}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800 }}>
                    {fmt(l.total)}
                    {l.pagamento && <div style={{ fontSize: 11, color: C.textSoft, fontWeight: 500 }}>{l.pagamento}</div>}
                  </td>
                  <td style={td}>{l.agendado}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {linhas.length === 0 && <EmptyState text="Nada neste dia com esses filtros" />}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 4px", fontSize: 13, fontWeight: 800 }}>
        <span>{validos.length} registro{validos.length === 1 ? "" : "s"} (sem cancelados)</span>
        <span style={{ color: C.orangeText }}>{fmt(somaTotal)}</span>
      </div>

      {/* modal: novo pedido */}
      {modal === "pedido" && (
        <Modal C={C} titulo="Novo pedido" onClose={() => setModal(null)} largura={720}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button onClick={() => setTipo("retirada")} style={{ ...chip(tipo === "retirada"), flex: 1, padding: "10px 12px" }}>Retirar no local</button>
            <button onClick={() => setTipo("entrega")} style={{ ...chip(tipo === "entrega"), flex: 1, padding: "10px 12px" }}>Entrega</button>
          </div>

          <FieldLabel>Cliente</FieldLabel>
          <div style={{ position: "relative", marginBottom: 8 }}>
            <input
              value={nome}
              onChange={(e) => { setNome(e.target.value); setMostrarSug(true); }}
              onBlur={() => setTimeout(() => setMostrarSug(false), 150)}
              placeholder={tipo === "retirada" ? "Nome (opcional) — digite para buscar cliente" : "Nome — digite para buscar cliente"}
              style={inputStyle}
            />
            {sugestoes.length > 0 && (
              <div style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 10, marginTop: 4, overflow: "hidden" }}>
                {sugestoes.map((c, i) => (
                  <div
                    key={i}
                    onMouseDown={(e) => { e.preventDefault(); escolherCliente(c); }}
                    style={{ padding: "9px 12px", fontSize: 13, borderBottom: `1px solid ${C.borderSoft}`, cursor: "pointer" }}
                  >
                    <b>{c.nome}</b>{c.telefone ? ` · ${c.telefone}` : ""}
                    {c.endereco && <div style={{ fontSize: 11.5, color: C.textSoft }}>{c.endereco}{c.bairro ? ` - ${c.bairro}` : ""}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="Telefone" inputMode="tel" style={{ ...inputStyle, marginBottom: 12 }} />

          {tipo === "entrega" && (
            <>
              <FieldLabel>Endereço de entrega</FieldLabel>
              <div style={{ position: "relative", marginBottom: 8 }}>
                <input value={cep} onChange={(e) => onCep(e.target.value)} placeholder="CEP (preenche o endereço sozinho)" inputMode="numeric" style={inputStyle} />
                {buscandoCep && <div style={{ position: "absolute", right: 12, top: 11, color: C.textSoft }}><Loader2 size={16} /></div>}
              </div>
              <input value={rua} onChange={(e) => setRua(e.target.value)} placeholder="Endereço (rua)" style={{ ...inputStyle, marginBottom: 8 }} />
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input value={numeroEnd} onChange={(e) => setNumeroEnd(e.target.value)} placeholder="Número" style={inputStyle} />
                <input value={compl} onChange={(e) => setCompl(e.target.value)} placeholder="Complemento" style={inputStyle} />
              </div>
              <input value={bairro} onChange={(e) => { setBairro(e.target.value); setTaxaManual(false); }} placeholder="Bairro" style={{ ...inputStyle, marginBottom: 8 }} />
              <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Referência (opcional)" style={{ ...inputStyle, marginBottom: 8 }} />
              <FieldLabel>Taxa de entrega (R$)</FieldLabel>
              <input
                value={taxaManual ? taxaTxt : String(taxaSugerida).replace(".", ",")}
                onChange={(e) => { setTaxaManual(true); setTaxaTxt(e.target.value); }}
                inputMode="decimal"
                style={{ ...inputStyle, marginBottom: 12 }}
              />
            </>
          )}

          <FieldLabel>Itens</FieldLabel>
          <div style={{ position: "relative", marginBottom: 8 }}>
            <Search size={15} style={{ position: "absolute", left: 11, top: 13, color: C.textFaint }} />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar item do cardápio" style={{ ...inputStyle, paddingLeft: 33 }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, maxHeight: 200, overflowY: "auto", marginBottom: 12 }}>
            {itensVisiveis.map((c) => (
              <button key={c.id} onClick={() => adicionar(c)} style={{ textAlign: "left", background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 11, padding: "9px 10px", color: C.text }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.25 }}>{c.nome}</div>
                <div style={{ fontSize: 12, color: C.orangeText, fontWeight: 700, marginTop: 3 }}>{fmt(c.preco)}</div>
              </button>
            ))}
            {itensVisiveis.length === 0 && <EmptyState text="Nenhum item disponível" />}
          </div>

          {carrinho.map((x) => (
            <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.borderSoft}` }}>
              <div style={{ flex: 1, fontSize: 13.5 }}>{x.nome}</div>
              <button onClick={() => mudarQtd(x.id, -1)} style={iconBtnStyle}><Minus size={16} color={C.textSoft} /></button>
              <div style={{ minWidth: 22, textAlign: "center", fontWeight: 800 }}>{x.qtd}</div>
              <button onClick={() => mudarQtd(x.id, 1)} style={iconBtnStyle}><Plus size={16} color={C.textSoft} /></button>
              <div style={{ minWidth: 70, textAlign: "right", fontWeight: 700, fontSize: 13 }}>{fmt(x.preco * x.qtd)}</div>
            </div>
          ))}
          <div style={{ margin: "12px 0", fontSize: 13, color: C.textSoft }}>
            {tipo === "entrega" && (
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Subtotal</span><span>{fmt(subtotalCarrinho)}</span></div>
            )}
            {tipo === "entrega" && (
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Taxa de entrega</span><span>{fmt(taxa)}</span></div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 800, color: C.text, marginTop: 4 }}>
              <span>Total</span><span style={{ color: C.orangeText }}>{fmt(totalPedido)}</span>
            </div>
          </div>

          <FieldLabel>Pagamento</FieldLabel>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            {FORMAS.map((f) => (<button key={f} onClick={() => setForma(f)} style={chip(forma === f)}>{f}</button>))}
          </div>
          {forma === "Dinheiro" && (
            <input value={trocoPara} onChange={(e) => setTrocoPara(e.target.value)} placeholder="Troco para (R$) — opcional" inputMode="decimal" style={{ ...inputStyle, marginBottom: 10 }} />
          )}
          <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação (opcional)" style={{ ...inputStyle, marginBottom: 10 }} />
          {tipo === "retirada" && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.textSoft, marginBottom: 12 }}>
              <input type="checkbox" checked={entregueNaHora} onChange={(e) => setEntregueNaHora(e.target.checked)} />
              Já entregue ao cliente (marca como Concluído)
            </label>
          )}
          <button onClick={lancarPedido} disabled={salvando || carrinho.length === 0} style={{ ...btnPrimary, width: "100%", opacity: salvando || carrinho.length === 0 ? 0.6 : 1 }}>
            {salvando ? <Loader2 size={16} /> : <Check size={16} />} Lançar pedido
          </button>
        </Modal>
      )}

      {/* modal: nova reserva */}
      {modal === "reserva" && (
        <Modal C={C} titulo="Nova reserva (encomenda para retirar)" onClose={() => setModal(null)} largura={520}>
          <input value={formRes.nome} onChange={(e) => setFormRes({ ...formRes, nome: e.target.value })} placeholder="Nome do cliente" style={{ ...inputStyle, marginBottom: 8 }} />
          <input value={formRes.tel} onChange={(e) => setFormRes({ ...formRes, tel: e.target.value })} placeholder="Telefone / WhatsApp" inputMode="tel" style={{ ...inputStyle, marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input type="date" value={formRes.data} onChange={(e) => setFormRes({ ...formRes, data: e.target.value })} style={inputStyle} />
            <input type="time" value={formRes.hora} onChange={(e) => setFormRes({ ...formRes, hora: e.target.value })} style={inputStyle} />
          </div>
          <textarea value={formRes.descricao} onChange={(e) => setFormRes({ ...formRes, descricao: e.target.value })} placeholder="O que foi encomendado (ex.: 3 frangos assados, 2 farofas)" rows={3} style={{ ...inputStyle, marginBottom: 8, resize: "vertical" }} />
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input value={formRes.valor} onChange={(e) => setFormRes({ ...formRes, valor: e.target.value })} placeholder="Valor total (R$)" inputMode="decimal" style={inputStyle} />
            <input value={formRes.sinal} onChange={(e) => setFormRes({ ...formRes, sinal: e.target.value })} placeholder="Sinal pago (R$)" inputMode="decimal" style={inputStyle} />
          </div>
          <input value={formRes.obs} onChange={(e) => setFormRes({ ...formRes, obs: e.target.value })} placeholder="Observação (opcional)" style={{ ...inputStyle, marginBottom: 10 }} />
          <button onClick={salvarReserva} disabled={salvandoRes} style={{ ...btnPrimary, width: "100%", opacity: salvandoRes ? 0.6 : 1 }}>
            {salvandoRes ? <Loader2 size={16} /> : <Check size={16} />} Salvar reserva
          </button>
        </Modal>
      )}

      {/* modal: detalhe de um pedido */}
      {detalhe && detalhe.tipo === "pedido" && (() => {
        const p = detalhe.ref;
        return (
          <Modal C={C} titulo={`Pedido #${detalhe.cod} · ${p.clienteNome}`} onClose={() => setDetalheKey(null)} largura={520}>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: C.textSoft, marginBottom: 10 }}>
              <div>Origem: <b style={{ color: C.text }}>{detalhe.origem === "balcao" ? "Balcão" : "Site"}</b> · Aberto em {fmtAbertura(p.createdAt)}</div>
              <div>{detalhe.entrega}{detalhe.entregaSub ? `: ${detalhe.entregaSub}` : ""}</div>
              {p.clienteTelefone && <div>Telefone: {p.clienteTelefone}</div>}
              <div>Pagamento: {p.formaPagamento}{p.precisaTroco && p.trocoPara != null ? ` (troco para ${fmt(p.trocoPara)})` : ""}</div>
              {p.observacao && <div>Obs.: {p.observacao}</div>}
              {p.motivoCancelamento && <div style={{ color: C.red }}>Motivo: {p.motivoCancelamento}</div>}
            </div>
            {(p.itens || []).map((it, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "4px 0" }}>
                <span>{it.qtd}x {it.nome}</span><span>{fmt((it.preco || 0) * (it.qtd || 0))}</span>
              </div>
            ))}
            {p.taxaEntrega > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.textSoft }}><span>Taxa de entrega</span><span>{fmt(p.taxaEntrega)}</span></div>}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 800, margin: "10px 0 14px" }}>
              <span>Total</span><span style={{ color: C.orangeText }}>{fmt(p.total)}</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {p.status === "pendente" && <button onClick={() => acaoPedido(p, "aceito")} style={btnPrimary}><Check size={15} /> Aceitar</button>}
              {p.status === "pendente" && <button onClick={() => acaoPedido(p, "recusado")} style={btnOutline}><X size={15} /> Recusar</button>}
              {(p.status === "aceito" || p.status === "preparando") && <button onClick={() => acaoPedido(p, "pronto")} style={btnPrimary}><Check size={15} /> Pronto</button>}
              {(p.status === "aceito" || p.status === "preparando" || p.status === "pronto") && <button onClick={() => acaoPedido(p, "concluido")} style={p.status === "pronto" ? btnPrimary : btnOutline}><Check size={15} /> Concluir</button>}
              {(p.status === "aceito" || p.status === "preparando" || p.status === "pronto") && <button onClick={() => acaoPedido(p, "cancelado")} style={btnOutline}><X size={15} /> Cancelar</button>}
            </div>
          </Modal>
        );
      })()}

      {/* modal: detalhe de uma reserva */}
      {detalhe && detalhe.tipo === "reserva" && (() => {
        const r = detalhe.ref;
        const falta = arred((r.total || 0) - (r.sinal_pago || 0));
        const aberta = r.status === "pendente" || r.status === "confirmada";
        const msg = `Olá, ${String(r.cliente_nome).split(/\s+/)[0]}! Sua encomenda no Divino Frango para ${new Date(r.data_retirada + "T00:00").toLocaleDateString("pt-BR")}${r.hora_retirada ? ` às ${r.hora_retirada}` : ""} está confirmada ✅`;
        const wa = linkWhatsApp(r.cliente_telefone, msg);
        return (
          <Modal C={C} titulo={`Reserva · ${r.cliente_nome}`} onClose={() => setDetalheKey(null)} largura={520}>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: C.textSoft, marginBottom: 10 }}>
              <div>Retirada: <b style={{ color: C.text }}>{new Date(r.data_retirada + "T00:00").toLocaleDateString("pt-BR")} {r.hora_retirada ? `às ${r.hora_retirada}` : "(sem hora)"}</b></div>
              {r.cliente_telefone && <div>Telefone: {r.cliente_telefone}</div>}
              {r.observacao && <div>Obs.: {r.observacao}</div>}
            </div>
            <div style={{ fontSize: 14, whiteSpace: "pre-wrap", marginBottom: 10 }}>{r.descricao}</div>
            {(r.total > 0 || r.sinal_pago > 0) && (
              <div style={{ fontSize: 13, color: C.textSoft, marginBottom: 12 }}>
                Total {fmt(r.total)} · Sinal {fmt(r.sinal_pago)} · <b style={{ color: falta > 0 ? C.orangeText : C.green }}>Falta {fmt(Math.max(falta, 0))}</b>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {r.status === "pendente" && <button onClick={() => mudarStatusReserva(r.id, "confirmada")} style={btnOutline}><Check size={15} /> Confirmar</button>}
              {aberta && <button onClick={() => mudarStatusReserva(r.id, "retirada")} style={btnPrimary}><Check size={15} /> Retirada</button>}
              {aberta && <button onClick={() => mudarStatusReserva(r.id, "cancelada")} style={btnOutline}><X size={15} /> Cancelar</button>}
              {!aberta && <button onClick={() => mudarStatusReserva(r.id, "pendente")} style={btnOutline}>Reabrir</button>}
              {wa && <a href={wa} target="_blank" rel="noreferrer" style={{ ...btnOutline, textDecoration: "none" }}><Phone size={15} /> WhatsApp</a>}
              <button onClick={() => excluirReserva(r.id)} style={iconBtnStyle} aria-label="Excluir reserva"><Trash2 size={17} color={C.red} /></button>
            </div>
          </Modal>
        );
      })()}
    </>
  );
}
