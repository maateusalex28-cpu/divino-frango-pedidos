import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus, Minus, Check, Store, Bike, ChevronLeft, Loader2, UtensilsCrossed, Clock, ClipboardCheck, CircleDashed, Trash2,
  CreditCard, User, Flame, Soup, Gift, CupSoda, Drumstick, Utensils, ShoppingBag, ArrowRight, Timer, Wallet, CalendarClock, BadgeCheck,
} from "lucide-react";
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
  // (removidas as fotos de farofa, linguiça e coxa, que davam 404, e a de maionese, que mostrava outro prato;
  // a lata de Coca agora só aparece para Coca, nunca para outro refrigerante)
  { match: /frango/i, url: FOTO_FRANGO_PRODUTO },
  { match: /arroz/i, url: "https://images.unsplash.com/photo-1625980319455-985e5442c5ae?auto=format&fit=crop&w=600&q=75" },
  { match: /coca/i, url: "https://images.unsplash.com/photo-1554866585-cd94860890b7?auto=format&fit=crop&w=600&q=75" },
];
// fotos do Supabase Storage chegam como PNG de 2-3 MB. Pedimos uma versão reduzida (WebP na largura
// certa) pelo serviço de transformação de imagens do Supabase; se ele falhar, a tela cai para a original.
const SUPABASE_OBJ = "/storage/v1/object/public/";
const fotoOtimizada = (url, largura) =>
  url && url.includes(SUPABASE_OBJ) ? `${url.replace(SUPABASE_OBJ, "/storage/v1/render/image/public/")}?width=${largura}&height=${largura}&resize=contain&quality=72` : url;

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


// categorias oficiais do cardápio, nesta ordem exata
const CATEGORIAS_ORDEM = ["Assados", "Acompanhamentos", "Combos", "Bebidas"];
const CATEGORIA_ICONE = { Assados: Flame, Acompanhamentos: Soup, Combos: Gift, Bebidas: CupSoda };

// WhatsApp da loja para dúvidas (abre a conversa já com uma mensagem pronta)
const WHATSAPP_NUMERO = "5547997050828";
const WHATSAPP_EXIBICAO = "(47) 99705-0828";
const LINK_WHATSAPP = `https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent("Olá! Vim pelo site do Divino Frango e tenho uma dúvida.")}`;

// marca oficial do WhatsApp (caminho do Simple Icons, simpleicons.org); o lucide não tem logos de marcas
const IconeWhatsApp = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
  </svg>
);

// título do topo, palavra por palavra (cada uma entra com um pequeno atraso)
const TITULO_HERO = "Frango assado na hora, do jeito que só o Divino faz."
  .split(" ")
  .map((texto, i) => ({ texto, destaque: i >= 4 }));

// fagulhas de brasa subindo na foto do topo (posição %, tamanho px, atraso s, duração s, desvio lateral px)
const BRASAS = [
  { x: 6, s: 4, d: 0, t: 5.2, dx: 14 }, { x: 14, s: 3, d: 1.8, t: 6.1, dx: -10 }, { x: 22, s: 5, d: 3.1, t: 4.8, dx: 18 },
  { x: 31, s: 3, d: 0.9, t: 5.7, dx: -16 }, { x: 39, s: 4, d: 2.6, t: 6.4, dx: 12 }, { x: 47, s: 2, d: 4.2, t: 5.1, dx: -8 },
  { x: 55, s: 4, d: 1.3, t: 5.9, dx: 20 }, { x: 63, s: 3, d: 3.7, t: 4.6, dx: -14 }, { x: 71, s: 5, d: 0.4, t: 6.6, dx: 10 },
  { x: 79, s: 3, d: 2.2, t: 5.3, dx: -18 }, { x: 87, s: 4, d: 4.6, t: 6.0, dx: 8 }, { x: 94, s: 2, d: 1.5, t: 4.9, dx: -12 },
];
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

