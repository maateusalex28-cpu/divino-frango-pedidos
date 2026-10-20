import React, { useState } from "react";
import Financeiro from "./Financeiro";
import VendasDia from "./VendasDia";

// Entrada do módulo Financeiro: abas internas. Novas seções (compras, contas a pagar, caixa físico...)
// entram aqui nas próximas etapas.
const SECOES = [
  { id: "visao", label: "Visão geral" },
  { id: "vendas", label: "Vendas do dia" },
];

export default function FinanceiroHub(props) {
  const { C } = props;
  const [secao, setSecao] = useState("visao");
  return (
    <div>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 14 }}>
        {SECOES.map((s) => {
          const ativo = secao === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSecao(s.id)}
              style={{
                flexShrink: 0, padding: "9px 15px", borderRadius: 11, fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap",
                background: ativo ? C.orangeSoft : "transparent", color: ativo ? C.orangeText : C.textSoft,
                border: `1px solid ${ativo ? C.orange : C.border}`,
              }}
            >{s.label}</button>
          );
        })}
      </div>
      {secao === "visao" && <Financeiro {...props} />}
      {secao === "vendas" && (
        <>
          <div className="display" style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 12 }}>Vendas do dia</div>
          <VendasDia {...props} mostrarLista />
        </>
      )}
    </div>
  );
}
