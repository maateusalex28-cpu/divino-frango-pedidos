import React, { useState, useEffect, useMemo } from "react";
import { Plus, Minus, ShoppingCart, Check, Store, Bike, ChevronLeft, ChevronRight, Loader2, UtensilsCrossed, Clock, ClipboardCheck, CircleDashed, Trash2, CreditCard, User, Phone } from "lucide-react";
import { supabase } from "./supabaseClient";
import { LOGO_URL } from "./logo";

// foto de frango assado usada como fundo do site (fornecida pelo cliente).
// Importada como módulo (em vez de string apontando para /public) para que o Vite
// processe o arquivo no build, gere uma URL com hash e garanta que ele SEMPRE
// vá para o bundle final — eliminando o cenário clássico de "funciona local, some
// em produção" causado por 404 silencioso (arquivo não versionado, .gitignore,
// diferença de maiúsculas/minúsculas em servidor Linux, etc.).
import fundoFrangoAsset from "./assets/frango-fundo.jpg";
// foto de frango assado usada como fallback de imagem do produto "Frango Assado" (fornecida pelo cliente)
import fotoFrangoProdutoAsset from "./assets/frango-produto.jpg";

const BG_FRANGO_URL = fundoFrangoAsset;
const FOTO_FRANGO_PRODUTO = fotoFrangoProdutoAsset;

// imagens padrão (fallback) para produtos comuns que ainda não têm foto cadastrada no /admin.
// só é usada quando o produto NÃO tem foto_url no Supabase — nunca substitui uma imagem já cadastrada.
const IMAGENS_PADRAO_PRODUTO = [
  { match: /frango/i, url: FOTO_FRANGO_PRODUTO },
  { match: /arroz/i, url: "https://images.unsplash.com/photo-1625980319455-985e5442c5ae?auto=format&fit=crop&w=600&q=75" },
  { match: /farofa/i, url: "https://images.unsplash.com/photo-1626200926749-3477d5b2a2c1?auto=format&fit=crop&w=600&q=75" },
  { match: /maionese/i, url: "https://images.unsplash.com/photo-1541014741259-de529411b96a?auto=format&fit=crop&w=600&q=75" },
  { match: /lingui[cç]a/i, url: "https://images.unsplash.com/photo-1690983323313-bc38e2f2f4f2?auto=format&fit=crop&w=600&q=75" },
  { match: /(coxa|sobrecoxa)/i, url: "https://images.unsplash.com/photo-1598515213692-5f252f0d4f9a?auto=format&fit=crop&w=600&q=75" },
  { match: /(coca|refrigerante|guaran[aá]|bebida)/i, url: "https://images.unsplash.com/photo-1554866585-cd94860890b7?auto=format&fit=crop&w=600&q=75" },
];
const imagemPadraoProduto = (nome) => {
  const achado = IMAGENS_PADRAO_PRODUTO.find((i) => i.match.test(nome || ""));
  return achado ? achado.url : null;
};

const fmt = (n) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const uid = () => Math.random().toString(36).slice(2, 10);

// aplica máscara (DD) 9XXXX-XXXX / (DD) XXXX-XXXX enquanto o cliente digita
const mascaraTelefone = (valor) => {
  const digitos = (valor || "").replace(/\D/g, "").slice(0, 11);
  const ddd = digitos.slice(0, 2);
  const resto = digitos.slice(2);
  if (digitos.length === 0) return "";
  if (digitos.length <= 2) return `(${ddd}`;
  if (resto.length <= 4) return `(${ddd}) ${resto}`;
  if (digitos.length <= 10) return `(${ddd}) ${resto.slice(0, 4)}-${resto.slice(4)}`;
  return `(${ddd}) ${resto.slice(0, 5)}-${resto.slice(5, 9)}`;
};

// telefone válido = DDD + 8 ou 9 dígitos (10 ou 11 dígitos no total) — bloqueia número incompleto
const telefoneCompleto = (valor) => {
  const digitos = (valor || "").replace(/\D/g, "");
  return digitos.length === 10 || digitos.length === 11;
};

const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

// categorias oficiais do cardápio, nesta ordem exata
const CATEGORIAS_ORDEM = ["Assados", "Acompanhamentos", "Combos", "Bebidas"];
const CATEGORIA_EMOJI = { Assados: "🔥", Acompanhamentos: "🍚", Combos: "🎁", Bebidas: "🥤" };
// itens sem categoria (ou marcados como "Outros") não ganham aba nem título "Outros" para o cliente:
// aparecem só na aba "Todos", no topo, sem título — assim nenhum produto some do cardápio
const SEM_CATEGORIA = "__sem_categoria__";

// normaliza texto (remove acentos, espaços extras e caixa) para comparar categorias com segurança
const normalizarTexto = (s) =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

// mapeia variações que podem existir no banco (maiúsculas/minúsculas, singular/plural, sinônimos)
// para a categoria OFICIAL já usada no /admin — nunca cria categoria nova, só reconhece a existente.
const ALIAS_CATEGORIA = { bebida: "Bebidas", refrigerante: "Bebidas", refrigerantes: "Bebidas" };
CATEGORIAS_ORDEM.forEach((c) => {
  ALIAS_CATEGORIA[normalizarTexto(c)] = c;
});

const categoriaDoItem = (item) => {
  const chave = normalizarTexto(item.categoria);
  if (!chave || chave === "outros") return SEM_CATEGORIA;
  return ALIAS_CATEGORIA[chave] || item.categoria.trim();
};

// resumo legível dos dias/horários em que a loja funciona
const resumoHorarios = (horarios) => {
  if (!horarios) return "";
  const abertos = [0, 1, 2, 3, 4, 5, 6].filter((d) => horarios[d]?.aberto);
  if (abertos.length === 0) return "Nenhum horário configurado no momento.";
  return abertos.map((d) => `${DIAS_SEMANA[d]}, das ${horarios[d].abre} às ${horarios[d].fecha}`).join(" · ");
};

