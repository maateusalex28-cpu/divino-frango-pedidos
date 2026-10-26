import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Plus, Minus, Trash2, Check, X, Search, Phone, Loader2 } from "lucide-react";

const FORMAS = ["Dinheiro", "Pix", "Cartão"];

const paraNumero = (v) => {
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const n = parseFloat(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : 0;
};
const arred = (n) => Math.round(n * 100) / 100;
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const rotuloDia = (iso, hoje) => {
  if (!iso) return "";
  const d = new Date(iso + "T00:00");
  const amanha = new Date(hoje + "T00:00");
  amanha.setDate(amanha.getDate() + 1);
  const base = d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
  if (iso === hoje) return `Hoje · ${base}`;
  if (d.getTime() === amanha.getTime()) return `Amanhã · ${base}`;
  return base;
};

const linkWhatsApp = (tel, texto) => {
  const d = String(tel || "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return `https://wa.me/${d.startsWith("55") ? d : "55" + d}?text=${encodeURIComponent(texto)}`;
};

export default function Balcao({
  supabase, C, fmt, Card, FieldLabel, EmptyState, inputStyle, btnPrimary, btnOutline, iconBtnStyle,
  showToast, dataLocalISO, cardapio, pedidos, codigoPedido, labelStatus, onPedidoCriado,
}) {
  const hoje = dataLocalISO();
  const [sub, setSub] = useState("lancar"); // lancar | pedidos | reservas

  const pill = (ativa) => ({
    flex: 1, padding: "10px 6px", borderRadius: 10, border: "none", textAlign: "center", lineHeight: 1.2,
    background: ativa ? C.orange : "transparent", color: ativa ? "#0E0E10" : C.textSoft,
    fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.3,
  });
  const chip = (ativa) => ({
    padding: "7px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700,
    border: `1px solid ${ativa ? C.orange : C.border}`,
    background: ativa ? C.orangeSoft : "transparent", color: ativa ? C.orangeText : C.textSoft,
  });

  // ---------------- Lançar pedido do balcão ----------------
  const [carrinho, setCarrinho] = useState([]);
  const [busca, setBusca] = useState("");
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [forma, setForma] = useState("Dinheiro");
  const [obs, setObs] = useState("");
  const [entregueNaHora, setEntregueNaHora] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const itensVisiveis = useMemo(
    () => (cardapio || []).filter((c) => c.disponivel !== false && (!busca || semAcento(c.nome).includes(semAcento(busca)))),
    [cardapio, busca]
  );
  const totalCarrinho = useMemo(() => arred(carrinho.reduce((s, x) => s + x.preco * x.qtd, 0)), [carrinho]);

  const adicionar = (item) =>
    setCarrinho((prev) => {
      const i = prev.findIndex((x) => x.id === item.id);
      if (i >= 0) return prev.map((x, idx) => (idx === i ? { ...x, qtd: x.qtd + 1 } : x));
      return [...prev, { id: item.id, nome: item.nome, preco: item.preco, qtd: 1 }];
    });
  const mudarQtd = (id, delta) =>
    setCarrinho((prev) => prev.map((x) => (x.id === id ? { ...x, qtd: x.qtd + delta } : x)).filter((x) => x.qtd > 0));

  const lancarPedido = async () => {
    if (!carrinho.length) return showToast("Adicione pelo menos um item");
    setSalvando(true);
    const agora = new Date().toISOString();
    const linha = {
      cliente_nome: nome.trim() || "Balcão",
      cliente_telefone: telefone.trim(),
      tipo_entrega: "retirada",
      forma_pagamento: forma,
      precisa_troco: false,
      itens: carrinho.map(({ id, nome: n, qtd, preco }) => ({ id, nome: n, qtd, preco })),
      subtotal: totalCarrinho,
      taxa_entrega: 0,
      total: totalCarrinho,
      observacao: obs.trim() || null,
      status: entregueNaHora ? "concluido" : "aceito",
      origem: "balcao",
      data_pedido: hoje,
      ...(entregueNaHora ? { concluido_em: agora } : {}),
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
    const cod = data.numero ?? data.numero_pedido ?? String(data.id).slice(0, 4).toUpperCase();
    showToast(`Pedido #${cod} lançado`);
    setCarrinho([]); setNome(""); setTelefone(""); setObs(""); setForma("Dinheiro");
  };

  // ---------------- Lista unificada de pedidos ----------------
  const [dia, setDia] = useState(hoje);
  const [filtroOrigem, setFiltroOrigem] = useState("todos");

  const pedidosDoDia = useMemo(() => {
    const lista = (pedidos || []).filter((p) => {
      const dataDoPedido = p.dataPedido || (p.createdAt ? dataLocalISO(new Date(p.createdAt)) : "");
      if (dataDoPedido !== dia) return false;
      const o = p.origem || "site";
      return filtroOrigem === "todos" || o === filtroOrigem;
    });
    return lista.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }, [pedidos, dia, filtroOrigem, dataLocalISO]);

  const validos = pedidosDoDia.filter((p) => p.status !== "cancelado" && p.status !== "recusado");
  const somaDia = arred(validos.reduce((s, p) => s + (p.total || 0), 0));
  const corStatus = (s) =>
    s === "concluido" ? { bg: C.greenSoft, fg: C.green }
      : s === "cancelado" || s === "recusado" ? { bg: C.redSoft, fg: C.red }
      : { bg: C.orangeSoft, fg: C.orangeText };

  // ---------------- Reservas ----------------
  const formVazio = { nome: "", tel: "", data: hoje, hora: "", descricao: "", valor: "", sinal: "", obs: "" };
  const [reservas, setReservas] = useState([]);
  const [carregandoRes, setCarregandoRes] = useState(false);
  const [erroRes, setErroRes] = useState("");
  const [formRes, setFormRes] = useState(formVazio);
  const [filtroRes, setFiltroRes] = useState("abertas");
  const [salvandoRes, setSalvandoRes] = useState(false);

  const carregarReservas = useCallback(async () => {
    setCarregandoRes(true);
    const { data, error } = await supabase
      .from("reservas").select("*").order("data_retirada", { ascending: true }).order("hora_retirada", { ascending: true });
    setCarregandoRes(false);
    if (error) {
      console.error(error);
      setErroRes("Não foi possível carregar as reservas. Confira se o arquivo migracao-balcao-reservas.sql foi rodado no Supabase.");
      return;
    }
    setErroRes("");
    setReservas(data || []);
  }, [supabase]);

  useEffect(() => { carregarReservas(); }, [carregarReservas]);

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
    setFormRes({ ...formVazio, data: formRes.data });
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
  };

  const reservasFiltradas = useMemo(() => {
    const abertas = filtroRes === "abertas";
    const lista = reservas.filter((r) => (abertas ? r.status === "pendente" || r.status === "confirmada" : r.status === "retirada" || r.status === "cancelada"));
    const chave = (r) => `${r.data_retirada} ${r.hora_retirada || "99:99"}`;
    return lista.sort((a, b) => (abertas ? chave(a).localeCompare(chave(b)) : chave(b).localeCompare(chave(a))));
  }, [reservas, filtroRes]);

  const gruposRes = useMemo(() => {
    const mapa = new Map();
    reservasFiltradas.forEach((r) => {
      if (!mapa.has(r.data_retirada)) mapa.set(r.data_retirada, []);
      mapa.get(r.data_retirada).push(r);
    });
    return Array.from(mapa.entries());
  }, [reservasFiltradas]);

  const qtdAbertas = reservas.filter((r) => r.status === "pendente" || r.status === "confirmada").length;

  // ---------------- Tela ----------------
  return (
    <>
      <div style={{ display: "flex", gap: 6, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 4, marginBottom: 14 }}>
        <button onClick={() => setSub("lancar")} style={pill(sub === "lancar")}>Lançar pedido</button>
        <button onClick={() => setSub("pedidos")} style={pill(sub === "pedidos")}>Todos os pedidos</button>
        <button onClick={() => setSub("reservas")} style={pill(sub === "reservas")}>Reservas ({qtdAbertas})</button>
      </div>

      {sub === "lancar" && (
        <>
          <Card>
            <div style={{ position: "relative", marginBottom: 10 }}>
              <Search size={15} style={{ position: "absolute", left: 11, top: 13, color: C.textFaint }} />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar item do cardápio" style={{ ...inputStyle, paddingLeft: 33 }} />
            </div>
            {itensVisiveis.length === 0 ? (
              <EmptyState text="Nenhum item disponível no cardápio" />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
                {itensVisiveis.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => adicionar(c)}
                    style={{ textAlign: "left", background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 11, padding: "10px 11px", color: C.text }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.25 }}>{c.nome}</div>
                    <div style={{ fontSize: 12.5, color: C.orangeText, fontWeight: 700, marginTop: 4 }}>{fmt(c.preco)}</div>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Pedido atual</div>
            {carrinho.length === 0 ? (
              <EmptyState text="Toque nos itens acima para adicionar" />
            ) : (
              carrinho.map((x) => (
                <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: `1px solid ${C.borderSoft}` }}>
                  <div style={{ flex: 1, fontSize: 13.5 }}>{x.nome}</div>
                  <button onClick={() => mudarQtd(x.id, -1)} style={iconBtnStyle}><Minus size={16} color={C.textSoft} /></button>
                  <div style={{ minWidth: 22, textAlign: "center", fontWeight: 800 }}>{x.qtd}</div>
                  <button onClick={() => mudarQtd(x.id, 1)} style={iconBtnStyle}><Plus size={16} color={C.textSoft} /></button>
                  <div style={{ minWidth: 70, textAlign: "right", fontWeight: 700, fontSize: 13 }}>{fmt(x.preco * x.qtd)}</div>
                </div>
              ))
            )}

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 800, margin: "12px 0" }}>
              <span>Total</span><span style={{ color: C.orangeText }}>{fmt(totalCarrinho)}</span>
            </div>

            <FieldLabel>Cliente (opcional)</FieldLabel>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome" style={{ ...inputStyle, marginBottom: 8 }} />
            <input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="Telefone" inputMode="tel" style={{ ...inputStyle, marginBottom: 10 }} />

            <FieldLabel>Forma de pagamento</FieldLabel>
            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              {FORMAS.map((f) => (
                <button key={f} onClick={() => setForma(f)} style={chip(forma === f)}>{f}</button>
              ))}
            </div>

            <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação (opcional)" style={{ ...inputStyle, marginBottom: 10 }} />

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.textSoft, marginBottom: 12 }}>
              <input type="checkbox" checked={entregueNaHora} onChange={(e) => setEntregueNaHora(e.target.checked)} />
              Já entregue ao cliente (marca como Concluído)
            </label>

            <button onClick={lancarPedido} disabled={salvando || carrinho.length === 0} style={{ ...btnPrimary, width: "100%", opacity: salvando || carrinho.length === 0 ? 0.6 : 1 }}>
              {salvando ? <Loader2 size={16} /> : <Check size={16} />} Lançar pedido
            </button>
          </Card>
        </>
      )}

      {sub === "pedidos" && (
        <>
          <Card>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input type="date" value={dia} onChange={(e) => setDia(e.target.value || hoje)} style={{ ...inputStyle, width: "auto" }} />
              {[["todos", "Todos"], ["site", "Site"], ["balcao", "Balcão"]].map(([id, label]) => (
                <button key={id} onClick={() => setFiltroOrigem(id)} style={chip(filtroOrigem === id)}>{label}</button>
              ))}
            </div>
          </Card>

          {pedidosDoDia.length === 0 ? (
            <EmptyState text="Nenhum pedido neste dia" />
          ) : (
            <Card>
              {pedidosDoDia.map((p) => {
                const cor = corStatus(p.status);
                const origem = p.origem || "site";
                return (
                  <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.borderSoft}` }}>
                    <div style={{ minWidth: 46, fontWeight: 800, fontSize: 14 }}>#{codigoPedido(p)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.clienteNome}</div>
                      <div style={{ fontSize: 11.5, color: C.textSoft, marginTop: 2 }}>
                        {p.createdAt ? new Date(p.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""}
                        {" · "}{origem === "balcao" ? "Balcão" : "Site"}
                        {" · "}{p.tipoEntrega === "entrega" ? "Entrega" : "Retirada"}
                        {p.formaPagamento ? ` · ${p.formaPagamento}` : ""}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 800, fontSize: 13.5 }}>{fmt(p.total)}</div>
                      <span style={{ display: "inline-block", marginTop: 3, fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 999, background: cor.bg, color: cor.fg }}>
                        {(labelStatus && labelStatus[p.status]) || p.status}
                      </span>
                    </div>
                  </div>
                );
              })}
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 12, fontSize: 13, fontWeight: 800 }}>
                <span>{validos.length} pedido{validos.length === 1 ? "" : "s"} (sem cancelados)</span>
                <span style={{ color: C.orangeText }}>{fmt(somaDia)}</span>
              </div>
            </Card>
          )}
          <div style={{ fontSize: 11.5, color: C.textFaint, textAlign: "center" }}>
            Para aceitar, preparar ou finalizar um pedido do site, use a aba Pedidos.
          </div>
        </>
      )}

      {sub === "reservas" && (
        <>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Nova reserva (encomenda para retirar)</div>
            <input value={formRes.nome} onChange={(e) => setFormRes({ ...formRes, nome: e.target.value })} placeholder="Nome do cliente" style={{ ...inputStyle, marginBottom: 8 }} />
            <input value={formRes.tel} onChange={(e) => setFormRes({ ...formRes, tel: e.target.value })} placeholder="Telefone / WhatsApp" inputMode="tel" style={{ ...inputStyle, marginBottom: 8 }} />
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input type="date" value={formRes.data} onChange={(e) => setFormRes({ ...formRes, data: e.target.value })} style={inputStyle} />
              <input type="time" value={formRes.hora} onChange={(e) => setFormRes({ ...formRes, hora: e.target.value })} style={inputStyle} />
            </div>
            <textarea
              value={formRes.descricao}
              onChange={(e) => setFormRes({ ...formRes, descricao: e.target.value })}
              placeholder="O que foi encomendado (ex.: 3 frangos assados, 2 farofas)"
              rows={3}
              style={{ ...inputStyle, marginBottom: 8, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input value={formRes.valor} onChange={(e) => setFormRes({ ...formRes, valor: e.target.value })} placeholder="Valor total (R$)" inputMode="decimal" style={inputStyle} />
              <input value={formRes.sinal} onChange={(e) => setFormRes({ ...formRes, sinal: e.target.value })} placeholder="Sinal pago (R$)" inputMode="decimal" style={inputStyle} />
            </div>
            <input value={formRes.obs} onChange={(e) => setFormRes({ ...formRes, obs: e.target.value })} placeholder="Observação (opcional)" style={{ ...inputStyle, marginBottom: 10 }} />
            <button onClick={salvarReserva} disabled={salvandoRes} style={{ ...btnPrimary, width: "100%", opacity: salvandoRes ? 0.6 : 1 }}>
              {salvandoRes ? <Loader2 size={16} /> : <Plus size={16} />} Salvar reserva
            </button>
          </Card>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button onClick={() => setFiltroRes("abertas")} style={chip(filtroRes === "abertas")}>Em aberto</button>
            <button onClick={() => setFiltroRes("historico")} style={chip(filtroRes === "historico")}>Histórico</button>
          </div>

          {erroRes && <div style={{ color: C.red, fontSize: 13, marginBottom: 12 }}>{erroRes}</div>}
          {carregandoRes && <div style={{ color: C.textSoft, fontSize: 13, marginBottom: 12 }}>Carregando reservas…</div>}
          {!carregandoRes && !erroRes && gruposRes.length === 0 && <EmptyState text={filtroRes === "abertas" ? "Nenhuma reserva em aberto" : "Nenhuma reserva no histórico"} />}

          {gruposRes.map(([data, lista]) => (
            <div key={data} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.textSoft, textTransform: "uppercase", letterSpacing: 0.4, margin: "0 2px 6px" }}>
                {rotuloDia(data, hoje)}
              </div>
              {lista.map((r) => {
                const falta = arred((r.total || 0) - (r.sinal_pago || 0));
                const msg = `Olá, ${String(r.cliente_nome).split(/\s+/)[0]}! Sua encomenda no Divino Frango para ${new Date(r.data_retirada + "T00:00").toLocaleDateString("pt-BR")}${r.hora_retirada ? ` às ${r.hora_retirada}` : ""} está confirmada ✅`;
                const wa = linkWhatsApp(r.cliente_telefone, msg);
                const aberta = r.status === "pendente" || r.status === "confirmada";
                return (
                  <Card key={r.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontWeight: 800, fontSize: 14 }}>{r.hora_retirada || "Sem hora"} · {r.cliente_nome}</div>
                      <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 999, height: "fit-content", background: r.status === "cancelada" ? C.redSoft : r.status === "retirada" ? C.greenSoft : C.orangeSoft, color: r.status === "cancelada" ? C.red : r.status === "retirada" ? C.green : C.orangeText }}>
                        {r.status === "pendente" ? "Pendente" : r.status === "confirmada" ? "Confirmada" : r.status === "retirada" ? "Retirada" : "Cancelada"}
                      </span>
                    </div>
                    <div style={{ fontSize: 13.5, margin: "6px 0", whiteSpace: "pre-wrap" }}>{r.descricao}</div>
                    {r.observacao && <div style={{ fontSize: 12, color: C.textSoft, marginBottom: 6 }}>Obs.: {r.observacao}</div>}
                    {(r.total > 0 || r.sinal_pago > 0) && (
                      <div style={{ fontSize: 12.5, color: C.textSoft, marginBottom: 8 }}>
                        Total {fmt(r.total)} · Sinal {fmt(r.sinal_pago)} · <b style={{ color: falta > 0 ? C.orangeText : C.green }}>Falta {fmt(Math.max(falta, 0))}</b>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {r.status === "pendente" && (
                        <button onClick={() => mudarStatusReserva(r.id, "confirmada")} style={{ ...btnOutline, padding: "8px 12px", fontSize: 13 }}><Check size={14} /> Confirmar</button>
                      )}
                      {aberta && (
                        <button onClick={() => mudarStatusReserva(r.id, "retirada")} style={{ ...btnPrimary, padding: "8px 12px", fontSize: 13 }}><Check size={14} /> Retirada</button>
                      )}
                      {aberta && (
                        <button onClick={() => mudarStatusReserva(r.id, "cancelada")} style={{ ...btnOutline, padding: "8px 12px", fontSize: 13 }}><X size={14} /> Cancelar</button>
                      )}
                      {!aberta && (
                        <button onClick={() => mudarStatusReserva(r.id, "pendente")} style={{ ...btnOutline, padding: "8px 12px", fontSize: 13 }}>Reabrir</button>
                      )}
                      {wa && (
                        <a href={wa} target="_blank" rel="noreferrer" style={{ ...btnOutline, padding: "8px 12px", fontSize: 13, textDecoration: "none" }}><Phone size={14} /> WhatsApp</a>
                      )}
                      <button onClick={() => excluirReserva(r.id)} style={iconBtnStyle} aria-label="Excluir reserva"><Trash2 size={16} color={C.red} /></button>
                    </div>
                  </Card>
                );
              })}
            </div>
          ))}
        </>
      )}
    </>
  );
}
