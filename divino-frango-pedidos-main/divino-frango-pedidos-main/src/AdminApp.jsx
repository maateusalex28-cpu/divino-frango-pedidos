import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  ClipboardList, UtensilsCrossed, Check, X, Trash2, Pencil, Loader2, Image as ImageIcon,
  Phone, Store, Bike, MapPin, Printer, Settings, Banknote, Clock, Wallet, ArrowDownCircle, ArrowUpCircle, Lock,
  LogOut, BarChart3, TrendingUp, TrendingDown, Package, Tag, Eye, EyeOff, Users, Briefcase,
  Camera, Search, Ban, Plus, Contact, Download,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar } from "recharts";
import { supabase } from "./supabaseClient";
import { LOGO_URL } from "./logo";
import Financeiro from "./Financeiro";

const fmt = (n) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const uid = () => Math.random().toString(36).slice(2, 10);

// bucket privado (criado na migração) onde ficam as fotos das notas fiscais das compras
const NOTAS_BUCKET = "notas-fiscais";
const UNIDADES_COMPRA = [{ id: "un", label: "Unidade" }, { id: "kg", label: "Kg" }];

// data de hoje no fuso do aparelho (YYYY-MM-DD). Não usar toISOString() aqui: ele devolve UTC
// e, à noite no Brasil, já viraria o dia seguinte.
const dataLocalISO = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const fmtData = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "");
const fmtHora = (iso) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "");
const fmtDataHora = (iso) => (iso ? `${fmtData(iso)} às ${fmtHora(iso)}` : "");
// coluna do tipo date (sem hora) → dd/mm/aaaa
const fmtDataSimples = (yyyyMMdd) => (yyyyMMdd ? new Date(`${yyyyMMdd}T00:00`).toLocaleDateString("pt-BR") : "");
const fmtQtd = (n) => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const rotuloUnidade = (u) => (/^k/i.test(String(u || "")) ? "kg" : "un");

// prepara a foto do cupom para leitura por IA: largura 1000px e, se a foto for comprida, divide em
// partes de ~1150px de altura com pequena sobreposição (a IA reduz imagens grandes e o texto miúdo
// do cupom perderia a leitura). Devolve de 1 a 8 imagens JPEG em base64 (sem o prefixo data:).
const prepararImagensCupom = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const LARG = 1000, ALT = 1150, SOBRA = 120, MAX_PARTES = 8;
        let escala = Math.min(1, LARG / img.naturalWidth);
        const limiteAltura = ALT + (ALT - SOBRA) * (MAX_PARTES - 1);
        if (img.naturalHeight * escala > limiteAltura) escala = limiteAltura / img.naturalHeight;
        const w = Math.max(1, Math.round(img.naturalWidth * escala));
        const h = Math.max(1, Math.round(img.naturalHeight * escala));
        const inteira = document.createElement("canvas");
        inteira.width = w;
        inteira.height = h;
        inteira.getContext("2d").drawImage(img, 0, 0, w, h);
        const partes = [];
        for (let y = 0; y < h; y += ALT - SOBRA) {
          const altura = Math.min(ALT, h - y);
          const c = document.createElement("canvas");
          c.width = w;
          c.height = altura;
          c.getContext("2d").drawImage(inteira, 0, y, w, altura, 0, 0, w, altura);
          partes.push(c.toDataURL("image/jpeg", 0.85).split(",")[1]);
          if (y + altura >= h) break;
        }
        URL.revokeObjectURL(url);
        resolve(partes);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("foto ilegível")); };
    img.src = url;
  });

// preço por kg (ou por unidade) de um item de compra. Usa o valor do próprio item quando foi informado;
// numa compra com um só produto, usa o valor total da compra.
const precoPorUnidade = (compra, it, totalItens) => {
  const q = Number(it.quantidade ?? it.qtd ?? 0);
  const v = it.valor != null && it.valor !== "" ? Number(it.valor) : totalItens === 1 ? Number(compra.valor) : null;
  return v != null && q > 0 && v > 0 ? v / q : null;
};

// reduz a foto (lado maior 2600px, JPEG) antes de enviar: foto de câmera costuma ter vários MB.
// O cupom fiscal é longo e estreito, por isso o limite é alto: com menos, o texto miúdo perde a leitura.
const reduzirFoto = (file, maxLado = 2600, qualidade = 0.85) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const escala = Math.min(1, maxLado / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * escala));
        const h = Math.max(1, Math.round(img.naturalHeight * escala));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (!blob) { reject(new Error("não foi possível reduzir a foto")); return; }
          const nome = ((file.name || "nota").replace(/\.[^.]+$/, "") || "nota") + ".jpg";
          resolve(new File([blob], nome, { type: "image/jpeg" }));
        }, "image/jpeg", qualidade);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("foto ilegível")); };
    img.src = url;
  });

// A tabela de pedidos identifica cada pedido por um UUID. Se existir uma coluna de número
// sequencial, ela é usada; senão mostramos um código curto e estável tirado do UUID.
const codigoPedido = (p) => (p.numero != null && p.numero !== "" ? String(p.numero) : String(p.id || "").replace(/-/g, "").slice(0, 4).toUpperCase());

// pedido em andamento: ainda precisa de ação da loja. Pedido de ENTREGA que já saiu (status "pronto")
// vai para o histórico; retirada "pronta" continua ativa até o cliente buscar.
const pedidoEstaAtivo = (p) =>
  ["pendente", "aceito", "preparando"].includes(p.status) || (p.status === "pronto" && p.tipoEntrega !== "entrega");

const rotuloStatusPedido = (p) => {
  if (p.status === "pronto") return p.tipoEntrega === "entrega" ? "Saiu para entrega" : "Pronto para retirada";
  return { pendente: "Novo", aceito: "Aceito", preparando: "Em preparo", concluido: "Concluído", recusado: "Recusado", cancelado: "Cancelado" }[p.status] || p.status;
};

const FILTROS_HISTORICO = [
  { id: "todos", label: "Todos" },
  { id: "saiu", label: "Saiu p/ entrega" },
  { id: "concluido", label: "Concluídos" },
  { id: "cancelado", label: "Cancelados" },
  { id: "recusado", label: "Recusados" },
];

const parseItensJson = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const j = JSON.parse(v);
      return Array.isArray(j) ? j : [];
    } catch (e) {
      return [];
    }
  }
  return [];
};

const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const DIAS_SEMANA_CURTO = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const CATEGORIAS_CARDAPIO = ["Assados", "Acompanhamentos", "Combos", "Bebidas"];

const horariosPadrao = () => ({
  0: { aberto: true, abre: "08:00", fecha: "14:00", entregaAbre: "11:00", entregaFecha: "14:00" },
  1: { aberto: false, abre: "08:00", fecha: "14:00", entregaAbre: "11:00", entregaFecha: "14:00" },
  2: { aberto: false, abre: "08:00", fecha: "14:00", entregaAbre: "11:00", entregaFecha: "14:00" },
  3: { aberto: false, abre: "08:00", fecha: "14:00", entregaAbre: "11:00", entregaFecha: "14:00" },
  4: { aberto: false, abre: "08:00", fecha: "14:00", entregaAbre: "11:00", entregaFecha: "14:00" },
  5: { aberto: false, abre: "08:00", fecha: "14:00", entregaAbre: "11:00", entregaFecha: "14:00" },
  6: { aberto: true, abre: "08:00", fecha: "14:00", entregaAbre: "11:00", entregaFecha: "14:00" },
});

const C = {
  bg: "#0E0E10",
  card: "#19191C",
  cardAlt: "#201F23",
  border: "#2C2B30",
  borderSoft: "#242327",
  text: "#F5F5F7",
  textSoft: "#A4A3AA",
  textFaint: "#6E6D74",
  orange: "#F5940A",
  orangeSoft: "rgba(245,148,10,0.14)",
  orangeText: "#FFB648",
  green: "#34D399",
  greenSoft: "rgba(52,211,153,0.14)",
  red: "#F87171",
  redSoft: "rgba(248,113,113,0.14)",
  shadow: "0 2px 10px rgba(0,0,0,0.35)",
};

const mapPedidoFromDb = (r) => ({
  id: r.id,
  clienteNome: r.cliente_nome,
  clienteTelefone: r.cliente_telefone,
  tipoEntrega: r.tipo_entrega,
  cep: r.cep || undefined,
  endereco: r.endereco || undefined,
  bairro: r.bairro || undefined,
  referencia: r.referencia || undefined,
  formaPagamento: r.forma_pagamento,
  precisaTroco: !!r.precisa_troco,
  trocoPara: r.troco_para != null ? Number(r.troco_para) : undefined,
  itens: r.itens || [],
  subtotal: r.subtotal != null ? Number(r.subtotal) : undefined,
  taxaEntrega: r.taxa_entrega != null ? Number(r.taxa_entrega) : 0,
  total: Number(r.total),
  observacao: r.observacao || undefined,
  status: r.status,
  createdAt: r.created_at,
  dataPedido: r.data_pedido || undefined,
  prontoEm: r.pronto_em || undefined,
  concluidoEm: r.concluido_em || undefined,
  canceladoEm: r.cancelado_em || undefined,
  motivoCancelamento: r.motivo_cancelamento || undefined,
  numero: r.numero ?? r.numero_pedido ?? null,
});

// ---------- mensagens prontas para o WhatsApp do cliente ----------
// tipo: "confirmado" (ao aceitar) | "saiu" (saiu para entrega) | "retirada" (pronto para retirar)
const montarMensagemWhatsApp = (p, tipo, tempoEntrega) => {
  const nome = String(p.clienteNome || "").trim().split(/\s+/)[0] || "";
  const cod = codigoPedido(p);
  const itens = (p.itens || []).map((it) => `• ${it.qtd}x ${it.nome}`).join("\n");
  const ehEntrega = p.tipoEntrega === "entrega";
  const endereco = [p.endereco, p.bairro].filter(Boolean).join(" - ");
  const troco = p.formaPagamento === "Dinheiro" && p.precisaTroco && p.trocoPara != null ? `\n💵 *Troco para:* ${fmt(p.trocoPara)}` : "";
  const hoje = new Date().toISOString().slice(0, 10);
  const agendado = p.dataPedido && p.dataPedido > hoje
    ? new Date(p.dataPedido + "T00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })
    : null;

  if (tipo === "confirmado") {
    return [
      `Olá, ${nome}! 🍗🔥`,
      ``,
      `Seu pedido *#${cod}* no *Divino Frango* foi *confirmado* ✅`,
      ``,
      `🧾 *Seu pedido:*`,
      itens,
      ``,
      `💰 *Total:* ${fmt(p.total)}`,
      `💳 *Pagamento:* ${p.formaPagamento}${troco}`,
      ehEntrega ? `🛵 *Entrega em:* ${endereco}` : `🏪 *Retirada no balcão*`,
      agendado ? `📅 *Agendado para:* ${agendado}` : null,
      !agendado && ehEntrega && tempoEntrega ? `⏱️ *Previsão de entrega:* ${tempoEntrega}` : null,
      ``,
      agendado
        ? `Vamos preparar tudo fresquinho para o dia combinado. Qualquer dúvida, é só chamar aqui! 😉`
        : `Já estamos preparando tudo com muito carinho. Qualquer dúvida, é só chamar aqui! 😉`,
    ].filter((l) => l !== null).join("\n");
  }

  if (tipo === "saiu") {
    return [
      `Oba, ${nome}! 🛵💨`,
      ``,
      `Seu pedido *#${cod}* do *Divino Frango* acabou de *sair para entrega*!`,
      ``,
      `📍 *Endereço:* ${endereco}`,
      `💰 *Total:* ${fmt(p.total)} (${p.formaPagamento})${troco}`,
      ``,
      `Fica de olho, que o frango está chegando quentinho! 🍗🔥`,
      `Bom apetite! 😋`,
    ].join("\n");
  }

  return [
    `${nome}, seu pedido está prontinho! 🎉`,
    ``,
    `O pedido *#${cod}* do *Divino Frango* já pode ser *retirado no balcão* 🏪`,
    ``,
    `💰 *Total:* ${fmt(p.total)} (${p.formaPagamento})${troco}`,
    ``,
    `Estamos te esperando, está quentinho! 🍗🔥`,
  ].join("\n");
};

const linkWhatsAppCliente = (p, tipo, tempoEntrega) => {
  let tel = String(p.clienteTelefone || "").replace(/\D/g, "");
  if (tel.length === 10 || tel.length === 11) tel = `55${tel}`;
  return `https://wa.me/${tel}?text=${encodeURIComponent(montarMensagemWhatsApp(p, tipo, tempoEntrega))}`;
};

const mapCardapioFromDb = (r) => ({
  id: r.id,
  nome: r.nome,
  descricao: r.descricao || "",
  preco: Number(r.preco),
  fotoUrl: r.foto_url || null,
  categoria: r.categoria || "",
  disponivel: r.disponivel,
  estoque: r.estoque != null ? Number(r.estoque) : null,
});

const mapCardapioInsert = (c) => ({
  nome: c.nome,
  descricao: c.descricao || null,
  preco: c.preco,
  foto_url: c.fotoUrl || null,
  categoria: c.categoria || null,
  disponivel: c.disponivel,
  estoque: c.estoque === "" || c.estoque == null ? null : Number(c.estoque),
});

const mapCaixaFromDb = (r) => ({
  id: r.id,
  abertoEm: r.aberto_em,
  fechadoEm: r.fechado_em || undefined,
  valorAbertura: Number(r.valor_abertura),
  valorFechamentoInformado: r.valor_fechamento_informado != null ? Number(r.valor_fechamento_informado) : undefined,
  status: r.status,
  observacao: r.observacao || undefined,
});

const mapMovFromDb = (r) => ({
  id: r.id,
  caixaId: r.caixa_id,
  tipo: r.tipo,
  valor: Number(r.valor),
  formaPagamento: r.forma_pagamento || undefined,
  descricao: r.descricao || undefined,
  createdAt: r.created_at,
  itens: parseItensJson(r.itens),
  dataCompra: r.data_compra || undefined,
  observacao: r.observacao || undefined,
  notaFotoPath: r.nota_foto_path || undefined,
});

const mapDiariaFromDb = (r) => ({
  id: r.id,
  funcionarioNome: r.funcionario_nome,
  valor: Number(r.valor),
  data: r.data,
});

const inputStyle = {
  width: "100%", padding: "11px 12px", borderRadius: 10, border: `1px solid ${C.border}`,
  background: C.cardAlt, color: C.text, fontSize: 14,
};
const btnPrimary = {
  background: C.orange, color: "#0E0E10", border: "none", borderRadius: 11, padding: "11px 14px",
  fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
};
const btnOutline = {
  background: "transparent", color: C.text, border: `1px solid ${C.border}`, borderRadius: 11, padding: "11px 14px",
  fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
};
const iconBtnStyle = { background: "none", border: "none", padding: 4, display: "flex", alignItems: "center", justifyContent: "center" };

function Card({ children, style }) {
  return <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, boxShadow: C.shadow, ...style }}>{children}</div>;
}
function EmptyState({ text }) {
  return <div style={{ textAlign: "center", padding: "28px 16px", color: C.textFaint, fontSize: 13, background: C.card, border: `1px dashed ${C.border}`, borderRadius: 14 }}>{text}</div>;
}
function FieldLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 600, color: C.textSoft, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3 }}>{children}</div>;
}
function MiniStat({ label, value }) {
  return (
    <div style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "10px 12px" }}>
      <div style={{ fontSize: 10.5, color: C.textSoft, fontWeight: 500, marginBottom: 4 }}>{label}</div>
      <div className="mono" style={{ fontSize: 14.5, fontWeight: 700, color: C.text }}>{value}</div>
    </div>
  );
}

