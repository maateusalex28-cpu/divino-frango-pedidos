import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Loader2, Check, X, Pencil, History } from "lucide-react";
import {
  TURNOS, rotuloTurno, PRESETS_VENDAS, periodoPreset, numBR, numParaCampo, somarLinhas, agruparPorDia,
  descreverMudancas, fmtDiaCompleto, diaSemana, r2,
} from "./financeiroUtils";

// Tela "Vendas do dia": o total vendido em dinheiro, cartão e Pix, por data (e turno).
// Tudo é gravado pela função salvar_fechamento_vendas (supabase/migracao-financeiro-etapa1.sql),
// que valida no banco, impede duplicidade e guarda o histórico de alterações.

const ERRO_MIGRACAO = (e) =>
  e && (e.code === "PGRST202" || e.code === "42883" || e.code === "42P01" || /could not find the function|does not exist/i.test(e.message || ""));

function Kpi({ C, label, value, sub, cor }) {
  return (
    <div style={{ flex: "1 1 45%", minWidth: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "10px 12px" }}>
      <div style={{ fontSize: 10.5, color: C.textSoft, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>{label}</div>
      <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: cor || C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: C.textFaint, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export default function VendasDia({
  supabase, C, fmt, Card, FieldLabel, EmptyState, inputStyle, btnPrimary, btnOutline, iconBtnStyle, showToast, dataLocalISO,
  mostrarLista = true, onSaved,
}) {
  const hoje = dataLocalISO();

  // ----- formulário -----
  const [data, setData] = useState(hoje);
  const [turno, setTurno] = useState("unico");
  const [dinheiro, setDinheiro] = useState("");
  const [cartao, setCartao] = useState("");
  const [pix, setPix] = useState("");
  const [obs, setObs] = useState("");
  const [motivo, setMotivo] = useState("");
  const [editando, setEditando] = useState(null); // linha de fechamentos_vendas em edição
  const [existente, setExistente] = useState(null); // já existe lançamento para data + turno
  const [salvando, setSalvando] = useState(false);
  const [semMigracao, setSemMigracao] = useState(false);

  const vDin = numBR(dinheiro), vCar = numBR(cartao), vPix = numBR(pix);
  const valoresOk = [vDin, vCar, vPix].every((v) => Number.isFinite(v));
  const totalForm = valoresOk ? r2(vDin + vCar + vPix) : 0;

  // ----- lista / filtro -----
  const [preset, setPreset] = useState("mes");
  const [custIni, setCustIni] = useState(hoje);
  const [custFim, setCustFim] = useState(hoje);
  const [inicio, fim] = useMemo(() => (preset === "custom" ? [custIni || hoje, custFim || hoje] : periodoPreset(preset, hoje)), [preset, custIni, custFim, hoje]);
  const [linhas, setLinhas] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [versao, setVersao] = useState(0); // sobe a cada gravação, para recarregar
  const [historico, setHistorico] = useState(null); // { linha, itens, carregando }

  // existe lançamento para esta data + turno? (só quando não está editando)
  useEffect(() => {
    if (editando || !data) { setExistente(null); return; }
    let vivo = true;
    (async () => {
      const { data: row, error } = await supabase.from("fechamentos_vendas").select("*").eq("data", data).eq("turno", turno).maybeSingle();
      if (!vivo) return;
      if (error) { if (ERRO_MIGRACAO(error)) setSemMigracao(true); setExistente(null); return; }
      setExistente(row || null);
    })();
    return () => { vivo = false; };
  }, [data, turno, editando, versao, supabase]);

  const carregarLista = useCallback(async () => {
    if (!mostrarLista) return;
    setCarregando(true);
    const { data: rows, error } = await supabase
      .from("fechamentos_vendas").select("*").gte("data", inicio).lte("data", fim)
      .order("data", { ascending: false }).order("turno", { ascending: true });
    setCarregando(false);
    if (error) { if (ERRO_MIGRACAO(error)) setSemMigracao(true); else showToast(`Erro ao carregar as vendas: ${error.message}`); return; }
    setLinhas(rows || []);
  }, [supabase, inicio, fim, mostrarLista, showToast]);

  useEffect(() => { carregarLista(); }, [carregarLista, versao]);

  const limpar = () => {
    setEditando(null); setDinheiro(""); setCartao(""); setPix(""); setObs(""); setMotivo(""); setTurno("unico"); setData(hoje);
  };

  const iniciarEdicao = (l) => {
    setEditando(l);
    setData(l.data); setTurno(l.turno);
    setDinheiro(numParaCampo(l.dinheiro)); setCartao(numParaCampo(l.cartao)); setPix(numParaCampo(l.pix));
    setObs(l.observacao || ""); setMotivo("");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const salvar = async () => {
    if (!data) { showToast("Escolha a data das vendas"); return; }
    if (!valoresOk) { showToast("Confira os valores: use só números (ex.: 1250,50)"); return; }
    if (totalForm <= 0) { showToast("Informe o valor de pelo menos uma forma de pagamento"); return; }
    setSalvando(true);
    const { error } = await supabase.rpc("salvar_fechamento_vendas", {
      p_id: editando ? editando.id : null,
      p_data: data, p_turno: turno,
      p_dinheiro: vDin, p_cartao: vCar, p_pix: vPix,
      p_observacao: obs.trim() || null,
      p_motivo: editando ? motivo.trim() || null : null,
      p_versao: editando ? editando.updated_at : null,
    });
    setSalvando(false);
    if (error) {
      if (ERRO_MIGRACAO(error)) { setSemMigracao(true); return; }
      if (error.hint === "DUPLICADO") { showToast("Já existe um lançamento para essa data e turno. Abra-o para editar."); setVersao((v) => v + 1); return; }
      if (error.hint === "CONFLITO") { showToast(error.message); setEditando(null); setVersao((v) => v + 1); return; }
      showToast(error.message || "Erro ao salvar");
      return;
    }
    showToast(editando ? "Lançamento atualizado" : "Vendas do dia lançadas");
    limpar();
    setVersao((v) => v + 1);
    if (onSaved) onSaved();
  };

  const abrirHistorico = async (l) => {
    setHistorico({ linha: l, itens: [], carregando: true });
    const { data: rows, error } = await supabase
      .from("fechamentos_vendas_historico").select("*").eq("fechamento_id", l.id).order("created_at", { ascending: false });
    if (error) { showToast("Erro ao carregar o histórico"); setHistorico(null); return; }
    setHistorico({ linha: l, itens: rows || [], carregando: false });
  };

  const totais = useMemo(() => somarLinhas(linhas), [linhas]);
  const dias = useMemo(() => agruparPorDia(linhas), [linhas]);
  const mostrarTotalDoDia = (d) => d.linhas.length > 1;

  if (semMigracao) {
    return (
      <Card style={{ borderColor: C.orange }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.orangeText, marginBottom: 6 }}>Falta ativar as vendas do dia no banco</div>
        <div style={{ fontSize: 13, color: C.textSoft, lineHeight: 1.5 }}>
          Rode o arquivo <b style={{ color: C.text }}>supabase/migracao-financeiro-etapa1.sql</b> no SQL Editor do Supabase (depois do migracao-financeiro.sql) e volte para esta tela.
        </div>
      </Card>
    );
  }

  const campoValor = (rotulo, valor, setValor, dica) => (
    <div style={{ flex: "1 1 30%", minWidth: 96 }}>
      <FieldLabel>{rotulo}</FieldLabel>
      <input
        type="text" inputMode="decimal" placeholder="0,00" value={valor}
        onChange={(e) => setValor(e.target.value)}
        style={{ ...inputStyle, borderColor: valor && !Number.isFinite(numBR(valor)) ? C.red : C.border }}
      />
      {dica && <div style={{ fontSize: 10.5, color: C.textFaint, marginTop: 3 }}>{dica}</div>}
    </div>
  );

  const th = { padding: "7px 8px", fontSize: 10.5, fontWeight: 700, color: C.textSoft, textTransform: "uppercase", letterSpacing: 0.3, textAlign: "right", whiteSpace: "nowrap", background: C.cardAlt };
  const td = { padding: "8px", fontSize: 12.5, textAlign: "right", whiteSpace: "nowrap", borderTop: `1px solid ${C.borderSoft}`, color: C.text };

  return (
    <div>
      <Card style={{ marginBottom: 14, borderColor: editando ? C.orange : C.border }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{editando ? "Editando lançamento" : "Lançar vendas do dia"}</div>
          {editando && (
            <button onClick={limpar} style={{ ...iconBtnStyle, color: C.textSoft, fontSize: 12.5, gap: 4 }}><X size={14} /> Cancelar</button>
          )}
        </div>
        <div style={{ fontSize: 12, color: C.textSoft, marginBottom: 12, lineHeight: 1.45 }}>
          Informe o <b style={{ color: C.text }}>total bruto</b> vendido em cada forma de pagamento. Compras, diárias e outras saídas são lançadas à parte e descontadas depois — não subtraia nada aqui.
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 150px" }}>
            <FieldLabel>Data das vendas</FieldLabel>
            <input type="date" value={data} max={hoje} onChange={(e) => setData(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: "1 1 120px" }}>
            <FieldLabel>Turno</FieldLabel>
            <select value={turno} onChange={(e) => setTurno(e.target.value)} style={inputStyle}>
              {TURNOS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
        </div>

        {existente && !editando && (
          <div style={{ background: C.orangeSoft, border: `1px solid ${C.orange}`, borderRadius: 12, padding: "10px 12px", marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.orangeText, marginBottom: 4 }}>
              Já existe um lançamento em {fmtDiaCompleto(existente.data)} ({rotuloTurno(existente.turno).toLowerCase()})
            </div>
            <div className="mono" style={{ fontSize: 12.5, color: C.text, marginBottom: 8 }}>
              Dinheiro {fmt(Number(existente.dinheiro))} · Cartão {fmt(Number(existente.cartao))} · Pix {fmt(Number(existente.pix))} · Total {fmt(Number(existente.total))}
            </div>
            <button onClick={() => iniciarEdicao(existente)} style={{ ...btnOutline, padding: "8px 12px", fontSize: 13 }}><Pencil size={13} /> Editar este lançamento</button>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          {campoValor("Dinheiro", dinheiro, setDinheiro)}
          {campoValor("Cartão", cartao, setCartao, "Fica 'a receber' até a operadora pagar")}
          {campoValor("Pix", pix, setPix)}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "8px 2px", borderTop: `1px solid ${C.borderSoft}`, marginBottom: 10 }}>
          <span style={{ fontSize: 13, color: C.textSoft, fontWeight: 600 }}>Total vendido</span>
          <span className="mono" style={{ fontSize: 18, fontWeight: 800, color: C.text }}>{fmt(totalForm)}</span>
        </div>

        <div style={{ marginBottom: 10 }}>
          <FieldLabel>Observações (opcional)</FieldLabel>
          <input type="text" value={obs} onChange={(e) => setObs(e.target.value)} style={inputStyle} maxLength={300} />
        </div>
        {editando && (
          <div style={{ marginBottom: 10 }}>
            <FieldLabel>Motivo da alteração (fica no histórico)</FieldLabel>
            <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} style={inputStyle} maxLength={300} placeholder="Ex.: conferi o fechamento e corrigi o valor" />
          </div>
        )}

        <button
          onClick={salvar}
          disabled={salvando || (!!existente && !editando)}
          style={{ ...btnPrimary, width: "100%", opacity: salvando || (existente && !editando) ? 0.5 : 1 }}
        >
          {salvando ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
          {editando ? "Salvar alteração" : "Lançar vendas do dia"}
        </button>
        {!mostrarLista && (
          <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 8 }}>Para consultar ou corrigir lançamentos anteriores, abra Financeiro → Vendas do dia.</div>
        )}
      </Card>

      {mostrarLista && (
        <>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, marginBottom: 6 }}>
            {PRESETS_VENDAS.map((p) => {
              const ativo = preset === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => { if (p.id === "custom") { setCustIni(inicio); setCustFim(fim); } setPreset(p.id); }}
                  style={{
                    flexShrink: 0, padding: "8px 13px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap",
                    background: ativo ? C.orange : C.card, color: ativo ? "#0E0E10" : C.textSoft, border: `1px solid ${ativo ? C.orange : C.border}`,
                  }}
                >{p.label}</button>
              );
            })}
          </div>
          {preset === "custom" && (
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}><FieldLabel>De</FieldLabel><input type="date" value={custIni} max={custFim || undefined} onChange={(e) => setCustIni(e.target.value)} style={inputStyle} /></div>
              <div style={{ flex: 1 }}><FieldLabel>Até</FieldLabel><input type="date" value={custFim} min={custIni || undefined} onChange={(e) => setCustFim(e.target.value)} style={inputStyle} /></div>
            </div>
          )}
          <div style={{ fontSize: 11.5, color: C.textFaint, marginBottom: 10 }}>
            {inicio === fim ? fmtDiaCompleto(inicio) : `${fmtDiaCompleto(inicio)} a ${fmtDiaCompleto(fim)}`}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <Kpi C={C} label="Total vendido" value={fmt(totais.total)} cor={C.orangeText} />
            <Kpi C={C} label="Dinheiro" value={fmt(totais.dinheiro)} />
            <Kpi C={C} label="Cartão" value={fmt(totais.cartao)} sub="a receber da operadora" />
            <Kpi C={C} label="Pix" value={fmt(totais.pix)} />
          </div>

          {carregando ? (
            <div style={{ textAlign: "center", padding: "30px 0", color: C.textSoft }}><Loader2 size={20} className="spin" /></div>
          ) : dias.length === 0 ? (
            <EmptyState text="Nenhum lançamento de vendas neste período." />
          ) : (
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, textAlign: "left" }}>Data</th>
                      <th style={th}>Dinheiro</th><th style={th}>Cartão</th><th style={th}>Pix</th><th style={th}>Total</th><th style={th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {dias.map((d) => (
                      <React.Fragment key={d.data}>
                        {mostrarTotalDoDia(d) && (
                          <tr style={{ background: C.cardAlt }}>
                            <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{fmtDiaCompleto(d.data)} · total do dia</td>
                            <td className="mono" style={td}>{fmt(d.dinheiro)}</td><td className="mono" style={td}>{fmt(d.cartao)}</td>
                            <td className="mono" style={td}>{fmt(d.pix)}</td><td className="mono" style={{ ...td, fontWeight: 800 }}>{fmt(d.total)}</td><td style={td}></td>
                          </tr>
                        )}
                        {d.linhas.map((l) => (
                          <tr key={l.id}>
                            <td style={{ ...td, textAlign: "left" }}>
                              {mostrarTotalDoDia(d) ? <span style={{ paddingLeft: 10, color: C.textSoft }}>{rotuloTurno(l.turno)}</span> : (
                                <>{fmtDiaCompleto(l.data)} <span style={{ color: C.textFaint, fontSize: 11 }}>{diaSemana(l.data)}{l.turno !== "unico" ? ` · ${rotuloTurno(l.turno).toLowerCase()}` : ""}</span></>
                              )}
                              {l.observacao && <div style={{ fontSize: 11, color: C.textFaint, whiteSpace: "normal", maxWidth: 220 }}>{l.observacao}</div>}
                            </td>
                            <td className="mono" style={td}>{fmt(Number(l.dinheiro))}</td>
                            <td className="mono" style={td}>{fmt(Number(l.cartao))}</td>
                            <td className="mono" style={td}>{fmt(Number(l.pix))}</td>
                            <td className="mono" style={{ ...td, fontWeight: 700 }}>{fmt(Number(l.total))}</td>
                            <td style={{ ...td, textAlign: "center" }}>
                              <button onClick={() => iniciarEdicao(l)} style={iconBtnStyle} aria-label="Editar lançamento"><Pencil size={14} color={C.textSoft} /></button>
                              <button onClick={() => abrirHistorico(l)} style={iconBtnStyle} aria-label="Ver histórico"><History size={14} color={C.textSoft} /></button>
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {historico && (
        <div
          onClick={() => setHistorico(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 60, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 12 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 520, maxHeight: "80vh", overflowY: "auto", background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Histórico · {fmtDiaCompleto(historico.linha.data)} ({rotuloTurno(historico.linha.turno).toLowerCase()})</div>
              <button onClick={() => setHistorico(null)} style={iconBtnStyle} aria-label="Fechar"><X size={16} color={C.textSoft} /></button>
            </div>
            {historico.carregando ? (
              <div style={{ textAlign: "center", padding: 20, color: C.textSoft }}><Loader2 size={18} className="spin" /></div>
            ) : historico.itens.length === 0 ? (
              <div style={{ fontSize: 13, color: C.textSoft }}>Sem registros.</div>
            ) : (
              historico.itens.map((h) => {
                const mud = descreverMudancas(h.antes, h.depois, fmt);
                return (
                  <div key={h.id} style={{ borderTop: `1px solid ${C.borderSoft}`, padding: "10px 0" }}>
                    <div style={{ fontSize: 12, color: C.textFaint, marginBottom: 3 }}>
                      {new Date(h.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · {h.acao === "criado" ? "Lançamento criado" : h.acao === "alterado" ? "Alterado" : "Apagado"}
                    </div>
                    {h.acao === "criado" && h.depois && (
                      <div className="mono" style={{ fontSize: 12.5, color: C.text }}>Dinheiro {fmt(Number(h.depois.dinheiro))} · Cartão {fmt(Number(h.depois.cartao))} · Pix {fmt(Number(h.depois.pix))}</div>
                    )}
                    {mud.map((m) => <div key={m} style={{ fontSize: 12.5, color: C.text }}>{m}</div>)}
                    {h.motivo && <div style={{ fontSize: 12, color: C.textSoft, marginTop: 3 }}>Motivo: {h.motivo}</div>}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
