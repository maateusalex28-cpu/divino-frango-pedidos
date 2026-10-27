import React, { useState, useEffect, useMemo } from "react";
import { Plus, Minus, Check, X, Search, Phone, Loader2, Flag, Printer, Pencil, ChevronLeft } from "lucide-react";

const FORMAS = ["Dinheiro", "Pix", "Cartão"];

const paraNumero = (v) => {
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const n = parseFloat(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : 0;
};
const arred = (n) => Math.round(n * 100) / 100;
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const soDigitos = (v) => String(v || "").replace(/\D/g, "");
const agoraISO = () => new Date().toISOString();

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

const grupoPedido = (s) => (s === "concluido" ? "finalizado" : s === "cancelado" || s === "recusado" ? "cancelado" : "andamento");

const rotuloPedido = (p) => {
  if (p.status === "pronto") return p.tipoEntrega === "entrega" ? "Saiu para entrega" : "Aguardando retirada";
  return { pendente: "Novo", aceito: "Aceito", preparando: "Em preparo", concluido: "Finalizado", cancelado: "Cancelado", recusado: "Recusado" }[p.status] || p.status;
};

// etapas mostradas no detalhe: pedido do site passa por Novo e Aceito; pedido do balcão já nasce em andamento
const etapasDoPedido = (p) => {
  const entrega = p.tipoEntrega === "entrega";
  const ultima = ["pronto", entrega ? "Saiu para entrega" : "Aguardando retirada"];
  const fim = ["concluido", "Finalizado"];
  if ((p.origem || "site") === "balcao") return entrega ? [["preparando", "Em preparo"], ultima, fim] : [ultima, fim];
  return [["pendente", "Novo"], ["aceito", "Aceito"], ["preparando", "Em preparo"], ultima, fim];
};

// traduz o erro do banco em uma frase que diz o motivo
const descreverErroBanco = (error) => {
  const msg = (error && error.message) || "erro desconhecido";
  const det = [error && error.details, error && error.hint].filter(Boolean).join(" ");
  const cod = error && error.code ? ` (código ${error.code})` : "";
  if (error && error.code === "23502") {
    const col = (msg.match(/column "([^"]+)"/) || [])[1];
    return `O banco exige o campo "${col || "?"}", que não foi preenchido${cod}.`;
  }
  if ((error && (error.code === "PGRST204" || error.code === "42703")) || /schema cache|does not exist/i.test(msg)) {
    const col = (msg.match(/'([^']+)' column/) || msg.match(/column "?([a-z_]+)"?/i) || [])[1];
    return `O banco ainda não tem a coluna "${col || "?"}". Rode o arquivo supabase/migracao-balcao-reservas.sql no Supabase${cod}.`;
  }
  if ((error && error.code === "42501") || /row-level security|permission denied/i.test(msg)) {
    return `Sem permissão para gravar. Saia e entre de novo no painel${cod}.`;
  }
  if (error && error.code === "23514") return `O banco não aceitou um dos valores (regra de validação): ${det || msg}${cod}`;
  if (error && error.code === "P0001") return `O sistema recusou o pedido: ${msg}`;
  if (/failed to fetch|networkerror|network request/i.test(msg)) return "Sem conexão com a internet ou com o Supabase. Tente de novo.";
  return `${msg}${det ? ` — ${det}` : ""}${cod}`;
};

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
  showToast, dataLocalISO, cardapio, pedidos, codigoPedido, onPedidoCriado, onPedidoAtualizado, atualizarStatusPedido,
  bairrosEntrega, taxaPadrao, funcionarios, imprimirPedido, abrirWhatsAppPedido, destaqueId,
}) {
  const hoje = dataLocalISO();
  const [dia, setDia] = useState(hoje);
  const [pesquisa, setPesquisa] = useState("");
  const [filtroOrigem, setFiltroOrigem] = useState("todos"); // todos | site | balcao
  const [filtroStatus, setFiltroStatus] = useState("todos"); // todos | andamento | finalizado | cancelado
  const [agora, setAgora] = useState(Date.now());
  const [modal, setModal] = useState(null); // "pedido" | null
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

  // ---------------- Linhas da tabela ----------------
  const linhas = useMemo(() => {
    const doDia = (pedidos || []).filter((p) => (p.dataPedido || (p.createdAt ? dataLocalISO(new Date(p.createdAt)) : "")) === dia);
    const lista = doDia.map((p) => {
      const grupo = grupoPedido(p.status);
      const fim = p.concluidoEm || p.canceladoEm || null;
      const diaAbertura = p.createdAt ? dataLocalISO(new Date(p.createdAt)) : "";
      return {
        key: `p${p.id}`, ref: p, cod: codigoPedido(p), abertura: p.createdAt,
        duracao: grupo === "andamento" ? agora - new Date(p.createdAt).getTime() : fim ? new Date(fim).getTime() - new Date(p.createdAt).getTime() : null,
        andamento: grupo === "andamento",
        cliente: p.clienteNome, origem: p.origem || "site", grupo, statusTxt: rotuloPedido(p),
        ehEntrega: p.tipoEntrega === "entrega", entregador: p.entregador || "",
        entrega: p.tipoEntrega === "entrega" ? "Entregar no endereço" : "Retirar no local",
        entregaSub: p.tipoEntrega === "entrega" ? [p.endereco, p.bairro].filter(Boolean).join(" - ") : "",
        pagamento: p.formaPagamento || "", total: p.total || 0,
        agendado: p.dataPedido && diaAbertura && p.dataPedido !== diaAbertura ? new Date(p.dataPedido + "T00:00").toLocaleDateString("pt-BR") : "",
      };
    });
    const termo = semAcento(pesquisa);
    return lista
      .filter((l) => filtroOrigem === "todos" || l.origem === filtroOrigem)
      .filter((l) => filtroStatus === "todos" || l.grupo === filtroStatus)
      .filter((l) => !termo || semAcento(`${l.cod} ${l.cliente} ${l.entregaSub}`).includes(termo))
      .sort((a, b) => String(b.abertura).localeCompare(String(a.abertura)));
  }, [pedidos, dia, filtroOrigem, filtroStatus, pesquisa, agora, codigoPedido, dataLocalISO]);

  const validos = linhas.filter((l) => l.grupo !== "cancelado");
  const somaTotal = arred(validos.reduce((s, l) => s + l.total, 0));
  const pedidoDet = (pedidos || []).find((x) => `p${x.id}` === detalheKey) || null;

  // pedido aceito na aba Pedidos: abre aqui no dia dele e fica destacado
  useEffect(() => {
    if (!destaqueId) return;
    const ped = (pedidos || []).find((x) => x.id === destaqueId);
    if (!ped) return;
    setDia(ped.dataPedido || (ped.createdAt ? dataLocalISO(new Date(ped.createdAt)) : hoje));
    setFiltroOrigem("todos");
    setFiltroStatus("todos");
    setPesquisa("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destaqueId]);

  // ---------------- Formulário do pedido (novo ou edição) ----------------
  const [editandoId, setEditandoId] = useState(null);
  const [erroPedido, setErroPedido] = useState("");
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
  const [statusRetirada, setStatusRetirada] = useState("aguardando"); // aguardando | finalizado
  const [imprimirAoLancar, setImprimirAoLancar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [contatos, setContatos] = useState([]);
  const [mostrarSug, setMostrarSug] = useState(false);
  const [entregadorNovo, setEntregadorNovo] = useState("");
  const [entregadorTxt, setEntregadorTxt] = useState("");

  const nomesEntregadores = useMemo(() => {
    const todos = (funcionarios || []).filter((f) => f.nome);
    const motos = todos.filter((f) => /entreg|moto/i.test(f.funcao || ""));
    return (motos.length ? motos : todos).map((f) => f.nome);
  }, [funcionarios]);

  // ao abrir um pedido, carrega o entregador atual no campo
  useEffect(() => {
    const ped = (pedidos || []).find((x) => `p${x.id}` === detalheKey);
    setEntregadorTxt((ped && ped.entregador) || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detalheKey]);

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
        setTaxaManual(false); // a taxa é recalculada pelo bairro
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

  // taxa pelo bairro cadastrado (nome igual ou parecido); se não houver, usa a taxa padrão. Dá para editar na mão.
  const bairroCadastrado = useMemo(() => {
    const alvo = semAcento(bairro).trim();
    if (!alvo) return null;
    const lista = (bairrosEntrega || []).filter((x) => x.ativo !== false);
    return (
      lista.find((x) => semAcento(x.nome).trim() === alvo) ||
      lista.find((x) => { const n = semAcento(x.nome).trim(); return n && (n.includes(alvo) || alvo.includes(n)); }) ||
      null
    );
  }, [bairrosEntrega, bairro]);
  const taxaSugerida = bairroCadastrado ? Number(bairroCadastrado.taxa) || 0 : Number(taxaPadrao) || 0;
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

  const limparPedido = () => {
    setEditandoId(null); setErroPedido(""); setBusca("");
    setCarrinho([]); setNome(""); setTelefone(""); setCep(""); setRua(""); setNumeroEnd(""); setCompl("");
    setBairro(""); setReferencia(""); setTaxaTxt(""); setTaxaManual(false); setTrocoPara(""); setObs("");
    setForma("Dinheiro"); setTipo("retirada"); setStatusRetirada("aguardando"); setEntregadorNovo("");
  };
  const abrirNovo = () => { limparPedido(); setModal("pedido"); };

  const abrirEdicao = (p) => {
    limparPedido();
    setEditandoId(p.id);
    setTipo(p.tipoEntrega === "entrega" ? "entrega" : "retirada");
    setNome(p.clienteNome === "Balcão" ? "" : p.clienteNome || "");
    setTelefone(p.clienteTelefone || "");
    setCep(p.cep || ""); setRua(p.endereco || ""); setBairro(p.bairro || ""); setReferencia(p.referencia || "");
    setTaxaManual(true); setTaxaTxt(String(p.taxaEntrega || 0).replace(".", ","));
    setForma(p.formaPagamento || "Dinheiro");
    setTrocoPara(p.precisaTroco && p.trocoPara != null ? String(p.trocoPara).replace(".", ",") : "");
    setObs(p.observacao || "");
    setEntregadorNovo(p.entregador || "");
    setCarrinho((p.itens || []).map((it, i) => ({
      id: it.id != null ? it.id : `sem-id-${i}`, semId: it.id == null,
      nome: it.nome, preco: Number(it.preco) || 0, qtd: Number(it.qtd) || 1,
    })));
    setModal("pedido");
  };

  useEffect(() => {
    const h = (e) => {
      if (e.key === "F2") { e.preventDefault(); abrirNovo(); }
      if (e.key === "Escape") { if (modal) setModal(null); else setDetalheKey(null); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal]);

  const validarPedido = () => {
    const falta = [];
    if (!carrinho.length) falta.push("Adicione pelo menos um item ao pedido.");
    if (tipo === "entrega") {
      if (!nome.trim()) falta.push("Informe o nome do cliente.");
      if (!rua.trim()) falta.push("Informe o endereço de entrega (rua).");
      if (!bairro.trim()) falta.push("Informe o bairro (ele define a taxa de entrega).");
    }
    if (cep && soDigitos(cep).length !== 8) falta.push("CEP incompleto: são 8 números.");
    if (telefone.trim() && soDigitos(telefone).length < 10) falta.push("Telefone incompleto: use DDD + número, ou deixe em branco.");
    if (taxaManual && tipo === "entrega" && taxaTxt.trim() && paraNumero(taxaTxt) < 0) falta.push("A taxa de entrega não pode ser negativa.");
    if (forma === "Dinheiro" && paraNumero(trocoPara) > 0 && paraNumero(trocoPara) < totalPedido) {
      falta.push(`O troco é para ${fmt(paraNumero(trocoPara))}, menos que o total de ${fmt(totalPedido)}.`);
    }
    return falta;
  };

  const lancarPedido = async () => {
    const falta = validarPedido();
    if (falta.length) {
      setErroPedido(`Não foi possível ${editandoId ? "salvar" : "lançar"} o pedido:\n• ${falta.join("\n• ")}`);
      return;
    }
    setErroPedido("");
    setSalvando(true);

    const original = editandoId ? (pedidos || []).find((x) => x.id === editandoId) : null;
    const enderecoCompleto = `${[rua.trim(), numeroEnd.trim()].filter(Boolean).join(", ")}${compl.trim() ? ` - ${compl.trim()}` : ""}`;
    const valorTroco = paraNumero(trocoPara);
    const comTroco = forma === "Dinheiro" && valorTroco > 0;
    const campos = {
      cliente_nome: nome.trim() || "Balcão",
      cliente_telefone: telefone.trim(),
      tipo_entrega: tipo,
      forma_pagamento: forma,
      precisa_troco: comTroco,
      troco_para: comTroco ? valorTroco : null,
      itens: carrinho.map((x) => ({ ...(x.semId ? {} : { id: x.id }), nome: x.nome, qtd: x.qtd, preco: x.preco })),
      subtotal: subtotalCarrinho,
      taxa_entrega: arred(taxa),
      total: totalPedido,
      observacao: obs.trim() || null,
    };
    if (tipo === "entrega") {
      Object.assign(campos, { cep: cep || null, endereco: enderecoCompleto, bairro: bairro.trim() || null, referencia: referencia.trim() || null });
      if (entregadorNovo.trim()) campos.entregador = entregadorNovo.trim();
      else if (original && original.entregador) campos.entregador = null;
    } else if (original) {
      Object.assign(campos, { cep: null, endereco: null, bairro: null, referencia: null });
    }

    let resposta;
    if (editandoId) {
      resposta = await supabase.from("pedidos").update(campos).eq("id", editandoId).select().single();
    } else {
      const agoraTxt = agoraISO();
      let extras;
      if (tipo === "entrega") extras = { status: "preparando" }; // entra em preparo; depois "Saiu para entrega" e "Finalizado"
      else if (statusRetirada === "finalizado") extras = { status: "concluido", concluido_em: agoraTxt };
      else extras = { status: "pronto", pronto_em: agoraTxt }; // aguardando retirada
      resposta = await supabase.from("pedidos").insert({ ...campos, ...extras, origem: "balcao", data_pedido: hoje }).select().single();
    }
    setSalvando(false);
    const { data, error } = resposta;
    if (error) {
      console.error(error);
      setErroPedido(`Não foi possível ${editandoId ? "salvar" : "lançar"} o pedido:\n• ${descreverErroBanco(error)}`);
      return;
    }

    if (editandoId) {
      if (onPedidoAtualizado) onPedidoAtualizado(data);
      showToast("Pedido atualizado");
    } else {
      const mapeado = onPedidoCriado ? onPedidoCriado(data) : null;
      showToast(`Pedido #${data.numero ?? data.numero_pedido ?? String(data.id).slice(0, 4).toUpperCase()} lançado`);
      if (imprimirAoLancar && mapeado && imprimirPedido) imprimirPedido(mapeado);
      setDia(hoje);
    }
    limparPedido();
    setModal(null);
  };

  // ---------------- Ações no detalhe do pedido ----------------
  const acaoPedido = async (p, proximo) => {
    let extra = {};
    if (proximo === "pronto") extra = { pronto_em: agoraISO() };
    if (proximo === "concluido") extra = { concluido_em: agoraISO() };
    if (proximo === "cancelado" || proximo === "recusado") {
      const motivo = window.prompt(proximo === "recusado" ? "Motivo da recusa (opcional):" : "Motivo do cancelamento (opcional):");
      if (motivo === null) return;
      extra = { cancelado_em: agoraISO(), motivo_cancelamento: motivo.trim() || null };
    }
    const mensagem = proximo === "pronto" ? (p.tipoEntrega === "entrega" ? "Pedido saiu para entrega" : "Pedido aguardando retirada") : undefined;
    const ok = await atualizarStatusPedido(p.id, proximo, extra, mensagem);
    if (ok && ["concluido", "cancelado", "recusado"].includes(proximo)) setDetalheKey(null);
  };

  const salvarEntregador = async (p) => {
    const novo = entregadorTxt.trim();
    if (novo === (p.entregador || "")) return;
    const { data, error } = await supabase.from("pedidos").update({ entregador: novo || null }).eq("id", p.id).select().single();
    if (error) {
      console.error(error);
      showToast(`Erro ao salvar entregador: ${descreverErroBanco(error)}`);
      return;
    }
    if (onPedidoAtualizado) onPedidoAtualizado(data);
    showToast(novo ? `Entregador: ${novo}` : "Entregador removido");
  };

  const th = { textAlign: "left", padding: "9px 10px", fontSize: 11.5, fontWeight: 800, color: C.textSoft, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
  const td = { padding: "10px 10px", fontSize: 13, borderBottom: `1px solid ${C.borderSoft}`, verticalAlign: "top" };

  // ---------------- Tela ----------------
  return (
    <>
      <datalist id="entregadores-balcao">
        {nomesEntregadores.map((n) => (<option key={n} value={n} />))}
      </datalist>

      <button onClick={abrirNovo} style={{ ...btnPrimary, width: "100%", marginBottom: 10 }}><Plus size={16} /> Novo pedido (F2)</button>

      <div style={{ position: "relative", marginBottom: 10 }}>
        <Search size={15} style={{ position: "absolute", left: 11, top: 13, color: C.textFaint }} />
        <input value={pesquisa} onChange={(e) => setPesquisa(e.target.value)} placeholder="Pesquisar por nº, cliente ou endereço" style={{ ...inputStyle, paddingLeft: 33 }} />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", overflowX: "auto", paddingBottom: 6, marginBottom: 6 }}>
        <input type="date" value={dia} onChange={(e) => setDia(e.target.value || hoje)} style={{ ...inputStyle, width: "auto", flexShrink: 0 }} />
        {[["todos", "Todos"], ["site", "Site"], ["balcao", "Balcão"]].map(([id, label]) => (
          <button key={id} onClick={() => setFiltroOrigem(id)} style={chip(filtroOrigem === id)}>{label}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, marginBottom: 10 }}>
        {[["todos", "Qualquer status"], ["andamento", "Em andamento"], ["finalizado", "Finalizados"], ["cancelado", "Cancelados"]].map(([id, label]) => (
          <button key={id} onClick={() => setFiltroStatus(id)} style={chip(filtroStatus === id)}>{label}</button>
        ))}
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 940, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Pedido</th>
              <th style={th}>Abertura</th>
              <th style={th}>Duração</th>
              <th style={th}>Cliente</th>
              <th style={th}>Origem</th>
              <th style={th}>Status</th>
              <th style={th}>Entrega</th>
              <th style={th}>Entregador</th>
              <th style={{ ...th, textAlign: "right" }}>Total</th>
              <th style={th}>Agendado para</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const cor = corStatus(l.grupo);
              return (
                <tr key={l.key} onClick={() => setDetalheKey(l.key)} style={{ cursor: "pointer", background: destaqueId && l.ref.id === destaqueId ? C.orangeSoft : "transparent" }}>
                  <td style={{ ...td, fontWeight: 800 }}>{l.cod}</td>
                  <td style={td}>{fmtAbertura(l.abertura)}</td>
                  <td style={{ ...td, fontWeight: 700, color: l.andamento && l.duracao > 3600000 ? C.red : C.text }}>{l.duracao == null ? "—" : fmtDuracao(l.duracao)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{l.cliente}</td>
                  <td style={td}>{l.origem === "balcao" ? "Balcão" : "Site"}</td>
                  <td style={td}>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 9px", borderRadius: 999, background: cor.bg, color: cor.fg, whiteSpace: "nowrap" }}>{l.statusTxt}</span>
                  </td>
                  <td style={td}>
                    <div style={{ fontWeight: 700 }}>{l.entrega}</div>
                    {l.entregaSub && <div style={{ fontSize: 11.5, color: C.textSoft, maxWidth: 220 }}>{l.entregaSub}</div>}
                  </td>
                  <td style={{ ...td, color: l.entregador ? C.text : C.textFaint }}>{l.ehEntrega ? l.entregador || "Selecione…" : ""}</td>
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
        <span>{validos.length} pedido{validos.length === 1 ? "" : "s"} (sem cancelados)</span>
        <span style={{ color: C.orangeText }}>{fmt(somaTotal)}</span>
      </div>

      {/* modal: novo pedido / editar pedido */}
      {modal === "pedido" && (
        <Modal C={C} titulo={editandoId ? "Editar pedido" : "Novo pedido"} onClose={() => setModal(null)} largura={720}>
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
          <input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="Telefone (opcional)" inputMode="tel" style={{ ...inputStyle, marginBottom: 12 }} />

          {tipo === "entrega" && (
            <>
              <FieldLabel>Endereço de entrega</FieldLabel>
              <div style={{ position: "relative", marginBottom: 8 }}>
                <input value={cep} onChange={(e) => onCep(e.target.value)} placeholder="CEP (preenche endereço, bairro e taxa)" inputMode="numeric" style={inputStyle} />
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
                style={{ ...inputStyle, marginBottom: 4 }}
              />
              <div style={{ fontSize: 11.5, color: bairroCadastrado ? C.green : C.textSoft, marginBottom: 8 }}>
                {taxaManual
                  ? "Taxa editada na mão."
                  : bairroCadastrado
                    ? `Bairro cadastrado: ${bairroCadastrado.nome} — taxa ${fmt(taxaSugerida)}.`
                    : bairro.trim()
                      ? `O bairro "${bairro.trim()}" não está nos bairros de entrega. Usando a taxa padrão (${fmt(taxaSugerida)}).`
                      : "Informe o CEP ou o bairro para calcular a taxa."}
              </div>
              <FieldLabel>Entregador (opcional)</FieldLabel>
              <input list="entregadores-balcao" value={entregadorNovo} onChange={(e) => setEntregadorNovo(e.target.value)} placeholder="Selecione ou digite o nome" style={{ ...inputStyle, marginBottom: 12 }} />
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

          {!editandoId && tipo === "retirada" && (
            <>
              <FieldLabel>Situação do pedido</FieldLabel>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <button onClick={() => setStatusRetirada("aguardando")} style={{ ...chip(statusRetirada === "aguardando"), flex: 1, padding: "10px 12px" }}>Aguardando retirada</button>
                <button onClick={() => setStatusRetirada("finalizado")} style={{ ...chip(statusRetirada === "finalizado"), flex: 1, padding: "10px 12px" }}>Finalizado</button>
              </div>
            </>
          )}
          {!editandoId && tipo === "entrega" && (
            <div style={{ fontSize: 12, color: C.textSoft, marginBottom: 12 }}>O pedido entra como <b>Em preparo</b>. Depois você marca "Saiu para entrega" e "Finalizado".</div>
          )}
          {!editandoId && imprimirPedido && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.textSoft, marginBottom: 12 }}>
              <input type="checkbox" checked={imprimirAoLancar} onChange={(e) => setImprimirAoLancar(e.target.checked)} />
              Imprimir comanda ao lançar
            </label>
          )}

          {erroPedido && (
            <div style={{ background: C.redSoft, border: `1px solid ${C.red}`, color: C.red, borderRadius: 10, padding: "10px 12px", fontSize: 13, whiteSpace: "pre-line", marginBottom: 12 }}>
              {erroPedido}
            </div>
          )}

          <button onClick={lancarPedido} disabled={salvando} style={{ ...btnPrimary, width: "100%", opacity: salvando ? 0.6 : 1 }}>
            {salvando ? <Loader2 size={16} /> : <Check size={16} />} {editandoId ? "Salvar alterações" : "Lançar pedido"}
          </button>
        </Modal>
      )}

      {/* modal: detalhe do pedido */}
      {pedidoDet && (() => {
        const p = pedidoDet;
        const ehEntrega = p.tipoEntrega === "entrega";
        const etapas = etapasDoPedido(p);
        const idxAtual = etapas.findIndex(([k]) => k === p.status);
        const encerrado = p.status === "cancelado" || p.status === "recusado";
        const origem = p.origem || "site";
        const telOk = soDigitos(p.clienteTelefone).length >= 10;
        const tipoAviso = p.status === "pronto" ? (ehEntrega ? "saiu" : "retirada") : (p.status === "aceito" || p.status === "preparando") ? "confirmado" : null;
        const rotuloAviso = tipoAviso === "confirmado" ? "Confirmação no WhatsApp" : tipoAviso === "saiu" ? "Avisar que saiu" : "Avisar que está pronto";
        const podeCancelar = p.status === "aceito" || p.status === "preparando" || p.status === "pronto";
        return (
          <Modal C={C} titulo={`Pedido #${codigoPedido(p)} · ${p.clienteNome}`} onClose={() => setDetalheKey(null)} largura={520}>
            {encerrado ? (
              <div style={{ color: C.red, fontWeight: 800, fontSize: 13, marginBottom: 12 }}>{rotuloPedido(p)}</div>
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 4, marginBottom: 14 }}>
                {etapas.map(([k, label], i) => {
                  const feito = i <= idxAtual;
                  const atual = i === idxAtual;
                  const cor = feito ? (atual ? C.orange : C.green) : C.textFaint;
                  return (
                    <div key={k} style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
                      <Flag size={20} color={cor} fill={feito ? cor : "none"} />
                      <div style={{ fontSize: 10.5, marginTop: 3, fontWeight: atual ? 800 : 500, color: atual ? C.orangeText : feito ? C.text : C.textFaint, lineHeight: 1.2 }}>{label}</div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ fontSize: 13, lineHeight: 1.6, color: C.textSoft, marginBottom: 10 }}>
              <div>Origem: <b style={{ color: C.text }}>{origem === "balcao" ? "Balcão" : "Site"}</b> · Aberto em {fmtAbertura(p.createdAt)}</div>
              <div>{ehEntrega ? "Entregar no endereço" : "Retirar no local"}{ehEntrega ? `: ${[p.endereco, p.bairro].filter(Boolean).join(" - ")}` : ""}</div>
              {p.referencia && <div>Referência: {p.referencia}</div>}
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

            {ehEntrega && (
              <div style={{ marginBottom: 12 }}>
                <FieldLabel>Entregador</FieldLabel>
                <input
                  list="entregadores-balcao"
                  value={entregadorTxt}
                  onChange={(e) => setEntregadorTxt(e.target.value)}
                  onBlur={() => salvarEntregador(p)}
                  placeholder="Selecione ou digite o nome"
                  style={inputStyle}
                />
              </div>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              {p.status === "pendente" && <button onClick={() => acaoPedido(p, "aceito")} style={btnPrimary}><Check size={15} /> Aceitar</button>}
              {p.status === "aceito" && <button onClick={() => acaoPedido(p, "preparando")} style={btnPrimary}><Check size={15} /> Iniciar preparo</button>}
              {p.status === "preparando" && <button onClick={() => acaoPedido(p, "pronto")} style={btnPrimary}><Check size={15} /> {ehEntrega ? "Saiu para entrega" : "Aguardando retirada"}</button>}
              {p.status === "pronto" && <button onClick={() => acaoPedido(p, "concluido")} style={btnPrimary}><Check size={15} /> Finalizar pedido</button>}
              <button onClick={() => setDetalheKey(null)} style={btnOutline}><ChevronLeft size={15} /> Voltar</button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!encerrado && <button onClick={() => abrirEdicao(p)} style={btnOutline}><Pencil size={15} /> Editar pedido</button>}
              {imprimirPedido && <button onClick={() => imprimirPedido(p)} style={btnOutline}><Printer size={15} /> Imprimir comanda</button>}
              {tipoAviso && telOk && abrirWhatsAppPedido && (
                <button onClick={() => abrirWhatsAppPedido(p, tipoAviso)} style={btnOutline}><Phone size={15} /> {rotuloAviso}</button>
              )}
            </div>

            {(p.status === "pendente" || podeCancelar) && (
              <div style={{ borderTop: `1px solid ${C.borderSoft}`, marginTop: 14, paddingTop: 12, display: "flex", justifyContent: "flex-end" }}>
                {p.status === "pendente" ? (
                  <button onClick={() => acaoPedido(p, "recusado")} style={{ ...btnOutline, color: C.red, borderColor: C.red, padding: "8px 12px", fontSize: 13 }}><X size={14} /> Recusar pedido</button>
                ) : (
                  <button onClick={() => acaoPedido(p, "cancelado")} style={{ ...btnOutline, color: C.red, borderColor: C.red, padding: "8px 12px", fontSize: 13 }}><X size={14} /> Cancelar pedido</button>
                )}
              </div>
            )}
          </Modal>
        );
      })()}
    </>
  );
}