export default function AdminApp() {
  const [loaded, setLoaded] = useState(false);
  const [pedidos, setPedidos] = useState([]);
  const [cardapio, setCardapio] = useState([]);
  const [cupons, setCupons] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [bairrosEntrega, setBairrosEntrega] = useState([]);
  const [diarias, setDiarias] = useState([]);
  const [tab, setTab] = useState("pedidos"); // pedidos | caixa | compras | equipe | relatorios | financeiro | cardapio | contatos | config
  const [toast, setToast] = useState(null);
  const [somAtivo, setSomAtivo] = useState(false);
  const audioCtxRef = useRef(null);
  const [aceitarAutomatico, setAceitarAutomatico] = useState(false);
  const aceitarAutomaticoRef = useRef(false);
  const [cupomAtivoSite, setCupomAtivoSite] = useState(true);
  // loja aberta/fechada, mensagem de loja fechada e tempo estimado de entrega (tabela configuracoes)
  const [lojaFechada, setLojaFechada] = useState(false);
  const [mensagemLojaFechada, setMensagemLojaFechada] = useState("");
  const [tempoEntregaMin, setTempoEntregaMin] = useState("40");
  const [tempoEntregaMax, setTempoEntregaMax] = useState("60");
  const [mostrarTempoEntrega, setMostrarTempoEntrega] = useState(false);
  const [salvandoLoja, setSalvandoLoja] = useState(false);
  // dentro da aba Pedidos: "ativos" | "historico"
  const [subPedidos, setSubPedidos] = useState("ativos");
  useEffect(() => {
    aceitarAutomaticoRef.current = aceitarAutomatico;
  }, [aceitarAutomatico]);

  // ---------- login ----------
  const [session, setSession] = useState(undefined); // undefined = verificando, null = deslogado, obj = logado
  const [loginEmail, setLoginEmail] = useState("");
  const [loginSenha, setLoginSenha] = useState("");
  const [loginErro, setLoginErro] = useState("");
  const [entrando, setEntrando] = useState(false);
  const [verSenha, setVerSenha] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => listener.subscription.unsubscribe();
  }, []);

  const entrar = async () => {
    if (!loginEmail.trim() || !loginSenha) {
      setLoginErro("Preencha e-mail e senha.");
      return;
    }
    setLoginErro("");
    setEntrando(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail.trim(), password: loginSenha });
      if (error) throw error;
      setLoginSenha("");
    } catch (e) {
      setLoginErro("E-mail ou senha incorretos.");
    } finally {
      setEntrando(false);
    }
  };

  const sair = async () => {
    await supabase.auth.signOut();
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), msg.length > 40 ? 5000 : 2600);
  };

  // navegadores só permitem tocar som depois de algum toque na tela — este
  // botão "destrava" isso e guarda o contexto de áudio pra usar depois
  const ativarSom = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      ctx.resume();
      audioCtxRef.current = ctx;
      setSomAtivo(true);
      showToast("Som de aviso ativado");
    } catch (e) {
      // navegador sem suporte — sem problema, o pedido ainda aparece na lista normalmente
    }
  };

  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        const [pedidosRes, cardapioRes, configRes, cuponsRes, funcionariosRes, diariasRes, bairrosRes] = await Promise.all([
          supabase.from("pedidos").select("*").order("created_at", { ascending: false }),
          supabase.from("cardapio").select("*").order("created_at", { ascending: true }),
          supabase.from("configuracoes").select("*").eq("id", 1).single(),
          supabase.from("cupons").select("*").order("created_at", { ascending: false }),
          supabase.from("funcionarios").select("*").order("created_at", { ascending: false }),
          supabase.from("diarias").select("*").order("data", { ascending: false }),
          supabase.from("bairros_entrega").select("*").order("nome", { ascending: true }),
        ]);
        if (pedidosRes.error) throw pedidosRes.error;
        if (cardapioRes.error) throw cardapioRes.error;
        setPedidos((pedidosRes.data || []).map(mapPedidoFromDb));
        setCardapio((cardapioRes.data || []).map(mapCardapioFromDb));
        if (!cuponsRes.error) setCupons(cuponsRes.data || []);
        if (!funcionariosRes.error) setFuncionarios(funcionariosRes.data || []);
        if (!diariasRes.error) setDiarias((diariasRes.data || []).map(mapDiariaFromDb));
        if (!bairrosRes.error) setBairrosEntrega(bairrosRes.data || []);
        if (!configRes.error && configRes.data) {
          setTaxaEntregaForm(String(configRes.data.taxa_entrega ?? 0));
          setHorariosForm(configRes.data.horarios && Object.keys(configRes.data.horarios).length ? configRes.data.horarios : horariosPadrao());
          setAceitarAutomatico(!!configRes.data.aceitar_pedidos_automatico);
          setCupomAtivoSite(configRes.data.cupom_ativo !== false);
          setLojaFechada(!!configRes.data.loja_fechada);
          setMensagemLojaFechada(configRes.data.mensagem_loja_fechada || "");
          setTempoEntregaMin(String(configRes.data.tempo_entrega_min ?? 40));
          setTempoEntregaMax(String(configRes.data.tempo_entrega_max ?? 60));
          setMostrarTempoEntrega(!!configRes.data.mostrar_tempo_entrega);
        }
      } catch (err) {
        console.error(err);
        showToast("Não foi possível carregar os dados do banco");
      } finally {
        setLoaded(true);
      }
    })();
  }, [session]);

  const tocarAlerta = () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return; // som ainda não foi destravado por um toque na tela
    try {
      if (ctx.state === "suspended") ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.55);
    } catch (e) {
      // sem suporte a áudio — sem problema, o pedido ainda aparece na lista
    }
  };

  // ouve pedidos novos em tempo real
  useEffect(() => {
    if (!session) return;
    const canal = supabase
      .channel("pedidos-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pedidos" }, (payload) => {
        setPedidos((prev) => [mapPedidoFromDb(payload.new), ...prev]);
        tocarAlerta();
        if (aceitarAutomaticoRef.current) {
          showToast("Novo pedido aceito automaticamente!");
          atualizarStatusPedido(payload.new.id, "aceito");
        } else {
          showToast("Novo pedido recebido!");
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pedidos" }, (payload) => {
        setPedidos((prev) => prev.map((p) => (p.id === payload.new.id ? mapPedidoFromDb(payload.new) : p)));
      })
      .subscribe();

    return () => supabase.removeChannel(canal);
  }, [session]);

  // aviso persistente: repete o som e pisca o título da aba enquanto houver pedido pendente sem resposta
  useEffect(() => {
    const pendentes = pedidos.filter((p) => p.status === "pendente").length;
    if (pendentes === 0) {
      document.title = "Divino Frango · Painel de Pedidos";
      return;
    }
    const tituloOriginal = "Divino Frango · Painel de Pedidos";
    const tituloAlerta = `🔴 ${pendentes} pedido${pendentes > 1 ? "s" : ""} aguardando!`;
    let piscando = false;
    const intervaloTitulo = setInterval(() => {
      document.title = piscando ? tituloOriginal : tituloAlerta;
      piscando = !piscando;
    }, 1200);
    const intervaloSom = setInterval(() => tocarAlerta(), 2000);
    return () => {
      clearInterval(intervaloTitulo);
      clearInterval(intervaloSom);
      document.title = tituloOriginal;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidos]);

  const pedidosPendentes = useMemo(() => pedidos.filter((p) => p.status === "pendente"), [pedidos]);
  const pedidosOrdenados = useMemo(
    () => [...pedidos].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")),
    [pedidos]
  );
  // PEDIDOS ATIVOS: só o que ainda está em andamento. HISTÓRICO: tudo que já saiu, foi concluído, cancelado ou recusado.
  const pedidosAtivos = useMemo(() => pedidosOrdenados.filter(pedidoEstaAtivo), [pedidosOrdenados]);
  const pedidosHistorico = useMemo(() => pedidosOrdenados.filter((p) => !pedidoEstaAtivo(p)), [pedidosOrdenados]);

  // pesquisa/filtros do histórico
  const [buscaHistorico, setBuscaHistorico] = useState("");
  const [filtroStatusHistorico, setFiltroStatusHistorico] = useState("todos"); // todos | saiu | concluido | cancelado | recusado
  const [dataHistorico, setDataHistorico] = useState("");
  const [limiteHistorico, setLimiteHistorico] = useState(30);
  useEffect(() => {
    setLimiteHistorico(30);
  }, [buscaHistorico, filtroStatusHistorico, dataHistorico]);

  const historicoFiltrado = useMemo(() => {
    const termo = buscaHistorico.trim().toLowerCase().replace(/^#/, "");
    const termoDigitos = termo.replace(/\D/g, "");
    return pedidosHistorico.filter((p) => {
      if (filtroStatusHistorico !== "todos") {
        const chave = p.status === "pronto" ? "saiu" : p.status;
        if (chave !== filtroStatusHistorico) return false;
      }
      if (dataHistorico && dataLocalISO(new Date(p.createdAt)) !== dataHistorico) return false;
      if (termo) {
        const texto = [p.clienteNome, p.clienteTelefone, codigoPedido(p), p.endereco, p.bairro, ...(p.itens || []).map((i) => i.nome)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const telefoneDigitos = (p.clienteTelefone || "").replace(/\D/g, "");
        if (!texto.includes(termo) && !(termoDigitos.length >= 3 && telefoneDigitos.includes(termoDigitos))) return false;
      }
      return true;
    });
  }, [pedidosHistorico, buscaHistorico, filtroStatusHistorico, dataHistorico]);

  const LABEL_STATUS = {
    pendente: "Novo",
    aceito: "Aceito",
    preparando: "Em preparo",
    pronto: "Pronto",
    concluido: "Concluído",
    recusado: "Recusado",
    cancelado: "Cancelado",
  };

  // "extra" leva as colunas de horário (pronto_em, concluido_em, cancelado_em...).
  // O created_at (horário original do pedido) nunca é alterado por aqui.
  const atualizarStatusPedido = async (id, status, extra = {}, mensagem) => {
    const tentar = (patch) => supabase.from("pedidos").update({ status, ...patch }).eq("id", id).select().single();
    let { data: updated, error } = await tentar(extra);
    // se o banco ainda não tiver alguma coluna opcional (pronto_em, concluido_em, cancelado_em, motivo_cancelamento),
    // atualiza o status mesmo assim — só não grava aquele horário/motivo
    let patch = { ...extra };
    for (let i = 0; i < 4 && error; i++) {
      const faltando = Object.keys(patch).find((col) => new RegExp(col, "i").test(error.message || ""));
      if (!faltando || !(error.code === "PGRST204" || /column|schema cache/i.test(error.message || ""))) break;
      console.warn(`Coluna ${faltando} não encontrada em pedidos; atualizando o status sem gravar ela.`);
      const { [faltando]: _ignorado, ...resto } = patch;
      patch = resto;
      ({ data: updated, error } = await tentar(patch));
    }
    if (error) {
      console.error(error);
      // 0 linhas alteradas (sessão expirada / sem permissão / pedido já removido): explica o motivo
      if (error.code === "PGRST116" || /coerce/i.test(error.message || "")) await avisarFalhaAtualizacao();
      else showToast(`Erro ao atualizar pedido: ${error.message}`);
      return false;
    }
    setPedidos((prev) => prev.map((p) => (p.id === id ? mapPedidoFromDb(updated) : p)));
    showToast(mensagem || `Pedido: ${LABEL_STATUS[status] || status}`);
    return true;
  };
  const aceitarPedido = (id) => atualizarStatusPedido(id, "aceito");
  const recusarPedido = (id) => atualizarStatusPedido(id, "recusado");
  const iniciarPreparoPedido = (id) => atualizarStatusPedido(id, "preparando");
  // "Saiu para entrega" (ou "Pronto para retirada"): grava o horário em pronto_em.
  // O status continua "pronto", o mesmo valor que o site do cliente já entende no acompanhamento.
  const marcarProntoPedido = (p) =>
    atualizarStatusPedido(
      p.id,
      "pronto",
      { pronto_em: new Date().toISOString() },
      p.tipoEntrega === "entrega" ? "Pedido saiu para entrega" : "Pedido pronto para retirada"
    );
  const concluirPedido = (id) => atualizarStatusPedido(id, "concluido", { concluido_em: new Date().toISOString() });

  // ---------- cancelar pedido (com confirmação e motivo; o pedido NÃO é apagado) ----------
  const [pedidoParaCancelar, setPedidoParaCancelar] = useState(null);
  const [motivoCancelamento, setMotivoCancelamento] = useState("");
  const [cancelandoPedido, setCancelandoPedido] = useState(false);

  const abrirCancelamento = (p) => {
    setMotivoCancelamento("");
    setPedidoParaCancelar(p);
  };
  const fecharCancelamento = () => {
    if (cancelandoPedido) return;
    setPedidoParaCancelar(null);
    setMotivoCancelamento("");
  };
  const confirmarCancelamento = async () => {
    if (!pedidoParaCancelar) return;
    setCancelandoPedido(true);
    const ok = await atualizarStatusPedido(
      pedidoParaCancelar.id,
      "cancelado",
      { cancelado_em: new Date().toISOString(), motivo_cancelamento: motivoCancelamento.trim() || null },
      "Pedido cancelado"
    );
    setCancelandoPedido(false);
    if (ok) {
      setPedidoParaCancelar(null);
      setMotivoCancelamento("");
    }
  };

  const toggleAceitarAutomatico = async () => {
    const novo = !aceitarAutomatico;
    setAceitarAutomatico(novo);
    const { error } = await supabase.from("configuracoes").update({ aceitar_pedidos_automatico: novo, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) {
      setAceitarAutomatico(!novo);
      showToast(`Erro: ${error.message}`);
      return;
    }
    showToast(novo ? "Pedidos novos serão aceitos automaticamente" : "Aceitação automática desativada");
  };

  const toggleCupomAtivoSite = async () => {
    const novo = !cupomAtivoSite;
    setCupomAtivoSite(novo);
    const { error } = await supabase.from("configuracoes").update({ cupom_ativo: novo, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) {
      setCupomAtivoSite(!novo);
      showToast(`Erro: ${error.message}`);
      return;
    }
    showToast(novo ? "Campo de cupom visível no site" : "Campo de cupom ocultado do site");
  };

  const imprimirPedido = (pedido) => {
    const janela = window.open("", "_blank", "width=380,height=600");
    if (!janela) return;
    const itensHtml = pedido.itens
      .map((it) => `<tr><td>${it.qtd}x ${it.nome}</td><td style="text-align:right">${fmt(it.preco * it.qtd)}</td></tr>`)
      .join("");
    janela.document.write(`
      <html><head><title>Pedido</title>
      <style>
        body { font-family: monospace; padding: 12px; width: 280px; }
        h2 { text-align: center; margin: 0 0 4px; }
        .linha { border-top: 1px dashed #000; margin: 8px 0; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        td { padding: 2px 0; }
        .total { font-weight: bold; font-size: 15px; }
      </style></head>
      <body>
        <h2>Divino Frango</h2>
        <div style="text-align:center;font-size:12px;">${new Date(pedido.createdAt).toLocaleString("pt-BR")}</div>
        <div class="linha"></div>
        <div><b>Cliente:</b> ${pedido.clienteNome}</div>
        <div><b>Telefone:</b> ${pedido.clienteTelefone}</div>
        <div><b>Tipo:</b> ${pedido.tipoEntrega === "entrega" ? "Entrega" : "Retirada"}</div>
        ${pedido.tipoEntrega === "entrega" ? `<div><b>Endereço:</b> ${pedido.endereco || ""}${pedido.bairro ? " - " + pedido.bairro : ""}</div>` : ""}
        ${pedido.referencia ? `<div><b>Referência:</b> ${pedido.referencia}</div>` : ""}
        <div><b>Pagamento:</b> ${pedido.formaPagamento}</div>
        ${pedido.formaPagamento === "Dinheiro" && pedido.precisaTroco && pedido.trocoPara != null ? `<div><b>Troco para:</b> ${fmt(pedido.trocoPara)} (levar ${fmt(pedido.trocoPara - pedido.total)})</div>` : ""}
        ${pedido.observacao ? `<div><b>Obs:</b> ${pedido.observacao}</div>` : ""}
        <div class="linha"></div>
        <table>${itensHtml}</table>
        <div class="linha"></div>
        <table>
          ${pedido.taxaEntrega > 0 ? `<tr><td>Taxa de entrega</td><td style="text-align:right">${fmt(pedido.taxaEntrega)}</td></tr>` : ""}
          <tr class="total"><td>Total</td><td style="text-align:right">${fmt(pedido.total)}</td></tr>
        </table>
      </body></html>
    `);
    janela.document.close();
    janela.focus();
    janela.print();
  };

  // ---------- cardápio ----------
  const [formCardapio, setFormCardapio] = useState({ nome: "", descricao: "", preco: "", categoria: "", estoque: "" });
  const [editandoCardapioId, setEditandoCardapioId] = useState(null);
  const [uploadingFoto, setUploadingFoto] = useState(false);
  const cardapioFotoRef = useRef(null);

  const cardapioOrdenado = useMemo(
    () => {
      // mesma ordem de categorias do site do cliente; dentro de cada categoria, fica na sequência em que os itens foram cadastrados
      const ordemCat = ["Assados", "Acompanhamentos", "Combos", "Bebidas"];
      const rank = (c) => { const i = ordemCat.indexOf(c || ""); return i === -1 ? ordemCat.length : i; };
      return [...cardapio].sort((a, b) => rank(a.categoria) - rank(b.categoria));
    },
    [cardapio]
  );

  const abrirEdicaoCardapio = (item) => {
    setEditandoCardapioId(item.id);
    setFormCardapio({ nome: item.nome, descricao: item.descricao, preco: String(item.preco), categoria: item.categoria, estoque: item.estoque == null ? "" : String(item.estoque) });
  };

  // quando o Supabase não devolve nenhuma linha no update (sessão expirada, sem permissão ou item já removido)
  const avisarFalhaAtualizacao = async () => {
    const { data } = await supabase.auth.getSession();
    showToast(
      data && data.session
        ? "Não foi possível salvar: o registro não existe mais ou você não tem permissão. Atualize a página e tente de novo."
        : "Sua sessão expirou. Saia e entre de novo no painel."
    );
  };

  const salvarItemCardapio = async (fotoUrlOverride) => {
    if (!formCardapio.nome.trim() || !formCardapio.preco) return;
    const payload = {
      nome: formCardapio.nome.trim(),
      descricao: formCardapio.descricao.trim(),
      preco: Number(formCardapio.preco),
      categoria: formCardapio.categoria.trim(),
      estoque: formCardapio.estoque,
      disponivel: true,
    };
    if (editandoCardapioId) {
      const atual = cardapio.find((c) => c.id === editandoCardapioId);
      const { data: updated, error } = await supabase
        .from("cardapio")
        .update(mapCardapioInsert({ ...payload, fotoUrl: fotoUrlOverride ?? atual?.fotoUrl }))
        .eq("id", editandoCardapioId)
        .select()
        .maybeSingle();
      if (error) { showToast(`Erro ao salvar: ${error.message}`); console.error(error); return; }
      if (!updated) { await avisarFalhaAtualizacao(); return; }
      setCardapio((prev) => prev.map((c) => (c.id === editandoCardapioId ? mapCardapioFromDb(updated) : c)));
      showToast("Item atualizado");
    } else {
      const { data: inserted, error } = await supabase
        .from("cardapio")
        .insert(mapCardapioInsert({ ...payload, fotoUrl: fotoUrlOverride || null }))
        .select()
        .single();
      if (error) { showToast(`Erro ao adicionar: ${error.message}`); console.error(error); return; }
      setCardapio((prev) => [...prev, mapCardapioFromDb(inserted)]);
      showToast("Item adicionado ao cardápio");
    }
    setFormCardapio({ nome: "", descricao: "", preco: "", categoria: "", estoque: "" });
    setEditandoCardapioId(null);
  };

  const onPickFotoCardapio = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploadingFoto(true);
    try {
      const path = `${uid()}-${file.name}`.replace(/\s+/g, "_");
      const { error: upErr } = await supabase.storage.from("cardapio").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("cardapio").getPublicUrl(path);
      await salvarItemCardapio(pub.publicUrl);
    } catch (err) {
      showToast('Erro ao enviar foto — verifique se o bucket "cardapio" existe no Supabase');
    } finally {
      setUploadingFoto(false);
      if (cardapioFotoRef.current) cardapioFotoRef.current.value = "";
    }
  };

  const toggleCardapioDisponivel = async (item) => {
    const { data: updated, error } = await supabase
      .from("cardapio")
      .update({ disponivel: !item.disponivel })
      .eq("id", item.id)
      .select()
      .maybeSingle();
    if (error) { showToast("Não foi possível alterar o produto"); return; }
    if (!updated) { await avisarFalhaAtualizacao(); return; }
    setCardapio((prev) => prev.map((c) => (c.id === item.id ? mapCardapioFromDb(updated) : c)));
    showToast(updated.disponivel ? `${item.nome} ativado no cardápio` : `${item.nome} desativado — some do cardápio do cliente`);
  };

  const removeCardapioItem = async (id) => {
    const { error } = await supabase.from("cardapio").delete().eq("id", id);
    if (!error) setCardapio((prev) => prev.filter((c) => c.id !== id));
  };

  // ---------- caixa (PDV básico) ----------
  const [caixaAtual, setCaixaAtual] = useState(null); // caixa aberto, ou null
  const [movimentacoes, setMovimentacoes] = useState([]);
  const [historicoCaixas, setHistoricoCaixas] = useState([]);
  const [carregandoCaixa, setCarregandoCaixa] = useState(true);

  const [valorAberturaForm, setValorAberturaForm] = useState("");
  const [formMovimento, setFormMovimento] = useState({ tipo: "suprimento", valor: "", descricao: "" });
  const [comprasRecentes, setComprasRecentes] = useState([]); // últimas compras de todos os turnos (para rever a nota depois)
  const [historicoCompras, setHistoricoCompras] = useState([]); // todas as compras (para a busca de preço por produto)
  const [buscaCompra, setBuscaCompra] = useState("");
  const [carregandoCompras, setCarregandoCompras] = useState(false);
  const [notaVisualizacao, setNotaVisualizacao] = useState(null); // { carregando, url, erro } enquanto a foto da nota está aberta
  const [valorFechamentoForm, setValorFechamentoForm] = useState("");
  const [confirmarFechamento, setConfirmarFechamento] = useState(false);

  const carregarCaixa = async () => {
    setCarregandoCaixa(true);
    try {
      const { data: aberto, error } = await supabase.from("caixas").select("*").eq("status", "aberto").order("aberto_em", { ascending: false }).limit(1);
      if (error) throw error;
      if (aberto && aberto.length > 0) {
        const caixa = mapCaixaFromDb(aberto[0]);
        setCaixaAtual(caixa);
        const { data: movs } = await supabase.from("movimentacoes_caixa").select("*").eq("caixa_id", caixa.id).order("created_at", { ascending: false });
        setMovimentacoes((movs || []).map(mapMovFromDb));
      } else {
        setCaixaAtual(null);
        setMovimentacoes([]);
      }
      const { data: fechados } = await supabase.from("caixas").select("*").eq("status", "fechado").order("fechado_em", { ascending: false }).limit(10);
      setHistoricoCaixas((fechados || []).map(mapCaixaFromDb));
      const { data: compras } = await supabase.from("movimentacoes_caixa").select("*").eq("tipo", "compra").order("created_at", { ascending: false }).limit(30);
      setComprasRecentes((compras || []).map(mapMovFromDb));
    } catch (e) {
      showToast("Erro ao carregar o caixa");
    } finally {
      setCarregandoCaixa(false);
    }
  };

  const carregarCompras = async () => {
    setCarregandoCompras(true);
    try {
      const { data: compras } = await supabase.from("movimentacoes_caixa").select("*").eq("tipo", "compra").order("created_at", { ascending: false }).limit(1000);
      setHistoricoCompras((compras || []).map(mapMovFromDb));
    } catch (e) {
      showToast("Erro ao carregar as compras");
    } finally {
      setCarregandoCompras(false);
    }
  };

  useEffect(() => {
    if (tab === "compras") { carregarCaixa(); carregarCompras(); }
    if (tab === "caixa") carregarCaixa();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ---------- contatos de clientes (nome + WhatsApp vindos do checkout do site) ----------
  const [contatos, setContatos] = useState([]);
  const [carregandoContatos, setCarregandoContatos] = useState(false);
  const [erroContatos, setErroContatos] = useState("");
  const [buscaContato, setBuscaContato] = useState("");
  const [filtroContato, setFiltroContato] = useState("todos"); // todos | com_pedido | sem_pedido

  const carregarContatos = async () => {
    setCarregandoContatos(true);
    setErroContatos("");
    try {
      const { data, error } = await supabase.from("contatos").select("*").order("ultimo_contato", { ascending: false });
      if (error) throw error;
      setContatos(data || []);
    } catch (e) {
      setErroContatos("Não foi possível carregar os contatos. Confira se o arquivo supabase/migracao-contatos.sql já foi rodado no Supabase.");
    } finally {
      setCarregandoContatos(false);
    }
  };

  useEffect(() => {
    if (tab === "contatos") carregarContatos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const telefoneLegivel = (t) => {
    const d = String(t || "").replace(/\D/g, "");
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return t;
  };

  const contatosFiltrados = useMemo(() => {
    const termo = String(buscaContato || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    const termoDigitos = termo.replace(/\D/g, "");
    return contatos.filter((c) => {
      if (filtroContato === "com_pedido" && !c.fez_pedido) return false;
      if (filtroContato === "sem_pedido" && c.fez_pedido) return false;
      if (!termo) return true;
      const nome = String(c.nome || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      return nome.includes(termo) || (termoDigitos && c.telefone.includes(termoDigitos));
    });
  }, [contatos, buscaContato, filtroContato]);

  // planilha .csv (abre direto no Excel): separador ";" e BOM para os acentos saírem certos
  const exportarContatos = () => {
    const lista = contatosFiltrados;
    if (lista.length === 0) { showToast("Nenhum contato para exportar"); return; }
    const dataBR = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR") : "");
    const celula = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const linhas = [
      ["Nome", "WhatsApp", "WhatsApp com 55", "Fez pedido", "Qtd. de pedidos", "Primeiro contato", "Último contato"],
      ...lista.map((c) => [
        // ="..." faz o Excel tratar como texto (senão mostra 5,55E+12 no lugar do número)
        c.nome, telefoneLegivel(c.telefone), `="55${c.telefone}"`,
        c.fez_pedido ? "Sim" : "Não", c.total_pedidos, dataBR(c.primeiro_contato), dataBR(c.ultimo_contato),
      ]),
    ];
    const csv = "﻿" + linhas.map((l) => l.map(celula).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `contatos-divino-frango-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const removerContato = async (c) => {
    if (!window.confirm(`Apagar ${c.nome} da lista de contatos?`)) return;
    const { error } = await supabase.from("contatos").delete().eq("id", c.id);
    if (error) { showToast("Erro ao apagar contato"); return; }
    setContatos((lista) => lista.filter((x) => x.id !== c.id));
  };

  // busca de preço: procura pelo nome do produto em todas as compras já lançadas
  const semAcento = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const resultadosBuscaCompra = useMemo(() => {
    const termo = semAcento(buscaCompra);
    if (!termo) return [];
    const out = [];
    historicoCompras.forEach((m) => {
      const itens = m.itens && m.itens.length > 0 ? m.itens : [];
      itens.forEach((it) => {
        const nome = it.produto || it.nome || "";
        if (!semAcento(nome).includes(termo)) return;
        const qtd = Number(it.quantidade ?? it.qtd ?? 0);
        const unico = itens.length === 1;
        out.push({
          key: `${m.id}-${nome}`,
          nome,
          qtd,
          unidade: it.unidade,
          total: m.valor,
          precoUnit: precoPorUnidade(m, it, itens.length),
          data: m.dataCompra || (m.createdAt ? String(m.createdAt).slice(0, 10) : ""),
          varios: !unico,
          compra: m,
        });
      });
      // compras antigas sem itens: tenta achar no texto da descrição
      if (itens.length === 0 && semAcento(m.descricao).includes(termo)) {
        out.push({ key: `${m.id}-desc`, nome: m.descricao, qtd: 0, unidade: "un", total: m.valor, precoUnit: null, data: m.dataCompra || (m.createdAt ? String(m.createdAt).slice(0, 10) : ""), varios: true, compra: m });
      }
    });
    return out.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
  }, [buscaCompra, historicoCompras]);

  const abrirCaixa = async () => {
    const { data, error } = await supabase
      .from("caixas")
      .insert({ valor_abertura: Number(valorAberturaForm) || 0, status: "aberto" })
      .select()
      .single();
    if (error) { showToast("Erro ao abrir caixa"); return; }
    setCaixaAtual(mapCaixaFromDb(data));
    setMovimentacoes([]);
    setValorAberturaForm("");
    showToast("Caixa aberto");
  };

  const lancarMovimento = async (payload) => {
    if (!caixaAtual) return;
    const { data, error } = await supabase
      .from("movimentacoes_caixa")
      .insert({ caixa_id: caixaAtual.id, ...payload })
      .select()
      .single();
    if (error) { showToast(`Erro ao lançar: ${error.message}`); return null; }
    const mov = mapMovFromDb(data);
    setMovimentacoes((prev) => [mov, ...prev]);
    return mov;
  };

  const removerMovimento = async (id) => {
    const { error } = await supabase.from("movimentacoes_caixa").delete().eq("id", id);
    if (error) { showToast("Erro ao excluir"); return; }
    setMovimentacoes((prev) => prev.filter((m) => m.id !== id));
    setComprasRecentes((prev) => prev.filter((m) => m.id !== id));
    setHistoricoCompras((prev) => prev.filter((m) => m.id !== id));
    showToast("Movimentação excluída");
  };

  // ---------- equipe (funcionários + diárias) ----------
  const [formFuncionario, setFormFuncionario] = useState({ nome: "", funcao: "" });
  const [formDiaria, setFormDiaria] = useState({ nome: "", valor: "", data: new Date().toISOString().slice(0, 10) });

  const adicionarFuncionario = async () => {
    if (!formFuncionario.nome.trim()) return;
    const { data, error } = await supabase
      .from("funcionarios")
      .insert({ nome: formFuncionario.nome.trim(), funcao: formFuncionario.funcao.trim() || null, ativo: true })
      .select()
      .single();
    if (error) { showToast(`Erro: ${error.message}`); return; }
    setFuncionarios((prev) => [data, ...prev]);
    setFormFuncionario({ nome: "", funcao: "" });
    showToast("Pessoa adicionada à equipe");
  };

  const toggleFuncionarioAtivo = async (f) => {
    const { data, error } = await supabase.from("funcionarios").update({ ativo: !f.ativo }).eq("id", f.id).select().single();
    if (!error && data) setFuncionarios((prev) => prev.map((x) => (x.id === f.id ? data : x)));
  };

  const removerFuncionario = async (id) => {
    const { error } = await supabase.from("funcionarios").delete().eq("id", id);
    if (!error) setFuncionarios((prev) => prev.filter((f) => f.id !== id));
  };

  const lancarDiaria = async () => {
    if (!formDiaria.nome.trim() || !formDiaria.valor) return;
    const { data, error } = await supabase
      .from("diarias")
      .insert({ funcionario_nome: formDiaria.nome.trim(), valor: Number(formDiaria.valor), data: formDiaria.data })
      .select()
      .single();
    if (error) { showToast(`Erro: ${error.message}`); return; }
    setDiarias((prev) => [mapDiariaFromDb(data), ...prev]);
    setFormDiaria({ nome: "", valor: "", data: new Date().toISOString().slice(0, 10) });
    showToast("Diária lançada");
  };

  const removerDiaria = async (id) => {
    const { error } = await supabase.from("diarias").delete().eq("id", id);
    if (!error) setDiarias((prev) => prev.filter((d) => d.id !== id));
  };

  const totalDiarias = useMemo(() => diarias.reduce((s, d) => s + d.valor, 0), [diarias]);

  // Suprimento = dinheiro colocado no caixa. (A opção "Sangria" saiu da interface; lançamentos antigos continuam no banco.)
  const lancarMovimentoExtra = async () => {
    if (!formMovimento.valor) return;
    const mov = await lancarMovimento({
      tipo: "suprimento",
      valor: Number(formMovimento.valor),
      descricao: formMovimento.descricao.trim() || null,
    });
    if (mov) {
      setFormMovimento({ tipo: "suprimento", valor: "", descricao: "" });
      showToast("Suprimento registrado");
    }
  };

  // ---------- compras (produto, quantidade, unidade, valor, data, observação e foto da nota) ----------
  const compraVazia = () => ({
    itens: [{ produto: "", quantidade: "", unidade: "un", valor: "" }],
    valor: "",
    dataCompra: dataLocalISO(),
    observacao: "",
  });
  const [formCompra, setFormCompra] = useState(compraVazia);
  const [notaArquivo, setNotaArquivo] = useState(null);
  const [notaPreviewUrl, setNotaPreviewUrl] = useState(null);
  const [salvandoCompra, setSalvandoCompra] = useState(false);
  const notaInputRef = useRef(null); // galeria
  const notaCameraRef = useRef(null); // câmera
  const [lendoCupom, setLendoCupom] = useState(false);
  const [avisoCupom, setAvisoCupom] = useState(null); // { avisos: [] } depois de preencher o formulário pela leitura do cupom

  // libera a pré-visualização da foto quando ela muda ou a tela fecha
  useEffect(() => {
    return () => {
      if (notaPreviewUrl) URL.revokeObjectURL(notaPreviewUrl);
    };
  }, [notaPreviewUrl]);

  const atualizarItemCompra = (i, campo, valor) =>
    setFormCompra((f) => ({ ...f, itens: f.itens.map((it, idx) => (idx === i ? { ...it, [campo]: valor } : it)) }));
  const adicionarItemCompra = () =>
    setFormCompra((f) => ({ ...f, itens: [...f.itens, { produto: "", quantidade: "", unidade: "un", valor: "" }] }));
  const removerItemCompra = (i) =>
    setFormCompra((f) => (f.itens.length > 1 ? { ...f, itens: f.itens.filter((_, idx) => idx !== i) } : f));

  const escolherNota = async (e) => {
    const input = e.target;
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.type && !file.type.startsWith("image/")) {
      showToast("Escolha uma foto (imagem) do cupom fiscal");
      input.value = "";
      return;
    }
    let final = file;
    try {
      final = await reduzirFoto(file);
    } catch (err) {
      console.warn("Não deu para reduzir a foto; enviando a original.", err);
    }
    setNotaArquivo(final);
    try {
      setNotaPreviewUrl(URL.createObjectURL(final));
    } catch (err) {
      setNotaPreviewUrl(null);
    }
    showToast("Foto do cupom fiscal anexada");
    input.value = "";
  };

  const removerNotaSelecionada = () => {
    setNotaArquivo(null);
    setNotaPreviewUrl(null);
    if (notaInputRef.current) notaInputRef.current.value = "";
    if (notaCameraRef.current) notaCameraRef.current.value = "";
  };

  // lê o cupom fiscal (função "ler-cupom" no Supabase) e PREENCHE o formulário; nada é lançado
  // sem você conferir e tocar em "Lançar compra"
  const lerCupom = async () => {
    if (!notaArquivo || lendoCupom) return;
    setLendoCupom(true);
    setAvisoCupom(null);
    try {
      const imagens = await prepararImagensCupom(notaArquivo);
      const { data, error } = await supabase.functions.invoke("ler-cupom", { body: { imagens } });
      if (error) {
        let msg = "";
        try { msg = (await error.context.json())?.erro || ""; } catch (e) { /* sem corpo */ }
        throw new Error(msg || error.message || "falha na leitura");
      }
      if (!data || !Array.isArray(data.itens) || data.itens.length === 0) {
        showToast("Não consegui ler itens nesse cupom. Tente outra foto, com mais luz, ou preencha na mão.");
        return;
      }
      const itensLidos = data.itens.map((it) => ({
        produto: String(it.produto || "").trim(),
        quantidade: Number(it.quantidade) > 0 ? String(it.quantidade) : "",
        unidade: it.unidade === "kg" ? "kg" : "un",
        valor: Number(it.valor_total) > 0 ? String(it.valor_total) : "",
      }));
      const soma = itensLidos.reduce((t, it) => t + (Number(it.valor) || 0), 0);
      const totalCupom = Number(data.total_cupom) > 0 ? Number(data.total_cupom) : soma;
      const avisos = [];
      if (data.legivel === false) avisos.push("A foto parece ilegível: confira tudo com cuidado.");
      if (data.observacao) avisos.push(data.observacao);
      if (Number(data.total_cupom) > 0 && soma > 0 && Math.abs(Number(data.total_cupom) - soma) > 0.05) {
        avisos.push(`A soma dos itens (${fmt(soma)}) é diferente do total do cupom (${fmt(Number(data.total_cupom))}). Pode ter ficado item de fora.`);
      }
      setFormCompra((f) => ({
        ...f,
        itens: itensLidos,
        valor: totalCupom > 0 ? String(Math.round(totalCupom * 100) / 100) : f.valor,
        dataCompra: /^\d{4}-\d{2}-\d{2}$/.test(data.data_compra || "") ? data.data_compra : f.dataCompra,
      }));
      setAvisoCupom({ avisos });
      showToast("Cupom lido! Confira os dados antes de lançar.");
    } catch (err) {
      console.error(err);
      showToast(`Não foi possível ler o cupom: ${err.message}`);
    } finally {
      setLendoCupom(false);
    }
  };

  const lancarCompra = async () => {
    if (!caixaAtual || salvandoCompra) return;

    const linhas = formCompra.itens.filter((it) => it.produto.trim() || String(it.quantidade).trim());
    if (linhas.length === 0) { showToast("Informe o produto e a quantidade"); return; }
    const itens = [];
    for (const it of linhas) {
      const quantidade = Number(it.quantidade);
      if (!it.produto.trim() || !(quantidade > 0)) { showToast("Preencha o produto e a quantidade de cada item"); return; }
      const valorItem = Number(it.valor);
      itens.push({ produto: it.produto.trim(), quantidade, unidade: it.unidade, ...(valorItem > 0 && linhas.length > 1 ? { valor: valorItem } : {}) });
    }
    // total: o que foi digitado; se ficou vazio e todos os itens têm valor, soma os itens
    const somaItens = itens.length > 1 && itens.every((it) => it.valor > 0) ? itens.reduce((t, it) => t + it.valor, 0) : 0;
    const valor = Number(formCompra.valor) > 0 ? Number(formCompra.valor) : somaItens;
    if (!(valor > 0)) { showToast("Informe o valor total da compra"); return; }
    if (!formCompra.dataCompra) { showToast("Informe a data da compra"); return; }

    setSalvandoCompra(true);
    try {
      // 1) foto da nota → bucket privado "notas-fiscais" (o caminho guardado é o nota_foto_path)
      let notaPath = null;
      if (notaArquivo) {
        const ext = ((notaArquivo.name || "").split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
        const caminho = `${caixaAtual.id}/${uid()}${uid()}.${ext}`;
        const { error: upErr } = await supabase.storage.from(NOTAS_BUCKET).upload(caminho, notaArquivo, { contentType: notaArquivo.type || undefined, upsert: false });
        if (upErr) { showToast(`Erro ao enviar a foto do cupom fiscal: ${upErr.message}`); return; }
        notaPath = caminho;
      }

      // 2) compra em si (continua contando como saída do caixa, igual antes)
      const resumo = itens.map((it) => `${fmtQtd(it.quantidade)} ${rotuloUnidade(it.unidade)} ${it.produto}`).join(", ");
      const mov = await lancarMovimento({
        tipo: "compra",
        valor,
        descricao: resumo,
        itens,
        data_compra: formCompra.dataCompra,
        observacao: formCompra.observacao.trim() || null,
        nota_foto_path: notaPath,
      });
      if (!mov) {
        // não deixa a foto órfã se a compra não foi salva
        if (notaPath) await supabase.storage.from(NOTAS_BUCKET).remove([notaPath]);
        return;
      }
      setComprasRecentes((prev) => [mov, ...prev].slice(0, 30));
      setHistoricoCompras((prev) => [mov, ...prev]);
      setFormCompra(compraVazia());
      setAvisoCupom(null);
      removerNotaSelecionada();
      showToast("Compra lançada");
    } finally {
      setSalvandoCompra(false);
    }
  };

  // a foto da nota fica em bucket privado: gera um link temporário para o usuário logado
  const abrirNota = async (path) => {
    setNotaVisualizacao({ carregando: true, url: null, erro: null });
    const { data, error } = await supabase.storage.from(NOTAS_BUCKET).createSignedUrl(path, 600);
    if (error || !data?.signedUrl) {
      setNotaVisualizacao({ carregando: false, url: null, erro: "Não foi possível abrir a foto do cupom fiscal." });
      return;
    }
    setNotaVisualizacao({ carregando: false, url: data.signedUrl, erro: null });
  };

  const [formFechamentoDia, setFormFechamentoDia] = useState({ dinheiro: "", cartao: "", pix: "", data: dataLocalISO() });

  const lancarFechamentoDia = async () => {
    const entradas = [
      { campo: "dinheiro", forma: "Dinheiro", valor: formFechamentoDia.dinheiro },
      { campo: "cartao", forma: "Cartão", valor: formFechamentoDia.cartao },
      { campo: "pix", forma: "Pix", valor: formFechamentoDia.pix },
    ].filter((e) => e.valor && Number(e.valor) > 0);
    if (entradas.length === 0) return;
    // data das vendas: só grava data_referencia quando não é hoje (hoje = o próprio dia do lançamento)
    const dataVendas = formFechamentoDia.data || dataLocalISO();
    const extra = dataVendas !== dataLocalISO() ? { data_referencia: dataVendas } : {};
    for (const e of entradas) {
      const mov = await lancarMovimento({ tipo: "venda", valor: Number(e.valor), forma_pagamento: e.forma, descricao: "Total do dia", ...extra });
      if (!mov) return; // deu erro: mantém o que falta no formulário (o que já foi lançado é limpo, para não duplicar ao tentar de novo)
      setFormFechamentoDia((f) => ({ ...f, [e.campo]: "" }));
    }
    setFormFechamentoDia({ dinheiro: "", cartao: "", pix: "", data: dataLocalISO() });
    showToast("Vendas do dia lançadas");
  };

  const totaisCaixa = useMemo(() => {
    const vendas = movimentacoes.filter((m) => m.tipo === "venda");
    const sangrias = movimentacoes.filter((m) => m.tipo === "sangria");
    const suprimentos = movimentacoes.filter((m) => m.tipo === "suprimento");
    const compras = movimentacoes.filter((m) => m.tipo === "compra");
    const totalVendas = vendas.reduce((s, m) => s + m.valor, 0);
    const vendasDinheiro = vendas.filter((m) => m.formaPagamento === "Dinheiro").reduce((s, m) => s + m.valor, 0);
    const totalSangrias = sangrias.reduce((s, m) => s + m.valor, 0);
    const totalSuprimentos = suprimentos.reduce((s, m) => s + m.valor, 0);
    const totalCompras = compras.reduce((s, m) => s + m.valor, 0);
    const saldoDinheiro = (caixaAtual?.valorAbertura || 0) + vendasDinheiro + totalSuprimentos - totalSangrias - totalCompras;
    return { totalVendas, vendasDinheiro, totalSangrias, totalSuprimentos, totalCompras, saldoDinheiro };
  }, [movimentacoes, caixaAtual]);

  const fecharCaixa = async () => {
    if (!caixaAtual) return;
    const { error } = await supabase
      .from("caixas")
      .update({ status: "fechado", fechado_em: new Date().toISOString(), valor_fechamento_informado: Number(valorFechamentoForm) || 0 })
      .eq("id", caixaAtual.id);
    if (error) { showToast("Erro ao fechar caixa"); return; }
    showToast("Caixa fechado");
    setCaixaAtual(null);
    setMovimentacoes([]);
    setValorFechamentoForm("");
    setConfirmarFechamento(false);
    carregarCaixa();
  };

  // ---------- relatórios (visão financeira: pedidos + caixa) ----------
  const [vendasBalcaoRelatorio, setVendasBalcaoRelatorio] = useState([]);
  const [carregandoRelatorio, setCarregandoRelatorio] = useState(true);

  useEffect(() => {
    if (tab !== "relatorios") return;
    (async () => {
      setCarregandoRelatorio(true);
      try {
        const desde = new Date();
        desde.setDate(desde.getDate() - 30);
        const { data, error } = await supabase
          .from("movimentacoes_caixa")
          .select("*")
          .eq("tipo", "venda")
          .gte("created_at", desde.toISOString())
          .order("created_at", { ascending: false });
        if (!error) setVendasBalcaoRelatorio((data || []).map(mapMovFromDb));
      } catch (e) {
        showToast("Erro ao carregar relatório");
      } finally {
        setCarregandoRelatorio(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const hojeISO = new Date().toISOString().slice(0, 10);

  const pedidosConcluidos = useMemo(() => pedidos.filter((p) => p.status === "concluido"), [pedidos]);

  const relatorio = useMemo(() => {
    // faturamento = só o que é lançado no Caixa (o fechamento do dia já inclui os pedidos do site)
    const balcaoHoje = vendasBalcaoRelatorio.filter((m) => (m.createdAt || "").slice(0, 10) === hojeISO).reduce((s, m) => s + m.valor, 0);
    const balcaoMes = vendasBalcaoRelatorio.reduce((s, m) => s + m.valor, 0);

    // gráfico dos últimos 14 dias
    const dias = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      const balcao = vendasBalcaoRelatorio.filter((m) => (m.createdAt || "").slice(0, 10) === iso).reduce((s, m) => s + m.valor, 0);
      dias.push({ label, balcao: Number(balcao.toFixed(2)) });
    }

    // produtos mais vendidos (baseado nos pedidos de delivery concluídos)
    const contagem = {};
    pedidosConcluidos.forEach((p) => {
      (p.itens || []).forEach((it) => {
        contagem[it.nome] = (contagem[it.nome] || 0) + Number(it.qtd || 0);
      });
    });
    const maisVendidos = Object.entries(contagem)
      .map(([nome, qtd]) => ({ nome, qtd }))
      .sort((a, b) => b.qtd - a.qtd)
      .slice(0, 6);

    return { balcaoHoje, balcaoMes, dias, maisVendidos };
  }, [pedidosConcluidos, vendasBalcaoRelatorio, hojeISO]);

  // ---------- configurações (taxa de entrega + horário de funcionamento) ----------
  const [taxaEntregaForm, setTaxaEntregaForm] = useState("0");
  const [horariosForm, setHorariosForm] = useState(horariosPadrao());
  const [salvandoConfig, setSalvandoConfig] = useState(false);

  const atualizarDiaHorario = (dia, campo, valor) => {
    setHorariosForm((prev) => ({ ...prev, [dia]: { ...prev[dia], [campo]: valor } }));
  };

  const salvarConfig = async () => {
    const min = Number(tempoEntregaMin);
    const max = Number(tempoEntregaMax);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < 1 || min > max) {
      showToast("Tempo de entrega: informe mínimo e máximo válidos (o mínimo não pode ser maior que o máximo)");
      return;
    }
    setSalvandoConfig(true);
    try {
      const { error } = await supabase
        .from("configuracoes")
        .update({
          taxa_entrega: Number(taxaEntregaForm) || 0,
          horarios: horariosForm,
          tempo_entrega_min: min,
          tempo_entrega_max: max,
          mostrar_tempo_entrega: mostrarTempoEntrega,
          mensagem_loja_fechada: mensagemLojaFechada.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1);
      if (error) throw error;
      showToast("Configurações atualizadas");
    } catch (e) {
      showToast("Erro ao salvar configuração");
    } finally {
      setSalvandoConfig(false);
    }
  };

  // Loja aberta/fechada: salva na hora (não espera o botão "Salvar configurações"), junto com a mensagem atual.
  // A proteção contra pedidos com a loja fechada é do banco; aqui só ligamos/desligamos loja_fechada.
  const toggleLojaFechada = async () => {
    if (salvandoLoja) return;
    const novo = !lojaFechada;
    setSalvandoLoja(true);
    const { error } = await supabase
      .from("configuracoes")
      .update({ loja_fechada: novo, mensagem_loja_fechada: mensagemLojaFechada.trim() || null, updated_at: new Date().toISOString() })
      .eq("id", 1);
    setSalvandoLoja(false);
    if (error) {
      showToast(`Erro ao atualizar a loja: ${error.message}`);
      return;
    }
    setLojaFechada(novo);
    showToast(novo ? "Loja FECHADA — o site não recebe pedidos" : "Loja ABERTA — o site já recebe pedidos");
  };

  // ---------- cupons de desconto ----------
  const [formCupom, setFormCupom] = useState({ codigo: "", tipo: "percentual", valor: "", validade: "", usosMaximos: "" });

  const adicionarCupom = async () => {
    if (!formCupom.codigo.trim() || !formCupom.valor) return;
    const { data, error } = await supabase
      .from("cupons")
      .insert({
        codigo: formCupom.codigo.trim().toUpperCase(),
        tipo: formCupom.tipo,
        valor: Number(formCupom.valor),
        validade: formCupom.validade || null,
        usos_maximos: formCupom.usosMaximos ? Number(formCupom.usosMaximos) : null,
        ativo: true,
      })
      .select()
      .single();
    if (error) { showToast(error.code === "23505" ? "Já existe um cupom com esse código" : "Erro ao criar cupom"); return; }
    setCupons((prev) => [data, ...prev]);
    setFormCupom({ codigo: "", tipo: "percentual", valor: "", validade: "", usosMaximos: "" });
    showToast("Cupom criado");
  };

  const toggleCupomAtivo = async (cupom) => {
    const { data, error } = await supabase.from("cupons").update({ ativo: !cupom.ativo }).eq("id", cupom.id).select().single();
    if (!error && data) setCupons((prev) => prev.map((c) => (c.id === cupom.id ? data : c)));
  };

  const removerCupom = async (id) => {
    const { error } = await supabase.from("cupons").delete().eq("id", id);
    if (!error) setCupons((prev) => prev.filter((c) => c.id !== id));
  };

  // ---------- taxa de entrega por bairro ----------
  const [formBairro, setFormBairro] = useState({ nome: "", taxa: "" });

  const adicionarBairro = async () => {
    if (!formBairro.nome.trim() || !formBairro.taxa) return;
    const { data, error } = await supabase
      .from("bairros_entrega")
      .insert({ nome: formBairro.nome.trim(), taxa: Number(formBairro.taxa), ativo: true })
      .select()
      .single();
    if (error) { showToast(error.code === "23505" ? "Já existe um bairro com esse nome" : `Erro: ${error.message}`); return; }
    setBairrosEntrega((prev) => [...prev, data].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
    setFormBairro({ nome: "", taxa: "" });
    showToast("Bairro adicionado");
  };

  const removerBairro = async (id) => {
    const { error } = await supabase.from("bairros_entrega").delete().eq("id", id);
    if (!error) setBairrosEntrega((prev) => prev.filter((b) => b.id !== id));
  };

  if (session === undefined) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", color: C.textSoft, fontFamily: "'DM Sans', sans-serif" }}>
        <Loader2 size={22} style={{ marginRight: 10 }} className="spin-loader" />
        Carregando…
        <style>{`.spin-loader { animation: spin-loader 1s linear infinite; } @keyframes spin-loader { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (session === null) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", padding: 20 }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=DM+Sans:wght@400;500;600;700&display=swap');
          .display { font-family: 'Sora', sans-serif; }
        `}</style>
        <div style={{ width: "100%", maxWidth: 360, background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: 26 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 20 }}>
            <img src={LOGO_URL} alt="Divino Frango" style={{ width: 56, height: 56, objectFit: "contain", borderRadius: 12, marginBottom: 10 }} />
            <div className="display" style={{ fontSize: 17, fontWeight: 700, color: C.text }}>Painel de Pedidos</div>
          </div>
          {loginErro && <div style={{ background: C.redSoft, color: C.red, fontSize: 13, padding: "9px 12px", borderRadius: 10, marginBottom: 12 }}>{loginErro}</div>}
          <input
            type="email"
            placeholder="E-mail"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && entrar()}
            style={{ ...inputStyle, marginBottom: 10 }}
          />
          <div style={{ position: "relative", marginBottom: 16 }}>
            <input
              type={verSenha ? "text" : "password"}
              placeholder="Senha"
              value={loginSenha}
              onChange={(e) => setLoginSenha(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && entrar()}
              style={{ ...inputStyle, paddingRight: 42 }}
            />
            <button onClick={() => setVerSenha((v) => !v)} style={{ position: "absolute", right: 10, top: 10, background: "none", border: "none" }} aria-label="Mostrar senha">
              {verSenha ? <EyeOff size={17} color={C.textFaint} /> : <Eye size={17} color={C.textFaint} />}
            </button>
          </div>
          <button onClick={entrar} disabled={entrando} style={{ ...btnPrimary, width: "100%", opacity: entrando ? 0.7 : 1 }}>
            {entrando ? <Loader2 size={16} className="spin" /> : null} {entrando ? "Entrando…" : "Entrar"}
          </button>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", color: C.textSoft, fontFamily: "'DM Sans', sans-serif" }}>
        <Loader2 size={22} style={{ marginRight: 10 }} className="spin-loader" />
        Carregando…
        <style>{`.spin-loader { animation: spin-loader 1s linear infinite; } @keyframes spin-loader { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ---------- pedaços de tela reutilizados ----------
  const estiloStatusPedido = (p) => {
    if (p.status === "pendente") return { background: C.orangeSoft, color: C.orangeText };
    if (p.status === "recusado" || p.status === "cancelado") return { background: C.redSoft, color: C.red };
    if (p.status === "concluido") return { background: C.cardAlt, color: C.textSoft };
    return { background: C.greenSoft, color: C.green };
  };

  // card de pedido: usado tanto em PEDIDOS ATIVOS quanto no HISTÓRICO
  const renderPedidoCard = (p) => {
    const emAndamento = ["pendente", "aceito", "preparando", "pronto"].includes(p.status);
    const podeCancelar = ["aceito", "preparando", "pronto"].includes(p.status);
    const rotuloPronto = p.tipoEntrega === "entrega" ? "Saiu para entrega" : "Pronto para retirada";
    const trocoVisivel = p.formaPagamento === "Dinheiro" && p.precisaTroco && p.trocoPara != null;
    // WhatsApp do cliente com a mensagem pronta: só abre quando você toca no botão verde
    // ("Enviar confirmação no WhatsApp" etc.), nunca sozinho ao aceitar ou ao marcar pronto
    const tempoEntregaTexto = mostrarTempoEntrega && Number(tempoEntregaMin) > 0
      ? (tempoEntregaMin === tempoEntregaMax ? `${tempoEntregaMin} min` : `${tempoEntregaMin} a ${tempoEntregaMax} min`)
      : null;
    const tipoAvisoPronto = p.tipoEntrega === "entrega" ? "saiu" : "retirada";
    const abrirWhatsApp = (tipo) => window.open(linkWhatsAppCliente(p, tipo, tempoEntregaTexto), "_blank", "noopener");
    const avisoAtual = ["aceito", "preparando"].includes(p.status) ? "confirmado" : p.status === "pronto" ? tipoAvisoPronto : null;
    return (
      <Card key={p.id} style={p.status === "pendente" ? { borderColor: C.orange, borderWidth: 1.5 } : {}}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div>
            <div className="display" style={{ fontSize: 15.5, fontWeight: 800, color: C.text }}>Pedido #{codigoPedido(p)}</div>
            <div style={{ fontSize: 12.5, color: C.orangeText, fontWeight: 600, display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
              <Clock size={12} /> {fmtDataHora(p.createdAt)}
            </div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, ...estiloStatusPedido(p) }}>
            {rotuloStatusPedido(p)}
          </span>
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: C.text }}>{p.clienteNome}</div>
          <div style={{ fontSize: 12, color: C.textSoft, display: "flex", alignItems: "center", gap: 4 }}>
            <Phone size={11} /> {p.clienteTelefone}
          </div>
        </div>

        <div style={{ fontSize: 12, color: C.textSoft, display: "flex", alignItems: "center", gap: 4, marginBottom: 4, flexWrap: "wrap" }}>
          {p.tipoEntrega === "entrega" ? <Bike size={13} /> : <Store size={13} />}
          {p.tipoEntrega === "entrega" ? "Entrega" : "Retirada"}
          {p.tipoEntrega === "entrega" && p.endereco && (
            <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <MapPin size={12} /> {p.endereco}{p.bairro ? ` - ${p.bairro}` : ""}
            </span>
          )}
        </div>
        {p.dataPedido && p.dataPedido !== (p.createdAt || "").slice(0, 10) && (
          <div style={{ fontSize: 12, color: C.orangeText, fontWeight: 600, display: "flex", alignItems: "center", gap: 4, marginBottom: 8 }}>
            <Clock size={12} /> Agendado para {new Date(p.dataPedido + "T00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}
          </div>
        )}

        <div style={{ background: C.cardAlt, borderRadius: 10, padding: 10, marginBottom: 8 }}>
          {p.itens.map((it, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.text, marginBottom: 2 }}>
              <span>{it.qtd}x {it.nome}</span>
              <span className="mono">{fmt(it.preco * it.qtd)}</span>
            </div>
          ))}
          {p.taxaEntrega > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: C.textSoft, marginTop: 4, paddingTop: 4, borderTop: `1px solid ${C.border}` }}>
              <span>Taxa de entrega</span>
              <span className="mono">{fmt(p.taxaEntrega)}</span>
            </div>
          )}
          {p.observacao && <div style={{ fontSize: 12, color: C.textSoft, marginTop: 6, fontStyle: "italic" }}>Obs: {p.observacao}</div>}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: trocoVisivel ? 4 : 12 }}>
          <span style={{ fontSize: 12, color: C.textSoft }}>{p.formaPagamento}</span>
          <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: C.orangeText }}>{fmt(p.total)}</span>
        </div>
        {trocoVisivel && (
          <div style={{ background: C.orangeSoft, borderRadius: 8, padding: "6px 10px", marginBottom: 12, fontSize: 12.5, color: C.orangeText, fontWeight: 600 }}>
            Troco para {fmt(p.trocoPara)} (levar {fmt(p.trocoPara - p.total)} de troco)
          </div>
        )}

        {(p.prontoEm || p.concluidoEm || p.canceladoEm) && (
          <div style={{ fontSize: 12, color: C.textSoft, display: "flex", flexDirection: "column", gap: 3, marginBottom: 12 }}>
            {p.prontoEm && <div>{rotuloPronto}: <b style={{ color: C.text }}>{fmtDataHora(p.prontoEm)}</b></div>}
            {p.concluidoEm && <div>Concluído: <b style={{ color: C.text }}>{fmtDataHora(p.concluidoEm)}</b></div>}
            {p.canceladoEm && <div>Cancelado: <b style={{ color: C.red }}>{fmtDataHora(p.canceladoEm)}</b></div>}
            {p.status === "cancelado" && p.motivoCancelamento && <div>Motivo: <span style={{ color: C.text }}>{p.motivoCancelamento}</span></div>}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          {p.status === "pendente" && (
            <>
              <button onClick={() => recusarPedido(p.id)} style={{ ...btnOutline, flex: 1 }}>Recusar</button>
              <button onClick={() => aceitarPedido(p.id)} style={{ ...btnPrimary, flex: 1 }}><Check size={15} /> Aceitar</button>
            </>
          )}
          {p.status === "aceito" && (
            <button onClick={() => iniciarPreparoPedido(p.id)} style={{ ...btnPrimary, flex: 1 }}><Check size={15} /> Iniciar preparo</button>
          )}
          {p.status === "preparando" && (
            <button onClick={() => marcarProntoPedido(p)} style={{ ...btnPrimary, flex: 1 }}>
              <Check size={15} /> {p.tipoEntrega === "entrega" ? "Saiu para entrega" : "Pronto para retirada"}
            </button>
          )}
          {p.status === "pronto" && (
            <button onClick={() => concluirPedido(p.id)} style={{ ...btnPrimary, flex: 1 }}><Check size={15} /> Marcar como concluído</button>
          )}
          <button
            onClick={() => imprimirPedido(p)}
            style={{ ...btnOutline, flex: emAndamento ? "0 0 44px" : 1, padding: emAndamento ? "11px" : undefined }}
            aria-label="Imprimir"
          >
            <Printer size={15} />
          </button>
        </div>
        {avisoAtual && (
          <button
            onClick={() => abrirWhatsApp(avisoAtual)}
            style={{ ...btnOutline, width: "100%", marginTop: 8, borderColor: "rgba(37,211,102,0.5)", color: "#25D366" }}
          >
            <Phone size={15} /> {avisoAtual === "confirmado" ? "Enviar confirmação no WhatsApp" : avisoAtual === "saiu" ? "Avisar que saiu para entrega" : "Avisar que está pronto"}
          </button>
        )}
        {podeCancelar && (
          <button onClick={() => abrirCancelamento(p)} style={{ ...btnOutline, width: "100%", marginTop: 8, borderColor: C.red, color: C.red }}>
            <Ban size={15} /> Cancelar pedido
          </button>
        )}
      </Card>
    );
  };

  // detalhes de uma compra (itens, data, observação e botão para ver a foto da nota)
  const renderDetalhesCompra = (m) => (
    <>
      {m.itens && m.itens.length > 0
        ? m.itens.map((it, i) => (
            <div key={i} style={{ fontSize: 11.5, color: C.textSoft }}>
              {fmtQtd(it.quantidade ?? it.qtd ?? 0)} {rotuloUnidade(it.unidade)} · {it.produto || it.nome}
              {precoPorUnidade(m, it, m.itens.length) != null && (
                <b style={{ color: C.orangeText }}> · {fmt(precoPorUnidade(m, it, m.itens.length))}/{rotuloUnidade(it.unidade)}</b>
              )}
            </div>
          ))
        : m.descricao && <div style={{ fontSize: 11.5, color: C.textSoft }}>{m.descricao}</div>}
      {m.dataCompra && <div style={{ fontSize: 11.5, color: C.textFaint }}>Compra de {fmtDataSimples(m.dataCompra)}</div>}
      {m.observacao && <div style={{ fontSize: 11.5, color: C.textSoft, fontStyle: "italic" }}>Obs: {m.observacao}</div>}
      {m.notaFotoPath && (
        <button
          onClick={() => abrirNota(m.notaFotoPath)}
          style={{ marginTop: 6, background: C.orangeSoft, color: C.orangeText, border: "none", borderRadius: 8, padding: "5px 9px", fontSize: 11.5, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5 }}
        >
          <Camera size={12} /> Ver cupom fiscal
        </button>
      )}
    </>
  );

  // últimas compras de todos os turnos — é aqui que a foto da nota pode ser revista depois que o caixa fecha
  const renderComprasRecentes = () =>
    comprasRecentes.length > 0 && (
      <>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: "16px 0 10px" }}>Compras recentes</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {comprasRecentes.map((m) => (
            <div key={m.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: C.text, marginBottom: 2 }}>{fmtData(m.createdAt)}</div>
                {renderDetalhesCompra(m)}
              </div>
              <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: C.red, flexShrink: 0 }}>− {fmt(m.valor)}</span>
            </div>
          ))}
        </div>
      </>
    );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'DM Sans', sans-serif", color: C.text, paddingBottom: 90 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        input, select, textarea, button { font-family: 'DM Sans', sans-serif; }
        button { cursor: pointer; }
        .mono { font-family: 'DM Mono', monospace; }
        .display { font-family: 'Sora', sans-serif; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .fadein { animation: fadeIn .18s ease-out; }
        .spin { animation: spin-loader 1s linear infinite; }
        @keyframes spin-loader { to { transform: rotate(360deg); } }
      `}</style>

      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: "16px 20px", position: "sticky", top: 0, zIndex: 20 }}>
        <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src={LOGO_URL} alt="Divino Frango" style={{ width: 38, height: 38, objectFit: "contain", borderRadius: 9 }} />
            <div className="display" style={{ fontSize: 16, fontWeight: 700 }}>Painel de Pedidos</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => setTab("config")}
              style={{
                background: lojaFechada ? C.redSoft : C.greenSoft, color: lojaFechada ? C.red : C.green,
                border: `1px solid ${lojaFechada ? C.red : C.green}`, borderRadius: 999, padding: "7px 11px",
                fontSize: 11, fontWeight: 800, letterSpacing: 0.3,
              }}
              aria-label={lojaFechada ? "Loja fechada — abrir configurações" : "Loja aberta — abrir configurações"}
            >
              {lojaFechada ? "🔴 FECHADA" : "🟢 ABERTA"}
            </button>
            <button
              onClick={() => setTab("config")}
              style={{ background: C.orangeSoft, border: "none", borderRadius: 10, width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center" }}
              aria-label="Configurações"
            >
              <Settings size={18} color={C.orange} />
            </button>
            <button
              onClick={sair}
              style={{ background: C.cardAlt, border: "none", borderRadius: 10, width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center" }}
              aria-label="Sair"
            >
              <LogOut size={17} color={C.textSoft} />
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px 16px 0" }}>
        {!somAtivo && (
          <button
            onClick={ativarSom}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              background: C.orangeSoft, color: C.orangeText, border: `1px solid ${C.orange}`, borderRadius: 12,
              padding: "12px 14px", fontSize: 13.5, fontWeight: 700, marginBottom: 14,
            }}
          >
            🔔 Toque aqui para ativar o som de aviso de novos pedidos
          </button>
        )}
        {tab === "pedidos" && (
          <>
            <div style={{ display: "flex", gap: 6, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 4, marginBottom: 14 }}>
              {[
                { id: "ativos", label: `Pedidos ativos (${pedidosAtivos.length})` },
                { id: "historico", label: "Histórico de pedidos" },
              ].map(({ id, label }) => {
                const ativa = subPedidos === id;
                return (
                  <button
                    key={id}
                    onClick={() => setSubPedidos(id)}
                    style={{
                      flex: 1, padding: "10px 6px", borderRadius: 10, border: "none", textAlign: "center", lineHeight: 1.2,
                      background: ativa ? C.orange : "transparent", color: ativa ? "#0E0E10" : C.textSoft,
                      fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.3,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {subPedidos === "ativos" && (
              <>
                <button
                  onClick={toggleAceitarAutomatico}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    background: aceitarAutomatico ? C.greenSoft : C.cardAlt,
                    color: aceitarAutomatico ? C.green : C.textSoft,
                    border: `1px solid ${aceitarAutomatico ? C.green : C.border}`, borderRadius: 12,
                    padding: "10px 14px", fontSize: 13, fontWeight: 700, marginBottom: 14,
                  }}
                >
                  {aceitarAutomatico ? <Check size={15} /> : <X size={15} />} Aceitar pedidos novos automaticamente: {aceitarAutomatico ? "Ligado" : "Desligado"}
                </button>
                <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                  <MiniStat label="Pendentes" value={String(pedidosPendentes.length)} />
                  <MiniStat label="Em andamento" value={String(pedidosAtivos.length)} />
                  <MiniStat label="Total de pedidos" value={String(pedidos.length)} />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {pedidosAtivos.length === 0 && (
                    <EmptyState
                      text={
                        pedidos.length === 0
                          ? "Nenhum pedido recebido ainda. Assim que um cliente pedir pelo site, ele aparece aqui na hora."
                          : "Nenhum pedido em andamento agora. Os pedidos que já saíram para entrega, foram concluídos ou cancelados ficam no histórico."
                      }
                    />
                  )}
                  {pedidosAtivos.map((p) => renderPedidoCard(p))}
                </div>
              </>
            )}

            {subPedidos === "historico" && (
              <>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
                    <Search size={15} color={C.textFaint} style={{ position: "absolute", left: 11, top: 13 }} />
                    <input
                      placeholder="Buscar cliente, nº ou produto"
                      value={buscaHistorico}
                      onChange={(e) => setBuscaHistorico(e.target.value)}
                      style={{ ...inputStyle, paddingLeft: 33 }}
                    />
                  </div>
                  <input
                    type="date"
                    value={dataHistorico}
                    onChange={(e) => setDataHistorico(e.target.value)}
                    aria-label="Filtrar por data do pedido"
                    style={{ ...inputStyle, width: 150, flexShrink: 0, colorScheme: "dark" }}
                  />
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                  {FILTROS_HISTORICO.map((f) => {
                    const ativo = filtroStatusHistorico === f.id;
                    return (
                      <button
                        key={f.id}
                        onClick={() => setFiltroStatusHistorico(f.id)}
                        style={{
                          padding: "7px 11px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                          border: `1px solid ${ativo ? C.orange : C.border}`,
                          background: ativo ? C.orangeSoft : "transparent",
                          color: ativo ? C.orangeText : C.textSoft,
                        }}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: C.textFaint }}>
                    {historicoFiltrado.length} {historicoFiltrado.length === 1 ? "pedido" : "pedidos"}
                  </span>
                  {(buscaHistorico || dataHistorico || filtroStatusHistorico !== "todos") && (
                    <button
                      onClick={() => { setBuscaHistorico(""); setDataHistorico(""); setFiltroStatusHistorico("todos"); }}
                      style={{ background: "none", border: "none", color: C.orangeText, fontSize: 12, fontWeight: 700 }}
                    >
                      Limpar filtros
                    </button>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {historicoFiltrado.length === 0 && (
                    <EmptyState
                      text={
                        pedidosHistorico.length === 0
                          ? "O histórico ainda está vazio. Pedidos que saíram para entrega, foram concluídos ou cancelados aparecem aqui."
                          : "Nenhum pedido encontrado com esses filtros."
                      }
                    />
                  )}
                  {historicoFiltrado.slice(0, limiteHistorico).map((p) => renderPedidoCard(p))}
                </div>
                {historicoFiltrado.length > limiteHistorico && (
                  <button onClick={() => setLimiteHistorico((n) => n + 30)} style={{ ...btnOutline, width: "100%", marginTop: 12 }}>
                    Mostrar mais pedidos
                  </button>
                )}
              </>
            )}
          </>
        )}

        {tab === "caixa" && (
          <>
            {carregandoCaixa ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: C.textSoft }}>
                <Loader2 size={20} className="spin" />
              </div>
            ) : !caixaAtual ? (
              <>
              <Card>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <Lock size={18} color={C.orange} />
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Caixa fechado</div>
                </div>
                <div style={{ fontSize: 12.5, color: C.textSoft, marginBottom: 12 }}>
                  Informe o valor inicial (fundo de troco) para abrir o caixa e começar a lançar vendas de balcão.
                </div>
                <input
                  type="number"
                  placeholder="Valor de abertura (R$)"
                  value={valorAberturaForm}
                  onChange={(e) => setValorAberturaForm(e.target.value)}
                  style={{ ...inputStyle, fontSize: 18, fontWeight: 700, padding: "13px 12px", marginBottom: 12 }}
                />
                <button onClick={abrirCaixa} style={{ ...btnPrimary, width: "100%" }}>
                  <Wallet size={16} /> Abrir caixa
                </button>
              </Card>
              </>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                  <MiniStat label="Vendas no turno" value={fmt(totaisCaixa.totalVendas)} />
                  <MiniStat label="Compras no turno" value={fmt(totaisCaixa.totalCompras)} />
                  <MiniStat label="Saldo em dinheiro" value={fmt(totaisCaixa.saldoDinheiro)} />
                </div>

                <Card style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>Lançar vendas do dia</div>
                  <div style={{ fontSize: 12, color: C.textSoft, marginBottom: 10 }}>
                    Se você prefere lançar o total vendido no fim do dia (em vez de venda por venda), preencha por forma de pagamento.
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                    <div>
                      <FieldLabel>Data das vendas</FieldLabel>
                      <input type="date" value={formFechamentoDia.data} max={dataLocalISO()} onChange={(e) => setFormFechamentoDia((f) => ({ ...f, data: e.target.value }))} style={inputStyle} />
                    </div>
                    <div>
                      <FieldLabel>Dinheiro</FieldLabel>
                      <input type="number" placeholder="R$ 0,00" value={formFechamentoDia.dinheiro} onChange={(e) => setFormFechamentoDia((f) => ({ ...f, dinheiro: e.target.value }))} style={inputStyle} />
                    </div>
                    <div>
                      <FieldLabel>Cartão</FieldLabel>
                      <input type="number" placeholder="R$ 0,00" value={formFechamentoDia.cartao} onChange={(e) => setFormFechamentoDia((f) => ({ ...f, cartao: e.target.value }))} style={inputStyle} />
                    </div>
                    <div>
                      <FieldLabel>Pix</FieldLabel>
                      <input type="number" placeholder="R$ 0,00" value={formFechamentoDia.pix} onChange={(e) => setFormFechamentoDia((f) => ({ ...f, pix: e.target.value }))} style={inputStyle} />
                    </div>
                  </div>
                  <button onClick={lancarFechamentoDia} style={{ ...btnPrimary, width: "100%" }}>
                    <Check size={15} /> Lançar vendas do dia
                  </button>
                </Card>

                <Card style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Suprimento (adicionar dinheiro ao caixa)</div>
                  <input
                    type="number"
                    placeholder="Valor (R$)"
                    value={formMovimento.valor}
                    onChange={(e) => setFormMovimento((f) => ({ ...f, valor: e.target.value }))}
                    style={{ ...inputStyle, marginBottom: 8 }}
                  />
                  <input
                    placeholder="Motivo (opcional)"
                    value={formMovimento.descricao}
                    onChange={(e) => setFormMovimento((f) => ({ ...f, descricao: e.target.value }))}
                    style={{ ...inputStyle, marginBottom: 10 }}
                  />
                  <button onClick={lancarMovimentoExtra} style={{ ...btnOutline, width: "100%", borderColor: C.green, color: C.green }}>
                    <ArrowDownCircle size={15} /> Registrar suprimento
                  </button>
                </Card>

                <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Movimentações do turno</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  {movimentacoes.length === 0 && <EmptyState text="Nenhuma movimentação ainda." />}
                  {movimentacoes.map((m) => (
                    <div key={m.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                          {m.tipo === "venda" ? `Venda${m.formaPagamento ? " · " + m.formaPagamento : ""}` : m.tipo === "sangria" ? "Sangria" : m.tipo === "compra" ? "Compra" : "Suprimento"}
                        </div>
                        {m.tipo === "compra"
                          ? renderDetalhesCompra(m)
                          : m.descricao && <div style={{ fontSize: 11.5, color: C.textSoft }}>{m.descricao}</div>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: m.tipo === "sangria" || m.tipo === "compra" ? C.red : C.green }}>
                          {m.tipo === "sangria" || m.tipo === "compra" ? "−" : "+"} {fmt(m.valor)}
                        </span>
                        <button onClick={() => removerMovimento(m.id)} style={iconBtnStyle} aria-label="Excluir movimentação"><Trash2 size={14} color={C.textFaint} /></button>
                      </div>
                    </div>
                  ))}
                </div>

                <Card style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Fechar caixa</div>
                  {!confirmarFechamento ? (
                    <button onClick={() => setConfirmarFechamento(true)} style={{ ...btnOutline, width: "100%" }}>
                      <Lock size={15} /> Fechar caixa
                    </button>
                  ) : (
                    <>
                      <div style={{ fontSize: 12.5, color: C.textSoft, marginBottom: 10 }}>
                        Saldo esperado em dinheiro: <b style={{ color: C.text }}>{fmt(totaisCaixa.saldoDinheiro)}</b>. Conte o dinheiro físico e informe abaixo.
                      </div>
                      <input
                        type="number"
                        placeholder="Valor contado (R$)"
                        value={valorFechamentoForm}
                        onChange={(e) => setValorFechamentoForm(e.target.value)}
                        style={{ ...inputStyle, fontSize: 18, fontWeight: 700, padding: "12px", marginBottom: 10 }}
                      />
                      {valorFechamentoForm && (
                        <div style={{ fontSize: 12.5, marginBottom: 10, color: Number(valorFechamentoForm) === totaisCaixa.saldoDinheiro ? C.green : C.red }}>
                          Diferença: {fmt(Number(valorFechamentoForm) - totaisCaixa.saldoDinheiro)}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => setConfirmarFechamento(false)} style={{ ...btnOutline, flex: 1 }}>Cancelar</button>
                        <button onClick={fecharCaixa} style={{ ...btnPrimary, flex: 1, background: C.red, color: "#fff" }}>Confirmar fechamento</button>
                      </div>
                    </>
                  )}
                </Card>

                {historicoCaixas.length > 0 && (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Turnos anteriores</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {historicoCaixas.map((c) => (
                        <div key={c.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 10 }}>
                          <div style={{ fontSize: 12.5, color: C.textSoft }}>
                            {new Date(c.abertoEm).toLocaleDateString("pt-BR")} · {new Date(c.abertoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} – {c.fechadoEm ? new Date(c.fechadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""}
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 4 }}>
                            <span style={{ color: C.textSoft }}>Abertura {fmt(c.valorAbertura)} → Fechamento {fmt(c.valorFechamentoInformado || 0)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {tab === "compras" && (
          <>
            <Card style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>Consultar preço de um produto</div>
              <div style={{ fontSize: 12, color: C.textSoft, marginBottom: 10 }}>Digite o nome de um produto que você já lançou para ver quanto pagou e quando comprou.</div>
              <div style={{ position: "relative" }}>
                <Search size={16} color={C.textFaint} style={{ position: "absolute", left: 12, top: 13 }} />
                <input
                  placeholder="Buscar produto (ex: arroz, óleo, frango)"
                  value={buscaCompra}
                  onChange={(e) => setBuscaCompra(e.target.value)}
                  style={{ ...inputStyle, paddingLeft: 36 }}
                />
              </div>
              {buscaCompra.trim() && (
                <div style={{ marginTop: 12 }}>
                  {carregandoCompras ? (
                    <div style={{ textAlign: "center", padding: "12px 0", color: C.textSoft }}><Loader2 size={18} className="spin" /></div>
                  ) : resultadosBuscaCompra.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: C.textSoft, textAlign: "center", padding: "10px 0" }}>Nenhuma compra encontrada com esse nome.</div>
                  ) : (
                    <>
                      <div style={{ background: C.orangeSoft, border: `1px solid ${C.orange}`, borderRadius: 10, padding: "9px 11px", marginBottom: 10, fontSize: 12.5, color: C.orangeText }}>
                        Última compra: <b>{resultadosBuscaCompra[0].nome}</b> em <b>{fmtDataSimples(resultadosBuscaCompra[0].data)}</b>
                        {resultadosBuscaCompra[0].precoUnit != null
                          ? <> por <b>{fmt(resultadosBuscaCompra[0].precoUnit)}</b>/{rotuloUnidade(resultadosBuscaCompra[0].unidade)}</>
                          : <> — compra de <b>{fmt(resultadosBuscaCompra[0].total)}</b></>}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {resultadosBuscaCompra.map((r) => (
                          <div key={r.key} style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{r.nome}</div>
                              <div style={{ fontSize: 11.5, color: C.textSoft }}>
                                {r.qtd > 0 ? `${fmtQtd(r.qtd)} ${rotuloUnidade(r.unidade)} · ` : ""}Comprado em {fmtDataSimples(r.data)}
                              </div>
                              {r.varios && r.precoUnit == null && <div style={{ fontSize: 11, color: C.textFaint }}>Compra com vários itens: o valor é o total da compra.</div>}
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: C.orangeText }}>
                                {r.precoUnit != null ? `${fmt(r.precoUnit)}/${rotuloUnidade(r.unidade)}` : fmt(r.total)}
                              </div>
                              {r.precoUnit != null && <div style={{ fontSize: 11, color: C.textFaint }}>total {fmt(r.total)}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </Card>

            {!caixaAtual && !carregandoCaixa && (
              <Card style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>Lançar compra</div>
                <div style={{ fontSize: 12.5, color: C.textSoft }}>Para lançar uma compra nova, abra o caixa primeiro (a compra sai do caixa do turno). A consulta de preços acima funciona sempre.</div>
              </Card>
            )}
            {caixaAtual && (
                <Card style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Compras</div>

                  <FieldLabel>Foto do cupom fiscal (opcional)</FieldLabel>
                  <input ref={notaCameraRef} type="file" accept="image/*" capture="environment" onChange={escolherNota} style={{ display: "none" }} />
                  <input ref={notaInputRef} type="file" accept="image/*" onChange={escolherNota} style={{ display: "none" }} />
                  {notaArquivo ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.cardAlt, borderRadius: 10, padding: 8, marginBottom: 12 }}>
                      {notaPreviewUrl
                        ? <img src={notaPreviewUrl} alt="Pré-visualização do cupom fiscal" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                        : <div style={{ width: 56, height: 56, borderRadius: 8, background: C.border, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><ImageIcon size={20} color={C.textFaint} /></div>}
                      <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: C.textSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {notaArquivo?.name || "Foto do cupom fiscal anexada"}
                      </div>
                      <button onClick={removerNotaSelecionada} style={iconBtnStyle} aria-label="Remover foto do cupom fiscal"><X size={16} color={C.textFaint} /></button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                      <button type="button" onClick={() => notaCameraRef.current && notaCameraRef.current.click()} style={{ ...btnOutline, flex: 1 }}>
                        <Camera size={15} /> Tirar foto
                      </button>
                      <button type="button" onClick={() => notaInputRef.current && notaInputRef.current.click()} style={{ ...btnOutline, flex: 1 }}>
                        <ImageIcon size={15} /> Galeria
                      </button>
                    </div>
                  )}
                  {notaArquivo && (
                    <button
                      type="button"
                      onClick={lerCupom}
                      disabled={lendoCupom}
                      style={{ ...btnPrimary, width: "100%", marginBottom: 12, opacity: lendoCupom ? 0.7 : 1 }}
                    >
                      {lendoCupom ? <Loader2 size={15} className="spin" /> : <Search size={15} />} {lendoCupom ? "Lendo o cupom…" : "Ler cupom e preencher"}
                    </button>
                  )}
                  {avisoCupom && (
                    <div style={{ background: C.orangeSoft, border: `1px solid ${C.orange}`, borderRadius: 10, padding: "9px 11px", marginBottom: 12, fontSize: 12.5, color: C.orangeText }}>
                      <b>Dados lidos do cupom: confira produto, quantidade e valores antes de lançar.</b>
                      {avisoCupom.avisos.map((a, i) => <div key={i} style={{ marginTop: 4 }}>• {a}</div>)}
                    </div>
                  )}

                  {formCompra.itens.map((it, i) => (
                    <div key={i} style={{ background: C.cardAlt, borderRadius: 10, padding: 10, marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <FieldLabel>Produto{formCompra.itens.length > 1 ? ` ${i + 1}` : ""}</FieldLabel>
                        {formCompra.itens.length > 1 && (
                          <button onClick={() => removerItemCompra(i)} style={{ ...iconBtnStyle, marginTop: -4 }} aria-label="Remover este produto"><X size={14} color={C.textFaint} /></button>
                        )}
                      </div>
                      <input
                        placeholder="Ex: Frango, carvão, óleo"
                        value={it.produto}
                        onChange={(e) => atualizarItemCompra(i, "produto", e.target.value)}
                        style={{ ...inputStyle, marginBottom: 8 }}
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <FieldLabel>Quantidade</FieldLabel>
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="any"
                            placeholder="0"
                            value={it.quantidade}
                            onChange={(e) => atualizarItemCompra(i, "quantidade", e.target.value)}
                            style={inputStyle}
                          />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <FieldLabel>Unidade</FieldLabel>
                          <div style={{ display: "flex", gap: 6 }}>
                            {UNIDADES_COMPRA.map((u) => {
                              const ativa = it.unidade === u.id;
                              return (
                                <button
                                  key={u.id}
                                  onClick={() => atualizarItemCompra(i, "unidade", u.id)}
                                  style={{
                                    flex: 1, padding: "11px 4px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                                    border: `1px solid ${ativa ? C.orange : C.border}`,
                                    background: ativa ? C.orangeSoft : "transparent",
                                    color: ativa ? C.orangeText : C.textSoft,
                                  }}
                                >
                                  {u.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                      {formCompra.itens.length > 1 && (
                        <div style={{ marginTop: 8 }}>
                          <FieldLabel>Valor deste produto (R$) — para saber o preço por {rotuloUnidade(it.unidade)}</FieldLabel>
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="any"
                            placeholder="0,00"
                            value={it.valor}
                            onChange={(e) => atualizarItemCompra(i, "valor", e.target.value)}
                            style={inputStyle}
                          />
                        </div>
                      )}
                      {(() => {
                        const q = Number(it.quantidade);
                        const v = formCompra.itens.length === 1 ? Number(formCompra.valor) : Number(it.valor);
                        return q > 0 && v > 0 ? (
                          <div style={{ marginTop: 8, fontSize: 12.5, color: C.orangeText, fontWeight: 700 }}>
                            Preço por {rotuloUnidade(it.unidade)}: {fmt(v / q)}
                          </div>
                        ) : null;
                      })()}
                    </div>
                  ))}
                  <button onClick={adicionarItemCompra} style={{ ...btnOutline, width: "100%", marginBottom: 12, padding: "9px 14px", fontSize: 13 }}>
                    <Plus size={14} /> Adicionar outro produto
                  </button>

                  <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <FieldLabel>Valor total (R$)</FieldLabel>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        placeholder="0,00"
                        value={formCompra.valor}
                        onChange={(e) => setFormCompra((f) => ({ ...f, valor: e.target.value }))}
                        style={inputStyle}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <FieldLabel>Data da compra</FieldLabel>
                      <input
                        type="date"
                        value={formCompra.dataCompra}
                        onChange={(e) => setFormCompra((f) => ({ ...f, dataCompra: e.target.value }))}
                        style={{ ...inputStyle, colorScheme: "dark" }}
                      />
                    </div>
                  </div>

                  <FieldLabel>Observação (opcional)</FieldLabel>
                  <input
                    placeholder="Ex: fornecedor, forma de pagamento"
                    value={formCompra.observacao}
                    onChange={(e) => setFormCompra((f) => ({ ...f, observacao: e.target.value }))}
                    style={{ ...inputStyle, marginBottom: 10 }}
                  />

                  <button
                    onClick={lancarCompra}
                    disabled={salvandoCompra}
                    style={{ ...btnOutline, width: "100%", borderColor: C.red, color: C.red, opacity: salvandoCompra ? 0.7 : 1 }}
                  >
                    {salvandoCompra ? <Loader2 size={15} className="spin" /> : <ArrowUpCircle size={15} />} {salvandoCompra ? "Salvando…" : "Lançar compra"}
                  </button>
                </Card>
            )}

            {renderComprasRecentes()}
          </>
        )}

        {tab === "equipe" && (
          <>
            <Card style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Adicionar à equipe</div>
              <input placeholder="Nome" value={formFuncionario.nome} onChange={(e) => setFormFuncionario((f) => ({ ...f, nome: e.target.value }))} style={{ ...inputStyle, marginBottom: 8 }} />
              <div style={{ display: "flex", gap: 8 }}>
                <input placeholder="Função (opcional)" value={formFuncionario.funcao} onChange={(e) => setFormFuncionario((f) => ({ ...f, funcao: e.target.value }))} style={{ ...inputStyle, flex: 1 }} />
                <button onClick={adicionarFuncionario} style={{ ...btnPrimary, paddingLeft: 16, paddingRight: 16 }}><Check size={16} /></button>
              </div>
            </Card>

            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Time</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {funcionarios.length === 0 && <EmptyState text="Nenhuma pessoa cadastrada ainda." />}
              {funcionarios.map((f) => (
                <Card key={f.id} style={{ padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ display: "flex", gap: 10, minWidth: 0 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: C.orangeSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Users size={17} color={C.orange} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{f.nome}</div>
                        <div style={{ fontSize: 12, color: C.textSoft, display: "flex", alignItems: "center", gap: 4 }}>
                          {f.funcao ? <><Briefcase size={11} /> {f.funcao}</> : "Sem função definida"}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => toggleFuncionarioAtivo(f)}
                        style={{ fontSize: 11, fontWeight: 600, padding: "4px 9px", borderRadius: 999, border: "none", background: f.ativo ? C.greenSoft : C.cardAlt, color: f.ativo ? C.green : C.textSoft }}
                      >
                        {f.ativo ? "Ativo" : "Inativo"}
                      </button>
                      <button onClick={() => removerFuncionario(f.id)} style={iconBtnStyle} aria-label="Remover"><Trash2 size={14} color={C.textFaint} /></button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <Card style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Pagamento de diária</div>
              <input
                list="lista-funcionarios-diaria"
                placeholder="Nome do funcionário"
                value={formDiaria.nome}
                onChange={(e) => setFormDiaria((f) => ({ ...f, nome: e.target.value }))}
                style={{ ...inputStyle, marginBottom: 8 }}
              />
              <datalist id="lista-funcionarios-diaria">
                {funcionarios.map((f) => <option key={f.id} value={f.nome} />)}
              </datalist>
              <div style={{ display: "flex", gap: 8 }}>
                <input type="number" placeholder="Valor da diária (R$)" value={formDiaria.valor} onChange={(e) => setFormDiaria((f) => ({ ...f, valor: e.target.value }))} style={{ ...inputStyle, flex: 1 }} />
                <input type="date" value={formDiaria.data} onChange={(e) => setFormDiaria((f) => ({ ...f, data: e.target.value }))} style={{ ...inputStyle, flex: 1 }} />
              </div>
              <button onClick={lancarDiaria} style={{ ...btnPrimary, width: "100%", marginTop: 10 }}>
                <Check size={16} /> Lançar diária
              </button>
            </Card>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: C.textSoft }}>Total pago em diárias</span>
              <span className="mono" style={{ color: C.red, fontSize: 14, fontWeight: 700 }}>{fmt(totalDiarias)}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {diarias.length === 0 && <EmptyState text="Nenhuma diária lançada ainda." />}
              {diarias.map((d) => (
                <div key={d.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{d.funcionarioNome}</div>
                    <div style={{ fontSize: 11.5, color: C.textSoft }}>{new Date(d.data + "T00:00").toLocaleDateString("pt-BR")}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: C.red }}>− {fmt(d.valor)}</span>
                    <button onClick={() => removerDiaria(d.id)} style={iconBtnStyle} aria-label="Excluir diária"><Trash2 size={14} color={C.textFaint} /></button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "contatos" && (
          <>
            <Card style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Contatos de clientes</div>
                  <div style={{ fontSize: 12, color: C.textSoft, marginTop: 2 }}>Quem preencheu nome e WhatsApp no site, com ou sem pedido.</div>
                </div>
                <button onClick={exportarContatos} style={{ ...btnPrimary, paddingLeft: 14, paddingRight: 14, flexShrink: 0 }}>
                  <Download size={16} /> Excel
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <MiniStat label="Contatos" value={contatos.length} />
                <MiniStat label="Fizeram pedido" value={contatos.filter((c) => c.fez_pedido).length} />
                <MiniStat label="Sem pedido" value={contatos.filter((c) => !c.fez_pedido).length} />
              </div>
              <div style={{ position: "relative", marginBottom: 10 }}>
                <Search size={15} color={C.textFaint} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
                <input placeholder="Buscar por nome ou telefone" value={buscaContato} onChange={(e) => setBuscaContato(e.target.value)} style={{ ...inputStyle, paddingLeft: 34 }} />
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[
                  { id: "todos", label: "Todos" },
                  { id: "com_pedido", label: "Fizeram pedido" },
                  { id: "sem_pedido", label: "Não finalizaram pedido" },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFiltroContato(f.id)}
                    style={{
                      fontSize: 12, fontWeight: 600, padding: "6px 11px", borderRadius: 999,
                      border: `1px solid ${filtroContato === f.id ? C.orange : C.border}`,
                      background: filtroContato === f.id ? C.orangeSoft : "transparent",
                      color: filtroContato === f.id ? C.orange : C.textSoft,
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 10, lineHeight: 1.45 }}>
                O botão Excel baixa a lista do filtro escolhido.
              </div>
            </Card>

            {erroContatos && <EmptyState text={erroContatos} />}
            {carregandoContatos && (
              <div style={{ textAlign: "center", padding: "30px 0", color: C.textSoft }}><Loader2 size={20} className="spin" /></div>
            )}
            {!carregandoContatos && !erroContatos && contatosFiltrados.length === 0 && (
              <EmptyState text={contatos.length === 0 ? "Nenhum contato ainda. Eles aparecem aqui quando alguém preenche nome e WhatsApp no site." : "Nenhum contato com esse filtro."} />
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {!carregandoContatos && contatosFiltrados.map((c) => (
                <Card key={c.id} style={{ padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.nome}</div>
                      <div className="mono" style={{ fontSize: 12.5, color: C.textSoft, marginTop: 1 }}>{telefoneLegivel(c.telefone)}</div>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: c.fez_pedido ? C.greenSoft : C.orangeSoft, color: c.fez_pedido ? C.green : C.orange }}>
                          {c.fez_pedido ? `${c.total_pedidos} ${c.total_pedidos === 1 ? "pedido" : "pedidos"}` : "Não finalizou pedido"}
                        </span>
                        <span style={{ fontSize: 10.5, color: C.textFaint, padding: "2px 0" }}>{new Date(c.ultimo_contato).toLocaleDateString("pt-BR")}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                      <a
                        href={`https://wa.me/55${c.telefone}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ ...iconBtnStyle, width: 34, height: 34, borderRadius: 10, background: "rgba(37,211,102,0.14)" }}
                        aria-label={`Abrir conversa com ${c.nome} no WhatsApp`}
                      >
                        <Phone size={15} color="#25D366" />
                      </a>
                      <button onClick={() => removerContato(c)} style={iconBtnStyle} aria-label={`Apagar ${c.nome}`}><Trash2 size={14} color={C.textFaint} /></button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}

        {tab === "financeiro" && (
          <Financeiro
            supabase={supabase}
            C={C}
            fmt={fmt}
            Card={Card}
            FieldLabel={FieldLabel}
            EmptyState={EmptyState}
            inputStyle={inputStyle}
            btnPrimary={btnPrimary}
            btnOutline={btnOutline}
            iconBtnStyle={iconBtnStyle}
            showToast={showToast}
            dataLocalISO={dataLocalISO}
          />
        )}

        {tab === "relatorios" && (
          <>
            {carregandoRelatorio ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: C.textSoft }}>
                <Loader2 size={20} className="spin" />
              </div>
            ) : (
              <>
                <Card style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: C.orangeText, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>Faturamento de hoje</div>
                  <div className="mono" style={{ fontSize: 30, fontWeight: 700, color: C.text, marginBottom: 8 }}>{fmt(relatorio.balcaoHoje)}</div>
                  <div style={{ fontSize: 12, color: C.textSoft }}><Store size={11} style={{ verticalAlign: -1 }} /> Vendas lançadas no Caixa</div>
                </Card>

                <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                  <MiniStat label="Vendas (30 dias)" value={fmt(relatorio.balcaoMes)} />
                </div>

                <Card style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 }}>Faturamento · últimos 14 dias</div>
                  <div style={{ height: 160 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={relatorio.dias} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                        <CartesianGrid stroke={C.borderSoft} vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.textFaint }} axisLine={false} tickLine={false} interval={1} />
                        <YAxis tick={{ fontSize: 10, fill: C.textFaint }} axisLine={false} tickLine={false} width={36} />
                        <Tooltip formatter={(v) => fmt(v)} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, background: C.cardAlt, fontSize: 12, color: C.text }} labelStyle={{ color: C.textSoft }} />
                        <Line type="monotone" dataKey="balcao" name="Vendas" stroke={C.green} strokeWidth={2.2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 8 }}>
                    <span style={{ fontSize: 11.5, color: C.textSoft, display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 8, height: 8, borderRadius: 4, background: C.green }} /> Vendas</span>
                  </div>
                </Card>

                <Card style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 }}>Produtos mais vendidos</div>
                  {relatorio.maisVendidos.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: C.textFaint }}>Ainda sem pedidos concluídos suficientes.</div>
                  ) : (
                    <div style={{ height: Math.max(120, relatorio.maisVendidos.length * 32) }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={relatorio.maisVendidos} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
                          <XAxis type="number" hide />
                          <YAxis dataKey="nome" type="category" width={110} tick={{ fontSize: 11, fill: C.textSoft }} axisLine={false} tickLine={false} />
                          <Tooltip formatter={(v) => `${v} vendidos`} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, background: C.cardAlt, fontSize: 12, color: C.text }} />
                          <Bar dataKey="qtd" fill={C.orange} radius={[0, 6, 6, 0]} barSize={16} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: C.textFaint, marginTop: 8 }}>Baseado nos pedidos de delivery concluídos.</div>
                </Card>
              </>
            )}
          </>
        )}

        {tab === "cardapio" && (
          <>
            <div style={{ fontSize: 12, color: C.textSoft, marginBottom: 14 }}>Itens que aparecem para o cliente no site de pedidos</div>

            <Card style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 10 }}>
                {editandoCardapioId ? "Editar item" : "Novo item do cardápio"}
              </div>
              <input placeholder="Nome (ex: Frango inteiro)" value={formCardapio.nome} onChange={(e) => setFormCardapio((f) => ({ ...f, nome: e.target.value }))} style={{ ...inputStyle, marginBottom: 8 }} />
              <input placeholder="Descrição (opcional)" value={formCardapio.descricao} onChange={(e) => setFormCardapio((f) => ({ ...f, descricao: e.target.value }))} style={{ ...inputStyle, marginBottom: 8 }} />
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input type="number" placeholder="Preço (R$)" value={formCardapio.preco} onChange={(e) => setFormCardapio((f) => ({ ...f, preco: e.target.value }))} style={{ ...inputStyle, flex: 1 }} />
                <select value={formCardapio.categoria} onChange={(e) => setFormCardapio((f) => ({ ...f, categoria: e.target.value }))} style={{ ...inputStyle, flex: 1 }}>
                  <option value="">Categoria</option>
                  {CATEGORIAS_CARDAPIO.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                  {formCardapio.categoria && !CATEGORIAS_CARDAPIO.includes(formCardapio.categoria) && (
                    <option value={formCardapio.categoria}>{formCardapio.categoria} (antiga)</option>
                  )}
                </select>
              </div>
              <input
                type="number"
                placeholder="Estoque (deixe em branco = ilimitado)"
                value={formCardapio.estoque}
                onChange={(e) => setFormCardapio((f) => ({ ...f, estoque: e.target.value }))}
                style={{ ...inputStyle, marginBottom: 8 }}
              />
              <input ref={cardapioFotoRef} type="file" accept="image/*" onChange={onPickFotoCardapio} style={{ display: "none" }} id="cardapio-foto-input" />
              <div style={{ display: "flex", gap: 8 }}>
                {editandoCardapioId && (
                  <button onClick={() => { setEditandoCardapioId(null); setFormCardapio({ nome: "", descricao: "", preco: "", categoria: "", estoque: "" }); }} style={{ ...btnOutline, flex: 1 }}>
                    Cancelar
                  </button>
                )}
                <button onClick={() => salvarItemCardapio()} style={{ ...btnOutline, flex: 1 }}>
                  <Check size={15} /> Salvar sem foto
                </button>
                <label htmlFor="cardapio-foto-input" style={{ ...btnPrimary, flex: 1, cursor: "pointer" }}>
                  {uploadingFoto ? <Loader2 size={15} className="spin" /> : <ImageIcon size={15} />} {uploadingFoto ? "Enviando…" : "Salvar com foto"}
                </label>
              </div>
            </Card>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {cardapioOrdenado.length === 0 && <EmptyState text="Nenhum item no cardápio ainda." />}
              {cardapioOrdenado.map((item) => (
                <Card key={item.id} style={{ padding: 12, borderColor: item.disponivel ? undefined : C.red }}>
                  <div style={{ display: "flex", gap: 10, opacity: item.disponivel ? 1 : 0.6 }}>
                    {item.fotoUrl ? (
                      <img src={item.fotoUrl} alt={item.nome} style={{ width: 52, height: 52, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 52, height: 52, borderRadius: 10, background: C.cardAlt, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <UtensilsCrossed size={20} color={C.textFaint} />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{item.nome}</div>
                        <span className="mono" style={{ fontSize: 13.5, fontWeight: 700, color: C.orangeText }}>{fmt(item.preco)}</span>
                      </div>
                      {item.descricao && <div style={{ fontSize: 12, color: C.textSoft, marginTop: 2 }}>{item.descricao}</div>}
                      {item.estoque != null && (
                        <div style={{ fontSize: 11.5, color: item.estoque <= 0 ? C.red : C.textSoft, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                          <Package size={11} /> {item.estoque <= 0 ? "Esgotado" : `${item.estoque} em estoque`}
                        </div>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        <button
                          onClick={() => toggleCardapioDisponivel(item)}
                          style={{
                            fontSize: 12.5, fontWeight: 700, padding: "8px 12px", borderRadius: 10,
                            display: "inline-flex", alignItems: "center", gap: 6,
                            border: `1px solid ${item.disponivel ? C.green : C.red}`,
                            background: item.disponivel ? C.greenSoft : "rgba(248,113,113,0.12)",
                            color: item.disponivel ? C.green : C.red,
                          }}
                        >
                          {item.disponivel ? <><EyeOff size={14} /> Desativar</> : <><Eye size={14} /> Ativar de novo</>}
                        </button>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: item.disponivel ? C.green : C.red }}>
                          {item.disponivel ? "Ativo no cardápio" : "Desativado (oculto do cliente)"}
                        </span>
                        {item.categoria && (
                          <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 9px", borderRadius: 999, background: C.cardAlt, color: C.textSoft }}>
                            {item.categoria}
                          </span>
                        )}
                        <button onClick={() => abrirEdicaoCardapio(item)} style={iconBtnStyle} aria-label="Editar"><Pencil size={14} color={C.textFaint} /></button>
                        <button onClick={() => removeCardapioItem(item.id)} style={iconBtnStyle} aria-label="Remover"><Trash2 size={14} color={C.textFaint} /></button>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}

        {tab === "config" && (
          <>
            <div
              style={{
                background: lojaFechada ? "rgba(248,113,113,0.10)" : C.greenSoft,
                border: `2px solid ${lojaFechada ? C.red : C.green}`,
                borderRadius: 18, padding: 18, marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textSoft, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Status da loja</div>
              <div className="display" style={{ fontSize: 26, fontWeight: 800, color: lojaFechada ? C.red : C.green, marginBottom: 6 }}>
                {lojaFechada ? "🔴 LOJA FECHADA" : "🟢 LOJA ABERTA"}
              </div>
              <div style={{ fontSize: 12.5, color: C.textSoft, marginBottom: 14 }}>
                {lojaFechada
                  ? "O site do cliente mostra a mensagem de loja fechada e não deixa finalizar pedidos."
                  : "Os clientes podem fazer pedidos normalmente pelo site."}
              </div>
              <button
                onClick={toggleLojaFechada}
                disabled={salvandoLoja}
                style={{
                  ...btnPrimary, width: "100%", padding: "14px", fontSize: 15,
                  background: lojaFechada ? C.green : C.red, color: lojaFechada ? "#0E0E10" : "#fff",
                  opacity: salvandoLoja ? 0.7 : 1, marginBottom: 16,
                }}
              >
                {salvandoLoja ? <Loader2 size={16} className="spin" /> : null} {lojaFechada ? "Abrir loja" : "Fechar loja"}
              </button>

              <FieldLabel>Mensagem quando a loja estiver fechada</FieldLabel>
              <textarea
                rows={2}
                placeholder="Estamos fechados no momento. Voltamos em breve!"
                value={mensagemLojaFechada}
                onChange={(e) => setMensagemLojaFechada(e.target.value)}
                style={{ ...inputStyle, resize: "vertical", marginBottom: 8 }}
              />
              <div style={{ fontSize: 11.5, color: C.textFaint, marginBottom: 10 }}>
                Se ficar em branco, o cliente vê "Estamos fechados no momento."
              </div>
              <button onClick={salvarConfig} disabled={salvandoConfig} style={{ ...btnOutline, width: "100%", opacity: salvandoConfig ? 0.7 : 1 }}>
                <Check size={15} /> Salvar mensagem
              </button>
            </div>

            <Card style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <Bike size={18} color={C.orange} />
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Tempo estimado de entrega</div>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FieldLabel>Mínimo (min)</FieldLabel>
                  <input type="number" inputMode="numeric" min="1" step="1" value={tempoEntregaMin} onChange={(e) => setTempoEntregaMin(e.target.value)} style={{ ...inputStyle, fontSize: 18, fontWeight: 700 }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FieldLabel>Máximo (min)</FieldLabel>
                  <input type="number" inputMode="numeric" min="1" step="1" value={tempoEntregaMax} onChange={(e) => setTempoEntregaMax(e.target.value)} style={{ ...inputStyle, fontSize: 18, fontWeight: 700 }} />
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, fontWeight: 600, color: C.text, cursor: "pointer", marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={mostrarTempoEntrega}
                  onChange={(e) => setMostrarTempoEntrega(e.target.checked)}
                  style={{ width: 20, height: 20, accentColor: C.orange, flexShrink: 0 }}
                />
                Mostrar tempo de entrega para o cliente
              </label>
              <div style={{ fontSize: 12, color: C.textSoft, marginBottom: 12 }}>
                {mostrarTempoEntrega
                  ? `O cliente vai ver: "Tempo estimado de entrega: ${tempoEntregaMin || "?"}–${tempoEntregaMax || "?"} min"`
                  : "Desligado: o cliente não vê nenhum tempo de entrega."}
              </div>
              <button onClick={salvarConfig} disabled={salvandoConfig} style={{ ...btnOutline, width: "100%", opacity: salvandoConfig ? 0.7 : 1 }}>
                <Check size={15} /> Salvar tempo de entrega
              </button>
            </Card>

            <Card style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <Clock size={18} color={C.orange} />
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Horário de funcionamento</div>
              </div>
              <div style={{ fontSize: 12.5, color: C.textSoft, marginBottom: 14 }}>
                Marque os dias em que a loja abre. O site do cliente bloqueia pedidos fora desse horário automaticamente.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[0, 1, 2, 3, 4, 5, 6].map((dia) => {
                  const d = horariosForm[dia] || { aberto: false, abre: "08:00", fecha: "14:00", entregaAbre: "11:00", entregaFecha: "14:00" };
                  return (
                    <div key={dia} style={{ background: C.cardAlt, borderRadius: 10, padding: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: d.aberto ? 10 : 0 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: C.text }}>{DIAS_SEMANA[dia]}</span>
                        <button
                          onClick={() => atualizarDiaHorario(dia, "aberto", !d.aberto)}
                          style={{
                            fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, border: "none",
                            background: d.aberto ? C.greenSoft : C.border, color: d.aberto ? C.green : C.textSoft,
                          }}
                        >
                          {d.aberto ? "Aberto" : "Fechado"}
                        </button>
                      </div>
                      {d.aberto && (
                        <>
                          <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                            <span style={{ fontSize: 11, color: C.textFaint, width: 56 }}>Loja</span>
                            <input type="time" value={d.abre} onChange={(e) => atualizarDiaHorario(dia, "abre", e.target.value)} style={{ ...inputStyle, flex: 1, fontSize: 13, padding: "8px 10px" }} />
                            <span style={{ color: C.textFaint, fontSize: 12 }}>até</span>
                            <input type="time" value={d.fecha} onChange={(e) => atualizarDiaHorario(dia, "fecha", e.target.value)} style={{ ...inputStyle, flex: 1, fontSize: 13, padding: "8px 10px" }} />
                          </div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span style={{ fontSize: 11, color: C.textFaint, width: 56 }}>Entrega</span>
                            <input type="time" value={d.entregaAbre} onChange={(e) => atualizarDiaHorario(dia, "entregaAbre", e.target.value)} style={{ ...inputStyle, flex: 1, fontSize: 13, padding: "8px 10px" }} />
                            <span style={{ color: C.textFaint, fontSize: 12 }}>até</span>
                            <input type="time" value={d.entregaFecha} onChange={(e) => atualizarDiaHorario(dia, "entregaFecha", e.target.value)} style={{ ...inputStyle, flex: 1, fontSize: 13, padding: "8px 10px" }} />
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <Banknote size={18} color={C.orange} />
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Taxa de entrega</div>
              </div>
              <div style={{ fontSize: 12.5, color: C.textSoft, marginBottom: 12 }}>
                Esse valor é somado automaticamente ao total do pedido sempre que o cliente escolher "Entrega" no site.
              </div>
              <input
                type="number"
                placeholder="R$ 0,00"
                value={taxaEntregaForm}
                onChange={(e) => setTaxaEntregaForm(e.target.value)}
                style={{ ...inputStyle, fontSize: 18, fontWeight: 700, padding: "13px 12px" }}
              />
            </Card>

            <Card style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Tag size={18} color={C.orange} />
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Cupons de desconto</div>
                </div>
                <button
                  onClick={toggleCupomAtivoSite}
                  style={{ fontSize: 11, fontWeight: 700, padding: "5px 10px", borderRadius: 999, border: "none", background: cupomAtivoSite ? C.greenSoft : C.border, color: cupomAtivoSite ? C.green : C.textSoft }}
                >
                  {cupomAtivoSite ? "Visível no site" : "Oculto no site"}
                </button>
              </div>
              <div style={{ fontSize: 12.5, color: C.textSoft, marginBottom: 12 }}>
                Quando oculto, o campo de cupom some da tela de finalizar pedido do cliente — os cupons continuam cadastrados.
              </div>
              <input placeholder="Código (ex: BEMVINDO10)" value={formCupom.codigo} onChange={(e) => setFormCupom((f) => ({ ...f, codigo: e.target.value }))} style={{ ...inputStyle, marginBottom: 8, textTransform: "uppercase" }} />
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <button
                  onClick={() => setFormCupom((f) => ({ ...f, tipo: "percentual" }))}
                  style={{ ...btnOutline, flex: 1, borderColor: formCupom.tipo === "percentual" ? C.orange : C.border, background: formCupom.tipo === "percentual" ? C.orangeSoft : "transparent", color: formCupom.tipo === "percentual" ? C.orangeText : C.textSoft }}
                >
                  % Percentual
                </button>
                <button
                  onClick={() => setFormCupom((f) => ({ ...f, tipo: "valor" }))}
                  style={{ ...btnOutline, flex: 1, borderColor: formCupom.tipo === "valor" ? C.orange : C.border, background: formCupom.tipo === "valor" ? C.orangeSoft : "transparent", color: formCupom.tipo === "valor" ? C.orangeText : C.textSoft }}
                >
                  R$ Valor fixo
                </button>
              </div>
              <input
                type="number"
                placeholder={formCupom.tipo === "percentual" ? "Ex: 10 (= 10%)" : "Ex: 5 (= R$ 5,00)"}
                value={formCupom.valor}
                onChange={(e) => setFormCupom((f) => ({ ...f, valor: e.target.value }))}
                style={{ ...inputStyle, marginBottom: 8 }}
              />
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <FieldLabel>Validade (opcional)</FieldLabel>
                  <input type="date" value={formCupom.validade} onChange={(e) => setFormCupom((f) => ({ ...f, validade: e.target.value }))} style={inputStyle} />
                </div>
                <div style={{ flex: 1 }}>
                  <FieldLabel>Usos máx. (opcional)</FieldLabel>
                  <input type="number" placeholder="Ilimitado" value={formCupom.usosMaximos} onChange={(e) => setFormCupom((f) => ({ ...f, usosMaximos: e.target.value }))} style={inputStyle} />
                </div>
              </div>
              <button onClick={adicionarCupom} style={{ ...btnPrimary, width: "100%", marginBottom: cupons.length ? 12 : 0 }}>
                <Check size={15} /> Criar cupom
              </button>

              {cupons.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {cupons.map((c) => (
                    <div key={c.id} style={{ background: C.cardAlt, borderRadius: 10, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{c.codigo}</div>
                        <div style={{ fontSize: 11.5, color: C.textSoft }}>
                          {c.tipo === "percentual" ? `${c.valor}% de desconto` : `${fmt(c.valor)} de desconto`}
                          {c.usos_maximos ? ` · ${c.usos_atual}/${c.usos_maximos} usos` : ` · ${c.usos_atual} usos`}
                          {c.validade ? ` · até ${new Date(c.validade + "T00:00").toLocaleDateString("pt-BR")}` : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button
                          onClick={() => toggleCupomAtivo(c)}
                          style={{ fontSize: 11, fontWeight: 600, padding: "4px 9px", borderRadius: 999, border: "none", background: c.ativo ? C.greenSoft : C.border, color: c.ativo ? C.green : C.textSoft }}
                        >
                          {c.ativo ? "Ativo" : "Pausado"}
                        </button>
                        <button onClick={() => removerCupom(c.id)} style={iconBtnStyle} aria-label="Remover cupom"><Trash2 size={14} color={C.textFaint} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <MapPin size={18} color={C.orange} />
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Taxa de entrega por bairro</div>
              </div>
              <div style={{ fontSize: 12.5, color: C.textSoft, marginBottom: 12 }}>
                Cadastre aqui os bairros para os quais você entrega, com a taxa de cada um. No site do cliente, só é possível escolher "Entrega" para um bairro desta lista — se nenhum bairro for cadastrado, a entrega fica liberada para qualquer endereço usando a taxa geral acima.
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: cupons.length ? 12 : 0 }}>
                <input placeholder="Nome do bairro" value={formBairro.nome} onChange={(e) => setFormBairro((f) => ({ ...f, nome: e.target.value }))} style={{ ...inputStyle, flex: 2 }} />
                <input type="number" placeholder="Taxa (R$)" value={formBairro.taxa} onChange={(e) => setFormBairro((f) => ({ ...f, taxa: e.target.value }))} style={{ ...inputStyle, flex: 1 }} />
                <button onClick={adicionarBairro} style={{ ...btnPrimary, paddingLeft: 14, paddingRight: 14, flexShrink: 0 }}><Check size={15} /></button>
              </div>

              {bairrosEntrega.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                  {bairrosEntrega.map((b) => (
                    <div key={b.id} style={{ background: C.cardAlt, borderRadius: 10, padding: "9px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{b.nome}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className="mono" style={{ fontSize: 13, color: C.orangeText, fontWeight: 700 }}>{fmt(b.taxa)}</span>
                        <button onClick={() => removerBairro(b.id)} style={iconBtnStyle} aria-label="Remover bairro"><Trash2 size={14} color={C.textFaint} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <button onClick={salvarConfig} disabled={salvandoConfig} style={{ ...btnPrimary, width: "100%", marginBottom: 10, opacity: salvandoConfig ? 0.7 : 1 }}>
              {salvandoConfig ? <Loader2 size={16} className="spin" /> : <Check size={16} />} {salvandoConfig ? "Salvando…" : "Salvar configurações"}
            </button>
            <button onClick={() => setTab("pedidos")} style={{ ...btnOutline, width: "100%" }}>
              <ClipboardList size={15} /> Voltar para Pedidos
            </button>
          </>
        )}
      </div>

      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: C.card, borderTop: `1px solid ${C.border}`, zIndex: 20, paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", display: "flex" }}>
          {[
            { id: "pedidos", label: "Pedidos", icon: ClipboardList, badge: pedidosPendentes.length },
            { id: "caixa", label: "Caixa", icon: Wallet },
            { id: "compras", label: "Compras", icon: Package },
            { id: "equipe", label: "Equipe", icon: Users },
            { id: "relatorios", label: "Relatórios", icon: BarChart3 },
            { id: "financeiro", label: "Financeiro", icon: Banknote },
            { id: "cardapio", label: "Cardápio", icon: UtensilsCrossed },
            { id: "contatos", label: "Contatos", icon: Contact },
          ].map(({ id, label, icon: Icon, badge }) => {
            const ativo = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "12px 4px 10px", background: "none", border: "none", position: "relative", color: ativo ? C.orange : C.textFaint }}
              >
                <div style={{ position: "relative" }}>
                  <Icon size={21} strokeWidth={ativo ? 2.4 : 2} />
                  {!!badge && (
                    <span style={{ position: "absolute", top: -6, right: -8, background: C.red, color: "#fff", fontSize: 9.5, fontWeight: 700, borderRadius: 999, minWidth: 15, height: 15, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>
                      {badge}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 11, fontWeight: ativo ? 700 : 500 }}>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {pedidoParaCancelar && (
        <div
          onClick={fecharCancelamento}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="fadein"
            style={{ width: "100%", maxWidth: 400, background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: 20, boxShadow: "0 20px 50px rgba(0,0,0,0.5)" }}
          >
            <div className="display" style={{ fontSize: 17, fontWeight: 800, color: C.text, marginBottom: 6 }}>
              Cancelar pedido #{codigoPedido(pedidoParaCancelar)}?
            </div>
            <div style={{ fontSize: 13, color: C.textSoft, marginBottom: 14, lineHeight: 1.45 }}>
              Pedido de <b style={{ color: C.text }}>{pedidoParaCancelar.clienteNome}</b> ({fmt(pedidoParaCancelar.total)}). Ele não será apagado: fica no histórico como cancelado.
            </div>
            <FieldLabel>Motivo do cancelamento (opcional)</FieldLabel>
            <textarea
              rows={3}
              placeholder="Ex: cliente desistiu, endereço não encontrado…"
              value={motivoCancelamento}
              onChange={(e) => setMotivoCancelamento(e.target.value)}
              style={{ ...inputStyle, resize: "vertical", marginBottom: 14 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={fecharCancelamento} disabled={cancelandoPedido} style={{ ...btnOutline, flex: 1 }}>Voltar</button>
              <button
                onClick={confirmarCancelamento}
                disabled={cancelandoPedido}
                style={{ ...btnPrimary, flex: 1, background: C.red, color: "#fff", opacity: cancelandoPedido ? 0.7 : 1 }}
              >
                {cancelandoPedido ? <Loader2 size={15} className="spin" /> : <Ban size={15} />} {cancelandoPedido ? "Cancelando…" : "Confirmar cancelamento"}
              </button>
            </div>
          </div>
        </div>
      )}

      {notaVisualizacao && (
        <div
          onClick={() => setNotaVisualizacao(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 60, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="display" style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Cupom fiscal</div>
              <button onClick={() => setNotaVisualizacao(null)} style={{ ...iconBtnStyle, background: C.cardAlt, borderRadius: 10, width: 36, height: 36 }} aria-label="Fechar"><X size={18} color={C.text} /></button>
            </div>
            {notaVisualizacao.carregando && <Loader2 size={24} className="spin" color={C.textSoft} />}
            {notaVisualizacao.erro && <div style={{ color: C.red, fontSize: 13.5 }}>{notaVisualizacao.erro}</div>}
            {notaVisualizacao.url && (
              <>
                <img src={notaVisualizacao.url} alt="Foto do cupom fiscal" style={{ maxWidth: "100%", maxHeight: "72vh", objectFit: "contain", borderRadius: 12, background: C.card }} />
                <a href={notaVisualizacao.url} target="_blank" rel="noopener noreferrer" style={{ color: C.orangeText, fontSize: 13, fontWeight: 700 }}>
                  Abrir em nova aba
                </a>
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", background: C.cardAlt, border: `1px solid ${C.border}`, color: C.text, padding: "10px 18px", borderRadius: 999, fontSize: 13, fontWeight: 500, zIndex: 50, boxShadow: "0 8px 20px rgba(0,0,0,0.4)" }} className="fadein">
          {toast}
        </div>
      )}
    </div>
  );
}