const C = {
  bg: "#0F0D0C",
  card: "#181513",
  cardAlt: "#24201D",
  border: "#38312C",
  borderSoft: "#27221F",
  text: "#F7F2EC",
  textSoft: "#B8AFA6",
  textFaint: "#8C8279",
  ink: "#140F0C",
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
  width: "100%", padding: "13px 14px", borderRadius: 12, border: `1px solid ${C.border}`,
  background: C.cardAlt, color: C.text, fontSize: 15, transition: "border-color .15s ease, box-shadow .15s ease",
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

  // vitrine do topo: frangos e combos com foto cadastrada, passando sozinhos como "stories"
  const slidesHero = useMemo(() => {
    const comFoto = cardapio.filter((i) => i.fotoUrl && !(i.estoque != null && i.estoque <= 0));
    const frangos = comFoto.filter((i) => categoriaDoItem(i) === "Assados" && /frango/i.test(i.nome));
    const combos = comFoto.filter((i) => categoriaDoItem(i) === "Combos");
    return [...frangos, ...combos].slice(0, 4);
  }, [cardapio]);
  const [slide, setSlide] = useState(0);
  const [fotosOriginais, setFotosOriginais] = useState({}); // { [itemId]: true } quando a versão reduzida falhou

  useEffect(() => {
    if (slidesHero.length < 2) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    // "slide" nas dependências: tocar numa barrinha reinicia a contagem
    const t = setInterval(() => {
      if (document.visibilityState === "visible") setSlide((s) => (s + 1) % slidesHero.length);
    }, 5200);
    return () => clearInterval(t);
  }, [slidesHero.length, slide]);

  // sugestões para completar o pedido (acompanhamentos e bebidas que ainda não estão no carrinho)
  const sugestoes = useMemo(
    () =>
      cardapio
        .filter((i) => ["Acompanhamentos", "Bebidas"].includes(categoriaDoItem(i)) && !carrinho[i.id] && !(i.estoque != null && i.estoque <= 0))
        .slice(0, 6),
    [cardapio, carrinho]
  );

  const menuRef = useRef(null);
  const [toast, setToast] = useState(null); // { nome, k } aviso rápido de "adicionado"

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  if (!loaded) {
    return (
      <div className="df-loading">
        <style>{CSS}</style>
        <div className="df-loading-inner">
          <img src={LOGO_URL} alt="" width={64} height={64} />
          <div className="sk sk-title" />
          <div className="sk sk-line" />
          <div className="sk-grid">
            {[0, 1, 2, 3].map((i) => <div key={i} className="sk sk-card" />)}
          </div>
        </div>
      </div>
    );
  }

  const tempoEntregaVisivel = tempoEntrega.mostrar && tempoEntrega.min > 0 && tempoEntrega.max >= tempoEntrega.min;
  const faixaTempo = tempoEntrega.min === tempoEntrega.max ? `${tempoEntrega.min} min` : `${tempoEntrega.min} a ${tempoEntrega.max} min`;
  const textoTempoEntrega = `Tempo estimado de entrega: ${faixaTempo}`;
  const mostrarBarraCarrinho = tela === "cardapio" && qtdItensCarrinho > 0 && !lojaFechada;

  // selo de status no cabeçalho: aberto até X, fecha em N min, encomendas ou fechado
  const statusSelo = (() => {
    if (lojaFechada) return { tom: "off", texto: "Fechado agora" };
    if (!horarios) return null;
    const cfgHoje = horarios[new Date().getDay()];
    if (statusLoja.aberta && cfgHoje?.fecha) {
      const [h, m] = cfgHoje.fecha.split(":").map(Number);
      const fim = new Date();
      fim.setHours(h, m, 0, 0);
      const faltam = Math.round((fim.getTime() - Date.now()) / 60000);
      if (faltam > 0 && faltam <= 60) return { tom: "urgente", texto: `Fecha em ${faltam} min` };
      return { tom: "on", texto: `Aberto até ${cfgHoje.fecha}` };
    }
    return proximosDiasAbertos.length > 0 ? { tom: "agenda", texto: "Aceitando encomendas" } : { tom: "off", texto: "Fechado agora" };
  })();

  const fotoDe = (item, largura = 480) => {
    if (imagensQuebradas[item.id]) return null;
    const original = item.fotoUrl || imagemPadraoProduto(item.nome);
    return fotosOriginais[item.id] ? original : fotoOtimizada(original, largura);
  };
  // 1º erro: tenta a foto original (sem redução); 2º erro: mostra o ícone no lugar
  const marcarQuebrada = (item) => {
    const original = item.fotoUrl || imagemPadraoProduto(item.nome);
    if (!fotosOriginais[item.id] && fotoOtimizada(original, 1) !== original) setFotosOriginais((m) => ({ ...m, [item.id]: true }));
    else setImagensQuebradas((m) => ({ ...m, [item.id]: true }));
  };

  const adicionar = (item) => {
    alterarQtd(item.id, 1);
    setToast({ nome: item.nome, k: Date.now() });
  };

  const irParaCardapio = () => {
    const reduzir = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    menuRef.current?.scrollIntoView({ behavior: reduzir ? "auto" : "smooth", block: "start" });
  };

  const renderFoto = (item, className, largura) => {
    const foto = fotoDe(item, largura);
    const esgotado = item.estoque != null && item.estoque <= 0;
    const Icone = CATEGORIA_ICONE[categoriaDoItem(item)] || Drumstick;
    return foto ? (
      <img
        src={foto}
        alt={item.nome}
        loading="lazy"
        decoding="async"
        onError={() => marcarQuebrada(item)}
        className={`${className}${esgotado ? " is-esgotado" : ""}`}
      />
    ) : (
      <div className={`${className} ph`} aria-hidden="true">
        <Icone size={30} strokeWidth={1.6} />
      </div>
    );
  };

  // botão de adicionar ou seletor de quantidade, conforme o item já esteja no carrinho
  const renderAcao = (item, grande = false) => {
    const qtd = carrinho[item.id] || 0;
    const esgotado = item.estoque != null && item.estoque <= 0;
    const limiteAtingido = item.estoque != null && qtd >= item.estoque;
    if (lojaFechada) return <span className="acao-off">Loja fechada</span>;
    if (esgotado) return <span className="acao-off">Esgotado</span>;
    if (qtd === 0) {
      return grande ? (
        <button className="btn btn-primary btn-lg" onClick={() => adicionar(item)}>
          <Plus size={18} strokeWidth={2.4} /> Adicionar
        </button>
      ) : (
        <button className="add-fab" onClick={() => adicionar(item)} aria-label={`Adicionar ${item.nome}`}>
          <Plus size={20} strokeWidth={2.4} />
        </button>
      );
    }
    return (
      <div className={`stepper${grande ? " stepper-lg" : ""}`}>
        <button onClick={() => alterarQtd(item.id, -1)} aria-label={`Diminuir ${item.nome}`}>
          <Minus size={grande ? 16 : 14} strokeWidth={2.4} />
        </button>
        <span key={qtd} className="qty-pop">{qtd}</span>
        <button
          onClick={() => !limiteAtingido && alterarQtd(item.id, 1)}
          disabled={limiteAtingido}
          className="is-plus"
          aria-label={`Aumentar ${item.nome}`}
        >
          <Plus size={grande ? 16 : 14} strokeWidth={2.4} />
        </button>
      </div>
    );
  };

  const seloEstoque = (item) => {
    if (item.estoque == null || item.estoque <= 0 || item.estoque > 5) return null;
    return <span className="selo-estoque">{item.estoque === 1 ? "Última unidade" : `Só restam ${item.estoque}`}</span>;
  };

  const labelStyle = { fontSize: 13, fontWeight: 600, color: C.textSoft, marginBottom: 6, display: "block" };

  const linhaCarrinho = (item, qtd, compacto) => {
    const limite = item.estoque != null && qtd >= item.estoque;
    return (
      <div key={item.id} className={`cart-row${compacto ? " is-compact" : ""}`}>
        {renderFoto(item, "cart-thumb", 160)}
        <div className="cart-row-info">
          <div className="cart-row-nome">{item.nome}</div>
          <div className="cart-row-preco num">{fmt(item.preco * qtd)}</div>
        </div>
        <div className="stepper stepper-sm">
          <button onClick={() => alterarQtd(item.id, -1)} aria-label={`Diminuir ${item.nome}`}>
            {qtd === 1 ? <Trash2 size={13} /> : <Minus size={13} strokeWidth={2.4} />}
          </button>
          <span key={qtd} className="qty-pop">{qtd}</span>
          <button onClick={() => !limite && alterarQtd(item.id, 1)} disabled={limite} className="is-plus" aria-label={`Aumentar ${item.nome}`}>
            <Plus size={13} strokeWidth={2.4} />
          </button>
        </div>
      </div>
    );
  };

  const blocoSugestoes = sugestoes.length > 0 && !lojaFechada && (
    <div className="sugestoes">
      <div className="sugestoes-titulo">Combina com seu pedido</div>
      <div className="sugestoes-scroll no-scrollbar">
        {sugestoes.map((item) => (
          <div key={item.id} className="sug-card">
            {renderFoto(item, "sug-img", 320)}
            <div className="sug-nome">{item.nome}</div>
            <div className="sug-foot">
              <span className="num">{fmt(item.preco)}</span>
              <button className="add-fab add-fab-sm" onClick={() => adicionar(item)} aria-label={`Adicionar ${item.nome}`}>
                <Plus size={16} strokeWidth={2.6} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const indiceSlide = slidesHero.length ? slide % slidesHero.length : 0;
  const slideAtual = slidesHero[indiceSlide] || null;

  return (
    <div className={`df-app${mostrarBarraCarrinho ? " has-cartbar" : ""}`}>
      <style>{CSS}</style>

      {/* Cabeçalho fixo */}
      <header className="df-header">
        <div className="df-wrap df-header-inner">
          <div className="df-brand">
            {tela !== "cardapio" && tela !== "confirmado" ? (
              <button className="icon-btn" onClick={() => setTela(tela === "checkout" ? "carrinho" : "cardapio")} aria-label="Voltar">
                <ChevronLeft size={20} />
              </button>
            ) : (
              <img src={LOGO_URL} alt="Divino Frango" width={40} height={40} className="df-logo" />
            )}
            <div style={{ minWidth: 0 }}>
              <div className="df-brand-nome">
                {tela === "carrinho" ? "Meu pedido" : tela === "checkout" ? "Finalizar pedido" : tela === "acompanhar" ? "Seu pedido" : "Divino Frango"}
              </div>
              {tela === "cardapio" && statusSelo && (
                <div className={`status-selo is-${statusSelo.tom}`}>
                  <span className="status-ponto" aria-hidden="true" />
                  {statusSelo.texto}
                </div>
              )}
            </div>
          </div>

          {tela === "cardapio" && qtdItensCarrinho > 0 && (
            <button
              key={cartBump}
              onClick={() => setTela("carrinho")}
              className="cart-btn bump"
              aria-label={`Ver carrinho, ${qtdItensCarrinho} ${qtdItensCarrinho === 1 ? "item" : "itens"}`}
            >
              <ShoppingBag size={19} />
              <span className="cart-btn-count num">{qtdItensCarrinho}</span>
            </button>
          )}
        </div>
      </header>

      {/* ---------------- CARDÁPIO ---------------- */}
      {tela === "cardapio" && (
        <>
          <section className="hero">
            <div className="df-wrap hero-grid">
              <div className="hero-stage">
                {slidesHero.length > 0 ? (
                  slidesHero.map((s, i) => (
                    <img
                      key={s.id}
                      src={fotoDe(s, 1200)}
                      alt={i === indiceSlide ? s.nome : ""}
                      aria-hidden={i !== indiceSlide}
                      onError={() => marcarQuebrada(s)}
                      fetchpriority={i === 0 ? "high" : "low"}
                      loading={i === 0 ? "eager" : "lazy"}
                      className={`hero-slide${i === indiceSlide ? " is-on" : ""}`}
                    />
                  ))
                ) : (
                  <img src={BG_FRANGO_URL} alt="Frango assado dourado sobre tábua de madeira" fetchpriority="high" className="hero-slide is-on" />
                )}
                <div className="hero-stage-sombra" aria-hidden="true" />
                <div className="brasas" aria-hidden="true">
                  {BRASAS.map((b, i) => (
                    <span key={i} style={{ left: `${b.x}%`, width: b.s, height: b.s, animationDelay: `${b.d}s`, animationDuration: `${b.t}s`, "--drift": `${b.dx}px` }} />
                  ))}
                </div>

                {slidesHero.length > 1 && (
                  <div className="story-bars">
                    {slidesHero.map((s, i) => (
                      <button
                        key={s.id}
                        onClick={() => setSlide(i)}
                        aria-label={`Ver ${s.nome}`}
                        className={i < indiceSlide ? "is-done" : i === indiceSlide ? "is-on" : ""}
                      >
                        <span key={i === indiceSlide ? `on-${slide}` : "off"} />
                      </button>
                    ))}
                  </div>
                )}

                {slideAtual && (
                  <div key={slideAtual.id} className="hero-produto">
                    <div className="hero-produto-info">
                      <span className="hero-produto-nome">{slideAtual.nome}</span>
                      <span className="hero-produto-preco num">{fmt(slideAtual.preco)}</span>
                    </div>
                    {renderAcao(slideAtual)}
                  </div>
                )}
              </div>

              <div className="hero-copy">
                <h1 className="hero-title" aria-label="Frango assado na hora, do jeito que só o Divino faz.">
                  {TITULO_HERO.map((p, i) => (
                    <span key={i} aria-hidden="true" className={`palavra${p.destaque ? " is-destaque" : ""}`} style={{ animationDelay: `${0.08 + i * 0.06}s` }}>
                      {p.texto}{" "}
                    </span>
                  ))}
                </h1>
                <p className="hero-sub">Monte seu pedido em poucos toques e receba em casa ou retire no balcão.</p>
                <div className="hero-ctas">
                  <button className="btn btn-primary btn-lg btn-brilho" onClick={irParaCardapio}>
                    Fazer meu pedido <ArrowRight size={18} />
                  </button>
                  {pedidoAtual && (
                    <button className="btn btn-ghost btn-lg" onClick={() => setTela("acompanhar")}>
                      <ClipboardCheck size={17} /> Acompanhar pedido
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

          <div className="df-wrap">
            <ul className="vantagens">
              {tempoEntregaVisivel && (
                <li>
                  <Timer size={18} />
                  <span><strong>{faixaTempo}</strong> para entregar</span>
                </li>
              )}
              <li>
                <Store size={18} />
                <span><strong>Retire</strong> no balcão sem taxa</span>
              </li>
              <li>
                <Wallet size={18} />
                <span><strong>Pague na hora</strong>: Pix, cartão ou dinheiro</span>
              </li>
            </ul>
          </div>

          <div className="df-wrap df-main-grid">
            <div className="df-products-col" ref={menuRef} id="cardapio">
              {lojaFechada && (
                <div className="aviso aviso-off">
                  <Store size={20} />
                  <div>
                    <strong>Loja fechada</strong>
                    <p>{mensagemLojaFechada || "Estamos fechados no momento."}</p>
                  </div>
                </div>
              )}
              {!lojaFechada && !statusLoja.aberta && horarios && (
                <div className="aviso aviso-agenda">
                  <CalendarClock size={20} />
                  <div>
                    <strong>Peça agora e garanta o seu</strong>
                    <p>
                      Estamos fora do horário, mas seu pedido já fica reservado para o próximo dia de funcionamento.
                      {configDiaEscolhido?.entregaAbre ? ` A entrega começa às ${configDiaEscolhido.entregaAbre}.` : ""}
                    </p>
                  </div>
                </div>
              )}
              {erro && <div className="aviso aviso-erro"><p>{erro}</p></div>}

              <nav className="cats no-scrollbar" aria-label="Categorias do cardápio">
                {abasCategorias.map((cat) => {
                  const Icone = cat === "Todos" ? Utensils : CATEGORIA_ICONE[cat];
                  return (
                    <button
                      key={cat}
                      onClick={() => setCategoriaAtiva(cat)}
                      className={`cat-pill${categoriaAtiva === cat ? " is-active" : ""}`}
                      aria-pressed={categoriaAtiva === cat}
                    >
                      {Icone && <Icone size={15} />} {cat}
                    </button>
                  );
                })}
              </nav>

              {cardapio.length === 0 && (
                <div className="vazio">
                  <UtensilsCrossed size={28} />
                  <p>O cardápio ainda não está disponível. Volte em instantes.</p>
                </div>
              )}
              {cardapio.length > 0 && secoesExibidas.length === 0 && (
                <div className="vazio">
                  <UtensilsCrossed size={28} />
                  <p>Nenhum produto nesta categoria no momento.</p>
                </div>
              )}

              {secoesExibidas.map(([categoria, itens]) => {
                const Icone = CATEGORIA_ICONE[categoria];
                return (
                  <section key={categoria} className="secao">
                    {categoriaAtiva === "Todos" && categoria !== SEM_CATEGORIA && (
                      <h2 className="secao-titulo">
                        {Icone && <Icone size={20} />} {categoria}
                      </h2>
                    )}
                    <div className="prod-grid">
                      {itens.map((item) => {
                        const qtd = carrinho[item.id] || 0;
                        return (
                          <article key={item.id} className={`prod${qtd > 0 ? " is-in-cart" : ""}`}>
                            <div className="prod-media">
                              {/* fundo desfocado da própria foto: a foto aparece inteira (sem corte/zoom) e as sobras ficam preenchidas */}
                              {fotoDe(item, 480) && <img src={fotoDe(item, 480)} alt="" aria-hidden="true" loading="lazy" decoding="async" className="prod-img-fundo" />}
                              {renderFoto(item, "prod-img", 480)}
                              {qtd > 0 && <span key={qtd} className="prod-qtd num qty-pop">{qtd}</span>}
                            </div>
                            <div className="prod-body">
                              <h3 className="prod-nome">{item.nome}</h3>
                              {item.descricao && <p className="prod-desc">{item.descricao}</p>}
                              {seloEstoque(item)}
                              <div className="prod-foot">
                                <span className="prod-preco num">{fmt(item.preco)}</span>
                                {renderAcao(item)}
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>

            {/* Carrinho lateral: só no computador */}
            <aside className="df-cart-aside">
              <div className="painel">
                <div className="painel-titulo">Seu pedido</div>
                {itensCarrinho.length === 0 ? (
                  <div className="painel-vazio">
                    <ShoppingBag size={26} />
                    <p>Seu carrinho está vazio. Toque no + de um produto para começar.</p>
                  </div>
                ) : (
                  <>
                    <div className="cart-list">{itensCarrinho.map(({ item, qtd }) => linhaCarrinho(item, qtd, true))}</div>
                    <div className="total-linha">
                      <span>Subtotal</span>
                      <span className="num">{fmt(subtotalCarrinho)}</span>
                    </div>
                    <button onClick={() => setTela("checkout")} disabled={lojaFechada} className="btn btn-primary btn-lg btn-block">
                      Finalizar pedido <ArrowRight size={18} />
                    </button>
                  </>
                )}
              </div>
            </aside>
          </div>

          {!lojaFechada && cardapio.length > 0 && (
            <section className="df-wrap fome">
              <div className="fome-inner">
                <img src={LOGO_URL} alt="" loading="lazy" decoding="async" aria-hidden="true" className="fome-mascote" />
                <div className="fome-copy">
                  <h2>Bateu a fome? Seu frango está a poucos toques.</h2>
                  <button className="btn btn-primary btn-lg" onClick={qtdItensCarrinho > 0 ? () => setTela("carrinho") : irParaCardapio}>
                    {qtdItensCarrinho > 0 ? "Ver meu pedido" : "Fazer meu pedido"} <ArrowRight size={18} />
                  </button>
                </div>
              </div>
            </section>
          )}

          <footer className="df-wrap rodape">
            <div className="rodape-marca">
              <img src={LOGO_URL} alt="Divino Frango" width={56} height={56} />
              <div>
                <div className="rodape-nome">Divino Frango</div>
                <p>Frango assado na hora, pedido pelo site. Retire no balcão ou receba em casa.</p>
              </div>
            </div>
            <a className="rodape-whats" href={LINK_WHATSAPP} target="_blank" rel="noopener noreferrer">
              <span className="rodape-whats-icone"><IconeWhatsApp size={22} /></span>
              <span>
                <strong>Ficou com dúvida?</strong>
                Chame no WhatsApp <span className="num">{WHATSAPP_EXIBICAO}</span>
              </span>
            </a>
            <div className="rodape-pag">
              <span className="rodape-pag-titulo">Pagamento na entrega ou retirada</span>
              <div className="rodape-pag-lista">
                {["Pix", "Crédito", "Débito", "Dinheiro"].map((p) => <span key={p}>{p}</span>)}
              </div>
            </div>
            <div className="rodape-copy">© {new Date().getFullYear()} Divino Frango</div>
          </footer>
        </>
      )}

      <main className="df-wrap df-tela">
        {/* ---------------- CARRINHO ---------------- */}
        {tela === "carrinho" && (
          <div className="tela-estreita">
            {itensCarrinho.length === 0 ? (
              <div className="vazio">
                <ShoppingBag size={28} />
                <p>Seu carrinho está vazio.</p>
                <button className="btn btn-primary" onClick={() => setTela("cardapio")}>Ver cardápio</button>
              </div>
            ) : (
              <>
                <div className="painel">
                  <div className="cart-list">{itensCarrinho.map(({ item, qtd }) => linhaCarrinho(item, qtd, false))}</div>
                </div>
                {blocoSugestoes}
                <div className="total-linha total-grande">
                  <span>Subtotal</span>
                  <span className="num">{fmt(subtotalCarrinho)}</span>
                </div>
                <button onClick={() => setTela("checkout")} className="btn btn-primary btn-lg btn-block">
                  Continuar pedido <ArrowRight size={18} />
                </button>
                <button onClick={() => setTela("cardapio")} className="btn btn-link btn-block">Adicionar mais itens</button>
              </>
            )}
          </div>
        )}

        {/* ---------------- CHECKOUT ---------------- */}
        {tela === "checkout" && (
          <div className="df-main-grid">
            <div className="df-products-col checkout">
              {erro && <div className="aviso aviso-erro"><p>{erro}</p></div>}

              <div className="campo-grupo">
                <div className="campo-grupo-titulo"><User size={17} /> Seus dados</div>
                <label style={labelStyle} htmlFor="df-nome">Nome completo <span className="obrig">*</span></label>
                <input id="df-nome" autoComplete="name" placeholder="Digite seu nome" value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} style={{ ...inputStyle, marginBottom: 12 }} />
                <label style={labelStyle} htmlFor="df-tel">Telefone / WhatsApp <span className="obrig">*</span></label>
                <input
                  id="df-tel"
                  autoComplete="tel"
                  placeholder="(11) 98765-4321"
                  value={form.telefone}
                  onChange={(e) => setForm((f) => ({ ...f, telefone: mascaraTelefone(e.target.value) }))}
                  inputMode="numeric"
                  maxLength={16}
                  style={inputStyle}
                />
              </div>

              <div className="campo-grupo">
                <div className="campo-grupo-titulo"><Bike size={17} /> Como você quer receber?</div>

                {!statusLoja.aberta && proximosDiasAbertos.length > 0 && (
                  <>
                    <span style={labelStyle}>Para qual dia é o pedido?</span>
                    <div className="chips" style={{ marginBottom: 14 }}>
                      {proximosDiasAbertos.map((d) => (
                        <button key={d.iso} onClick={() => setDiaEscolhido(d.iso)} className={`chip${diaEscolhido === d.iso ? " is-active" : ""}`} style={{ textTransform: "capitalize" }}>
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <div className="segmento">
                  <button onClick={() => setForm((f) => ({ ...f, tipoEntrega: "retirada" }))} className={form.tipoEntrega === "retirada" ? "is-active" : ""}>
                    <Store size={17} /> Retirada
                  </button>
                  <button onClick={() => setForm((f) => ({ ...f, tipoEntrega: "entrega" }))} className={form.tipoEntrega === "entrega" ? "is-active" : ""}>
                    <Bike size={17} /> Entrega
                  </button>
                </div>
                {(configDiaEscolhido || horarios) && (
                  <div className="dica">
                    Nossa entrega começa às {(statusLoja.aberta ? horarios?.[new Date().getDay()]?.entregaAbre : configDiaEscolhido?.entregaAbre) || "11:00"}
                    {!statusLoja.aberta ? " no dia escolhido acima." : " hoje."}
                    {form.tipoEntrega === "entrega" && tempoEntregaVisivel ? ` ${textoTempoEntrega}.` : ""}
                  </div>
                )}

                {form.tipoEntrega === "entrega" && (
                  <div style={{ marginTop: 14 }}>
                    <label style={labelStyle} htmlFor="df-cep">CEP</label>
                    <div style={{ position: "relative", marginBottom: 12 }}>
                      <input id="df-cep" autoComplete="postal-code" inputMode="numeric" placeholder="00000-000" value={form.cep} onChange={(e) => buscarCep(e.target.value)} maxLength={9} style={inputStyle} />
                      {buscandoCep && <Loader2 size={16} className="spin-loader" style={{ position: "absolute", right: 12, top: 14 }} color={C.textSoft} />}
                    </div>

                    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                      <div style={{ flex: 2, minWidth: 0 }}>
                        <label style={labelStyle} htmlFor="df-rua">Rua</label>
                        <input id="df-rua" autoComplete="address-line1" placeholder="Rua" value={form.rua} onChange={(e) => setForm((f) => ({ ...f, rua: e.target.value }))} style={inputStyle} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <label style={labelStyle} htmlFor="df-num">Número</label>
                        <input id="df-num" placeholder="Nº" value={form.numero} onChange={(e) => setForm((f) => ({ ...f, numero: e.target.value }))} style={inputStyle} />
                      </div>
                    </div>

                    <label style={labelStyle} htmlFor="df-bairro">Bairro</label>
                    {bairrosEntrega.length > 0 ? (
                      <>
                        <select
                          id="df-bairro"
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
                          <div className="dica dica-alerta">
                            Seu CEP indica o bairro "{bairroForaDaArea}", que ainda não está na nossa área de entrega. Selecione um bairro atendido acima ou escolha retirada.
                          </div>
                        )}
                      </>
                    ) : (
                      <input id="df-bairro" placeholder="Bairro" value={form.bairro} onChange={(e) => setForm((f) => ({ ...f, bairro: e.target.value }))} style={{ ...inputStyle, marginBottom: 12 }} />
                    )}
                    <label style={labelStyle} htmlFor="df-ref">Ponto de referência (opcional)</label>
                    <input id="df-ref" placeholder="Ex: perto do mercado" value={form.referencia} onChange={(e) => setForm((f) => ({ ...f, referencia: e.target.value }))} style={inputStyle} />
                  </div>
                )}
              </div>

              <div className="campo-grupo">
                <div className="campo-grupo-titulo"><CreditCard size={17} /> Pagamento na entrega ou retirada</div>
                <div className="chips" style={{ marginBottom: 12 }}>
                  {FORMAS_PAGAMENTO.map((fp) => (
                    <button
                      key={fp}
                      onClick={() => setForm((f) => ({ ...f, formaPagamento: fp, precisaTroco: false, trocoPara: "" }))}
                      className={`chip${form.formaPagamento === fp ? " is-active" : ""}`}
                    >
                      {fp}
                    </button>
                  ))}
                </div>

                {form.formaPagamento === "Dinheiro" && (
                  <div style={{ marginBottom: 4 }}>
                    <span style={labelStyle}>Precisa de troco?</span>
                    <div className="segmento" style={{ marginBottom: form.precisaTroco ? 10 : 0 }}>
                      <button onClick={() => setForm((f) => ({ ...f, precisaTroco: false, trocoPara: "" }))} className={!form.precisaTroco ? "is-active" : ""}>Não</button>
                      <button onClick={() => setForm((f) => ({ ...f, precisaTroco: true }))} className={form.precisaTroco ? "is-active" : ""}>Sim</button>
                    </div>
                    {form.precisaTroco && (
                      <input
                        type="number"
                        inputMode="decimal"
                        placeholder="Troco para quanto? Ex: 100"
                        value={form.trocoPara}
                        onChange={(e) => setForm((f) => ({ ...f, trocoPara: e.target.value }))}
                        style={inputStyle}
                      />
                    )}
                  </div>
                )}
              </div>

              <div className="campo-grupo">
                {cupomAtivoSite && (
                  <>
                    <label style={labelStyle} htmlFor="df-cupom">Cupom de desconto (opcional)</label>
                    {cupomAplicado ? (
                      <div className="cupom-ok">
                        <span><BadgeCheck size={16} /> {cupomAplicado.codigo} aplicado</span>
                        <button onClick={removerCupom} aria-label="Remover cupom">Remover</button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 8, marginBottom: cupomErro ? 6 : 14 }}>
                        <input id="df-cupom" placeholder="Código do cupom" value={cupomInput} onChange={(e) => setCupomInput(e.target.value)} style={{ ...inputStyle, flex: 1, textTransform: "uppercase" }} />
                        <button onClick={aplicarCupom} disabled={buscandoCupom} className="btn btn-ghost" style={{ flexShrink: 0 }}>
                          {buscandoCupom ? <Loader2 size={15} className="spin-loader" /> : "Aplicar"}
                        </button>
                      </div>
                    )}
                    {cupomErro && <div className="dica dica-erro">{cupomErro}</div>}
                  </>
                )}
                <label style={labelStyle} htmlFor="df-obs">Observação (opcional)</label>
                <input id="df-obs" placeholder="" value={form.observacao} onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))} style={inputStyle} />
              </div>
            </div>

            <aside className="df-checkout-aside">
              <div className="painel">
                <div className="painel-titulo">Resumo do pedido</div>
                {itensCarrinho.map(({ item, qtd }) => (
                  <div key={item.id} className="resumo-linha">
                    <span>{qtd}x {item.nome}</span>
                    <span className="num">{fmt(item.preco * qtd)}</span>
                  </div>
                ))}
                <div className="resumo-linha resumo-sep">
                  <span>Subtotal</span>
                  <span className="num">{fmt(subtotalCarrinho)}</span>
                </div>
                {descontoAplicado > 0 && (
                  <div className="resumo-linha is-desconto">
                    <span>Desconto ({cupomAplicado?.codigo})</span>
                    <span className="num">-{fmt(descontoAplicado)}</span>
                  </div>
                )}
                {form.tipoEntrega === "entrega" && (
                  <div className="resumo-linha">
                    <span>Taxa de entrega</span>
                    <span className="num">{fmt(taxaAplicada)}</span>
                  </div>
                )}
                <div className="total-linha total-grande">
                  <span>Total</span>
                  <span className="num">{fmt(totalCarrinho)}</span>
                </div>

                <button onClick={enviarPedido} disabled={enviando} className="btn btn-primary btn-lg btn-block">
                  {enviando ? <Loader2 size={17} className="spin-loader" /> : <Check size={18} strokeWidth={2.6} />} {enviando ? "Enviando..." : "Enviar pedido"}
                </button>
                <p className="garantia">
                  <BadgeCheck size={15} /> Você só paga na {form.tipoEntrega === "entrega" ? "entrega" : "retirada"} e acompanha o preparo por aqui.
                </p>
                <a className="link-whats" href={LINK_WHATSAPP} target="_blank" rel="noopener noreferrer">
                  <IconeWhatsApp size={16} /> Dúvida antes de enviar? Fale com a gente
                </a>
              </div>
            </aside>
          </div>
        )}

        {/* ---------------- ACOMPANHAR PEDIDO ---------------- */}
        {tela === "acompanhar" && pedidoAtual && (
          <div className="tela-estreita" style={{ paddingTop: 12 }}>
            {["recusado", "cancelado"].includes(pedidoAtual.status) ? (
              <div className="vazio">
                <div className="icone-redondo is-erro"><Clock size={26} /></div>
                <h2 className="acomp-titulo">{pedidoAtual.status === "cancelado" ? "Pedido cancelado" : "Pedido não aceito"}</h2>
                <p>
                  {pedidoAtual.status === "cancelado"
                    ? "A loja cancelou este pedido. Entre em contato para saber mais ou faça um novo pedido."
                    : "A loja não conseguiu aceitar seu pedido dessa vez. Entre em contato ou tente novamente."}
                </p>
                <button onClick={novoPedido} className="btn btn-primary btn-lg">Fazer novo pedido</button>
              </div>
            ) : (
              <div className="painel">
                <div style={{ textAlign: "center", marginBottom: 24 }}>
                  <div className={`icone-redondo${pedidoAtual.status === "concluido" ? " is-ok" : ""}`}>
                    {pedidoAtual.status === "concluido" ? <Check size={26} strokeWidth={2.6} /> : <Flame size={26} />}
                  </div>
                  <h2 className="acomp-titulo">{pedidoAtual.status === "concluido" ? "Pedido concluído. Bom apetite!" : "Recebemos seu pedido!"}</h2>
                  <span className="acomp-total num">{fmt(pedidoAtual.total)}</span>
                </div>

                <ol className="etapas">
                  {[
                    { key: "pendente", label: "Pedido recebido" },
                    { key: "aceito", label: "Aceito pela loja" },
                    { key: "preparando", label: "Em preparo" },
                    { key: "pronto", label: pedidoAtual.tipoEntrega === "entrega" ? "Saiu para entrega" : "Pronto para retirada" },
                    { key: "concluido", label: pedidoAtual.tipoEntrega === "entrega" ? "Entregue" : "Retirado" },
                  ].map((etapa, i) => {
                    const indiceAtual = ETAPAS.indexOf(pedidoAtual.status);
                    const estado = i < indiceAtual ? "feito" : i === indiceAtual ? "atual" : "futuro";
                    return (
                      <li key={etapa.key} className={`etapa is-${estado}`}>
                        <div className="etapa-marca">
                          {estado === "feito" ? <Check size={15} strokeWidth={2.6} /> : estado === "atual" ? <CircleDashed size={15} className="spin-loader" /> : null}
                        </div>
                        <div>
                          <div className="etapa-label">{etapa.label}</div>
                          {estado === "atual" && <div className="etapa-sub">Em andamento...</div>}
                        </div>
                      </li>
                    );
                  })}
                </ol>

                {pedidoAtual.status === "concluido" && (
                  <button onClick={novoPedido} className="btn btn-primary btn-lg btn-block" style={{ marginTop: 8 }}>Fazer novo pedido</button>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Aviso rápido de item adicionado (celular) */}
      {toast && tela === "cardapio" && (
        <div key={toast.k} className="toast" role="status">
          <Check size={15} strokeWidth={2.6} /> {toast.nome} adicionado
        </div>
      )}

      {/* Botão flutuante do WhatsApp (dúvidas) */}
      {(tela === "cardapio" || tela === "carrinho") && (
        <a
          className={`whats-fab${mostrarBarraCarrinho ? " acima-cartbar" : ""}`}
          href={LINK_WHATSAPP}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Tirar dúvidas pelo WhatsApp"
        >
          <IconeWhatsApp size={28} />
          <span className="whats-fab-dica">Dúvidas? Chama no Whats</span>
        </a>
      )}

      {/* Barra flutuante do carrinho (celular) */}
      {mostrarBarraCarrinho && (
        <button key={cartBump} onClick={() => setTela("carrinho")} className="cartbar">
          <span className="cartbar-qtd num">{qtdItensCarrinho}</span>
          <span className="cartbar-label">Ver meu pedido</span>
          <span className="cartbar-total num">{fmt(subtotalCarrinho)}</span>
        </button>
      )}
    </div>
  );
}

const CSS = `
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; scroll-padding-top: 132px; }
  body { margin: 0; background: ${C.bg}; -webkit-tap-highlight-color: transparent; }
  input, select, textarea, button { font-family: inherit; }
  button { cursor: pointer; }
  button:disabled { cursor: not-allowed; }
  img { max-width: 100%; }
  :focus-visible { outline: 2px solid ${C.orange}; outline-offset: 2px; }
  ::placeholder { color: ${C.textFaint}; }
  input:focus, select:focus { outline: none; border-color: ${C.orange} !important; box-shadow: 0 0 0 3px ${C.orangeSoft}; }

  .df-app { min-height: 100dvh; background: ${C.bg}; color: ${C.text}; font-family: 'DM Sans', system-ui, sans-serif; padding-bottom: 32px; }
  .df-app.has-cartbar { padding-bottom: calc(100px + env(safe-area-inset-bottom, 0px)); }
  .df-wrap { max-width: 1180px; margin: 0 auto; padding-left: 16px; padding-right: 16px; }
  .num { font-variant-numeric: tabular-nums; }
  .display, .hero-title, .secao-titulo, .painel-titulo, .df-brand-nome, .fome h2, .acomp-titulo, .rodape-nome { font-family: 'Bricolage Grotesque', 'DM Sans', sans-serif; }
  .no-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .spin-loader { animation: spin-loader 1s linear infinite; }
  @keyframes spin-loader { to { transform: rotate(360deg); } }

  /* carregando */
  .df-loading { min-height: 100dvh; background: ${C.bg}; display: flex; justify-content: center; padding: 40px 16px; }
  .df-loading-inner { width: 100%; max-width: 560px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .df-loading img { border-radius: 14px; margin-bottom: 10px; }
  .sk { background: linear-gradient(90deg, ${C.card} 0%, ${C.cardAlt} 50%, ${C.card} 100%); background-size: 200% 100%; animation: sk 1.3s ease-in-out infinite; border-radius: 12px; }
  .sk-title { width: 80%; height: 34px; }
  .sk-line { width: 60%; height: 16px; }
  .sk-grid { width: 100%; display: grid; gap: 12px; margin-top: 18px; }
  .sk-card { height: 112px; border-radius: 18px; }
  @keyframes sk { to { background-position: -200% 0; } }

  /* botões */
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid transparent; border-radius: 999px; padding: 11px 18px; font-size: 15px; font-weight: 700; white-space: nowrap; transition: transform .16s cubic-bezier(.2,.8,.2,1), background-color .16s ease, box-shadow .16s ease; }
  .btn:active:not(:disabled) { transform: scale(0.97); }
  .btn:disabled { opacity: .55; }
  .btn-lg { padding: 15px 24px; font-size: 16px; }
  .btn-block { width: 100%; }
  .btn-primary { background: ${C.orange}; color: ${C.ink}; box-shadow: 0 8px 24px -8px rgba(245,148,10,.65); }
  .btn-primary:hover:not(:disabled) { background: #FFA42A; }
  .btn-ghost { background: rgba(255,255,255,.04); color: ${C.text}; border-color: ${C.border}; }
  .btn-ghost:hover { background: rgba(255,255,255,.08); }
  .btn-link { background: none; color: ${C.textSoft}; margin-top: 6px; font-weight: 600; }
  .icon-btn { background: ${C.cardAlt}; border: none; border-radius: 12px; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; color: ${C.text}; flex-shrink: 0; }

  /* cabeçalho */
  .df-header { position: sticky; top: 0; z-index: 30; background: rgba(15,13,12,.82); backdrop-filter: blur(14px) saturate(160%); -webkit-backdrop-filter: blur(14px) saturate(160%); border-bottom: 1px solid ${C.borderSoft}; }
  .df-header-inner { display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 64px; }
  .df-brand { display: flex; align-items: center; gap: 11px; min-width: 0; }
  .df-logo { border-radius: 12px; object-fit: contain; flex-shrink: 0; }
  .df-brand-nome { font-size: 17px; font-weight: 800; letter-spacing: -.01em; line-height: 1.1; }
  .status-selo { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; margin-top: 3px; color: ${C.textSoft}; }
  .status-ponto { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .status-selo.is-on { color: ${C.green}; }
  .status-selo.is-on .status-ponto { box-shadow: 0 0 0 0 rgba(52,211,153,.6); animation: pulso 2s ease-out infinite; }
  .status-selo.is-urgente { color: ${C.orangeText}; }
  .status-selo.is-agenda { color: ${C.orangeText}; }
  .status-selo.is-off { color: ${C.red}; }
  @keyframes pulso { 0% { box-shadow: 0 0 0 0 rgba(52,211,153,.55); } 70%, 100% { box-shadow: 0 0 0 7px rgba(52,211,153,0); } }
  .cart-btn { position: relative; width: 44px; height: 44px; border-radius: 999px; background: ${C.cardAlt}; border: 1px solid ${C.border}; color: ${C.text}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .cart-btn-count { position: absolute; top: -4px; right: -4px; background: ${C.orange}; color: ${C.ink}; font-size: 11.5px; font-weight: 800; min-width: 20px; height: 20px; border-radius: 999px; display: flex; align-items: center; justify-content: center; padding: 0 5px; }
  .bump { animation: bump .38s cubic-bezier(.34,1.56,.64,1); }
  @keyframes bump { 0% { transform: scale(.86); } 100% { transform: scale(1); } }

  /* hero */
  .hero { position: relative; }
  .hero-grid { display: grid; padding: 0; }
  .hero-stage { position: relative; height: min(56svh, 520px); min-height: 340px; overflow: hidden; background: #1A120C; isolation: isolate; }
  .hero-slide { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transform: scale(1.12); transition: opacity 1s ease, transform 6.5s cubic-bezier(.2,.6,.3,1); }
  .hero-slide.is-on { opacity: 1; transform: scale(1); }
  .hero-stage-sombra { position: absolute; inset: -1px; pointer-events: none; z-index: 1; background:
    linear-gradient(180deg, rgba(15,13,12,.55) 0%, rgba(15,13,12,0) 22%, rgba(15,13,12,0) 50%, rgba(15,13,12,.85) 88%, ${C.bg} 100%),
    radial-gradient(120% 70% at 50% 110%, rgba(245,110,10,.35) 0%, rgba(245,110,10,0) 60%); }
  .brasas { position: absolute; inset: 0; z-index: 2; pointer-events: none; overflow: hidden; }
  .brasas span { position: absolute; bottom: -12px; border-radius: 50%; background: #FFB648; box-shadow: 0 0 6px 2px rgba(255,140,20,.85), 0 0 14px 4px rgba(245,90,10,.45); opacity: 0; animation: brasa linear infinite; will-change: transform, opacity; }
  @keyframes brasa {
    0% { transform: translate3d(0, 0, 0) scale(1); opacity: 0; }
    10% { opacity: 1; }
    70% { opacity: .8; }
    100% { transform: translate3d(var(--drift), -62svh, 0) scale(.3); opacity: 0; }
  }
  .story-bars { position: absolute; z-index: 3; top: 12px; left: 16px; right: 16px; display: flex; gap: 5px; }
  .story-bars button { flex: 1; height: 16px; padding: 6px 0; border: none; background: none; }
  .story-bars button span { display: block; height: 3px; border-radius: 3px; background: rgba(247,242,236,.3); position: relative; overflow: hidden; }
  .story-bars button span::after { content: ""; position: absolute; inset: 0; background: ${C.text}; transform-origin: left; transform: scaleX(0); }
  .story-bars button.is-done span::after { transform: scaleX(1); }
  .story-bars button.is-on span::after { animation: story 5.2s linear forwards; }
  @keyframes story { to { transform: scaleX(1); } }
  .hero-produto { position: absolute; z-index: 3; left: 16px; right: 16px; bottom: 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 10px 10px 18px; border-radius: 999px;
    background: rgba(24,19,16,.55); border: 1px solid rgba(255,255,255,.14); backdrop-filter: blur(16px) saturate(170%); -webkit-backdrop-filter: blur(16px) saturate(170%);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 12px 30px -10px rgba(0,0,0,.6); animation: produto-in .6s cubic-bezier(.16,1,.3,1) both; }
  .hero-produto-info { min-width: 0; display: flex; flex-direction: column; }
  .hero-produto-nome { font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hero-produto-preco { font-size: 14px; font-weight: 700; color: ${C.orangeText}; }
  @keyframes produto-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
  .hero-copy { position: relative; z-index: 1; padding: 6px 16px 0; }
  .hero-title { font-size: clamp(31px, 8.6vw, 42px); line-height: 1.08; font-weight: 800; letter-spacing: -.028em; margin: 0; text-wrap: balance; }
  .palavra { display: inline-block; animation: palavra .8s cubic-bezier(.16,1,.3,1) both; white-space: pre; padding-bottom: 4px; margin-bottom: -4px; }
  .palavra.is-destaque { background: linear-gradient(100deg, #FFC24D 0%, ${C.orange} 45%, #FF6A1A 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
  @keyframes palavra { from { opacity: 0; transform: translateY(.45em) rotate(2deg); filter: blur(6px); } to { opacity: 1; transform: none; filter: blur(0); } }
  .hero-sub { font-size: 16px; line-height: 1.5; color: ${C.textSoft}; margin: 12px 0 0; max-width: 46ch; animation: sobe .7s cubic-bezier(.16,1,.3,1) .55s both; }
  .hero-ctas { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; animation: sobe .7s cubic-bezier(.16,1,.3,1) .65s both; }
  .btn-brilho { position: relative; overflow: hidden; }
  .btn-brilho::after { content: ""; position: absolute; top: 0; bottom: 0; width: 40%; left: -60%; background: linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.45) 50%, rgba(255,255,255,0) 100%); transform: skewX(-20deg); animation: brilho 3.6s ease-in-out 1.6s infinite; }
  @keyframes brilho { 0% { left: -60%; } 35%, 100% { left: 130%; } }
  @keyframes sobe { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }

  /* vantagens */
  .vantagens { list-style: none; margin: 26px 0 8px; padding: 0; display: grid; gap: 10px; }
  .vantagens li { display: flex; align-items: center; gap: 12px; font-size: 14.5px; color: ${C.textSoft}; }
  .vantagens li svg { color: ${C.orange}; flex-shrink: 0; }
  .vantagens strong { color: ${C.text}; font-weight: 700; }

  /* avisos */
  .aviso { display: flex; gap: 12px; border-radius: 18px; padding: 14px 16px; margin: 18px 0 0; border: 1px solid; }
  .aviso svg { flex-shrink: 0; margin-top: 2px; }
  .aviso strong { display: block; font-size: 15px; margin-bottom: 3px; }
  .aviso p { margin: 0; font-size: 14px; line-height: 1.5; color: ${C.textSoft}; }
  .aviso-off { background: rgba(248,113,113,.08); border-color: rgba(248,113,113,.4); color: ${C.red}; }
  .aviso-off strong { color: ${C.red}; }
  .aviso-agenda { background: ${C.orangeSoft}; border-color: rgba(245,148,10,.4); color: ${C.orangeText}; }
  .aviso-erro { background: rgba(248,113,113,.08); border-color: rgba(248,113,113,.4); }
  .aviso-erro p { color: ${C.red}; }

  /* categorias */
  .cats { position: sticky; top: 64px; z-index: 20; display: flex; gap: 8px; overflow-x: auto; padding: 12px 16px; margin: 18px -16px 0; background: rgba(15,13,12,.9); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
  .cat-pill { flex-shrink: 0; display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; padding: 9px 15px; border-radius: 999px; font-size: 14px; font-weight: 700; border: 1px solid ${C.border}; background: ${C.card}; color: ${C.textSoft}; transition: background-color .16s ease, color .16s ease, border-color .16s ease, transform .16s ease; }
  .cat-pill:active { transform: scale(.96); }
  .cat-pill.is-active { background: ${C.text}; color: ${C.ink}; border-color: ${C.text}; }

  /* produtos */
  .secao { margin-top: 22px; scroll-margin-top: 132px; }
  .secao-titulo { display: flex; align-items: center; gap: 9px; font-size: 21px; font-weight: 800; letter-spacing: -.015em; margin: 0 0 12px; }
  .secao-titulo svg { color: ${C.orange}; }
  .prod-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .prod { display: flex; flex-direction: column; border-radius: 18px; overflow: hidden; background: ${C.card}; border: 1px solid ${C.borderSoft}; transition: border-color .2s ease, transform .25s cubic-bezier(.16,1,.3,1), box-shadow .25s ease; }
  .prod.is-in-cart { border-color: rgba(245,148,10,.6); box-shadow: 0 10px 28px -14px rgba(245,148,10,.55); }
  .prod-media { position: relative; aspect-ratio: 4 / 3; overflow: hidden; background: #1F1712; }
  .prod-img { position: relative; z-index: 1; width: 100%; height: 100%; object-fit: contain; display: block; }
  .prod-img-fundo { position: absolute; inset: -12px; width: calc(100% + 24px); height: calc(100% + 24px); object-fit: cover; filter: blur(14px) brightness(.55) saturate(1.2); }
  .prod-img.ph { position: absolute; inset: 0; }
  .prod-qtd { position: absolute; top: 8px; right: 8px; min-width: 26px; height: 26px; padding: 0 7px; border-radius: 999px; background: ${C.orange}; color: ${C.ink}; font-size: 13px; font-weight: 800; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,.4); }
  .prod-body { flex: 1; display: flex; flex-direction: column; gap: 4px; padding: 11px 12px 12px; min-width: 0; }
  .prod-nome { font-size: 15px; font-weight: 700; margin: 0; line-height: 1.25; }
  .prod-desc { font-size: 12.5px; color: ${C.textSoft}; margin: 0; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .prod-body .selo-estoque { align-self: flex-start; margin-top: 2px; }
  .prod-foot { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-top: auto; padding-top: 8px; }
  .prod-preco { font-size: 16px; font-weight: 800; }
  .prod-foot .stepper { margin-left: auto; }
  .is-esgotado { filter: grayscale(1); opacity: .5; }
  .ph { display: flex; align-items: center; justify-content: center; color: rgba(255,182,72,.55); background: radial-gradient(circle at 30% 20%, #3A2412 0%, #1F1712 70%); }
  .add-fab { width: 40px; height: 40px; border-radius: 999px; border: none; background: ${C.orange}; color: ${C.ink}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 6px 16px -4px rgba(245,148,10,.7); transition: transform .16s cubic-bezier(.34,1.56,.64,1); }
  .add-fab:hover { transform: scale(1.07); }
  .add-fab:active { transform: scale(.88); }
  .add-fab-sm { width: 32px; height: 32px; }
  .acao-off { display: inline-block; font-size: 12px; font-weight: 700; color: ${C.textSoft}; background: ${C.cardAlt}; border: 1px solid ${C.border}; border-radius: 999px; padding: 5px 10px; }
  .selo-estoque { display: inline-flex; font-size: 12px; font-weight: 700; color: ${C.orangeText}; background: ${C.orangeSoft}; border-radius: 999px; padding: 3px 9px; }

  .stepper { display: inline-flex; align-items: center; gap: 2px; background: ${C.orange}; color: ${C.ink}; border-radius: 999px; padding: 3px; box-shadow: 0 6px 16px -4px rgba(245,148,10,.6); }
  .stepper button { width: 30px; height: 30px; border: none; border-radius: 999px; background: rgba(20,15,12,.12); color: ${C.ink}; display: flex; align-items: center; justify-content: center; transition: transform .12s ease, background-color .12s ease; }
  .stepper button:active:not(:disabled) { transform: scale(.85); }
  .stepper button:disabled { opacity: .4; }
  .stepper span { min-width: 22px; text-align: center; font-weight: 800; font-size: 15px; display: inline-block; font-variant-numeric: tabular-nums; }
  .stepper-lg { padding: 4px; }
  .stepper-lg button { width: 42px; height: 42px; }
  .stepper-lg span { min-width: 30px; font-size: 17px; }
  .stepper-sm { box-shadow: none; background: ${C.cardAlt}; color: ${C.text}; }
  .stepper-sm button { width: 28px; height: 28px; background: transparent; color: ${C.text}; }
  .stepper-sm button.is-plus { background: ${C.orange}; color: ${C.ink}; }
  .qty-pop { animation: qty-pop .22s ease; }
  @keyframes qty-pop { 0% { transform: scale(1.4); } 100% { transform: scale(1); } }

  .vazio { text-align: center; padding: 44px 16px; color: ${C.textSoft}; display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .vazio p { margin: 0; font-size: 15px; line-height: 1.5; max-width: 40ch; }
  .vazio svg { color: ${C.textFaint}; }

  /* chamada final */
  .fome { margin-top: 40px; }
  .fome-inner { position: relative; overflow: hidden; border-radius: 24px; min-height: 240px; display: flex; align-items: flex-end; background: radial-gradient(120% 140% at 100% 0%, #6B3A0C 0%, #2A1A0C 45%, ${C.card} 100%); border: 1px solid rgba(245,148,10,.28); }
  .fome-mascote { position: absolute; right: -18px; top: -10px; width: 170px; height: auto; transform: rotate(8deg); opacity: .95; filter: drop-shadow(0 18px 30px rgba(0,0,0,.5)); }
  .fome-copy { position: relative; z-index: 1; padding: 22px; padding-top: 120px; display: flex; flex-direction: column; align-items: flex-start; gap: 14px; }
  .fome h2 { margin: 0; font-size: 26px; line-height: 1.1; font-weight: 800; letter-spacing: -.02em; max-width: 18ch; text-wrap: balance; }

  /* rodapé */

  .rodape { display: grid; gap: 18px; margin-top: 36px; padding-top: 26px; padding-bottom: 8px; border-top: 1px solid ${C.borderSoft}; color: ${C.textSoft}; font-size: 14px; }
  .rodape-marca { display: flex; gap: 14px; align-items: center; }
  .rodape-marca img { border-radius: 14px; flex-shrink: 0; }
  .rodape-marca p { margin: 2px 0 0; line-height: 1.5; max-width: 40ch; }
  .rodape-nome { font-size: 17px; font-weight: 800; color: ${C.text}; }
  .rodape-whats { display: flex; align-items: center; gap: 12px; padding: 12px 16px 12px 12px; border-radius: 18px; background: rgba(37,211,102,.08); border: 1px solid rgba(37,211,102,.3); color: ${C.textSoft}; text-decoration: none; line-height: 1.4; transition: background-color .16s ease, border-color .16s ease; }
  .rodape-whats:hover { background: rgba(37,211,102,.14); border-color: rgba(37,211,102,.5); }
  .rodape-whats strong { display: block; color: ${C.text}; font-size: 15px; }
  .rodape-whats-icone { width: 42px; height: 42px; border-radius: 999px; background: #25D366; color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .rodape-pag-titulo { display: block; font-weight: 600; color: ${C.text}; margin-bottom: 8px; }
  .rodape-pag-lista { display: flex; flex-wrap: wrap; gap: 6px; }
  .rodape-pag-lista span { font-size: 13px; font-weight: 600; padding: 5px 11px; border-radius: 999px; border: 1px solid ${C.border}; }
  .rodape-copy { font-size: 12.5px; color: ${C.textFaint}; }

  .whats-fab { position: fixed; z-index: 39; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); width: 56px; height: 56px; border-radius: 999px; background: #25D366; color: #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 28px -8px rgba(37,211,102,.7), 0 4px 12px rgba(0,0,0,.35); text-decoration: none; transition: transform .2s cubic-bezier(.34,1.56,.64,1), bottom .3s cubic-bezier(.16,1,.3,1); animation: whats-in .5s cubic-bezier(.34,1.56,.64,1) 1.2s both; }
  .whats-fab:hover { transform: scale(1.06); }
  .whats-fab:active { transform: scale(.94); }
  .whats-fab.acima-cartbar { bottom: calc(84px + env(safe-area-inset-bottom, 0px)); }
  .whats-fab-dica { display: none; }
  @keyframes whats-in { from { opacity: 0; transform: scale(.5); } to { opacity: 1; transform: none; } }
  .link-whats { display: inline-flex; align-items: center; gap: 7px; margin-top: 12px; font-size: 13.5px; font-weight: 600; color: #4ADE80; text-decoration: none; }
  .link-whats:hover { text-decoration: underline; }

  /* painéis, carrinho e checkout */
  .df-tela { padding-top: 16px; }
  .tela-estreita { max-width: 560px; margin: 0 auto; }
  .painel { background: ${C.card}; border: 1px solid ${C.borderSoft}; border-radius: 22px; padding: 18px; }
  .painel-titulo { font-size: 19px; font-weight: 800; letter-spacing: -.01em; margin-bottom: 14px; }
  .painel-vazio { text-align: center; color: ${C.textSoft}; padding: 18px 6px 8px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .painel-vazio svg { color: ${C.textFaint}; }
  .painel-vazio p { margin: 0; font-size: 14px; line-height: 1.5; }
  .cart-list { display: flex; flex-direction: column; gap: 12px; }
  .cart-row { display: flex; align-items: center; gap: 12px; }
  .cart-thumb { width: 54px; height: 54px; border-radius: 12px; object-fit: cover; flex-shrink: 0; }
  .cart-row.is-compact .cart-thumb { width: 46px; height: 46px; }
  .cart-row-info { flex: 1; min-width: 0; }
  .cart-row-nome { font-size: 15px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cart-row.is-compact .cart-row-nome { font-size: 14px; }
  .cart-row-preco { font-size: 14px; color: ${C.textSoft}; margin-top: 2px; }
  .total-linha { display: flex; justify-content: space-between; align-items: baseline; padding: 14px 0; margin-top: 14px; border-top: 1px solid ${C.borderSoft}; font-size: 15px; color: ${C.textSoft}; font-weight: 600; }
  .total-linha .num { color: ${C.text}; font-size: 19px; font-weight: 800; }
  .total-grande .num { font-size: 22px; }
  .tela-estreita > .total-linha { border-top: none; padding: 18px 4px 14px; }

  .sugestoes { margin-top: 22px; }
  .sugestoes-titulo { font-family: 'Bricolage Grotesque', sans-serif; font-size: 18px; font-weight: 800; margin-bottom: 12px; }
  .sugestoes-scroll { display: flex; gap: 10px; overflow-x: auto; margin: 0 -16px; padding: 0 16px 4px; scroll-snap-type: x mandatory; }
  .sug-card { flex: 0 0 138px; scroll-snap-align: start; background: ${C.card}; border: 1px solid ${C.borderSoft}; border-radius: 18px; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
  .sug-img { width: 100%; aspect-ratio: 1; border-radius: 12px; object-fit: cover; display: flex; }
  .sug-nome { font-size: 13.5px; font-weight: 700; line-height: 1.3; min-height: 35px; padding: 0 2px; }
  .sug-foot { display: flex; align-items: center; justify-content: space-between; padding: 0 2px 2px; font-size: 14px; font-weight: 800; }

  .checkout { display: flex; flex-direction: column; gap: 14px; }
  .campo-grupo { background: ${C.card}; border: 1px solid ${C.borderSoft}; border-radius: 22px; padding: 18px; }
  .campo-grupo-titulo { display: flex; align-items: center; gap: 9px; font-family: 'Bricolage Grotesque', sans-serif; font-size: 17px; font-weight: 800; margin-bottom: 14px; }
  .campo-grupo-titulo svg { color: ${C.orange}; }
  .obrig { color: ${C.orangeText}; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { padding: 9px 14px; border-radius: 999px; font-size: 14px; font-weight: 600; border: 1px solid ${C.border}; background: transparent; color: ${C.textSoft}; transition: all .15s ease; }
  .chip.is-active { border-color: ${C.orange}; background: ${C.orangeSoft}; color: ${C.orangeText}; }
  .segmento { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; background: ${C.cardAlt}; padding: 4px; border-radius: 999px; }
  .segmento button { display: flex; align-items: center; justify-content: center; gap: 7px; padding: 11px; border-radius: 999px; border: none; background: transparent; color: ${C.textSoft}; font-size: 15px; font-weight: 700; transition: background-color .18s ease, color .18s ease; }
  .segmento button.is-active { background: ${C.orange}; color: ${C.ink}; }
  .dica { font-size: 13px; color: ${C.textSoft}; margin-top: 10px; line-height: 1.5; }
  .dica-alerta { color: ${C.orangeText}; margin: 0 0 12px; }
  .dica-erro { color: ${C.red}; margin: 0 0 12px; }
  .cupom-ok { display: flex; justify-content: space-between; align-items: center; background: ${C.greenSoft}; border: 1px solid rgba(52,211,153,.5); border-radius: 12px; padding: 10px 12px; margin-bottom: 14px; color: ${C.green}; font-weight: 700; font-size: 14px; }
  .cupom-ok span { display: inline-flex; align-items: center; gap: 6px; }
  .cupom-ok button { background: none; border: none; color: ${C.green}; font-weight: 600; text-decoration: underline; }
  .resumo-linha { display: flex; justify-content: space-between; gap: 10px; font-size: 14px; color: ${C.textSoft}; margin-bottom: 6px; }
  .resumo-linha .num { color: ${C.text}; }
  .resumo-sep { border-top: 1px solid ${C.borderSoft}; padding-top: 10px; margin-top: 10px; }
  .resumo-linha.is-desconto, .resumo-linha.is-desconto .num { color: ${C.green}; }
  .garantia { display: flex; gap: 7px; align-items: flex-start; font-size: 13px; color: ${C.textSoft}; margin: 12px 0 0; line-height: 1.45; }
  .garantia svg { color: ${C.green}; flex-shrink: 0; margin-top: 1px; }

  /* acompanhar */
  .icone-redondo { width: 60px; height: 60px; border-radius: 50%; background: ${C.orangeSoft}; color: ${C.orange}; display: flex; align-items: center; justify-content: center; margin: 0 auto 14px; }
  .icone-redondo.is-ok { background: ${C.greenSoft}; color: ${C.green}; }
  .icone-redondo.is-erro { background: rgba(248,113,113,.14); color: ${C.red}; margin-bottom: 4px; }
  .acomp-titulo { font-size: 22px; font-weight: 800; letter-spacing: -.015em; margin: 0 0 6px; color: ${C.text}; }
  .acomp-total { font-size: 20px; font-weight: 800; color: ${C.orangeText}; }
  .etapas { list-style: none; margin: 0; padding: 0; }
  .etapa { display: flex; gap: 14px; position: relative; padding-bottom: 22px; }
  .etapa:not(:last-child)::before { content: ""; position: absolute; left: 14px; top: 32px; bottom: 2px; width: 2px; background: ${C.border}; }
  .etapa.is-feito::before { background: ${C.green}; }
  .etapa-marca { width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: ${C.cardAlt}; color: ${C.textFaint}; }
  .etapa.is-feito .etapa-marca { background: ${C.greenSoft}; color: ${C.green}; }
  .etapa.is-atual .etapa-marca { background: ${C.orangeSoft}; color: ${C.orange}; box-shadow: inset 0 0 0 2px ${C.orange}; }
  .etapa-label { font-size: 15px; font-weight: 600; padding-top: 5px; }
  .etapa.is-futuro .etapa-label { color: ${C.textFaint}; }
  .etapa.is-atual .etapa-label { font-weight: 800; }
  .etapa-sub { font-size: 13px; color: ${C.orangeText}; margin-top: 2px; }

  /* barra do carrinho e aviso */
  .cartbar { position: fixed; z-index: 40; left: 12px; right: 12px; bottom: calc(12px + env(safe-area-inset-bottom, 0px)); max-width: 560px; margin: 0 auto; display: flex; align-items: center; gap: 12px; padding: 10px 18px 10px 10px; border: none; border-radius: 999px; background: ${C.orange}; color: ${C.ink}; box-shadow: 0 14px 34px -10px rgba(245,148,10,.75); animation: cartbar-in .32s cubic-bezier(.34,1.56,.64,1); }
  .cartbar-qtd { min-width: 36px; height: 36px; border-radius: 999px; background: rgba(20,15,12,.16); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 15px; }
  .cartbar-label { flex: 1; text-align: left; font-size: 16px; font-weight: 800; }
  .cartbar-total { font-size: 16px; font-weight: 800; }
  @keyframes cartbar-in { from { transform: translateY(14px) scale(.97); } to { transform: none; } }
  .toast { position: fixed; z-index: 41; left: 50%; bottom: calc(80px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); display: inline-flex; align-items: center; gap: 7px; background: ${C.text}; color: ${C.ink}; font-size: 14px; font-weight: 700; padding: 9px 15px; border-radius: 999px; box-shadow: 0 10px 30px -8px rgba(0,0,0,.6); white-space: nowrap; max-width: calc(100vw - 32px); overflow: hidden; text-overflow: ellipsis; animation: toast 1.8s cubic-bezier(.16,1,.3,1) both; }
  .toast svg { color: #0E8F5C; flex-shrink: 0; }
  @keyframes toast { 0% { opacity: 0; transform: translate(-50%, 10px); } 12%, 82% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; transform: translate(-50%, 6px); } }

  .df-cart-aside { display: none; }

  @media (max-width: 859px) {
    input, select, textarea { font-size: 16px !important; }
    .df-checkout-aside { margin-top: 14px; }
  }

  @media (max-width: 359px) {
    .prod-grid { grid-template-columns: 1fr; }
    .hero-ctas .btn { width: 100%; }
  }

  @media (min-width: 640px) {
    .vantagens { grid-template-columns: repeat(3, auto); justify-content: start; gap: 28px; }
  }

  @media (min-width: 860px) {
    html { scroll-padding-top: 140px; }
    .hero-grid { grid-template-columns: 1fr 1.08fr; align-items: center; gap: 56px; padding: 36px 16px 8px; }
    .hero-stage { order: 2; height: auto; aspect-ratio: 5 / 4; min-height: 0; border-radius: 32px; box-shadow: 0 50px 100px -40px rgba(245,110,10,.55), inset 0 0 0 1px rgba(255,255,255,.06); }
    .hero-stage-sombra { background: linear-gradient(180deg, rgba(15,13,12,.45) 0%, rgba(15,13,12,0) 25%, rgba(15,13,12,0) 60%, rgba(15,13,12,.7) 100%), radial-gradient(120% 70% at 50% 110%, rgba(245,110,10,.35) 0%, rgba(245,110,10,0) 60%); }
    .hero-produto { left: 20px; right: auto; bottom: 20px; min-width: 300px; max-width: calc(100% - 40px); }
    .story-bars { top: 16px; left: 20px; right: 20px; }
    .hero-copy { order: 1; padding: 0; }
    .hero-title { font-size: clamp(44px, 4.8vw, 62px); }
    .hero-sub { font-size: 18px; }
    .vantagens { margin-top: 32px; padding-bottom: 8px; }
    .df-main-grid { display: grid; grid-template-columns: 1fr 360px; gap: 32px; align-items: start; }
    .df-cart-aside { display: block; position: sticky; top: 88px; margin-top: 18px; }
    .df-checkout-aside { position: sticky; top: 88px; }
    .cats { top: 64px; margin-left: 0; margin-right: 0; padding-left: 0; padding-right: 0; flex-wrap: wrap; }
    .prod-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .prod:hover { border-color: ${C.border}; transform: translateY(-3px); }
    .prod-nome { font-size: 16px; }
    .prod.is-in-cart:hover { border-color: rgba(245,148,10,.7); }
    .cartbar, .toast { display: none; }
    .rodape { grid-template-columns: 1.3fr 1.2fr 1fr; align-items: center; gap: 28px; }
    .rodape-copy { grid-column: 1 / -1; }
    .whats-fab, .whats-fab.acima-cartbar { right: 24px; bottom: 24px; width: auto; padding: 0 20px 0 14px; gap: 10px; }
    .whats-fab-dica { display: inline; font-size: 15px; font-weight: 700; }
    .whats-fab:hover { transform: translateY(-2px); }
    .df-app.has-cartbar { padding-bottom: 32px; }
    .fome-inner { min-height: 280px; align-items: center; }
    .fome-mascote { width: 260px; right: 48px; top: 50%; transform: translateY(-50%) rotate(6deg); }
    .fome-copy { padding: 40px; }
    .fome h2 { font-size: 36px; }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
    .spin-loader { animation-duration: 1s !important; animation-iteration-count: infinite !important; }
    .brasas, .btn-brilho::after { display: none; }
    .hero-slide { transform: none !important; }
  }
`;