const C = {
  bg: "#0E0E10",
  card: "rgba(20,20,22,0.88)",
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

const mapPedidoFromDb = (r) => ({
  id: r.id,
  tipoEntrega: r.tipo_entrega,
  itens: r.itens || [],
  total: Number(r.total),
  status: r.status,
  createdAt: r.created_at,
});

const ETAPAS = ["pendente", "aceito", "preparando", "pronto", "concluido"];

const inputStyle = {
  width: "100%", padding: "12px 12px", borderRadius: 10, border: `1px solid ${C.border}`,
  background: C.cardAlt, color: C.text, fontSize: 15,
};

const btnPrimary = {
  background: C.orange, color: "#0E0E10", border: "none", borderRadius: 12, padding: "14px",
  fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%",
};

const btnOutline = {
  background: "transparent", color: C.text, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px",
  fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
};

// mantidas as opções de Cartão Crédito/Débito já existentes (o pedido só renomeou "Pix" para "Pix pela maquininha";
// remover a distinção entre crédito/débito seria remover uma funcionalidade já existente no sistema)
const FORMAS_PAGAMENTO = ["Dinheiro", "Pix pela maquininha", "Cartão Crédito", "Cartão Débito"];

export default function PedidoApp() {
  const [loaded, setLoaded] = useState(false);
  const [cardapio, setCardapio] = useState([]);
  const [carrinho, setCarrinho] = useState({}); // { [itemId]: qtd }
  const [tela, setTela] = useState("cardapio"); // cardapio | carrinho | checkout | confirmado
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [taxaEntrega, setTaxaEntrega] = useState(0);
  const [bairrosEntrega, setBairrosEntrega] = useState([]);
  const [cupomAtivoSite, setCupomAtivoSite] = useState(true);
  const [horarios, setHorarios] = useState(null);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [bairroForaDaArea, setBairroForaDaArea] = useState("");
  const [pedidoAtual, setPedidoAtual] = useState(null);
  const [diaEscolhido, setDiaEscolhido] = useState(null); // iso da data escolhida quando fora do horário
  const [categoriaAtiva, setCategoriaAtiva] = useState("Todos");
  const [cartBump, setCartBump] = useState(0);
  const [imagensQuebradas, setImagensQuebradas] = useState({}); // { [itemId]: true } — evita mostrar ícone de imagem quebrada
  // loja aberta/fechada (controle manual do painel) e tempo estimado de entrega
  const [lojaFechada, setLojaFechada] = useState(false);
  const [mensagemLojaFechada, setMensagemLojaFechada] = useState("");
  const [tempoEntrega, setTempoEntrega] = useState({ mostrar: false, min: 0, max: 0 });

  const [form, setForm] = useState({
    nome: "",
    telefone: "",
    tipoEntrega: "retirada",
    cep: "",
    rua: "",
    numero: "",
    bairro: "",
    referencia: "",
    formaPagamento: "Dinheiro",
    precisaTroco: false,
    trocoPara: "",
    observacao: "",
  });

  useEffect(() => {
    (async () => {
      try {
        const [cardapioRes, configRes, bairrosRes] = await Promise.all([
          supabase.from("cardapio").select("*").eq("disponivel", true).order("created_at", { ascending: true }),
          supabase.from("configuracoes").select("*").eq("id", 1).single(),
          supabase.from("bairros_entrega").select("*").eq("ativo", true),
        ]);
        if (cardapioRes.error) throw cardapioRes.error;
        setCardapio((cardapioRes.data || []).map(mapCardapioFromDb));
        if (!configRes.error && configRes.data) {
          setTaxaEntrega(Number(configRes.data.taxa_entrega) || 0);
          setHorarios(configRes.data.horarios || null);
          setCupomAtivoSite(configRes.data.cupom_ativo !== false);
          aplicarConfigLoja(configRes.data);
        }
        if (!bairrosRes.error) setBairrosEntrega(bairrosRes.data || []);
      } catch (e) {
        setErro("Não foi possível carregar o cardápio agora. Tente novamente em instantes.");
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  function aplicarConfigLoja(cfg) {
    setLojaFechada(!!cfg.loja_fechada);
    setMensagemLojaFechada((cfg.mensagem_loja_fechada || "").trim());
    setTempoEntrega({
      mostrar: !!cfg.mostrar_tempo_entrega,
      min: Number(cfg.tempo_entrega_min) || 0,
      max: Number(cfg.tempo_entrega_max) || 0,
    });
  }

  // relê só os campos da loja (aberta/fechada e tempo de entrega); devolve a configuração lida
  async function atualizarConfigLoja() {
    try {
      const { data, error } = await supabase.from("configuracoes").select("*").eq("id", 1).single();
      if (!error && data) {
        aplicarConfigLoja(data);
        return data;
      }
    } catch (e) {
      // sem problema: mantém o que já estava na tela
    }
    return null;
  }

  // se o dono fechar a loja com o site aberto no celular do cliente, o site percebe em até 1 minuto
  useEffect(() => {
    const checar = () => {
      if (document.visibilityState === "visible") atualizarConfigLoja();
    };
    const intervalo = setInterval(checar, 60000);
    document.addEventListener("visibilitychange", checar);
    return () => {
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", checar);
    };
  }, []);

  // loja fechada: o cliente não fica preso no carrinho/checkout, volta para o cardápio com o aviso
  useEffect(() => {
    if (lojaFechada && (tela === "carrinho" || tela === "checkout")) setTela("cardapio");
  }, [lojaFechada, tela]);

  const statusLoja = useMemo(() => {
    if (!horarios) return { aberta: true, entregaDisponivel: true }; // sem config = não bloqueia
    const agora = new Date();
    const diaConfig = horarios[agora.getDay()];
    if (!diaConfig || !diaConfig.aberto) return { aberta: false, entregaDisponivel: false };
    const horaAtual = `${String(agora.getHours()).padStart(2, "0")}:${String(agora.getMinutes()).padStart(2, "0")}`;
    const aberta = horaAtual >= diaConfig.abre && horaAtual < diaConfig.fecha;
    const entregaDisponivel = aberta && horaAtual >= diaConfig.entregaAbre && horaAtual < diaConfig.entregaFecha;
    return { aberta, entregaDisponivel };
  }, [horarios]);

  // próximos dias em que a loja funciona (usado quando o pedido é feito fora do horário)
  const proximosDiasAbertos = useMemo(() => {
    if (!horarios) return [];
    const dias = [];
    for (let i = 0; i < 8 && dias.length < 3; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const cfg = horarios[d.getDay()];
      if (cfg && cfg.aberto) {
        const iso = d.toISOString().slice(0, 10);
        const label = i === 0 ? "Hoje" : i === 1 ? "Amanhã" : d.toLocaleDateString("pt-BR", { weekday: "long" });
        dias.push({ iso, label: `${label} (${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })})`, config: cfg });
      }
    }
    return dias;
  }, [horarios]);

  useEffect(() => {
    if (!diaEscolhido && proximosDiasAbertos.length > 0) setDiaEscolhido(proximosDiasAbertos[0].iso);
  }, [proximosDiasAbertos, diaEscolhido]);

  const configDiaEscolhido = useMemo(() => {
    if (!horarios || !diaEscolhido) return null;
    const dia = new Date(diaEscolhido + "T00:00").getDay();
    return horarios[dia] || null;
  }, [horarios, diaEscolhido]);

  const itensPorCategoria = useMemo(() => {
    const grupos = {};
    cardapio.forEach((item) => {
      const cat = categoriaDoItem(item);
      if (!grupos[cat]) grupos[cat] = [];
      grupos[cat].push(item);
    });
    return grupos;
  }, [cardapio]);

  // categorias extras (fora das 4 oficiais) que já existirem no cardápio — preservadas, nunca escondidas
  const categoriasExtras = useMemo(() => {
    return Object.keys(itensPorCategoria).filter((c) => c !== SEM_CATEGORIA && !CATEGORIAS_ORDEM.includes(c)).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [itensPorCategoria]);

  const abasCategorias = useMemo(() => ["Todos", ...CATEGORIAS_ORDEM, ...categoriasExtras], [categoriasExtras]);

  // seções exibidas na tela do cardápio, na ordem oficial, de acordo com a aba selecionada
  const secoesExibidas = useMemo(() => {
    const ordemCompleta = [...CATEGORIAS_ORDEM, ...categoriasExtras];
    const alvo = categoriaAtiva === "Todos" ? [SEM_CATEGORIA, ...ordemCompleta] : ordemCompleta.filter((c) => c === categoriaAtiva);
    return alvo.map((cat) => [cat, itensPorCategoria[cat] || []]).filter(([, itens]) => itens.length > 0);
  }, [categoriaAtiva, itensPorCategoria, categoriasExtras]);

  const itensCarrinho = useMemo(
    () => Object.entries(carrinho)
      .filter(([, qtd]) => qtd > 0)
      .map(([id, qtd]) => ({ item: cardapio.find((c) => c.id === id), qtd }))
      .filter((x) => x.item),
    [carrinho, cardapio]
  );

  const subtotalCarrinho = itensCarrinho.reduce((s, { item, qtd }) => s + item.preco * qtd, 0);
  const qtdItensCarrinho = itensCarrinho.reduce((s, { qtd }) => s + qtd, 0);
  const taxaBairroEncontrada = useMemo(() => {
    if (!form.bairro.trim()) return null;
    const alvo = form.bairro.trim().toLowerCase();
    return bairrosEntrega.find((b) => b.nome.trim().toLowerCase() === alvo) || null;
  }, [form.bairro, bairrosEntrega]);

  const taxaAplicada = form.tipoEntrega === "entrega" ? (taxaBairroEncontrada ? Number(taxaBairroEncontrada.taxa) : taxaEntrega) : 0;

  const [cupomInput, setCupomInput] = useState("");
  const [cupomAplicado, setCupomAplicado] = useState(null); // { codigo, tipo, valor }
  const [cupomErro, setCupomErro] = useState("");
  const [buscandoCupom, setBuscandoCupom] = useState(false);

  const descontoAplicado = useMemo(() => {
    if (!cupomAplicado) return 0;
    const bruto = cupomAplicado.tipo === "percentual" ? (subtotalCarrinho * cupomAplicado.valor) / 100 : cupomAplicado.valor;
    return Math.min(bruto, subtotalCarrinho);
  }, [cupomAplicado, subtotalCarrinho]);

  const totalCarrinho = subtotalCarrinho - descontoAplicado + taxaAplicada;

  const aplicarCupom = async () => {
    if (!cupomInput.trim()) return;
    setCupomErro("");
    setBuscandoCupom(true);
    try {
      const { data, error } = await supabase.from("cupons").select("*").ilike("codigo", cupomInput.trim()).maybeSingle();
      if (error || !data) {
        setCupomErro("Cupom não encontrado.");
        return;
      }
      if (!data.ativo) {
        setCupomErro("Esse cupom não está mais ativo.");
        return;
      }
      if (data.validade && data.validade < new Date().toISOString().slice(0, 10)) {
        setCupomErro("Esse cupom expirou.");
        return;
      }
      if (data.usos_maximos != null && data.usos_atual >= data.usos_maximos) {
        setCupomErro("Esse cupom já atingiu o limite de usos.");
        return;
      }
      setCupomAplicado({ codigo: data.codigo, tipo: data.tipo, valor: Number(data.valor) });
      setCupomInput("");
    } catch (e) {
      setCupomErro("Não foi possível validar o cupom agora.");
    } finally {
      setBuscandoCupom(false);
    }
  };

  const removerCupom = () => {
    setCupomAplicado(null);
    setCupomErro("");
  };

  const alterarQtd = (id, delta) => {
    setCarrinho((prev) => {
      const atual = prev[id] || 0;
      const nova = Math.max(0, atual + delta);
      return { ...prev, [id]: nova };
    });
    if (delta > 0) setCartBump((n) => n + 1);
  };

  const removerDoCarrinho = (id) => {
    setCarrinho((prev) => ({ ...prev, [id]: 0 }));
  };

  const buscarCep = async (cepDigitado) => {
    const digitos = cepDigitado.replace(/\D/g, "");
    setForm((f) => ({ ...f, cep: cepDigitado }));
    if (digitos.length !== 8) return;
    setBuscandoCep(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digitos}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setBairroForaDaArea("");
        if (bairrosEntrega.length > 0) {
          const alvo = (data.bairro || "").trim().toLowerCase();
          const encontrado = bairrosEntrega.find((b) => b.nome.trim().toLowerCase() === alvo);
          setForm((f) => ({ ...f, rua: data.logradouro || f.rua, bairro: encontrado ? encontrado.nome : "" }));
          if (data.bairro && !encontrado) setBairroForaDaArea(data.bairro);
        } else {
          setForm((f) => ({ ...f, rua: data.logradouro || f.rua, bairro: data.bairro || f.bairro }));
        }
      } else {
        setErro("CEP não encontrado. Preencha o endereço manualmente.");
      }
    } catch (e) {
      setErro("Não foi possível buscar o CEP agora. Preencha o endereço manualmente.");
    } finally {
      setBuscandoCep(false);
    }
  };

  const enviarPedido = async () => {
    if (lojaFechada) {
      setTela("cardapio");
      return;
    }
    if (!form.nome.trim()) {
      setErro("Informe seu nome para continuar.");
      return;
    }
    if (!form.telefone.trim()) {
      setErro("Informe seu telefone para continuar.");
      return;
    }
    if (!telefoneCompleto(form.telefone)) {
      setErro("Informe um telefone completo, com DDD, para continuar.");
      return;
    }
    if (form.tipoEntrega === "entrega" && (!form.rua.trim() || !form.numero.trim())) {
      setErro("Preencha o endereço de entrega (rua e número).");
      return;
    }
    if (form.tipoEntrega === "entrega" && bairrosEntrega.length > 0 && !form.bairro.trim()) {
      setErro("Selecione o seu bairro para calcular a entrega.");
      return;
    }
    if (form.formaPagamento === "Dinheiro" && form.precisaTroco && !form.trocoPara) {
      setErro("Informe para quanto precisa de troco.");
      return;
    }
    if (itensCarrinho.length === 0) {
      setErro("Seu carrinho está vazio.");
      return;
    }
    setErro("");
    setEnviando(true);
    try {
      const dataDoPedido = statusLoja.aberta ? new Date().toISOString().slice(0, 10) : diaEscolhido;
      const payload = {
        cliente_nome: form.nome.trim(),
        cliente_telefone: form.telefone.trim(),
        tipo_entrega: form.tipoEntrega,
        cep: form.tipoEntrega === "entrega" ? form.cep.trim() : null,
        endereco: form.tipoEntrega === "entrega" ? `${form.rua.trim()}, ${form.numero.trim()}` : null,
        bairro: form.tipoEntrega === "entrega" ? form.bairro.trim() : null,
        referencia: form.referencia.trim() || null,
        forma_pagamento: form.formaPagamento,
        precisa_troco: form.formaPagamento === "Dinheiro" ? form.precisaTroco : false,
        troco_para: form.formaPagamento === "Dinheiro" && form.precisaTroco && form.trocoPara ? Number(form.trocoPara) : null,
        itens: itensCarrinho.map(({ item, qtd }) => ({ nome: item.nome, preco: item.preco, qtd })),
        subtotal: subtotalCarrinho,
        taxa_entrega: taxaAplicada,
        cupom_codigo: cupomAplicado?.codigo || null,
        desconto: descontoAplicado,
        total: totalCarrinho,
        observacao: form.observacao.trim() || null,
        status: "pendente",
        data_pedido: dataDoPedido || null,
      };
      const { data, error } = await supabase.from("pedidos").insert(payload).select().single();
      if (error) throw error;

      // baixa o estoque dos itens e contabiliza o uso do cupom (funções seguras no banco)
      await Promise.all(itensCarrinho.map(({ item, qtd }) => supabase.rpc("decrementar_estoque", { p_item_id: item.id, p_quantidade: qtd })));
      if (cupomAplicado) await supabase.rpc("usar_cupom", { p_codigo: cupomAplicado.codigo });

      const pedido = mapPedidoFromDb(data);
      setPedidoAtual(pedido);
      try {
        localStorage.setItem("divinoFrango_pedidoId", pedido.id);
        localStorage.setItem("divinoFrango_pedidoSalvoEm", String(Date.now()));
      } catch (e) {
        // localStorage indisponível — sem problema, só não persiste entre recarregamentos
      }
      setTela("acompanhar");
    } catch (e) {
      // o banco recusa pedidos com a loja fechada; se foi isso, mostra o aviso de loja fechada em vez de erro genérico
      const cfg = await atualizarConfigLoja();
      if (cfg?.loja_fechada) {
        setErro("");
        setTela("cardapio");
      } else {
        setErro("Não foi possível enviar o pedido. Tente novamente.");
      }
    } finally {
      setEnviando(false);
    }
  };

  const novoPedido = () => {
    setCarrinho({});
    setPedidoAtual(null);
    setCupomAplicado(null);
    setCupomInput("");
    setCupomErro("");
    try {
      localStorage.removeItem("divinoFrango_pedidoId");
      localStorage.removeItem("divinoFrango_pedidoSalvoEm");
    } catch (e) {}
    setForm({
      nome: "", telefone: "", tipoEntrega: "retirada", cep: "", rua: "", numero: "", bairro: "",
      referencia: "", formaPagamento: "Dinheiro", precisaTroco: false, trocoPara: "", observacao: "",
    });
    setTela("cardapio");
  };

  // se o cliente tinha um pedido recente em andamento (últimas 6h), oferece continuar acompanhando
  useEffect(() => {
    (async () => {
      try {
        const id = localStorage.getItem("divinoFrango_pedidoId");
        const salvoEm = Number(localStorage.getItem("divinoFrango_pedidoSalvoEm") || 0);
        if (!id || Date.now() - salvoEm > 6 * 60 * 60 * 1000) return;
        const { data, error } = await supabase.from("pedidos").select("*").eq("id", id).single();
        if (error || !data) return;
        const pedido = mapPedidoFromDb(data);
        if (["pendente", "aceito", "preparando", "pronto"].includes(pedido.status)) {
          setPedidoAtual(pedido);
        }
      } catch (e) {
        // sem problema, apenas não restaura o acompanhamento
      }
    })();
  }, []);

  // acompanha o status do pedido atual em tempo real
  useEffect(() => {
    if (!pedidoAtual?.id || tela !== "acompanhar") return;
    const canal = supabase
      .channel(`pedido-${pedidoAtual.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pedidos", filter: `id=eq.${pedidoAtual.id}` }, (payload) => {
        setPedidoAtual(mapPedidoFromDb(payload.new));
      })
      .subscribe();
    return () => supabase.removeChannel(canal);
  }, [pedidoAtual?.id, tela]);

  if (!loaded) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", color: C.textSoft, fontFamily: "'DM Sans', sans-serif" }}>
        <Loader2 size={22} style={{ marginRight: 10 }} className="spin-loader" />
        Carregando cardápio…
        <style>{`.spin-loader { animation: spin-loader 1s linear infinite; } @keyframes spin-loader { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const telaComHero = tela === "cardapio";
  const tempoEntregaVisivel = tempoEntrega.mostrar && tempoEntrega.min > 0 && tempoEntrega.max >= tempoEntrega.min;
  const textoTempoEntrega =
    tempoEntrega.min === tempoEntrega.max
      ? `Tempo estimado de entrega: ${tempoEntrega.min} min`
      : `Tempo estimado de entrega: ${tempoEntrega.min}–${tempoEntrega.max} min`;
  const mostrarBarraCarrinho = tela === "cardapio" && qtdItensCarrinho > 0 && !lojaFechada;

  return (
    <>
      {/* Camada de fundo (frango assado) — elemento próprio com position:"fixed" cobrindo
          sempre 100% da viewport, ATRÁS de tudo (zIndex -1). Isso é diferente e muito mais
          confiável do que usar a propriedade CSS "background-attachment: fixed" no próprio
          container de conteúdo: essa propriedade tem suporte instável entre navegadores
          (falha silenciosamente em vários casos), o que fazia a foto aparecer só numa faixa
          do topo e ficar preta embaixo. Um elemento com position:"fixed" não depende dessa
          propriedade e funciona de forma consistente em desktop e mobile. */}
      {telaComHero && (
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: -1,
            pointerEvents: "none",
            backgroundColor: C.bg,
            backgroundImage: `linear-gradient(180deg, rgba(10,10,12,0.32) 0%, rgba(10,10,12,0.44) 45%, rgba(10,10,12,0.56) 100%), url(${BG_FRANGO_URL})`,
            backgroundSize: "cover",
            backgroundPosition: "center top",
            backgroundRepeat: "no-repeat",
          }}
        />
      )}
      <div
        style={{
          position: "relative",
          minHeight: "100vh",
          backgroundColor: telaComHero ? "transparent" : C.bg,
          fontFamily: "'DM Sans', sans-serif",
          color: C.text,
          paddingBottom: mostrarBarraCarrinho ? "calc(112px + env(safe-area-inset-bottom, 0px))" : 24,
        }}
      >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        body { -webkit-tap-highlight-color: transparent; }
        input, select, textarea, button { font-family: 'DM Sans', sans-serif; }
        button { cursor: pointer; }
        .mono { font-family: 'DM Mono', monospace; }
        .display { font-family: 'Sora', sans-serif; }
        ::placeholder { color: ${C.textFaint}; }
        .spin-loader { animation: spin-loader 1s linear infinite; }
        @keyframes spin-loader { to { transform: rotate(360deg); } }
        .no-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .cat-pill { transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease; }
        .cat-pill:active { transform: scale(0.96); }
        .add-btn, .qty-btn { transition: transform 0.12s ease, background 0.12s ease; }
        .add-btn:active, .qty-btn:active { transform: scale(0.88); }
        .qty-pop { animation: qty-pop 0.22s ease; }
        @keyframes qty-pop { 0% { transform: scale(1.35); } 100% { transform: scale(1); } }
        .cart-bar-in { animation: cart-bar-in 0.28s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes cart-bar-in { 0% { transform: translateY(10px) scale(0.97); opacity: 0.5; } 100% { transform: translateY(0) scale(1); opacity: 1; } }
        .menu-card { transition: transform 0.12s ease, border-color 0.12s ease; }
        .menu-card:hover { transform: translateY(-3px); border-color: ${C.orange}; }

        /* ===== Redesign responsivo (desktop) ===== */
        @media (min-width: 860px) {
          .df-header-inner, .df-hero-wrap, .df-content-wrap { max-width: 1180px !important; }
          .df-hero-wrap { padding-top: 68px !important; padding-bottom: 8px !important; }
          .df-hero-title { font-size: 48px !important; }
          .df-hero-sub { font-size: 16px !important; }
          .df-cat-scroll { flex-wrap: wrap !important; overflow-x: visible !important; justify-content: center !important; }
          .df-main-grid { display: grid !important; grid-template-columns: 1fr 360px !important; gap: 32px !important; align-items: start !important; }
          .df-products-grid { display: grid !important; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)) !important; gap: 20px !important; }
          .menu-card-img-wrap { height: 168px !important; }
          .menu-card-body { padding: 14px 14px 16px !important; }
          .df-cart-aside { display: block !important; position: sticky !important; top: 88px !important; }
          .df-checkout-aside { position: sticky !important; top: 88px !important; }
          .df-floating-cart-mobile { display: none !important; }
          .df-benefits { flex-direction: row !important; }
          .df-benefit-item { flex: 1 !important; border-top: none !important; border-left: 1px solid ${C.borderSoft} !important; }
          .df-benefit-item:first-child { border-left: none !important; }
        }
        @media (max-width: 859px) {
          .df-cart-aside { display: none !important; }
          html { -webkit-text-size-adjust: 100%; }
          /* 16px evita o zoom automático do iPhone ao tocar nos campos (nome, telefone, endereço...) */
          input, select, textarea { font-size: 16px !important; }

          /* cabeçalho e hero mais compactos no celular */
          .df-hero-wrap { padding-top: 6px !important; }
          .df-hero-title { font-size: 26px !important; }

          /* cardápio em 2 colunas: dá pra ver mais produtos sem rolar tanto */
          .df-products-grid { display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 10px !important; }
          .menu-card-img-wrap { height: 116px !important; }
          .menu-card-body { padding: 9px 10px 11px !important; }
          .menu-card-body > div:first-child { font-size: 13.5px !important; }
          .menu-card-body > div:nth-child(2) { font-size: 11.5px !important; }
          .menu-card-foot { flex-direction: column !important; align-items: stretch !important; gap: 8px !important; padding-top: 8px !important; }
          .menu-card-price { font-size: 15px !important; }
          .menu-card-foot .add-btn { width: 100% !important; height: 40px !important; border-radius: 12px !important; }
          .menu-card-qty { width: 100% !important; justify-content: space-between !important; }
          .menu-card-qty .qty-btn { width: 36px !important; height: 36px !important; }
          .menu-card:hover { transform: none; }
        }
        /* telas muito estreitas: volta para 1 coluna para não espremer o conteúdo */
        @media (max-width: 349px) {
          .df-products-grid { grid-template-columns: 1fr !important; }
          .menu-card-img-wrap { height: 150px !important; }
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          background: telaComHero ? "rgba(14,14,16,0.35)" : C.card,
          backdropFilter: telaComHero ? "blur(6px)" : "none",
          WebkitBackdropFilter: telaComHero ? "blur(6px)" : "none",
          borderBottom: telaComHero ? "none" : `1px solid ${C.border}`,
          padding: telaComHero ? "22px 20px 18px" : "16px 20px",
          position: telaComHero ? "relative" : "sticky",
          top: 0,
          zIndex: 20,
        }}
      >
        <div className="df-header-inner" style={{ maxWidth: 640, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            {tela !== "cardapio" && tela !== "confirmado" ? (
              <button
                onClick={() => setTela(tela === "checkout" ? "carrinho" : "cardapio")}
                style={{ background: C.cardAlt, border: "none", borderRadius: 10, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                aria-label="Voltar"
              >
                <ChevronLeft size={18} color={C.text} />
              </button>
            ) : (
              <img
                src={LOGO_URL}
                alt="Divino Frango"
                style={{
                  width: telaComHero ? 52 : 36,
                  height: telaComHero ? 52 : 36,
                  objectFit: "contain",
                  borderRadius: 12,
                  boxShadow: telaComHero ? "0 4px 16px rgba(0,0,0,0.5)" : "none",
                  flexShrink: 0,
                }}
              />
            )}
            <div style={{ minWidth: 0 }}>
              <div className="display" style={{ fontSize: telaComHero ? 22 : 16, fontWeight: 800, letterSpacing: 0.2, textShadow: telaComHero ? "0 2px 10px rgba(0,0,0,0.7)" : "none" }}>
                {tela === "carrinho" ? "Meu pedido" : tela === "checkout" ? "Finalizar pedido" : tela === "acompanhar" ? "Seu pedido" : "Divino Frango"}
              </div>
              {telaComHero && (
                <div style={{ fontSize: 12.5, color: C.orangeText, fontWeight: 700, marginTop: 1, textShadow: "0 1px 6px rgba(0,0,0,0.7)" }}>
                  O sabor que conquista
                </div>
              )}
            </div>
          </div>

          {telaComHero && qtdItensCarrinho > 0 && (
            <button
              onClick={() => setTela("carrinho")}
              aria-label={`Ver carrinho, ${qtdItensCarrinho} ${qtdItensCarrinho === 1 ? "item" : "itens"}`}
              style={{
                position: "relative", flexShrink: 0,
                background: "rgba(14,14,16,0.55)", border: `1px solid rgba(255,255,255,0.14)`,
                borderRadius: 999, width: 42, height: 42, display: "flex", alignItems: "center", justifyContent: "center",
                backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
              }}
            >
              <ShoppingCart size={19} color={C.text} />
              <span
                className="mono"
                style={{
                  position: "absolute", top: -5, right: -5, background: C.orange, color: "#0E0E10",
                  fontSize: 11, fontWeight: 800, minWidth: 19, height: 19, borderRadius: 999,
                  display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.45)",
                }}
              >
                {qtdItensCarrinho}
              </span>
            </button>
          )}
        </div>
      </div>

      {tela === "cardapio" && (
        <div className="df-hero-wrap" style={{ maxWidth: 640, margin: "0 auto", padding: "10px 16px 0", position: "relative", zIndex: 1 }}>
          <div style={{ textAlign: "center", marginBottom: 16, padding: "6px 4px 0" }}>
            <div
              className="display df-hero-title"
              style={{
                fontSize: 30,
                fontWeight: 800,
                lineHeight: 1.15,
                background: "linear-gradient(120deg, #FFD37A, #F5940A)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                textShadow: "0 2px 16px rgba(0,0,0,0.6)",
              }}
            >
              O sabor que conquista
            </div>
            <div className="df-hero-sub" style={{ fontSize: 12.5, color: "rgba(245,245,247,0.9)", marginTop: 5, textShadow: "0 1px 6px rgba(0,0,0,0.6)" }}>Escolha seus favoritos e monte seu pedido.</div>
            {tempoEntregaVisivel && (
              <div
                style={{
                  marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(28,18,4,0.85)",
                  border: "1px solid rgba(245,148,10,0.35)", color: C.orangeText, borderRadius: 999,
                  padding: "6px 12px", fontSize: 12.5, fontWeight: 700,
                }}
              >
                <Bike size={14} /> {textoTempoEntrega}
              </div>
            )}
          </div>

          <div className="no-scrollbar df-cat-scroll" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 14, WebkitOverflowScrolling: "touch" }}>
            {abasCategorias.map((cat) => {
              const ativa = categoriaAtiva === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setCategoriaAtiva(cat)}
                  className="cat-pill"
                  style={{
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                    padding: "9px 15px",
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 700,
                    border: `1px solid ${ativa ? C.orange : C.border}`,
                    background: ativa ? C.orange : C.cardAlt,
                    color: ativa ? "#0E0E10" : C.textSoft,
                  }}
                >
                  {cat === "Todos" ? "🛒 " : CATEGORIA_EMOJI[cat] ? `${CATEGORIA_EMOJI[cat]} ` : ""}{cat}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="df-content-wrap" style={{ maxWidth: 640, margin: "0 auto", padding: tela === "cardapio" ? "0 16px" : "16px 16px 0", position: "relative", zIndex: 1 }}>

        {/* ---------------- CARDÁPIO ---------------- */}
        {tela === "cardapio" && (
          <div className="df-main-grid">
          <div className="df-products-col">
            {pedidoAtual && (
              <button
                onClick={() => setTela("acompanhar")}
                style={{ ...btnOutline, width: "100%", marginBottom: 14, borderColor: C.orange, color: C.orangeText, background: "rgba(28,18,4,0.85)" }}
              >
                <ClipboardCheck size={16} /> Acompanhar meu pedido em andamento
              </button>
            )}
            {lojaFechada && (
              <div style={{ background: "rgba(40,14,14,0.90)", border: `1px solid ${C.red}`, borderRadius: 14, padding: "14px 16px", marginBottom: 14, display: "flex", gap: 12 }}>
                <Store size={20} color={C.red} style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: C.red, marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>Loja fechada</div>
                  <div style={{ fontSize: 14, color: C.text, lineHeight: 1.45 }}>{mensagemLojaFechada || "Estamos fechados no momento."}</div>
                </div>
              </div>
            )}
            {!lojaFechada && !statusLoja.aberta && horarios && (
              <div style={{ background: "rgba(28,18,4,0.90)", border: `1px solid ${C.orange}`, borderRadius: 12, padding: "12px 14px", marginBottom: 14, display: "flex", gap: 10 }}>
                <Clock size={18} color={C.orangeText} style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: C.orangeText, marginBottom: 3 }}>Fora do horário de atendimento</div>
                  <div style={{ fontSize: 12.5, color: C.textSoft, marginBottom: 4 }}>
                    Você pode fazer seu pedido normalmente — ele fica reservado para o próximo dia de funcionamento. {resumoHorarios(horarios)}
                    {configDiaEscolhido?.entregaAbre ? ` Nossa entrega começa às ${configDiaEscolhido.entregaAbre}.` : ""}
                  </div>
                </div>
              </div>
            )}
            {erro && <div style={{ background: "rgba(40,14,14,0.90)", border: `1px solid ${C.red}`, color: C.red, fontSize: 13, padding: "10px 12px", borderRadius: 10, marginBottom: 14 }}>{erro}</div>}
            {cardapio.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 16px", color: C.textFaint, fontSize: 14 }}>
                Cardápio ainda não disponível. Volte em instantes.
              </div>
            )}
            {cardapio.length > 0 && secoesExibidas.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 16px", color: C.textFaint, fontSize: 14 }}>
                Nenhum produto nesta categoria no momento.
              </div>
            )}
            {secoesExibidas.map(([categoria, itens]) => (
              <div key={categoria} style={{ marginBottom: 22 }}>
                {categoriaAtiva === "Todos" && categoria !== SEM_CATEGORIA && (
                  <div className="display" style={{ fontSize: 13.5, fontWeight: 700, color: C.orangeText, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    {CATEGORIA_EMOJI[categoria] ? `${CATEGORIA_EMOJI[categoria]} ` : ""}{categoria}
                  </div>
                )}
                <div className="df-products-grid" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {itens.map((item) => {
                    const qtd = carrinho[item.id] || 0;
                    const esgotado = item.estoque != null && item.estoque <= 0;
                    const limiteAtingido = item.estoque != null && qtd >= item.estoque;
                    const fotoQuebrada = !!imagensQuebradas[item.id];
                    const foto = !fotoQuebrada ? (item.fotoUrl || imagemPadraoProduto(item.nome)) : null;
                    return (
                      <div
                        key={item.id}
                        className="menu-card"
                        style={{
                          background: C.card,
                          border: `1px solid ${qtd > 0 ? C.orange : C.border}`,
                          borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column",
                          boxShadow: qtd > 0 ? "0 4px 18px rgba(245,148,10,0.16)" : "0 2px 10px rgba(0,0,0,0.18)",
                        }}
                      >
                        <div className="menu-card-img-wrap" style={{ position: "relative", width: "100%", height: 176, flexShrink: 0 }}>
                          {foto ? (
                            <img
                              src={foto}
                              alt={item.nome}
                              onError={() => setImagensQuebradas((m) => ({ ...m, [item.id]: true }))}
                              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", filter: esgotado ? "grayscale(1)" : "none", opacity: esgotado ? 0.6 : 1 }}
                            />
                          ) : (
                            <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, #2A2830, #201F23)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <UtensilsCrossed size={30} color={C.textFaint} />
                            </div>
                          )}
                          {esgotado && (
                            <span style={{ position: "absolute", left: 8, right: 8, bottom: 8, textAlign: "center", background: "rgba(14,14,16,0.88)", color: C.red, fontSize: 10.5, fontWeight: 800, borderRadius: 6, padding: "2px 0", textTransform: "uppercase", letterSpacing: 0.4 }}>
                              Esgotado
                            </span>
                          )}
                          {qtd > 0 && (
                            <span className="mono" style={{ position: "absolute", top: 8, right: 8, background: C.orange, color: "#0E0E10", fontSize: 11.5, fontWeight: 800, minWidth: 22, height: 22, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px", boxShadow: "0 2px 8px rgba(0,0,0,0.45)" }}>
                              {qtd}
                            </span>
                          )}
                        </div>
                        <div className="menu-card-body" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: "12px 14px 14px" }}>
                          <div style={{ fontSize: 15.5, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>{item.nome}</div>
                          {item.descricao && (
                            <div style={{ fontSize: 12.5, color: C.textSoft, marginTop: 3, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                              {item.descricao}
                            </div>
                          )}
                          <div className="menu-card-foot" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto", paddingTop: 8, gap: 8 }}>
                            <span className="mono menu-card-price" style={{ fontSize: 16, fontWeight: 700, color: C.orangeText }}>{fmt(item.preco)}</span>
                            {lojaFechada ? (
                              <span style={{ fontSize: 11.5, color: C.textFaint, fontWeight: 600 }}>Loja fechada</span>
                            ) : esgotado ? (
                              <span style={{ fontSize: 11.5, color: C.textFaint, fontWeight: 600 }}>Indisponível</span>
                            ) : qtd === 0 ? (
                              <button
                                onClick={() => alterarQtd(item.id, 1)}
                                className="add-btn"
                                style={{ background: C.orange, border: "none", borderRadius: 999, width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                                aria-label={`Adicionar ${item.nome}`}
                              >
                                <Plus size={19} color="#0E0E10" />
                              </button>
                            ) : (
                              <div className="menu-card-qty" style={{ display: "flex", alignItems: "center", gap: 8, background: C.cardAlt, borderRadius: 999, padding: 3 }}>
                                <button onClick={() => alterarQtd(item.id, -1)} className="qty-btn" style={{ background: C.card, border: "none", borderRadius: 999, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }} aria-label={`Diminuir ${item.nome}`}>
                                  <Minus size={14} color={C.text} />
                                </button>
                                <span key={qtd} className="mono qty-pop" style={{ fontSize: 14, fontWeight: 700, minWidth: 16, textAlign: "center", display: "inline-block" }}>{qtd}</span>
                                <button
                                  onClick={() => !limiteAtingido && alterarQtd(item.id, 1)}
                                  disabled={limiteAtingido}
                                  className="qty-btn"
                                  style={{ background: limiteAtingido ? C.card : C.orange, border: "none", borderRadius: 999, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", opacity: limiteAtingido ? 0.5 : 1 }}
                                  aria-label={`Aumentar ${item.nome}`}
                                >
                                  <Plus size={14} color={limiteAtingido ? C.textFaint : "#0E0E10"} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Benefícios — só faz sentido depois do cardápio carregado */}
            {cardapio.length > 0 && (
              <div
                className="df-benefits"
                style={{
                  display: "flex", flexDirection: "column", marginTop: 30, marginBottom: 10,
                  background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden",
                }}
              >
                {[
                  { icon: <Bike size={20} color={C.orange} />, titulo: "Entrega rápida e segura", texto: "Seu pedido no conforto de casa." },
                  { icon: <ClipboardCheck size={20} color={C.orange} />, titulo: "Qualidade garantida", texto: "Ingredientes selecionados todos os dias." },
                  { icon: <UtensilsCrossed size={20} color={C.orange} />, titulo: "Sabor que faz a diferença", texto: "Do jeito que você gosta, sempre." },
                ].map((b, i) => (
                  <div
                    key={b.titulo}
                    className="df-benefit-item"
                    style={{
                      display: "flex", gap: 12, alignItems: "flex-start", padding: "16px 18px",
                      borderTop: i > 0 ? `1px solid ${C.borderSoft}` : "none",
                    }}
                  >
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: C.orangeSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{b.icon}</div>
                    <div>
                      <div className="display" style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>{b.titulo}</div>
                      <div style={{ fontSize: 12.5, color: C.textSoft, lineHeight: 1.4 }}>{b.texto}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Carrinho lateral — visível só no computador; no celular o pedido segue pela barra flutuante */}
          <div className="df-cart-aside" style={{ display: "none" }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: 18 }}>
              <div className="display" style={{ fontSize: 16, fontWeight: 800, marginBottom: 14 }}>Seu pedido</div>
              {itensCarrinho.length === 0 ? (
                <div style={{ fontSize: 13, color: C.textFaint, padding: "18px 0", textAlign: "center" }}>Seu carrinho está vazio.</div>
              ) : (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14, maxHeight: 360, overflowY: "auto" }}>
                    {itensCarrinho.map(({ item, qtd }) => {
                      const fotoQuebrada = !!imagensQuebradas[item.id];
                      const foto = !fotoQuebrada ? (item.fotoUrl || imagemPadraoProduto(item.nome)) : null;
                      return (
                        <div key={item.id} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          {foto ? (
                            <img src={foto} alt={item.nome} style={{ width: 46, height: 46, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
                          ) : (
                            <div style={{ width: 46, height: 46, borderRadius: 10, background: C.cardAlt, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                              <UtensilsCrossed size={18} color={C.textFaint} />
                            </div>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.nome}</div>
                            <span className="mono" style={{ fontSize: 11.5, color: C.textSoft }}>{fmt(item.preco * qtd)}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                            <button onClick={() => alterarQtd(item.id, -1)} className="qty-btn" style={{ background: C.cardAlt, border: "none", borderRadius: 7, width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center" }} aria-label="Diminuir"><Minus size={12} color={C.text} /></button>
                            <span className="mono" style={{ fontSize: 12, fontWeight: 700, minWidth: 14, textAlign: "center" }}>{qtd}</span>
                            <button
                              onClick={() => (item.estoque == null || qtd < item.estoque) && alterarQtd(item.id, 1)}
                              disabled={item.estoque != null && qtd >= item.estoque}
                              className="qty-btn"
                              style={{ background: item.estoque != null && qtd >= item.estoque ? C.cardAlt : C.orange, border: "none", borderRadius: 7, width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center" }}
                              aria-label="Aumentar"
                            ><Plus size={12} color={item.estoque != null && qtd >= item.estoque ? C.textFaint : "#0E0E10"} /></button>
                            <button onClick={() => removerDoCarrinho(item.id)} className="qty-btn" style={{ background: "none", border: "none", padding: 4 }} aria-label={`Remover ${item.nome}`}><Trash2 size={14} color={C.textFaint} /></button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${C.borderSoft}`, paddingTop: 12, marginBottom: 14 }}>
                    <span style={{ fontSize: 13.5, color: C.textSoft, fontWeight: 600 }}>Total</span>
                    <span className="mono" style={{ fontSize: 19, fontWeight: 800, color: C.orangeText }}>{fmt(totalCarrinho)}</span>
                  </div>
                  <button onClick={() => setTela("checkout")} disabled={lojaFechada} style={{ ...btnPrimary, opacity: lojaFechada ? 0.6 : 1 }}>
                    Ver meu pedido <ChevronRight size={16} />
                  </button>
                </>
              )}
            </div>
          </div>
          </div>
        )}

        {/* ---------------- CARRINHO ---------------- */}
        {tela === "carrinho" && (
          <>
            {itensCarrinho.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 16px", color: C.textFaint, fontSize: 14 }}>Seu carrinho está vazio.</div>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                  {itensCarrinho.map(({ item, qtd }) => (
                    <div key={item.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{item.nome}</div>
                        <span className="mono" style={{ fontSize: 12.5, color: C.textSoft }}>{fmt(item.preco)} cada · <span style={{ color: C.orangeText, fontWeight: 700 }}>{fmt(item.preco * qtd)}</span></span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        <button onClick={() => alterarQtd(item.id, -1)} className="qty-btn" style={{ background: C.cardAlt, border: "none", borderRadius: 8, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center" }} aria-label="Diminuir">
                          <Minus size={14} color={C.text} />
                        </button>
                        <span key={qtd} className="mono qty-pop" style={{ fontSize: 14, fontWeight: 700, minWidth: 16, textAlign: "center", display: "inline-block" }}>{qtd}</span>
                        <button
                          onClick={() => (item.estoque == null || qtd < item.estoque) && alterarQtd(item.id, 1)}
                          disabled={item.estoque != null && qtd >= item.estoque}
                          className="qty-btn"
                          style={{ background: item.estoque != null && qtd >= item.estoque ? C.cardAlt : C.orange, border: "none", borderRadius: 8, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", opacity: item.estoque != null && qtd >= item.estoque ? 0.5 : 1 }}
                          aria-label="Aumentar"
                        >
                          <Plus size={14} color="#0E0E10" />
                        </button>
                        <button onClick={() => removerDoCarrinho(item.id)} className="qty-btn" style={{ background: "none", border: "none", padding: 6, marginLeft: 2 }} aria-label={`Remover ${item.nome}`}>
                          <Trash2 size={16} color={C.textFaint} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, padding: "0 4px" }}>
                  <span style={{ fontSize: 14, color: C.textSoft }}>Total</span>
                  <span className="mono" style={{ fontSize: 19, fontWeight: 700, color: C.orangeText }}>{fmt(totalCarrinho)}</span>
                </div>
                <button onClick={() => setTela("checkout")} style={btnPrimary}>Continuar pedido</button>
              </>
            )}
          </>
        )}

        {/* ---------------- CHECKOUT ---------------- */}
        {tela === "checkout" && (
          <div className="df-main-grid">
          <div className="df-products-col">
            <div className="display" style={{ fontSize: 20, fontWeight: 800, marginBottom: 16 }}>Faça seu pedido</div>

            {erro && <div style={{ background: "rgba(248,113,113,0.14)", color: C.red, fontSize: 13, padding: "10px 12px", borderRadius: 10, marginBottom: 14 }}>{erro}</div>}

            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: C.orangeSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 20 }}>
                <User size={16} color={C.orangeText} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: C.textSoft, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3 }}>Nome completo <span style={{ color: C.orangeText }}>*</span></div>
                <input placeholder="Digite seu nome" value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} style={inputStyle} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: C.orangeSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 20 }}>
                <Phone size={16} color={C.orangeText} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: C.textSoft, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3 }}>Telefone / WhatsApp <span style={{ color: C.orangeText }}>*</span></div>
                <input
                  placeholder="(11) 98765-4321"
                  value={form.telefone}
                  onChange={(e) => setForm((f) => ({ ...f, telefone: mascaraTelefone(e.target.value) }))}
                  inputMode="numeric"
                  maxLength={16}
                  style={inputStyle}
                />
              </div>
            </div>

            {!statusLoja.aberta && proximosDiasAbertos.length > 0 && (
              <>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: C.textSoft, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3 }}>Para qual dia é o pedido?</div>
                <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                  {proximosDiasAbertos.map((d) => (
                    <button
                      key={d.iso}
                      onClick={() => setDiaEscolhido(d.iso)}
                      style={{
                        padding: "8px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, textTransform: "capitalize",
                        border: `1px solid ${diaEscolhido === d.iso ? C.orange : C.border}`,
                        background: diaEscolhido === d.iso ? C.orangeSoft : "transparent",
                        color: diaEscolhido === d.iso ? C.orangeText : C.textSoft,
                      }}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div style={{ fontSize: 11.5, fontWeight: 600, color: C.textSoft, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3 }}>Retirada ou entrega?</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <button
                onClick={() => setForm((f) => ({ ...f, tipoEntrega: "retirada" }))}
                style={{ ...btnOutline, flex: 1, borderColor: form.tipoEntrega === "retirada" ? C.orange : C.border, background: form.tipoEntrega === "retirada" ? C.orangeSoft : "transparent", color: form.tipoEntrega === "retirada" ? C.orangeText : C.textSoft }}
              >
                <Store size={16} /> Retirada
              </button>
              <button
                onClick={() => setForm((f) => ({ ...f, tipoEntrega: "entrega" }))}
                style={{
                  ...btnOutline, flex: 1,
                  borderColor: form.tipoEntrega === "entrega" ? C.orange : C.border,
                  background: form.tipoEntrega === "entrega" ? C.orangeSoft : "transparent",
                  color: form.tipoEntrega === "entrega" ? C.orangeText : C.textSoft,
                }}
              >
                <Bike size={16} /> Entrega
              </button>
            </div>
            {(configDiaEscolhido || horarios) && (
              <div style={{ fontSize: 11.5, color: C.textFaint, marginBottom: 12 }}>
                Nossa entrega começa às {(statusLoja.aberta ? horarios?.[new Date().getDay()]?.entregaAbre : configDiaEscolhido?.entregaAbre) || "11:00"}
                {!statusLoja.aberta ? " no dia escolhido acima." : " hoje."}
              </div>
            )}

            {form.tipoEntrega === "entrega" && tempoEntregaVisivel && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: C.orangeText, marginBottom: 12 }}>
                <Bike size={14} /> {textoTempoEntrega}
              </div>
            )}

            {form.tipoEntrega === "entrega" && (
              <>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: C.textSoft, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3 }}>CEP</div>
                <div style={{ position: "relative", marginBottom: 12 }}>
                  <input
                    placeholder="00000-000"
                    value={form.cep}
                    onChange={(e) => buscarCep(e.target.value)}
                    maxLength={9}
                    style={inputStyle}
                  />
                  {buscandoCep && <Loader2 size={16} className="spin-loader" style={{ position: "absolute", right: 12, top: 13 }} color={C.textSoft} />}
                </div>

                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <div style={{ flex: 2 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: C.textSoft, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3 }}>Rua</div>
                    <input placeholder="Rua" value={form.rua} onChange={(e) => setForm((f) => ({ ...f, rua: e.target.value }))} style={inputStyle} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: C.textSoft, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3 }}>Número</div>
                    <input placeholder="Nº" value={form.numero} onChange={(e) => setForm((f) => ({ ...f, numero: e.target.value }))} style={inputStyle} />
                  </div>
                </div>

                <div style={{ fontSize: 11.5, fontWeight: 600, color: C.textSoft, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3 }}>Bairro</div>
                {bairrosEntrega.length > 0 ? (
                  <>
                    <select
                      value={form.bairro}
                      onChange={(e) => { setForm((f) => ({ ...f, bairro: e.target.value })); setBairroForaDaArea(""); }}
                      style={{ ...inputStyle, marginBottom: bairroForaDaArea ? 6 : 12 }}
                    >
                      <option value="">Selecione seu bairro</option>
                      {bairrosEntrega.map((b) => (
                        <option key={b.id} value={b.nome}>{b.nome}</option>
                      ))}
                    </select>
                    {bairroForaDaArea && (
                      <div style={{ fontSize: 12, color: C.orangeText, marginBottom: 12 }}>
                        Seu CEP indica o bairro "{bairroForaDaArea}", que ainda não está na nossa área de entrega. Selecione um bairro atendido acima ou escolha retirada.
                      </div>
                    )}
                  </>
                ) : (
                  <input placeholder="Bairro" value={form.bairro} onChange={(e) => setForm((f) => ({ ...f, bairro: e.target.value }))} style={{ ...inputStyle, marginBottom: 12 }} />
                )}
                <div style={{ fontSize: 11.5, fontWeight: 600, color: C.textSoft, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3 }}>Ponto de referência (opcional)</div>
                <input placeholder="Ex: perto do mercado tal" value={form.referencia} onChange={(e) => setForm((f) => ({ ...f, referencia: e.target.value }))} style={{ ...inputStyle, marginBottom: 12 }} />
              </>
            )}

            <div style={{ fontSize: 11.5, fontWeight: 600, color: C.textSoft, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3 }}>Forma de pagamento</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              {FORMAS_PAGAMENTO.map((fp) => (
                <button
                  key={fp}
                  onClick={() => setForm((f) => ({ ...f, formaPagamento: fp, precisaTroco: false, trocoPara: "" }))}
                  style={{
                    padding: "8px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 600,
                    border: `1px solid ${form.formaPagamento === fp ? C.orange : C.border}`,
                    background: form.formaPagamento === fp ? C.orangeSoft : "transparent",
                    color: form.formaPagamento === fp ? C.orangeText : C.textSoft,
                    display: "inline-flex", alignItems: "center", gap: 6,
                  }}
                >
                  {fp === "Pix pela maquininha" && <CreditCard size={13} />} {fp}
                </button>
              ))}
            </div>

            {form.formaPagamento === "Dinheiro" && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: C.textSoft, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3 }}>Precisa de troco?</div>
                <div style={{ display: "flex", gap: 8, marginBottom: form.precisaTroco ? 10 : 0 }}>
                  <button
                    onClick={() => setForm((f) => ({ ...f, precisaTroco: false, trocoPara: "" }))}
                    style={{ ...btnOutline, flex: 1, borderColor: !form.precisaTroco ? C.orange : C.border, background: !form.precisaTroco ? C.orangeSoft : "transparent", color: !form.precisaTroco ? C.orangeText : C.textSoft }}
                  >
                    Não
                  </button>
                  <button
                    onClick={() => setForm((f) => ({ ...f, precisaTroco: true }))}
                    style={{ ...btnOutline, flex: 1, borderColor: form.precisaTroco ? C.orange : C.border, background: form.precisaTroco ? C.orangeSoft : "transparent", color: form.precisaTroco ? C.orangeText : C.textSoft }}
                  >
                    Sim
                  </button>
                </div>
                {form.precisaTroco && (
                  <input
                    type="number"
                    placeholder="Troco para quanto? Ex: 100"
                    value={form.trocoPara}
                    onChange={(e) => setForm((f) => ({ ...f, trocoPara: e.target.value }))}
                    style={inputStyle}
                  />
                )}
              </div>
            )}

            {cupomAtivoSite && (
              <>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: C.textSoft, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3 }}>Cupom de desconto (opcional)</div>
                {cupomAplicado ? (
                  <div style={{ background: C.greenSoft, border: `1px solid ${C.green}`, borderRadius: 10, padding: "10px 12px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.green }} className="mono">{cupomAplicado.codigo} aplicado</span>
                    <button onClick={removerCupom} style={{ background: "none", border: "none" }} aria-label="Remover cupom"><Minus size={15} color={C.green} /></button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8, marginBottom: cupomErro ? 6 : 12 }}>
                    <input placeholder="Código do cupom" value={cupomInput} onChange={(e) => setCupomInput(e.target.value)} style={{ ...inputStyle, flex: 1, textTransform: "uppercase" }} />
                    <button onClick={aplicarCupom} disabled={buscandoCupom} style={{ ...btnOutline, flexShrink: 0 }}>
                      {buscandoCupom ? <Loader2 size={15} className="spin-loader" /> : "Aplicar"}
                    </button>
                  </div>
                )}
                {cupomErro && <div style={{ fontSize: 12, color: C.red, marginBottom: 12 }}>{cupomErro}</div>}
              </>
            )}

            <div style={{ fontSize: 11.5, fontWeight: 600, color: C.textSoft, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3 }}>Observação (opcional)</div>
            <input placeholder="" value={form.observacao} onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))} style={{ ...inputStyle, marginBottom: 18 }} />
          </div>

          <div className="df-checkout-aside">
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: 18 }}>
              <div className="display" style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Resumo do pedido</div>
              {itensCarrinho.map(({ item, qtd }) => (
                <div key={item.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                  <span style={{ color: C.textSoft }}>{qtd}x {item.nome}</span>
                  <span className="mono">{fmt(item.preco * qtd)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 6, paddingTop: 6, borderTop: `1px solid ${C.borderSoft}` }}>
                <span style={{ color: C.textSoft }}>Subtotal</span>
                <span className="mono">{fmt(subtotalCarrinho)}</span>
              </div>
              {descontoAplicado > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 4 }}>
                  <span style={{ color: C.green }}>Desconto ({cupomAplicado?.codigo})</span>
                  <span className="mono" style={{ color: C.green }}>− {fmt(descontoAplicado)}</span>
                </div>
              )}
              {form.tipoEntrega === "entrega" && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 4 }}>
                  <span style={{ color: C.textSoft }}>Taxa de entrega</span>
                  <span className="mono">{fmt(taxaAplicada)}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 700, borderTop: `1px solid ${C.borderSoft}`, paddingTop: 8, marginTop: 6, marginBottom: 16 }}>
                <span>Total</span>
                <span className="mono" style={{ color: C.orangeText }}>{fmt(totalCarrinho)}</span>
              </div>

              <button onClick={enviarPedido} disabled={enviando} style={{ ...btnPrimary, opacity: enviando ? 0.7 : 1 }}>
                {enviando ? <Loader2 size={17} className="spin-loader" /> : <Check size={17} />} {enviando ? "Enviando…" : "Enviar pedido"}
              </button>
            </div>
          </div>
          </div>
        )}

        {/* ---------------- ACOMPANHAR PEDIDO ---------------- */}
        {tela === "acompanhar" && pedidoAtual && (
          <div style={{ padding: "20px 0" }}>
            {["recusado", "cancelado"].includes(pedidoAtual.status) ? (
              <div style={{ textAlign: "center", padding: "40px 16px" }}>
                <div style={{ width: 64, height: 64, borderRadius: "50%", background: C.redSoft || "rgba(248,113,113,0.14)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}>
                  <Clock size={28} color={C.red} />
                </div>
                <div className="display" style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
                  {pedidoAtual.status === "cancelado" ? "Pedido cancelado" : "Pedido não aceito"}
                </div>
                <div style={{ fontSize: 13.5, color: C.textSoft, marginBottom: 24, lineHeight: 1.5 }}>
                  {pedidoAtual.status === "cancelado"
                    ? "A loja cancelou este pedido. Entre em contato para saber mais ou faça um novo pedido."
                    : "A loja não conseguiu aceitar seu pedido dessa vez. Entre em contato ou tente novamente."}
                </div>
                <button onClick={novoPedido} style={btnPrimary}>Fazer novo pedido</button>
              </div>
            ) : (
              <>
                <div style={{ textAlign: "center", marginBottom: 28 }}>
                  <div className="display" style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
                    {pedidoAtual.status === "concluido" ? "Pedido concluído!" : "Acompanhando seu pedido"}
                  </div>
                  <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: C.orangeText }}>{fmt(pedidoAtual.total)}</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column" }}>
                  {[
                    { key: "pendente", label: "Pedido recebido" },
                    { key: "aceito", label: "Aceito pela loja" },
                    { key: "preparando", label: "Em preparo" },
                    { key: "pronto", label: pedidoAtual.tipoEntrega === "entrega" ? "Saiu para entrega" : "Pronto para retirada" },
                    { key: "concluido", label: pedidoAtual.tipoEntrega === "entrega" ? "Entregue" : "Retirado" },
                  ].map((etapa, i) => {
                    const indiceAtual = ETAPAS.indexOf(pedidoAtual.status);
                    const feito = i < indiceAtual;
                    const atual = i === indiceAtual;
                    const futuro = i > indiceAtual;
                    return (
                      <div key={etapa.key} style={{ display: "flex", gap: 14 }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <div style={{
                            width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                            background: feito ? C.greenSoft : atual ? C.orangeSoft : C.cardAlt,
                            border: atual ? `2px solid ${C.orange}` : "none",
                          }}>
                            {feito ? <Check size={15} color={C.green} /> : atual ? <CircleDashed size={15} color={C.orange} className="spin-loader" /> : <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.textFaint }} />}
                          </div>
                          {i < 4 && <div style={{ width: 2, flex: 1, minHeight: 28, background: feito ? C.green : C.border, margin: "2px 0" }} />}
                        </div>
                        <div style={{ paddingBottom: 24 }}>
                          <div style={{ fontSize: 14, fontWeight: atual ? 700 : 600, color: futuro ? C.textFaint : C.text }}>{etapa.label}</div>
                          {atual && <div style={{ fontSize: 12, color: C.orangeText, marginTop: 2 }}>Em andamento…</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {pedidoAtual.status === "concluido" && (
                  <button onClick={novoPedido} style={{ ...btnPrimary, width: "100%", marginTop: 8 }}>Fazer novo pedido</button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Barra flutuante do carrinho */}
      {mostrarBarraCarrinho && (
        <button
          key={cartBump}
          onClick={() => setTela("carrinho")}
          className="cart-bar-in df-floating-cart-mobile"
          style={{
            position: "fixed",
            bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
            left: 16, right: 16, maxWidth: 640, margin: "0 auto",
            background: C.orange, color: "#0E0E10", border: "none", borderRadius: 16,
            padding: "12px 16px", display: "flex", flexDirection: "column", gap: 4,
            boxShadow: "0 10px 26px rgba(245,148,10,0.45)", zIndex: 25,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700 }}>
              <ShoppingCart size={17} /> {qtdItensCarrinho} {qtdItensCarrinho === 1 ? "item" : "itens"}
            </span>
            <span className="mono" style={{ fontSize: 15, fontWeight: 800 }}>{fmt(totalCarrinho)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Ver meu pedido <ChevronRight size={14} />
          </div>
        </button>
      )}
    </div>
    </>
  );
}
